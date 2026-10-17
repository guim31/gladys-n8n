// -----------------------------------------------------------------------------
// The n8n client and the configuration: addresses, webhook paths, the real
// answers of n8n 2.43 (test/fixtures/n8n), paging, and the errors by kind.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, isCloud, normalizeConfig, parseServerUrl } from '../src/config.js';
import {
  ERROR_KINDS,
  N8nClient,
  N8nError,
  normalizeExecution,
  shortError,
  webhookUrl,
} from '../src/n8n/client.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/n8n/${name}.json`, import.meta.url), 'utf8'));

test('the address: bare host with the n8n port, pasted editor URLs, sub-paths', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10:5678');
  assert.equal(parseServerUrl(' 192.0.2.10:8080 '), 'http://192.0.2.10:8080');
  assert.equal(parseServerUrl('https://n8n.example.com/home/workflows'), 'https://n8n.example.com');
  assert.equal(
    parseServerUrl('https://example.com/n8n/workflow/6YAGeXUth7pU5niX'),
    'https://example.com/n8n',
  );
  assert.equal(parseServerUrl('http://192.0.2.10:5678/api/v1/'), 'http://192.0.2.10:5678');
  assert.equal(parseServerUrl('https://user:pass@n8n.example.com'), null, 'no credentials');
  assert.equal(parseServerUrl('ftp://n8n.example.com'), null);
  assert.equal(parseServerUrl(''), null);
  assert.ok(isCloud('https://acme.app.n8n.cloud'));
  assert.ok(!isCloud('http://192.0.2.10:5678'));
});

test('the configuration is normalized', () => {
  assert.deepEqual(normalizeConfig({}), {
    url: null,
    urlTyped: false,
    apiKey: '',
    pollIntervalMs: 60_000,
    allowToggle: false,
    language: 'fr',
  });
  const config = normalizeConfig({
    url: '192.0.2.10',
    api_key: ' key\n',
    poll_interval: '300',
    allow_toggle: true,
    language: 'de',
  });
  assert.equal(config.url, 'http://192.0.2.10:5678');
  assert.equal(config.apiKey, 'key');
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.allowToggle, true);
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 60_000);
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('the webhook of a scene: path, /webhook/path or the Production URL', () => {
  const base = 'http://192.0.2.10:5678';
  assert.equal(webhookUrl(base, 'gladys-hello'), `${base}/webhook/gladys-hello`);
  assert.equal(webhookUrl(base, '/webhook/gladys-hello'), `${base}/webhook/gladys-hello`);
  assert.equal(webhookUrl(base, 'room/:id'), `${base}/webhook/room/%3Aid`);
  assert.equal(
    webhookUrl(base, 'https://n8n.example.com/webhook/4f6e-abc'),
    'https://n8n.example.com/webhook/4f6e-abc',
    'n8n behind a proxy announces its public address',
  );
  for (const bad of ['', '  ', 'a b', '../rest/login', 'x?y=1', 'https://example.com/login']) {
    assert.equal(webhookUrl(base, bad), null, bad);
  }
  assert.equal(webhookUrl(base, 'https://u:p@n8n.example.com/webhook/x'), null);
});

test('the real answers of n8n 2.43 are read', async () => {
  const bodies = {
    workflows: await fixture('workflows'),
    executions: await fixture('executions'),
    running: await fixture('executions-running'),
    detail: await fixture('execution-error-detail'),
  };
  const client = new N8nClient({
    url: 'http://192.0.2.10:5678',
    apiKey: 'k',
    request: async (url) => {
      const { pathname, searchParams } = new URL(url);
      const body = pathname.endsWith('/workflows')
        ? bodies.workflows
        : /\/executions\/\w+$/.test(pathname)
          ? bodies.detail
          : searchParams.get('status') === 'running'
            ? bodies.running
            : bodies.executions;
      return { status: 200, body: JSON.stringify(body) };
    },
  });
  const workflows = await client.workflows();
  assert.deepEqual(
    workflows.map((w) => [w.name, w.active]),
    [
      ['Greeting webhook', true],
      ['Slow webhook', true],
      ['Failing webhook', true],
      ['Failing sync webhook', true],
      ['Nightly report', false],
    ],
  );
  const executions = await client.executions();
  assert.deepEqual(executions[0], {
    id: '6',
    workflowId: '6YAGeXUth7pU5niX',
    status: 'success',
    mode: 'webhook',
    startedAt: Date.parse('2026-10-17T18:14:11.200Z'),
    stoppedAt: Date.parse('2026-10-17T18:14:11.236Z'),
  });
  const [running] = await client.executions({ status: 'running' });
  assert.equal(running.status, 'running');
  assert.equal(running.stoppedAt, null);
  assert.deepEqual(await client.executionError('4'), { message: 'Token expired', node: 'Explode' });
});

