import { generateThumbHashFromFile } from '@/lib/thumbhash';
import type { Album, APIToken, Asset, AuditLog, InviteCode, RolePolicy, User, WatermarkPreset } from '@/types';

const TOKEN_KEY = 'lumina_auth_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null) {
  if (typeof window === 'undefined') return;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

let refreshingPromise: Promise<string | null> | null = null;

async function silentRefreshToken(): Promise<string | null> {
  if (!refreshingPromise) {
    refreshingPromise = fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (r) => {
        if (!r.ok) return null;
        const d = await r.json().catch(() => ({}));
        if (d.token) {
          setToken(d.token);
          return d.token as string;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        refreshingPromise = null;
      });
  }
  return refreshingPromise;
}

async function request<T>(path: string, opts: RequestInit = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(opts.body instanceof FormData) && opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...opts, headers, credentials: 'include' });
  if (res.status === 401 && !retried && !path.startsWith('/api/v1/auth/') && !path.startsWith('/api/v1/share/')) {
    const fresh = await silentRefreshToken();
    if (fresh) {
      return request<T>(path, opts, true);
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败 (${res.status})`) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export async function sha256File(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function compressImageClient(
  file: File,
  quality: number,
  convertWebP: boolean,
  maxWidth = 0
): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file;
  }
  const bmp = await createImageBitmap(file);
  let targetW = bmp.width;
  let targetH = bmp.height;
  if (maxWidth > 0 && bmp.width > maxWidth) {
    targetW = maxWidth;
    targetH = Math.round((bmp.height * maxWidth) / bmp.width);
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0, targetW, targetH);
  const targetMime = convertWebP ? 'image/webp' : file.type === 'image/png' && quality < 0.98 ? 'image/jpeg' : file.type;
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, targetMime, quality));
  if (!blob) return file;
  const ext = targetMime === 'image/webp' ? '.webp' : targetMime === 'image/jpeg' ? '.jpg' : '';
  const name = ext ? file.name.replace(/\.[^.]+$/, '') + ext : file.name;
  return new File([blob], name, { type: targetMime });
}


export async function applyWatermarkClient(file: File, wp: WatermarkPreset): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file;
  }
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0);

  const opacity = wp.opacity > 0 && wp.opacity <= 1 ? wp.opacity : 0.55;
  ctx.globalAlpha = opacity;

  const getCoords = (w: number, h: number) => {
    const margin = Math.max(20, Math.round(canvas.width * 0.03));
    const ox = wp.offset_x || 0;
    const oy = wp.offset_y || 0;
    switch (wp.position) {
      case 'nowe': return [margin + ox, margin + oy];
      case 'no': return [(canvas.width - w) / 2 + ox, margin + oy];
      case 'noea': return [canvas.width - w - margin + ox, margin + oy];
      case 'we': return [margin + ox, (canvas.height - h) / 2 + oy];
      case 'ce': return [(canvas.width - w) / 2 + ox, (canvas.height - h) / 2 + oy];
      case 'ea': return [canvas.width - w - margin + ox, (canvas.height - h) / 2 + oy];
      case 'sowe': return [margin + ox, canvas.height - h - margin + oy];
      case 'so': return [(canvas.width - w) / 2 + ox, canvas.height - h - margin + oy];
      default: return [canvas.width - w - margin + ox, canvas.height - h - margin + oy];
    }
  };

  if (wp.mode === 'image' && wp.image_url) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = wp.image_url!;
      });
      const tw = Math.max(32, Math.round(canvas.width * (wp.scale || 0.22)));
      const th = Math.max(16, Math.round((img.height * tw) / Math.max(1, img.width)));
      const drawOne = (cx: number, cy: number) => {
        ctx.save();
        ctx.translate(cx + tw / 2, cy + th / 2);
        ctx.rotate(((wp.angle || 0) * Math.PI) / 180);
        ctx.drawImage(img, -tw / 2, -th / 2, tw, th);
        ctx.restore();
      };
      if (wp.tiled) {
        const sx = tw + Math.max(60, Math.round(canvas.width / 6));
        const sy = th + Math.max(60, Math.round(canvas.height / 6));
        for (let y = 24; y < canvas.height; y += sy) {
          for (let x = 24; x < canvas.width; x += sx) drawOne(x, y);
        }
      } else {
        const [x, y] = getCoords(tw, th);
        drawOne(x, y);
      }
    } catch {
      // Fallback if CORS blocks remote logo
    }
  } else {
    const text = wp.text_content || '© Lumina Gallery';
    const fontPx = Math.max(14, Math.round((wp.font_size || 24) * Math.max(1, canvas.width / 1000)));
    ctx.font = `600 ${fontPx}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = wp.text_color || '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 4;
    ctx.textBaseline = 'top';
    const metrics = ctx.measureText(text);
    const tw = metrics.width;
    const th = fontPx * 1.2;
    const drawText = (x: number, y: number) => {
      ctx.save();
      ctx.translate(x + tw / 2, y + th / 2);
      ctx.rotate(((wp.angle || 0) * Math.PI) / 180);
      ctx.fillText(text, -tw / 2, -th / 2);
      ctx.restore();
    };
    if (wp.tiled) {
      const sx = Math.round(tw + Math.max(80, canvas.width / 5));
      const sy = Math.round(th + Math.max(80, canvas.height / 5));
      for (let y = 24; y < canvas.height; y += sy) {
        for (let x = 24; x < canvas.width; x += sx) drawText(x, y);
      }
    } else {
      const [x, y] = getCoords(tw, th);
      drawText(x, y);
    }
  }

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, file.type || 'image/jpeg', 0.92));
  if (!blob) return file;
  return new File([blob], file.name, { type: blob.type });
}

