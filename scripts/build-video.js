#!/usr/bin/env node
/**
 * scripts/build-video.js
 *
 * Encodes output/raw.webm (from render-design.js) into a final MP4 suitable
 * for YouTube Shorts / Instagram Reels using ffmpeg, optionally muxing in a
 * background track from assets/audio/, and produces a cover thumbnail.
 *
 * Input:  output/raw.webm
 * Output: output/video.mp4, output/cover.jpg
 *
 * Requires the `ffmpeg` binary to be available on PATH.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const ROOT = path.join(__dirname, '..');
const RAW_VIDEO_PATH = path.join(ROOT, 'output', 'raw.webm');
const FINAL_VIDEO_PATH = path.join(ROOT, 'output', 'video.mp4');
const COVER_PATH = path.join(ROOT, 'output', 'cover.jpg');
const AUDIO_DIR = path.join(ROOT, 'assets', 'audio');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac']);

const MAX_DURATION_SECONDS = 60;
const requestedDuration = Number(process.env.QUOTE_VIDEO_DURATION_SECONDS || 15);
const DURATION_SECONDS = Math.min(requestedDuration, MAX_DURATION_SECONDS);
// The quote-card's entrance animation (mark -> divider -> quote -> footer)
// fully completes by ~2.5s (see templates/quote-card.css); grab the cover
// frame after that, but never past the end of a very short clip.
const COVER_TIMESTAMP_SECONDS = Math.min(2.5, Math.max(0.5, DURATION_SECONDS - 0.5));

function findAudioTrack() {
  if (!fs.existsSync(AUDIO_DIR)) return null;
  const file = fs
    .readdirSync(AUDIO_DIR)
    .find((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()));
  return file ? path.join(AUDIO_DIR, file) : null;
}

async function assertFfmpegAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch (err) {
    throw new Error(
      'ffmpeg binary not found on PATH. Install it (e.g. https://ffmpeg.org/download.html, ' +
        'or `choco install ffmpeg` on Windows / preinstalled on GitHub Actions ubuntu-latest).'
    );
  }
}

async function encodeVideo(audioPath) {
  fs.mkdirSync(path.dirname(FINAL_VIDEO_PATH), { recursive: true });

  const args = ['-y', '-i', RAW_VIDEO_PATH];

  if (audioPath) {
    args.push('-stream_loop', '-1', '-i', audioPath);
    args.push(
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-af', `afade=t=out:st=${Math.max(DURATION_SECONDS - 1, 0)}:d=1`,
      '-t', String(DURATION_SECONDS)
    );
  } else {
    args.push(
      '-map', '0:v:0',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-movflags', '+faststart',
      '-an',
      '-t', String(DURATION_SECONDS)
    );
  }

  args.push(FINAL_VIDEO_PATH);

  await execFileAsync('ffmpeg', args);
}

async function generateCover() {
  const args = [
    '-y',
    '-ss', String(COVER_TIMESTAMP_SECONDS),
    '-i', FINAL_VIDEO_PATH,
    '-frames:v', '1',
    '-q:v', '2',
    COVER_PATH,
  ];
  await execFileAsync('ffmpeg', args);
}

async function main() {
  if (!fs.existsSync(RAW_VIDEO_PATH)) {
    throw new Error(
      `${path.relative(ROOT, RAW_VIDEO_PATH)} not found. Run "npm run render" first.`
    );
  }

  await assertFfmpegAvailable();

  const audioPath = findAudioTrack();
  if (audioPath) {
    console.log(`Using background audio: ${path.relative(ROOT, audioPath)}`);
  } else {
    console.log('No background audio found in assets/audio/ — producing a silent video.');
  }

  await encodeVideo(audioPath);
  await generateCover();

  console.log(`Encoded final video -> ${path.relative(ROOT, FINAL_VIDEO_PATH)}`);
  console.log(`Generated cover thumbnail -> ${path.relative(ROOT, COVER_PATH)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('build-video.js failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
