// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `n8n`.
//
// The use case: a glance at the wall tablet tells whether the automations ran
// and which one fails. So the widget shows the active workflows, the failures
// of the last 24 hours and the executions running, then one row per workflow
// — the failing ones first, then the running ones, then the others — with
// the state of the last execution and when it started.
//
// The active workflows by default (an inactive one runs nothing), or the ones
// chosen in the widget settings (devices added to Gladys). The figures are
// sent as values, not bound to device features: the widget works before the
// devices are added.
//
// Budget (8 components, 2 texts): three tiles, one text when n8n does not
// answer, one status list of ten rows at most, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { lastFailed, stateOf } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ACTIVE_TEXT, CONNECTION_TEXT, ERROR_TEXT, STATE_TEXT, formatTime, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  empty: {
    en: 'No active workflow: activate one in n8n, or choose workflows in the widget settings.',
    fr: 'Aucun workflow actif : activez-en un dans n8n, ou choisissez des workflows dans les réglages du widget.',
    de: 'Kein aktiver Workflow: Aktiviere einen in n8n oder wähle Workflows in den Widget-Einstellungen.',
    es: 'Ningún workflow activo: active uno en n8n, o elija workflows en los ajustes del widget.',
  },
  active: { en: 'Active', fr: 'Actifs', de: 'Aktiv', es: 'Activos' },
  failures: { en: 'Failures 24 h', fr: 'Échecs 24 h', de: 'Fehler 24 h', es: 'Fallos 24 h' },
  running: { en: 'Running', fr: 'En cours', de: 'Laufend', es: 'En curso' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'n8n read again.',
    fr: 'n8n relu.',
    de: 'n8n neu gelesen.',
    es: 'n8n leído de nuevo.',
  },
};

// Row order: what needs attention first.
const rank = (view) => {
  if (lastFailed(view) && !view.running) {
    return 0;
  }
  if (view.running) {
    return 1;
  }
  if (view.failures > 0) {
    return 2;
  }
  return view.workflow.active ? 3 : 4;
};

const ROW_STYLE = {
  success: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
  error: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  crashed: { icon: 'x-octagon', color: WIDGET_COLORS.DANGER },
  canceled: { icon: 'slash', color: WIDGET_COLORS.NEUTRAL },
  running: { icon: 'play-circle', color: WIDGET_COLORS.INFO },
  waiting: { icon: 'clock', color: WIDGET_COLORS.INFO },
  new: { icon: 'play-circle', color: WIDGET_COLORS.INFO },
  never: { icon: 'circle', color: WIDGET_COLORS.NEUTRAL },
};
const INACTIVE_STYLE = { icon: 'pause-circle', color: WIDGET_COLORS.NEUTRAL };

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The workflows the widget shows: the chosen devices, or every active workflow. */
export function selectViews(hub, settings) {
  const chosen = [settings?.workflows ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length === 0) {
    return hub.views().filter((view) => view.workflow.active);
  }
  return [...new Set(chosen)]
    .map((id) => hub.find(id))
    .filter(Boolean)
    .map((workflow) => hub.view(workflow));
}

export function sortViews(views) {
  return [...views].sort(
    (a, b) => rank(a) - rank(b) || a.workflow.name.localeCompare(b.workflow.name),
  );
}

function rowValue(view, language) {
  const state = pick(STATE_TEXT[stateOf(view)], language);
  const parts = [view.workflow.active ? state : pick(ACTIVE_TEXT.false, language)];
  if (view.last?.startedAt) {
    parts.push(formatTime(view.last.startedAt, language));
  }
  if (view.failures > 0) {
    parts.push(`✗${view.failures}`);
  }
  return parts.join(' · ');
}

async function get(hub, { settings, language = 'en' }) {
  const status = hub.connectionStatus();
  if (!hub.client) {
    return message(status.message ?? CONNECTION_TEXT.noKey, language);
  }
  const views = sortViews(selectViews(hub, settings));
  if (views.length === 0 && !hub.error) {
    return message(TEXT.empty, language);
  }

  const failures = views.reduce((sum, view) => sum + view.failures, 0);
  const running = views.filter((view) => view.running).length;
  const components = [
    {
      type: 'value',
      value: views.filter((view) => view.workflow.active).length,
      label: pick(TEXT.active, language),
      icon: 'zap',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      value: failures,
      label: pick(TEXT.failures, language),
      icon: 'x-circle',
      color: failures > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: running,
      label: pick(TEXT.running, language),
      icon: 'play-circle',
      color: running > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    },
  ];

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  if (views.length > 0) {
    const shown = views.length > MAX_ROWS ? views.slice(0, MAX_ROWS - 1) : views;
    const items = shown.map((view) => ({
      label: fit(view.workflow.name, 40),
      value: fit(rowValue(view, language), 40),
      ...(view.workflow.active ? ROW_STYLE[stateOf(view)] : INACTIVE_STYLE),
    }));
    if (views.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${views.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  // Something running or failing moves: refresh sooner.
  const moving = hub.error || running > 0;
  return { ttl_seconds: moving ? 30 : 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
