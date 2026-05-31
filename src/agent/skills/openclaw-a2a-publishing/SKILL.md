# OpenClaw A2A Publishing Skill

Use this when the user wants the CLI to publish one or more capabilities from a local OpenClaw Gateway to MOMOAI.

## Core Boundary

- This is a MOMOAI CLI operating skill, not an OpenClaw business skill.
- Do not modify OpenClaw official source code.
- Do not put momoai-cli in the runtime invocation path.
- Do not create, install, or rely on capability-specific plugins for MOMOAI OpenClaw publishing.
- Publish different OpenClaw abilities by configuring A2A capabilities with local skill instructions.

## Required Inputs

Before publishing, identify:

- Profile name, normally `openclaw`.
- Local OpenClaw Gateway URL, normally `http://127.0.0.1:18789`.
- Public agent name and description.
- One or more capabilities, each with `id`, `name`, `description`, `fixedTokens`, input/output modes, and `skill.instructions`.
- Whether the listing should become public after provider verification.

Do not invent missing capability ids, prices, or instructions. Ask the user when they are missing.

## Workflow

1. For read-only local checks or clone-like requests such as "publish a new one like this profile", call `list_local_agent_profiles` first. It returns complete local profile metadata, capabilities, format contracts, and bound skill instructions. Do not call publish or update tools for `check`, `list`, `show`, or `status` requests.
2. Before installing, publishing, or skipping any OpenClaw setup, call `inspect_openclaw_a2a_stack`. Treat "already installed" as true only when the inspection shows a working standard A2A Agent Card/endpoint and MOMOAI adapter market/protected endpoints for the target service.
3. For publishing OpenClaw, call `publish_openclaw_a2a_service` instead of `publish_local_agent_listing` or manually chaining lower-level tools. The publish tool repeats local inspection internally before it installs or configures anything.
4. Use `websocket` by default. Use `funnel` only when the user provides a public MOMOAI protected provider URL.
5. Pass all capabilities explicitly. Every enabled priced capability must have a local skill binding with executable instructions.
6. Keep capability-specific behavior in `skill.instructions`. The generic OpenClaw A2A skill router is the only supported capability execution layer; it selects the skill by `metadata.capability_id` and injects those instructions into OpenClaw.
7. Keep MOMOAI pricing in the listing and market adapter metadata. Generic A2A Agent Cards should only describe communication capabilities.
8. Publish publicly only after the provider is online. If provider verification fails, leave the listing delisted and explain the next action.

If the plan says to ask, clarify, gather metadata, or select between service types, ask the concrete missing question and stop. Do not call publishing tools in that same turn.

## Tools

- `list_local_agent_profiles`: Read-only local profile inspection, including capabilities and bound skill instructions.
- `inspect_openclaw_a2a_stack`: Read-only OpenClaw machine-state inspection. Use it to prove whether the target service already exposes standard A2A and MOMOAI adapter endpoints before deciding to install or skip setup.
- `publish_openclaw_a2a_service`: High-level workflow for creating/updating the platform listing, inspecting local state, installing/configuring missing or required OpenClaw pieces, registering the provider, and optionally making the listing public.
- `prepare_openclaw_a2a_market_service` and `$agent openclaw install-a2a`: Low-level install/debug path. Use only when the user explicitly asks for manual installation or troubleshooting.

## Notes

- The standard A2A OpenClaw plugin owns generic A2A communication and Agent Card discovery.
- The OpenClaw A2A skill router owns mapping `metadata.capability_id` to local skill instructions.
- The MOMOAI A2A adapter owns market metadata, platform invocation protection, and the WebSocket relay or Funnel protected endpoint.
- Multiple OpenClaw services can coexist with distinct profiles and paths such as `/a2a/gomoku` plus `/momoai/a2a/gomoku`.
- Test structured output with `$agent call <endpoint> '<input>' --capability <id> --output-mode application/json --json`.
