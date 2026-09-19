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

const ROOT = path.join(__dirname, '..');
const CONTENT_PATH = path.join(ROOT, 'output', 'current-content.json');
const VIDEO_PATH = path.join(ROOT, 'output', 'video.mp4');

const GRAPH_VERSION = process.env.IG_GRAPH_VERSION || 'v21.0';
const GRAPH_HOST = 'https://graph.instagram.com';
const GITHUB_API = 'https://api.github.com';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

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
  const hashtagLine = (content.hashtags || []).join(' ');
  return [content.instagramCaption || content.quote, '', hashtagLine]
    .filter((part) => part !== undefined && part !== null)
    .join('\n');
}

// --- GitHub Release asset hosting -----------------------------------------

async function githubRequest(pathname, { method = 'GET', headers = {}, body } = {}) {
  const token = requireEnv('GITHUB_TOKEN');
  const res = await fetch(`${GITHUB_API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    },
    body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${pathname} failed: ${res.status} ${text}`);
  }
  return data;
}

async function getOrCreateRelease(repo, tagName) {
  try {
    return await githubRequest(`/repos/${repo}/releases/tags/${tagName}`);
  } catch (err) {
    return githubRequest(`/repos/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tagName,
        name: `Filter Funds post — ${tagName}`,
        body: 'Automated daily content release (hosts the video asset publicly for Instagram publishing).',
        prerelease: false,
      }),
    });
  }
}

async function uploadReleaseAsset(release, fileName, filePath, contentType) {
  const token = requireEnv('GITHUB_TOKEN');
  const fileBuffer = fs.readFileSync(filePath);
  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(fileName)}`);

  const doUpload = () =>
    fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': contentType,
        'Content-Length': String(fileBuffer.length),
      },
      body: fileBuffer,
    });

  let res = await doUpload();

  if (res.status === 422) {
    // Asset with this name already exists on the release (e.g. a re-run) —
    // delete it and retry once.
    const assets = await githubRequest(`/repos/${process.env.GITHUB_REPOSITORY}/releases/${release.id}/assets`);
    const match = assets.find((asset) => asset.name === fileName);
    if (match) {
      await githubRequest(`/repos/${process.env.GITHUB_REPOSITORY}/releases/assets/${match.id}`, {
        method: 'DELETE',
      });
    }
    res = await doUpload();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub asset upload failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function publishVideoToGithubRelease(dateTag, videoPath) {
  const repo = requireEnv('GITHUB_REPOSITORY');
  const release = await getOrCreateRelease(repo, dateTag);
  const fileName = `filter-funds-${dateTag}.mp4`;
  const asset = await uploadReleaseAsset(release, fileName, videoPath, 'video/mp4');
  return asset.browser_download_url;
}

// --- Instagram Graph API ----------------------------------------------------

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

async function createReelContainer({ igUserId, videoUrl, caption }) {
  const data = await instagramRequest(
    `/${igUserId}/media`,
    {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: 'true',
    },
    'POST'
  );
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

// --- Main -------------------------------------------------------------------

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

  console.log('Uploading video to a GitHub Release asset for public hosting...');
  const videoUrl = await publishVideoToGithubRelease(dateTag, VIDEO_PATH);
  console.log(`Public video URL: ${videoUrl}`);

  const caption = buildCaption(content);
  console.log('Creating Instagram Reels container...');
  const containerId = await createReelContainer({ igUserId, videoUrl, caption });

  console.log('Waiting for Instagram to finish processing the video...');
  await waitForContainerReady(containerId);

  console.log('Publishing Reel...');
  const mediaId = await publishContainer({ igUserId, containerId });

  console.log(`Published Instagram Reel: media id ${mediaId}`);
  return { mediaId, videoUrl };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('publish-instagram.js failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
