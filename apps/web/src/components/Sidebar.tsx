'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Image as ImageIcon, Compass, FolderKanban, Stamp, KeyRound,
  Trash2, ShieldCheck, Upload, BarChart3, HardDrive, Globe, LogIn
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { formatBytes } from '@/lib/api';

interface SidebarProps {
  onOpenUpload: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenUpload }) => {
  const { user } = useAuth();
  const pathname = usePathname();

  const workspaceItems = user
    ? [
        { to: '/gallery', label: '画廊', icon: ImageIcon },
        { to: '/albums', label: '相册', icon: FolderKanban },
        { to: '/analytics', label: '数据统计', icon: BarChart3 },
        { to: '/trash', label: '回收站', icon: Trash2 },
      ]
    : [];

  const toolItems = user
    ? [
        { to: '/watermarks', label: '水印', icon: Stamp },
        { to: '/tokens', label: 'API', icon: KeyRound },
        { to: '/explore', label: '广场', icon: Compass },
        ...(user.role === 'admin' ? [{ to: '/admin', label: '管理后台', icon: ShieldCheck }] : []),
      ]
    : [{ to: '/explore', label: '广场', icon: Compass }];

  const quotaPct =
    user && user.storage_quota_bytes > 0
      ? Math.min(100, Math.round((user.storage_used_bytes / user.storage_quota_bytes) * 100))
      : 0;

  return (
    <aside className="hidden md:flex md:w-[72px] lg:w-60 shrink-0 flex-col sticky top-0 h-[100dvh] border-r border-black/[0.06] dark:border-white/[0.07] bg-white/80 dark:bg-[#0E0E12]/90 backdrop-blur-md z-30">
      {/* Brand */}
      <div className="h-16 px-3 lg:px-5 flex items-center justify-center lg:justify-start border-b border-black/[0.05] dark:border-white/[0.06]">
        <Link href={user ? '/gallery' : '/explore'} className="flex items-center gap-2.5 group">
          <img src="/logo.png" alt="Lumina" className="w-8 h-8 rounded-xl object-cover transition-transform group-hover:scale-105 shrink-0" />
          <div className="hidden lg:block leading-tight">
            <div className="font-semibold tracking-tight text-sm text-neutral-900 dark:text-neutral-100">Lumina</div>
          </div>
        </Link>
      </div>

      {/* Prominent Upload CTA */}
      <div className="p-3 lg:px-4 lg:pt-4 lg:pb-2">
        <button
          onClick={onOpenUpload}
          title="上传图片"
          className="w-full h-10 rounded-2xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-neutral-900 text-xs font-semibold flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-all"
        >
          <Upload className="w-4 h-4 shrink-0" />
          <span className="hidden lg:inline">上传图片</span>
        </button>
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 lg:px-3 py-2 space-y-5">
        {workspaceItems.length > 0 && (
          <div className="space-y-1">
            <div className="hidden lg:block px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              空间
            </div>
            {workspaceItems.map((item) => {
              const active = pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  href={item.to}
                  title={item.label}
                  className={`flex items-center justify-center lg:justify-start gap-2.5 px-2.5 lg:px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                    active
                      ? 'bg-neutral-900/[0.08] dark:bg-white/[0.1] text-neutral-900 dark:text-white'
                      : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden lg:inline truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="space-y-1">
          <div className="hidden lg:block px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            工具
          </div>
          {toolItems.map((item) => {
            const active = pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                href={item.to}
                title={item.label}
                className={`flex items-center justify-center lg:justify-start gap-2.5 px-2.5 lg:px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                  active
                    ? 'bg-neutral-900/[0.08] dark:bg-white/[0.1] text-neutral-900 dark:text-white'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden lg:inline truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Bottom Storage Quota Card (Desktop) or Login CTA */}
      <div className="p-2.5 lg:p-3.5 border-t border-black/[0.05] dark:border-white/[0.06]">
        {user ? (
          <div className="space-y-2.5">
            <div className="hidden lg:block p-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] dark:border-white/[0.06] space-y-2 text-[11px]">
              <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
                <span className="flex items-center gap-1.5 font-medium">
                  <HardDrive className="w-3.5 h-3.5" /> 存储空间
                </span>
                <span className="font-mono tabular-nums">{quotaPct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-black/[0.08] dark:bg-white/[0.1] overflow-hidden">
                <div
                  className="h-full rounded-full bg-neutral-900 dark:bg-white transition-all"
                  style={{ width: `${quotaPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 tabular-nums">
                <span>{formatBytes(user.storage_used_bytes)}</span>
                <span>{formatBytes(user.storage_quota_bytes)}</span>
              </div>
            </div>

            <Link
              href={`/u/${encodeURIComponent(user.username)}`}
              title="我的公开主页"
              className="flex items-center justify-center lg:justify-start gap-2 px-2.5 py-2 rounded-xl text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors"
            >
              <Globe className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline truncate">公开主页 /u/{user.username}</span>
            </Link>
          </div>
        ) : (
          <Link
            href="/login"
            title="登录账号"
            className="w-full py-2.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.09] text-xs font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <LogIn className="w-4 h-4 shrink-0" />
            <span className="hidden lg:inline">登录 / 注册</span>
          </Link>
        )}
      </div>
    </aside>
  );
};
