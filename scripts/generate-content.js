#!/usr/bin/env node
/**
 * scripts/generate-content.js
 *
 * Generates today's Filter Funds post using the Claude API, following the
 * brand/content rules defined in CLAUDE.md. Checks content/history.json to
 * avoid repeating previous quotes, writes the result to
 * output/current-content.json, and appends the new quote to history.
 *
 * Usage:
 *   node scripts/generate-content.js
 *
 * Required env vars (see .env.example):
 *   ANTHROPIC_API_KEY
 * Optional:
 *   CLAUDE_MODEL (defaults to a recent Claude Sonnet model)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.join(__dirname, '..');
const CLAUDE_MD_PATH = path.join(ROOT, 'CLAUDE.md');
const HISTORY_PATH = path.join(ROOT, 'content', 'history.json');
const OUTPUT_PATH = path.join(ROOT, 'output', 'current-content.json');

// Update this if your account has access to a newer model.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_GENERATION_ATTEMPTS = 3;
const REQUIRED_FIELDS = [
  'quote',
  'youtubeTitle',
  'youtubeDescription',
  'instagramCaption',
  'hashtags',
];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function extractJson(text) {
  // Claude may wrap JSON in a ```json ... ``` fence; strip that if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  return JSON.parse(candidate.trim());
}

function validateContent(content) {
  const missing = REQUIRED_FIELDS.filter((field) => !(field in content));
  if (missing.length > 0) {
    throw new Error(`Generated content missing fields: ${missing.join(', ')}`);
  }
  if (!Array.isArray(content.hashtags) || content.hashtags.length === 0) {
    throw new Error('Generated content "hashtags" must be a non-empty array');
  }
  if (typeof content.quote !== 'string' || content.quote.trim().length === 0) {
    throw new Error('Generated content "quote" must be a non-empty string');
  }
}

function isDuplicateQuote(quote, history) {
  const normalized = quote.trim().toLowerCase();
  return history.posts.some(
    (post) => (post.quote || '').trim().toLowerCase() === normalized
  );
}

async function generateContent({ anthropic, systemPrompt, recentQuotes, avoidQuote }) {
  const avoidList = recentQuotes.length
    ? `Previously used quotes (DO NOT repeat these or anything too similar):\n${recentQuotes
        .map((q) => `- ${q}`)
        .join('\n')}`
    : 'No previous quotes yet.';

  const retryNote = avoidQuote
    ? `\n\nIMPORTANT: Your previous attempt produced the quote "${avoidQuote}", which duplicates one already used. Generate a genuinely different quote this time.`
    : '';

  const userMessage = `Generate today's Filter Funds daily post.

${avoidList}${retryNote}

Return ONLY valid JSON matching the exact schema described in your instructions. Do not include any explanation, markdown formatting, or code fences — just the raw JSON object.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.9,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude response contained no text content');
  }

  return extractJson(textBlock.text);
}

// Generates today's content and writes output/current-content.json, but does
// NOT record the quote in history.json yet — callers that go on to render
// and build a video should only call recordHistory() once that succeeds, so
// a render/build failure doesn't permanently burn the quote (see recordHistory).
async function generate() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. See .env.example.');
  }

  const systemPrompt = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
  const history = readJson(HISTORY_PATH, { posts: [] });
  const recentQuotes = history.posts.slice(-60).map((post) => post.quote).filter(Boolean);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let content;
  let lastQuote;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    content = await generateContent({
      anthropic,
      systemPrompt,
      recentQuotes,
      avoidQuote: lastQuote,
    });
    validateContent(content);

    if (!isDuplicateQuote(content.quote, history)) {
      break;
    }

    console.warn(
      `Attempt ${attempt}: generated a duplicate quote ("${content.quote}"), retrying...`
    );
    lastQuote = content.quote;

    if (attempt === MAX_GENERATION_ATTEMPTS) {
      console.warn(
        'Reached max generation attempts with a duplicate quote; proceeding anyway.'
      );
    }
  }

  const now = new Date();
  const record = {
    date: now.toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    ...content,
  };

  writeJson(OUTPUT_PATH, record);

  console.log(`Generated content for ${record.date}:`);
  console.log(`  Quote: ${record.quote}`);
  console.log(`  Written to: ${path.relative(ROOT, OUTPUT_PATH)}`);

  return record;
}

// Marks a generated quote as used so it won't be repeated. Call this only
// once you actually have a postable video, not right after generation.
function recordHistory(record) {
  const history = readJson(HISTORY_PATH, { posts: [] });
  history.posts.push({
    date: record.date,
    quote: record.quote,
  });
  writeJson(HISTORY_PATH, history);
}

async function main() {
  const record = await generate();
  recordHistory(record);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('generate-content.js failed:', err);
    process.exit(1);
  });
}

module.exports = { main, generate, recordHistory };
