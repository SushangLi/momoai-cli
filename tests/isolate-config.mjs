import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test imports must never read or migrate a developer's actual credentials.
const directory=mkdtempSync(join(tmpdir(),'momoai-cli-tests-'));
for(const key of Object.keys(process.env))if(key.startsWith('MOMOAI_'))delete process.env[key];
process.env.MOMOAI_CONFIG_PATH=join(directory,'config.json');
process.on('exit',()=>rmSync(directory,{recursive:true,force:true}));
