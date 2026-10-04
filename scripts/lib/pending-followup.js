/**
 * Pending +12h follow-up payload (Instagram Story + YouTube regular post).
 * Stored under content/ so it can be committed between the morning and evening jobs.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PENDING_PATH = path.join(ROOT, 'content', 'pending-followup.json');

function readPending() {
  if (!fs.existsSync(PENDING_PATH)) return null;
  return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
}

function writePending(payload) {
  fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true });
  fs.writeFileSync(PENDING_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return PENDING_PATH;
}

function clearPending() {
  if (fs.existsSync(PENDING_PATH)) {
    fs.unlinkSync(PENDING_PATH);
  }
}

function buildPendingFromContent(content, { videoUrl, coverUrl, releaseTag }) {
  const createdAt = new Date();
  const followUpAt = new Date(createdAt.getTime() + 12 * 60 * 60 * 1000);

  return {
    status: 'pending',
    date: content.date || createdAt.toISOString().slice(0, 10),
    quote: content.quote,
    youtubeTitle: content.youtubeTitle,
    youtubeDescription: content.youtubeDescription,
    instagramCaption: content.instagramCaption,
    hashtags: content.hashtags || [],
    releaseTag,
    videoUrl,
    coverUrl,
    createdAt: createdAt.toISOString(),
    followUpAt: followUpAt.toISOString(),
  };
}

module.exports = {
  PENDING_PATH,
  readPending,
  writePending,
  clearPending,
  buildPendingFromContent,
};
