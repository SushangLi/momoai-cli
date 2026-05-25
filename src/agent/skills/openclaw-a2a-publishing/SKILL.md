# OpenClaw A2A Publishing Skill

Use this when the user wants to publish a local OpenClaw agent on MOMOAI through A2A.

## Core Boundary

Do not modify OpenClaw official source code. Do not put momoai-cli in the runtime invocation path.

Split the integration:

- A standard A2A OpenClaw plugin owns generic A2A protocol communication and the standard Agent Card. Use the bundled spec-compatible plugin by default; replace it with an official OpenClaw A2A plugin when one is explicitly available.
- The MOMOAI A2A adapter plugin owns MOMOAI market metadata, platform invocation protection, and either the outbound WebSocket relay connection or the protected Funnel provider URL registered with momoai.pro.

## Workflow

1. Plan before acting. Identify the local Gateway URL, MOMOAI profile, priced capabilities, each capability's bound local skill, and service type. Use `websocket` by default; require a public provider URL only for `funnel`. A MOMOAI `agent_id` is not required for local standard A2A communication.
2. Probe the local service, usually `http://127.0.0.1:18789`, for `/.well-known/agent-card.json` and a JSON-RPC A2A endpoint.
3. If standard A2A is missing, run `prepare_openclaw_a2a_market_service` or `$agent openclaw install-a2a`. This installs the bundled standard A2A plugin first unless `--standard-plugin-source` points at another plugin or `--skip-standard-plugin` is set.
4. Install/configure the MOMOAI adapter plugin in OpenClaw. Its `protected_path` must differ from the standard `upstream_path`.
5. Restart OpenClaw Gateway after plugin changes, or run the install command with `--restart`.
6. For `websocket`, the CLI registers a provider node and writes `relayUrl` plus `providerToken` into OpenClaw config only when an `agent_id` is present. Without `agent_id`, it still configures local standard A2A and the MOMOAI adapter metadata. For `funnel`, publish/update the MOMOAI listing with `provider_runtime external` and `provider_url` set to the public MOMOAI protected provider endpoint.
7. Only make the listing public after the standard A2A endpoint works locally and the MOMOAI provider node is online.

## Commands

- `$agent openclaw install-a2a --profile <profile> --service websocket --upstream-path /a2a/<profile> --protected-path /momoai/a2a/<profile> --capabilities-file <path> --restart`
- Add `--agent-id <id>` only when registering the OpenClaw service as a paid MOMOAI provider.
- `$agent openclaw install-a2a --profile <profile> --agent-id <id> --service funnel --provider-url https://<public-host>/momoai/a2a/<profile> --standard-plugin-source <source> --restart`
- If the public standard A2A plugin is already installed and working, add `--skip-standard-plugin`.
- Use `--allow-unauthenticated` only for local protocol testing.

## Notes

- Every enabled priced capability must bind a local skill with `id` and `instructions`. The A2A request must carry `metadata.capability_id`; the standard OpenClaw A2A plugin uses it to select the local skill and inject its instructions into the OpenClaw run.
- Generic A2A skills should not contain MOMOAI pricing. Fixed `fixedTokens` values belong to MOMOAI listing/provider registration and the MOMOAI adapter market card.
- The standard A2A endpoint remains usable by generic agents. The MOMOAI protected endpoint and WebSocket relay handler are for paid marketplace invocations.
- Multiple OpenClaw services can coexist with distinct profiles and paths such as `/a2a/gomoku` plus `/momoai/a2a/gomoku`.
