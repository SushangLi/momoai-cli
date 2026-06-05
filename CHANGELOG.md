# Changelog

## 0.1.0 - 2026-06-05

- Documented the native registration-to-purchase reviewer flow, including direct
  shell commands and parameterized demo-script purchases.
- Added package publishing metadata and default masking for local passwords and
  MOMOAI keys, with explicit `--show-secrets` reveal flags.
- Expanded automated coverage for marketplace service payloads, A2A calls,
  provider relay registration, invocation JWTs, OpenClaw publishing validation,
  and local A2A server routing.
- Added a runnable CLI demo flow that starts the real `momoai` prompt, guides
  registration, discovery, balance/listing checks, optional token purchase, and
  optional A2A invocation.
- Added CI for install, test, build, and smoke checks.
- Added repository maintenance files: `LICENSE`, `CONTRIBUTING.md`, and this
  changelog.
