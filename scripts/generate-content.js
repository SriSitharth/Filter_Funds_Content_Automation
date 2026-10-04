#!/usr/bin/env node
/**
 * scripts/generate-content.js
 *
 * Generates today's Filter Funds post using OpenAI first, falling back to
 * Anthropic (Claude) if OpenAI is missing or fails. Follows the brand/content
 * rules defined in CLAUDE.md. Checks content/history.json to avoid repeating
 * previous quotes, writes the result to output/current-content.json, and
 * appends the new quote to history.
 *
 * Usage:
 *   node scripts/generate-content.js
 *
 * Env vars (see .env.example):
 *   OPENAI_API_KEY     (preferred)
 *   ANTHROPIC_API_KEY  (fallback when OpenAI key is missing or the call fails)
 * Optional:
 *   OPENAI_MODEL (defaults to gpt-6-luna)
 *   CLAUDE_MODEL (defaults to a recent Claude Sonnet model)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const ROOT = path.join(__dirname, '..');
const CLAUDE_MD_PATH = path.join(ROOT, 'CLAUDE.md');
const HISTORY_PATH = path.join(ROOT, 'content', 'history.json');
const OUTPUT_PATH = path.join(ROOT, 'output', 'current-content.json');

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';
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
  // Models may wrap JSON in a ```json ... ``` fence; strip that if present.
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

function buildUserMessage(recentQuotes, avoidQuote) {
  const avoidList = recentQuotes.length
    ? `Previously used quotes (DO NOT repeat these or anything too similar):\n${recentQuotes
        .map((q) => `- ${q}`)
        .join('\n')}`
    : 'No previous quotes yet.';

  const retryNote = avoidQuote
    ? `\n\nIMPORTANT: Your previous attempt produced the quote "${avoidQuote}", which duplicates one already used. Generate a genuinely different quote this time.`
    : '';

  return `Generate today's Filter Funds daily post.

${avoidList}${retryNote}

Return ONLY valid JSON matching the exact schema described in your instructions. Do not include any explanation, markdown formatting, or code fences — just the raw JSON object.`;
}

async function generateWithAnthropic({ systemPrompt, recentQuotes, avoidQuote }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    temperature: 0.9,
    system: systemPrompt,
    messages: [{ role: 'user', content: buildUserMessage(recentQuotes, avoidQuote) }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude response contained no text content');
  }

  return extractJson(textBlock.text);
}

async function generateWithOpenAI({ systemPrompt, recentQuotes, avoidQuote }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    // Luna supports none/low; none is enough for short JSON quote posts.
    reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'none',
    max_completion_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserMessage(recentQuotes, avoidQuote) },
    ],
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI response contained no text content');
  }

  return extractJson(text);
}

async function generateContent({ systemPrompt, recentQuotes, avoidQuote }) {
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  if (!hasOpenAI && !hasAnthropic) {
    throw new Error(
      'Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set. See .env.example.'
    );
  }

  if (hasOpenAI) {
    try {
      const content = await generateWithOpenAI({
        systemPrompt,
        recentQuotes,
        avoidQuote,
      });
      return { content, provider: 'openai' };
    } catch (err) {
      if (!hasAnthropic) {
        throw err;
      }
      console.warn(
        `OpenAI failed (${err.message}); falling back to Anthropic...`
      );
    }
  } else {
    console.warn('OPENAI_API_KEY not set; using Anthropic...');
  }

  const content = await generateWithAnthropic({
    systemPrompt,
    recentQuotes,
    avoidQuote,
  });
  return { content, provider: 'anthropic' };
}

// Generates today's content and writes output/current-content.json, but does
// NOT record the quote in history.json yet — callers that go on to render
// and build a video should only call recordHistory() once that succeeds, so
// a render/build failure doesn't permanently burn the quote (see recordHistory).
async function generate() {
  const systemPrompt = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
  const history = readJson(HISTORY_PATH, { posts: [] });
  const recentQuotes = history.posts.slice(-60).map((post) => post.quote).filter(Boolean);

  let content;
  let provider;
  let lastQuote;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const result = await generateContent({
        systemPrompt,
        recentQuotes,
        avoidQuote: lastQuote,
      });
      content = result.content;
      provider = result.provider;
      validateContent(content);
    } catch (err) {
      if (attempt === MAX_GENERATION_ATTEMPTS) {
        throw err;
      }
      console.warn(`Attempt ${attempt}: ${err.message}, retrying...`);
      continue;
    }

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
    provider,
    ...content,
  };

  writeJson(OUTPUT_PATH, record);

  console.log(`Generated content for ${record.date} via ${provider}:`);
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
