'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, UploadCloud, Link2, CheckCircle2, Zap, Copy, ClipboardPaste,
  RotateCw, FlipHorizontal, Crop, SlidersHorizontal, Check
} from 'lucide-react';
import { api, directUploadFile, formatAssetLinksBatch, type BatchLinkFormat } from '@/lib/api';
import type { Album, Asset, WatermarkPreset } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

interface UploadStudioProps {
  open: boolean;
  initialFiles?: File[];
  onClose: () => void;
  onUploaded: () => void;
}

interface QueueItem {
  id: string;
  file: File;
  pct: number;
  stage: string;
  done: boolean;
  instant?: boolean;
  error?: string;
  asset?: Asset;
}

async function transformImageFile(
  file: File,
  rotateDeg: number,
  flipH: boolean,
  aspectRatio: 'free' | '1:1' | '16:9' | '4:3'
): Promise<File> {
  const bmp = await createImageBitmap(file);
  const swap = rotateDeg % 180 !== 0;
  const rotW = swap ? bmp.height : bmp.width;
  const rotH = swap ? bmp.width : bmp.height;

  // Step 1: draw rotated & flipped onto temp canvas
  const tmp = document.createElement('canvas');
  tmp.width = rotW;
  tmp.height = rotH;
  const tctx = tmp.getContext('2d');
  if (!tctx) return file;
  tctx.translate(rotW / 2, rotH / 2);
  tctx.rotate((rotateDeg * Math.PI) / 180);
  if (flipH) tctx.scale(-1, 1);
  tctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);

  // Step 2: optional center aspect crop
  let cropW = rotW;
  let cropH = rotH;
  if (aspectRatio !== 'free') {
    const ratio = aspectRatio === '1:1' ? 1 : aspectRatio === '16:9' ? 16 / 9 : 4 / 3;
    if (rotW / rotH > ratio) {
      cropW = Math.round(rotH * ratio);
    } else {
      cropH = Math.round(rotW / ratio);
    }
  }
  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const octx = out.getContext('2d');
  if (!octx) return file;
  octx.drawImage(tmp, (rotW - cropW) / 2, (rotH - cropH) / 2, cropW, cropH, 0, 0, cropW, cropH);

  const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, file.type || 'image/jpeg', 0.92));
  if (!blob) return file;
  return new File([blob], file.name, { type: blob.type });
}

