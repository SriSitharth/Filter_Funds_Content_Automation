#!/usr/bin/env node
/**
 * scripts/publish-instagram-story.js
 *
 * Publishes today's quote cover image as an Instagram Story, using the public
 * cover URL from content/pending-followup.json (or COVER_URL env override).
 *
 * Required env vars:
 *   IG_ACCESS_TOKEN
 *   IG_USER_ID
 */

require('dotenv').config();
const { readPending } = require('./lib/pending-followup');

const GRAPH_VERSION = process.env.IG_GRAPH_VERSION || 'v21.0';
const GRAPH_HOST = 'https://graph.instagram.com';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

async function instagramRequest(pathname, params, method = 'GET') {
  const accessToken = requireEnv('IG_ACCESS_TOKEN');
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}${pathname}`);

  let res;
  if (method === 'GET') {
    Object.entries({ ...params, access_token: accessToken }).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    res = await fetch(url.toString());
  } else {
    const body = new URLSearchParams();
    Object.entries({ ...params, access_token: accessToken }).forEach(([key, value]) => {
      if (value !== undefined && value !== null) body.set(key, value);
    });
    res = await fetch(url.toString(), { method, body });
  }

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `Instagram API ${method} ${pathname} failed: ${JSON.stringify(data.error || data)}`
    );
  }
  return data;
}

async function waitForContainerReady(containerId) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const data = await instagramRequest(`/${containerId}`, { fields: 'status_code' }, 'GET');
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new Error(`Instagram Story container failed with status ${data.status_code}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Timed out waiting for Instagram Story processing.');
}

async function main() {
  const pending = readPending();
  const coverUrl = process.env.COVER_URL || pending?.coverUrl;
  if (!coverUrl) {
    throw new Error(
      'No cover URL available. Run the morning pipeline first (content/pending-followup.json) ' +
        'or set COVER_URL.'
    );
  }

  const igUserId = requireEnv('IG_USER_ID');

  console.log(`Creating Instagram Story from cover: ${coverUrl}`);
  const create = await instagramRequest(
    `/${igUserId}/media`,
    {
      media_type: 'STORIES',
      image_url: coverUrl,
    },
    'POST'
  );

  const containerId = create.id;
  console.log('Waiting for Story container...');
  await waitForContainerReady(containerId);

  const published = await instagramRequest(
    `/${igUserId}/media_publish`,
    { creation_id: containerId },
    'POST'
  );

  console.log(`Published Instagram Story: media id ${published.id}`);
  return { mediaId: published.id, coverUrl };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('publish-instagram-story.js failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
