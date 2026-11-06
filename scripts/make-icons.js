/*
 * Builds the favicon set from public/assets/logo.png:
 *   public/favicon.ico (16, 32, 48), public/icons/icon-192.png, icon-512.png, maskable-512.png,
 *   public/icons/apple-touch-icon.png (180, on white), public/icons/favicon-32.png
 * Run after changing the logo:  npm run icons
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'assets', 'logo.png');
const OUT = path.join(ROOT, 'public', 'icons');

/** Square PNG of the logo at `size`, with `pad` (fraction) of space around it, on `bg` (or transparent). */
async function square(size, pad, bg) {
  const inner = Math.round(size * (1 - pad * 2));
  const logo = await sharp(SRC).trim({ threshold: 10 }).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .sharpen(size <= 48 ? { sigma: 0.6 } : undefined).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg || { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, gravity: 'center' }]).png({ compressionLevel: 9, palette: size > 48, quality: 90 }).toBuffer();
}

/** ICO container holding PNG images (supported by every current browser and Windows). */
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, dir, ...images.map((x) => x.data)]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const white = { r: 255, g: 255, b: 255, alpha: 1 };
  const small = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await square(size, 0, null) })));
  fs.writeFileSync(path.join(ROOT, 'public', 'favicon.ico'), ico(small));
  fs.writeFileSync(path.join(OUT, 'favicon-32.png'), small[1].data);
  fs.writeFileSync(path.join(OUT, 'favicon-48.png'), small[2].data);
  fs.writeFileSync(path.join(OUT, 'icon-192.png'), await square(192, 0.04, null));
  fs.writeFileSync(path.join(OUT, 'icon-512.png'), await square(512, 0.04, null));
  // Android may crop to a circle: keep the logo inside the central 80% safe zone, on white.
  fs.writeFileSync(path.join(OUT, 'maskable-512.png'), await square(512, 0.14, white));
  // iOS fills transparency with black, so the home-screen icon sits on white.
  fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), await square(180, 0.08, white));
  console.log('Icons written to public/favicon.ico and public/icons/');
})().catch((e) => { console.error(e); process.exit(1); });
