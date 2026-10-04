#!/usr/bin/env node
/**
 * scripts/build-video.js
 *
 * Encodes output/raw.webm (from render-design.js) into a final MP4 suitable
 * for YouTube Shorts / Instagram Reels using ffmpeg, muxing in a background
 * track from assets/audio/, and produces a cover thumbnail.
 *
 * Input:  output/raw.webm
 * Output: output/video.mp4, output/cover.jpg
 *
 * Requires the `ffmpeg` binary to be available on PATH.
 *
 * Audio:
 *   Drop a royalty-free .mp3/.wav/.m4a/.aac in assets/audio/.
 *   In GitHub Actions (GITHUB_ACTIONS=true), missing audio fails the build
 *   unless ALLOW_SILENT_VIDEO=true. Locally, missing audio warns and continues
 *   unless REQUIRE_AUDIO=true.
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
const CONTENT_PATH = path.join(ROOT, 'output', 'current-content.json');
const AUDIO_DIR = path.join(ROOT, 'assets', 'audio');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac']);
const FALLBACK_AUDIO = 'ambient-bed.mp3';

const MAX_DURATION_SECONDS = 60;
const requestedDuration = Number(process.env.QUOTE_VIDEO_DURATION_SECONDS || 15);
const DURATION_SECONDS = Math.min(requestedDuration, MAX_DURATION_SECONDS);
// The quote-card's entrance animation (mark -> divider -> quote -> footer)
// fully completes by ~2.5s (see templates/quote-card.css); grab the cover
// frame after that, but never past the end of a very short clip.
const COVER_TIMESTAMP_SECONDS = Math.min(2.5, Math.max(0.5, DURATION_SECONDS - 0.5));

function getRotationSeed() {
  // Optional override for testing: AUDIO_ROTATION_INDEX=0
  if (process.env.AUDIO_ROTATION_INDEX !== undefined && process.env.AUDIO_ROTATION_INDEX !== '') {
    return Number(process.env.AUDIO_ROTATION_INDEX) || 0;
  }

  try {
    const content = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
    if (content.date) {
      return Number(String(content.date).replace(/-/g, '')) || 0;
    }
  } catch (_) {
    // Fall through to today.
  }

  return Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')) || 0;
}

function findAudioTrack() {
  if (!fs.existsSync(AUDIO_DIR)) return null;
  const files = fs
    .readdirSync(AUDIO_DIR)
    .filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (files.length === 0) return null;

  // Rotate through custom tracks by date; ambient-bed.mp3 is last-resort only.
  const custom = files.filter((name) => name !== FALLBACK_AUDIO).sort();
  if (custom.length > 0) {
    const index = Math.abs(getRotationSeed()) % custom.length;
    return path.join(AUDIO_DIR, custom[index]);
  }

  return files.includes(FALLBACK_AUDIO)
    ? path.join(AUDIO_DIR, FALLBACK_AUDIO)
    : null;
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
  const requireAudio =
    process.env.REQUIRE_AUDIO === 'true' ||
    (process.env.GITHUB_ACTIONS === 'true' && process.env.ALLOW_SILENT_VIDEO !== 'true');

  if (audioPath) {
    console.log(`Using background audio: ${path.relative(ROOT, audioPath)}`);
  } else if (requireAudio) {
    throw new Error(
      'No background audio found in assets/audio/. Add a royalty-free .mp3/.wav/.m4a/.aac ' +
        '(see assets/audio/README.md), or set ALLOW_SILENT_VIDEO=true to allow a silent export.'
    );
  } else {
    console.warn(
      'No background audio found in assets/audio/ — producing a silent video. ' +
        'Add a track there so Instagram/YouTube posts are not silent.'
    );
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
