'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Clock, UploadCloud } from 'lucide-react';
import { api } from '@/lib/api';
import type { Asset } from '@/types';
import { JustifiedGrid } from '@/components/JustifiedGrid';
import { Lightbox } from '@/components/Lightbox';
import { useAppRefresh } from '@/components/AppShell';

export default function ExplorePage() {
  const { refreshKey, openUpload } = useAppRefresh();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [site, setSite] = useState<Record<string, unknown>>({});
  const [sort, setSort] = useState<'latest' | 'popular'>('latest');
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Asset | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .explore(sort)
      .then((res) => {
        setAssets(res.assets || []);
        setSite(res.site || {});
      })
      .finally(() => setLoading(false));
  }, [sort, refreshKey]);

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {String(site.site_name || '探索广场')}
          </h1>
          {Boolean(site.site_subtitle) && (
            <p className="text-xs text-neutral-400 mt-0.5">{String(site.site_subtitle)}</p>
          )}
        </div>

        <div className="inline-flex p-1 rounded-full bg-black/[0.04] dark:bg-[#16161B] border border-black/[0.05] dark:border-white/[0.07] text-xs">
          <button
            onClick={() => setSort('latest')}
            className={`px-3.5 py-1.5 rounded-full font-medium flex items-center gap-1.5 transition-all ${
              sort === 'latest' ? 'bg-white dark:bg-[#24242D] shadow-sm text-neutral-900 dark:text-white' : 'text-neutral-500'
            }`}
          >
            <Clock className="w-3.5 h-3.5" /> 最新
          </button>
          <button
            onClick={() => setSort('popular')}
            className={`px-3.5 py-1.5 rounded-full font-medium flex items-center gap-1.5 transition-all ${
              sort === 'popular' ? 'bg-white dark:bg-[#24242D] shadow-sm text-neutral-900 dark:text-white' : 'text-neutral-500'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" /> 热门
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-44 sm:h-56 rounded-2xl bg-black/[0.04] dark:bg-[#131317] animate-pulse" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <button
          onClick={openUpload}
          className="w-full py-20 px-6 rounded-3xl border-2 border-dashed border-black/[0.09] dark:border-white/[0.1] hover:border-neutral-400 dark:hover:border-white/25 bg-white/40 dark:bg-[#121216]/50 text-center space-y-2.5 transition-colors group"
        >
          <UploadCloud className="w-9 h-9 mx-auto text-neutral-400 group-hover:scale-105 transition-transform" />
          <div className="text-sm font-medium">暂无公开图片</div>
        </button>
      ) : (
        <JustifiedGrid assets={assets} onOpenLightbox={setActive} />
      )}

      <Lightbox asset={active} assets={assets} onClose={() => setActive(null)} onSelect={setActive} />
    </div>
  );
}