test('pages are followed by cursor, and the reading stops when asked', async () => {
  const seen = [];
  const client = new N8nClient({
    url: 'http://n8n',
    apiKey: 'k',
    request: async (url) => {
      const cursor = new URL(url).searchParams.get('cursor');
      seen.push(cursor);
      const page = cursor ? 2 : 1;
      const data = [1, 2].map((n) => ({
        id: String(10 - (page - 1) * 2 - n),
        workflowId: 'w',
        status: 'error',
        startedAt: new Date(Date.UTC(2026, 9, 17, 10 - (page - 1) * 2 - n)).toISOString(),
      }));
      return { status: 200, body: JSON.stringify({ data, nextCursor: page === 1 ? 'c2' : null }) };
    },
  });
  const all = await client.executions({ status: 'error', maxPages: 5 });
  assert.deepEqual(
    all.map((e) => e.id),
    ['9', '8', '7', '6'],
  );
  assert.deepEqual(seen, [null, 'c2']);
  const recent = await client.executions({
    maxPages: 5,
    stop: (e) => e.startedAt < Date.UTC(2026, 9, 17, 8),
  });
  assert.deepEqual(
    recent.map((e) => e.id),
    ['9', '8'],
  );
});

test('every failure has its kind, and the reason n8n gives', async () => {
  const answer = (status, body = {}) =>
    new N8nClient({
      url: 'http://n8n',
      apiKey: 'k',
      request: async () => ({ status, body: JSON.stringify(body) }),
    });
  const kind = async (client, call) => {
    try {
      await call(client);
    } catch (err) {
      assert.ok(err instanceof N8nError);
      return [err.kind, err.reason];
    }
    return null;
  };
  const list = (c) => c.workflows();
  assert.deepEqual(await kind(answer(401, { message: 'Unauthorized' }), list), [
    ERROR_KINDS.AUTH,
    undefined,
  ]);
  assert.deepEqual(await kind(answer(403, { message: 'Forbidden' }), list), [
    ERROR_KINDS.SCOPE,
    'Forbidden',
  ]);
  assert.deepEqual(await kind(answer(404), list), [ERROR_KINDS.NOT_N8N, undefined]);
  assert.deepEqual(await kind(answer(301), list), [ERROR_KINDS.REDIRECT, undefined]);
  assert.deepEqual(await kind(answer(502), list), [ERROR_KINDS.HTTP, undefined]);
  const html = new N8nClient({
    url: 'http://n8n',
    apiKey: 'k',
    request: async () => ({ status: 200, body: '<html></html>' }),
  });
  assert.deepEqual(await kind(html, list), [ERROR_KINDS.NOT_N8N, undefined]);
  const activate = (c) => c.setActive('w1', true);
  assert.deepEqual(await kind(answer(404, { message: 'Not Found' }), activate), [
    ERROR_KINDS.NOT_FOUND,
    undefined,
  ]);
  assert.deepEqual(
    await kind(
      answer(400, { message: 'Workflow has no node to start the workflow - at least one trigger' }),
      activate,
    ),
    [ERROR_KINDS.REFUSED, 'Workflow has no node to start the workflow - at least one trigger'],
  );
  const failing = (error) =>
    new N8nClient({
      url: 'http://n8n',
      apiKey: 'k',
      request: async () => {
        throw error;
      },
    });
  assert.equal(
    (
      await kind(failing(Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } })), list)
    )[0],
    ERROR_KINDS.UNREACHABLE,
  );
  assert.equal(
    (
      await kind(
        failing(Object.assign(new Error('x'), { cause: { code: 'CERT_HAS_EXPIRED' } })),
        list,
      )
    )[0],
    ERROR_KINDS.TLS,
  );
  assert.equal(
    (await kind(failing(Object.assign(new Error('x'), { name: 'TimeoutError' })), list))[0],
    ERROR_KINDS.TIMEOUT,
  );
});

test('the API key goes in X-N8N-API-KEY, the commands are POST', async () => {
  const calls = [];
  const client = new N8nClient({
    url: 'http://n8n/sub',
    apiKey: 'secret',
    request: async (url, options) => {
      calls.push({ url, ...options });
      return { status: 200, body: '{"data":[]}' };
    },
  });
  await client.workflows();
  await client.setActive('w/1', false);
  assert.equal(calls[0].headers['X-N8N-API-KEY'], 'secret');
  assert.match(calls[0].url, /^http:\/\/n8n\/sub\/api\/v1\/workflows\?/);
  assert.equal(calls[1].url, 'http://n8n/sub/api/v1/workflows/w%2F1/deactivate');
  assert.equal(calls[1].method, 'POST');
});

test('short errors and odd executions', () => {
  assert.equal(shortError('Token expired [line 1]'), 'Token expired');
  assert.equal(shortError('First line\nstack'), 'First line');
  assert.equal(shortError('x'.repeat(300)).length, 200);
  assert.equal(shortError(undefined), '');
  assert.equal(normalizeExecution({ id: 5, workflowId: 'w', status: 'odd' }).status, 'new');
  assert.equal(normalizeExecution({ id: 'a b', workflowId: 'w' }), null);
  assert.equal(normalizeExecution({ id: '1' }), null);
});
