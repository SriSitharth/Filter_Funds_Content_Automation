#!/usr/bin/env node
/**
 * scripts/publish-youtube.js
 *
 * Uploads output/video.mp4 to YouTube as a Short, using the title,
 * description and hashtags from output/current-content.json.
 *
 * Required env vars (see .env.example):
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 *   YOUTUBE_REFRESH_TOKEN   (minted once via `npm run youtube:auth`)
 * Optional:
 *   YOUTUBE_PRIVACY_STATUS  ("public" | "unlisted" | "private", default "public")
 *   YOUTUBE_CATEGORY_ID     (default "22" - People & Blogs)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { ensureWebsiteLine } = require('./lib/brand-links');

const ROOT = path.join(__dirname, '..');
const CONTENT_PATH = path.join(ROOT, 'output', 'current-content.json');
const VIDEO_PATH = path.join(ROOT, 'output', 'video.mp4');
const COVER_PATH = path.join(ROOT, 'output', 'cover.jpg');

const TITLE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 5000;
// YouTube ignores ALL hashtags on a video if title + description together
// exceed 15 of them, so this stays well under that regardless of what the
// model puts in youtubeDescription vs. the separate hashtags field.
const MAX_HASHTAGS = 15;

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

function buildTitle(content) {
  let title = content.youtubeTitle || content.quote;
  if (!/#shorts/i.test(title)) {
    const suffix = ' #Shorts';
    const maxBase = TITLE_MAX_LENGTH - suffix.length;
    if (title.length > maxBase) {
      title = title.slice(0, maxBase - 1).trimEnd() + '\u2026';
    }
    title += suffix;
  }
  return title.slice(0, TITLE_MAX_LENGTH);
}

function extractHashtags(text) {
  return (text.match(/#\w+/g) || []).map((tag) => tag.toLowerCase());
}

function buildDescription(content) {
  const description = ensureWebsiteLine(content.youtubeDescription || '');
  const usedTags = new Set(extractHashtags(description));

  const extraTags = [];
  for (const tag of content.hashtags || []) {
    if (usedTags.size >= MAX_HASHTAGS) break;
    if (usedTags.has(tag.toLowerCase())) continue;
    extraTags.push(tag);
    usedTags.add(tag.toLowerCase());
  }

  const parts = [description, '', extraTags.join(' ')].filter(Boolean);
  let fullDescription = parts.join('\n');

  if (!/#shorts/i.test(fullDescription) && usedTags.size < MAX_HASHTAGS) {
    fullDescription += '\n#Shorts';
  }

  return fullDescription.slice(0, DESCRIPTION_MAX_LENGTH);
}

function getAuthenticatedClient() {
  const clientId = requireEnv('YOUTUBE_CLIENT_ID');
  const clientSecret = requireEnv('YOUTUBE_CLIENT_SECRET');
  const refreshToken = requireEnv('YOUTUBE_REFRESH_TOKEN');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

async function main() {
  if (!fs.existsSync(CONTENT_PATH)) {
    throw new Error(`${path.relative(ROOT, CONTENT_PATH)} not found. Run "npm run generate" first.`);
  }
  if (!fs.existsSync(VIDEO_PATH)) {
    throw new Error(`${path.relative(ROOT, VIDEO_PATH)} not found. Run "npm run build-video" first.`);
  }

  const content = readJson(CONTENT_PATH);
  const auth = getAuthenticatedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const title = buildTitle(content);
  const description = buildDescription(content);
  const privacyStatus = process.env.YOUTUBE_PRIVACY_STATUS || 'public';
  const categoryId = process.env.YOUTUBE_CATEGORY_ID || '22';

  console.log(`Uploading YouTube Short: "${title}"`);

  const insertResponse = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags: (content.hashtags || []).map((tag) => tag.replace(/^#/, '')),
        categoryId,
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(VIDEO_PATH),
    },
  });

  const videoId = insertResponse.data.id;
  console.log(`Uploaded: https://youtube.com/shorts/${videoId}`);

  if (fs.existsSync(COVER_PATH)) {
    try {
      await youtube.thumbnails.set({
        videoId,
        media: { body: fs.createReadStream(COVER_PATH) },
      });
      console.log('Custom thumbnail set.');
    } catch (err) {
      console.warn(
        'Could not set custom thumbnail (this requires a phone-verified YouTube channel). ' +
          'Continuing without it.',
        err.message
      );
    }
  }

  return { videoId, url: `https://youtube.com/shorts/${videoId}` };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('publish-youtube.js failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
