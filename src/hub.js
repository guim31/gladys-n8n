// -----------------------------------------------------------------------------
// The n8n hub: the instance read on a timer of the container (the interval
// chosen in the configuration); the states of the added devices published
// when they change, the scene events fired on new failures and when n8n stops
// or starts answering, and the views the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and "an execution
// failed" must fire for every workflow, added to Gladys or not.
//
// One reading: the workflows, the latest executions, the running ones, and
// the failed ones of the last 24 hours (paged until older). A workflow seen in
// none of them is asked for its own last execution once (a monthly workflow),
// then followed through the latest executions. What was learnt is kept in
// /data (src/store.js): the last execution of each workflow, the failures of
// the last 24 hours — so a failure that happened while the integration or
// Gladys restarted is still announced, once.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  FAILED,
  FEATURE_KEYS,
  VOLATILE,
  buildInstanceDevice,
  buildWorkflowDevice,
  instanceIds,
  instanceValues,
  parseWorkflowId,
  workflowIds,
  workflowValues,
} from './devices.js';
import { N8nClient, N8nError } from './n8n/client.js';
import { hostOf, isCloud, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'n8n-hub' });

export const WIDGET_KEY = 'n8n';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  FAILED: 'execution_failed',
  UNREACHABLE: 'n8n_unreachable',
  BACK: 'n8n_back',
});

export const HUB_TIMINGS = {
  // Last run and duration change at every execution: published at most this
  // often per workflow (a change of state publishes them at once).
  volatileEveryMs: 5 * 60_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads n8n again when the last read is older.
  freshMs: 15_000,
  // The window of the failure counters.
  windowMs: 24 * 3600_000,
  // Failed reads in a row before "n8n is unreachable" fires (a restart of n8n
  // or a network blip of one cycle stays quiet).
  unreachableAfter: 2,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;
// Pages of failed executions read per cycle (100 each), at most.
const MAX_ERROR_PAGES = 5;
// Workflows asked for their own last execution per cycle, at most.
const MAX_SEEDS_PER_READ = 10;
// Failures announced per cycle, at most (each reads the error of the run).
const MAX_EVENTS_PER_READ = 10;

const newer = (a, b) => {
  if (!b) {
    return true;
  }
  if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) {
    return Number(a.id) > Number(b.id);
  }
  return (a.startedAt ?? 0) > (b.startedAt ?? 0);
};

const timeOf = (execution) => execution.stoppedAt ?? execution.startedAt ?? 0;

