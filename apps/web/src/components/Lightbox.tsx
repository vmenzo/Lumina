'use client';

import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Copy, Check, ChevronLeft, ChevronRight, ArrowRightLeft,
  Trash2, Eye, HardDrive, ExternalLink, PanelRightClose, PanelRightOpen,
  Camera, QrCode, Sliders, KeyRound, Download, Save, Sparkles, Search, Star, RefreshCw
} from 'lucide-react';
import type { Asset } from '@/types';
import { api, formatBytes } from '@/lib/api';
import { generateQRCodeDataURL } from '@/lib/qrcode';
import { useToast } from '@/context/ToastContext';

interface LightboxProps {
  asset: Asset | null;
  assets?: Asset[];
  onClose: () => void;
  onSelect?: (asset: Asset) => void;
  onUpdated?: () => void;
  canManage?: boolean;
}

export const Lightbox: React.FC<LightboxProps> = ({
  asset,
  assets = [],
  onClose,
  onSelect,
  onUpdated,
  canManage = false,
}) => {
  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true));
  const [showQR, setShowQR] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);

  // Full metadata edit state
  const [nameInput, setNameInput] = useState('');
  const [aliasInput, setAliasInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [visInput, setVisInput] = useState<'public' | 'unlisted' | 'private' | 'password'>('public');
  const [pwdInput, setPwdInput] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  // Dynamic transform builder state
  const [showTransform, setShowTransform] = useState(false);
  const [tfW, setTfW] = useState(1200);
  const [tfH, setTfH] = useState(0);
  const [tfQ, setTfQ] = useState(85);
  const [tfFmt, setTfFmt] = useState<'webp' | 'avif' | 'jpg' | 'png'>('webp');
  const [tfBlur, setTfBlur] = useState(0);
  const [tfUrl, setTfUrl] = useState('');

  // Signed expiring link state
  const [signedUrl, setSignedUrl] = useState('');
  const [signedTTL, setSignedTTL] = useState(60);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiCaption, setAiCaption] = useState('');
  const [similarAssets, setSimilarAssets] = useState<Asset[]>([]);

  const idx = asset ? assets.findIndex((a) => a.id === asset.id) : -1;

  useEffect(() => {
    if (asset) {
      setNameInput(asset.original_name);
      setAliasInput(asset.short_code);
      setTagsInput((asset.tags || []).join(', '));
      setVisInput(asset.visibility);
      setPwdInput('');
      setTfUrl('');
      setSignedUrl('');
      setShowQR(false);
      setZoomed(false);
      setFullLoaded(false);
      setAiCaption('');
      setSimilarAssets([]);
    }
  }, [asset]);

  // Preload adjacent images for instant arrow-key switching
  useEffect(() => {
    if (idx < 0) return;
    [assets[idx - 1], assets[idx + 1]].forEach((neighbor) => {
      if (neighbor?.direct_url) {
        const pre = new Image();
        pre.src = neighbor.direct_url;
      }
    });
  }, [idx, assets]);

  useEffect(() => {
    if (!asset) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft' && idx > 0 && onSelect) onSelect(assets[idx - 1]);
      if (e.key === 'ArrowRight' && idx >= 0 && idx < assets.length - 1 && onSelect) onSelect(assets[idx + 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asset, idx, assets, onSelect]);

  const copyText = async (key: string, val: string) => {
    await navigator.clipboard.writeText(val);
    setCopiedKey(key);
    toast('已复制到剪贴板');
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleSaveMeta = async () => {
    if (!asset) return;
    setSavingMeta(true);
    try {
      const tags = tagsInput
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        original_name: nameInput.trim() || asset.original_name,
        tags,
        visibility: visInput,
      };
      if (aliasInput.trim() && aliasInput.trim() !== asset.short_code) {
        payload.short_code = aliasInput.trim();
      }
      if (visInput === 'password' && pwdInput.trim()) {
        payload.password = pwdInput.trim();
      }
      const res = await api.updateAsset(asset.id, payload);
      onSelect?.(res.asset);
      onUpdated?.();
      toast('图片属性已保存');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '保存失败', 'error');
    } finally {
      setSavingMeta(false);
    }
  };

  const handleMigrate = async () => {
    if (!asset) return;
    const target = asset.storage_engine === 'local' ? 'r2' : 'local';
    setMigrating(true);
    try {
      const res = await api.migrateAsset(asset.id, target);
      toast(`已无损迁移至 ${target === 'r2' ? 'Cloudflare R2' : '本地 NVMe'}`);
      onSelect?.(res.asset);
      onUpdated?.();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '迁移失败', 'error');
    } finally {
      setMigrating(false);
    }
  };

  const handleBuildTransform = async () => {
    if (!asset) return;
    try {
      const res = await api.buildTransformUrl(asset.id, {
        width: tfW,
        height: tfH,
        quality: tfQ,
        format: tfFmt,
        blur: tfBlur,
      });
      setTfUrl(res.url);
      toast('动态处理链接已签发');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '生成失败', 'error');
    }
  };

  const handleCreateSigned = async () => {
    if (!asset) return;
    try {
      const res = await api.createSignedUrl(asset.id, signedTTL);
      setSignedUrl(res.signed_url);
      toast('临时签名访问链接已生成');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '签发失败', 'error');
    }
  };

  const handleTrash = async () => {
    if (!asset) return;
    try {
      await api.deleteAsset(asset.id, false);
      toast('已移入回收站');
      onClose();
      onUpdated?.();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '删除失败', 'error');
    }
  };

  const formats = asset
    ? [
        { key: 'direct', label: '原图直链', val: asset.direct_url },
        { key: 'webp', label: 'WebP 优化', val: asset.webp_url },
        { key: 'avif', label: 'AVIF 极限', val: asset.avif_url },
        ...(asset.watermark_url ? [{ key: 'wm', label: '动态水印外链', val: asset.watermark_url }] : []),
        { key: 'md', label: 'Markdown', val: `![${asset.original_name}](${asset.direct_url})` },
        { key: 'mdlink', label: 'Markdown (带缩略图跳转)', val: `[![${asset.original_name}](${asset.thumb_url})](${asset.share_url})` },
        { key: 'html', label: 'HTML', val: `<img src="${asset.direct_url}" alt="${asset.original_name}" />` },
        { key: 'bb', label: 'BBCode', val: `[img]${asset.direct_url}[/img]` },
        { key: 'rst', label: 'reStructuredText', val: `.. image:: ${asset.direct_url}` },
        { key: 'css', label: 'CSS Background', val: `background-image: url("${asset.direct_url}");` },
        { key: 'share', label: '独立分享页', val: asset.share_url },
      ]
    : [];

  const exifEntries = asset?.exif_data ? Object.entries(asset.exif_data).slice(0, 6) : [];
  const glowColor = asset?.dominant_color || '#3f3f46';

  return (
    <Dialog.Root open={!!asset} onOpenChange={(v) => !v && onClose()}>
      <AnimatePresence>
        {asset && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[95] bg-[#0A0A0C]/95"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <div className="fixed inset-0 z-[96] flex flex-col lg:flex-row overflow-hidden">
                <Dialog.Title className="sr-only">{asset.original_name}</Dialog.Title>

                {/* Left: Canvas Stage */}
                <div className="relative flex-1 flex items-center justify-center p-4 sm:p-10 select-none overflow-hidden">
                  <div
                    className="pointer-events-none absolute inset-0 transition-all duration-700"
                    style={{
                      background: `radial-gradient(circle at center, ${glowColor}38 0%, ${glowColor}12 38%, transparent 72%)`,
                    }}
                  />

                  <div className="absolute top-[max(1.25rem,calc(env(safe-area-inset-top)+0.5rem))] left-4 sm:left-5 right-4 sm:right-5 flex items-center justify-between z-10 pointer-events-none">
                    <button
                      onClick={onClose}
                      className="pointer-events-auto p-2.5 rounded-full bg-[#131317]/80 hover:bg-[#1C1C22] border border-white/[0.08] text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-2 pointer-events-auto">
                      {canManage && (
                        <button
                          onClick={async () => {
                            try {
                              const r = await api.toggleFavorite(asset.id);
                              onSelect?.({ ...asset, is_favorite: r.is_favorite });
                              onUpdated?.();
                              toast(r.is_favorite ? '已加入星标收藏' : '已取消星标');
                            } catch {}
                          }}
                          className={`px-3 py-2 rounded-full bg-[#131317]/80 hover:bg-[#1C1C22] border border-white/[0.08] text-xs flex items-center gap-1.5 ${
                            asset.is_favorite ? 'text-amber-400' : 'text-neutral-200'
                          }`}
                          title="星标收藏"
                        >
                          <Star className={`w-3.5 h-3.5 ${asset.is_favorite ? 'fill-amber-400' : ''}`} />
                          <span className="hidden sm:inline">{asset.is_favorite ? '已收藏' : '收藏'}</span>
                        </button>
                      )}
                      {canManage && (
                        <label className="cursor-pointer px-3 py-2 rounded-full bg-[#131317]/80 hover:bg-[#1C1C22] border border-white/[0.08] text-xs text-neutral-200 flex items-center gap-1.5" title="替换原图文件但保持当前短链外链不变">
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">替换原图</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                const r = await api.replaceAsset(asset.id, f);
                                onSelect?.(r.asset);
                                onUpdated?.();
                                toast('原图已无损替换，原有外链保持不变');
                              } catch (err: unknown) {
                                toast(err instanceof Error ? err.message : '替换失败', 'error');
                              }
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                      <a
                        href={`${asset.direct_url}${asset.direct_url.includes('?') ? '&' : '?'}download=1`}
                        download={asset.original_name}
                        className="px-3 py-2 rounded-full bg-[#131317]/80 hover:bg-[#1C1C22] border border-white/[0.08] text-xs text-neutral-200 flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">下载原图</span>
                      </a>
                      <button
                        onClick={() => setShowQR((v) => !v)}
                        className="px-3 py-2 rounded-full bg-[#131317]/80 hover:bg-[#1C1C22] border border-white/[0.08] text-xs text-neutral-200 flex items-center gap-1.5"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">二维码</span>
                      </button>
                      <button
                        onClick={() => setDrawerOpen((v) => !v)}
                        className="px-3 py-2 rounded-full bg-[#131317]/80 hover:bg-[#1C1C22] border border-white/[0.08] text-xs text-neutral-200 flex items-center gap-1.5 transition-colors"
                      >
                        {drawerOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">{drawerOpen ? '收起信息' : '图片信息'}</span>
                      </button>
                    </div>
                  </div>

                  {showQR && (
                    <div className="z-20 absolute top-16 right-5 p-4 rounded-2xl bg-white text-neutral-900 shadow-2xl space-y-2 text-center">
                      <img src={generateQRCodeDataURL(asset.share_url, 156)} alt="QR Code" className="w-36 h-36 mx-auto" />
                      <div className="text-[11px] font-medium">扫码查看分享页</div>
                    </div>
                  )}

                  {idx > 0 && onSelect && (
                    <button
                      onClick={() => onSelect(assets[idx - 1])}
                      className="z-10 absolute left-5 top-1/2 -translate-y-1/2 p-3 rounded-full bg-[#131317]/75 hover:bg-[#1C1C22] border border-white/[0.08] text-white transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}

                  {idx >= 0 && idx < assets.length - 1 && onSelect && (
                    <button
                      onClick={() => onSelect(assets[idx + 1])}
                      className="z-10 absolute right-5 top-1/2 -translate-y-1/2 p-3 rounded-full bg-[#131317]/75 hover:bg-[#1C1C22] border border-white/[0.08] text-white transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}

                  <div
                    onClick={() => setZoomed((z) => !z)}
                    className={`relative z-[1] flex items-center justify-center ${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
                    title="点击放大 / 还原"
                  >
                    {!fullLoaded && asset.thumb_url && (
                      <img
                        src={asset.thumb_url}
                        alt={asset.original_name}
                        className="max-h-[84vh] max-w-full object-contain rounded-xl shadow-2xl blur-[1px]"
                      />
                    )}
                    <img
                      key={asset.id}
                      src={asset.direct_url}
                      alt={asset.original_name}
                      decoding="async"
                      onLoad={() => setFullLoaded(true)}
                      className={`${fullLoaded ? 'relative opacity-100' : 'absolute opacity-0'} max-h-[84vh] max-w-full object-contain rounded-xl shadow-2xl transition-transform duration-200 ${
                        zoomed ? 'scale-150' : 'scale-100'
                      }`}
                    />
                  </div>
                </div>

                {/* Right: Collapsible Precision Inspector Drawer */}
                <AnimatePresence initial={false}>
                  {drawerOpen && (
                    <motion.aside
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 16 }}
                      transition={{ duration: 0.18 }}
                      className="w-full lg:w-[380px] shrink-0 bg-[#131317]/95 border-t lg:border-t-0 lg:border-l border-white/[0.07] text-neutral-100 p-4 sm:p-5 overflow-y-auto flex flex-col gap-4 max-h-[54dvh] lg:max-h-[100dvh]"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-medium text-sm truncate" title={asset.original_name}>
                            {asset.original_name}
                          </h3>
                          <a
                            href={asset.share_url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white shrink-0"
                            title="打开独立分享页"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-mono text-neutral-400 tabular-nums">
                          <span>{asset.width} × {asset.height}</span>
                          <span>·</span>
                          <span>{formatBytes(asset.size_bytes)}</span>
                          <span>·</span>
                          <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {asset.view_count}</span>
                        </div>
                      </div>

                      {/* 5-Color Palette */}
                      {asset.color_palette?.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] uppercase tracking-wider text-neutral-500">主色调</div>
                          <div className="flex items-center gap-2">
                            {asset.color_palette.map((c, i) => (
                              <button
                                key={i}
                                onClick={() => copyText(`color-${i}`, c)}
                                className="w-7 h-7 rounded-full border border-white/15 transition-transform hover:scale-110"
                                style={{ backgroundColor: c }}
                                title={`复制色值 ${c}`}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* EXIF Parameters */}
                      {exifEntries.length > 0 && (
                        <div className="p-3 rounded-2xl bg-[#1C1C22]/70 border border-white/[0.06] space-y-2">
                          <div className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                            <Camera className="w-3.5 h-3.5" /> EXIF 拍摄参数
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            {exifEntries.map(([k, v]) => (
                              <div key={k} className="truncate">
                                <span className="text-neutral-500 block">{k}</span>
                                <span className="font-mono tabular-nums text-neutral-200">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* AI Vision Auto-Tagging & Similar Search */}
                      {canManage && (
                        <div className="p-3.5 rounded-2xl bg-[#1C1C22]/70 border border-white/[0.06] space-y-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            <button
                              disabled={aiBusy}
                              onClick={async () => {
                                setAiBusy(true);
                                try {
                                  const res = await api.aiAnalyzeAsset(asset.id);
                                  setAiCaption(res.caption || '');
                                  if (res.asset) {
                                    onSelect?.(res.asset);
                                    setTagsInput((res.asset.tags || []).join(', '));
                                  }
                                  onUpdated?.();
                                  toast(res.provider === 'vision-llm' ? 'AI 视觉识图完成，已写入标签' : '已完成智能特征打标');
                                } catch (e: unknown) {
                                  toast(e instanceof Error ? e.message : 'AI 分析失败', 'error');
                                } finally {
                                  setAiBusy(false);
                                }
                              }}
                              className="flex-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              <span>{aiBusy ? '识别中...' : 'AI 识图打标'}</span>
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  const res = await api.findSimilarAssets(asset.id);
                                  setSimilarAssets(res.similar || []);
                                  if (!res.similar?.length) toast('暂未找到相似图片');
                                } catch (e: unknown) {
                                  toast(e instanceof Error ? e.message : '检索失败', 'error');
                                }
                              }}
                              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-medium flex items-center gap-1"
                            >
                              <Search className="w-3.5 h-3.5" /> 找相似
                            </button>
                          </div>
                          {aiCaption && (
                            <div className="text-[11px] text-neutral-300 bg-black/30 rounded-lg p-2 leading-relaxed">
                              {aiCaption}
                            </div>
                          )}
                          {similarAssets.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <div className="text-[10px] text-neutral-400">相似图片</div>
                              <div className="grid grid-cols-4 gap-1.5">
                                {similarAssets.slice(0, 8).map((sim) => (
                                  <button
                                    key={sim.id}
                                    onClick={() => onSelect?.(sim)}
                                    className="aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-white/50"
                                  >
                                    <img src={sim.thumb_url || sim.direct_url} alt={sim.original_name} className="w-full h-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Full Metadata Editor */}
                      {canManage && (
                        <div className="p-3.5 rounded-2xl bg-[#1C1C22]/70 border border-white/[0.06] space-y-2.5 text-xs">
                          <div className="text-[11px] text-neutral-400 font-medium">属性与权限编辑</div>
                          <input
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            placeholder="图片名称"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 outline-none"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={aliasInput}
                              onChange={(e) => setAliasInput(e.target.value)}
                              placeholder="短链别名"
                              className="px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 font-mono outline-none"
                            />
                            <select
                              value={visInput}
                              onChange={(e) => setVisInput(e.target.value as 'public' | 'unlisted' | 'private' | 'password')}
                              className="px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 outline-none"
                            >
                              <option value="public">公开广场</option>
                              <option value="unlisted">仅凭链接</option>
                              <option value="private">私密</option>
                              <option value="password">密码保护</option>
                            </select>
                          </div>
                          {visInput === 'password' && (
                            <input
                              type="password"
                              value={pwdInput}
                              onChange={(e) => setPwdInput(e.target.value)}
                              placeholder="新访问密码（留空不修改）"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 outline-none"
                            />
                          )}
                          <input
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            placeholder="标签（逗号分隔）"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 outline-none"
                          />
                          <button
                            disabled={savingMeta}
                            onClick={handleSaveMeta}
                            className="w-full py-1.5 rounded-lg bg-white text-neutral-900 font-medium flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" /> {savingMeta ? '保存中...' : '保存属性更改'}
                          </button>
                        </div>
                      )}

                      {/* Temporary Signed Direct Link for Private/Password Images */}
                      {canManage && (
                        <div className="p-3.5 rounded-2xl bg-[#1C1C22]/70 border border-white/[0.06] space-y-2 text-xs">
                          <div className="flex items-center justify-between text-[11px] text-neutral-400">
                            <span className="flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> 临时签名链接</span>
                          </div>
                          <div className="flex gap-1.5">
                            <select
                              value={signedTTL}
                              onChange={(e) => setSignedTTL(Number(e.target.value))}
                              className="px-2 py-1.5 rounded-lg bg-black/40 border border-white/10 outline-none"
                            >
                              <option value={15}>15 分钟</option>
                              <option value={60}>1 小时</option>
                              <option value={1440}>24 小时</option>
                              <option value={10080}>7 天</option>
                            </select>
                            <button
                              onClick={handleCreateSigned}
                              className="flex-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-medium"
                            >
                              签发限时直链
                            </button>
                          </div>
                          {signedUrl && (
                            <button
                              onClick={() => copyText('signed', signedUrl)}
                              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-black/40 text-left"
                            >
                              <span className="font-mono text-[11px] text-emerald-400 truncate">{signedUrl}</span>
                              <Copy className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Dynamic Image Transform Builder */}
                      <div className="p-3.5 rounded-2xl bg-[#1C1C22]/70 border border-white/[0.06] space-y-2.5 text-xs">
                        <button
                          onClick={() => setShowTransform((v) => !v)}
                          className="w-full flex items-center justify-between text-[11px] text-neutral-300"
                        >
                          <span className="flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5" /> 图片处理参数</span>
                          <span>{showTransform ? '收起' : '展开'}</span>
                        </button>
                        {showTransform && (
                          <div className="space-y-2 pt-1">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-neutral-400">宽度 (px)</label>
                                <input type="number" value={tfW} onChange={(e) => setTfW(Number(e.target.value))} className="w-full px-2 py-1 rounded bg-black/40 border border-white/10 font-mono" />
                              </div>
                              <div>
                                <label className="text-[10px] text-neutral-400">高度 (0=自适应)</label>
                                <input type="number" value={tfH} onChange={(e) => setTfH(Number(e.target.value))} className="w-full px-2 py-1 rounded bg-black/40 border border-white/10 font-mono" />
                              </div>
                              <div>
                                <label className="text-[10px] text-neutral-400">输出格式</label>
                                <select value={tfFmt} onChange={(e) => setTfFmt(e.target.value as 'webp' | 'avif' | 'jpg' | 'png')} className="w-full px-2 py-1 rounded bg-black/40 border border-white/10">
                                  <option value="webp">WebP</option>
                                  <option value="avif">AVIF</option>
                                  <option value="jpg">JPEG</option>
                                  <option value="png">PNG</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-neutral-400">质量 ({tfQ}) / 模糊 ({tfBlur})</label>
                                <div className="flex gap-1">
                                  <input type="number" min={10} max={100} value={tfQ} onChange={(e) => setTfQ(Number(e.target.value))} className="w-1/2 px-2 py-1 rounded bg-black/40 border border-white/10 font-mono" />
                                  <input type="number" min={0} max={50} value={tfBlur} onChange={(e) => setTfBlur(Number(e.target.value))} className="w-1/2 px-2 py-1 rounded bg-black/40 border border-white/10 font-mono" />
                                </div>
                              </div>
                            </div>
                            <button onClick={handleBuildTransform} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-medium">
                              生成签名处理链接
                            </button>
                            {tfUrl && (
                              <button onClick={() => copyText('tf', tfUrl)} className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-black/40 text-left">
                                <span className="font-mono text-[11px] text-sky-400 truncate">{tfUrl}</span>
                                <Copy className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Storage Engine */}
                      <div className="p-3.5 rounded-2xl bg-[#1C1C22]/70 border border-white/[0.06] space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-neutral-400 flex items-center gap-1.5">
                            <HardDrive className="w-3.5 h-3.5" /> 存储引擎
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-white/10 text-white">
                            {asset.storage_engine === 'r2' ? 'Cloudflare R2' : 'Local NVMe'}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-neutral-500 truncate" title={asset.sha256}>
                          SHA256: {asset.sha256.slice(0, 16)}...
                        </div>
                        {canManage && (
                          <button
                            disabled={migrating}
                            onClick={handleMigrate}
                            className="w-full py-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>{migrating ? '正在迁移...' : `迁移至 ${asset.storage_engine === 'local' ? 'Cloudflare R2' : 'Local NVMe'}`}</span>
                          </button>
                        )}
                      </div>

                      {/* Quick Copy Links */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] uppercase tracking-wider text-neutral-500">链接</div>
                        <div className="space-y-1.5">
                          {formats.map((f) => (
                            <button
                              key={f.key}
                              onClick={() => copyText(f.key, f.val)}
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#1C1C22]/60 hover:bg-[#1C1C22] border border-white/[0.05] text-left transition-colors group"
                            >
                              <div className="min-w-0">
                                <div className="text-[10px] text-neutral-400">{f.label}</div>
                                <div className="text-xs font-mono tabular-nums text-neutral-200 truncate">{f.val}</div>
                              </div>
                              {copiedKey === f.key ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 text-neutral-500 group-hover:text-white shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      {canManage && (
                        <button
                          onClick={handleTrash}
                          className="mt-auto py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>移入回收站</span>
                        </button>
                      )}
                    </motion.aside>
                  )}
                </AnimatePresence>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
