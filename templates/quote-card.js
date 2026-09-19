(function () {
  var params = new URLSearchParams(window.location.search);
  var quote = params.get('quote') || 'Wealth is built one disciplined decision at a time.';
  var handle = params.get('handle') || '@filterfunds';
  var website = params.get('website') || 'filterfunds.com';

  var quoteEl = document.getElementById('quote');
  var handleEl = document.getElementById('handle');
  var websiteEl = document.getElementById('website');

  // Use textContent (not innerHTML) so quote text can never inject markup.
  quoteEl.textContent = '\u201C' + quote.trim() + '\u201D';
  handleEl.textContent = handle;
  websiteEl.textContent = website;

  // Auto-shrink font size for longer quotes so they still fit on one card.
  var length = quote.trim().length;
  var fontSize = 76;
  if (length > 140) {
    fontSize = 52;
  } else if (length > 100) {
    fontSize = 60;
  } else if (length > 70) {
    fontSize = 68;
  }
  quoteEl.style.fontSize = fontSize + 'px';

  // Signal to the renderer (Playwright) that content is ready to be captured.
  window.__QUOTE_CARD_READY__ = true;
})();
