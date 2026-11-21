'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Copy, Eye, Clock, QrCode, Download, Camera, Heart } from 'lucide-react';
import { api, formatBytes } from '@/lib/api';
import { generateQRCodeDataURL } from '@/lib/qrcode';
import type { Asset } from '@/types';
import { useToast } from '@/context/ToastContext';

export default function ShareImagePage() {
  const params = useParams<{ code: string }>();
  const code = params?.code || '';
  const { toast } = useToast();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [showQR, setShowQR] = useState(false);

  const load = async (pwd = '') => {
    if (!code) return;
    setErrMsg('');
    try {
      const res = await api.shareImage(code, pwd);
      setAsset(res.asset);
      setLocked(false);
    } catch (e: unknown) {
      const err = e as Error & { data?: { locked?: boolean } };
      if (err.data?.locked) {
        setLocked(true);
      }
      setErrMsg(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (locked) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(password);
          }}
          className="w-full max-w-sm p-6 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.08] shadow-xl space-y-4 text-xs text-center"
        >
          <Lock className="w-8 h-8 mx-auto text-neutral-400" />
          <div className="text-sm font-semibold">此图片受密码保护</div>
          {errMsg && <div className="text-rose-500">{errMsg}</div>}
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入访问密码..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium">
            解锁查看
          </button>
        </form>
      </div>
    );
  }

  if (errMsg && !asset) {
    return <div className="py-32 text-center text-xs text-neutral-400">{errMsg}</div>;
  }

  if (!asset) {
    return <div className="py-32 text-center text-xs text-neutral-400">正在加载图片...</div>;
  }

  const exifEntries = asset.exif_data ? Object.entries(asset.exif_data).slice(0, 6) : [];
  const rawImgUrl = password ? `${asset.direct_url}${asset.direct_url.includes('?') ? '&' : '?'}password=${encodeURIComponent(password)}` : asset.direct_url;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div className="rounded-3xl overflow-hidden bg-black/[0.03] dark:bg-white/[0.03] flex items-center justify-center p-4 sm:p-8 relative">
        <img src={rawImgUrl} alt={asset.original_name} className="max-h-[72vh] object-contain rounded-2xl shadow-lg" />
        {showQR && (
          <div className="absolute top-6 right-6 p-4 rounded-2xl bg-white text-neutral-900 shadow-2xl space-y-1.5 text-center">
            <img src={generateQRCodeDataURL(asset.share_url, 148)} alt="QR Code" className="w-36 h-36 mx-auto" />
            <div className="text-[11px] font-medium">手机扫码查看</div>
          </div>
        )}
      </div>

      <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="font-semibold text-sm">{asset.original_name}</div>
            <div className="text-neutral-400 flex flex-wrap items-center gap-2 tabular-nums">
              {asset.username && asset.username !== '游客' && (
                <>
                  <Link href={`/u/${encodeURIComponent(asset.username)}`} className="hover:underline text-neutral-600 dark:text-neutral-300">
                    @{asset.username}
                  </Link>
                  <span>·</span>
                </>
              )}
              <span>{asset.width} × {asset.height}</span>
              <span>·</span>
              <span>{formatBytes(asset.size_bytes)}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {asset.view_count}</span>
              {asset.expires_at && (
                <span className="flex items-center gap-1 text-amber-500">
                  <Clock className="w-3 h-3" /> 过期: {new Date(asset.expires_at).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                try {
                  const r = await api.likeShareImage(asset.short_code);
                  setAsset({ ...asset, like_count: r.like_count });
                  toast('感谢点赞！');
                } catch {}
              }}
              className="px-3.5 py-2 rounded-full bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 font-medium flex items-center gap-1.5"
            >
              <Heart className="w-3.5 h-3.5" /> {asset.like_count || 0}
            </button>
            <a
              href={`${rawImgUrl}${rawImgUrl.includes('?') ? '&' : '?'}download=1`}
              download={asset.original_name}
              className="px-3.5 py-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] font-medium flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> 下载原图
            </a>
            <button
              onClick={() => setShowQR((v) => !v)}
              className="px-3.5 py-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] font-medium flex items-center gap-1.5"
            >
              <QrCode className="w-3.5 h-3.5" /> 二维码
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(asset.direct_url);
                toast('直链已复制');
              }}
              className="px-3.5 py-2 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" /> 复制直链
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`![${asset.original_name}](${asset.direct_url})`);
                toast('Markdown 已复制');
              }}
              className="px-3.5 py-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] font-medium"
            >
              Markdown
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`<img src="${asset.direct_url}" alt="${asset.original_name}" />`);
                toast('HTML 已复制');
              }}
              className="px-3.5 py-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] font-medium"
            >
              HTML
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`[img]${asset.direct_url}[/img]`);
                toast('BBCode 已复制');
              }}
              className="px-3.5 py-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] font-medium"
            >
              BBCode
            </button>
          </div>
        </div>

        {exifEntries.length > 0 && (
          <div className="pt-3 border-t border-black/[0.05] dark:border-white/[0.06] flex flex-wrap items-center gap-4 text-[11px] text-neutral-400">
            <span className="flex items-center gap-1 text-neutral-500"><Camera className="w-3.5 h-3.5" /> EXIF</span>
            {exifEntries.map(([k, v]) => (
              <span key={k}>
                {k}: <strong className="font-mono text-neutral-700 dark:text-neutral-200">{String(v)}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
