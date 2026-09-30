// Renders the home-screen icons into public/ from the logo: a flight arc with the center of mass at its top.
// Run with `make icons`; the PNGs are committed, so a build never needs this.
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const GOLD = '#ffc933';
const INK = '#f4f6f8';

/**
 * The artwork on a 512 grid. It stays inside the central 80% circle, the part a phone's icon mask always keeps, so the
 * same picture serves the masked and the unmasked icons.
 */
function icon({ radius }) {
  // The logo's arc (M4 25 Q16 -3 28 25, dot at 16 11) scaled by 13 around the middle of the tile.
  const at = (x, y) => `${256 + (x - 16) * 13} ${256 + (y - 18) * 13}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#262a32" />
      <stop offset="1" stop-color="#0d0f12" />
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${GOLD}" stop-opacity="0.34" />
      <stop offset="1" stop-color="${GOLD}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)" />
  <circle cx="256" cy="${256 + (11 - 18) * 13}" r="120" fill="url(#glow)" />
  <path d="M${at(4, 25)} Q${at(16, -3)} ${at(28, 25)}" fill="none" stroke="${INK}" stroke-width="34" stroke-linecap="round" />
  <circle cx="256" cy="${256 + (11 - 18) * 13}" r="46" fill="${GOLD}" />
</svg>`;
}

// iOS and Android round the corners themselves: those icons are a plain full square. The "any" icons keep their own corners.
const OUT = [
  { file: 'apple-touch-icon.png', size: 180, radius: 0 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0 },
  { file: 'icon-192.png', size: 192, radius: 112 },
  { file: 'icon-512.png', size: 512, radius: 112 },
];

for (const { file, size, radius } of OUT) {
  const png = await sharp(Buffer.from(icon({ radius })), { density: 72 * (size / 512) * 4 })
    .resize(size, size)
    .png()
    .toBuffer();
  await writeFile(new URL(`../public/${file}`, import.meta.url), png);
  console.log(`public/${file} ${size}x${size}`);
}
