# Filter Funds — Daily Content Automation

Generates a daily motivational finance post, renders it as a branded short
vertical video (no Canva app involved — the design is rendered in code), and
publishes it as a **YouTube Short** and an **Instagram Reel** every day at
**9:00 AM IST**, via a scheduled GitHub Actions workflow.

## Pipeline

1. `scripts/generate-content.js` — OpenAI generates the quote, YouTube
   title/description, Instagram caption, and hashtags, following the rules in
   [`CLAUDE.md`](CLAUDE.md) and avoiding repeats from
   [`content/history.json`](content/history.json). If OpenAI is missing or
   fails, it falls back to Anthropic (Claude) automatically.
2. `scripts/render-design.js` — Playwright renders
   [`templates/quote-card.html`](templates/quote-card.html) (a minimal
   black/white/gray animated quote card) and records it as a video.
3. `scripts/build-video.js` — ffmpeg encodes the final `output/video.mp4`
   (1080x1920, ≤60s) and a `output/cover.jpg` thumbnail, optionally muxing in
   a background track from `assets/audio/`.
4. `scripts/publish-youtube.js` — uploads the video as a YouTube Short.
5. `scripts/publish-instagram.js` — hosts the video as a public GitHub
   Release asset, then publishes it as an Instagram Reel via the Graph API.
6. `scripts/run-daily.js` — runs all of the above in order; a failure in one
   publish step does not block the other. Also writes
   `content/pending-followup.json` for the evening job.
7. **+12 hours later:** `scripts/run-followup.js` posts the **same quote** as
   an Instagram Story (cover image) and a regular YouTube video (not a Short).

Morning workflow: [`.github/workflows/daily-post.yml`](.github/workflows/daily-post.yml)
at `30 3 * * *` UTC (9:00 AM IST).  
Follow-up workflow: [`.github/workflows/followup-post.yml`](.github/workflows/followup-post.yml)
at `30 15 * * *` UTC (9:00 PM IST). GitHub Actions cron is best-effort.

## One-time setup

You need four things before the automation can run: an AI API key (OpenAI
preferred, Anthropic as fallback), a YouTube OAuth refresh token, an Instagram
access token, and a GitHub repo with those stored as secrets. Do these once,
locally.

### 0. Prerequisites

