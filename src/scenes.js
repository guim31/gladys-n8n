// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Start a workflow": the n8n API cannot run a workflow, its Webhook node
// can. The scene names the webhook (its path or Production URL) and sends a
// JSON body built from scene variables; the answer of the workflow comes back
// as outputs when it arrives in time ("Respond: When Last Node Finishes" or a
// "Respond to Webhook" node), so a scene can say what n8n answered.
//
// "Is this workflow failing?" is already a condition on the device feature.
// "State of a workflow" is about what a condition cannot do: put the state,
// the failures and the last error in a message, for a workflow added or not.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { durationOf, lastFailed, stateOf } from './devices.js';
import { ERROR_KINDS, N8nClient, N8nError, webhookUrl } from './n8n/client.js';
import {
  ACTION_TEXT,
  ACTIVE_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  SENTENCE_TEXT,
  STATE_TEXT,
  formatTime,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'n8n-scenes' });

// What the workflow answered, kept for the next actions (the core caps an
// output at 10 000 characters).
export const MAX_RESPONSE = 2000;
export const WEBHOOK_TIMEOUT_MS = 25_000;

/**
 * The JSON body sent to the webhook: the text of the field when it is a JSON
 * object or array (scene variables already replaced by Gladys), `{ text }`
 * otherwise, `{}` when empty.
 */
export function bodyOf(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return {};
  }
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object') {
      return value;
    }
  } catch {
    // Plain text.
  }
  return { text: raw };
}

/** The `message` output: a text the workflow answered, ready for a notification. */
export function messageOf(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return body.trim();
  }
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value === 'string') {
    return value;
  }
  for (const key of ['message', 'text', 'answer', 'response']) {
    if (value && typeof value[key] === 'string') {
      return value[key];
    }
  }
  return '';
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const SCENE_ACTIONS = {
  async run_workflow(hub, { fields = {} }) {
    const language = hub.config.language;
    if (!hub.config.url) {
      const text = hub.config.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl;
      throw new Error(pick(text, language));
    }
    const url = webhookUrl(hub.config.url, fields.path);
    if (!url) {
      throw new Error(pick(ACTION_TEXT.badPath, language));
    }
    const client = new N8nClient({ url: hub.config.url, apiKey: '', request: hub.request });
    let response;
    try {
      response = await client.callWebhook(url, bodyOf(fields.body), {
        timeoutMs: WEBHOOK_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof N8nError && err.kind === ERROR_KINDS.TIMEOUT) {
        // The workflow probably runs on: no answer to hand over.
        logger.info(`Webhook called: no answer within ${WEBHOOK_TIMEOUT_MS / 1000} s`);
        return { success: false, status: 0, response: '', message: '' };
      }
      if (!(err instanceof N8nError)) {
        throw err;
      }
      throw new Error(pick(ERROR_TEXT[err.kind], language), { cause: err });
    }
    const success = response.status >= 200 && response.status < 300;
    // Never the path: it is the secret of the webhook.
    const line = `Webhook called: HTTP ${response.status}`;
    if (success) {
      logger.info(line);
    } else {
      logger.warn(line);
    }
    const body = response.body ?? '';
    return {
      success,
      status: response.status,
      response: cut(body, MAX_RESPONSE),
      message: cut(messageOf(body), MAX_RESPONSE),
    };
  },

  async activate_workflow(hub, { fields = {} }) {
    await hub.setActive(await hub.workflowOf(fields.device), true);
  },

  async deactivate_workflow(hub, { fields = {} }) {
    await hub.setActive(await hub.workflowOf(fields.device), false);
  },

  async get_workflow_status(hub, { fields = {} }) {
    await hub.workflowOf(fields.device);
    await hub.refreshIfStale();
    const workflow = await hub.workflowOf(fields.device);
    const language = hub.config.language;
    const view = hub.view(workflow);
    const stateText = pick(STATE_TEXT[stateOf(view)], language);
    const lastRun = view.last?.startedAt ? formatTime(view.last.startedAt, language) : '';
    const error = view.last && lastFailed(view) ? (hub.lastError(workflow.id)?.message ?? '') : '';
    const words = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    const parts = [
      `${labelled(workflow.name, stateText, language)} (${pick(ACTIVE_TEXT[workflow.active], language)})`,
      lastRun ? words.lastRun(lastRun) : words.never,
    ];
    if (view.failures > 0) {
      parts.push(words.failures(view.failures));
    }
    return {
      active: workflow.active,
      state: stateText,
      failed: lastFailed(view) === 1,
      failures_24h: view.failures,
      last_run: lastRun,
      duration: durationOf(view.last) ?? 0,
      error,
      sentence: `${parts.join(', ')}.${error ? ` ${error}` : ''}`,
    };
  },
};
