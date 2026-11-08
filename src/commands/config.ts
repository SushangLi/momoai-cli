import { getConfigPath, loadConfig, saveConfig } from '../config.js';
import { MomoClient } from '../client.js';
import { maskSecret } from '../format.js';
import { flagString, type ParsedCommand } from '../parser.js';
import { readSecret, passwordSession, sessionRequest, closePasswordSession } from '../identity.js';

export async function configCommand(command: ParsedCommand) {
  const [action, key, ...rest] = command.args;
  const showSecrets = command.flags['show-secrets'] === true || command.flags.show_secrets === true;

  if (action === 'reset') {
    if (key === 'key') {
      if (rest.length > 0) {
        throw new Error('Usage: $config reset key [--show-secrets]');
      }

      const config = loadConfig();
      if (!config.account?.username) throw new Error('Log in with $login first.');
      const password = await readSecret('Current password: ');
      const session = await passwordSession({type:'username',value:config.account.username}, password);
      let response: any;
      try { response = await sessionRequest(session.token, '/api/user/momoai-key', {action:'reset'}); }
      finally { await closePasswordSession(session.token); }

      const momoKey = response.data?.key;
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
      if (rest.length || Object.keys(command.flags).some(name => /password/.test(name))) {
        throw new Error('Passwords must be entered at the hidden prompt.');
      }
      const config = loadConfig();
      if (!config.account?.momoKey) throw new Error('Log in with $login first.');
      const oldPassword = await readSecret('Current password: ');
      const newPassword = await readSecret('New password (12+ characters): ');
      if ([...newPassword].length < 12) throw new Error('Password must be at least 12 characters.');
      if (await readSecret('Repeat new password: ') !== newPassword) throw new Error('Passwords do not match.');
      await new MomoClient().request('/api/cli/auth/password', {
        method: 'POST', body: {oldPassword,newPassword}
      });
      console.log('Password changed. Website sessions have been revoked.');
      return;
    }

    throw new Error('Usage: $config reset key [--show-secrets] | $config reset password');
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
    console.log(`account.momoKey: ${showSecrets ? config.account?.momoKey || '(not set)' : maskSecret(config.account?.momoKey)}`);
    console.log(`account.createdAt: ${config.account?.createdAt || '(not set)'}`);
    if (config.pendingRegistration) {
      console.log(`pendingRegistration.email: ${config.pendingRegistration.email}`);
      console.log(`pendingRegistration.username: ${config.pendingRegistration.username}`);
      console.log(`pendingRegistration.createdAt: ${config.pendingRegistration.createdAt}`);
    }
    if (!showSecrets) console.log('secrets: hidden by default; add --show-secrets to reveal local credentials.');
    console.log(`path: ${getConfigPath()}`);
    return;
  }

  throw new Error('Usage: $config show [--show-secrets] | $config reset key [--show-secrets] | $config reset password');
}
