'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api';
import type { Album, Asset } from '@/types';
import { JustifiedGrid } from '@/components/JustifiedGrid';
import { Lightbox } from '@/components/Lightbox';

export default function ShareAlbumPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug || '';

  const [album, setAlbum] = useState<Album | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [active, setActive] = useState<Asset | null>(null);

  const load = async (pwd = '') => {
    if (!slug) return;
    setErrMsg('');
    try {
      const res = await api.shareAlbum(slug, pwd);
      setAlbum(res.album);
      setAssets(res.assets || []);
      setLocked(false);
    } catch (e: unknown) {
      const err = e as Error & { data?: { locked?: boolean } };
      if (err.data?.locked) setLocked(true);
      setErrMsg(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (locked) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(password);
          }}
          className="w-full max-w-sm p-6 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.08] shadow-xl space-y-4 text-xs text-center"
        >
          <Lock className="w-8 h-8 mx-auto text-neutral-400" />
          <div className="text-sm font-semibold">此相册受密码保护</div>
          {errMsg && <div className="text-rose-500">{errMsg}</div>}
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入相册密码..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium">
            解锁相册
          </button>
        </form>
      </div>
    );
  }

  if (errMsg && !album) {
    return <div className="py-32 text-center text-xs text-neutral-400">{errMsg}</div>;
  }

  if (!album) {
    return <div className="py-32 text-center text-xs text-neutral-400">正在加载相册...</div>;
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{album.title}</h1>
        <p className="text-xs text-neutral-400 mt-1">{album.description || `共 ${assets.length} 张作品`}</p>
      </div>

      <JustifiedGrid assets={assets} gap={8} onOpenLightbox={setActive} />

      <Lightbox asset={active} assets={assets} onClose={() => setActive(null)} onSelect={setActive} />
    </div>
  );
}
