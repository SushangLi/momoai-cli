import { loadConfig, saveConfig } from '../config.js';
import type { ParsedCommand } from '../parser.js';

export async function permissionCommand(command: ParsedCommand) {
  const mode = command.args[0];
  if (!mode) {
    console.log(`permissionMode: ${loadConfig().permissionMode}`);
    console.log('usage: $permission part | $permission full');
    console.log('part: buy/sell tools ask for confirmation; other tools run automatically');
    console.log('full: all tools run automatically');
    return;
  }

  if (mode !== 'part' && mode !== 'full') {
    throw new Error('Usage: $permission part | $permission full');
  }

  saveConfig({ permissionMode: mode });
  console.log(`permissionMode: ${mode}`);
}