export const UploadStudio: React.FC<UploadStudioProps> = ({ open, initialFiles = [], onClose, onUploaded }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<'file' | 'remote'>('file');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [watermarkPresets, setWatermarkPresets] = useState<WatermarkPreset[]>([]);
  const [watermarkId, setWatermarkId] = useState<string>('');
  const [engine, setEngine] = useState<'smart' | 'local' | 'r2'>('smart');
  const [albumId, setAlbumId] = useState<string>('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private' | 'password'>('public');
  const [password, setPassword] = useState('');
  const [expireHours, setExpireHours] = useState(0);
  const [customAlias, setCustomAlias] = useState('');
  const [stripGps, setStripGps] = useState(true);
  const [convertWebp, setConvertWebp] = useState(false);
  const [clientCompress, setClientCompress] = useState(false);
  const [quality, setQuality] = useState(0.85);
  const [maxWidth, setMaxWidth] = useState(0);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [batchFmt, setBatchFmt] = useState<BatchLinkFormat>('markdown');
  const [copiedBatch, setCopiedBatch] = useState(false);

  // Quick Pre-Upload Image Editor State
  const [editingFile, setEditingFile] = useState<File | null>(null);
  const [editPreview, setEditPreview] = useState<string>('');
  const [rotateDeg, setRotateDeg] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [cropAspect, setCropAspect] = useState<'free' | '1:1' | '16:9' | '4:3'>('free');

  useEffect(() => {
    if (open && user) {
      api.listAlbums().then((r) => setAlbums(r.albums || [])).catch(() => {});
      api.listWatermarks().then((r) => setWatermarkPresets(r.presets || [])).catch(() => {});
    }
  }, [open, user]);

  useEffect(() => {
    if (open && initialFiles.length > 0) {
      enqueueFiles(initialFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles]);

  useEffect(() => {
    if (!editingFile) {
      setEditPreview('');
      return;
    }
    const url = URL.createObjectURL(editingFile);
    setEditPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [editingFile]);

  const enqueueFiles = (files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith('image/'));
    if (valid.length === 0) return;
    const newItems: QueueItem[] = valid.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      pct: 0,
      stage: '等待队列...',
      done: false,
    }));
    setQueue((prev) => [...newItems, ...prev]);

    newItems.forEach(async (item) => {
      try {
        const res = await directUploadFile(item.file, {
          engine,
          album_id: albumId ? Number(albumId) : null,
          visibility,
          password,
          expire_hours: expireHours,
          custom_alias: customAlias.trim(),
          strip_gps: stripGps,
          convert_webp: convertWebp,
          watermark_preset: watermarkId ? watermarkPresets.find((w) => String(w.id) === watermarkId) || null : null,
          client_compress: clientCompress,
          quality,
          max_width: maxWidth,
          onProgress: (pct, stage) => {
            setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, pct, stage } : q)));
          },
        });
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, pct: 100, done: true, instant: res.instant, asset: res.asset, stage: res.instant ? '⚡ 秒传成功' : '已入库' }
              : q
          )
        );
        onUploaded();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '上传失败';
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, error: msg, stage: msg } : q)));
      }
    });
  };

  const handlePasteClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith('image/'));
        if (imgType) {
          const blob = await item.getType(imgType);
          const ext = imgType.split('/')[1] || 'png';
          files.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imgType }));
        }
      }
      if (files.length === 0) {
        toast('剪贴板中未检测到图片', 'error');
        return;
      }
      enqueueFiles(files);
    } catch {
      toast('请按 Ctrl+V / Cmd+V 直接粘贴截图，或授予剪贴板权限', 'error');
    }
  };

  const applyEditAndUpload = async () => {
    if (!editingFile) return;
    try {
      const transformed = await transformImageFile(editingFile, rotateDeg, flipH, cropAspect);
      setEditingFile(null);
      setRotateDeg(0);
      setFlipH(false);
      setCropAspect('free');
      enqueueFiles([transformed]);
    } catch {
      toast('图片编辑处理失败', 'error');
    }
  };

  const handleRemote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remoteUrl.trim()) return;
    setRemoteBusy(true);
    try {
      const res = await api.remoteUpload(remoteUrl.trim(), engine, albumId ? Number(albumId) : null, visibility);
      toast(res.instant ? '⚡ 远程链接命中秒传' : '远程图片已安全抓取并入库');
      setRemoteUrl('');
      onUploaded();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '远程拉取失败', 'error');
    } finally {
      setRemoteBusy(false);
    }
  };

  const completedAssets = queue.filter((q) => q.done && q.asset).map((q) => q.asset!);

  const copyAllDone = async () => {
    if (completedAssets.length === 0) return;
    const text = formatAssetLinksBatch(completedAssets, batchFmt);
    await navigator.clipboard.writeText(text);
    setCopiedBatch(true);
    toast(`已批量复制 ${completedAssets.length} 条外链`);
    setTimeout(() => setCopiedBatch(false), 1500);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <div className="fixed inset-0 z-[101] pt-safe flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none">
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="pointer-events-auto w-full max-w-2xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.08] dark:border-white/[0.08] shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col"
                >
                  <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.06]">
                    <Dialog.Title className="font-semibold text-sm">上传图片</Dialog.Title>
                    <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.08]">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto space-y-5">
                    {/* Quick Image Crop/Rotate Editor Overlay */}
                    {editingFile && editPreview ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">编辑图片 · {editingFile.name}</span>
                          <button onClick={() => setEditingFile(null)} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
                            取消编辑
                          </button>
                        </div>
                        <div className="h-64 rounded-2xl bg-neutral-100 dark:bg-black/40 flex items-center justify-center overflow-hidden p-4">
                          <img
                            src={editPreview}
                            alt="preview"
                            style={{
                              transform: `rotate(${rotateDeg}deg) scaleX(${flipH ? -1 : 1})`,
                              aspectRatio: cropAspect === 'free' ? undefined : cropAspect.replace(':', '/'),
                            }}
                            className={`max-h-full max-w-full transition-transform ${cropAspect === 'free' ? 'object-contain' : 'object-cover rounded-lg'}`}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setRotateDeg((d) => (d + 90) % 360)}
                              className="px-3 py-1.5 rounded-xl bg-neutral-100 dark:bg-white/[0.08] flex items-center gap-1"
                            >
                              <RotateCw className="w-3.5 h-3.5" /> 旋转 90°
                            </button>
                            <button
                              type="button"
                              onClick={() => setFlipH((v) => !v)}
                              className="px-3 py-1.5 rounded-xl bg-neutral-100 dark:bg-white/[0.08] flex items-center gap-1"
                            >
                              <FlipHorizontal className="w-3.5 h-3.5" /> 水平翻转
                            </button>
                            {(['free', '1:1', '16:9', '4:3'] as const).map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setCropAspect(r)}
                                className={`px-2.5 py-1.5 rounded-xl ${
                                  cropAspect === r ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900' : 'bg-neutral-100 dark:bg-white/[0.08]'
                                }`}
                              >
                                {r === 'free' ? '原比例' : r}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={applyEditAndUpload}
                            className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium"
                          >
                            应用并上传
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as 'file' | 'remote')}>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                          <Tabs.List className="inline-flex p-1 rounded-full bg-neutral-100 dark:bg-white/[0.06] text-xs">
                            <Tabs.Trigger
                              value="file"
                              className="px-4 py-1.5 rounded-full font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm transition-all flex items-center gap-1.5"
                            >
                              <UploadCloud className="w-3.5 h-3.5" /> 本地直传
                            </Tabs.Trigger>
                            <Tabs.Trigger
                              value="remote"
                              className="px-4 py-1.5 rounded-full font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm transition-all flex items-center gap-1.5"
                            >
                              <Link2 className="w-3.5 h-3.5" /> URL 远程拉取
                            </Tabs.Trigger>
                          </Tabs.List>

                          <div className="flex items-center gap-1.5 text-xs">
                            <button
                              type="button"
                              onClick={handlePasteClipboard}
                              className="px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-white/[0.06] hover:bg-neutral-200 dark:hover:bg-white/[0.12] flex items-center gap-1"
                            >
                              <ClipboardPaste className="w-3.5 h-3.5" /> 粘贴剪贴板
                            </button>
                            <button
                              type="button"
                              onClick={() => editInputRef.current?.click()}
                              className="px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-white/[0.06] hover:bg-neutral-200 dark:hover:bg-white/[0.12] flex items-center gap-1"
                            >
                              <Crop className="w-3.5 h-3.5" /> 裁剪后上传
                            </button>
                            <input
                              ref={editInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) setEditingFile(f);
                                e.target.value = '';
                              }}
                            />
                          </div>
                        </div>

                        {/* Shared Options Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3 text-xs">
                          <div>
                            <label className="text-[11px] text-neutral-400 block mb-1">存储引擎</label>
                            <select
                              value={engine}
                              onChange={(e) => setEngine(e.target.value as 'smart' | 'local' | 'r2')}
                              className="w-full px-2.5 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
                            >
                              <option value="smart">智能路由</option>
                              <option value="local">Local NVMe</option>
                              <option value="r2">Cloudflare R2</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] text-neutral-400 block mb-1">归属相册</label>
                            <select
                              value={albumId}
                              onChange={(e) => setAlbumId(e.target.value)}
                              className="w-full px-2.5 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
                            >
                              <option value="">默认根目录</option>
                              {albums.map((al) => (
                                <option key={al.id} value={al.id}>{al.title}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] text-neutral-400 block mb-1">可见性</label>
                            <select
                              value={visibility}
                              onChange={(e) => setVisibility(e.target.value as 'public' | 'unlisted' | 'private' | 'password')}
                              className="w-full px-2.5 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
                            >
                              <option value="public">公开广场</option>
                              <option value="unlisted">仅凭链接</option>
                              <option value="private">私密</option>
                              <option value="password">密码保护</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] text-neutral-400 block mb-1">阅后即焚</label>
                            <select
                              value={expireHours}
                              onChange={(e) => setExpireHours(Number(e.target.value))}
                              className="w-full px-2.5 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
                            >
                              <option value={0}>永久保存</option>
                              <option value={1}>1 小时</option>
                              <option value={24}>24 小时</option>
                              <option value={168}>7 天</option>
                            </select>
                          </div>
                        </div>

                        {watermarkPresets.length > 0 && (
                          <div className="mb-3 text-xs">
                            <label className="text-[11px] text-neutral-400 block mb-1">水印预设</label>
                            <select
                              value={watermarkId}
                              onChange={(e) => setWatermarkId(e.target.value)}
                              className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
                            >
                              <option value="">不使用水印</option>
                              {watermarkPresets.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name} ({w.mode === 'image' ? 'Logo' : w.text_content}{w.is_default ? ' · 默认' : ''})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <input
                          value={customAlias}
                          onChange={(e) => setCustomAlias(e.target.value)}
                          placeholder="自定义短链别名（可选）"
                          className="w-full mb-3 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] text-xs outline-none font-mono"
                        />
                        {visibility === 'password' && (
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="设置访问密码..."
                            className="w-full mb-4 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] text-xs outline-none"
                          />
                        )}

                        <Tabs.Content value="file" className="space-y-4">
                          <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-white/[0.03] border border-black/[0.05] dark:border-white/[0.06] space-y-3 text-xs">
                            <div className="flex flex-wrap items-center gap-4 text-neutral-600 dark:text-neutral-300">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <Switch.Root
                                  checked={stripGps}
                                  onCheckedChange={setStripGps}
                                  className="w-8 h-[18px] rounded-full bg-neutral-200 dark:bg-white/15 data-[state=checked]:bg-neutral-900 dark:data-[state=checked]:bg-white relative transition-colors"
                                >
                                  <Switch.Thumb className="block w-3.5 h-3.5 rounded-full bg-white dark:bg-neutral-900 translate-x-0.5 data-[state=checked]:translate-x-4 transition-transform" />
                                </Switch.Root>
                                <span>剥离 GPS 隐私</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <Switch.Root
                                  checked={convertWebp}
                                  onCheckedChange={setConvertWebp}
                                  className="w-8 h-[18px] rounded-full bg-neutral-200 dark:bg-white/15 data-[state=checked]:bg-neutral-900 dark:data-[state=checked]:bg-white relative transition-colors"
                                >
                                  <Switch.Thumb className="block w-3.5 h-3.5 rounded-full bg-white dark:bg-neutral-900 translate-x-0.5 data-[state=checked]:translate-x-4 transition-transform" />
                                </Switch.Root>
                                <span>前端转 WebP</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <Switch.Root
                                  checked={clientCompress}
                                  onCheckedChange={setClientCompress}
                                  className="w-8 h-[18px] rounded-full bg-neutral-200 dark:bg-white/15 data-[state=checked]:bg-neutral-900 dark:data-[state=checked]:bg-white relative transition-colors"
                                >
                                  <Switch.Thumb className="block w-3.5 h-3.5 rounded-full bg-white dark:bg-neutral-900 translate-x-0.5 data-[state=checked]:translate-x-4 transition-transform" />
                                </Switch.Root>
                                <span>客户端压缩</span>
                              </label>
                            </div>

                            {(clientCompress || convertWebp) && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
                                <div>
                                  <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                                    <span className="flex items-center gap-1"><SlidersHorizontal className="w-3 h-3" /> 压缩质量</span>
                                    <span className="font-mono">{Math.round(quality * 100)}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min={0.5}
                                    max={1}
                                    step={0.05}
                                    value={quality}
                                    onChange={(e) => setQuality(Number(e.target.value))}
                                    className="w-full"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-neutral-400 block mb-1">最大宽度缩放</label>
                                  <select
                                    value={maxWidth}
                                    onChange={(e) => setMaxWidth(Number(e.target.value))}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-white/[0.06] outline-none"
                                  >
                                    <option value={0}>保持原尺寸</option>
                                    <option value={2560}>最大 2560px (2K)</option>
                                    <option value={1920}>最大 1920px (1080P)</option>
                                    <option value={1280}>最大 1280px (博客推荐)</option>
                                  </select>
                                </div>
                              </div>
                            )}
                          </div>

                          <div
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (e.dataTransfer.files?.length) enqueueFiles(Array.from(e.dataTransfer.files));
                            }}
                            className="cursor-pointer rounded-2xl border-2 border-dashed border-black/[0.1] dark:border-white/[0.12] hover:border-neutral-400 dark:hover:border-white/30 p-8 text-center transition-colors"
                          >
                            <UploadCloud className="w-8 h-8 mx-auto text-neutral-400 mb-2" />
                            <div className="text-sm font-medium">拖拽或点击选择图片</div>
                            <div className="text-[11px] text-neutral-400 mt-1">支持 JPG、PNG、WebP、AVIF、GIF、SVG</div>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files?.length) enqueueFiles(Array.from(e.target.files));
                                e.target.value = '';
                              }}
                            />
                          </div>
                        </Tabs.Content>

                        <Tabs.Content value="remote">
                          <form onSubmit={handleRemote} className="flex gap-2">
                            <input
                              type="url"
                              required
                              value={remoteUrl}
                              onChange={(e) => setRemoteUrl(e.target.value)}
                              placeholder="https://example.com/photo.jpg"
                              className="flex-1 px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] text-xs outline-none font-mono"
                            />
                            <button
                              disabled={remoteBusy}
                              type="submit"
                              className="px-4 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-medium disabled:opacity-50"
                            >
                              {remoteBusy ? '抓取中...' : '安全拉取'}
                            </button>
                          </form>
                        </Tabs.Content>
                      </Tabs.Root>
                    )}

                    {/* Upload Queue */}
                    {queue.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-neutral-400">上传队列 ({completedAssets.length}/{queue.length} 完成)</span>
                          {completedAssets.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={batchFmt}
                                onChange={(e) => setBatchFmt(e.target.value as BatchLinkFormat)}
                                className="px-2 py-1 rounded-lg bg-neutral-100 dark:bg-white/[0.08] outline-none text-[11px]"
                              >
                                <option value="direct">直链 URL</option>
                                <option value="markdown">Markdown</option>
                                <option value="markdown_link">Markdown (带链接)</option>
                                <option value="html">HTML</option>
                                <option value="bbcode">BBCode</option>
                                <option value="webp">WebP 优化链接</option>
                              </select>
                              <button
                                type="button"
                                onClick={copyAllDone}
                                className="px-3 py-1 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium flex items-center gap-1 text-[11px]"
                              >
                                {copiedBatch ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                <span>一键复制全部 ({completedAssets.length})</span>
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {queue.map((item) => (
                            <div key={item.id} className="p-3 rounded-2xl bg-neutral-100/80 dark:bg-white/[0.04] text-xs space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">{item.file.name}</span>
                                <span className={`text-[11px] shrink-0 flex items-center gap-1 ${item.error ? 'text-rose-500' : item.done ? 'text-emerald-500' : 'text-neutral-400'}`}>
                                  {item.instant && <Zap className="w-3 h-3" />}
                                  {item.done && !item.instant && <CheckCircle2 className="w-3 h-3" />}
                                  {item.stage}
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden">
                                <div
                                  className={`h-full transition-all ${item.error ? 'bg-rose-500' : 'bg-neutral-900 dark:bg-white'}`}
                                  style={{ width: `${item.pct}%` }}
                                />
                              </div>
                              {item.asset && (
                                <div className="flex items-center justify-between gap-2 pt-1">
                                  <span className="font-mono text-[11px] text-neutral-400 truncate">{item.asset.direct_url}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(item.asset!.direct_url);
                                        toast('直链已复制');
                                      }}
                                      className="px-2 py-0.5 rounded-md bg-black/[0.06] dark:bg-white/10 hover:bg-black/10 text-[10px]"
                                    >
                                      URL
                                    </button>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(`![${item.asset!.original_name}](${item.asset!.direct_url})`);
                                        toast('Markdown 已复制');
                                      }}
                                      className="px-2 py-0.5 rounded-md bg-black/[0.06] dark:bg-white/10 hover:bg-black/10 text-[10px]"
                                    >
                                      MD
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
