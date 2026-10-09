// Makes sure the programs Nyahmation needs are downloaded: Electron (the
// app window) and FFmpeg (video export). npm normally fetches them during
// `npm install`, but newer npm versions skip packages' install steps until
// they are approved, so we run those steps ourselves. Then, optionally,
// Rhubarb Lip Sync for automatic lip sync (see rhubarb.mjs). Safe to run any
// time: each one does nothing if its program is already there.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { installRhubarb } from './rhubarb.mjs';

const require = createRequire(import.meta.url);

const steps = [
  { name: 'Electron', pkg: 'electron', script: 'install.js' },
  { name: 'FFmpeg', pkg: 'ffmpeg-static', script: 'install.js' },
];

let failed = false;
for (const step of steps) {
  let dir;
  try {
    dir = dirname(require.resolve(`${step.pkg}/package.json`));
  } catch {
    console.error(`Nyahmation setup: ${step.name} isn't installed. Run "npm install" first.`);
    failed = true;
    continue;
  }
  const script = join(dir, step.script);
  if (!existsSync(script)) continue;
  const result = spawnSync(process.execPath, [script], { cwd: dir, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Nyahmation setup: downloading ${step.name} failed. Check the internet connection and run "npm run setup" to try again.`);
    failed = true;
  }
}
// Optional: a failed download only means no automatic lip sync.
await installRhubarb();
process.exit(failed ? 1 : 0);
