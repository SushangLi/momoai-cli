import { randomBytes } from 'node:crypto';
import { MomoClient } from '../client.js';
import { loadConfig, saveConfig } from '../config.js';
import { maskSecret } from '../format.js';
import type { ParsedCommand } from '../parser.js';

const suffixChars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function yyyymmdd() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function randomSuffix(length: number) {
  let result = '';
  const bytes = randomBytes(length);
  for (const byte of bytes) {
    result += suffixChars[byte % suffixChars.length];
  }
  return result;
}

function randomPassword() {
  return randomBytes(18).toString('base64url');
}

export async function registerCommand(command: ParsedCommand) {
  if (command.args.length > 0) {
    throw new Error('Usage: $register [--show-secrets]');
  }
  const showSecrets = command.flags['show-secrets'] === true || command.flags.show_secrets === true;

  const client = new MomoClient();
  const config = loadConfig();
  if (config.account?.email || config.account?.momoKey) {
    throw new Error(`Account already exists in local config: ${config.account.email || '(email not set)'}. Use $config show to view details.`);
  }

  const existing = config.pendingRegistration;
  const registration = existing || createRegistration();

  if (!existing) {
    saveConfig({ pendingRegistration: registration });
    await client.request<any>('/api/auth/register', {
      auth: false,
      method: 'POST',
      body: {
        username: registration.username,
        email: registration.email,
        password: registration.password
      }
    });
  }

  const momoKey = await pollForMomoKey(registration.email, registration.password);

  saveConfig({
    account: {
      ...registration,
      momoKey
    },
    pendingRegistration: undefined
  });

  console.log('Registration succeeded.');
  console.log(`email: ${registration.email}`);
  console.log(`username: ${registration.username}`);
  console.log(`password: ${showSecrets ? registration.password : maskSecret(registration.password)}`);
  console.log(`momo_key: ${showSecrets ? momoKey : maskSecret(momoKey)}`);
  if (!showSecrets) {
    console.log('secrets: hidden by default; run $config show --show-secrets if you need to copy them.');
  }
}

function createRegistration() {
  const username = `momocli-${yyyymmdd()}-${randomSuffix(4)}`;
  return {
    email: `${username}@gmail.com`,
    username,
    password: randomPassword(),
    createdAt: new Date().toISOString()
  };
}

async function pollForMomoKey(email: string, password: string): Promise<string> {
  const startedAt = Date.now();
  const timeoutMs = 90_000;
  let lastError = 'MOMO key was not available yet.';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const key = await checkMomoKey(email, password);
      if (key) return key;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(`Timed out waiting for MOMO key. Run $register again to resume polling. Last error: ${lastError}`);
}

async function checkMomoKey(email: string, password: string): Promise<string | undefined> {
  const config = loadConfig();
  const loginUrl = new URL('/api/auth/login', `${config.apiUrl}/`);
  const loginResponse = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  const loginPayload = await loginResponse.json().catch(() => ({}));
  if (!loginResponse.ok || loginPayload.success === false) {
    throw new Error(loginPayload.message || loginPayload.error || `Login failed: HTTP ${loginResponse.status}`);
  }

  const keyFromLogin = loginPayload.user?.user_momoai_key;
  if (keyFromLogin) return keyFromLogin;

  if (!loginPayload.authToken) {
    return undefined;
  }

  const url = new URL('/api/user/momoai-key', `${config.apiUrl}/`);
  const createResponse = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginPayload.authToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ action: 'create' })
  });

  const createPayload = await createResponse.json().catch(() => ({}));
  if (createResponse.ok && createPayload.data?.user_momoai_key) {
    return createPayload.data.user_momoai_key;
  }

  const message = String(createPayload.error || createPayload.message || '');
  if (message.includes('已存在') || message.toLowerCase().includes('exists')) {
    return undefined;
  }

  throw new Error(message || `MOMO key check failed: HTTP ${createResponse.status}`);
}
