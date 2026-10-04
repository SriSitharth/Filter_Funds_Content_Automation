/**
 * Shared brand link helpers for captions/descriptions.
 */

const WEBSITE = 'www.filterfunds.com';
const WEBSITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?filterfunds\.com/i;

function ensureWebsiteLine(text) {
  const body = (text || '').trim();
  if (WEBSITE_PATTERN.test(body)) {
    return body;
  }
  if (!body) return WEBSITE;
  return `${body}\n\n${WEBSITE}`;
}

module.exports = {
  WEBSITE,
  ensureWebsiteLine,
};
