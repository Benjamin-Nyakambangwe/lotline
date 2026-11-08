// Render the Lotline mark into the PNG icons phones need (run once; the PNGs are committed).
//   node scripts/make-icons.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const BG = "#0f1218";
const VIOLET = "#a78bfa";
// The mark on a 24-unit grid: a rising price line that settles on a dot.
const mark = (stroke, scale = 1, offset = 0) => `
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M5 16.5 9.5 12l3 2.5L18 8" fill="none" stroke="${stroke}" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="18" cy="8" r="2" fill="${stroke}"/>
  </g>`;

const icon = ({ rounded, glyph = 1, fg = VIOLET, bg = BG }) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    ${bg ? `<rect width="24" height="24" rx="${rounded ? 5.5 : 0}" fill="${bg}"/>` : ""}
    ${mark(fg, glyph, (24 - 24 * glyph) / 2)}
  </svg>`;

mkdirSync("public/icons", { recursive: true });
const out = [
  ["icon-192.png", 192, icon({ rounded: true })],
  ["icon-512.png", 512, icon({ rounded: true })],
  // Maskable: full-bleed, mark inside the central safe zone.
  ["maskable-512.png", 512, icon({ rounded: false, glyph: 0.72 })],
  ["apple-touch-icon.png", 180, icon({ rounded: false, glyph: 0.85 })],
  // Android's status-bar badge: white on transparent (only the alpha is used).
  ["badge-96.png", 96, icon({ rounded: false, fg: "#ffffff", bg: null })],
];
for (const [name, size, svg] of out) {
  await sharp(Buffer.from(svg), { density: 600 })
    .resize(size, size)
    .png()
    .toFile(`public/icons/${name}`);
  console.log(`public/icons/${name}`);
}