export type BatchLinkFormat = 'direct' | 'markdown' | 'markdown_link' | 'html' | 'bbcode' | 'webp';

export function formatAssetLinksBatch(assets: Asset[], fmt: BatchLinkFormat): string {
  return assets
    .map((a) => {
      switch (fmt) {
        case 'markdown':
          return `![${a.original_name}](${a.direct_url})`;
        case 'markdown_link':
          return `[![${a.original_name}](${a.thumb_url || a.direct_url})](${a.share_url})`;
        case 'html':
          return `<img src="${a.direct_url}" alt="${a.original_name}" />`;
        case 'bbcode':
          return `[img]${a.direct_url}[/img]`;
        case 'webp':
          return a.webp_url || a.direct_url;
        default:
          return a.direct_url;
      }
    })
    .join('\n');
}

export interface DirectUploadOptions {
  engine?: 'smart' | 'local' | 'r2';
  album_id?: number | null;
  visibility?: 'public' | 'unlisted' | 'private' | 'password';
  password?: string;
  expire_hours?: number;
  strip_gps?: boolean;
  client_compress?: boolean;
  quality?: number;
  max_width?: number;
  convert_webp?: boolean;
  watermark_preset?: WatermarkPreset | null;
  custom_alias?: string;
  onProgress?: (pct: number, stage: string) => void;
}

const CHUNK_THRESHOLD = 10 * 1024 * 1024;
const CHUNK_SIZE = 5 * 1024 * 1024;

