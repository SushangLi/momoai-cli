import { saveConfig } from '../config.js';
import { readSecret,passwordSession,sessionRequest,closePasswordSession } from '../identity.js';
import { flagString,type ParsedCommand } from '../parser.js';

export async function loginCommand(command:ParsedCommand) {
  const username=flagString(command.flags,'username'),email=flagString(command.flags,'email'),account=flagString(command.flags,'account');
  if(command.args.length || [username,email,account].filter(Boolean).length!==1)throw new Error('Usage: $login --account <email-or-username> | --username <name> | --email <email> [--password-stdin]');
  const password=await readSecret('Password: ',command.flags['password-stdin']===true);
  const session=await passwordSession(account?{type:'auto',value:account}:username?{type:'username',value:username}:{type:'email',value:email!},password);
  try {
    let result=await sessionRequest(session.token,'/api/user/momoai-key');
    if(!result.data?.key)result=await sessionRequest(session.token,'/api/user/momoai-key',{action:'create'});
    if(!result.data?.key)throw new Error('No API key returned.');
    saveConfig({account:{userId:session.user.userId,username:session.user.username,email:session.user.email || '',momoKey:result.data.key,createdAt:new Date().toISOString()},pendingRegistration:undefined});
    console.log(`Logged in as ${session.user.username} (${session.user.userId}).`);
  }finally{await closePasswordSession(session.token);}
}
