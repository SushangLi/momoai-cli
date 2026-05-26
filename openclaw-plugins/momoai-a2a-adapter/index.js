import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const jwksCache = new Map();

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizePath(value, fallback) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeBaseUrl(value) {
  return String(value || 'https://momoai.pro').replace(/\/$/, '');
}

function normalizeServiceType(value) {
  return value === 'funnel' ? 'funnel' : 'websocket';
}

function normalizeModes(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const modes = [...new Set(value.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : fallback;
}

function normalizeCapability(value, index) {
  const capability = isRecord(value) ? value : {};
  const id = String(capability.id || capability.capability_id || capability.capabilityId || `capability_${index + 1}`).trim();
  const name = String(capability.name || id).trim();
  const fixedTokens = Number(capability.fixedTokens ?? capability.fixed_tokens ?? 1000);
  const formatContract = isRecord(capability.formatContract || capability.format_contract)
    ? capability.formatContract || capability.format_contract
    : undefined;
  return {
    id,
    name,
    description: String(capability.description || '').trim(),
    fixedTokens: Number.isFinite(fixedTokens) && fixedTokens > 0 ? Math.floor(fixedTokens) : 1000,
    enabled: capability.enabled === undefined ? true : Boolean(capability.enabled),
    inputModes: normalizeModes(capability.inputModes || capability.input_modes, ['text/plain', 'application/json']),
    outputModes: normalizeModes(capability.outputModes || capability.output_modes, ['text/plain']),
    ...(formatContract ? { formatContract } : {})
  };
}

function defaultCapabilities() {
  return [
    {
      id: 'general_task',
      name: 'General task',
      description: 'Complete one standard A2A task through OpenClaw.',
      fixedTokens: 1000,
      enabled: true
    }
  ];
}

function normalizeService(serviceId, rawService) {
  const service = isRecord(rawService) ? rawService : {};
  const isDefault = serviceId === 'default';
  const upstreamPath = normalizePath(service.upstreamPath, isDefault ? '/a2a' : `/a2a/${serviceId}`);
  const protectedPath = normalizePath(service.protectedPath, isDefault ? '/momoai/a2a' : `/momoai/a2a/${serviceId}`);
  const agentCardPath = normalizePath(service.agentCardPath, isDefault ? '/.well-known/agent-card.json' : `/.well-known/a2a/${serviceId}/agent-card.json`);
  const marketPath = normalizePath(service.marketPath, isDefault ? '/.well-known/momoai-a2a/market-card.json' : `/.well-known/momoai-a2a/${serviceId}/market-card.json`);
  const oasfPath = normalizePath(service.oasfPath, isDefault ? '/.well-known/momoai-a2a/oasf-record.json' : `/.well-known/momoai-a2a/${serviceId}/oasf-record.json`);
  const capabilities = Array.isArray(service.capabilities)
    ? service.capabilities.map(normalizeCapability).filter((capability) => capability.id && capability.name)
    : defaultCapabilities();

  return {
    id: serviceId,
    enabled: service.enabled === undefined ? true : Boolean(service.enabled),
    protectedPath,
    upstreamPath,
    agentCardPath,
    marketPath,
    oasfPath,
    name: String(service.name || 'OpenClaw A2A Service').trim(),
    description: String(service.description || 'An OpenClaw agent exposed through a standard A2A endpoint with MOMOAI market adaptation.').trim(),
    version: String(service.version || '0.1.0').trim(),
    momoaiApiUrl: normalizeBaseUrl(service.momoaiApiUrl),
    momoaiAgentId: service.momoaiAgentId === undefined ? undefined : Number(service.momoaiAgentId),
    serviceType: normalizeServiceType(service.serviceType || service.service_type),
    providerUrl: optionalString(service.providerUrl || service.provider_url),
    relayUrl: optionalString(service.relayUrl || service.relay_url),
    providerToken: optionalString(service.providerToken || service.provider_token),
    nodeId: optionalString(service.nodeId || service.node_id),
    sessionId: optionalString(service.sessionId || service.session_id),
    requirePlatformAuth: service.requirePlatformAuth === undefined ? true : Boolean(service.requirePlatformAuth),
    forwardAuthorization: service.forwardAuthorization === undefined ? false : Boolean(service.forwardAuthorization),
    capabilities: capabilities.length ? capabilities : defaultCapabilities()
  };
}

function normalizeServices(pluginConfig) {
  const servicesConfig = isRecord(pluginConfig?.services) ? pluginConfig.services : {};
  return Object.entries(servicesConfig)
    .map(([serviceId, service]) => normalizeService(serviceId, service))
    .filter((service) => service.enabled);
}

function originFromRequest(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1:18789';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error('Payload too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function bearerToken(header) {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value.replace(/^Bearer\s+/i, '').trim() : '';
}

function normalizeAuthorization(headerOrToken) {
  const token = bearerToken(headerOrToken);
  return token ? `Bearer ${token}` : '';
}

function base64UrlDecode(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function splitScopes(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return [];
}

function capabilityIdFromBody(body) {
  const params = body?.params || {};
  return String(params?.metadata?.capability_id || params?.metadata?.capabilityId || params?.capability_id || params?.capabilityId || '').trim();
}

async function jwksFor(apiUrl) {
  const url = `${apiUrl}/api/a2a/jwks`;
  const cached = jwksCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.jwks;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch MOMOAI JWKS: HTTP ${response.status}`);
  const jwks = await response.json();
  jwksCache.set(url, { jwks, expiresAt: Date.now() + 10 * 60 * 1000 });
  return jwks;
}

async function verifyPlatformJwtFromAuthorization(authorization, service, capabilityId) {
  if (!service.requirePlatformAuth) return {};

  const token = bearerToken(authorization);
  if (!token) throw new Error('Missing platform invocation token');

  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('Invalid platform invocation token');
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`Unsupported invocation JWT alg: ${header.alg || 'unknown'}`);

  const jwks = await jwksFor(service.momoaiApiUrl);
  const key = (jwks.keys || []).find((candidate) => (!header.kid || candidate.kid === header.kid) && (!candidate.alg || candidate.alg === 'RS256'));
  if (!key) throw new Error('No matching MOMOAI invocation JWKS key');

  const publicKey = createPublicKey({ key, format: 'jwk' });
  const verified = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    base64UrlDecode(encodedSignature)
  );
  if (!verified) throw new Error('Invalid platform invocation token signature');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && Number(payload.exp) <= now) throw new Error('Platform invocation token expired');
  if (payload.nbf !== undefined && Number(payload.nbf) > now) throw new Error('Platform invocation token is not active yet');
  if (payload.iss !== service.momoaiApiUrl) throw new Error('Platform invocation token issuer mismatch');
  if (service.momoaiAgentId) {
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audience.includes(`momoai:agent:${service.momoaiAgentId}`)) throw new Error('Platform invocation token audience mismatch');
    if (Number(payload.agent_id || 0) !== service.momoaiAgentId) throw new Error('Platform invocation token target agent mismatch');
  }

  const scopes = splitScopes(payload.scope);
  if (!scopes.includes('agent.invoke') && !scopes.includes('agent.subinvoke')) {
    throw new Error('Invocation token does not grant agent invocation scope');
  }
  if (payload.capability_id && capabilityId && payload.capability_id !== capabilityId) {
    throw new Error('capability_id does not match platform invocation token');
  }

  return payload;
}

async function verifyPlatformJwt(req, service, capabilityId) {
  return verifyPlatformJwtFromAuthorization(req.headers.authorization, service, capabilityId);
}

function renderMarketCapabilities(service) {
  return service.capabilities
    .filter((capability) => capability.enabled !== false)
    .map((capability, index) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      fixedTokens: capability.fixedTokens,
      enabled: true,
      sortOrder: index,
      inputModes: capability.inputModes,
      outputModes: capability.outputModes,
      ...(capability.formatContract ? { formatContract: capability.formatContract } : {})
    }));
}

function buildMarketCard(req, service) {
  const origin = originFromRequest(req);
  return {
    schema_version: 'momoai.a2a.market.v1',
    service_id: service.id,
    name: service.name,
    description: service.description,
    version: service.version,
    standard_a2a: {
      agent_card_url: `${origin}${service.agentCardPath}`,
      endpoint_url: `${origin}${service.upstreamPath}`,
      transport: 'JSONRPC'
    },
    momoai_market: {
      provider_url: `${origin}${service.protectedPath}`,
      api_url: service.momoaiApiUrl,
      agent_id: service.momoaiAgentId,
      service_type: service.serviceType,
      charge_when: 'task_completed',
      capabilities: renderMarketCapabilities(service)
    },
    securitySchemes: service.requirePlatformAuth
      ? {
          platformInvocationJwt: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Short-lived MOMOAI invocation JWT. This is a market adapter requirement, not part of the generic A2A skill contract.'
          }
        }
      : {},
    security: service.requirePlatformAuth ? [{ platformInvocationJwt: [] }] : []
  };
}

function buildOasfRecord(req, service) {
  const market = buildMarketCard(req, service);
  return {
    schema_version: '1.0.0',
    name: market.name,
    description: market.description,
    version: market.version,
    locator: {
      type: 'a2a',
      url: market.standard_a2a.endpoint_url
    },
    modules: [
      {
        name: 'agent_communication',
        protocols: ['a2a'],
        endpoint: market.standard_a2a.endpoint_url
      },
      {
        name: 'momoai_market',
        protocols: ['momoai_invocation_jwt'],
        endpoint: market.momoai_market.provider_url,
        capabilities: market.momoai_market.capabilities.map((capability) => capability.id)
      }
    ],
    market
  };
}

function registerJsonRoute(api, path, handler) {
  api.registerHttpRoute({
    path,
    auth: 'plugin',
    match: 'exact',
    replaceExisting: true,
    handler
  });
}

function parseJsonOrNull(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function localGatewayOrigin(config) {
  const gateway = isRecord(config?.gateway) ? config.gateway : {};
  const rawPort = Number(gateway.port || process.env.OPENCLAW_GATEWAY_PORT || 18789);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? Math.floor(rawPort) : 18789;
  const configuredHost = optionalString(gateway.host || gateway.hostname);
  const bind = optionalString(gateway.bind);
  const host = configuredHost && configuredHost !== '0.0.0.0'
    ? configuredHost
    : bind === 'public'
      ? '127.0.0.1'
      : '127.0.0.1';
  return `http://${host}:${port}`;
}

async function invokeStandardA2a(service, options) {
  const body = options.body;
  const authorization = normalizeAuthorization(options.authorization);

  if (service.protectedPath === service.upstreamPath) {
    return jsonRpcError(body?.id ?? null, -32603, 'protectedPath must differ from upstreamPath');
  }

  try {
    await verifyPlatformJwtFromAuthorization(authorization, service, capabilityIdFromBody(body));
  } catch (error) {
    return jsonRpcError(body?.id ?? null, -32010, error instanceof Error ? error.message : String(error));
  }

  try {
    const response = await fetch(`${options.origin}${service.upstreamPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(service.forwardAuthorization && authorization ? { Authorization: authorization } : {})
      },
      body: JSON.stringify(body || {})
    });
    const responseText = await response.text();
    const payload = parseJsonOrNull(responseText);
    if (payload && typeof payload === 'object') return payload;
    return jsonRpcError(body?.id ?? null, -32000, `Upstream A2A endpoint returned HTTP ${response.status} without JSON-RPC JSON`);
  } catch (error) {
    return jsonRpcError(body?.id ?? null, -32000, error instanceof Error ? error.message : String(error));
  }
}

function createProtectedHandler(service) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    if (service.protectedPath === service.upstreamPath) {
      sendJson(res, 500, jsonRpcError(null, -32603, 'protectedPath must differ from upstreamPath'));
      return true;
    }

    let bodyBuffer;
    let body;
    try {
      bodyBuffer = await readBody(req);
      body = JSON.parse(bodyBuffer.toString('utf8'));
      await verifyPlatformJwt(req, service, capabilityIdFromBody(body));
    } catch (error) {
      const id = body?.id ?? null;
      sendJson(res, 401, jsonRpcError(id, -32010, error instanceof Error ? error.message : String(error)));
      return true;
    }

    try {
      const response = await invokeStandardA2a(service, {
        origin: originFromRequest(req),
        authorization: req.headers.authorization,
        body
      });
      res.statusCode = 200;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(response));
      return true;
    } catch (error) {
      sendJson(res, 502, jsonRpcError(body?.id ?? null, -32000, error instanceof Error ? error.message : String(error)));
      return true;
    }
  };
}

function relayUrlWithToken(relayUrl, providerToken) {
  if (!relayUrl) throw new Error('Missing relayUrl for websocket service');
  if (!providerToken) throw new Error('Missing providerToken for websocket service');
  const url = new URL(relayUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Invalid relayUrl protocol: ${relayUrl}`);
  }
  url.searchParams.set('token', providerToken);
  return url.toString();
}

async function relayMessageToString(raw) {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
  if (raw && typeof raw.arrayBuffer === 'function') {
    return Buffer.from(await raw.arrayBuffer()).toString('utf8');
  }
  return String(raw || '');
}

function createRelayService(service) {
  let stopped = false;
  let socket;
  let reconnectTimer;

  return {
    id: `momoai-a2a-adapter-relay-${service.id}`,
    start(ctx) {
      if (service.serviceType !== 'websocket') return;
      stopped = false;
      if (!service.relayUrl || !service.providerToken) {
        ctx.logger.warn?.(`[momoai-a2a-adapter] websocket service ${service.id} is missing relayUrl/providerToken; run momoai "$agent openclaw install-a2a" after publishing the agent.`);
        return;
      }
      if (typeof globalThis.WebSocket !== 'function') {
        ctx.logger.warn?.('[momoai-a2a-adapter] global WebSocket is unavailable; use Node.js 22+ or expose the service through funnel.');
        return;
      }

      let attempt = 0;
      const origin = localGatewayOrigin(ctx.config);

      const clearReconnect = () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      };

      const scheduleReconnect = () => {
        if (stopped) return;
        const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        attempt += 1;
        clearReconnect();
        reconnectTimer = setTimeout(connect, delayMs);
      };

      const send = (payload) => {
        if (!socket || socket.readyState !== 1) return;
        socket.send(JSON.stringify(payload));
      };

      const handleMessage = async (event) => {
        let message;
        try {
          message = JSON.parse(await relayMessageToString(event.data));
        } catch (error) {
          ctx.logger.warn?.(`[momoai-a2a-adapter] invalid relay message for ${service.id}: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }

        if (message?.type === 'a2a.ready') {
          ctx.logger.info?.(`[momoai-a2a-adapter] websocket relay ready for ${service.id}: ${message.node_id || service.nodeId || ''}`);
          return;
        }
        if (message?.type !== 'a2a.invoke') return;

        const runId = String(message.run_id || message.runId || '');
        try {
          const response = await invokeStandardA2a(service, {
            origin,
            authorization: `Bearer ${message.invocation_token || message.invocationToken || ''}`,
            body: message.request
          });
          send({ type: 'a2a.result', run_id: runId, response });
        } catch (error) {
          send({
            type: 'a2a.error',
            run_id: runId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      };

      function connect() {
        if (stopped) return;
        let url;
        try {
          url = relayUrlWithToken(service.relayUrl, service.providerToken);
        } catch (error) {
          ctx.logger.warn?.(`[momoai-a2a-adapter] ${error instanceof Error ? error.message : String(error)}`);
          return;
        }

        socket = new globalThis.WebSocket(url);
        const connectTimer = setTimeout(() => {
          if (socket && socket.readyState === 0) socket.close(1000, 'connect timeout');
        }, 30_000);

        socket.onopen = () => {
          clearTimeout(connectTimer);
          attempt = 0;
          ctx.logger.info?.(`[momoai-a2a-adapter] websocket relay connected for ${service.id}`);
        };
        socket.onmessage = (event) => {
          void handleMessage(event);
        };
        socket.onerror = () => {
          ctx.logger.warn?.(`[momoai-a2a-adapter] websocket relay error for ${service.id}`);
        };
        socket.onclose = (event) => {
          clearTimeout(connectTimer);
          if (stopped) return;
          ctx.logger.warn?.(`[momoai-a2a-adapter] websocket relay closed for ${service.id}: ${event.code || 0} ${event.reason || ''}`);
          scheduleReconnect();
        };
      }

      connect();
    },
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      if (socket && socket.readyState !== 3) socket.close(1000, 'service stop');
    }
  };
}

function registerService(api, service) {
  registerJsonRoute(api, service.marketPath, async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    sendJson(res, 200, buildMarketCard(req, service));
    return true;
  });
  registerJsonRoute(api, service.protectedPath, createProtectedHandler(service));
  if (service.serviceType === 'websocket') api.registerService(createRelayService(service));
  api.logger.info?.(`[momoai-a2a-adapter] registered ${service.id}: ${service.protectedPath} -> ${service.upstreamPath}`);
}

export default definePluginEntry({
  id: 'momoai-a2a-adapter',
  name: 'MOMOAI A2A Adapter',
  description: 'Adds MOMOAI market metadata and invocation protection around an existing standard A2A endpoint.',
  register(api) {
    const services = normalizeServices(api.pluginConfig);
    for (const service of services) registerService(api, service);
    if (!services.length) api.logger.warn?.('[momoai-a2a-adapter] no enabled services configured');
  }
});
