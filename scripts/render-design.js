#!/usr/bin/env node
/**
 * scripts/render-design.js
 *
 * Renders templates/quote-card.html with today's quote using Playwright,
 * recording the on-page animation as a video. This replaces the "design in
 * Canva" step with a fully code-driven, license-free renderer.
 *
 * Input:  output/current-content.json (produced by generate-content.js)
 * Output: output/raw.webm
 *
 * Optional env vars:
 *   QUOTE_VIDEO_DURATION_SECONDS (default: 15)
 *   QUOTE_TEMPLATE — "dark" | "light" | "alternate" (default: alternate by date)
 */

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CONTENT_PATH = path.join(ROOT, 'output', 'current-content.json');
const TEMPLATES = {
  dark: path.join(ROOT, 'templates', 'quote-card.html'),
  light: path.join(ROOT, 'templates', 'quote-card-light.html'),
};
const RAW_VIDEO_PATH = path.join(ROOT, 'output', 'raw.webm');
const BRAND_CONFIG_PATH = path.join(ROOT, 'config', 'brand.json');

const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION_SECONDS = Number(process.env.QUOTE_VIDEO_DURATION_SECONDS || 15);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveTemplateName(content) {
  const requested = (process.env.QUOTE_TEMPLATE || 'alternate').toLowerCase().trim();
  if (requested === 'dark' || requested === 'light') return requested;

  // Alternate by calendar date so consecutive days get different looks.
  const dateStr = content.date || new Date().toISOString().slice(0, 10);
  const dayNum = Number(dateStr.replace(/-/g, '')) || 0;
  return dayNum % 2 === 0 ? 'light' : 'dark';
}

async function main() {
  if (!fs.existsSync(CONTENT_PATH)) {
    throw new Error(
      `${path.relative(ROOT, CONTENT_PATH)} not found. Run "npm run generate" first.`
    );
  }

  const content = readJson(CONTENT_PATH);
  const templateName = resolveTemplateName(content);
  const templatePath = TEMPLATES[templateName];

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const brand = fs.existsSync(BRAND_CONFIG_PATH) ? readJson(BRAND_CONFIG_PATH) : {};

  const instagramHandle = brand.instagram || '@filterfunds';
  const website = (brand.website || 'https://filterfunds.com').replace(/^https?:\/\//, '');

  const fileUrl = new URL(pathToFileURL(templatePath).href);
  fileUrl.searchParams.set('quote', content.quote);
  fileUrl.searchParams.set('handle', instagramHandle);
  fileUrl.searchParams.set('website', website);

  const tmpVideoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-quote-video-'));

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      recordVideo: { dir: tmpVideoDir, size: { width: WIDTH, height: HEIGHT } },
    });
    const page = await context.newPage();

    await page.goto(fileUrl.href);
    await page.waitForFunction(() => window.__QUOTE_CARD_READY__ === true, {
      timeout: 5000,
    });

    // Hold on the animated card for the full clip duration so the recorded
    // video has the entrance animation plus the slow ambient zoom throughout.
    await page.waitForTimeout(DURATION_SECONDS * 1000);

    await page.close();
    const recordedPath = await page.video().path();
    await context.close();

    fs.mkdirSync(path.dirname(RAW_VIDEO_PATH), { recursive: true });
    fs.copyFileSync(recordedPath, RAW_VIDEO_PATH);
  } finally {
    await browser.close();
    fs.rmSync(tmpVideoDir, { recursive: true, force: true });
  }

  console.log(
    `Rendered ${DURATION_SECONDS}s quote-card video (${templateName}) -> ${path.relative(ROOT, RAW_VIDEO_PATH)}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('render-design.js failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
