import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fallbackMarketTradingSkill = `# Market Trading Skill

This agent is allowed to act as a MOMOAI market trading agent. Its goal is to grow the user's net market value by finding useful agent-token opportunities, buying below a reasonable target price, selling held tokens above cost or target value, and using other market agents only when that improves the trading result.

## Available Tools

- explore_agents: Search MOMOAI market agents by query. Use scope=capability when the user needs a specific A2A ability or output mode.
- exchange_balance: Inspect credits, spendable credits, and current token balances. For agents that require purchase credits, use spendable purchase credits rather than total credits.
- exchange_owned: Inspect tokens the user owns and can resell.
- exchange_listings: Inspect buyable offers for all agents or one target agent. Publisher direct price is always included when the agent has a public price, even when there are no resale listings. Prices are credits per 1,000 tokens (cr/K).
- exchange_buy: Buy agent tokens from publisher direct inventory or resale listings after planning agent id, token amount, and maximum acceptable unit price in cr/K. max_price is not total spend. The buy is all-or-nothing; it will not execute a partial purchase.
- exchange_sell: List owned agent tokens for resale after planning agent id, token amount, and asking price.
- call_platform_agent: Call another MOMOAI market agent when the expected trading value justifies the additional cost. Pass capability_id and output_mode for A2A capability calls.

## Trading Loop

1. Plan before acting.
2. Check account state before buying or selling.
3. Inspect market liquidity before choosing a price. A lack of resale offers does not mean the agent cannot be bought; check the direct offer. For task fulfillment, search by capability instead of relying only on agent names or tags.
4. Prefer simple spread trades: buy below the planned maximum price and sell above the planned minimum target.
5. Keep trades small when the user has not specified size or risk.
6. If exchange_buy returns no_purchases, read skipped_sources and fillable_tokens, then explain the reason. Do not retry the same agent, amount, and price unchanged; ask the user or choose a smaller explicit amount only when the user already authorized that discretion.
7. After any trade, summarize agent id, tokens, price, credits used or expected proceeds, and next action.

## Constraints

- Profit is the objective, but profit is not guaranteed.
- Do not invent market prices or balances.
- Do not guess A2A capability ids; use a matched capability returned by explore_agents with scope=capability.
- Do not call exchange_buy or exchange_sell without concrete numeric arguments.
- When the user states a price limit like < 20 cr/K, pass that number as max_price; do not multiply it by the requested token amount.
- If permission mode blocks a trade, explain the intended trade and ask for approval or permission-mode change.
- In remote service mode, child agent calls may create additional platform costs and should be justified by expected trading value.`;

const fallbackRemoteServicePublishingSkill = `# Remote Service Publishing Skill

This agent can help the user publish, update, and run local CLI agent profiles or already-running external A2A services as MOMOAI remote services.

## Tools

- publish_local_agent_listing: Create a delisted A2A remote-service draft for a local profile.
- update_local_agent_listing: Update the profile's listing, capabilities, price, and visibility.
- inspect_openclaw_a2a_stack: Read-only OpenClaw machine-state inspection before OpenClaw publishing.

## Workflow

1. Plan before acting. Identify the target profile, public name, capabilities, fixed result-token prices, and whether the service should stay delisted.
2. Create or update a local profile with a clear name, description, capability list, and fixedTokens for every enabled capability.
3. Publish CLI-runtime profiles with publish_local_agent_listing. This creates a delisted draft and stores the returned agent id in the profile. Do not use generic publishing for provider_runtime external plus service_type websocket.
4. Use service_type websocket by default. WebSocket is realtime and opens an outbound relay connection to MOMOAI, so no public inbound port is required.
5. For a pure already-running public A2A endpoint, use provider_runtime external with service_type funnel and register its provider_url directly. For OpenClaw or another external agent with a MOMOAI adapter plugin, service_type websocket is allowed only through a provider-specific workflow that first inspects the local machine and verifies or installs the adapter. The CLI must not proxy it.
6. Ask the user to run the provider with "$agent connect --profile <profile> --service <websocket|funnel>" and keep that process online only when provider_runtime is cli. For OpenClaw, use "$agent openclaw install-a2a --service websocket" so the OpenClaw adapter stores relay credentials and connects directly.
7. Only publish publicly after the provider is online, using update_local_agent_listing with public=true.
8. Explain that failed or non-completed tasks are not charged; completed tasks charge the fixed token amount for the selected capability.

## Constraints

- Do not publish a public listing before an online provider node exists.
- Do not invent capability ids or fixed token prices. Ask the user when missing.
- Do not call publishing or update tools in the same turn as a plan whose next step is to ask, clarify, gather metadata, or select a service type. Ask the user the concrete missing question and stop.
- Do not publish a new agent from invented capabilities. A new listing must use capabilities copied from list_local_agent_profiles or capabilities explicitly provided by the user in the current conversation.
- Each enabled capability must have positive fixedTokens.
- Keep pricing in MOMOAI listing/provider registration or a MOMOAI market adapter record, not in generic A2A communication requirements.
- One machine can host multiple profiles. Each running provider process is tied to one profile and one platform agent id.
- WebSocket providers route by agent id and do not require public inbound ports.
- CLI Funnel providers require distinct local host/port values and distinct provider_url values when multiple local services run at once.
- External providers own their own protocol and port; use the CLI only to register, publish, and update them.`;

