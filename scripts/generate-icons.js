// ponytail: placeholder branding (solid square + circle) generated with only
// Node's built-in zlib -- no image library dependency for a one-off asset.
// Re-run with `node scripts/generate-icons.js` after editing BG/FG below,
// or replace icons/icon*.png directly once real branding exists.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x56, 0x24, 0xd0, 0xff]; // Udemy-purple, matches the injected button
const FG = [0xff, 0xff, 0xff, 0xff]; // white circle

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function buildPng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inside = (x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2 <= r * r;
      const [r8, g8, b8, a8] = inside ? FG : BG;
      raw[offset++] = r8;
      raw[offset++] = g8;
      raw[offset++] = b8;
      raw[offset++] = a8;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`icons/icon${size}.png`, buildPng(size));
  console.log(`icons/icon${size}.png written`);
}
