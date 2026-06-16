// Rasterizes public/icons/tin-man.svg into the PNG sizes the PWA needs.
// Run with: npm run gen:icons
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '../public/icons');
const src = resolve(iconsDir, 'tin-man.svg');

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'maskable-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 },
];

for (const { file, size } of targets) {
  await sharp(src)
    .resize(size, size)
    .png()
    .toFile(resolve(iconsDir, file));
  console.log(`  ✓ ${file} (${size}×${size})`);
}
console.log('Done generating icons.');
