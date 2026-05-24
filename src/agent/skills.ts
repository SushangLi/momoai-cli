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
4. Use service_type http by default. HTTP is realtime and requires a reachable provider_url ending in /a2a. Choose polling only when the user explicitly wants delayed service without an inbound port; polling checks the platform about once per hour.
5. For an already-running A2A service, use provider_runtime external and register its provider_url directly. The platform calls that endpoint; the CLI must not proxy it.
6. Ask the user to run the provider with "$agent connect --profile <profile> --service <polling|http>" and keep that process online only when provider_runtime is cli.
7. Only publish publicly after the provider is online, using update_local_agent_listing with public=true.
8. Explain that failed or non-completed tasks are not charged; completed tasks charge the fixed token amount for the selected capability.

## Constraints

- Do not publish a public listing before an online provider node exists.
- Do not invent capability ids or fixed token prices. Ask the user when missing.
- Each enabled capability must have positive fixedTokens.
- One machine can host multiple profiles. Each running provider process is tied to one profile and one platform agent id.
- Polling providers route by agent id and do not require public inbound ports.
- CLI HTTP providers require distinct local host/port values and distinct provider_url values when multiple local services run at once.
- External providers own their own protocol and port; use the CLI only to register, publish, and update them.`;

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
