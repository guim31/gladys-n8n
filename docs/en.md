# n8n

[n8n](https://n8n.io/) is a workflow automation tool you can host yourself:
nodes linked together fetch data, call services, send messages. This
integration brings your n8n workflows into Gladys: each workflow becomes a
device with its state (active or not, last execution succeeded or failed,
failures in the last 24 hours), scenes can **start a workflow** through its
Webhook node and use its answer, react when **any** execution fails or when n8n
stops answering, and a dashboard widget lists the failing workflows first.

Tested against a real self-hosted n8n 2.43 (Docker); not on n8n Cloud (same
API, untested): feedback welcome on
[the issues](https://github.com/guim31/gladys-n8n/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- n8n 1.x or 2.x, self-hosted, reachable from the Gladys machine (n8n Cloud
  should work too: same API).
- An n8n API key (Settings → n8n API). The public API must not be disabled
  (`N8N_PUBLIC_API_DISABLED`).

At each refresh (one minute by default) the integration sends four requests to
the API of n8n, and a few more the first time. n8n sets no rate limit on its
API; on n8n Cloud, check the limits of your plan.

## Getting started

### 1. Create an API key

In n8n, open **Settings → n8n API**, click **Create an API key**, give it a
label (`Gladys`) and no expiration, and copy the key: n8n shows it once. If
your n8n lets you choose the scopes of the key, tick `workflow:list`,
`workflow:activate`, `workflow:deactivate`, `execution:list` and
`execution:read`. The key sees the workflows of its owner.

### 2. Configure the integration

In Gladys, open the configuration of the n8n integration:

- **n8n address**: the address you open n8n with, for example
  `http://192.168.1.2:5678`. An IP address alone gets port 5678. A URL copied
  from the browser works too.
- **API key**: the key of step 1.
- **Refresh interval**: 30 seconds to 5 minutes.
- **Allow switching workflows from Gladys**: off by default, see below.
- **Language of the names**: language of the feature names, of the states and
  of the scene results.

Click **Test the connection**: it shows the workflows, the active ones and the
failures of the last 24 hours.

### 3. Add the workflows

Open the **Discover** tab of the integration and add the workflows to follow,
and the **n8n** device if you want the figures of the whole instance. Nothing
is added on your behalf. The scene triggers work for every workflow, added or
not.

## The devices

Each workflow (archived ones left out) gives a device:

| Feature           | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Active            | the workflow is active (published) or not                      |
| Last execution    | Succeeded, Failed, Crashed, Canceled, Waiting, Running…        |
| Working           | No when the last execution failed, Yes otherwise (green / red) |
| Failures in 24 h  | failed executions over the last 24 hours                       |
| Last run          | start of the last execution, day/month hours:minutes           |
| Last run duration | of the last execution, in seconds                              |

The **Active** switch only shows the state by default. With **Allow switching
workflows from Gladys** on, it activates and deactivates the workflow: click
**Update** on the devices in the Discover tab after changing the option.

The **n8n** device gives the **Active workflows**, the **Failures in 24 h**
and the **Workflows in total**.

## Dashboard

The **n8n workflows** widget shows three tiles (active workflows, failures in
24 hours, executions running), then one row per workflow: the failing ones
first, then the running ones, then the others, with the state of the last
execution, when it started and the failures of the day. By default it lists the
active workflows; choose others in its settings (devices added to Gladys). The
**Refresh** button reads n8n again.

## Scenes

### Triggers

- **A workflow execution fails**: an execution of a workflow ends in error (or
  crashes). Filter: the workflows (empty: any). Information passed on: workflow
  name, error message, failing node, execution number, link to the execution
  in n8n.
- **n8n is unreachable**: two reads in a row failed. Information passed on: the
  reason.
- **n8n answers again**: after being unreachable, with the outage length in
  minutes.

The first reading only notes what already happened: nothing is announced for
the past. A failure that happens while Gladys or the integration restarts is
announced once, at the next reading.

### Actions

- **Start an n8n workflow**: the n8n API cannot run a workflow, its **Webhook**
  node can. In n8n, add a Webhook trigger node, set its **HTTP Method** to
  `POST`, give it a **Path** (`gladys-hello`) and activate the workflow. In the
  scene, enter that path (or the whole **Production URL** of the node) and a
  body: JSON such as `{"room": "living room"}`, or a text sent as
  `{"text": "…"}`; scene values can be inserted. Results: answered
  successfully, HTTP status (0 when no answer came within 25 seconds), message
  answered (the `message` or `text` field of the answer), full answer. To get
  an answer, set **Respond** to "When Last Node Finishes" or use a "Respond to
  Webhook" node; a workflow longer than 25 seconds should respond immediately.
- **State of a workflow**: active or not, last execution failed or not, state,
  failures in 24 h, last run, duration, last error and a ready-made sentence,
  for the next actions (a message, a condition).
- **Activate a workflow** / **Deactivate a workflow**: for example a workflow
  that should only run during the holidays. These actions work whatever the
  option of the switch.

### Scene ideas

- **A workflow execution fails** → send a message: "n8n: {workflow} failed in
  {node}: {error}" with the link to the execution.
- A button on the dashboard or "I am leaving" → **Start an n8n workflow**
  `gladys-leaving` with `{"user": "…"}`, then send the **Message answered** by
  the workflow.
- **n8n is unreachable** → send a message, and turn on a light in the office.
- Every morning → **State of a workflow** "Nightly backup" → only continue if
  "Last execution failed" is true → send the **Sentence**.

## Troubleshooting

- **API key refused**: the key was deleted, expired, or copied incompletely.
  Create a new one.
- **Refused by n8n: the API key lacks a scope**: give the key the scopes of
  step 1, or use a key of the owner of the workflow.
- **No n8n API at this address**: check the address (port 5678 by default) and
  that the public API is enabled. Behind a reverse proxy with a sub-path, put
  the sub-path in the address.
- **The address redirects**: enter the `https://` address.
- **Certificate refused**: a self-signed certificate is not accepted; use the
  `http://` address on the local network.
- **The webhook answers 404 "not registered"**: the workflow is not active, the
  path is wrong, or the Webhook node does not accept `POST`. A test URL
  (`/webhook-test/`) only works while the editor listens.
- **No failure is seen**: n8n must save the failed executions
  (`EXECUTIONS_DATA_SAVE_ON_ERROR`, on by default). Successful executions not
  saved (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`) leave "Last execution" on the
  last failure.
- Logs: in Gladys, the integration page shows the logs of its container;
  `LOG_LEVEL=debug` gives every reading.

## Limits

- One n8n instance per configuration; the key sees the workflows of its owner.
- Workflows are not created or edited from Gladys.
- The first reading counts 500 failed executions of the last 24 hours at most,
  and at most 10 failures are announced per reading.
- The webhook body is JSON only; webhooks protected by header or basic
  authentication are not supported (use a hard-to-guess path).
- n8n Cloud is untested.