async function uploadChunkedFile(file: File, hash: string, thumbhash: string, opts: DirectUploadOptions): Promise<{ asset: Asset; instant: boolean }> {
  const totalParts = Math.ceil(file.size / CHUNK_SIZE);
  opts.onProgress?.(20, `初始化分片续传 (${totalParts} 片)...`);
  const init = await request<{ upload_id: string }>('/api/v1/upload/chunked/init', {
    method: 'POST',
    body: JSON.stringify({
      sha256: hash,
      filename: file.name,
      mime_type: file.type || 'image/jpeg',
      total_size: file.size,
      chunk_size: CHUNK_SIZE,
      total_parts: totalParts,
      engine: opts.engine || 'smart',
      album_id: opts.album_id ?? null,
      visibility: opts.visibility || 'public',
      custom_alias: opts.custom_alias || '',
    }),
  });

  const token = getToken();
  for (let i = 0; i < totalParts; i++) {
    const partNum = i + 1;
    const slice = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const res = await fetch(`/api/v1/upload/chunked/${init.upload_id}/part/${partNum}`, {
        method: 'PUT',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: slice,
      });
      if (res.ok) ok = true;
    }
    if (!ok) throw new Error(`分片 ${partNum} 上传失败`);
    const pct = Math.round(25 + (partNum / totalParts) * 65);
    opts.onProgress?.(pct, `分片续传 ${partNum}/${totalParts}`);
  }

  opts.onProgress?.(95, '合并分片并入库...');
  const fin = await request<{ asset: Asset }>(`/api/v1/upload/chunked/${init.upload_id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ thumbhash }),
  });
  opts.onProgress?.(100, '分片上传完成');
  return { asset: fin.asset, instant: false };
}

export async function directUploadFile(rawFile: File, opts: DirectUploadOptions = {}): Promise<{ asset: Asset; instant: boolean }> {
  let file = rawFile;
  if (opts.watermark_preset) {
    opts.onProgress?.(4, `烧录水印「${opts.watermark_preset.name}」...`);
    file = await applyWatermarkClient(file, opts.watermark_preset);
  }
  if (opts.client_compress || opts.convert_webp || (opts.max_width && opts.max_width > 0)) {
    opts.onProgress?.(5, '客户端压缩与缩放处理中...');
    file = await compressImageClient(rawFile, opts.quality ?? 0.85, !!opts.convert_webp, opts.max_width ?? 0);
  }

  opts.onProgress?.(15, '生成 ThumbHash 与 SHA-256...');
  const [hash, thumbhash] = await Promise.all([sha256File(file), generateThumbHashFromFile(file)]);

  opts.onProgress?.(25, '预检去重与申请直传凭证...');
  const pre = await request<{
    instant: boolean;
    asset?: Asset;
    intent_id?: string;
    upload?: { url: string; method: string; headers: Record<string, string>; engine: string };
  }>('/api/v1/upload/precheck', {
    method: 'POST',
    body: JSON.stringify({
      sha256: hash,
      filename: file.name,
      mime_type: file.type || 'image/jpeg',
      size_bytes: file.size,
      engine: opts.engine || 'smart',
      album_id: opts.album_id ?? null,
      visibility: opts.visibility || 'public',
      password: opts.password || '',
      expire_hours: opts.expire_hours || 0,
      strip_gps: opts.strip_gps ?? true,
      custom_alias: opts.custom_alias || '',
    }),
  });

  if (pre.instant && pre.asset) {
    opts.onProgress?.(100, '⚡ SHA-256 秒传成功');
    return { asset: pre.asset, instant: true };
  }
  if (file.size > CHUNK_THRESHOLD) {
    return uploadChunkedFile(file, hash, thumbhash, opts);
  }

  if (!pre.upload || !pre.intent_id) {
    throw new Error('服务器未返回有效的直传凭证');
  }

  opts.onProgress?.(35, `直传至 ${pre.upload.engine === 'r2' ? 'Cloudflare R2' : '本地 NVMe'}...`);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(pre.upload!.method, pre.upload!.url, true);
    Object.entries(pre.upload!.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round(35 + (ev.loaded / ev.total) * 55);
        opts.onProgress?.(pct, `直传中 ${Math.round((ev.loaded / ev.total) * 100)}%`);
      }
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`直传失败 (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('网络错误：请检查存储桶 CORS 配置'));
    xhr.send(file);
  });

  opts.onProgress?.(95, '解析元信息与入库...');
  const fin = await request<{ asset: Asset }>('/api/v1/upload/complete', {
    method: 'POST',
    body: JSON.stringify({ intent_id: pre.intent_id, thumbhash }),
  });
  opts.onProgress?.(100, '上传完成');
  return { asset: fin.asset, instant: false };
}

export interface AnalyticsTrendPoint {
  date: string;
  uploads: number;
  views: number;
  bytes: number;
}

export interface MimeBreakdown {
  mime: string;
  count: number;
  bytes: number;
}

