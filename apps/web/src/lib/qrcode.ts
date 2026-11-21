// Lightweight zero-dependency QR Code generator (Byte mode, ECC Level L, Versions 1-10)
// Renders crisp SVG data URI completely offline with zero external requests.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsPoly(ecCount: number): number[] {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], ecCount: number): number[] {
  const gen = rsPoly(ecCount);
  const res = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) {
        res[i] ^= gfMul(gen[i + 1], factor);
      }
    }
  }
  return res;
}

// [version, totalCodewords, ecPerBlock, numBlocks, alignCenters]
const VERSIONS: Array<[number, number, number, number, number[]]> = [
  [1, 26, 7, 1, []],
  [2, 44, 10, 1, [6, 18]],
  [3, 70, 15, 1, [6, 22]],
  [4, 100, 20, 1, [6, 26]],
  [5, 134, 26, 1, [6, 30]],
  [6, 172, 18, 2, [6, 34]],
  [7, 196, 20, 2, [6, 22, 38]],
  [8, 242, 24, 2, [6, 24, 42]],
  [9, 292, 30, 2, [6, 26, 46]],
  [10, 346, 18, 4, [6, 28, 50]],
];

function encodeBits(bytes: Uint8Array, ver: number, dataCap: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4); // Byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const maxBits = dataCap * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  const pad = [0xec, 0x11];
  let pi = 0;
  while (out.length < dataCap) {
    out.push(pad[pi % 2]);
    pi++;
  }
  return out;
}

function buildMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let chosen = VERSIONS[VERSIONS.length - 1];
  for (const v of VERSIONS) {
    const dataCap = v[1] - v[2] * v[3];
    const overhead = v[0] <= 9 ? 2 : 3;
    if (bytes.length + overhead <= dataCap) {
      chosen = v;
      break;
    }
  }
  const [ver, totalCw, ecPerBlock, numBlocks, align] = chosen;
  const dataCap = totalCw - ecPerBlock * numBlocks;
  const trimmed = bytes.slice(0, Math.max(1, dataCap - 3));
  const dataCw = encodeBits(trimmed, ver, dataCap);

  // Split into blocks & compute ECC
  const shortBlockLen = Math.floor(dataCap / numBlocks);
  const longBlocks = dataCap % numBlocks;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = shortBlockLen + (b >= numBlocks - longBlocks ? 1 : 0);
    const slice = dataCw.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, ecPerBlock));
  }

  const finalBytes: number[] = [];
  const maxDataLen = shortBlockLen + (longBlocks > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) if (i < blk.length) finalBytes.push(blk[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const blk of ecBlocks) finalBytes.push(blk[i]);
  }

  const size = ver * 4 + 17;
  const grid: Array<Array<boolean | null>> = Array.from({ length: size }, () => new Array(size).fill(null));
  const isFunc: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFunc = (r: number, c: number, val: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = val;
      isFunc[r][c] = true;
    }
  };

  // Finder patterns
  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r0 + dr, c0 + dc, inOuter && (onBorder || inInner));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  for (const r of align) {
    for (const c of align) {
      if (isFunc[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Dark module & reserve format info
  setFunc(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunc[8][i] = true;
      isFunc[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunc[8][size - 1 - i] = true;
    isFunc[size - 1 - i][8] = true;
  }

  // Version info (v >= 7)
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const vBits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // Place data bits (mask 0: (r + c) % 2 === 0)
  const bitStream: number[] = [];
  for (const b of finalBytes) {
    for (let i = 7; i >= 0; i--) bitStream.push((b >> i) & 1);
  }
  let bi = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (!isFunc[r][c]) {
          const rawBit = bi < bitStream.length ? bitStream[bi++] === 1 : false;
          const masked = (r + c) % 2 === 0 ? !rawBit : rawBit;
          grid[r][c] = masked;
        }
      }
    }
    upward = !upward;
  }

  // Format info for ECC Level L (01) + Mask 0 (000) => 5-bit data = 01000 = 8
  const fmtData = (0b01 << 3) | 0b000;
  let rem = fmtData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const fmtBits = ((fmtData << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) grid[8][i] = ((fmtBits >> (14 - i)) & 1) === 1;
  grid[8][7] = ((fmtBits >> 8) & 1) === 1;
  grid[8][8] = ((fmtBits >> 7) & 1) === 1;
  grid[7][8] = ((fmtBits >> 6) & 1) === 1;
  for (let i = 9; i < 15; i++) grid[14 - i][8] = ((fmtBits >> (14 - i)) & 1) === 1;

  for (let i = 0; i < 8; i++) grid[8][size - 1 - i] = ((fmtBits >> i) & 1) === 1;
  for (let i = 8; i < 15; i++) grid[size - 15 + i][8] = ((fmtBits >> i) & 1) === 1;

  return grid.map((row) => row.map((cell) => Boolean(cell)));
}

export function generateQRCodeSVG(text: string, pixelSize = 180): string {
  const mat = buildMatrix(text);
  const n = mat.length;
  const quiet = 2;
  const total = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c]) {
        path += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#111111"/></svg>`;
}

export function generateQRCodeDataURL(text: string, pixelSize = 180): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generateQRCodeSVG(text, pixelSize))}`;
}
