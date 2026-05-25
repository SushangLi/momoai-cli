import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fallbackMarketTradingSkill = `# Market Trading Skill

This agent is allowed to act as a MOMOAI market trading agent. Its goal is to grow the user's net market value by finding useful agent-token opportunities, buying below a reasonable target price, selling held tokens above cost or target value, and using other market agents only when that improves the trading result.

## Available Tools

- explore_agents: Search MOMOAI market agents by query.
- exchange_balance: Inspect credits and current token balances.
- exchange_owned: Inspect tokens the user owns and can resell.
- exchange_listings: Inspect resale listings for all agents or one target agent.
- exchange_buy: Buy agent tokens from resale listings after planning agent id, token amount, and maximum acceptable price.
- exchange_sell: List owned agent tokens for resale after planning agent id, token amount, and asking price.
- call_platform_agent: Call another MOMOAI market agent when the expected trading value justifies the additional cost.

## Trading Loop

1. Plan before acting.
2. Check account state before buying or selling.
3. Inspect market liquidity before choosing a price.
4. Prefer simple spread trades: buy below the planned maximum price and sell above the planned minimum target.
5. Keep trades small when the user has not specified size or risk.
6. After any trade, summarize agent id, tokens, price, credits used or expected proceeds, and next action.

## Constraints

- Profit is the objective, but profit is not guaranteed.
- Do not invent market prices or balances.
- Do not call exchange_buy or exchange_sell without concrete numeric arguments.
- If permission mode blocks a trade, explain the intended trade and ask for approval or permission-mode change.
- In remote service mode, child agent calls may create additional platform costs and should be justified by expected trading value.`;

const fallbackRemoteServicePublishingSkill = `# Remote Service Publishing Skill

This agent can help the user publish, update, and run local CLI agent profiles or already-running external A2A services as MOMOAI remote services.

## Tools

- publish_local_agent_listing: Create a delisted A2A remote-service draft for a local profile.
- update_local_agent_listing: Update the profile's listing, capabilities, price, and visibility.

## Workflow

1. Plan before acting. Identify the target profile, public name, capabilities, fixed result-token prices, and whether the service should stay delisted.
2. Create or update a local profile with a clear name, description, capability list, and fixedTokens for every enabled capability.
3. Publish with publish_local_agent_listing. This creates a delisted draft and stores the returned agent id in the profile.
4. Use service_type websocket by default. WebSocket is realtime and opens an outbound relay connection to MOMOAI, so no public inbound port is required.
5. For a pure already-running public A2A endpoint, use provider_runtime external with service_type funnel and register its provider_url directly. For OpenClaw or another external agent with a MOMOAI adapter plugin, service_type websocket is allowed because the external agent owns the outbound relay connection itself. The CLI must not proxy it.
6. Ask the user to run the provider with "$agent connect --profile <profile> --service <websocket|funnel>" and keep that process online only when provider_runtime is cli. For OpenClaw, use "$agent openclaw install-a2a --service websocket" so the OpenClaw adapter stores relay credentials and connects directly.
7. Only publish publicly after the provider is online, using update_local_agent_listing with public=true.
8. Explain that failed or non-completed tasks are not charged; completed tasks charge the fixed token amount for the selected capability.

## Constraints

- Do not publish a public listing before an online provider node exists.
- Do not invent capability ids or fixed token prices. Ask the user when missing.
- Each enabled capability must have positive fixedTokens.
- Keep pricing in MOMOAI listing/provider registration or a MOMOAI market adapter record, not in generic A2A communication requirements.
- One machine can host multiple profiles. Each running provider process is tied to one profile and one platform agent id.
- WebSocket providers route by agent id and do not require public inbound ports.
- CLI Funnel providers require distinct local host/port values and distinct provider_url values when multiple local services run at once.
- External providers own their own protocol and port; use the CLI only to register, publish, and update them.`;

const fallbackOpenClawA2aPublishingSkill = `# OpenClaw A2A Publishing Skill

Use this when the user wants to publish a local OpenClaw agent on MOMOAI through A2A.

## Core Rule

Do not modify OpenClaw's official source code and do not use momoai-cli as the runtime proxy for OpenClaw. Split the work into two plugins:

- A public standard A2A OpenClaw plugin owns generic A2A communication and the standard Agent Card.
- The MOMOAI A2A adapter plugin owns market metadata, platform invocation checks, and the protected provider URL used by momoai.pro.

## Workflow

1. Plan before acting. Identify the local Gateway URL, MOMOAI profile, service type, standard A2A plugin source, priced MOMOAI capabilities, and each capability's bound local skill. Use websocket by default; require a public provider URL only for funnel.
2. Probe the local port, usually http://127.0.0.1:18789, for /.well-known/agent-card.json and the A2A JSON-RPC endpoint.
3. If standard A2A is missing, use prepare_openclaw_a2a_market_service or "$agent openclaw install-a2a" to install the bundled spec-compatible standard A2A plugin. If the user already manages an official or custom A2A plugin, pass standard_plugin_source or set skip_standard_plugin.
4. Install/configure the MOMOAI adapter plugin. It must use a protected_path that differs from the standard upstream_path. A MOMOAI agent_id is not required for local standard A2A communication. For websocket market publishing, the CLI registers the provider node and writes relayUrl/providerToken into OpenClaw config only after an agent_id exists; OpenClaw then connects directly to MOMOAI.
5. Restart OpenClaw Gateway after plugin changes, or run with --restart.
6. Publish/update the MOMOAI listing with provider_runtime external. For websocket, no inbound provider_url is required. For funnel, provider_url must be the public MOMOAI protected provider endpoint, not the raw local CLI.
7. Only make the listing public after the standard A2A endpoint works locally and the MOMOAI provider node is online.

## Notes

- Without a standard A2A plugin, OpenClaw 18789 may return 404 for /.well-known/agent-card.json and HTML or 404 for /a2a.
- Every enabled priced capability must bind a local skill with id and executable instructions. A2A requests carry metadata.capability_id, and the OpenClaw A2A plugin uses it to select that local skill before running the agent.
- Generic A2A skills should not contain MOMOAI pricing. FixedTokens belong to MOMOAI listing/provider registration and the MOMOAI adapter market card.
- Keep platform JWT auth enabled for public services. Use --allow-unauthenticated only for local protocol testing.
- Multiple OpenClaw services can coexist by using different profiles and distinct upstream/protected paths.`;

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
