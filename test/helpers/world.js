// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake n8n, a temporary /data
// and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read n8n with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-healthchecks.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { workflowIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_KEY, BASE, FakeN8n, sampleN8n } from './fakeN8n.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 17, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  n8n = sampleN8n(),
  config = { url: BASE, api_key: API_KEY, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-n8n-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: n8n.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, n8n, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a workflow of the fake, by name. */
export const idsOf = (world, name) => workflowIds(world.gladys, world.n8n.workflow(name).id);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { API_KEY, BASE, FakeN8n, sampleN8n };
