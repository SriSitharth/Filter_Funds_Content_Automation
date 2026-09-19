#!/usr/bin/env node
/**
 * scripts/run-daily.js
 *
 * Orchestrates the full daily pipeline:
 *   1. generate-content.js  - Claude generates today's quote/post JSON
 *   2. render-design.js     - Playwright renders the branded quote-card video
 *   3. build-video.js       - ffmpeg encodes the final MP4 + cover thumbnail
 *   4. publish-youtube.js   - uploads as a YouTube Short
 *   5. publish-instagram.js - uploads as an Instagram Reel
 *
 * Steps 1-3 are required precursors: if any fails, the whole run aborts
 * (there's nothing to publish yet). Steps 4-5 are each run independently so
 * a failure on one platform doesn't prevent publishing on the other; the
 * process exits non-zero if either publish step failed, so CI surfaces the
 * failure, but both are always attempted.
 */

require('dotenv').config();

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

  // Only now do we know there's an actual postable video, so only now do we
  // mark the quote as used — a render/build failure above leaves the quote
  // available to be generated again on the next run instead of wasting it.
  generateContent.recordHistory(record);

  const publishResults = [];
  publishResults.push(await runPublishStep('publish-youtube', './publish-youtube'));
  publishResults.push(await runPublishStep('publish-instagram', './publish-instagram'));

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
