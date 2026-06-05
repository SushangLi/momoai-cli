import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';
import { startAgentServer } from '../dist/agent/server.js';

const servers = [];

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

function writeExecutorModule() {
  const dir = mkdtempSync(join(tmpdir(), 'momoai-executor-'));
  const file = join(dir, 'executor.mjs');
  writeFileSync(file, `
export default async function execute(input) {
  return {
    text: 'handled: ' + input.content,
    state: 'completed',
    metadata: {
      capability_id: input.capabilityId,
      acceptedOutputModes: input.acceptedOutputModes
    }
  };
}
`);
  return pathToFileURL(file).href;
}

function demoAgent(providerExecutor) {
  return {
    profile: 'demo',
    mode: 'local',
    serviceType: 'websocket',
    providerRuntime: 'cli',
    providerExecutor,
    name: 'A2A Server Demo',
    description: 'Local A2A server route test.',
    version: '0.1.0',
    host: '127.0.0.1',
    port: 0,
    capabilities: [
      {
        id: 'gomoku_move',
        name: 'Gomoku move',
        description: 'Return the next move.',
        fixedTokens: 1500,
        enabled: true,
        inputModes: ['text/plain'],
        outputModes: ['application/json']
      }
    ],
    listing: {
      price: 10,
      availableTokens: 1000000,
      isDelisted: true
    }
  };
}

describe('A2A server', () => {
  it('routes JSON-RPC message/send through a provider executor and stores task state', async () => {
    const server = await startAgentServer({
      host: '127.0.0.1',
      port: 0,
      mode: 'local',
      agent: demoAgent(writeExecutorModule())
    });
    servers.push(server);
    const { port } = server.address();
    const endpoint = `http://127.0.0.1:${port}`;

    const response = await fetch(`${endpoint}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req_1',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ text: 'next move', mediaType: 'text/plain' }]
          },
          configuration: {
            acceptedOutputModes: ['application/json']
          },
          metadata: {
            capability_id: 'gomoku_move',
            contextId: 'ctx_1'
          }
        }
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.jsonrpc, '2.0');
    assert.equal(payload.id, 'req_1');
    assert.equal(payload.result.contextId, 'ctx_1');
    assert.equal(payload.result.status.state, 'TASK_STATE_COMPLETED');
    assert.equal(payload.result.status.message.parts[0].text, 'handled: next move');
    assert.equal(payload.result.status.message.metadata.capability_id, 'gomoku_move');

    const taskResponse = await fetch(`${endpoint}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req_2',
        method: 'tasks/get',
        params: { id: payload.result.id }
      })
    });
    const taskPayload = await taskResponse.json();
    assert.equal(taskPayload.result.status.state, 'TASK_STATE_COMPLETED');
  });

  it('rejects unknown A2A capabilities before execution', async () => {
    const server = await startAgentServer({
      host: '127.0.0.1',
      port: 0,
      mode: 'local',
      agent: demoAgent(writeExecutorModule())
    });
    servers.push(server);
    const { port } = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'req_3',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ text: 'next move' }]
          },
          metadata: {
            capability_id: 'unknown'
          }
        }
      })
    });

    const payload = await response.json();
    assert.equal(payload.error.code, -32602);
    assert.match(payload.error.message, /Unknown or disabled capability_id/);
  });
});
