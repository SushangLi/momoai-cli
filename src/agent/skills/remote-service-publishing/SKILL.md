# Remote Service Publishing Skill

This agent can help the user publish, update, and run local CLI agent profiles or already-running external A2A services as MOMOAI remote services. The goal is to make a local or privately hosted machine provide one or more billable A2A services through the MOMOAI platform gateway.

## Available Tools

- `publish_local_agent_listing`: Create a delisted MOMOAI A2A remote-service draft for a local profile. Use it after the plan defines the profile name, public name, description, capabilities, and fixed result-token prices.
- `update_local_agent_listing`: Update an existing remote-service listing for a local profile. Use it to change name, description, price, capabilities, available inventory, or visibility.
- `list_local_agent_profiles`: Read-only inspection of complete local CLI profiles, including capabilities, format contracts, and bound skill instructions.
- `inspect_openclaw_a2a_stack`: Read-only OpenClaw machine-state inspection. Use it before publishing OpenClaw so the agent proves whether required plugins/endpoints are already present instead of assuming.
- `publish_openclaw_a2a_service`: High-level OpenClaw publishing workflow. Prefer it when the user wants to publish local OpenClaw capabilities.

## CLI Commands

- `$agent profile list`: Show local profiles and stored platform agent ids.
- `$agent profile set <profile> --name <name> --description <text> --capabilities-file <path> --service websocket|funnel --provider-runtime cli|external --provider-url <url>`: Save or update a local profile.
- `$agent publish --profile <profile> --name <name> --capabilities-file <path> --service websocket|funnel --provider-runtime cli|external --provider-url <url>`: Create a delisted A2A draft on MOMOAI and save the returned `agent_id` into the profile.
- `$agent connect --profile <profile>`: Start the provider for that profile. Keep this process running.
- `$agent connect --profile <profile>` defaults to realtime WebSocket relay. It opens an outbound connection to momoai.pro and does not require an inbound public port.
- `$agent connect --profile <profile> --service funnel --provider-url https://<public-or-tunnel-host>/a2a`: Register a public direct provider URL. For CLI runtime, the CLI starts the local A2A server; for external runtime, the external agent owns the endpoint.
- `$agent expose tailscale --profile <profile> --kind cli`: Prepare Tailscale Funnel paths for a CLI-hosted direct provider.
- `$agent connect --profile <profile> --provider-runtime external --service funnel --provider-url https://<agent-host>/a2a`: Register an already-running external A2A service. The platform calls that endpoint directly; the CLI does not proxy traffic or start a server.
- `$agent openclaw publish --profile <profile> --capabilities-file <path> --public --restart`: Create/update the platform listing, install/configure OpenClaw standard A2A, generic skill router, and MOMOAI adapter plugins, register the provider, and publish only after provider verification.
- `$agent openclaw install-a2a --profile <profile> --agent-id <id> --service websocket --restart`: Low-level OpenClaw A2A plugin installation/debug command. OpenClaw, not the CLI, owns the runtime connection.
- `$agent update-listing --profile <profile> --public`: Publish the listing publicly after the provider node is online.
- `$agent update-listing --profile <profile> --delisted`: Hide the listing again.
- `$agent card --profile <profile> --mode remote_service --json`: Inspect the exposed A2A capability card.
- `$agent call <endpoint> '<input>' --capability <id> --output-mode application/json --json`: Request and verify a structured A2A result.

## Workflow

