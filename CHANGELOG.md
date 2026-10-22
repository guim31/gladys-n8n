# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-17

### Added

- One device per n8n workflow: active switch (read-only unless allowed in the
  configuration), state of the last execution, working (green / red), failures
  in the last 24 hours, last run and its duration.
- One device for the instance: active workflows, failures in 24 hours,
  workflows in total.
- Scene triggers: a workflow execution fails (with the workflow, the node, the
  error and a link to the execution), n8n is unreachable, n8n answers again.
- Scene actions: start an n8n workflow through its webhook with a JSON body and
  get its answer, state of a workflow (with a ready-made sentence), activate
  and deactivate a workflow.
- Dashboard widget: failing workflows first, then the running ones, then the
  others.
- "Test the connection" action, texts and documentation in English, French,
  German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-n8n/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-n8n/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-n8n/releases/tag/v1.0.0
