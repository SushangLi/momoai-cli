import { loadConfig } from './config.js';
import { exchangeBalance, exchangeBuy, exchangeListings, exchangeOwned, exchangeSell, exploreAgents } from './services.js';

export type ConfirmTool = (toolName: string, args: Record<string, unknown>) => Promise<boolean>;

export const momoTools = [
  {
    type: 'function',
    function: {
      name: 'explore_agents',
      description: 'Search MOMO AI agents by query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 10 }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_balance',
      description: 'Get account credits and token balances.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_owned',
      description: 'Get agents whose tokens the user owns and can resell.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_listings',
      description: 'Get resale token listings, optionally for one agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_buy',
      description: 'Buy tokens for an agent from resale listings.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number' },
          tokens: { type: 'number' },
          max_price: { type: 'number' }
        },
        required: ['agent_id', 'tokens', 'max_price']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_sell',
      description: 'List owned tokens for resale.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number' },
          tokens: { type: 'number' },
          price: { type: 'number' }
        },
        required: ['agent_id', 'tokens', 'price']
      }
    }
  }
];

function parseArgs(raw: string | undefined) {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function numberArg(args: Record<string, unknown>, name: string) {
  const value = Number(args[name]);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function intArg(args: Record<string, unknown>, name: string) {
  const value = numberArg(args, name);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function confirmIfNeeded(name: string, args: Record<string, unknown>, confirm?: ConfirmTool) {
  const isTrade = name === 'exchange_buy' || name === 'exchange_sell';
  if (!isTrade || loadConfig().permissionMode === 'full') return true;
  if (!confirm) return false;
  return confirm(name, args);
}

export async function executeToolCall(name: string, rawArgs: string | undefined, confirm?: ConfirmTool) {
  const args = parseArgs(rawArgs);
  const allowed = await confirmIfNeeded(name, args, confirm);
  if (!allowed) {
    return {
      denied: true,
      message: `${name} was not executed because user confirmation was not granted.`
    };
  }

  try {
    if (name === 'explore_agents') {
      return await exploreAgents(String(args.query || ''), Number(args.limit || 10));
    }
    if (name === 'exchange_balance') return await exchangeBalance();
    if (name === 'exchange_owned') return await exchangeOwned();
    if (name === 'exchange_listings') {
      const agentId = args.agent_id === undefined ? undefined : intArg(args, 'agent_id');
      return await exchangeListings(agentId);
    }
    if (name === 'exchange_buy') {
      return await exchangeBuy(intArg(args, 'agent_id'), numberArg(args, 'tokens'), numberArg(args, 'max_price'));
    }
    if (name === 'exchange_sell') {
      return await exchangeSell(intArg(args, 'agent_id'), numberArg(args, 'tokens'), numberArg(args, 'price'));
    }
    return { error: `Unknown tool: ${name}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
