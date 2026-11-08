import { saveConfig } from '../config.js';
import { readSecret,registerAccount } from '../identity.js';
import { flagString,type ParsedCommand } from '../parser.js';

export async function registerCommand(command:ParsedCommand) {
  const username=flagString(command.flags,'username'),email=flagString(command.flags,'email');
  if(command.args.length || !username || !email)throw new Error('Usage: $register --username <name> --email <email> [--password-stdin]');
  const password=await readSecret('New password (12+ characters): ',command.flags['password-stdin']===true);
  if([...password].length<12)throw new Error('Password must be at least 12 characters.');
  const result=await registerAccount({username,email,password});
  saveConfig({pendingRegistration:{username,email,createdAt:new Date().toISOString()}});
  console.log(result.message || 'Account created. Verify your email, then run $login.');
}