export class N8nHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/n8n/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} workflows of the last read, by id */
    this.workflows = new Map();
    /** Workflow ids with an execution running at the last read. */
    this.running = new Set();
    this.readAt = 0;
    this.error = null;
    this.failedReads = 0;
    this.unreachableSince = null;
    this.polling = null;
    /** When the volatile features of a workflow were last published, by id. */
    this.volatileAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = this.emptySaved();
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  emptySaved() {
    // last: workflow id → last execution (null: never run); failures:
    // execution id → { w, t, message, node }; initialized: a first read was done.
    return { last: {}, failures: {}, initialized: false };
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) => (value && typeof value === 'object' ? value : {});
    this.saved = {
      last: object(saved.last),
      failures: object(saved.failures),
      initialized: saved.initialized === true,
      url: typeof saved.url === 'string' ? saved.url : null,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.volatileAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    const structureChanged =
      this.signature !== null &&
      (previous.language !== config.language || previous.allowToggle !== config.allowToggle);
    this.config = config;
    const signature = JSON.stringify([config.url, config.apiKey]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client =
        config.url && config.apiKey
          ? new N8nClient({ url: config.url, apiKey: config.apiKey, request: this.request })
          : null;
      this.workflows = new Map();
      this.running = new Set();
      this.readAt = 0;
      this.error = null;
      this.failedReads = 0;
      this.unreachableSince = null;
      this.polling = null;
      // Another instance: what was learnt about the previous one is worthless.
      if (config.url && this.saved.url && this.saved.url !== config.url) {
        this.saved = this.emptySaved();
      }
      if (config.url) {
        this.saved.url = config.url;
      }
    }
    if (structureChanged) {
      // New names or a writable switch for the Discovery tab, texts in the new language.
      this.discovered = null;
      this.volatileAt.clear();
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading n8n works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading n8n -----------------------------------------------------------

  /** Read the instance now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read after a command: a read already under way started before it. */
  async pollAfterCommand() {
    await this.polling?.catch(() => {});
    await this.pollNow();
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the instance and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let result;
    try {
      result = await this.fetchAll(client);
    } catch (err) {
      if (!(err instanceof N8nError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess(client, result);
  }

  async fetchAll(client) {
    const since = this.now() - this.timings.windowMs;
    const workflows = await client.workflows();
    const recent = await client.executions();
    const running = await client.executions({ status: 'running' });
    const errors = await client.executions({
      status: 'error',
      maxPages: MAX_ERROR_PAGES,
      stop: (execution) => timeOf(execution) < since,
    });
    // A workflow seen nowhere and never asked: its own last execution.
    const seen = new Set(recent.map((execution) => execution.workflowId));
    const seeds = new Map();
    for (const workflow of workflows) {
      if (seeds.size >= MAX_SEEDS_PER_READ) {
        break;
      }
      if (!seen.has(workflow.id) && !(workflow.id in this.saved.last)) {
        const [last] = await client.executions({ workflowId: workflow.id, limit: 1 });
        seeds.set(workflow.id, last?.workflowId === workflow.id ? last : null);
      }
    }
    return { workflows, recent, running, errors, seeds, since };
  }

  async applySuccess(client, { workflows, recent, running, errors, seeds, since }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info('n8n answers again');
    }
    if (this.unreachableSince !== null) {
      const minutes = Math.max(0, Math.round((this.now() - this.unreachableSince) / 60_000));
      await this.fire(TRIGGERS.BACK, { downtime_minutes: minutes });
    }
    if (this.readAt === 0) {
      logger.info(`n8n (${hostOf(this.config.url)}): ${workflows.length} workflow(s)`);
    }
    this.error = null;
    this.failedReads = 0;
    this.unreachableSince = null;
    this.readAt = this.now();

    const next = new Map(workflows.map((workflow) => [workflow.id, workflow]));
    for (const [id, workflow] of next) {
      const previous = this.workflows.get(id);
      if (
        !previous ||
        previous.name !== workflow.name ||
        previous.active !== workflow.active ||
        previous.tags !== workflow.tags
      ) {
        widgetChanged = true;
      }
    }
    if ([...this.workflows.keys()].some((id) => !next.has(id))) {
      widgetChanged = true; // a workflow deleted or archived
    }
    this.workflows = next;

    const nextRunning = new Set(running.map((execution) => execution.workflowId));
    if (
      nextRunning.size !== this.running.size ||
      [...nextRunning].some((id) => !this.running.has(id))
    ) {
      widgetChanged = true;
    }
    this.running = nextRunning;

    // The last execution of each workflow.
    let dirty = false;
    const stateChanged = new Set();
    for (const [id, last] of seeds) {
      this.saved.last[id] = last ? this.summary(last) : null;
      dirty = true;
    }
    for (const execution of [...recent, ...errors]) {
      const saved = this.saved.last[execution.workflowId];
      if (newer(execution, saved)) {
        if (saved?.status !== execution.status) {
          stateChanged.add(execution.workflowId);
          widgetChanged = true;
        }
        this.saved.last[execution.workflowId] = this.summary(execution);
        dirty = true;
      }
    }

    // The failures of the window: the ones read now, the ones kept (pages
    // beyond the reading cap), the crashes the error filter leaves out.
    const fresh = [];
    for (const execution of [...errors, ...recent]) {
      if (!FAILED.has(execution.status) || timeOf(execution) < since) {
        continue;
      }
      if (!(execution.id in this.saved.failures)) {
        this.saved.failures[execution.id] = { w: execution.workflowId, t: timeOf(execution) };
        fresh.push(execution);
        stateChanged.add(execution.workflowId);
        dirty = true;
      }
    }
    for (const [id, failure] of Object.entries(this.saved.failures)) {
      if (!failure || typeof failure.t !== 'number' || failure.t < since) {
        delete this.saved.failures[id];
        stateChanged.add(failure?.w);
        dirty = true;
      }
    }
    // A workflow deleted in n8n is forgotten.
    for (const id of Object.keys(this.saved.last)) {
      if (!next.has(id)) {
        delete this.saved.last[id];
        dirty = true;
      }
    }

    if (fresh.length > 0) {
      widgetChanged = true;
      if (this.saved.initialized) {
        await this.announce(client, fresh);
      }
    }
    if (!this.saved.initialized) {
      // The first read only sets what is known: no event for the past.
      this.saved.initialized = true;
      dirty = true;
    }
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(this.saved);
    }
    await this.publishStates({ changed: stateChanged });
    return widgetChanged;
  }

  summary(execution) {
    return {
      id: execution.id,
      status: execution.status,
      startedAt: execution.startedAt,
      stoppedAt: execution.stoppedAt,
    };
  }

  /** Fire "an execution failed", oldest first, with the error of each run. */
  async announce(client, executions) {
    const ordered = [...executions].sort((a, b) => timeOf(a) - timeOf(b));
    const announced = ordered.slice(-MAX_EVENTS_PER_READ);
    if (ordered.length > announced.length) {
      logger.warn(`${ordered.length - announced.length} older failure(s) not announced`);
    }
    for (const execution of announced) {
      const workflow = this.workflows.get(execution.workflowId);
      let detail = { message: '', node: '' };
      try {
        detail = await client.executionError(execution.id);
      } catch (err) {
        logger.debug(`Error of execution ${execution.id} unreadable: ${err.message}`);
      }
      const failure = this.saved.failures[execution.id];
      if (failure) {
        failure.message = detail.message;
        failure.node = detail.node;
      }
      const name = workflow?.name ?? execution.workflowId;
      logger.info(
        `${name}: execution ${execution.id} failed${detail.node ? ` in ${detail.node}` : ''}`,
      );
      await this.fire(TRIGGERS.FAILED, {
        device: workflowIds(this.gladys, execution.workflowId).device,
        workflow: name,
        error: detail.message,
        node: detail.node,
        execution_id: execution.id,
        execution_url: `${this.config.url}/workflow/${encodeURIComponent(execution.workflowId)}/executions/${encodeURIComponent(execution.id)}`,
      });
    }
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    this.failedReads += 1;
    if (wasError !== err.kind) {
      logger.warn(`n8n: ${err.message}`);
    }
    if (this.failedReads === this.timings.unreachableAfter && this.unreachableSince === null) {
      this.unreachableSince = this.now();
      await this.fire(TRIGGERS.UNREACHABLE, {
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
    }
    return wasError !== err.kind;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Views -------------------------------------------------------------------

  /** Failures of the window, by workflow id. */
  failureCounts() {
    const counts = new Map();
    for (const failure of Object.values(this.saved.failures)) {
      counts.set(failure.w, (counts.get(failure.w) ?? 0) + 1);
    }
    return counts;
  }

  /** The last error message kept for a workflow (the newest failure). */
  lastError(id) {
    let best = null;
    for (const failure of Object.values(this.saved.failures)) {
      if (failure.w === id && failure.message && (!best || failure.t > best.t)) {
        best = failure;
      }
    }
    return best ? { message: best.message, node: best.node ?? '' } : null;
  }

  /** What every view needs about a workflow. */
  view(workflow, counts = this.failureCounts()) {
    return {
      workflow,
      last: this.saved.last[workflow.id] ?? null,
      running: this.running.has(workflow.id),
      failures: counts.get(workflow.id) ?? 0,
    };
  }

  views() {
    const counts = this.failureCounts();
    return [...this.workflows.values()].map((workflow) => this.view(workflow, counts));
  }

  totals() {
    const workflows = [...this.workflows.values()];
    const counts = this.failureCounts();
    let failures = 0;
    for (const [id, count] of counts) {
      if (this.workflows.has(id)) {
        failures += count;
      }
    }
    return {
      active: workflows.filter((workflow) => workflow.active).length,
      failures,
      total: workflows.length,
      running: this.running.size,
    };
  }

  // --- Publishing to Gladys ----------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    const { language, allowToggle } = this.config;
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    return [
      buildInstanceDevice(this.gladys, language),
      ...[...this.workflows.values()].map((workflow) =>
        buildWorkflowDevice(this.gladys, workflow, { language, allowToggle }),
      ),
    ];
  }

  /** Publish the Discovery list when it changed (a workflow added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read n8n, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    const id = parseWorkflowId(this.gladys, device.external_id);
    if (id) {
      this.volatileAt.delete(id);
    }
    this.transports.delete(device.external_id);
    await this.publishStates({ changed: new Set(id ? [id] : []) });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   * @param {{ changed?: Set<string> }} options workflows whose volatile features go now
   */
  async publishStates({ changed = new Set() } = {}) {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const language = this.config.language;
    const now = this.now();
    const states = [];
    for (const view of this.views()) {
      const { id } = view.workflow;
      if (!this.isCreated(workflowIds(this.gladys, id).device)) {
        continue; // Gladys drops the states of a device not added
      }
      const volatileDue =
        changed.has(id) ||
        !this.volatileAt.has(id) ||
        now - this.volatileAt.get(id) >= this.timings.volatileEveryMs;
      if (volatileDue) {
        this.volatileAt.set(id, now);
      }
      for (const { key, ...state } of workflowValues(this.gladys, view, language)) {
        if (volatileDue || !VOLATILE.has(key)) {
          states.push(state);
        }
      }
    }
    if (this.isCreated(instanceIds(this.gladys).device)) {
      for (const { key: _key, ...state } of instanceValues(this.gladys, this.totals())) {
        states.push(state);
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local or cloud, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    let transport = isCloud(this.config.url) ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.LOCAL;
    if (this.error) {
      transport = DEVICE_TRANSPORTS.UNREACHABLE;
    }
    const entries = [];
    const ids = [
      instanceIds(this.gladys).device,
      ...[...this.workflows.keys()].map((id) => workflowIds(this.gladys, id).device),
    ];
    for (const externalId of ids) {
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (!this.config.apiKey) {
      return { connected: false, message: CONNECTION_TEXT.noKey };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands (switch, widget, scene actions, report) -----------------------

  /** The workflow of a device external id, null when it is not one (or no longer exists). */
  find(externalId) {
    const id = parseWorkflowId(this.gladys, externalId);
    return id ? (this.workflows.get(id) ?? null) : null;
  }

  /** Throws the reason n8n cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** An error of a command, in the language of the configuration. */
  commandError(err) {
    if (err instanceof N8nError) {
      const text = pick(ERROR_TEXT[err.kind], this.config.language);
      return new Error(err.reason ? `${text} (${err.reason})` : text);
    }
    return err;
  }

  /** The workflow of a device field, read again if unknown or stale. */
  async workflowOf(externalId) {
    this.assertReadable();
    if (!this.find(externalId)) {
      await this.refreshIfStale();
      this.assertReadable();
    }
    const workflow = this.find(externalId);
    if (!workflow) {
      throw new Error(pick(ACTION_TEXT.unknownWorkflow, this.config.language));
    }
    return workflow;
  }

  /** Publish or unpublish a workflow, then read n8n again. */
  async setActive(workflow, active) {
    try {
      await this.client.setActive(workflow.id, active);
    } catch (err) {
      throw this.commandError(err);
    }
    logger.info(`${workflow.name} ${active ? 'activated' : 'deactivated'}`);
    await this.pollAfterCommand();
  }

  /** The dashboard switch (onSetValue), when the configuration allows it. */
  async onSetValue(device, feature, value) {
    const id = parseWorkflowId(this.gladys, device.external_id);
    if (!id || feature.external_id !== workflowIds(this.gladys, id).feature(FEATURE_KEYS.ACTIVE)) {
      throw new Error(`Feature ${feature.external_id} cannot be set`);
    }
    if (!this.config.allowToggle) {
      throw new Error(pick(ACTION_TEXT.readOnly, this.config.language));
    }
    const workflow = await this.workflowOf(device.external_id);
    await this.setActive(workflow, Number(value) === 1);
  }

  /** "Test the connection": read n8n now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    const totals = this.totals();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const parts = [
        text.ok,
        text.workflows(totals.total),
        text.active(totals.active),
        text.failures(totals.failures),
      ];
      message[language] = labelled('n8n', parts.join(', '), language);
    }
    return message;
  }
}
