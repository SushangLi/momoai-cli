import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { callPlatformAgent, exchangeBuy, exchangeListings } from '../dist/services.js';

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('marketplace services', () => {
  beforeEach(() => {
    process.env.MOMOAI_API_URL = 'https://platform.example.test';
    process.env.MOMOAI_KEY = 'test-momo-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.MOMOAI_API_URL;
    delete process.env.MOMOAI_KEY;
  });

  it('sends token purchase requests with the expected auth and max unit price', async () => {
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return jsonResponse({
        data: {
          agent_id: 42,
          tokens_bought: 1000,
          tokens_remaining: 0,
          fillable_tokens: 1000,
          unfilled_tokens: 0,
          credits_used: { total: 12 },
          purchases: [
            { listing_type: 'direct', seller_username: 'publisher', amount: 1000, price: 12, cost: 12 }
          ],
          status: 'completed'
        }
      });
    };

    const result = await exchangeBuy(42, 1000, 12);

    assert.equal(result.agent, 42);
    assert.equal(result.credits_used, 12);
    assert.equal(calls[0].url, 'https://platform.example.test/api/cli/exchange/buy');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-momo-key');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      agent_id: 42,
      tokens: 1000,
      max_price: 12
    });
  });

  it('normalizes direct and resale marketplace listings', async () => {
    globalThis.fetch = async (input, init = {}) => {
      assert.equal(String(input), 'https://platform.example.test/api/cli/exchange/listings?agent_id=42');
      assert.equal(init.headers.Authorization, 'Bearer test-momo-key');
      return jsonResponse({
        data: {
          listings: [
            {
              agent_id: 42,
              listing_type: 'initial',
              seller_username: 'publisher',
              unlimited: true,
              token_onsale: null,
              resell_price: 10,
              model_author: 'MOMOAI'
            },
            {
              agent_id: 42,
              listing_type: 'resale',
              seller_username: 'holder',
              unlimited: false,
              token_onsale: 500,
              resell_price: 11,
              model_author: 'MOMOAI'
            }
          ]
        }
      });
    };

    assert.deepEqual(await exchangeListings(42), [
      {
        agent: 42,
        source: 'direct',
        seller: 'publisher',
        tokens: 'unlimited',
        price: 10,
        price_unit: 'cr/K tokens',
        available: true,
        author: 'MOMOAI'
      },
      {
        agent: 42,
        source: 'resale',
        seller: 'holder',
        tokens: 500,
        price: 11,
        price_unit: 'cr/K tokens',
        available: true,
        author: 'MOMOAI'
      }
    ]);
  });

  it('validates A2A capability metadata before sending a platform call', async () => {
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/a2a/agents/42')) {
        if (!init.body) {
          return jsonResponse({
            skills: [
              {
                id: 'gomoku_move',
                outputModes: ['application/json']
              }
            ]
          });
        }
        const body = JSON.parse(init.body);
        return jsonResponse({
          result: {
            id: 'task_1',
            status: { state: 'TASK_STATE_COMPLETED' },
            echoedCapability: body.params.metadata.capability_id
          }
        });
      }
      if (url.endsWith('/a2a/agents/42?format=market')) {
        return jsonResponse({
          momoai_market: {
            online: true,
            capabilities: [
              {
                id: 'gomoku_move',
                enabled: true,
                outputModes: ['application/json']
              }
            ]
          }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await callPlatformAgent(42, 'next move', undefined, {
      capabilityId: 'gomoku_move',
      outputMode: 'application/json',
      showPlan: true
    });

    assert.equal(result.agent, 42);
    assert.equal(result.capability_id, 'gomoku_move');
    assert.equal(result.task.echoedCapability, 'gomoku_move');
    const callBody = JSON.parse(calls[2].init.body);
    assert.equal(callBody.method, 'message/send');
    assert.equal(callBody.params.message.parts[0].text, 'next move');
    assert.deepEqual(callBody.params.configuration.acceptedOutputModes, ['application/json']);
    assert.equal(callBody.params.metadata.showPlan, true);
  });
});
