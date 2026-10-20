import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
const entries = ['index.html', 'lang_kr.xml', 'css', 'js', 'assets'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of entries) {
  const src = path.join(root, name);
  if (!fs.existsSync(src)) throw new Error(`Missing web asset: ${src}`);
  fs.cpSync(src, path.join(out, name), { recursive: true });
}
console.log(`web assets synced to ${out}`);
