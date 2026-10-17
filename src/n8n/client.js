// -----------------------------------------------------------------------------
// n8n client: the public REST API v1 of a self-hosted n8n (or n8n Cloud),
// authenticated by an API key in the `X-N8N-API-KEY` header, and the
// production webhooks of the workflows (no key: the path is the secret).
//
//   GET  /api/v1/workflows                       workflows (paged by cursor)
//   POST /api/v1/workflows/<id>/activate         publish a workflow
//   POST /api/v1/workflows/<id>/deactivate
//   GET  /api/v1/executions?status=&workflowId=  executions, newest first
//   GET  /api/v1/executions/<id>?includeData=true   the error of a failed run
//   POST /webhook/<path>                         starts a workflow
//
// The API has no "run this workflow" call: a workflow is started by its
// Webhook node. The default execution list leaves out the running executions:
// they are asked for with status=running (checked on n8n 2.43).
//
// Redirects are not followed: the key would be sent to wherever the address
// points (an http:// address redirected to https:// is reported instead).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TIMEOUT: 'timeout', // no answer in time
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // API key refused (or missing)
  SCOPE: 'scope', // the key lacks a scope, or the user a permission
  NOT_N8N: 'not_n8n', // something answers, not the n8n API (or the API is disabled)
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  NOT_FOUND: 'not_found', // the workflow no longer exists
  REFUSED: 'refused', // n8n refused a command, with its reason
  HTTP: 'http', // any other HTTP error
});

export class N8nError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status, reason }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'N8nError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// The workflow list carries the nodes of every workflow: a page of 100 large
// workflows stays well below this, the 256 MB of the sandbox too.
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
export const PAGE_SIZE = 100;
export const MAX_PAGES = 20;

async function readCapped(response, max) {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > max) {
    await response.body?.cancel();
    throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
  }
  if (!response.body) {
    return '';
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > max) {
      throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory n8n
 * (test/helpers/fakeN8n.js).
 * @returns {Promise<{ status: number, body: string, contentType: string }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 10_000, maxBytes = MAX_BODY_BYTES } = {},
) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body: await readCapped(response, maxBytes),
  };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

const dateOf = (value) => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};

/** One workflow of the API, normalized; null when it cannot be identified. */
export function normalizeWorkflow(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID.test(raw.id)) {
    return null;
  }
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((tag) => (typeof tag?.name === 'string' ? tag.name.trim() : '')).filter(Boolean)
    : [];
  return {
    id: raw.id,
    name: (typeof raw.name === 'string' && raw.name.trim()) || raw.id,
    active: raw.active === true,
    archived: raw.isArchived === true,
    tags: tags.join(', '),
  };
}

export const EXECUTION_STATUSES = new Set([
  'success',
  'error',
  'crashed',
  'canceled',
  'running',
  'waiting',
  'new',
]);

/** One execution of the API, normalized; null when it cannot be identified. */
export function normalizeExecution(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = typeof raw.id === 'number' ? String(raw.id) : raw.id;
  if (typeof id !== 'string' || !ID.test(id) || typeof raw.workflowId !== 'string') {
    return null;
  }
  return {
    id,
    workflowId: raw.workflowId,
    status: EXECUTION_STATUSES.has(raw.status) ? raw.status : 'new',
    mode: typeof raw.mode === 'string' ? raw.mode : '',
    startedAt: dateOf(raw.startedAt) ?? dateOf(raw.createdAt),
    stoppedAt: dateOf(raw.stoppedAt),
  };
}

