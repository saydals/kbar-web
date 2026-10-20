import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = (process.argv[2] || 'debug').toLowerCase(); // debug | release
const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, cwd: root, ...opts });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${res.status})`);
  }
}

function runIn(dir, cmd, args) {
  console.log(`> (cd ${dir}) ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, cwd: path.join(root, dir) });
  if (res.status !== 0) {
    throw new Error(`Command failed in ${dir}: ${cmd} ${args.join(' ')} (exit ${res.status})`);
  }
}

const gradleCmd = isWin ? '.\\gradlew.bat' : './gradlew';
const gradleTask = mode === 'release' ? 'assembleRelease' : 'assembleDebug';

// 1) www sync (index.html + css/js/assets -> www/)
run('node', ['scripts/sync-www.mjs']);
// 2) capacitor sync
run('npx', ['cap', 'sync', 'android']);
// 3) gradle build
runIn('android', gradleCmd, [gradleTask]);

// 4) copy APK to repo root
const src = path.join(root, `android/app/build/outputs/apk/${mode}/app-${mode}.apk`);
const dst = path.join(root, mode === 'release' ? 'kbar-release.apk' : 'kbar-debug.apk');
if (!fs.existsSync(src)) throw new Error(`APK not found: ${src}`);
fs.copyFileSync(src, dst);
const sizeMb = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
console.log(`\nOK: ${path.basename(dst)} (${sizeMb} MB)`);
console.log(`Install on Windows: adb install -r ${path.basename(dst)}`);
