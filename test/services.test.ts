import { test, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { exploreAgents, exchangeBalance } from '../src/services.js';

const realFetch = globalThis.fetch;

before(() => {
  // Avoid depending on a real platform URL or stored credentials.
  process.env.MOMOAI_API_URL = 'https://platform.test';
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  globalThis.fetch = (async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(payload)
  })) as unknown as typeof fetch;
}

test('exploreAgents maps platform agents and computes per-1k pricing', async () => {
  mockFetch({
    data: {
      agents: [
        {
          id: 242,
          name: 'Gomoku Master',
          price: 50,
          price_unit: 1000,
          available_tokens: null,
          need_purchase: true,
          model_call_name: 'momo_242',
          intro: 'plays gomoku',
          online: true,
          agent_card_url: 'https://platform.test/a2a/agents/242',
          matched_capability: { id: 'gomoku_move' }
        }
      ]
    }
  });

  // Passing an explicit authToken bypasses the stored-credential requirement.
  const agents = await exploreAgents('gomoku', 10, 'test-token', { scope: 'capability' });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, 242);
  assert.equal(agents[0].direct_price_per_1k, 50); // (50 / 1000) * 1000
  assert.equal(agents[0].direct_available_tokens, 'unlimited'); // null => unlimited
  assert.equal(agents[0].online, true);
  assert.deepEqual(agents[0].matched_capability, { id: 'gomoku_move' });
});

test('exchangeBalance surfaces credits and falls back to total for spendable', async () => {
  mockFetch({
    data: {
      credits: { total: 1000, purchase: 600, gift: 400 },
      tokens: [{ agent_id: 7, token_balance: 25, token_onsale: 5, resell_price: 12 }]
    }
  });

  const balance = await exchangeBalance('test-token');
  assert.equal(balance.credits, 1000);
  assert.equal(balance.purchase, 600);
  assert.equal(balance.spendable_credits, 1000); // no spendable_total => falls back to total
  assert.equal(balance.spendable_purchase, 600);
  assert.equal(balance.tokens[0].agent, 7);
  assert.equal(balance.tokens[0].price, 12);
});

test('platform error responses are surfaced as thrown CliErrors', async () => {
  mockFetch({ success: false, error: { message: 'insufficient credits' } }, { ok: true, status: 200 });
  await assert.rejects(() => exchangeBalance('test-token'), /insufficient credits/);
});