export const api = {
  login: (identifier: string, password: string, totp_code = '') =>
    request<{ token?: string; user?: User; require_2fa?: boolean; message?: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, totp_code }),
    }),
  register: (username: string, email: string, password: string, invite_code = '') =>
    request<{ token: string; user: User }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, invite_code }),
    }),
  refreshSession: () => request<{ token: string; user: User }>('/api/v1/auth/refresh', { method: 'POST' }),
  logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (email: string, code: string, new_password: string) =>
    request<{ ok: boolean; message: string }>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password }),
    }),
  me: () => request<{ user: User; policy: RolePolicy }>('/api/v1/me'),
  myAnalytics: () =>
    request<{
      summary: Record<string, number>;
      mime_breakdown: MimeBreakdown[];
      trend: AnalyticsTrendPoint[];
      top_assets: Asset[];
    }>('/api/v1/me/analytics'),
  updateProfile: (payload: Partial<User>) =>
    request<{ user: User }>('/api/v1/me/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  changePassword: (current_password: string, new_password: string) =>
    request('/api/v1/me/password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  setup2FA: () => request<{ secret: string; otpauth_url: string }>('/api/v1/me/2fa/setup', { method: 'POST' }),
  verify2FA: (code: string, enable: boolean) =>
    request<{ totp_enabled: boolean }>('/api/v1/me/2fa/verify', { method: 'POST', body: JSON.stringify({ code, enable }) }),
  listSessions: () => request<{ sessions: Array<{ id: string; user_agent: string; ip_address: string; current: boolean; created_at: string }> }>('/api/v1/me/sessions'),
  revokeSession: (id: string) => request(`/api/v1/me/sessions/${id}`, { method: 'DELETE' }),

  remoteUpload: (url: string, engine: string, album_id?: number | null, visibility = 'public') =>
    request<{ instant: boolean; asset: Asset }>('/api/v1/upload/remote', {
      method: 'POST',
      body: JSON.stringify({ url, engine, album_id, visibility }),
    }),

  listAssets: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return request<{ assets: Asset[] }>(`/api/v1/assets${qs ? '?' + qs : ''}`);
  },
  updateAsset: (id: number, payload: Record<string, unknown>) =>
    request<{ asset: Asset }>(`/api/v1/assets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAsset: (id: number, permanent = false) =>
    request(`/api/v1/assets/${id}?permanent=${permanent}`, { method: 'DELETE' }),
  restoreAsset: (id: number) => request(`/api/v1/assets/${id}/restore`, { method: 'POST' }),
  emptyTrash: () => request<{ deleted: number; freed_bytes: number }>('/api/v1/assets/trash/empty', { method: 'DELETE' }),
  migrateAsset: (id: number, target_engine: 'local' | 'r2') =>
    request<{ asset: Asset; migrated: boolean }>(`/api/v1/assets/${id}/migrate`, {
      method: 'POST',
      body: JSON.stringify({ target_engine }),
    }),
  createSignedUrl: (id: number, ttl_minutes = 60) =>
    request<{ signed_url: string; expires_at: string }>(`/api/v1/assets/${id}/signed-url`, {
      method: 'POST',
      body: JSON.stringify({ ttl_minutes }),
    }),
  buildTransformUrl: (
    id: number,
    payload: {
      width?: number;
      height?: number;
      fit?: 'fit' | 'fill' | 'auto';
      quality?: number;
      format?: 'webp' | 'avif' | 'jpg' | 'png';
      blur?: number;
      rotate?: number;
      watermark_id?: number | null;
    }
  ) =>
    request<{ url: string; markdown: string; html: string }>(`/api/v1/assets/${id}/transform`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  aiAnalyzeAsset: (id: number) =>
    request<{ asset: Asset; caption: string; ai_tags: string[]; provider: string }>(`/api/v1/assets/${id}/ai-analyze`, {
      method: 'POST',
    }),
  replaceAsset: async (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ asset: Asset; replaced: boolean }>(`/api/v1/assets/${id}/replace`, {
      method: 'POST',
      body: fd,
    });
  },
  toggleFavorite: (id: number) =>
    request<{ is_favorite: boolean }>(`/api/v1/assets/${id}/favorite`, { method: 'POST' }),
  likeShareImage: (code: string) =>
    request<{ like_count: number }>(`/api/v1/share/i/${code}/like`, { method: 'POST' }),
  siteInfo: () => request<{ site: Record<string, unknown> }>('/api/v1/site/info'),
  findSimilarAssets: (id: number) =>
    request<{ similar: Asset[] }>(`/api/v1/assets/${id}/similar`),
  batchAssets: (payload: Record<string, unknown>) =>
    request<{ processed: number }>('/api/v1/assets/batch', { method: 'POST', body: JSON.stringify(payload) }),
  downloadZip: async (ids: number[]) => {
    const token = getToken();
    const res = await fetch('/api/v1/assets/download-zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error('打包下载失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lumina-gallery-export.zip';
    a.click();
    URL.revokeObjectURL(url);
  },

  explore: (sort = 'latest') =>
    request<{ assets: Asset[]; site: Record<string, unknown> }>(`/api/v1/explore?sort=${sort}`),
  publicProfile: (username: string) =>
    request<{ user: User; albums: Album[]; assets: Asset[]; stats: Record<string, number> }>(`/api/v1/users/${encodeURIComponent(username)}`),
  shareImage: (code: string, password = '') =>
    request<{ asset: Asset }>(`/api/v1/share/i/${code}`, {
      headers: password ? { 'X-Share-Password': password } : {},
    }),
  shareAlbum: (slug: string, password = '') =>
    request<{ album: Album; assets: Asset[] }>(`/api/v1/share/a/${slug}`, {
      headers: password ? { 'X-Share-Password': password } : {},
    }),

  listAlbums: () => request<{ albums: Album[] }>('/api/v1/albums'),
  createAlbum: (payload: Record<string, unknown>) =>
    request<{ album: Album }>('/api/v1/albums', { method: 'POST', body: JSON.stringify(payload) }),
  updateAlbum: (id: number, payload: Record<string, unknown>) =>
    request<{ album: Album }>(`/api/v1/albums/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAlbum: (id: number) => request(`/api/v1/albums/${id}`, { method: 'DELETE' }),

  listTokens: () => request<{ tokens: APIToken[] }>('/api/v1/tokens'),
  createToken: (name: string, scopes: string[], expire_days = 0) =>
    request<{ token: APIToken; plain_token: string }>('/api/v1/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, scopes, expire_days }),
    }),
  deleteToken: (id: number) => request(`/api/v1/tokens/${id}`, { method: 'DELETE' }),

  listWatermarks: () => request<{ presets: WatermarkPreset[] }>('/api/v1/watermarks'),
  saveWatermark: (payload: Partial<WatermarkPreset>) =>
    request<{ preset: WatermarkPreset }>('/api/v1/watermarks', { method: 'POST', body: JSON.stringify(payload) }),
  setDefaultWatermark: (id: number) => request(`/api/v1/watermarks/${id}/default`, { method: 'PATCH' }),
  deleteWatermark: (id: number) => request(`/api/v1/watermarks/${id}`, { method: 'DELETE' }),

  adminDashboard: () => request<{ stats: Record<string, number>; storage: Record<string, unknown>; queue?: Record<string, unknown> }>('/api/v1/admin/dashboard'),
  adminAnalytics: () => request<{ trend: AnalyticsTrendPoint[]; mime_breakdown: MimeBreakdown[] }>('/api/v1/admin/analytics'),
  adminTestStorage: () => request<{ storage: Record<string, unknown>; elapsed_ms: number }>('/api/v1/admin/storage/test', { method: 'POST' }),
  adminTestMail: (to = '') =>
    request<{ ok: boolean; to: string }>('/api/v1/admin/mail/test', { method: 'POST', body: JSON.stringify({ to }) }),
  adminStorageProfiles: () =>
    request<{ profiles: Array<{ id: number; name: string; provider: string; endpoint: string; region: string; bucket: string; access_key_id: string; public_url: string; is_active: boolean; is_default: boolean }> }>('/api/v1/admin/storage-profiles'),
  adminSaveStorageProfile: (payload: Record<string, unknown>) =>
    request('/api/v1/admin/storage-profiles', { method: 'POST', body: JSON.stringify(payload) }),
  adminDeleteStorageProfile: (id: number) =>
    request(`/api/v1/admin/storage-profiles/${id}`, { method: 'DELETE' }),
  adminUsers: () => request<{ users: User[] }>('/api/v1/admin/users'),
  adminUpdateUser: (id: number, payload: Record<string, unknown>) =>
    request(`/api/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminPolicies: () => request<{ policies: RolePolicy[] }>('/api/v1/admin/policies'),
  adminUpdatePolicy: (role: string, payload: RolePolicy) =>
    request(`/api/v1/admin/policies/${role}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminModeration: (status = 'pending') =>
    request<{ items: Asset[] }>(`/api/v1/admin/moderation?status=${status}`),
  adminModerateAction: (objectId: number, action: 'pass' | 'block', reason = '') =>
    request(`/api/v1/admin/moderation/${objectId}`, { method: 'POST', body: JSON.stringify({ action, reason }) }),
  adminInvites: () => request<{ invites: InviteCode[] }>('/api/v1/admin/invites'),
  adminCreateInvites: (count: number, role: string, max_uses = 1, expire_days = 30) =>
    request<{ codes: string[] }>('/api/v1/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ count, role, max_uses, expire_days }),
    }),
  adminSettings: () => request<{ general: Record<string, unknown>; security: Record<string, unknown>; storage: Record<string, unknown> }>('/api/v1/admin/settings'),
  adminSaveSetting: (key: string, value: Record<string, unknown>) =>
    request(`/api/v1/admin/settings/${key}`, { method: 'PUT', body: JSON.stringify(value) }),
  adminLogs: () => request<{ logs: AuditLog[] }>('/api/v1/admin/logs'),
  adminRunGC: () => request<{ gc_result: Record<string, number> }>('/api/v1/admin/gc', { method: 'POST' }),
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