const fallbackOpenClawA2aPublishingSkill = `# OpenClaw A2A Publishing Skill

Use this when the user wants the CLI to publish one or more capabilities from a local OpenClaw Gateway to MOMOAI.

## Core Boundary

- This is a MOMOAI CLI operating skill, not an OpenClaw business skill.
- Do not modify OpenClaw official source code.
- Do not put momoai-cli in the runtime invocation path.
- Do not create, install, or rely on capability-specific plugins for MOMOAI OpenClaw publishing.
- Publish different OpenClaw abilities by configuring A2A capabilities with local skill instructions.

## Required Inputs

Before publishing, identify:

- Profile name, normally openclaw.
- Local OpenClaw Gateway URL, normally http://127.0.0.1:18789.
- Public agent name and description.
- One or more capabilities, each with id, name, description, fixedTokens, input/output modes, and skill.instructions.
- Whether the listing should become public after provider verification.

Do not invent missing capability ids, prices, or instructions. Ask the user when they are missing.

## Workflow

1. For read-only local checks or clone-like requests such as "publish a new one like this profile", call list_local_agent_profiles first. It returns complete local profile metadata, capabilities, format contracts, and bound skill instructions. Do not call publish or update tools for check, list, show, or status requests.
2. Before installing, publishing, or skipping any OpenClaw setup, call inspect_openclaw_a2a_stack. Treat "already installed" as true only when inspection shows working standard A2A and MOMOAI adapter endpoints for the target service.
3. For publishing OpenClaw, call publish_openclaw_a2a_service instead of publish_local_agent_listing or manually chaining lower-level tools.
4. Use websocket by default. Use funnel only when the user provides a public MOMOAI protected provider URL.
5. Pass all capabilities explicitly. Every enabled priced capability must have a local skill binding with executable instructions.
6. Keep capability-specific behavior in skill.instructions. The generic OpenClaw A2A skill router is the only supported capability execution layer; it selects the skill by metadata.capability_id and injects those instructions into OpenClaw.
7. Keep MOMOAI pricing in the listing and market adapter metadata. Generic A2A Agent Cards should only describe communication capabilities.
8. Publish publicly only after the provider is online. If provider verification fails, leave the listing delisted and explain the next action.

If the plan says to ask, clarify, gather metadata, or select between service types, ask the concrete missing question and stop. Do not call publishing tools in that same turn.

## Tools

- list_local_agent_profiles: Read-only local profile inspection, including capabilities and bound skill instructions.
- inspect_openclaw_a2a_stack: Read-only local gateway inspection. Use it before publishing OpenClaw so plugin state is discovered, not assumed.
- publish_openclaw_a2a_service: High-level workflow for creating/updating the platform listing, inspecting local state, installing/configuring missing or required OpenClaw pieces, registering the provider, and optionally making the listing public.
- prepare_openclaw_a2a_market_service and $agent openclaw install-a2a: Low-level install/debug path. Use only when the user explicitly asks for manual installation or troubleshooting.

## Notes

- The standard A2A OpenClaw plugin owns generic A2A communication and Agent Card discovery.
- The OpenClaw A2A skill router owns mapping metadata.capability_id to local skill instructions.
- The MOMOAI A2A adapter owns market metadata, platform invocation protection, and the WebSocket relay or Funnel protected endpoint.
- Multiple OpenClaw services can coexist with distinct profiles and paths such as /a2a/gomoku plus /momoai/a2a/gomoku.
- Test structured output with $agent call <endpoint> '<input>' --capability <id> --output-mode application/json --json.`;

function readFirstExisting(paths: string[], fallback: string) {
  for (const path of paths) {
    if (existsSync(path)) {
      return readFileSync(path, 'utf8');
    }
  }
  return fallback;
}

export function loadMarketTradingSkill() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFirstExisting([
    join(here, 'skills', 'market-trading', 'SKILL.md'),
    join(process.cwd(), 'src', 'agent', 'skills', 'market-trading', 'SKILL.md')
  ], fallbackMarketTradingSkill).trim();
}

export function loadRemoteServicePublishingSkill() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFirstExisting([
    join(here, 'skills', 'remote-service-publishing', 'SKILL.md'),
    join(process.cwd(), 'src', 'agent', 'skills', 'remote-service-publishing', 'SKILL.md')
  ], fallbackRemoteServicePublishingSkill).trim();
}

export function loadOpenClawA2aPublishingSkill() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFirstExisting([
    join(here, 'skills', 'openclaw-a2a-publishing', 'SKILL.md'),
    join(process.cwd(), 'src', 'agent', 'skills', 'openclaw-a2a-publishing', 'SKILL.md')
  ], fallbackOpenClawA2aPublishingSkill).trim();
}