1. Plan before acting. Identify the target profile, public name, description, capabilities, each capability's bound local skill, fixed result-token prices, and whether the service should remain delisted. For clone-like requests, call `list_local_agent_profiles` first and copy the source profile's capabilities and skill instructions while clearing the source `agent_id` by using a new profile name.
2. Confirm every enabled capability has a stable `id`, user-facing `name`, concise `description`, positive `fixedTokens`, and a `skill` object with `id` plus executable `instructions`. Also set capability `inputModes`, `outputModes`, and `formatContract` when callers need structured results instead of free-form text. For OpenClaw publishing, deterministic or domain-specific behavior must be expressed through the generic A2A skill router's bound instructions, not capability-specific plugins, the standard A2A communication plugin, or the MOMOAI market adapter.
3. Create or update the profile locally.
4. Publish CLI-runtime profiles with `publish_local_agent_listing` or `$agent publish`; this creates a delisted draft first. Do not use generic publishing for `provider_runtime=external` plus `service_type=websocket`.
5. Choose a service type:
   - `websocket`: default and realtime. The provider opens an outbound WebSocket to MOMOAI relay, so no public inbound port is needed.
   - `funnel`: direct public endpoint. It requires a provider URL that momoai.pro can reach, usually Tailscale Funnel or another HTTPS tunnel ending in the protected A2A provider path.
   - `external`: use with `service_type funnel` for a pure already-running public A2A endpoint. Use `service_type websocket` only through a provider-specific workflow, such as `inspect_openclaw_a2a_stack` followed by `publish_openclaw_a2a_service`, because that workflow must verify/install the local adapter that owns the relay connection.
6. For `provider-runtime cli`, ask the user to run `$agent connect --profile <profile> --service <websocket|funnel>` and keep it online. For pure external Funnel services, run `$agent connect --profile <profile> --provider-runtime external --service funnel --provider-url <url>` only to register the endpoint; the CLI exits after registration and is not in the request path. For OpenClaw, use `$agent openclaw publish --service websocket --restart` so the standard A2A plugin, generic skill router, and MOMOAI adapter are installed together and the adapter stores relay credentials directly in OpenClaw.
7. Only after the provider is online, update the listing to public.
8. For changes to capabilities or prices, update the profile and listing, then reconnect if the running provider needs the new local profile data.

## Billing Rules

- A2A agent billing is fixed-result billing by capability.
- The capability card is discovery and billing metadata; the local `skill` binding is the runtime contract. Do not publish a priced capability unless the local runtime can map `metadata.capability_id` to that skill.
- `formatContract` is MOMOAI market metadata, not generic A2A pricing. It declares supported input/output media and expected schemas; the actual request still uses A2A `acceptedOutputModes`.
- Keep billing data in MOMOAI listing/provider registration or a MOMOAI market adapter record. Do not require generic A2A Agent Cards to carry pricing fields.
- The caller pays the selected capability's fixed token amount only when the task returns `completed`.
- Failed, expired, canceled, or non-completed tasks are not charged.
- Internal model/tool usage is not exposed as continuous caller billing on this A2A path.

## Multi-Agent Hosting

- One machine can host multiple CLI agent profiles.
- The platform routes by `agent_id`; each running provider process is tied to one profile and one platform agent id.
- WebSocket providers do not require public inbound ports. Multiple profiles can run as separate CLI processes without port conflicts.
- CLI Funnel providers require a distinct local `host:port` per concurrently running profile, plus a distinct public/tunnel `provider-url` that forwards to that profile's protected A2A path.
- External A2A providers are not served by the CLI. Their own service owns the listening port and protocol behavior; if they use WebSocket, their MOMOAI adapter owns the relay connection.
- The provider URL is stored for platform routing and should not be exposed in the public agent card.

## Constraints

- Do not make a listing public before an online provider node exists.
- Do not invent capability ids or fixed token prices. Ask the user when missing.
- Do not call publishing or update tools in the same turn as a plan whose next step is to ask, clarify, gather metadata, or select a service type. Ask the user the concrete missing question and stop.
- Do not publish a new agent from invented capabilities. A new listing must use capabilities copied from `list_local_agent_profiles` or capabilities explicitly provided by the user in the current conversation.
- Do not set `fixedTokens` to zero or a negative number.
- Do not publish OpenClaw capabilities with `handler`, `pluginId`, or `pluginSource`; OpenClaw publishing uses the generic skill router only.
- Do not tell users to configure platform private signing keys on their machine; providers normally verify platform JWTs through MOMOAI JWKS.
- Do not use `funnel` unless the endpoint is reachable by momoai.pro and protected by the platform invocation JWT.
