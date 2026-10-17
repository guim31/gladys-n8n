// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//
//   - one device per n8n workflow, identified by its workflow id:
//       active         switch/binary  published (active) or not; read-only
//                                     unless "Allow switching" is on
//       state          text/text      last execution: "Succeeded", "Failed"…,
//                                     or "Running" (configuration language)
//       working        input/binary   0 when the last execution failed, 1
//                                     otherwise (input/binary is green at 1)
//       failures_24h   counter-sensor/integer  failed executions, last 24 h
//       last_run       text/text      start of the last execution, day/month
//                                     hours:minutes
//       last_duration  duration/decimal (s)    of the last finished execution
//
//   - one "n8n" device for the instance: active workflows, failures in the
//     last 24 h, workflows in total.
//
// Published with should_poll: false: the integration reads n8n on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { STATE_TEXT, formatTime, pick } from './texts.js';

export const WORKFLOW_TYPE = 'workflow';
export const INSTANCE_TYPE = 'instance';
export const INSTANCE_ID = 'summary';
export const MODEL = 'n8n';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ACTIVE: 'active',
  STATE: 'state',
  WORKING: 'working',
  FAILURES_24H: 'failures_24h',
  LAST_RUN: 'last_run',
  LAST_DURATION: 'last_duration',
});

export const INSTANCE_KEYS = Object.freeze({
  ACTIVE: 'active_workflows',
  FAILURES_24H: 'failures_24h',
  TOTAL: 'total_workflows',
});

// These change at every execution: published at most every few minutes
// (src/hub.js); the state and the failures go at once.
export const VOLATILE = new Set([FEATURE_KEYS.LAST_RUN, FEATURE_KEYS.LAST_DURATION]);

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.ACTIVE]: 'Active',
    [FEATURE_KEYS.STATE]: 'Last execution',
    [FEATURE_KEYS.WORKING]: 'Working',
    [FEATURE_KEYS.FAILURES_24H]: 'Failures in 24 h',
    [FEATURE_KEYS.LAST_RUN]: 'Last run',
    [FEATURE_KEYS.LAST_DURATION]: 'Last run duration',
    [INSTANCE_KEYS.ACTIVE]: 'Active workflows',
    [INSTANCE_KEYS.TOTAL]: 'Workflows in total',
  },
  fr: {
    [FEATURE_KEYS.ACTIVE]: 'Actif',
    [FEATURE_KEYS.STATE]: 'Dernière exécution',
    [FEATURE_KEYS.WORKING]: 'Fonctionne',
    [FEATURE_KEYS.FAILURES_24H]: 'Échecs sur 24 h',
    [FEATURE_KEYS.LAST_RUN]: 'Dernier lancement',
    [FEATURE_KEYS.LAST_DURATION]: 'Durée de la dernière exécution',
    [INSTANCE_KEYS.ACTIVE]: 'Workflows actifs',
    [INSTANCE_KEYS.TOTAL]: 'Workflows au total',
  },
  de: {
    [FEATURE_KEYS.ACTIVE]: 'Aktiv',
    [FEATURE_KEYS.STATE]: 'Letzte Ausführung',
    [FEATURE_KEYS.WORKING]: 'Funktioniert',
    [FEATURE_KEYS.FAILURES_24H]: 'Fehlschläge in 24 h',
    [FEATURE_KEYS.LAST_RUN]: 'Letzter Start',
    [FEATURE_KEYS.LAST_DURATION]: 'Dauer der letzten Ausführung',
    [INSTANCE_KEYS.ACTIVE]: 'Aktive Workflows',
    [INSTANCE_KEYS.TOTAL]: 'Workflows insgesamt',
  },
  es: {
    [FEATURE_KEYS.ACTIVE]: 'Activo',
    [FEATURE_KEYS.STATE]: 'Última ejecución',
    [FEATURE_KEYS.WORKING]: 'Funciona',
    [FEATURE_KEYS.FAILURES_24H]: 'Fallos en 24 h',
    [FEATURE_KEYS.LAST_RUN]: 'Último inicio',
    [FEATURE_KEYS.LAST_DURATION]: 'Duración de la última ejecución',
    [INSTANCE_KEYS.ACTIVE]: 'Workflows activos',
    [INSTANCE_KEYS.TOTAL]: 'Workflows en total',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_FAILURES = 100_000;
export const MAX_DURATION_S = 7 * 24 * 3600;
export const MAX_WORKFLOWS = 10_000;

export const FAILED = new Set(['error', 'crashed']);

/**
 * The state of a workflow: "running" while an execution runs, otherwise the
 * status of its last execution, "never" without one.
 * @param {object} view `{ running, last }` (src/hub.js)
 */
export function stateOf(view) {
  if (view.running) {
    return 'running';
  }
  return view.last ? view.last.status : 'never';
}

/** 1 when the last finished execution failed (a running one changes nothing). */
export const lastFailed = (view) => (view.last && FAILED.has(view.last.status) ? 1 : 0);

/** Duration of the last execution in seconds (0.1 s), null when unknown. */
export function durationOf(execution) {
  if (!execution || execution.startedAt === null || execution.stoppedAt === null) {
    return null;
  }
  const seconds = (execution.stoppedAt - execution.startedAt) / 1000;
  return seconds >= 0 ? Math.round(seconds * 10) / 10 : null;
}

export const workflowIds = (gladys, id) => gladys.externalIds(WORKFLOW_TYPE, id);
export const instanceIds = (gladys) => gladys.externalIds(INSTANCE_TYPE, INSTANCE_ID);

/** The workflow id of a device external id, null when it is not a workflow of ours. */
export function parseWorkflowId(gladys, externalId) {
  const prefix = workflowIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  });

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

