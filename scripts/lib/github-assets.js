/**
 * Shared GitHub Release asset hosting for public Instagram media URLs.
 */

const fs = require('fs');

const GITHUB_API = 'https://api.github.com';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

async function githubRequest(pathname, { method = 'GET', headers = {}, body } = {}) {
  const token = requireEnv('GITHUB_TOKEN');
  const res = await fetch(`${GITHUB_API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    },
    body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${pathname} failed: ${res.status} ${text}`);
  }
  return data;
}

async function getOrCreateRelease(repo, tagName) {
  try {
    return await githubRequest(`/repos/${repo}/releases/tags/${tagName}`);
  } catch (err) {
    return githubRequest(`/repos/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tagName,
        name: `Filter Funds post — ${tagName}`,
        body: 'Automated daily content release (hosts media publicly for Instagram publishing).',
        prerelease: false,
      }),
    });
  }
}

async function uploadReleaseAsset(release, fileName, filePath, contentType) {
  const token = requireEnv('GITHUB_TOKEN');
  const repo = requireEnv('GITHUB_REPOSITORY');
  const fileBuffer = fs.readFileSync(filePath);
  const uploadUrl = release.upload_url.replace(
    '{?name,label}',
    `?name=${encodeURIComponent(fileName)}`
  );

  const doUpload = () =>
    fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': contentType,
        'Content-Length': String(fileBuffer.length),
      },
      body: fileBuffer,
    });

  let res = await doUpload();

  if (res.status === 422) {
    const assets = await githubRequest(`/repos/${repo}/releases/${release.id}/assets`);
    const match = assets.find((asset) => asset.name === fileName);
    if (match) {
      await githubRequest(`/repos/${repo}/releases/assets/${match.id}`, {
        method: 'DELETE',
      });
    }
    res = await doUpload();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub asset upload failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function publishAssetsToGithubRelease(dateTag, videoPath, coverPath) {
  const repo = requireEnv('GITHUB_REPOSITORY');
  const release = await getOrCreateRelease(repo, dateTag);

  const videoName = `filter-funds-${dateTag}.mp4`;
  const videoAsset = await uploadReleaseAsset(release, videoName, videoPath, 'video/mp4');

  let coverUrl = null;
  if (coverPath && fs.existsSync(coverPath)) {
    const coverName = `filter-funds-${dateTag}-cover.jpg`;
    const coverAsset = await uploadReleaseAsset(release, coverName, coverPath, 'image/jpeg');
    coverUrl = coverAsset.browser_download_url;
  }

  return {
    releaseTag: dateTag,
    videoUrl: videoAsset.browser_download_url,
    coverUrl,
  };
}

module.exports = {
  publishAssetsToGithubRelease,
};
