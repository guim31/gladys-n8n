# n8n for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the workflows of a self-hosted [n8n](https://n8n.io/) into Gladys,
and lets Gladys scenes start them.

- **One device per workflow**: active switch (read-only by default, writable
  as an option), state of the last execution (succeeded, failed, running…), a
  green/red "working" badge, failures in the last 24 hours, last run and its
  duration.
- **One instance device**: active workflows, failures in 24 hours, workflows
  in total.
- **Scene triggers**: a workflow execution fails (workflow, node, error
  message, link to the execution) — for any workflow, added to Gladys or not;
  n8n is unreachable; n8n answers again.
- **Scene actions**: start an n8n workflow through its Webhook node, with a
  JSON body built from scene values, and get its answer back; state of a
  workflow (with a ready-made sentence); activate / deactivate a workflow.
- **Dashboard widget**: failing workflows first, then the running ones, then
  the others.
- Texts in English, French, German and Spanish.

Tested against a real self-hosted n8n 2.43 (Docker): API key, workflows
imported through the API, webhooks that answer, fail and wait, real
executions. Not tested on n8n Cloud (same API): feedback welcome on
[the issues](https://github.com/guim31/gladys-n8n/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- n8n 1.x or 2.x reachable from the Gladys machine, its public API enabled,
  and an API key (Settings → n8n API).

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-n8n`. Then open its configuration, enter
the address of n8n and the API key, and add the workflows from the Discover
tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

At the chosen interval (one minute by default) the container reads the public
API v1 of n8n: the workflows, the latest executions, the running ones and the
failed ones of the last 24 hours. It publishes the states of the devices added
to Gladys when they change and fires "a workflow execution fails" once per
failed execution, with the error read from the execution. The last execution
of each workflow and the failures of the day are kept in `/data`, so a failure
that happened during a restart is announced once. The API cannot run a
workflow: "Start an n8n workflow" calls its production webhook (without the
API key). Redirects are not followed, so the API key never reaches another
host.

## Limits

- One n8n instance per configuration; the API key sees the workflows of its
  owner.
- Workflows are not created or edited from Gladys.
- Webhooks protected by header or basic authentication are not supported.
- A self-signed HTTPS certificate is not accepted (use `http://` on the local
  network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the n8n API.

## Credits

- [n8n](https://github.com/n8n-io/n8n) by n8n GmbH and contributors
  ([Sustainable Use License](https://docs.n8n.io/sustainable-use-license/)):
  this integration only talks to its public API; the answers in
  `test/fixtures/n8n` come from its Docker image.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-healthchecks](https://github.com/guim31/gladys-healthchecks).

Not affiliated with n8n GmbH.

## License

Apache-2.0, see [LICENSE](LICENSE).
