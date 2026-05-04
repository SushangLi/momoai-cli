import { MomoClient } from './client.js';

export interface BalanceModel {
  model: string;
  agent: number;
  balance: number;
  onsale: number;
}

export interface ListedModel {
  model: string;
  agent: number;
  source: 'default' | 'balance' | 'default+balance';
  balance: number | '';
  onsale: number | '';
  hint: string;
}

export function normalizeModel(input: string) {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return `momo_${trimmed}`;
  return trimmed;
}

export function modelAgentId(model: string): number | undefined {
  const match = model.match(/(?:^|\/)momo_(\d+)(?:_|$)?/) || model.match(/^(\d+)$/);
  if (!match) return undefined;
  const agentId = Number(match[1]);
  return Number.isInteger(agentId) && agentId > 0 ? agentId : undefined;
}

export async function balanceModels(): Promise<BalanceModel[]> {
  const response = await new MomoClient().request<any>('/api/cli/exchange/balance');
  return response.data.tokens.map((token: any) => ({
    model: `momo_${token.agent_id}`,
    agent: token.agent_id,
    balance: token.token_balance,
    onsale: token.token_onsale
  }));
}

export function mergedModels(defaultModels: string[], balances: BalanceModel[]): ListedModel[] {
  const rows = new Map<number, ListedModel>();

  for (const defaultModel of defaultModels) {
    const normalized = normalizeModel(defaultModel);
    const agent = modelAgentId(normalized);
    if (!agent) continue;
    rows.set(agent, {
      model: normalized,
      agent,
      source: 'default',
      balance: '',
      onsale: '',
      hint: `buy tokens with $exchange buy ${agent} --tokens <n> --max-price <price>`
    });
  }

  for (const balance of balances) {
    const existing = rows.get(balance.agent);
    rows.set(balance.agent, {
      model: existing?.model || balance.model,
      agent: balance.agent,
      source: existing ? 'default+balance' : 'balance',
      balance: balance.balance,
      onsale: balance.onsale,
      hint: existing ? '' : ''
    });
  }

  return [...rows.values()].sort((left, right) => left.agent - right.agent);
}