- Node.js 20+
- [ffmpeg](https://ffmpeg.org/download.html) on your PATH for local testing
  (the GitHub Actions workflow installs it itself via `apt-get`)
- `git`, and the [GitHub CLI](https://cli.github.com/) (`gh`) if you want to
  create the repo from the terminal

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

### 1. AI API keys (OpenAI + Anthropic fallback)

1. Preferred: create a key at [platform.openai.com](https://platform.openai.com/api-keys)
   and put it in `.env` as `OPENAI_API_KEY`.
2. Fallback: create a key at [console.anthropic.com](https://console.anthropic.com/)
   and put it in `.env` as `ANTHROPIC_API_KEY`. Used automatically when OpenAI
   is missing or the OpenAI call fails.

Test content generation locally:

```bash
npm run generate
```

This writes `output/current-content.json` and appends to
`content/history.json`.

### 2. YouTube (Google Cloud)

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **YouTube Data API v3** (APIs & Services → Library).
3. Configure the OAuth consent screen (External is fine; you don't need to
   publish/verify it — just add the Google account that manages the
   `@FilterFunds` channel as a **test user**).
4. Create an **OAuth client ID** of type **Desktop app** (APIs & Services →
   Credentials). Note the Client ID and Client secret.
5. Put them in `.env` as `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`, then
   run the one-time local auth flow:

   ```bash
   npm run youtube:auth
   ```

   This opens a URL for you to sign in with the channel's Google account and
   prints a `YOUTUBE_REFRESH_TOKEN` — save that too.

6. Test locally once you have a rendered video (see step 4 below):

   ```bash
   npm run publish:youtube
   ```

Notes:
- Default API quota (10,000 units/day) allows roughly 6 uploads/day
  (`videos.insert` costs 1,600 units) — plenty for one post a day.
- Custom thumbnails (`output/cover.jpg`) require a phone-verified channel; if
  that fails the script logs a warning and continues without one.

### 3. Instagram (Meta)

This uses the newer **Instagram API with Instagram Login**, which doesn't
require linking a Facebook Page.

1. Make sure your Instagram account is a **Professional (Business or
   Creator)** account.
2. Create an app at [developers.facebook.com](https://developers.facebook.com/apps/).
3. Add the **Instagram** product to the app, and set it up for **Business
   Login for Instagram**.
4. Add your own Instagram account as a tester/admin of the app (Development
   Mode is fine for a single self-owned account — no App Review needed for
   this).
5. Complete the login flow once to authorize the app for scopes
   `instagram_business_basic` and `instagram_business_content_publish`, and
   generate a **long-lived access token** (Meta's token debugger / the
   `/access_token?grant_type=ig_exchange_token` endpoint extends a short-lived
   token to ~60 days — you'll need to refresh it periodically; see
   [Meta's long-lived token docs](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/#step-4--generate-a-long-lived-token)).
6. Get your Instagram user id: `GET https://graph.instagram.com/v21.0/me?fields=id,username&access_token=...`.
7. Put the values in `.env` as `IG_ACCESS_TOKEN` and `IG_USER_ID`.

Note: Instagram will fetch the video from a public URL (see below), so this
step can only be tested end-to-end once the repo is on GitHub.

### 4. GitHub repo (hosting + scheduling)

The Instagram publish step needs the exported video reachable at a public
HTTPS URL. Rather than paying for cloud storage, it uploads `video.mp4` as a
**GitHub Release** asset and uses that URL. This means:

> **The repository must be public.** Private-repo release assets require an
> auth token to download, which Instagram's servers don't have. Since these
> are public quote videos meant to be posted anyway, this is a reasonable
> trade-off — but if you'd rather keep the repo private, swap
> `scripts/publish-instagram.js`'s hosting step for a small cloud storage
> bucket (S3 / Cloudflare R2 / GCS) with public read access instead.

Steps:

```bash
git init   # if not already a repo
gh repo create filter-funds-content --public --source=. --remote=origin
git add .
git commit -m "Initial commit: Filter Funds daily automation"
git push -u origin main
```

Then add these **Repository Secrets** (Settings → Secrets and variables →
Actions → New repository secret):

| Secret | Value |
| --- | --- |
| `OPENAI_API_KEY` | from step 1 (preferred) |
| `ANTHROPIC_API_KEY` | from step 1 (fallback) |
| `OPENAI_MODEL` | optional OpenAI model override (default `gpt-6-luna`) |
| `CLAUDE_MODEL` | optional Claude model override |
| `YOUTUBE_CLIENT_ID` | from step 2 |
| `YOUTUBE_CLIENT_SECRET` | from step 2 |
| `YOUTUBE_REFRESH_TOKEN` | from step 2 |
| `IG_ACCESS_TOKEN` | from step 3 |
| `IG_USER_ID` | from step 3 |

Do **not** create secrets named `GITHUB_TOKEN` or `GITHUB_REPOSITORY` —
GitHub rejects custom secret names starting with `GITHUB_`. The workflow
already injects the built-in Actions token (`github.token`) and
`github.repository` automatically. Those two values are only needed in
local `.env` for testing `npm run publish:instagram`.

### 5. Test the whole pipeline

Trigger a manual run before trusting the 9:00 AM cron:

```bash
gh workflow run daily-post.yml
gh run watch
```

Check the run's artifacts (`current-content.json`, `video.mp4`, `cover.jpg`)
and confirm the post landed on both YouTube and Instagram. Once you've
verified it end to end, the `30 3 * * *` UTC (9:00 AM IST) schedule takes
over automatically.

## Local testing of individual steps

```bash
npm run generate           # Claude content -> output/current-content.json
npm run render              # Playwright -> output/raw.webm
npm run build-video         # ffmpeg -> output/video.mp4, output/cover.jpg
npm run publish:youtube     # upload to YouTube (needs YOUTUBE_* env vars)
npm run publish:instagram   # upload to Instagram (needs IG_*/GITHUB_* env vars)
npm run run-daily           # the whole pipeline, same as the scheduled job
```

## Customizing

- **Design:** edit [`templates/quote-card.html`](templates/quote-card.html) /
  `quote-card.css` — colors, fonts, and animation live there. Keep to the
  brand palette in [`config/brand.json`](config/brand.json) (black / white /
  gray, no teal).
- **Video length:** set `QUOTE_VIDEO_DURATION_SECONDS` (default 15, capped at
  60).
- **Background music:** drop royalty-free tracks in `assets/audio/` — the build
  rotates through them by date. `ambient-bed.mp3` is only a fallback if nothing
  else is there. CI fails if audio is missing (set `ALLOW_SILENT_VIDEO=true`
  only if you intentionally want silence).
- **Posting time:** edit the `cron` line in
  `.github/workflows/daily-post.yml` (values are in UTC).
- **YouTube visibility:** set `YOUTUBE_PRIVACY_STATUS` secret to `public`,
  `unlisted`, or `private` (defaults to `public`).

## Troubleshooting

- **Instagram publish fails with a permissions error:** your access token
  may have expired (long-lived tokens last ~60 days) or the app may need App
  Review if you add more Instagram accounts later. Regenerate the token
  following step 3 above.
- **YouTube upload fails with quota errors:** check
  [Google Cloud Console quotas](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas)
  — one upload a day should never come close to the default limit.
- **ffmpeg not found:** for local runs, install it and ensure it's on PATH;
  the GitHub Actions workflow installs it itself via `apt-get`, so this
  shouldn't happen in CI.
