'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Upload, Image as ImageIcon, FolderKanban, Stamp, KeyRound,
  Trash2, ShieldCheck, Compass, User, Moon, ArrowRight, Palette, Copy, BarChart3, Globe
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Album, Asset } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenUpload: () => void;
}

const COLOR_FILTERS = [
  { id: 'warm', label: '暖红橙', hex: '#ef4444' },
  { id: 'amber', label: '琥珀金', hex: '#f59e0b' },
  { id: 'green', label: '森系绿', hex: '#10b981' },
  { id: 'blue', label: '深海蓝', hex: '#3b82f6' },
  { id: 'violet', label: '霓虹紫', hex: '#8b5cf6' },
  { id: 'mono', label: '黑白灰', hex: '#71717a' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onOpenUpload }) => {
  const [query, setQuery] = useState('');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [matchedAssets, setMatchedAssets] = useState<Asset[]>([]);
  const router = useRouter();
  const { user } = useAuth();
  const { toggle } = useTheme();
  const { toast } = useToast();

  useEffect(() => {
    if (open && user) {
      api.listAlbums().then((r) => setAlbums(r.albums || [])).catch(() => {});
    }
  }, [open, user]);

  useEffect(() => {
    if (!open || !user || !query.trim()) {
      setMatchedAssets([]);
      return;
    }
    const timer = setTimeout(() => {
      api.listAssets({ q: query.trim(), limit: '5' }).then((r) => setMatchedAssets(r.assets || [])).catch(() => {});
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open, user]);

  const commands = useMemo(() => {
    const list = [
      { id: 'upload', label: '上传图片', icon: Upload, action: () => onOpenUpload() },
      { id: 'explore', label: '浏览探索广场', icon: Compass, action: () => router.push('/explore') },
      { id: 'theme', label: '切换深曜石 / 纸白画布', icon: Moon, action: () => toggle() },
    ];
    if (user) {
      list.unshift(
        { id: 'gallery', label: '前往我的画廊', icon: ImageIcon, action: () => router.push('/gallery') },
        { id: 'albums', label: '管理多级相册', icon: FolderKanban, action: () => router.push('/albums') },
        { id: 'analytics', label: '数据统计', icon: BarChart3, action: () => router.push('/analytics') },
        { id: 'public_profile', label: '公开主页', icon: Globe, action: () => router.push(`/u/${encodeURIComponent(user.username)}`) },
        { id: 'watermarks', label: '可视化水印设计器', icon: Stamp, action: () => router.push('/watermarks') },
        { id: 'tokens', label: 'API Token 与 PicGo / ShareX 配置', icon: KeyRound, action: () => router.push('/tokens') },
        { id: 'trash', label: '回收站 (30天保留)', icon: Trash2, action: () => router.push('/trash') },
        { id: 'profile', label: '个人中心与 2FA 安全设置', icon: User, action: () => router.push('/profile') },
      );
      if (user.role === 'admin') {
        list.push({ id: 'admin', label: '管理后台', icon: ShieldCheck, action: () => router.push('/admin') });
      }
    }
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((c) => c.label.toLowerCase().includes(q) || c.id.includes(q));
  }, [query, user, router, onOpenUpload, toggle]);

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
                className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <div className="fixed inset-0 z-[101] flex items-start justify-center pt-[14vh] px-4 pointer-events-none">
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: -8 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="pointer-events-auto w-full max-w-xl rounded-3xl bg-white/95 dark:bg-[#131317]/95 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.08] shadow-2xl overflow-hidden"
                >
                  <Dialog.Title className="sr-only">全局指令面板</Dialog.Title>
                  <div className="flex items-center gap-3 px-4 py-3.5 border-b border-black/[0.06] dark:border-white/[0.07]">
                    <Search className="w-4 h-4 text-neutral-400" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索图片、相册或页面..."
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
                    />
                    <kbd className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-neutral-400">
                      ESC
                    </kbd>
                  </div>

                  {/* Color Swatch Filter Bar */}
                  {user && (
                    <div className="px-4 py-2.5 border-b border-black/[0.05] dark:border-white/[0.06] flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-neutral-400 flex items-center gap-1.5">
                        <Palette className="w-3.5 h-3.5" /> 主色调滤镜
                      </span>
                      <div className="flex items-center gap-1.5">
                        {COLOR_FILTERS.map((cf) => (
                          <button
                            key={cf.id}
                            onClick={() => {
                              onClose();
                              router.push(`/gallery?color=${cf.id}`);
                            }}
                            title={cf.label}
                            className="w-5 h-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                            style={{ backgroundColor: cf.hex }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="max-h-80 overflow-y-auto p-2 space-y-2">
                    {/* Live Image Search Results */}
                    {matchedAssets.length > 0 && (
                      <div className="space-y-1">
                        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-400">匹配图片</div>
                        {matchedAssets.map((a) => (
                          <div
                            key={a.id}
                            onClick={() => {
                              onClose();
                              router.push(`/gallery?q=${encodeURIComponent(a.short_code)}`);
                            }}
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl hover:bg-black/[0.04] dark:hover:bg-[#1C1C22] cursor-pointer text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <img src={a.thumb_url || a.direct_url} alt={a.original_name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                              <div className="min-w-0">
                                <div className="font-medium truncate">{a.original_name}</div>
                                <div className="text-[10px] font-mono text-neutral-400">{a.width}×{a.height} · {a.short_code}</div>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(a.share_url);
                                toast('分享链接已复制');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-black/[0.05] dark:bg-white/[0.08] text-[10px] flex items-center gap-1 shrink-0"
                            >
                              <Copy className="w-3 h-3" /> 分享链
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Quick Jump Albums */}
                    {albums.length > 0 && !query.trim() && (
                      <div className="space-y-1">
                        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-400">快速跳转相册</div>
                        <div className="flex flex-wrap gap-1.5 px-2 pb-1">
                          {albums.slice(0, 6).map((al) => (
                            <button
                              key={al.id}
                              onClick={() => {
                                onClose();
                                router.push(`/gallery?album_id=${al.id}`);
                              }}
                              className="px-3 py-1.5 rounded-full bg-black/[0.04] dark:bg-[#1C1C22] text-xs hover:bg-black/[0.08] dark:hover:bg-white/[0.12] transition-colors"
                            >
                              {al.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Commands */}
                    <div className="space-y-0.5">
                      {commands.map((cmd) => (
                        <button
                          key={cmd.id}
                          onClick={() => {
                            onClose();
                            cmd.action();
                          }}
                          className="w-full flex items-center justify-between px-3 py-2.5 rounded-2xl text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-[#1C1C22] transition-colors text-left group"
                        >
                          <span className="flex items-center gap-2.5">
                            <cmd.icon className="w-4 h-4 text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors" />
                            <span>{cmd.label}</span>
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
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
