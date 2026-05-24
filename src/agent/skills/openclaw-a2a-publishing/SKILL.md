# OpenClaw A2A Publishing Skill

Use this when the user wants to publish a local OpenClaw agent on MOMOAI through A2A.

## Core Boundary

Do not modify OpenClaw official source code. Do not put momoai-cli in the runtime invocation path.

Split the integration:

- A public standard A2A OpenClaw plugin owns generic A2A protocol communication and the standard Agent Card.
- The MOMOAI A2A adapter plugin owns MOMOAI market metadata, platform invocation protection, and the protected provider URL registered with momoai.pro.

## Workflow

1. Plan before acting. Identify the local Gateway URL, standard A2A plugin source, MOMOAI profile, priced capabilities, and public provider URL.
2. Probe the local service, usually `http://127.0.0.1:18789`, for `/.well-known/agent-card.json` and a JSON-RPC A2A endpoint.
3. If standard A2A is missing, run `prepare_openclaw_a2a_market_service` or `$agent openclaw install-a2a`. This installs the configured public standard A2A plugin source first.
4. Install/configure the MOMOAI adapter plugin in OpenClaw. Its `protected_path` must differ from the standard `upstream_path`.
5. Restart OpenClaw Gateway after plugin changes, or run the install command with `--restart`.
6. Publish/update the MOMOAI listing with `provider_runtime external` and `provider_url` set to the public MOMOAI protected provider endpoint.
7. Only make the listing public after both the standard A2A endpoint and MOMOAI protected endpoint are reachable from momoai.pro.

## Commands

- `$agent openclaw install-a2a --profile <profile> --standard-plugin-source <source> --upstream-path /a2a/<profile> --protected-path /momoai/a2a/<profile> --provider-url https://<public-host>/momoai/a2a/<profile> --capabilities-file <path> --restart`
- If the public standard A2A plugin is already installed and working, add `--skip-standard-plugin`.
- Use `--allow-unauthenticated` only for local protocol testing.

## Notes

- Generic A2A skills should not contain MOMOAI pricing. Fixed `fixedTokens` values belong to MOMOAI listing/provider registration and the MOMOAI adapter market card.
- The standard A2A endpoint remains usable by generic agents. The MOMOAI protected endpoint is for paid marketplace invocations.
- Multiple OpenClaw services can coexist with distinct profiles and paths such as `/a2a/gomoku` plus `/momoai/a2a/gomoku`.
