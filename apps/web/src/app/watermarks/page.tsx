'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import * as Tabs from '@radix-ui/react-tabs';
import { Stamp, Trash2, Save, Type, Image as ImageIcon, CheckCircle2, Plus, ExternalLink, Upload, Images } from 'lucide-react';
import { api, directUploadFile } from '@/lib/api';
import type { Asset, WatermarkPreset } from '@/types';
import { Protected } from '@/components/AppShell';
import { useToast } from '@/context/ToastContext';

function WatermarkContent() {
  const { toast } = useToast();
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const [presets, setPresets] = useState<WatermarkPreset[]>([]);
  const [recentAssets, setRecentAssets] = useState<Asset[]>([]);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [showLogoPicker, setShowLogoPicker] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [name, setName] = useState('默认版权水印');
  const [textContent, setTextContent] = useState('© Lumina');
  const [imageUrl, setImageUrl] = useState('');
  const [fontSize, setFontSize] = useState(24);
  const [scale, setScale] = useState(0.25);
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [opacity, setOpacity] = useState(0.55);
  const [position, setPosition] = useState('soea');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [angle, setAngle] = useState(-25);
  const [tiled, setTiled] = useState(false);

  const load = () => api.listWatermarks().then((r) => setPresets(r.presets || []));
  useEffect(() => {
    load();
    api.listAssets({ limit: '12' }).then((r) => setRecentAssets(r.assets || [])).catch(() => {});
  }, []);

  const sampleAsset = recentAssets[sampleIdx] || null;

  const resetForm = () => {
    setEditingId(null);
    setName('新水印预设');
    setMode('text');
    setTextContent('© Lumina');
    setImageUrl('');
    setFontSize(24);
    setScale(0.25);
    setTextColor('#FFFFFF');
    setOpacity(0.55);
    setPosition('soea');
    setOffsetX(0);
    setOffsetY(0);
    setAngle(-25);
    setTiled(false);
  };

  const loadPresetIntoEditor = (p: WatermarkPreset) => {
    setEditingId(p.id);
    setName(p.name);
    setMode(p.mode || 'text');
    setTextContent(p.text_content || '');
    setImageUrl(p.image_url || '');
    setFontSize(p.font_size || 24);
    setScale(p.scale || 0.25);
    setTextColor(p.text_color || '#FFFFFF');
    setOpacity(p.opacity || 0.55);
    setPosition(p.position || 'soea');
    setOffsetX(p.offset_x || 0);
    setOffsetY(p.offset_y || 0);
    setAngle(p.angle || 0);
    setTiled(Boolean(p.tiled));
  };

  const handleUploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const res = await directUploadFile(file, {
        engine: 'smart',
        visibility: 'unlisted',
        strip_gps: true,
      });
      setImageUrl(res.asset.direct_url);
      setMode('image');
      toast('Logo 图片已上传并填入');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Logo 上传失败', 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'image' && !imageUrl.trim()) {
      toast('请先上传或选择一张 Logo 图片', 'error');
      return;
    }
    try {
      await api.saveWatermark({
        ...(editingId ? { id: editingId } : {}),
        name,
        mode,
        text_content: textContent,
        image_url: imageUrl,
        font_size: fontSize,
        scale,
        text_color: textColor,
        opacity,
        position,
        offset_x: offsetX,
        offset_y: offsetY,
        angle,
        tiled,
        is_default: true,
      });
      toast(editingId ? '水印预设已更新并设为默认' : '水印预设已保存并设为默认');
      setEditingId(null);
      load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '保存失败', 'error');
    }
  };

  const posMap: Record<string, string> = {
    nowe: 'items-start justify-start',
    no: 'items-start justify-center',
    noea: 'items-start justify-end',
    we: 'items-center justify-start',
    ce: 'items-center justify-center',
    ea: 'items-center justify-end',
    sowe: 'items-end justify-start',
    so: 'items-end justify-center',
    soea: 'items-end justify-end',
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">水印设置</h1>
        {editingId && (
          <button
            onClick={resetForm}
            className="px-3.5 py-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-xs font-medium flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> 新建预设
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live Preview Canvas */}
        <div className="relative h-80 rounded-3xl overflow-hidden bg-gradient-to-br from-neutral-800 via-neutral-700 to-neutral-900 border border-black/[0.08] dark:border-white/[0.08] p-6 flex">
          {sampleAsset && (
            <img
              src={sampleAsset.thumb_url || sampleAsset.direct_url}
              alt="sample"
              className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none"
            />
          )}
          <div className={`w-full h-full flex ${posMap[position] || 'items-end justify-end'} relative overflow-hidden`}>
            {mode === 'image' ? (
              imageUrl ? (
                <img
                  src={imageUrl}
                  alt="Watermark Logo"
                  style={{ opacity, width: `${Math.round(scale * 100)}%`, transform: `translate(${offsetX}px, ${offsetY}px) rotate(${angle}deg)` }}
                  className="max-h-36 object-contain select-none pointer-events-none"
                />
              ) : (
                <span className="text-xs text-white/70">请上传或选择 Logo 图片</span>
              )
            ) : tiled ? (
              <div className="absolute inset-0 grid grid-cols-3 gap-6 place-items-center pointer-events-none">
                {Array.from({ length: 9 }).map((_, i) => (
                  <span
                    key={i}
                    style={{ color: textColor, opacity, fontSize: `${Math.max(12, fontSize * 0.7)}px`, transform: `rotate(${angle}deg)` }}
                    className="font-semibold select-none whitespace-nowrap drop-shadow"
                  >
                    {textContent}
                  </span>
                ))}
              </div>
            ) : (
              <span
                style={{ color: textColor, opacity, fontSize: `${fontSize}px`, transform: `translate(${offsetX}px, ${offsetY}px) rotate(${angle}deg)` }}
                className="font-semibold select-none drop-shadow"
              >
                {textContent}
              </span>
            )}
          </div>
          <div className="absolute top-3.5 left-4 right-4 flex items-center justify-between">
            <span className="px-2 py-0.5 rounded-full bg-black/50 text-[10px] uppercase tracking-widest text-white/80">
              Preview
            </span>
            {recentAssets.length > 1 && (
              <button
                type="button"
                onClick={() => setSampleIdx((i) => (i + 1) % recentAssets.length)}
                className="px-2.5 py-1 rounded-full bg-black/55 hover:bg-black/75 text-[11px] text-white/90 transition-colors"
              >
                切换底图
              </button>
            )}
          </div>
        </div>

        {/* Controls */}
        <form onSubmit={save} className="p-6 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] space-y-4 text-xs">
          <Tabs.Root value={mode} onValueChange={(v) => setMode(v as 'text' | 'image')}>
            <Tabs.List className="inline-flex p-1 rounded-full bg-neutral-100 dark:bg-[#1C1C22] mb-2">
              <Tabs.Trigger value="text" className="px-3.5 py-1.5 rounded-full font-medium flex items-center gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm">
                <Type className="w-3.5 h-3.5" /> 文字水印
              </Tabs.Trigger>
              <Tabs.Trigger value="image" className="px-3.5 py-1.5 rounded-full font-medium flex items-center gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm">
                <ImageIcon className="w-3.5 h-3.5" /> 图片水印
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-neutral-400 block mb-1">预设名称</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none" />
            </div>

            {mode === 'text' ? (
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">水印文字</label>
                <input value={textContent} onChange={(e) => setTextContent(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none" />
              </div>
            ) : (
              <div className="sm:col-span-2 space-y-2">
                <label className="text-[11px] text-neutral-400 block">Logo 图片</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="上传本地 Logo、从画廊选取或粘贴图片 URL"
                    className="flex-1 min-w-[180px] px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none font-mono"
                  />
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={() => logoInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" /> {uploadingLogo ? '上传中...' : '上传图片'}
                  </button>
                  {recentAssets.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowLogoPicker((v) => !v)}
                      className="px-3 py-2 rounded-xl bg-black/[0.06] dark:bg-white/[0.08] font-medium flex items-center gap-1.5 shrink-0"
                    >
                      <Images className="w-3.5 h-3.5" /> 画廊选取
                    </button>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadLogo(f);
                      e.target.value = '';
                    }}
                  />
                </div>
                {showLogoPicker && recentAssets.length > 0 && (
                  <div className="p-2.5 rounded-2xl bg-neutral-100 dark:bg-black/40 grid grid-cols-6 gap-2">
                    {recentAssets.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setImageUrl(a.direct_url);
                          setShowLogoPicker(false);
                        }}
                        className={`aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                          imageUrl === a.direct_url ? 'border-neutral-900 dark:border-white' : 'border-transparent hover:border-neutral-400'
                        }`}
                        title={a.original_name}
                      >
                        <img src={a.thumb_url || a.direct_url} alt={a.original_name} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mode === 'text' ? (
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">字号 ({fontSize}px)</label>
                <input type="range" min={12} max={64} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full" />
              </div>
            ) : (
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">缩放比例 ({Math.round(scale * 100)}%)</label>
                <input type="range" min={0.1} max={0.6} step={0.05} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="w-full" />
              </div>
            )}

            <div>
              <label className="text-[11px] text-neutral-400 block mb-1">透明度 ({Math.round(opacity * 100)}%)</label>
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="text-[11px] text-neutral-400 block mb-1">位置</label>
              <select value={position} onChange={(e) => setPosition(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none">
                <option value="nowe">左上角</option>
                <option value="no">上居中</option>
                <option value="noea">右上角</option>
                <option value="we">左居中</option>
                <option value="ce">正中心</option>
                <option value="ea">右居中</option>
                <option value="sowe">左下角</option>
                <option value="so">下居中</option>
                <option value="soea">右下角</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-neutral-400 block mb-1">旋转角度 ({angle}°)</label>
              <input type="range" min={-45} max={45} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="w-full" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-4">
              {mode === 'text' && (
                <label className="flex items-center gap-2">
                  <span className="text-neutral-400">颜色</span>
                  <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-7 h-7 rounded-lg bg-transparent cursor-pointer" />
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch.Root
                  checked={tiled}
                  onCheckedChange={setTiled}
                  className="w-8 h-[18px] rounded-full bg-neutral-200 dark:bg-white/15 data-[state=checked]:bg-neutral-900 dark:data-[state=checked]:bg-white relative transition-colors"
                >
                  <Switch.Thumb className="block w-3.5 h-3.5 rounded-full bg-white dark:bg-neutral-900 translate-x-0.5 data-[state=checked]:translate-x-4 transition-transform" />
                </Switch.Root>
                <span>平铺</span>
              </label>
            </div>

            <button type="submit" className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> {editingId ? '更新预设' : '保存预设'}
            </button>
          </div>
        </form>
      </div>

      {/* Saved Presets */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-neutral-400">水印预设</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map((p) => (
            <div
              key={p.id}
              onClick={() => loadPresetIntoEditor(p)}
              className={`p-4 rounded-2xl bg-white dark:bg-[#131317] border cursor-pointer transition-colors flex flex-col gap-3 text-xs ${
                editingId === p.id
                  ? 'border-neutral-900 dark:border-white'
                  : 'border-black/[0.06] dark:border-white/[0.07] hover:border-neutral-400'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Stamp className="w-4 h-4 text-neutral-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-1.5">
                      <span>{p.name}</span>
                      {p.is_default && (
                        <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px]">默认</span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-400 truncate mt-0.5">
                      {p.mode === 'image' ? '图片水印' : p.text_content} · {p.tiled ? '平铺' : p.position} · {Math.round(p.opacity * 100)}%
                    </div>
                  </div>
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.deleteWatermark(p.id);
                    if (editingId === p.id) resetForm();
                    toast('已删除');
                    load();
                  }}
                  className="p-1.5 rounded-full text-neutral-400 hover:text-rose-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
                {!p.is_default ? (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await api.setDefaultWatermark(p.id);
                      toast('已设为默认水印');
                      load();
                    }}
                    className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-white flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> 设为默认
                  </button>
                ) : (
                  <span className="text-[11px] text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 当前默认
                  </span>
                )}
                {sampleAsset && (
                  <a
                    href={`/raw/${sampleAsset.short_code}/watermark?preset_id=${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] text-neutral-400 hover:text-neutral-900 dark:hover:text-white flex items-center gap-1"
                  >
                    效果预览 <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WatermarkPage() {
  return (
    <Protected>
      <WatermarkContent />
    </Protected>
  );
}
