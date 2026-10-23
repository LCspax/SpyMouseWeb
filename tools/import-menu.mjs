import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const bundled=path.join(process.env.USERPROFILE||'', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python=process.env.SPYMOUSE_PYTHON || (fs.existsSync(bundled)?bundled:'python');
for(const script of ['tools/import-menu.py','tools/import-menu-audio.py']) {
  const result=spawnSync(python,[script],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
