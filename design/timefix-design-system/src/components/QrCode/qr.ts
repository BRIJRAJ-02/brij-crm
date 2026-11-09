// A QR code encoder: byte mode, versions 1 to 40, ECC L/M/Q/H, the lowest-penalty mask. A port of Project Nayuki's
// reference encoder (MIT), the algorithm main's `uqr` implements too, so the design system needs no dependency.

/** Error correction: `M` (15%) by default, `H` (30%) when a logo covers the centre. */
export type QrEcc = 'L' | 'M' | 'Q' | 'H';

const ORD: Readonly<Record<QrEcc, number>> = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT: Readonly<Record<QrEcc, number>> = { L: 1, M: 0, Q: 3, H: 2 };
const ECC_PER_BLOCK: ReadonlyArray<ReadonlyArray<number>> = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS: ReadonlyArray<ReadonlyArray<number>> = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;
const at = (list: ReadonlyArray<number>, i: number) => list[i] ?? 0;

function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
function dataCodewords(ver: number, e: number): number {
  return Math.floor(rawModules(ver) / 8) - at(ECC_PER_BLOCK[e] ?? [], ver) * at(NUM_BLOCKS[e] ?? [], ver);
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(at(out, j), root);
      if (j + 1 < out.length) out[j] = at(out, j) ^ at(out, j + 1);
    }
    root = gfMul(root, 0x02);
  }
  return out;
}
function rsRemainder(data: ReadonlyArray<number>, divisor: ReadonlyArray<number>): number[] {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (out.shift() ?? 0);
    out.push(0);
    divisor.forEach((coef, i) => { out[i] = at(out, i) ^ gfMul(coef, factor); });
  }
  return out;
}

/** The module matrix, `true` dark, with a quiet border of `border` modules. */
export function encodeQr(text: string, ecc: QrEcc = 'M', border = 4): boolean[][] {
  const e = ORD[ecc];
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  for (; ver <= 40; ver++) {
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver, e) * 8) break;
  }
  if (ver > 40) throw new Error('Too much data for a QR code');
  const ccBits = ver <= 9 ? 8 : 16;
  const capacity = dataCodewords(ver, e) * 8;

  // Data bits: mode, count, bytes, terminator, byte padding, pad codewords.
  const bits: number[] = [];
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ccBits);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));

  // Error correction blocks, interleaved.
  const numBlocks = at(NUM_BLOCKS[e] ?? [], ver);
  const eccLen = at(ECC_PER_BLOCK[e] ?? [], ver);
  const raw = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const rem = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(rem));
  }
  const codewords: number[] = [];
  for (let i = 0; i < (blocks[0]?.length ?? 0); i++) {
    blocks.forEach((block, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(at(block, i)); });
  }

  // The matrix and its function patterns.
  const size = ver * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { const r = m[y]; const f = fn[y]; if (r && f) { r[x] = dark; f[x] = true; } };
  const get = (x: number, y: number) => m[y]?.[x] === true;
  const isFn = (x: number, y: number) => fn[y]?.[x] === true;

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx; const y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((px, i) => pos.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const formatBits = (mask: number) => {
    const d = (FORMAT[ecc] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
    set(8, size - 8, true);
  };
  formatBits(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3); const c = Math.floor(i / 3);
      set(a, c, bit(b, i)); set(c, a, bit(b, i));
    }
  }

  // The codewords, in the zigzag.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!isFn(x, y) && i < codewords.length * 8) {
        const row = m[y];
        if (row) row[x] = bit(at(codewords, i >>> 3), 7 - (i & 7));
        i++;
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const inv = [
        (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
        (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0,
        (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
      ][mask];
      const row = m[y];
      if (row && inv && !isFn(x, y)) row[x] = !row[x];
    }
  };
  const penalty = (): number => {
    let score = 0;
    const lines = (read: (a: number, b: number) => boolean) => {
      for (let a = 0; a < size; a++) {
        let color = false; let run = 0; const h = [0, 0, 0, 0, 0, 0, 0];
        const add = (len: number) => { if (h[0] === 0) len += size; h.pop(); h.unshift(len); };
        const count = () => {
          const n = at(h, 1);
          const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
          return (core && at(h, 0) >= n * 4 && at(h, 6) >= n ? 1 : 0) + (core && at(h, 6) >= n * 4 && at(h, 0) >= n ? 1 : 0);
        };
        for (let b = 0; b < size; b++) {
          if (read(a, b) === color) {
            run++;
            if (run === 5) score += 3; else if (run > 5) score++;
          } else {
            add(run);
            if (!color) score += count() * 40;
            color = read(a, b); run = 1;
          }
        }
        if (color) { add(run); run = 0; }
        run += size; add(run);
        score += count() * 40;
      }
    };
    lines((y, x) => get(x, y));
    lines((x, y) => get(x, y));
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = get(x, y);
      if (c) dark++;
      if (x < size - 1 && y < size - 1 && c === get(x + 1, y) && c === get(x, y + 1) && c === get(x + 1, y + 1)) score += 3;
    }
    const total = size * size;
    return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  };
  let best = 0; let min = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); formatBits(mask);
    const p = penalty();
    if (p < min) { min = p; best = mask; }
    applyMask(mask);
  }
  applyMask(best); formatBits(best);

  const full = size + border * 2;
  return Array.from({ length: full }, (_, y) => Array.from({ length: full }, (_, x) => get(x - border, y - border)));
}
