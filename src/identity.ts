import { StringDecoder } from 'node:string_decoder';
import { readFileSync } from 'node:fs';
import { stdin, stderr } from 'node:process';
import { loadConfig } from './config.js';

export function parseUserId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error('Invalid canonical userId');
  return value;
}

export type LoginIdentifier = { type: 'username' | 'email'; value: string };

export async function readSecret(prompt: string, fromStdin = false): Promise<string> {
  if (fromStdin) {
    if (stdin.isTTY) throw new Error('--password-stdin requires piped input.');
    return readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  }
  if (!stdin.isTTY) throw new Error('A terminal is required; use --password-stdin for login or registration.');
  stderr.write(prompt);
  const previousRaw=stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve,reject) => {
    let text='';
    const decoder=new StringDecoder('utf8');
    const finish=(error?:Error) => {
      stdin.removeListener('data',onData);
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stderr.write('\n');
      if(error)reject(error);else resolve(text);
    };
    const onData=(chunk:Buffer) => {
      for(const char of decoder.write(chunk)) {
        if(char==='\u0003' || char==='\u0004'){finish(new Error('Cancelled.'));return;}
        if(char==='\r' || char==='\n'){finish();return;}
        if(char==='\u007f' || char==='\b')text=[...text].slice(0,-1).join('');
        else if(char>=' ')text+=char;
      }
    };
    stdin.on('data',onData);
  });
}

async function request(path: string, body?: unknown, session?: string) {
  const url=new URL(path,loadConfig().apiUrl);
  if(url.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Authentication requires HTTPS.');
  const response=await fetch(url, {
    method:body===undefined?'GET':'POST', redirect:'error',
    headers:{'Content-Type':'application/json',Origin:url.origin,...(session?{Authorization:`Bearer ${session}`}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok || payload.success===false)throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  return {response,payload};
}

export async function passwordSession(identifier: LoginIdentifier,password:string) {
  const {response,payload}=await request('/api/auth/login',{identifier,password});
  const token=response.headers.get('set-cookie')?.match(/(?:^|,\s*)momo_session=(sid_[A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
  if(!token || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.user?.userId || ''))throw new Error('Invalid identity response. Upgrade the server and CLI together.');
  return {token,user:payload.user};
}

export async function sessionRequest(token:string,path:string,body?:unknown) {
  return (await request(path,body,token)).payload;
}

export async function closePasswordSession(token:string) {
  await request('/api/auth/logout',{},token);
}

export async function registerAccount(input:{username:string;email:string;password:string}) {
  return (await request('/api/auth/register',input)).payload;
}
