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

function readFirstExisting(paths: string[]) {
  for (const path of paths) {
    if (existsSync(path)) {
      return readFileSync(path, 'utf8');
    }
  }
  return fallbackMarketTradingSkill;
}

export function loadMarketTradingSkill() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFirstExisting([
    join(here, 'skills', 'market-trading', 'SKILL.md'),
    join(process.cwd(), 'src', 'agent', 'skills', 'market-trading', 'SKILL.md')
  ]).trim();
}
