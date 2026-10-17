// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake n8n: discovery, states,
// failures and scene events, persistence across restarts, n8n unreachable,
// the switch, quiet logs, and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FEATURE_KEYS, INSTANCE_KEYS, instanceIds } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import {
  API_KEY,
  BASE,
  FakeN8n,
  createClock,
  createDevices,
  createWorld,
  idsOf,
  sampleN8n,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('one device per workflow and one for the instance, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const n8n = sampleN8n();
  n8n.addWorkflow({ id: 'archivedWf000001', name: 'Old one', archived: true });
  const world = await createWorld({ n8n });
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['n8n', 'Greeting webhook', 'Nightly backup', 'Nightly report'],
    'archived workflows are left out',
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  assert.deepEqual(devices[2].params, [
    { name: 'WORKFLOW_ID', value: 'GFfOrnPCmR5eGKRq' },
    { name: 'TAGS', value: 'backup' },
  ]);
  const active = devices[1].features.find((f) => f.external_id.endsWith(':active'));
  assert.equal(active.read_only, true, 'read-only switch by default');
  assert.equal(world.fake.states.length, 0, 'nothing is published for devices not added');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states of an added device, at once, then only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const backup = idsOf(world, 'Nightly backup');
  assert.equal(world.fake.lastState(backup.feature(FEATURE_KEYS.ACTIVE)), 1);
  assert.equal(world.fake.lastState(backup.feature(FEATURE_KEYS.STATE)), 'Failed');
  assert.equal(world.fake.lastState(backup.feature(FEATURE_KEYS.WORKING)), 0);
  assert.equal(world.fake.lastState(backup.feature(FEATURE_KEYS.FAILURES_24H)), 1);
  assert.equal(world.fake.lastState(backup.feature(FEATURE_KEYS.LAST_DURATION)), 1);
  assert.match(world.fake.lastState(backup.feature(FEATURE_KEYS.LAST_RUN)), /^17\/10.*\d\d:00$/);
  const greeting = idsOf(world, 'Greeting webhook');
  assert.equal(world.fake.lastState(greeting.feature(FEATURE_KEYS.STATE)), 'Succeeded');
  assert.equal(world.fake.lastState(greeting.feature(FEATURE_KEYS.WORKING)), 1);
  const report = idsOf(world, 'Nightly report');
  assert.equal(world.fake.lastState(report.feature(FEATURE_KEYS.ACTIVE)), 0);
  assert.equal(world.fake.lastState(report.feature(FEATURE_KEYS.STATE)), 'Never run');
  assert.equal(world.fake.lastState(report.feature(FEATURE_KEYS.LAST_RUN)), undefined);
  const instance = instanceIds(world.gladys);
  assert.equal(world.fake.lastState(instance.feature(INSTANCE_KEYS.ACTIVE)), 2);
  assert.equal(world.fake.lastState(instance.feature(INSTANCE_KEYS.FAILURES_24H)), 1);
  assert.equal(world.fake.lastState(instance.feature(INSTANCE_KEYS.TOTAL)), 3);
  assert.deepEqual([...new Set(world.fake.transports.map((e) => e.transport))], ['local']);

  const before = world.fake.states.length;
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');
});

test('a running execution shows "Running", then its outcome', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, 'Greeting webhook');
  const execution = world.n8n.run('Greeting webhook', { status: 'running' });
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.STATE)), 'Running');
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.WORKING)), 1);
  world.n8n.finish(execution, 'error');
  world.n8n.errors.set(execution.id, { message: 'Slow API', node: 'HTTP Request' });
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.STATE)), 'Failed');
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.WORKING)), 0);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.LAST_DURATION)), 2);
  assert.equal(events(world, TRIGGERS.FAILED).length, 1, 'a run that ends in error is announced');
});

test('"an execution fails": once per execution, with workflow, node, error and link', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.sceneEvents, [], 'no event for the failures before the first read');
  const execution = world.n8n.run('Nightly backup', {
    status: 'error',
    message: 'Token expired [line 1]',
    node: 'Upload',
  });
  await world.hub.pollNow();
  await world.hub.pollNow();
  const fired = events(world, TRIGGERS.FAILED);
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    device: idsOf(world, 'Nightly backup').device,
    workflow: 'Nightly backup',
    error: 'Token expired',
    node: 'Upload',
    execution_id: execution.id,
    execution_url: `${BASE}/workflow/GFfOrnPCmR5eGKRq/executions/${execution.id}`,
  });
  // A crash is a failure too (the error filter of the API leaves it out).
  world.n8n.run('Greeting webhook', { status: 'crashed' });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FAILED).length, 2);
  assert.equal(world.hub.totals().failures, 3);
});

