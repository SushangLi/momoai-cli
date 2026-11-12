import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const configModule=pathToFileURL(join(process.cwd(),'dist/config.js')).href;
const identityModule=pathToFileURL(join(process.cwd(),'dist/identity.js')).href;

test('old plaintext passwords are removed from disk and the config is private',()=>{
  const directory=mkdtempSync(join(tmpdir(),'identity-cli-')),file=join(directory,'config.json');
  try {
    writeFileSync(file,JSON.stringify({account:{username:'fixture',password:'old fixture password',momoKey:'fixture-key'},pendingRegistration:{username:'pending',password:'pending password'}}),{mode:0o644});
    const result=spawnSync(process.execPath,['--input-type=module','-e',`const {loadConfig}=await import(${JSON.stringify(configModule)});loadConfig();`],{env:{...process.env,MOMOAI_CONFIG_PATH:file},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);const stored=JSON.parse(readFileSync(file,'utf8'));
    assert.equal(stored.account.password,undefined);assert.equal(stored.pendingRegistration.password,undefined);assert.equal(stored.account.momoKey,'fixture-key');assert.equal(statSync(file).mode&0o777,0o600);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('automatic login uses an ephemeral session and never returns an old account ID',()=>{
  const code=`
    import assert from 'node:assert/strict';
    const {passwordSession,closePasswordSession}=await import(${JSON.stringify(identityModule)});
    const calls=[];const token='sid_'+ 'a'.repeat(43);
    globalThis.fetch=async(url,options)=>{calls.push({url:String(url),...options});return new Response(JSON.stringify({success:true,user:{userId:'01912345-6789-7abc-8def-0123456789ab',username:'name@example.com'}}),{headers:{'content-type':'application/json','set-cookie':'momo_session='+token+'; HttpOnly; Secure; SameSite=Lax'}});};
    const session=await passwordSession({type:'auto',value:'name@example.com'},'fixture password');
    await closePasswordSession(session.token);
    assert.deepEqual(JSON.parse(calls[0].body).identifier,{type:'auto',value:'name@example.com'});
    assert.equal(calls[1].headers.Authorization,'Bearer '+token);
    assert.equal(calls[0].redirect,'error');
    globalThis.fetch=async()=>new Response(JSON.stringify({success:true,user:{userId:'legacy-name'}}),{headers:{'set-cookie':'momo_session='+token+'; HttpOnly'}});
    await assert.rejects(passwordSession({type:'email',value:'name@example.com'},'fixture password'),/Invalid identity response/);
  `;
  const directory=mkdtempSync(join(tmpdir(),'identity-cli-'));
  try {const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,MOMOAI_CONFIG_PATH:join(directory,'config.json')},encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
  finally{rmSync(directory,{recursive:true,force:true});}
});
