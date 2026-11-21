'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trash2, ArrowRightLeft, Tag, CheckSquare, Square, Download, UploadCloud, Star, FileSpreadsheet } from 'lucide-react';
import { api, formatAssetLinksBatch, type BatchLinkFormat } from '@/lib/api';
import type { Album, Asset } from '@/types';
import { Protected, useAppRefresh } from '@/components/AppShell';
import { JustifiedGrid } from '@/components/JustifiedGrid';
import { Lightbox } from '@/components/Lightbox';
import { useToast } from '@/context/ToastContext';

function matchColorGroup(hex: string, group: string): boolean {
  if (!group || !hex.startsWith('#') || hex.length < 7) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (group === 'mono') return max - min < 28;
  if (group === 'warm') return r > g + 25 && r > b + 25;
  if (group === 'amber') return r > 150 && g > 110 && b < 110;
  if (group === 'green') return g > r + 15 && g > b + 15;
  if (group === 'blue') return b > r + 20 && b >= g;
  if (group === 'violet') return r > 100 && b > 120 && g < r;
  return true;
}

function GalleryContent() {
  const { refreshKey, openUpload } = useAppRefresh();
  const { toast } = useToast();
  const sp = useSearchParams();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [q, setQ] = useState(sp.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(sp.get('q') || '');
  const [engine, setEngine] = useState('');
  const [visibility, setVisibility] = useState('');
  const [sortBy, setSortBy] = useState('latest');
  const [favOnly, setFavOnly] = useState(false);
  const [albumId, setAlbumId] = useState(sp.get('album_id') || '');
  const [colorFilter, setColorFilter] = useState(sp.get('color') || '');
  const [selected, setSelected] = useState<number[]>([]);
  const [active, setActive] = useState<Asset | null>(null);
  const [batchTag, setBatchTag] = useState('');

  useEffect(() => {
    setQ(sp.get('q') || '');
    setAlbumId(sp.get('album_id') || '');
    setColorFilter(sp.get('color') || '');
  }, [sp]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 240);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api.listAlbums().then((r) => setAlbums(r.albums || [])).catch(() => {});
  }, [refreshKey]);

  const load = useCallback(async () => {
    setLoading((prev) => (assets.length === 0 ? true : prev));
    try {
      const params: Record<string, string> = { limit: '60', offset: '0' };
      if (debouncedQ.trim()) params.q = debouncedQ.trim();
      if (engine) params.engine = engine;
      if (visibility) params.visibility = visibility;
      if (sortBy) params.sort = sortBy;
      if (albumId) params.album_id = albumId;
      if (favOnly) params.favorite = 'true';
      const aRes = await api.listAssets(params);
      const list = aRes.assets || [];
      setAssets(list);
      setHasMore(list.length >= 60);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '加载画廊失败', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, engine, visibility, albumId, sortBy, favOnly, toast]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const params: Record<string, string> = { limit: '60', offset: String(assets.length) };
      if (debouncedQ.trim()) params.q = debouncedQ.trim();
      if (engine) params.engine = engine;
      if (visibility) params.visibility = visibility;
      if (sortBy) params.sort = sortBy;
      if (albumId) params.album_id = albumId;
      if (favOnly) params.favorite = 'true';
      const aRes = await api.listAssets(params);
      const more = aRes.assets || [];
      setAssets((prev) => [...prev, ...more]);
      setHasMore(more.length >= 60);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '加载更多失败', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const visibleAssets = useMemo(() => {
    if (!colorFilter) return assets;
    return assets.filter((a) => matchColorGroup(a.dominant_color, colorFilter));
  }, [assets, colorFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Asset[]>();
    visibleAssets.forEach((a) => {
      const d = new Date(a.created_at);
      const key = `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return Array.from(map.entries());
  }, [visibleAssets]);

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runBatch = async (action: string, extra: Record<string, unknown> = {}) => {
    if (selected.length === 0) return;
    const ids = [...selected];
    if (action === 'trash') {
      setAssets((prev) => prev.filter((a) => !ids.includes(a.id)));
      setSelected([]);
    }
    try {
      const res = await api.batchAssets({ ids, action, ...extra });
      toast(`已处理 ${res.processed} 张图片`);
      if (action !== 'trash') {
        setSelected([]);
        load();
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '批量操作失败', 'error');
      load();
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-5 sm:space-y-6">
      {/* Structured Responsive Filter Toolbar */}
      <div className="p-3 sm:p-3.5 rounded-2xl bg-white/85 dark:bg-[#121216] border border-black/[0.06] dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-black/[0.04] dark:bg-[#131317] border border-black/[0.05] dark:border-white/[0.07] text-xs w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索文件名、标签或短码..."
              className="bg-transparent outline-none flex-1 placeholder:text-neutral-500"
            />
          </div>

          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            className="px-3 py-2 rounded-full bg-black/[0.04] dark:bg-[#131317] border border-black/[0.05] dark:border-white/[0.07] text-xs outline-none"
          >
            <option value="">全部引擎</option>
            <option value="local">Local NVMe</option>
            <option value="r2">Cloudflare R2</option>
          </select>

          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className="px-3 py-2 rounded-full bg-black/[0.04] dark:bg-[#131317] border border-black/[0.05] dark:border-white/[0.07] text-xs outline-none"
          >
            <option value="">全部可见性</option>
            <option value="public">公开</option>
            <option value="unlisted">仅凭链接</option>
            <option value="private">私密</option>
            <option value="password">密码保护</option>
          </select>

          <select
            value={albumId}
            onChange={(e) => setAlbumId(e.target.value)}
            className="px-3 py-2 rounded-full bg-black/[0.04] dark:bg-[#131317] border border-black/[0.05] dark:border-white/[0.07] text-xs outline-none"
          >
            <option value="">全部相册</option>
            {albums.map((al) => (
              <option key={al.id} value={al.id}>{al.title}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 rounded-full bg-black/[0.04] dark:bg-[#131317] border border-black/[0.05] dark:border-white/[0.07] text-xs outline-none"
          >
            <option value="latest">最新上传</option>
            <option value="oldest">最早上传</option>
            <option value="popular">浏览最多</option>
            <option value="largest">体积最大</option>
            <option value="smallest">体积最小</option>
            <option value="name">文件名排序</option>
          </select>

          {colorFilter && (
            <button
              onClick={() => setColorFilter('')}
              className="px-3 py-1.5 rounded-full bg-white/10 text-xs text-neutral-300 hover:bg-white/15"
            >
              清除色系滤镜 ({colorFilter}) ×
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <button
            onClick={() => setFavOnly((v) => !v)}
            className={`px-3 py-2 rounded-full border text-xs flex items-center gap-1.5 transition-colors ${
              favOnly
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-500'
                : 'border-black/[0.05] dark:border-white/[0.07] text-neutral-500 hover:bg-black/[0.04] dark:hover:bg-[#1C1C22]'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${favOnly ? 'fill-amber-500' : ''}`} />
            <span>星标</span>
          </button>
          {visibleAssets.length > 0 && (
            <button
              onClick={() => {
                const header = 'ID,短码,文件名,大小(B),宽,高,直链,Markdown,标签\n';
                const rows = visibleAssets.map((x) =>
                  [x.id, x.short_code, `"${x.original_name.replace(/"/g, '""')}"`, x.size_bytes, x.width, x.height, x.direct_url, `"![${x.original_name.replace(/"/g, '""')}](${x.direct_url})"`, `"${(x.tags || []).join(';')}"`].join(',')
                ).join('\n');
                const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const el = document.createElement('a');
                el.href = url;
                el.download = 'lumina-assets-export.csv';
                el.click();
                URL.revokeObjectURL(url);
                toast(`已导出 ${visibleAssets.length} 条资产清单 CSV`);
              }}
              className="px-3 py-2 rounded-full hover:bg-black/[0.04] dark:hover:bg-[#1C1C22] text-neutral-500 flex items-center gap-1"
              title="导出当前列表为 CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">导出</span>
            </button>
          )}
          {visibleAssets.length > 0 && (
            <button
              onClick={() => setSelected(selected.length === visibleAssets.length ? [] : visibleAssets.map((a) => a.id))}
              className="px-3 py-2 rounded-full hover:bg-black/[0.04] dark:hover:bg-[#1C1C22] text-neutral-400 flex items-center gap-1.5"
            >
              {selected.length === visibleAssets.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              <span>{selected.length > 0 ? `已选 ${selected.length}` : '全选'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Floating Batch Toolbar */}
      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="sticky top-[calc(3.75rem+env(safe-area-inset-top))] sm:top-[calc(4.5rem+env(safe-area-inset-top))] z-30 flex flex-wrap items-center justify-between gap-2.5 px-3.5 sm:px-4 py-2.5 rounded-2xl bg-[#131317]/95 backdrop-blur-xl border border-white/[0.08] text-white shadow-xl text-xs"
          >
            <span className="font-medium font-mono tabular-nums">已选中 {selected.length} 项</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => runBatch('migrate', { target_engine: 'r2' })}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-1"
              >
                <ArrowRightLeft className="w-3 h-3" /> 迁至 R2
              </button>
              <button
                onClick={() => runBatch('migrate', { target_engine: 'local' })}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-1"
              >
                <ArrowRightLeft className="w-3 h-3" /> 迁至 Local
              </button>
              <select
                onChange={(e) => {
                  if (e.target.value) runBatch('move_album', { album_id: Number(e.target.value) });
                }}
                defaultValue=""
                className="px-2.5 py-1.5 rounded-lg bg-white/10 outline-none"
              >
                <option value="" disabled>移动相册...</option>
                {albums.map((al) => (
                  <option key={al.id} value={al.id} className="text-black">{al.title}</option>
                ))}
              </select>
              <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1">
                <Tag className="w-3 h-3" />
                <input
                  value={batchTag}
                  onChange={(e) => setBatchTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && batchTag.trim()) {
                      runBatch('add_tag', { tag: batchTag.trim() });
                      setBatchTag('');
                    }
                  }}
                  placeholder="回车加标签"
                  className="bg-transparent outline-none w-20 placeholder:text-white/50"
                />
              </div>
              <select
                onChange={async (e) => {
                  const fmt = e.target.value as BatchLinkFormat;
                  if (!fmt) return;
                  const picked = visibleAssets.filter((a) => selected.includes(a.id));
                  await navigator.clipboard.writeText(formatAssetLinksBatch(picked, fmt));
                  toast(`已批量复制 ${picked.length} 条外链`);
                  e.target.value = '';
                }}
                defaultValue=""
                className="px-2.5 py-1.5 rounded-lg bg-white/10 outline-none"
              >
                <option value="" disabled>批量复制外链...</option>
                <option value="direct" className="text-black">直链 URL</option>
                <option value="markdown" className="text-black">Markdown</option>
                <option value="markdown_link" className="text-black">Markdown (带跳转)</option>
                <option value="html" className="text-black">HTML</option>
                <option value="bbcode" className="text-black">BBCode</option>
              </select>
              <select
                onChange={(e) => {
                  if (e.target.value) runBatch('visibility', { visibility: e.target.value });
                  e.target.value = '';
                }}
                defaultValue=""
                className="px-2.5 py-1.5 rounded-lg bg-white/10 outline-none"
              >
                <option value="" disabled>批量可见性...</option>
                <option value="public" className="text-black">设为公开</option>
                <option value="unlisted" className="text-black">设为仅凭链接</option>
                <option value="private" className="text-black">设为私密</option>
              </select>
              <button
                onClick={() => api.downloadZip(selected).catch((e) => toast(e.message, 'error'))}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> 打包下载
              </button>
              <button
                onClick={() => runBatch('trash')}
                className="px-2.5 py-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> 移入回收站
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Justified Gallery Canvas */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-52 rounded-xl bg-black/[0.04] dark:bg-[#131317] animate-pulse" />
          ))}
        </div>
      ) : visibleAssets.length === 0 ? (
        <button
          onClick={openUpload}
          className="w-full py-20 px-6 rounded-3xl border-2 border-dashed border-black/[0.09] dark:border-white/[0.1] hover:border-neutral-400 dark:hover:border-white/25 bg-white/40 dark:bg-[#121216]/50 text-center space-y-2.5 transition-colors group"
        >
          <UploadCloud className="w-9 h-9 mx-auto text-neutral-400 group-hover:scale-105 transition-transform" />
          <div className="text-sm font-medium">暂无图片，点击或拖拽上传</div>
        </button>
      ) : (
        <div className="space-y-8">
          {grouped.map(([month, list]) => (
            <section key={month} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-neutral-400 tracking-wide">{month}</h2>
                <span className="text-[11px] font-mono text-neutral-500 tabular-nums">{list.length} items</span>
              </div>
              <JustifiedGrid
                assets={list}
                selectable
                selectedIds={selected}
                onToggleSelect={toggleSelect}
                onOpenLightbox={setActive}
              />
            </section>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center pt-2">
          <button
            disabled={loadingMore}
            onClick={loadMore}
            className="px-5 py-2.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/[0.1] dark:hover:bg-white/[0.12] text-xs font-medium disabled:opacity-50 transition-colors"
          >
            {loadingMore ? '加载中...' : '加载更多图片'}
          </button>
        </div>
      )}

      <Lightbox
        asset={active}
        assets={visibleAssets}
        onClose={() => setActive(null)}
        onSelect={setActive}
        onUpdated={load}
        canManage
      />
    </div>
  );
}

export default function GalleryPage() {
  return (
    <Protected>
      <Suspense fallback={<div className="py-24 text-center text-xs text-neutral-400">加载画廊...</div>}>
        <GalleryContent />
      </Suspense>
    </Protected>
  );
}