/**
 * The discovery payload of a workflow.
 * @param {object} workflow normalized (src/n8n/client.js)
 * @param {{ language?: string, allowToggle?: boolean }} [options]
 */
export function buildWorkflowDevice(
  gladys,
  workflow,
  { language = 'en', allowToggle = false } = {},
) {
  const ids = workflowIds(gladys, workflow.id);
  const names = NAMES[language] ?? NAMES.en;
  const params = [{ name: 'WORKFLOW_ID', value: workflow.id }];
  if (workflow.tags) {
    params.push({ name: 'TAGS', value: workflow.tags.slice(0, 255) });
  }
  return {
    name: workflow.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features: [
      sensor(
        names[FEATURE_KEYS.ACTIVE],
        ids.feature(FEATURE_KEYS.ACTIVE),
        DEVICE_FEATURE_CATEGORIES.SWITCH,
        DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        { read_only: !allowToggle, keep_history: true, min: 0, max: 1 },
      ),
      text(names[FEATURE_KEYS.STATE], ids.feature(FEATURE_KEYS.STATE)),
      sensor(
        names[FEATURE_KEYS.WORKING],
        ids.feature(FEATURE_KEYS.WORKING),
        DEVICE_FEATURE_CATEGORIES.INPUT,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        { keep_history: true, min: 0, max: 1 },
      ),
      counter(
        names[FEATURE_KEYS.FAILURES_24H],
        ids.feature(FEATURE_KEYS.FAILURES_24H),
        MAX_FAILURES,
      ),
      text(names[FEATURE_KEYS.LAST_RUN], ids.feature(FEATURE_KEYS.LAST_RUN)),
      sensor(
        names[FEATURE_KEYS.LAST_DURATION],
        ids.feature(FEATURE_KEYS.LAST_DURATION),
        DEVICE_FEATURE_CATEGORIES.DURATION,
        DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
        { unit: DEVICE_FEATURE_UNITS.SECONDS, keep_history: true, min: 0, max: MAX_DURATION_S },
      ),
    ],
  };
}

/** The discovery payload of the instance summary. */
export function buildInstanceDevice(gladys, language = 'en') {
  const ids = instanceIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: 'n8n',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: [
      counter(names[INSTANCE_KEYS.ACTIVE], ids.feature(INSTANCE_KEYS.ACTIVE), MAX_WORKFLOWS),
      counter(
        names[FEATURE_KEYS.FAILURES_24H],
        ids.feature(INSTANCE_KEYS.FAILURES_24H),
        MAX_FAILURES,
      ),
      counter(names[INSTANCE_KEYS.TOTAL], ids.feature(INSTANCE_KEYS.TOTAL), MAX_WORKFLOWS),
    ],
  };
}

/**
 * The value of every feature of a workflow: `{ key, device_feature_external_id,
 * state|text }`, nothing for a value that is not known.
 * @param {object} view `{ workflow, last, running, failures }` (src/hub.js)
 */
export function workflowValues(gladys, view, language) {
  const ids = workflowIds(gladys, view.workflow.id);
  const values = [
    { key: FEATURE_KEYS.ACTIVE, state: view.workflow.active ? 1 : 0 },
    { key: FEATURE_KEYS.STATE, text: pick(STATE_TEXT[stateOf(view)], language) },
    { key: FEATURE_KEYS.WORKING, state: 1 - lastFailed(view) },
    { key: FEATURE_KEYS.FAILURES_24H, state: view.failures },
  ];
  if (view.last?.startedAt) {
    values.push({ key: FEATURE_KEYS.LAST_RUN, text: formatTime(view.last.startedAt, language) });
  }
  const duration = durationOf(view.last);
  if (duration !== null) {
    values.push({ key: FEATURE_KEYS.LAST_DURATION, state: duration });
  }
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

/** The values of the instance summary. */
export function instanceValues(gladys, { active, failures, total }) {
  const ids = instanceIds(gladys);
  return [
    { key: INSTANCE_KEYS.ACTIVE, state: active },
    { key: INSTANCE_KEYS.FAILURES_24H, state: failures },
    { key: INSTANCE_KEYS.TOTAL, state: total },
  ].map(({ key, state }) => ({ key, device_feature_external_id: ids.feature(key), state }));
}
