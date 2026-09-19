#!/usr/bin/env node
/**
 * scripts/get-youtube-refresh-token.js
 *
 * One-time local helper to mint a YouTube OAuth refresh token. Run this once
 * on your own machine (never in CI) after creating a "Desktop app" OAuth
 * client in Google Cloud Console. Prints the refresh token to store as the
 * YOUTUBE_REFRESH_TOKEN secret.
 *
 * Usage:
 *   npm run youtube:auth
 *
 * Required env vars:
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 */

require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

async function main() {
  const clientId = requireEnv('YOUTUBE_CLIENT_ID');
  const clientSecret = requireEnv('YOUTUBE_CLIENT_SECRET');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('Open this URL in your browser and sign in with the Google account');
  console.log('that owns/manages the Filter Funds YouTube channel:\n');
  console.log(authUrl);
  console.log('\nWaiting for the redirect back to localhost...');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
      if (requestUrl.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const authCode = requestUrl.searchParams.get('code');
      const error = requestUrl.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (authCode) {
        res.end('<h1>Authorization complete.</h1><p>You can close this tab and return to the terminal.</p>');
      } else {
        res.end(`<h1>Authorization failed</h1><p>${error || 'Unknown error'}</p>`);
      }

      server.close();
      if (authCode) {
        resolve(authCode);
      } else {
        reject(new Error(error || 'Authorization failed'));
      }
    });

    server.listen(PORT);
  });

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.warn(
      '\nNo refresh_token was returned. This usually means this Google account already ' +
        'granted consent before. Revoke access at https://myaccount.google.com/permissions ' +
        'and re-run this script.'
    );
    return;
  }

  console.log('\nSuccess! Store this value as the YOUTUBE_REFRESH_TOKEN secret:\n');
  console.log(tokens.refresh_token);
}

main().catch((err) => {
  console.error('get-youtube-refresh-token.js failed:', err);
  process.exit(1);
});
