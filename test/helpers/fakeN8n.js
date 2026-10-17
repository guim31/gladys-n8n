// -----------------------------------------------------------------------------
// An in-memory n8n, behind the `request` seam of src/n8n/client.js: the
// public API v1 as n8n 2.43 answers it (test/fixtures/n8n hold the real
// answers this mimics: cursor pages, running executions left out of the
// default list, the error of a run under data.resultData), and the production
// webhooks of the active workflows.
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.10:5678';
export const API_KEY = 'n8n_api_test_key';

const json = (status, value) => ({
  status,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify(value),
});

export class FakeN8n {
  constructor() {
    this.workflows = [];
    this.executions = [];
    this.nextId = 1;
    /** path → (body) => { status, body } ; only the active workflows answer */
    this.webhooks = new Map();
    this.requests = [];
    this.down = null; // an error code: every request fails
    this.status = null; // an HTTP status: every API request answers it
    this.errors = new Map(); // execution id → { message, node }
    this.request = this.request.bind(this);
  }

  addWorkflow({ id, name, active = true, tags = [], archived = false, webhook }) {
    const workflow = { id, name, active, tags, isArchived: archived };
    this.workflows.push(workflow);
    if (webhook) {
      this.webhooks.set(webhook.path, { workflowId: id, answer: webhook.answer });
    }
    return workflow;
  }

  workflow(name) {
    return this.workflows.find((workflow) => workflow.name === name);
  }

  /** A finished execution (or a running one), newest last. */
  run(name, { status = 'success', startedAt, durationMs = 1000, message, node } = {}) {
    const workflow = this.workflow(name);
    const id = String(this.nextId++);
    const start = startedAt ?? Date.UTC(2026, 9, 17, 9, 0, 0) + Number(id) * 1000;
    const execution = {
      id,
      finished: status === 'success',
      mode: 'webhook',
      retryOf: null,
      retrySuccessId: null,
      status,
      startedAt: new Date(start).toISOString(),
      stoppedAt: status === 'running' ? null : new Date(start + durationMs).toISOString(),
      workflowId: workflow.id,
      waitTill: null,
    };
    this.executions.push(execution);
    if (status === 'error') {
      this.errors.set(id, { message: message ?? 'Boom [line 1]', node: node ?? 'Code' });
    }
    return execution;
  }

  finish(execution, status = 'success') {
    execution.status = status;
    execution.finished = status === 'success';
    execution.stoppedAt = new Date(Date.parse(execution.startedAt) + 2000).toISOString();
  }

  page(items, query) {
    const limit = Number(query.get('limit') ?? 100);
    const after = query.get('cursor') ? Number(query.get('cursor')) : 0;
    const slice = items.slice(after, after + limit);
    const next = after + limit < items.length ? String(after + limit) : null;
    return json(200, { data: slice, nextCursor: next });
  }

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    this.requests.push({ url, method, headers, body });
    if (this.down) {
      throw Object.assign(new Error('fetch failed'), { cause: { code: this.down } });
    }
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.startsWith('/webhook/')) {
      const hook = this.webhooks.get(decodeURIComponent(path.slice('/webhook/'.length)));
      const workflow = hook && this.workflows.find((w) => w.id === hook.workflowId);
      if (!hook || !workflow?.active || method !== 'POST') {
        return json(404, {
          code: 404,
          message: `The requested webhook "${method} ${path.slice(9)}" is not registered.`,
        });
      }
      return hook.answer(JSON.parse(body ?? '{}'));
    }
    if (!path.startsWith('/api/v1/')) {
      return { status: 200, contentType: 'text/html', body: '<html>n8n</html>' };
    }
    if (headers['X-N8N-API-KEY'] !== API_KEY) {
      return json(401, { message: 'Unauthorized' });
    }
    if (this.status) {
      return json(this.status, { message: 'Nope' });
    }
    const query = parsed.searchParams;
    if (path === '/api/v1/workflows' && method === 'GET') {
      return this.page(
        this.workflows.map((w) => ({
          ...w,
          tags: w.tags.map((name, index) => ({ id: `t${index}`, name })),
          nodes: [],
          connections: {},
        })),
        query,
      );
    }
    const command = path.match(/^\/api\/v1\/workflows\/([^/]+)\/(activate|deactivate)$/);
    if (command && method === 'POST') {
      const workflow = this.workflows.find((w) => w.id === command[1]);
      if (!workflow) {
        return json(404, { message: 'Not Found' });
      }
      workflow.active = command[2] === 'activate';
      return json(200, workflow);
    }
    if (path === '/api/v1/executions') {
      let list = [...this.executions].reverse();
      const status = query.get('status');
      list = status
        ? list.filter((e) => e.status === status)
        : list.filter((e) => e.status !== 'running');
      if (query.get('workflowId')) {
        list = list.filter((e) => e.workflowId === query.get('workflowId'));
      }
      return this.page(list, query);
    }
    const detail = path.match(/^\/api\/v1\/executions\/([^/]+)$/);
    if (detail) {
      const execution = this.executions.find((e) => e.id === detail[1]);
      if (!execution) {
        return json(404, { message: 'Not Found' });
      }
      const error = this.errors.get(execution.id);
      return json(200, {
        ...execution,
        data: {
          resultData: error
            ? {
                error: { message: error.message, name: 'WrappedExecutionError' },
                runData: {},
                lastNodeExecuted: error.node,
              }
            : { runData: {}, lastNodeExecuted: 'Set' },
        },
      });
    }
    return json(404, { message: 'Not Found' });
  }

  /** Requests of a kind, e.g. `count('/api/v1/executions')`. */
  count(prefix) {
    return this.requests.filter((r) => new URL(r.url).pathname.startsWith(prefix)).length;
  }
}

/** A world with three workflows: a webhook that answers, one that fails, an inactive one. */
export function sampleN8n() {
  const n8n = new FakeN8n();
  n8n.addWorkflow({
    id: '6YAGeXUth7pU5niX',
    name: 'Greeting webhook',
    webhook: {
      path: 'gladys-hello',
      answer: (body) => json(200, { message: `Hello ${body.name ?? 'nobody'}` }),
    },
  });
  n8n.addWorkflow({
    id: 'GFfOrnPCmR5eGKRq',
    name: 'Nightly backup',
    tags: ['backup'],
    webhook: { path: 'gladys-fail', answer: () => json(500, { message: 'Error in workflow' }) },
  });
  n8n.addWorkflow({ id: 'aSOH0bkmpN2q4Us6', name: 'Nightly report', active: false });
  n8n.run('Greeting webhook');
  n8n.run('Nightly backup', { status: 'error', message: 'Backup target unreachable [line 1]' });
  return n8n;
}