test('a failure during a restart is announced once; nothing more on the next restart', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const n8n = first.n8n;
  n8n.run('Nightly backup', { status: 'error' });
  const second = await createWorld({ n8n, dataDir: first.dataDir });
  await second.app.stop();
  assert.equal(events(second, TRIGGERS.FAILED).length, 1);
  const third = await createWorld({ n8n, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(events(third, TRIGGERS.FAILED).length, 0);
  const saved = JSON.parse(await readFile(join(first.dataDir, 'n8n-state.json'), 'utf8'));
  assert.equal(Object.keys(saved.failures).length, 2);
  assert.equal(saved.initialized, true);
});

test('the failures leave the 24-hour count when they get older', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, 'Nightly backup');
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.FAILURES_24H)), 1);
  clock.advance(25 * 3600_000);
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.FAILURES_24H)), 0);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.WORKING)), 0, 'still the last run');
});

test('a workflow absent from the latest executions is asked for its own last run, once', async (t) => {
  const n8n = sampleN8n();
  n8n.addWorkflow({ id: 'monthlyWf0000001', name: 'Monthly invoice' });
  const old = n8n.run('Monthly invoice', { startedAt: Date.UTC(2026, 8, 30, 6, 0, 0) });
  // 150 newer executions push it out of the latest page.
  for (let i = 0; i < 150; i += 1) {
    n8n.run('Greeting webhook');
  }
  const world = await createWorld({ n8n });
  t.after(() => world.app.stop());
  const asked = () =>
    n8n.requests.filter((r) => new URL(r.url).searchParams.get('workflowId')).length;
  assert.equal(asked(), 3, 'the monthly one, the backup and the inactive report');
  assert.equal(world.hub.saved.last.monthlyWf0000001.id, old.id);
  assert.equal(world.hub.saved.last.aSOH0bkmpN2q4Us6, null, 'never run');
  await world.hub.pollNow();
  assert.equal(asked(), 4, 'only the failing backup is asked again: the latest page is full');
});

test('n8n unreachable: status, badges, one warning, one event after two reads, then back', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.n8n.down = 'ECONNREFUSED';
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.pollNow();
    assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 0, 'one failed read stays quiet');
    clock.advance(60_000);
    await world.hub.pollNow();
    clock.advance(60_000);
    await world.hub.pollNow();
  });
  assert.equal(lines.length, 1, 'one line for an outage, not one per read');
  assert.deepEqual(
    events(world, TRIGGERS.UNREACHABLE).map((e) => e.data),
    [{ error: 'n8n does not answer' }],
  );
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.en, 'n8n does not answer');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  clock.advance(10 * 60_000);
  world.n8n.down = null;
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.BACK).map((e) => e.data),
    [{ downtime_minutes: 11 }],
  );
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('a refused key, a missing scope, a missing key and no address are reported in the status', async (t) => {
  const bad = await createWorld({ config: { url: BASE, api_key: 'nope', language: 'fr' } });
  t.after(() => bad.app.stop());
  assert.equal(bad.fake.connectionStatus.connected, false);
  assert.match(bad.fake.connectionStatus.message.fr, /clé d'API refusée/);

  const n8n = sampleN8n();
  n8n.status = 403;
  const scope = await createWorld({ n8n });
  t.after(() => scope.app.stop());
  assert.match(scope.fake.connectionStatus.message.en, /lacks a scope/);

  const none = await createWorld({ config: { url: BASE } });
  t.after(() => none.app.stop());
  assert.match(none.fake.connectionStatus.message.en, /Paste an n8n API key/);
  assert.equal(none.n8n.requests.length, 0);
  assert.deepEqual(none.fake.discoveredDevices, []);

  const nowhere = await createWorld({ config: { api_key: API_KEY } });
  t.after(() => nowhere.app.stop());
  assert.match(nowhere.fake.connectionStatus.message.en, /Enter the address/);
});

test('n8n Cloud is the cloud', async (t) => {
  const n8n = sampleN8n();
  const world = await createWorld({
    n8n,
    config: { url: 'https://acme.app.n8n.cloud', api_key: API_KEY, language: 'en' },
  });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(world.fake.transports.at(-1).transport, 'cloud');
});

test('the Active switch: refused while read-only, then activates and deactivates', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const device = world.fake.discoveredDevices.find((d) => d.name === 'Nightly report');
  const feature = device.features.find((f) => f.external_id.endsWith(':active'));
  const refused = await world.fake.setValue(device, feature, 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /enable it in the configuration/);

  await world.fake.configUpdated({
    url: BASE,
    api_key: API_KEY,
    language: 'en',
    allow_toggle: true,
  });
  const writable = world.fake.discoveredDevices.find((d) => d.name === 'Nightly report');
  assert.equal(writable.features.find((f) => f.external_id.endsWith(':active')).read_only, false);
  const ack = await world.fake.setValue(device, feature, 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(world.n8n.workflow('Nightly report').active, true);
  assert.equal(world.fake.lastState(feature.external_id), 1, 'read again after the command');
  await world.fake.setValue(device, feature, 0);
  assert.equal(world.n8n.workflow('Nightly report').active, false);
});

test('a new language renames the devices proposed; a deleted workflow leaves', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated({ url: BASE, api_key: API_KEY, language: 'fr' });
  const backup = world.fake.discoveredDevices.find((d) => d.name === 'Nightly backup');
  assert.ok(backup.features.some((f) => f.name === 'Échecs sur 24 h'));
  world.n8n.workflows = world.n8n.workflows.filter((w) => w.name !== 'Nightly report');
  await world.hub.rediscover();
  assert.ok(!world.fake.discoveredDevices.some((d) => d.name === 'Nightly report'));
  assert.ok(!('aSOH0bkmpN2q4Us6' in world.hub.saved.last));
});

