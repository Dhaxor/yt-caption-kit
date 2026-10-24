// Generates public/og-image.png (1200x630) with no external dependencies.
// Pure pixel buffer -> PNG (RGB) via zlib. Run: node scripts/generate-og-image.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const W = 1200;
const H = 630;
const buf = Buffer.alloc(W * H * 3);

function setPixel(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Diagonal brand gradient (#667eea -> #764ba2).
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = (x + y) / (W + H);
    setPixel(x, y, lerp(0x66, 0x76, t), lerp(0x7e, 0x4b, t), lerp(0xea, 0xa2, t));
  }
}

function inRoundRect(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const corners = [
    [x0 + radius, y0 + radius],
    [x1 - radius, y0 + radius],
    [x0 + radius, y1 - radius],
    [x1 - radius, y1 - radius],
  ];
  const nearLeft = x < x0 + radius;
  const nearRight = x > x1 - radius;
  const nearTop = y < y0 + radius;
  const nearBottom = y > y1 - radius;
  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    const cx = nearLeft ? corners[0][0] : corners[1][0];
    const cy = nearTop ? corners[0][1] : corners[2][1];
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }
  return true;
}

function fillRoundRect(x0, y0, x1, y1, radius, r, g, b) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inRoundRect(x, y, x0, y0, x1, y1, radius)) setPixel(x, y, r, g, b);
    }
  }
}

// "Document" card with a subtle shadow.
fillRoundRect(372, 132, 832, 512, 30, 0x33, 0x2a, 0x55);
fillRoundRect(360, 120, 820, 500, 30, 0xff, 0xff, 0xff);

// Transcript lines inside the card.
const lineX = 404;
const lineW = 372;
const lines = [
  [170, lineW],
  [212, lineW],
  [254, lineW - 80],
  [296, lineW],
  [338, lineW - 150],
  [380, lineW - 40],
];
for (const [ly, lw] of lines) {
  fillRoundRect(lineX, ly, lineX + lw, ly + 18, 9, 0xcb, 0xd5, 0xe1);
}

// Play badge bottom-right of the card.
const bx = 760;
const by = 432;
const br = 52;
for (let y = by - br; y <= by + br; y++) {
  for (let x = bx - br; x <= bx + br; x++) {
    if ((x - bx) ** 2 + (y - by) ** 2 <= br * br) setPixel(x, y, 0x76, 0x4b, 0xa2);
  }
}
// White triangle inside the play badge.
for (let y = by - 26; y <= by + 26; y++) {
  const progress = (y - (by - 26)) / 52;
  const half = 26 * (1 - Math.abs(progress - 0.5) * 2);
  const xStart = bx - 16;
  const xEnd = bx - 16 + 30 * (1 - Math.abs(progress - 0.5) * 2) + 4;
  for (let x = xStart; x <= xEnd && half > 0; x++) setPixel(x, y, 0xff, 0xff, 0xff);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // filter: none
  buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "og-image.png");
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
