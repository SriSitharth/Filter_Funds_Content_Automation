#!/usr/bin/env node
/**
 * scripts/run-followup.js
 *
 * +12h follow-up for the same daily quote:
 *   1. Instagram Story (quote cover image)
 *   2. YouTube regular video post (same video, not a Short)
 *
 * Reads content/pending-followup.json written by the morning run-daily job.
 */

require('dotenv').config();
const {
  readPending,
  writePending,
  clearPending,
} = require('./lib/pending-followup');

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

function isYouTubeConfigured() {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID &&
      process.env.YOUTUBE_CLIENT_SECRET &&
      process.env.YOUTUBE_REFRESH_TOKEN
  );
}

async function main() {
  const pending = readPending();
  if (!pending || pending.status !== 'pending') {
    console.log('No pending follow-up found. Nothing to do.');
    return;
  }

  console.log(`Follow-up for ${pending.date}: "${pending.quote}"`);
  console.log(`Scheduled for: ${pending.followUpAt}`);

  const results = [];

  if (isInstagramConfigured()) {
    if (!pending.coverUrl) {
      console.warn('Skipping Instagram Story: no coverUrl in pending follow-up.');
      results.push({
        name: 'publish-instagram-story',
        ok: false,
        error: new Error('missing coverUrl'),
      });
    } else {
      results.push(await runPublishStep('publish-instagram-story', './publish-instagram-story'));
    }
  } else {
    console.log('\n=== publish-instagram-story ===');
    console.log('Skipping: IG credentials not set.');
    results.push({ name: 'publish-instagram-story', ok: true, result: 'skipped' });
  }

  if (isYouTubeConfigured()) {
    results.push(await runPublishStep('publish-youtube-followup', './publish-youtube-followup'));
  } else {
    console.log('\n=== publish-youtube-followup ===');
    console.log('Skipping: YouTube credentials not set.');
    results.push({ name: 'publish-youtube-followup', ok: true, result: 'skipped' });
  }

  console.log('\n=== Summary ===');
  let hasFailure = false;
  for (const result of results) {
    if (result.ok) {
      console.log(`${result.name}: OK`, result.result || '');
    } else {
      console.log(`${result.name}: FAILED - ${result.error.message}`);
      hasFailure = true;
    }
  }

  if (!hasFailure) {
    clearPending();
    console.log('Cleared content/pending-followup.json');
  } else {
    writePending({
      ...pending,
      status: 'pending',
      lastAttemptAt: new Date().toISOString(),
      lastError: results
        .filter((r) => !r.ok)
        .map((r) => `${r.name}: ${r.error.message}`)
        .join('; '),
    });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('run-followup.js failed unexpectedly:', err);
  process.exit(1);
});
