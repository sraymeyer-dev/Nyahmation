// Downloads Rhubarb Lip Sync (https://github.com/DanielSWolf/rhubarb-lip-sync,
// MIT licence), the program behind automatic lip sync (docs/DESIGN.md LS7),
// into vendor/rhubarb for this computer's system. Only the program, its
// speech models and its licence are kept.
//
// It's optional: if the download fails, Nyahmation works as before and the
// Auto lip sync button explains how to try again (npm run setup).
// Set NYAH_SKIP_RHUBARB=1 to skip it.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

export const RHUBARB_VERSION = '1.14.0';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'vendor', 'rhubarb');
const marker = join(target, 'VERSION');

const PLATFORMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

async function download(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    // Some networks (proxies) only work for curl, which comes with macOS and Windows 10+.
    const file = join(tmpdir(), `rhubarb-${process.pid}.zip`);
    const r = spawnSync('curl', ['-sSfL', '-o', file, url], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`download failed (${err.message})`);
    const bytes = new Uint8Array(readFileSync(file));
    rmSync(file, { force: true });
    return bytes;
  }
}

export async function installRhubarb() {
  if (process.env.NYAH_SKIP_RHUBARB) return true;
  const platform = PLATFORMS[process.platform];
  if (!platform) {
    console.warn(`Nyahmation setup: automatic lip sync isn't available on ${process.platform}.`);
    return true;
  }
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === RHUBARB_VERSION) return true;

  const name = `Rhubarb-Lip-Sync-${RHUBARB_VERSION}-${platform}`;
  const url = `https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v${RHUBARB_VERSION}/${name}.zip`;
  console.log(`Nyahmation setup: downloading Rhubarb Lip Sync ${RHUBARB_VERSION} for automatic lip sync (about 90 MB)…`);
  try {
    const zip = await download(url);
    const exe = process.platform === 'win32' ? 'rhubarb.exe' : 'rhubarb';
    const keep = (path) => path === `${name}/${exe}` || path === `${name}/LICENSE.md` || (path.startsWith(`${name}/res/`) && !path.endsWith('/'));
    const files = unzipSync(zip, { filter: (f) => keep(f.name) });
    if (!files[`${name}/${exe}`]) throw new Error('the download had no rhubarb program in it');
    rmSync(target, { recursive: true, force: true });
    for (const [path, bytes] of Object.entries(files)) {
      const out = join(target, path.slice(name.length + 1));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
    }
    if (process.platform !== 'win32') chmodSync(join(target, exe), 0o755);
    writeFileSync(marker, RHUBARB_VERSION);
    return true;
  } catch (err) {
    console.warn(`Nyahmation setup: couldn't get Rhubarb Lip Sync (${err.message}). Everything else works; run "npm run setup" later to add automatic lip sync.`);
    return false;
  }
}
