#!/usr/bin/env node
/**
 * scripts/publish-youtube-followup.js
 *
 * Uploads the same daily video as a regular YouTube video (NOT a Short),
 * using content/pending-followup.json. Downloads the public video URL first.
 *
 * Required env vars: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 */

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { google } = require('googleapis');
const { readPending } = require('./lib/pending-followup');

const ROOT = path.join(__dirname, '..');
const TITLE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 5000;
const MAX_HASHTAGS = 15;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

function buildTitle(content) {
  let title = content.youtubeTitle || content.quote || 'Filter Funds';
  // Ensure this is NOT classified as a Short.
  title = title.replace(/\s*#shorts\b/gi, '').trim();
  if (title.length > TITLE_MAX_LENGTH) {
    title = title.slice(0, TITLE_MAX_LENGTH - 1).trimEnd() + '\u2026';
  }
  return title;
}

function extractHashtags(text) {
  return (text.match(/#\w+/g) || []).map((tag) => tag.toLowerCase());
}

function buildDescription(content) {
  let description = (content.youtubeDescription || content.quote || '')
    .replace(/\s*#shorts\b/gi, '')
    .trim();

  const usedTags = new Set(extractHashtags(description));
  const extraTags = [];
  for (const tag of content.hashtags || []) {
    if (usedTags.size >= MAX_HASHTAGS) break;
    const normalized = tag.toLowerCase();
    if (normalized === '#shorts' || usedTags.has(normalized)) continue;
    extraTags.push(tag);
    usedTags.add(normalized);
  }

  const parts = [description, '', extraTags.join(' ')].filter(Boolean);
  return parts.join('\n').slice(0, DESCRIPTION_MAX_LENGTH);
}

function getAuthenticatedClient() {
  const oauth2Client = new google.auth.OAuth2(
    requireEnv('YOUTUBE_CLIENT_ID'),
    requireEnv('YOUTUBE_CLIENT_SECRET')
  );
  oauth2Client.setCredentials({ refresh_token: requireEnv('YOUTUBE_REFRESH_TOKEN') });
  return oauth2Client;
}

async function downloadToTemp(url, extension) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpPath = path.join(
    os.tmpdir(),
    `ff-followup-${Date.now()}.${extension.replace(/^\./, '')}`
  );
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

async function main() {
  const pending = readPending();
  if (!pending?.videoUrl) {
    throw new Error(
      'No pending follow-up video URL. Run the morning pipeline first (content/pending-followup.json).'
    );
  }

  const auth = getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  console.log(`Downloading follow-up video from ${pending.videoUrl}`);
  const videoPath = await downloadToTemp(pending.videoUrl, 'mp4');
  let coverPath = null;
  if (pending.coverUrl) {
    try {
      coverPath = await downloadToTemp(pending.coverUrl, 'jpg');
    } catch (err) {
      console.warn('Could not download cover for YouTube thumbnail:', err.message);
    }
  }

  const title = buildTitle(pending);
  const description = buildDescription(pending);
  const privacyStatus = process.env.YOUTUBE_PRIVACY_STATUS || 'public';
  const categoryId = process.env.YOUTUBE_CATEGORY_ID || '22';

  console.log(`Uploading YouTube post (regular video): "${title}"`);

  try {
    const insertResponse = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags: (pending.hashtags || [])
            .map((tag) => tag.replace(/^#/, ''))
            .filter((tag) => tag.toLowerCase() !== 'shorts'),
          categoryId,
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(videoPath),
      },
    });

    const videoId = insertResponse.data.id;
    console.log(`Uploaded: https://youtube.com/watch?v=${videoId}`);

    if (coverPath && fs.existsSync(coverPath)) {
      try {
        await youtube.thumbnails.set({
          videoId,
          media: { body: fs.createReadStream(coverPath) },
        });
        console.log('Custom thumbnail set.');
      } catch (err) {
        console.warn('Could not set custom thumbnail:', err.message);
      }
    }

    return { videoId, url: `https://youtube.com/watch?v=${videoId}` };
  } finally {
    fs.rmSync(videoPath, { force: true });
    if (coverPath) fs.rmSync(coverPath, { force: true });
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('publish-youtube-followup.js failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
