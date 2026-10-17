// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One n8n instance: its address and an API key (Settings → n8n API).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

// The port n8n listens on by default: added to a bare host typed without one.
export const DEFAULT_PORT = 5678;

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  poll_interval: '60',
  allow_toggle: false,
  language: 'fr',
};

// Pages of the n8n editor and API roots: a URL copied from the browser points
// at one of them, the instance lives at the root (or under N8N_PATH).
const INTERFACE_PATH =
  /\/(home|workflow|workflows|executions|projects|settings|signin|signup|credentials|templates|variables|api|rest|webhook|webhook-test|webhook-waiting|form|form-test)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 5678 added), `host:port`, or a URL copied from the
 * browser (`https://n8n.example.com/home/workflows`). HTTP by default for a
 * bare host. A sub-path (N8N_PATH behind a reverse proxy) is kept.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** An n8n Cloud instance (`<name>.app.n8n.cloud`). */
export const isCloud = (url) => /^https?:\/\/([a-z0-9-]+\.)+n8n\.cloud(:\d+)?(\/|$)/i.test(url);

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  const typed = text('url');
  return {
    // null: nothing typed, or not understood (see hub.connectionStatus).
    url: typed ? parseServerUrl(typed) : null,
    urlTyped: Boolean(typed),
    // A pasted key often carries a trailing space or new line.
    apiKey: text('api_key'),
    pollIntervalMs: Number(pollInterval) * 1000,
    allowToggle: source.allow_toggle === true || source.allow_toggle === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