/** The first line of an error message, without n8n's " [line 1]" suffix. */
export function shortError(message, max = 200) {
  if (typeof message !== 'string') {
    return '';
  }
  const line = message
    .split('\n')[0]
    .replace(/\s*\[line \d+\]\s*$/, '')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const parse = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/**
 * Turn what a user pasted in a scene into the URL of a production webhook of
 * this instance: a path (`gladys-hello`, `/webhook/gladys-hello`), or the
 * whole "Production URL" of the Webhook node (another host is accepted: n8n
 * may announce its public address, WEBHOOK_URL, behind a reverse proxy).
 * @returns {string|null}
 */
export function webhookUrl(base, raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.username || url.password || !/\/webhook(-test)?\//.test(url.pathname)) {
      return null;
    }
    return url.href;
  }
  const path = text.replace(/^\/+/, '').replace(/^webhook\//, '');
  if (!path || /\s/.test(path) || path.includes('..') || /[?#]/.test(path)) {
    return null;
  }
  return `${base}/webhook/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export class N8nClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} options.apiKey API key of a user of the instance
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, apiKey, request = httpRequest, timeoutMs = 10_000 }) {
    this.url = url;
    this.apiKey = apiKey;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async call(url, { method = 'GET', key = true, body, timeoutMs = this.timeoutMs } = {}) {
    const headers = key ? { 'X-N8N-API-KEY': this.apiKey, accept: 'application/json' } : {};
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    try {
      return await this.request(url, { method, headers, body, timeoutMs });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new N8nError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      if (err.name === 'TimeoutError' || code === 23) {
        throw new N8nError(ERROR_KINDS.TIMEOUT, 'No answer in time');
      }
      throw new N8nError(ERROR_KINDS.UNREACHABLE, String(code ?? err.name ?? err.message));
    }
  }

  check(response, { command = false } = {}) {
    const { status } = response;
    if (status >= 200 && status < 300) {
      return;
    }
    const reason = shortError(parse(response.body)?.message ?? '', 150);
    if (status === 401) {
      throw new N8nError(ERROR_KINDS.AUTH, `API key refused (HTTP ${status})`, { status });
    }
    if (status === 403) {
      throw new N8nError(ERROR_KINDS.SCOPE, `Forbidden (HTTP 403${reason ? `: ${reason}` : ''})`, {
        status,
        reason,
      });
    }
    if (status >= 300 && status < 400) {
      throw new N8nError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new N8nError(
        command ? ERROR_KINDS.NOT_FOUND : ERROR_KINDS.NOT_N8N,
        command ? 'Workflow not found (HTTP 404)' : 'No n8n API at this address (HTTP 404)',
        { status },
      );
    }
    if (command && status >= 400 && status < 500 && reason) {
      throw new N8nError(ERROR_KINDS.REFUSED, `Refused (HTTP ${status}: ${reason})`, {
        status,
        reason,
      });
    }
    throw new N8nError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
  }

  /** GET an API path, the JSON answer. */
  async get(path) {
    const response = await this.call(`${this.url}/api/v1${path}`);
    this.check(response);
    const data = parse(response.body);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new N8nError(ERROR_KINDS.NOT_N8N, 'The answer is not the n8n API');
    }
    return data;
  }

  /** Every page of a list, `MAX_PAGES` at most, or until `stop(item)`. */
  async list(
    path,
    { normalize, stop = () => false, maxPages = MAX_PAGES, limit = PAGE_SIZE } = {},
  ) {
    const items = [];
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams(path.query);
      query.set('limit', String(limit));
      if (cursor) {
        query.set('cursor', cursor);
      }
      const data = await this.get(`${path.path}?${query}`);
      if (!Array.isArray(data.data)) {
        throw new N8nError(ERROR_KINDS.NOT_N8N, 'The answer is not an n8n list');
      }
      let stopped = false;
      for (const raw of data.data) {
        const item = normalize(raw);
        if (!item) {
          continue;
        }
        if (stop(item)) {
          stopped = true;
          break;
        }
        items.push(item);
      }
      cursor = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null;
      if (stopped || !cursor) {
        break;
      }
    }
    return items;
  }

  /** The workflows of the instance (archived ones left out). */
  async workflows() {
    const workflows = await this.list(
      { path: '/workflows', query: { excludePinnedData: 'true' } },
      { normalize: normalizeWorkflow },
    );
    return workflows.filter((workflow) => !workflow.archived);
  }

  /**
   * Executions, newest first.
   * @param {object} [options]
   * @param {string} [options.status] success, error, running, waiting, canceled
   * @param {string} [options.workflowId]
   * @param {number} [options.maxPages]
   * @param {number} [options.limit] per page
   * @param {(execution: object) => boolean} [options.stop] ends the reading (excluded)
   */
  async executions({ status, workflowId, maxPages = 1, limit = PAGE_SIZE, stop } = {}) {
    const query = {};
    if (status) {
      query.status = status;
    }
    if (workflowId) {
      query.workflowId = workflowId;
    }
    return this.list(
      { path: '/executions', query },
      { normalize: normalizeExecution, stop, maxPages, limit },
    );
  }

  /** The error of a failed execution: `{ message, node }`, empty strings when unknown. */
  async executionError(id) {
    const data = await this.get(`/executions/${encodeURIComponent(id)}?includeData=true`);
    const result = data?.data?.resultData ?? {};
    return {
      message: shortError(result.error?.message ?? result.error?.description ?? ''),
      node:
        typeof result.lastNodeExecuted === 'string' ? result.lastNodeExecuted.slice(0, 100) : '',
    };
  }

  /** Publish (activate) or unpublish (deactivate) a workflow. */
  async setActive(id, active) {
    const response = await this.call(
      `${this.url}/api/v1/workflows/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`,
      { method: 'POST' },
    );
    this.check(response, { command: true });
  }

  /**
   * Start a workflow by its production webhook (POST, JSON body). The answer
   * of the workflow, whatever its status: a 404 means "not registered".
   * @returns {Promise<{ status: number, body: string, contentType: string }>}
   */
  async callWebhook(url, payload, { timeoutMs = 15_000 } = {}) {
    return this.call(url, {
      method: 'POST',
      key: false,
      body: JSON.stringify(payload),
      timeoutMs,
    });
  }
}
