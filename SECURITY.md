# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **n8n API key**, stored by Gladys in the integration configuration
  (never written to `/data`, never logged); it is only sent, in the
  `X-N8N-API-KEY` header, to the configured address, and redirects are not
  followed so it never reaches another host. It can activate and deactivate
  the workflows of its owner;
- the **webhook paths** typed in scenes, which are often the only protection of
  a workflow: never logged; the API key is never sent to a webhook;
- `/data/n8n-state.json`: the last execution of each workflow and the failures
  of the last 24 hours with their short error message (no secret, but an error
  message is whatever the workflow wrote);
- network: HTTP(S) requests to the n8n address and to the webhook URLs of the
  scenes, nothing else; no port is opened.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and n8n itself.
