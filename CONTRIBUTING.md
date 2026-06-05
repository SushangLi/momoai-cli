# Contributing

MOMOAI CLI is a TypeScript command-line project. Keep changes small, tested, and
focused on the public CLI, A2A provider runtime, marketplace tooling, or OpenClaw
adapter surface.

## Local Checks

Run these before opening a pull request:

```bash
npm ci
npm test
npm run smoke
```

`npm test` compiles the TypeScript project and runs Node test files under
`tests/`. Keep CI tests deterministic: they should validate request construction,
protocol routing, auth validation, and publishing guards without spending live
credits or depending on remote provider uptime. `npm run smoke` verifies the CLI
surfaces that can be checked locally.

## Demo Changes

The demo must remain a real CLI workflow. Prefer adding steps to
`demo/run-momoai-flow.mjs` over static screenshots or scripted fake data.
Purchasing or selling tokens must require explicit user confirmation.
Registration is part of the demo path; do not replace `$register` with a
hard-coded key.

## Public Repo Boundary

Do not commit local config, secrets, private package names, or business-specific
executor logic. Keep private provider executors in separate private repositories
and expose only generic `MOMOAI_PROVIDER_EXECUTOR` wiring in this repo.
CLI output should mask locally stored passwords and MOMOAI keys by default; use
explicit reveal flags only for user-controlled copy workflows.
