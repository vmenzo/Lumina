// Lightweight ThumbHash (25-byte) Encoder & Decoder for zero-CLS progressive image loading

export function rgbaToThumbHash(w: number, h: number, rgba: Uint8Array): Uint8Array {
  if (w > 100 || h > 100) throw new Error(`${w}x${h} doesn't fit in 100x100`);
  const { PI, cos, max, min, abs, round } = Math;

  let avgR = 0, avgG = 0, avgB = 0, avgA = 0;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = rgba[j + 3] / 255;
    avgR += (alpha / 255) * rgba[j];
    avgG += (alpha / 255) * rgba[j + 1];
    avgB += (alpha / 255) * rgba[j + 2];
    avgA += alpha;
  }
  if (avgA) {
    avgR /= avgA;
    avgG /= avgA;
    avgB /= avgA;
  }

  const hasAlpha = avgA < w * h;
  const lLimit = hasAlpha ? 5 : 7;
  const lx = max(1, round((lLimit * w) / max(w, h)));
  const ly = max(1, round((lLimit * h) / max(w, h)));
  const l: number[] = [];
  const p: number[] = [];
  const q: number[] = [];
  const a: number[] = [];

  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = rgba[j + 3] / 255;
    const r = avgR * (1 - alpha) + (alpha / 255) * rgba[j];
    const g = avgG * (1 - alpha) + (alpha / 255) * rgba[j + 1];
    const b = avgB * (1 - alpha) + (alpha / 255) * rgba[j + 2];
    l[i] = (r + g + b) / 3;
    p[i] = (r + g) / 2 - b;
    q[i] = r - g;
    a[i] = alpha;
  }

  const encodeChannel = (channel: number[], nx: number, ny: number) => {
    let dc = 0;
    const ac: number[] = [];
    let scale = 0;
    const fx: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
        let f = 0;
        for (let x = 0; x < w; x++) fx[x] = cos((PI / w) * cx * (x + 0.5));
        for (let y = 0; y < h; y++) {
          const fy = cos((PI / h) * cy * (y + 0.5));
          for (let x = 0; x < w; x++) f += channel[x + y * w] * fx[x] * fy;
        }
        f /= w * h;
        if (cx || cy) {
          ac.push(f);
          scale = max(scale, abs(f));
        } else {
          dc = f;
        }
      }
    }
    if (scale) for (let i = 0; i < ac.length; i++) ac[i] = 0.5 + (0.5 / scale) * ac[i];
    return [dc, ac, scale] as const;
  };

  const [lDC, lAC, lScale] = encodeChannel(l, max(3, lx), max(3, ly));
  const [pDC, pAC, pScale] = encodeChannel(p, 3, 3);
  const [qDC, qAC, qScale] = encodeChannel(q, 3, 3);
  const [aDC, aAC, aScale] = hasAlpha ? encodeChannel(a, 5, 5) : [1, [], 1];

  const isLandscape = w > h;
  const header24 =
    round(63 * lDC) |
    (round(31.5 + 31.5 * pDC) << 6) |
    (round(31.5 + 31.5 * qDC) << 12) |
    (round(31 * lScale) << 18) |
    ((hasAlpha ? 1 : 0) << 23);
  const header16 =
    (isLandscape ? ly : lx) |
    (round(63 * pScale) << 3) |
    (round(63 * qScale) << 9) |
    ((isLandscape ? 1 : 0) << 15);
  const hash = [
    header24 & 255,
    (header24 >> 8) & 255,
    (header24 >> 16) & 255,
    header16 & 255,
    (header16 >> 8) & 255,
  ];
  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  if (hasAlpha) hash.push(round(15 * aDC) | (round(15 * aScale) << 4));
  for (const ac of hasAlpha ? [lAC, pAC, qAC, aAC] : [lAC, pAC, qAC]) {
    for (const f of ac) {
      hash[acStart + (acIndex >> 1)] |= round(15 * f) << ((acIndex & 1) << 2);
      acIndex++;
    }
  }
  return new Uint8Array(hash);
}

export function thumbHashToRGBA(hash: Uint8Array): { w: number; h: number; rgba: Uint8Array } {
  const { PI, cos, sin, max, min, round } = Math;
  const header24 = hash[0] | (hash[1] << 8) | (hash[2] << 16);
  const header16 = hash[3] | (hash[4] << 8);
  const lDC = (header24 & 63) / 63;
  const pDC = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDC = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = !!(header24 >> 23);
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const isLandscape = !!(header16 >> 15);
  const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
  const aDC = hasAlpha ? (hash[5] & 15) / 15 : 1;
  const aScale = (hash[5] >> 4) / 15;

  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  const decodeChannel = (nx: number, ny: number, scale: number) => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        ac.push((((hash[acStart + (acIndex >> 1)] >> ((acIndex & 1) << 2)) & 15) / 7.5 - 1) * scale);
        acIndex++;
      }
    }
    return ac;
  };
  const lAC = decodeChannel(lx, ly, lScale);
  const pAC = decodeChannel(3, 3, pScale * 1.25);
  const qAC = decodeChannel(3, 3, qScale * 1.25);
  const aAC = hasAlpha ? decodeChannel(5, 5, aScale) : [];

  const ratio = lx / ly;
  const w = round(ratio > 1 ? 32 : 32 * ratio);
  const h = round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8Array(w * h * 4);

  const fx: number[] = [];
  const fy: number[] = [];
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let l = lDC, p = pDC, q = qDC, a = aDC;
      for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx++) fx[cx] = cos((PI / w) * (x + 0.5) * cx);
      for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy++) fy[cy] = cos((PI / h) * (y + 0.5) * cy);

      for (let cy = 0, j = 0; cy < ly; cy++) {
        const fy2 = fy[cy] * 2;
        for (let cx = cy ? 0 : 1; cx * ly < lx * (ly - cy); cx++, j++) l += lAC[j] * fx[cx] * fy2;
      }
      for (let cy = 0, j = 0; cy < 3; cy++) {
        const fy2 = fy[cy] * 2;
        for (let cx = cy ? 0 : 1; cx < 3 - cy; cx++, j++) {
          const f = fx[cx] * fy2;
          p += pAC[j] * f;
          q += qAC[j] * f;
        }
      }
      if (hasAlpha) {
        for (let cy = 0, j = 0; cy < 5; cy++) {
          const fy2 = fy[cy] * 2;
          for (let cx = cy ? 0 : 1; cx < 5 - cy; cx++, j++) a += aAC[j] * fx[cx] * fy2;
        }
      }
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = max(0, 255 * min(1, r));
      rgba[i + 1] = max(0, 255 * min(1, g));
      rgba[i + 2] = max(0, 255 * min(1, b));
      rgba[i + 3] = max(0, 255 * min(1, a));
    }
  }
  return { w, h, rgba };
}

export function thumbHashToDataURL(b64: string): string {
  if (!b64 || typeof document === 'undefined') return '';
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const { w, h, rgba } = thumbHashToRGBA(bytes);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const imgData = ctx.createImageData(w, h);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

export async function generateThumbHashFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return '';
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(100 / bmp.width, 100 / bmp.height, 1);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(bmp, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const hash = rgbaToThumbHash(w, h, new Uint8Array(data.buffer));
    let bin = '';
    for (let i = 0; i < hash.length; i++) bin += String.fromCharCode(hash[i]);
    return btoa(bin);
  } catch {
    return '';
  }
}
