#!/usr/bin/env node
/**
 * scripts/publish-instagram.js
 *
 * Publishes output/video.mp4 as an Instagram Reel using the "Instagram API
 * with Instagram Login" (graph.instagram.com), which doesn't require a
 * linked Facebook Page.
 *
 * Instagram's container-creation API needs the video reachable at a public
 * HTTPS URL, so this script first uploads the video as a GitHub Release
 * asset (tagged by date) to get that public URL. This requires the repo to
 * be PUBLIC — a private repo's release assets require an auth token to
 * download, which Instagram's servers can't provide. See README.md.
 *
 * Required env vars (see .env.example):
 *   IG_ACCESS_TOKEN   (long-lived, instagram_business_content_publish scope)
 *   IG_USER_ID
 *   GITHUB_TOKEN
 *   GITHUB_REPOSITORY (e.g. "your-org/filter-funds-content")
 * Optional:
 *   IG_GRAPH_VERSION (default "v21.0")
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { publishAssetsToGithubRelease } = require('./lib/github-assets');
const { ensureWebsiteLine } = require('./lib/brand-links');

const ROOT = path.join(__dirname, '..');
const CONTENT_PATH = path.join(ROOT, 'output', 'current-content.json');
const VIDEO_PATH = path.join(ROOT, 'output', 'video.mp4');
const COVER_PATH = path.join(ROOT, 'output', 'cover.jpg');

const GRAPH_VERSION = process.env.IG_GRAPH_VERSION || 'v21.0';
const GRAPH_HOST = 'https://graph.instagram.com';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const COVER_THUMB_OFFSET_MS = String(
  Number(process.env.IG_COVER_THUMB_OFFSET_MS || 2500)
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildCaption(content) {
  const captionBody = ensureWebsiteLine(content.instagramCaption || content.quote || '');
  const hashtagLine = (content.hashtags || []).join(' ');
  return [captionBody, '', hashtagLine]
    .filter((part) => part !== undefined && part !== null)
    .join('\n');
}

async function instagramRequest(pathname, params, method = 'GET') {
  const accessToken = requireEnv('IG_ACCESS_TOKEN');
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}${pathname}`);

  let res;
  if (method === 'GET') {
    Object.entries({ ...params, access_token: accessToken }).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    res = await fetch(url.toString());
  } else {
    const body = new URLSearchParams();
    Object.entries({ ...params, access_token: accessToken }).forEach(([key, value]) => {
      if (value !== undefined && value !== null) body.set(key, value);
    });
    res = await fetch(url.toString(), { method, body });
  }

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Instagram API ${method} ${pathname} failed: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

async function createReelContainer({ igUserId, videoUrl, caption, coverUrl }) {
  const params = {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    share_to_feed: 'true',
    thumb_offset: COVER_THUMB_OFFSET_MS,
  };
  if (coverUrl) {
    params.cover_url = coverUrl;
  }

  const data = await instagramRequest(`/${igUserId}/media`, params, 'POST');
  return data.id;
}

async function waitForContainerReady(containerId) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const data = await instagramRequest(`/${containerId}`, { fields: 'status_code' }, 'GET');
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new Error(`Instagram container failed with status ${data.status_code}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Timed out waiting for Instagram video processing to finish.');
}

async function publishContainer({ igUserId, containerId }) {
  const data = await instagramRequest(`/${igUserId}/media_publish`, { creation_id: containerId }, 'POST');
  return data.id;
}

async function main() {
  if (!fs.existsSync(CONTENT_PATH)) {
    throw new Error(`${path.relative(ROOT, CONTENT_PATH)} not found. Run "npm run generate" first.`);
  }
  if (!fs.existsSync(VIDEO_PATH)) {
    throw new Error(`${path.relative(ROOT, VIDEO_PATH)} not found. Run "npm run build-video" first.`);
  }

  const content = readJson(CONTENT_PATH);
  const igUserId = requireEnv('IG_USER_ID');
  const dateTag = `post-${content.date || new Date().toISOString().slice(0, 10)}`;

  let videoUrl = process.env.VIDEO_URL || null;
  let coverUrl = process.env.COVER_URL || null;
  let releaseTag = process.env.RELEASE_TAG || dateTag;

  if (!videoUrl) {
    console.log('Uploading video (+ cover) to a GitHub Release for public hosting...');
    const uploaded = await publishAssetsToGithubRelease(dateTag, VIDEO_PATH, COVER_PATH);
    videoUrl = uploaded.videoUrl;
    coverUrl = uploaded.coverUrl;
    releaseTag = uploaded.releaseTag;
  } else {
    console.log(`Using provided public video URL: ${videoUrl}`);
  }

  if (coverUrl) {
    console.log(`Public cover URL: ${coverUrl}`);
  } else {
    console.warn(
      `No cover URL available; using thumb_offset=${COVER_THUMB_OFFSET_MS}ms only.`
    );
  }

  const caption = buildCaption(content);
  console.log('Creating Instagram Reels container...');
  const containerId = await createReelContainer({
    igUserId,
    videoUrl,
    caption,
    coverUrl,
  });

  console.log('Waiting for Instagram to finish processing the video...');
  await waitForContainerReady(containerId);

  console.log('Publishing Reel...');
  const mediaId = await publishContainer({ igUserId, containerId });

  console.log(`Published Instagram Reel: media id ${mediaId}`);
  return { mediaId, videoUrl, coverUrl, releaseTag };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('publish-instagram.js failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
