import { execFile } from 'node:child_process';
import type { ResolvedAgentConfig } from '../config.js';

type FunnelKind = 'cli' | 'openclaw' | 'custom';

interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface TailscaleFunnelOptions {
  tailscaleBin?: string;
  kind?: FunnelKind;
  localBaseUrl?: string;
  hostname?: string;
  httpsPort?: number;
  serviceId?: string;
  providerPath?: string;
  upstreamPath?: string;
  agentCardPath?: string;
  marketPath?: string;
  oasfPath?: string;
  paths?: string[];
  includeStandard?: boolean;
  disable?: boolean;
  dryRun?: boolean;
}

export interface TailscaleFunnelResult {
  kind: FunnelKind;
  localBaseUrl: string;
  hostname?: string;
  publicBaseUrl?: string;
  providerUrl?: string;
  httpsPort: number;
  paths: Array<{
    path: string;
    target: string;
    command: string[];
    executed: boolean;
  }>;
  status?: unknown;
  dryRun: boolean;
  disabled: boolean;
}

function execTailscale(tailscaleBin: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(tailscaleBin, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${tailscaleBin} ${args.join(' ')} failed: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function normalizeRoutePath(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim();
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, '') || '/';
}

function sanitizeServiceId(value: string | undefined) {
  const normalized = String(value || 'default')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'default';
}

function normalizeLocalBaseUrl(value: string | undefined, fallback: string) {
  const url = new URL(value || fallback);
  if (url.protocol !== 'http:') {
    throw new Error('Tailscale Funnel local target must use http://127.0.0.1 or http://localhost.');
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Tailscale Funnel local target must stay on loopback. Use a local reverse proxy if the service listens elsewhere.');
  }
  url.hostname = '127.0.0.1';
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function splitPaths(value: string[] | undefined) {
  return (value || [])
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths.map((path) => normalizeRoutePath(path, path)))];
}

function defaultPaths(agent: ResolvedAgentConfig, options: TailscaleFunnelOptions, kind: FunnelKind) {
  const serviceId = sanitizeServiceId(options.serviceId || agent.profile);
  const isDefault = serviceId === 'default';
  const providerPath = normalizeRoutePath(
    options.providerPath,
    kind === 'openclaw'
      ? isDefault ? '/momoai/a2a' : `/momoai/a2a/${serviceId}`
      : '/a2a'
  );

  if (kind === 'custom') {
    const customPaths = uniquePaths(splitPaths(options.paths));
    if (!customPaths.length) throw new Error('custom Tailscale Funnel exposure requires --paths <comma-separated-paths>.');
    return { serviceId, providerPath, paths: customPaths };
  }

  if (kind === 'cli') {
    const paths = uniquePaths([
      providerPath,
      normalizeRoutePath(options.agentCardPath, '/.well-known/agent-card.json'),
      normalizeRoutePath(options.marketPath, '/.well-known/momoai-a2a/market-card.json'),
      ...splitPaths(options.paths)
    ]);
    return { serviceId, providerPath, paths };
  }

  const upstreamPath = normalizeRoutePath(options.upstreamPath, isDefault ? '/a2a' : `/a2a/${serviceId}`);
  const agentCardPath = normalizeRoutePath(options.agentCardPath, isDefault ? '/.well-known/agent-card.json' : `/.well-known/a2a/${serviceId}/agent-card.json`);
  const marketPath = normalizeRoutePath(options.marketPath, isDefault ? '/.well-known/momoai-a2a/market-card.json' : `/.well-known/momoai-a2a/${serviceId}/market-card.json`);
  const oasfPath = normalizeRoutePath(options.oasfPath, isDefault ? '/.well-known/momoai-a2a/oasf-record.json' : `/.well-known/momoai-a2a/${serviceId}/oasf-record.json`);
  const paths = uniquePaths([
    providerPath,
    marketPath,
    ...(options.includeStandard ? [upstreamPath, agentCardPath] : []),
    ...splitPaths(options.oasfPath ? [oasfPath] : undefined),
    ...splitPaths(options.paths)
  ]);
  return { serviceId, providerPath, paths };
}

function hostnameFromStatus(status: any) {
  const dnsName = String(status?.Self?.DNSName || '').trim().replace(/\.$/, '');
  if (dnsName) return dnsName;
  const hostName = String(status?.Self?.HostName || '').trim();
  const suffix = String(status?.MagicDNSSuffix || status?.CurrentTailnet?.MagicDNSSuffix || '').trim().replace(/^\./, '');
  if (hostName && suffix) return `${hostName}.${suffix}`;
  return undefined;
}

async function readTailscaleStatus(tailscaleBin: string, dryRun: boolean) {
  if (dryRun) return undefined;
  const result = await execTailscale(tailscaleBin, ['status', '--json']);
  return JSON.parse(result.stdout);
}

export async function exposeViaTailscaleFunnel(agent: ResolvedAgentConfig, options: TailscaleFunnelOptions = {}): Promise<TailscaleFunnelResult> {
  const kind = options.kind || 'cli';
  const tailscaleBin = options.tailscaleBin || 'tailscale';
  const httpsPort = Number(options.httpsPort || 443);
  if (!Number.isInteger(httpsPort) || httpsPort <= 0) throw new Error('--https-port must be a positive integer.');

  const localBaseUrl = normalizeLocalBaseUrl(
    options.localBaseUrl,
    kind === 'openclaw' ? 'http://127.0.0.1:18789' : `http://${agent.host}:${agent.port}`
  );
  const resolved = defaultPaths(agent, options, kind);
  const status = await readTailscaleStatus(tailscaleBin, Boolean(options.dryRun));
  const hostname = options.hostname || hostnameFromStatus(status);
  const publicBaseUrl = hostname ? `https://${hostname}` : undefined;
  const providerUrl = publicBaseUrl ? `${publicBaseUrl}${resolved.providerPath}` : undefined;

  const paths = [];
  for (const path of resolved.paths) {
    const target = `${localBaseUrl}${path}`;
    const args = options.disable
      ? ['funnel', `--https=${httpsPort}`, `--set-path=${path}`, 'off']
      : ['funnel', '--bg', '--yes', `--https=${httpsPort}`, `--set-path=${path}`, target];
    if (!options.dryRun) await execTailscale(tailscaleBin, args);
    paths.push({
      path,
      target,
      command: [tailscaleBin, ...args],
      executed: !options.dryRun
    });
  }

  return {
    kind,
    localBaseUrl,
    hostname,
    publicBaseUrl,
    providerUrl,
    httpsPort,
    paths,
    status,
    dryRun: Boolean(options.dryRun),
    disabled: Boolean(options.disable)
  };
}
