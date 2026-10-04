#!/usr/bin/env node
/**
 * scripts/run-daily.js
 *
 * Orchestrates the morning pipeline:
 *   1. generate-content.js
 *   2. render-design.js
 *   3. build-video.js
 *   4. upload public GitHub Release assets (video + cover)
 *   5. publish-youtube.js (YouTube Short)
 *   6. publish-instagram.js (Instagram Reel)
 *   7. write content/pending-followup.json for the +12h Story + YouTube post
 */

require('dotenv').config();
const path = require('path');
const { publishAssetsToGithubRelease } = require('./lib/github-assets');
const {
  buildPendingFromContent,
  writePending,
} = require('./lib/pending-followup');

const ROOT = path.join(__dirname, '..');
const CONTENT_PATH = path.join(ROOT, 'output', 'current-content.json');
const VIDEO_PATH = path.join(ROOT, 'output', 'video.mp4');
const COVER_PATH = path.join(ROOT, 'output', 'cover.jpg');

async function runRequiredStep(name, modulePath) {
  console.log(`\n=== ${name} ===`);
  try {
    await require(modulePath).main();
  } catch (err) {
    console.error(`Fatal: "${name}" failed, aborting run.\n`, err);
    process.exit(1);
  }
}

async function runPublishStep(name, modulePath) {
  console.log(`\n=== ${name} ===`);
  try {
    const result = await require(modulePath).main();
    return { name, ok: true, result };
  } catch (err) {
    console.error(`"${name}" failed:\n`, err);
    return { name, ok: false, error: err };
  }
}

function isInstagramConfigured() {
  return Boolean(process.env.IG_ACCESS_TOKEN && process.env.IG_USER_ID);
}

function isGitHubConfigured() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY);
}

async function main() {
  const generateContent = require('./generate-content');

  console.log('\n=== generate-content ===');
  let record;
  try {
    record = await generateContent.generate();
  } catch (err) {
    console.error('Fatal: "generate-content" failed, aborting run.\n', err);
    process.exit(1);
  }

  await runRequiredStep('render-design', './render-design');
  await runRequiredStep('build-video', './build-video');

  generateContent.recordHistory(record);

  // Upload public assets once so Reel + evening Story/YouTube can share URLs.
  let assets = { videoUrl: null, coverUrl: null, releaseTag: null };
  if (isGitHubConfigured()) {
    console.log('\n=== upload-public-assets ===');
    const dateTag = `post-${record.date || new Date().toISOString().slice(0, 10)}`;
    try {
      assets = await publishAssetsToGithubRelease(dateTag, VIDEO_PATH, COVER_PATH);
      console.log(`Public video URL: ${assets.videoUrl}`);
      console.log(`Public cover URL: ${assets.coverUrl}`);
    } catch (err) {
      console.error('Fatal: public asset upload failed, aborting run.\n', err);
      process.exit(1);
    }
  } else {
    console.warn(
      '\n=== upload-public-assets ===\nSkipping: GITHUB_TOKEN / GITHUB_REPOSITORY not set. ' +
        'Instagram Reel/Story and the +12h follow-up need public media URLs.'
    );
  }

  const publishResults = [];
  publishResults.push(await runPublishStep('publish-youtube', './publish-youtube'));

  if (isInstagramConfigured()) {
    if (assets.videoUrl) {
      process.env.VIDEO_URL = assets.videoUrl;
      if (assets.coverUrl) process.env.COVER_URL = assets.coverUrl;
      if (assets.releaseTag) process.env.RELEASE_TAG = assets.releaseTag;
    }
    publishResults.push(await runPublishStep('publish-instagram', './publish-instagram'));
  } else {
    console.log('\n=== publish-instagram ===');
    console.log('Skipping: IG_ACCESS_TOKEN / IG_USER_ID not set.');
    publishResults.push({
      name: 'publish-instagram',
      ok: true,
      result: 'skipped (not configured)',
    });
  }

  if (assets.videoUrl && assets.coverUrl) {
    const pendingPath = writePending(
      buildPendingFromContent(record, {
        videoUrl: assets.videoUrl,
        coverUrl: assets.coverUrl,
        releaseTag: assets.releaseTag,
      })
    );
    console.log(`\nQueued +12h follow-up -> ${path.relative(ROOT, pendingPath)}`);
  } else {
    console.warn(
      '\nCould not queue +12h follow-up (missing public video/cover URLs).'
    );
  }

  console.log('\n=== Summary ===');
  let hasFailure = false;
  for (const result of publishResults) {
    if (result.ok) {
      console.log(`${result.name}: OK`, result.result || '');
    } else {
      console.log(`${result.name}: FAILED - ${result.error.message}`);
      hasFailure = true;
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('run-daily.js failed unexpectedly:', err);
  process.exit(1);
});
