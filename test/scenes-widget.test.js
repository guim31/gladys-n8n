// -----------------------------------------------------------------------------
// Scene actions and the dashboard widget, through the SDK's fake Gladys (the
// path a real Gladys takes: `sceneAction`, `widgetGet`, `widgetAction`).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { bodyOf, messageOf } from '../src/scenes.js';
import { API_KEY, BASE, createDevices, createWorld, idsOf } from './helpers/world.js';

test('"Start an n8n workflow": JSON body, the answer of the workflow as outputs', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('run_workflow', {
    path: 'gladys-hello',
    body: '{"name": "Gladys"}',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    success: true,
    status: 200,
    message: 'Hello Gladys',
    response: '{"message":"Hello Gladys"}',
  });
  const call = world.n8n.requests.at(-1);
  assert.equal(call.url, `${BASE}/webhook/gladys-hello`);
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['X-N8N-API-KEY'], undefined, 'the API key never goes to a webhook');
  assert.equal(call.headers['content-type'], 'application/json');

  // The whole Production URL works too, and a text body becomes { text }.
  const url = await world.fake.sceneAction('run_workflow', {
    path: `${BASE}/webhook/gladys-hello`,
    body: 'Living room',
  });
  assert.equal(url.data.outputs.success, true);
  assert.deepEqual(JSON.parse(world.n8n.requests.at(-1).body), { text: 'Living room' });
});

test('"Start an n8n workflow": a failing or inactive workflow answers success: false', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const failing = await world.fake.sceneAction('run_workflow', { path: 'gladys-fail' });
  assert.equal(failing.success, true);
  assert.deepEqual(failing.data.outputs, {
    success: false,
    status: 500,
    message: 'Error in workflow',
    response: '{"message":"Error in workflow"}',
  });
  world.n8n.workflow('Greeting webhook').active = false;
  const inactive = await world.fake.sceneAction('run_workflow', { path: 'gladys-hello' });
  assert.equal(inactive.data.outputs.success, false);
  assert.equal(inactive.data.outputs.status, 404);
  assert.match(inactive.data.outputs.message, /not registered/);

  const bad = await world.fake.sceneAction('run_workflow', { path: 'https://example.com/other' });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Webhook path not understood/);

  world.n8n.down = 'ECONNREFUSED';
  const down = await world.fake.sceneAction('run_workflow', { path: 'gladys-hello' });
  assert.equal(down.success, false);
  assert.match(down.error, /n8n does not answer/);
});

test('"Start an n8n workflow": no answer in time gives status 0, not an error', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.hub.request = async () => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
  };
  const ack = await world.fake.sceneAction('run_workflow', { path: 'gladys-slow' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { success: false, status: 0, response: '', message: '' });
});

test('the webhook body and the message answered', () => {
  assert.deepEqual(bodyOf(''), {});
  assert.deepEqual(bodyOf('[1, 2]'), [1, 2]);
  assert.deepEqual(bodyOf('42'), { text: '42' });
  assert.equal(messageOf('[{"text": "ok"}]'), 'ok');
  assert.equal(messageOf('"plain"'), 'plain');
  assert.equal(messageOf('{"count": 3}'), '');
  assert.equal(messageOf(' Workflow was started '), 'Workflow was started');
});

test('"State of a workflow", in the language of the configuration', async (t) => {
  const world = await createWorld({ config: { url: BASE, api_key: API_KEY, language: 'fr' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_workflow_status', {
    device: idsOf(world, 'Nightly backup').device,
  });
  assert.equal(ack.success, true, ack.error);
  const outputs = ack.data.outputs;
  assert.equal(outputs.active, true);
  assert.equal(outputs.failed, true);
  assert.equal(outputs.state, 'En échec');
  assert.equal(outputs.failures_24h, 1);
  assert.equal(outputs.duration, 1);
  assert.match(outputs.last_run, /^17\/10/);
  assert.equal(outputs.error, '', 'the error of a failure from before the first read is not read');
  assert.match(outputs.sentence, /^Nightly backup : En échec \(actif\), dernière exécution 17\/10/);

  world.n8n.run('Nightly backup', { status: 'error', message: 'Disk full' });
  world.clock.advance(60_000);
  const again = await world.fake.sceneAction('get_workflow_status', {
    device: idsOf(world, 'Nightly backup').device,
  });
  assert.equal(again.data.outputs.error, 'Disk full');
  assert.match(again.data.outputs.sentence, /2 échec\(s\) en 24 h\. Disk full$/);

  const unknown = await world.fake.sceneAction('get_workflow_status', { device: 'ext:other:x' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /n'est pas un workflow n8n/);
});

test('activate and deactivate a workflow from a scene, whatever the switch option', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = idsOf(world, 'Nightly report').device;
  assert.equal((await world.fake.sceneAction('activate_workflow', { device })).success, true);
  assert.equal(world.n8n.workflow('Nightly report').active, true);
  assert.equal(world.hub.workflows.get('aSOH0bkmpN2q4Us6').active, true, 'read again');
  assert.equal((await world.fake.sceneAction('deactivate_workflow', { device })).success, true);
  assert.equal(world.n8n.workflow('Nightly report').active, false);
  world.n8n.status = 403;
  const refused = await world.fake.sceneAction('activate_workflow', { device });
  assert.equal(refused.success, false);
  assert.match(refused.error, /lacks a scope/);
});

test('the widget: failing workflows first, then running, then the others; a Refresh button', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.n8n.run('Greeting webhook', { status: 'running' });
  await world.hub.pollNow();
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
  assert.ok(content.components.length <= 8);
  const [active, failures, running] = content.components;
  assert.deepEqual(
    [active.value, failures.value, running.value],
    [2, 1, 1],
    'active workflows, failures in 24 h, running',
  );
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Nightly backup', 'Greeting webhook'],
    'the inactive report is left out by default',
  );
  assert.match(rows[0].value, /^Failed · 17\/10.* · ✗1$/);
  assert.equal(rows[1].value.split(' · ')[0], 'Running');
  assert.equal(content.ttl_seconds, 30, 'something runs: refresh sooner');

  // Chosen workflows: the inactive one shows as such.
  await createDevices(world);
  const chosen = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { workflows: [idsOf(world, 'Nightly report').device] },
    language: 'fr',
  });
  const items = chosen.data.content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    items.map((row) => [row.label, row.value]),
    [['Nightly report', 'inactif']],
  );

  const refresh = await world.fake.widgetAction(WIDGET_KEY, 'refresh');
  assert.equal(refresh.success, true, refresh.error);
  assert.equal(refresh.data.message.en, 'n8n read again.');
});

test('the widget says what to do without a key, and when n8n does not answer', async (t) => {
  const none = await createWorld({ config: { url: BASE } });
  t.after(() => none.app.stop());
  const empty = await none.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.match(empty.data.content.components[0].text, /API-Schlüssel/);

  const world = await createWorld();
  t.after(() => world.app.stop());
  world.n8n.down = 'ECONNREFUSED';
  await world.hub.pollNow();
  const down = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'es' });
  assert.deepEqual(validateWidgetContent(down.data.content).errors ?? [], []);
  assert.ok(
    down.data.content.components.some((c) => c.type === 'text' && c.text === 'n8n no responde'),
  );
});

test('"Test the connection" sums the instance up in four languages', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection');
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message?.fr ?? ack.data.fr,
    'n8n : Connecté, 3 workflow(s), 2 actif(s), 1 échec(s) en 24 h',
  );
});