test('another instance forgets what was learnt about the previous one', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const other = new FakeN8n();
  other.addWorkflow({ id: 'otherWf000000001', name: 'Other' });
  other.run('Other', { status: 'error' });
  world.hub.request = other.request;
  await world.fake.configUpdated({ url: 'http://192.0.2.20:5678', api_key: API_KEY });
  assert.equal(events(world, TRIGGERS.FAILED).length, 0, 'no event for the past of a new instance');
  assert.deepEqual(Object.keys(world.hub.saved.last), ['otherWf000000001']);
});

test('Gladys restarted: everything is sent again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const before = world.fake.states.length;
  await world.hub.resync(world.hub.config);
  assert.ok(world.fake.states.length > before);
});

test('a normal reading cycle writes nothing at the info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      world.n8n.run('Greeting webhook', { status: cycle % 2 ? 'success' : 'running' });
      world.clock.advance(5 * 60_000);
      await world.hub.pollNow();
    }
  });
  assert.ok(world.fake.states.length > sent, 'states were published');
  assert.deepEqual(lines, []);
});

test('the internal timer reads n8n and publishes the changes, without any poll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  const reads = world.n8n.requests.length;
  world.n8n.run('Greeting webhook', { status: 'error' });
  t.mock.timers.tick(60_000);
  // Let the read and the publications settle.
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(world.n8n.requests.length > reads);
  const ids = idsOf(world, 'Greeting webhook');
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.WORKING)), 0);
});

test('a run seen waiting, then failed, becomes the last execution; a long run failing last wins', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, 'Greeting webhook');
  const waiting = world.n8n.run('Greeting webhook', { status: 'waiting' });
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.STATE)), 'Waiting');
  world.n8n.finish(waiting, 'error');
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.STATE)), 'Failed');
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.WORKING)), 0);

  // A long run (started first) fails after a shorter one succeeded.
  const long = world.n8n.run('Greeting webhook', { status: 'running' });
  const short = world.n8n.run('Greeting webhook', { durationMs: 100 });
  await world.hub.pollNow();
  assert.equal(world.hub.saved.last['6YAGeXUth7pU5niX'].id, short.id);
  world.n8n.finish(long, 'error');
  await world.hub.pollNow();
  assert.equal(world.hub.saved.last['6YAGeXUth7pU5niX'].id, long.id);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.WORKING)), 0);
});

test('a busy instance: a workflow last seen failing is asked again for its last run', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, 'Nightly backup');
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.WORKING)), 0);
  world.n8n.run('Nightly backup');
  for (let i = 0; i < 120; i += 1) {
    world.n8n.run('Greeting webhook');
  }
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.WORKING)), 1);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.STATE)), 'Succeeded');
});

test('a new key during an outage keeps the pair "unreachable" / "answers again"', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.n8n.down = 'ECONNREFUSED';
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 1);
  await world.fake.configUpdated({ url: BASE, api_key: 'other', language: 'en' });
  await world.fake.configUpdated({ url: BASE, api_key: API_KEY, language: 'en' });
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 1, 'not announced twice');
  world.n8n.down = null;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.BACK).length, 1);
});

test('a command does not wait for a slow read after it', async (t) => {
  const world = await createWorld({ timings: { commandReadMs: 50 } });
  t.after(() => world.app.stop());
  const request = world.n8n.request;
  world.hub.client.request = async (url, options) => {
    if (new URL(url).pathname === '/api/v1/workflows') {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return request(url, options);
  };
  const started = Date.now();
  const ack = await world.fake.sceneAction('activate_workflow', {
    device: idsOf(world, 'Nightly report').device,
  });
  assert.equal(ack.success, true, ack.error);
  assert.ok(Date.now() - started < 250, 'answered before the slow read ended');
  assert.equal(world.n8n.workflow('Nightly report').active, true);
  await world.hub.polling?.catch(() => {});
});
