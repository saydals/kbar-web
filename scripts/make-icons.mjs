/* Generates the Android launcher icons from assets/icon/k.svg.
 *
 * The adaptive icon (API 26+) is a vector drawable and needs no tooling,
 * but the legacy launcher icons (API 24/25) are bitmaps, so they are
 * rendered here.
 *
 * Requirements: a Chromium build for Playwright
 *   npm i -D playwright && npx playwright install chromium
 *
 * Usage: node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = path.join(root, 'android/app/src/main/res');
const svgPath = path.join(root, 'assets/icon/k.svg');

const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.error('playwright is not installed.');
    console.error('  npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
}

const svg = fs.readFileSync(svgPath, 'utf8');

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();

for (const [density, size] of DENSITIES) {
  const dir = path.join(res, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });

  for (const [name, round] of [
    ['ic_launcher', false],
    ['ic_launcher_round', true],
  ]) {
    const dataUrl = await page.evaluate(
      async ({ svgText, size, round }) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (round) {
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
        }
        ctx.drawImage(img, 0, 0, size, size);
        return canvas.toDataURL('image/png');
      },
      { svgText: svg, size, round }
    );
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const out = path.join(dir, `${name}.png`);
    fs.writeFileSync(out, buf);
    console.log(`${path.relative(root, out)}  ${size}x${size}  ${buf.length} B`);
  }

  /* the old rotorflight bitmaps are replaced by the generated png */
  for (const stale of ['ic_launcher.webp', 'ic_launcher_round.webp']) {
    const p = path.join(dir, stale);
    if (fs.existsSync(p)) {
      fs.rmSync(p);
      console.log(`removed ${path.relative(root, p)}`);
    }
  }
}

await browser.close();
console.log('\nicons generated');
