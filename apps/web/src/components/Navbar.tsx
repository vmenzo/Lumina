'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Image as ImageIcon, Compass, FolderKanban, Stamp, KeyRound,
  Trash2, ShieldCheck, Upload, Sun, Moon, Search, User as UserIcon, LogOut, BarChart3, Globe
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

interface NavbarProps {
  onOpenUpload: () => void;
  onOpenCommand: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenUpload, onOpenCommand }) => {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const router = useRouter();

  const mobileNavItems = user
    ? [
        { to: '/gallery', label: '我的画廊', icon: ImageIcon },
        { to: '/albums', label: '多级相册', icon: FolderKanban },
        { to: '/analytics', label: '数据统计', icon: BarChart3 },
        { to: '/watermarks', label: '水印工坊', icon: Stamp },
        { to: '/tokens', label: 'API 与客户端', icon: KeyRound },
        { to: '/trash', label: '回收站', icon: Trash2 },
        ...(user.role === 'admin' ? [{ to: '/admin', label: '管理后台', icon: ShieldCheck }] : []),
        { to: '/explore', label: '探索广场', icon: Compass },
      ]
    : [{ to: '/explore', label: '探索广场', icon: Compass }];

  return (
    <header className="h-14 sm:h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
      {/* Mobile Brand (hidden on md+ where Sidebar shows Brand) */}
      <Link href={user ? '/gallery' : '/explore'} className="flex md:hidden items-center gap-2 shrink-0">
        <img src="/logo.png" alt="Lumina" className="w-7 h-7 rounded-lg object-cover shrink-0" />
        <span className="font-semibold tracking-tight text-sm text-neutral-900 dark:text-neutral-100">Lumina</span>
      </Link>

      {/* Global Search Trigger (Clean & Uncluttered) */}
      <button
        onClick={onOpenCommand}
        className="flex-1 max-w-md flex items-center justify-between gap-2 px-3.5 py-2 rounded-2xl bg-black/[0.04] dark:bg-white/[0.05] hover:bg-black/[0.07] dark:hover:bg-white/[0.08] border border-black/[0.04] dark:border-white/[0.06] text-xs text-neutral-500 dark:text-neutral-400 transition-colors"
      >
        <span className="flex items-center gap-2 truncate">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">搜索...</span>
        </span>
        <kbd className="hidden sm:inline font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-white dark:bg-white/[0.08] text-neutral-500 dark:text-neutral-400 shrink-0">
          ⌘K
        </kbd>
      </button>

      {/* Right Utility Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          onClick={onOpenUpload}
          className="hidden sm:flex md:hidden px-3.5 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-medium items-center gap-1.5"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>上传</span>
        </button>

        <button
          onClick={toggle}
          className="p-2 rounded-xl text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
          title="切换深浅模式"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {user ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-xs font-medium outline-none transition-colors">
                <div className="w-7 h-7 rounded-full bg-neutral-900/10 dark:bg-white/15 text-neutral-800 dark:text-neutral-100 flex items-center justify-center font-semibold uppercase text-xs">
                  {user.username[0]}
                </div>
                <span className="hidden sm:inline text-neutral-700 dark:text-neutral-200">{user.username}</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={8}
                align="end"
                className="z-50 min-w-[200px] p-1.5 rounded-2xl bg-white/95 dark:bg-[#16161A]/95 backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] shadow-xl text-xs"
              >
                <div className="px-2.5 py-1.5 text-[11px] text-neutral-400 border-b border-black/[0.05] dark:border-white/[0.06] mb-1">
                  {user.username} · <span className="uppercase">{user.role}</span>
                </div>
                <div className="md:hidden">
                  {mobileNavItems.map((item) => (
                    <DropdownMenu.Item
                      key={item.to}
                      onSelect={() => router.push(item.to)}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer outline-none hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                      <item.icon className="w-3.5 h-3.5 text-neutral-400" />
                      <span>{item.label}</span>
                    </DropdownMenu.Item>
                  ))}
                  <DropdownMenu.Separator className="my-1 h-px bg-black/[0.05] dark:bg-white/[0.06]" />
                </div>
                <DropdownMenu.Item
                  onSelect={() => router.push(`/u/${encodeURIComponent(user.username)}`)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer outline-none hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                  <Globe className="w-3.5 h-3.5 text-neutral-400" />
                  <span>我的公开主页</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => router.push('/profile')}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer outline-none hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                  <UserIcon className="w-3.5 h-3.5 text-neutral-400" />
                  <span>个人中心与安全</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={async () => {
                    await logout();
                    router.push('/login');
                  }}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer outline-none text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>退出登录</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <Link
            href="/login"
            className="px-3.5 py-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-xs font-medium hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-1.5 transition-colors"
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>登录</span>
          </Link>
        )}
      </div>
    </header>
  );
};
