import { getConfigPath, loadConfig, saveConfig } from '../config.js';
import { MomoClient } from '../client.js';
import { maskSecret } from '../format.js';
import { flagString, type ParsedCommand } from '../parser.js';
import { randomBytes } from 'node:crypto';

function randomPassword() {
  return randomBytes(18).toString('base64url');
}

export async function configCommand(command: ParsedCommand) {
  const [action, key, ...rest] = command.args;
  const showSecrets = command.flags['show-secrets'] === true || command.flags.show_secrets === true;

  if (action === 'reset') {
    if (key === 'key') {
      if (rest.length > 0) {
        throw new Error('Usage: $config reset key [--show-secrets]');
      }

      const config = loadConfig();
      if (!config.account?.email || !config.account.password) {
        throw new Error('No account email/password stored. Run $register first.');
      }

      const authToken = await loginForAuthToken(config.account.email, config.account.password);
      const response = await new MomoClient().request<any>('/api/user/momoai-key', {
        method: 'POST',
        auth: false,
        authToken,
        body: { action: 'reset' }
      });

      const momoKey = response.data?.user_momoai_key;
      if (!momoKey) {
        throw new Error('Key reset succeeded but no MOMO key was returned.');
      }

      saveConfig({
        account: {
          ...config.account,
          momoKey
        }
      });

      console.log('MOMO key reset succeeded.');
      console.log(`momo_key: ${showSecrets ? momoKey : maskSecret(momoKey)}`);
      if (!showSecrets) console.log('secrets: hidden by default; rerun with --show-secrets if you need to copy the new key.');
      return;
    }

    if (key === 'password') {
      if (rest.length > 1) {
        throw new Error('Usage: $config reset password [new_password] [--old-password old_password] [--show-secrets]');
      }

      const newPassword = rest[0] || randomPassword();
      if (newPassword.length < 6) {
        throw new Error('Password must be at least 6 characters.');
      }

      const config = loadConfig();
      if (!config.account?.momoKey) {
        throw new Error('No MOMO key stored. Run $register first.');
      }

      const oldPassword = flagString(command.flags, 'old-password') || flagString(command.flags, 'old_password') || config.account.password;
      if (!oldPassword) {
        throw new Error('Old password is required. Use --old-password old_password.');
      }

      await new MomoClient().request<any>('/api/cli/auth/password', {
        method: 'POST',
        body: { oldPassword, newPassword }
      });

      saveConfig({
        account: {
          ...config.account,
          password: newPassword
        }
      });

      console.log('Password reset succeeded.');
      console.log(`password: ${showSecrets ? newPassword : maskSecret(newPassword)}`);
      if (!showSecrets) console.log('secrets: hidden by default; rerun with --show-secrets if you need to copy the new password.');
      return;
    }

    throw new Error('Usage: $config reset key [--show-secrets] | $config reset password [new_password] [--old-password old_password] [--show-secrets]');
  }

  if (!action || action === 'show') {
    const config = loadConfig();
    console.log(`apiUrl: ${config.apiUrl}`);
    console.log(`model: ${config.model}`);
    console.log(`defaultModels: ${config.defaultModels.join(', ')}`);
    console.log(`permissionMode: ${config.permissionMode}`);
    console.log(`agent.mode: ${config.agent.mode}`);
    console.log(`agent.name: ${config.agent.name}`);
    console.log(`agent.host: ${config.agent.host}`);
    console.log(`agent.port: ${config.agent.port}`);
    console.log(`agent.agentId: ${config.agent.agentId || '(not set)'}`);
    console.log(`agent.providerRuntime: ${config.agent.providerRuntime}`);
    console.log(`agent.providerExecutor: ${config.agent.providerExecutor || '(not set)'}`);
    console.log(`agent.capabilities: ${config.agent.capabilities.map((capability) => `${capability.id}${capability.fixedTokens ? `:${capability.fixedTokens}` : ''}`).join(', ')}`);
    const profileNames = Object.keys(config.agentProfiles || {});
    console.log(`agentProfiles: ${profileNames.length ? profileNames.join(', ') : '(none)'}`);
    console.log(`memory.path: ${config.memory.path || '~/.momoai-cli/memory'}`);
    console.log(`memory.contextTokenLimit: ${config.memory.contextTokenLimit}`);
    console.log(`memory.recentTokenBudget: ${config.memory.recentTokenBudget}`);
    console.log(`account.email: ${config.account?.email || '(not set)'}`);
    console.log(`account.username: ${config.account?.username || '(not set)'}`);
    console.log(`account.password: ${showSecrets ? config.account?.password || '(not set)' : maskSecret(config.account?.password)}`);
    console.log(`account.momoKey: ${showSecrets ? config.account?.momoKey || '(not set)' : maskSecret(config.account?.momoKey)}`);
    console.log(`account.createdAt: ${config.account?.createdAt || '(not set)'}`);
    if (config.pendingRegistration) {
      console.log(`pendingRegistration.email: ${config.pendingRegistration.email}`);
      console.log(`pendingRegistration.username: ${config.pendingRegistration.username}`);
      console.log(`pendingRegistration.password: ${showSecrets ? config.pendingRegistration.password : maskSecret(config.pendingRegistration.password)}`);
      console.log(`pendingRegistration.createdAt: ${config.pendingRegistration.createdAt}`);
    }
    if (!showSecrets) console.log('secrets: hidden by default; add --show-secrets to reveal local credentials.');
    console.log(`path: ${getConfigPath()}`);
    return;
  }

  throw new Error('Usage: $config show [--show-secrets] | $config reset key [--show-secrets] | $config reset password [new_password] [--old-password old_password] [--show-secrets]');
}

async function loginForAuthToken(email: string, password: string): Promise<string> {
  const config = loadConfig();
  const loginUrl = new URL('/api/auth/login', `${config.apiUrl}/`);
  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false || !payload.authToken) {
    throw new Error(payload.message || payload.error || `Login failed: HTTP ${response.status}`);
  }

  return payload.authToken;
}
