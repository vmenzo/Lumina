'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Image as ImageIcon, FolderKanban, Upload, Compass, BarChart3, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface MobileBottomNavProps {
  onOpenUpload: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onOpenUpload }) => {
  const { user } = useAuth();
  const pathname = usePathname();

  const leftItems = user
    ? [
        { to: '/gallery', label: '画廊', icon: ImageIcon },
        { to: '/albums', label: '相册', icon: FolderKanban },
      ]
    : [{ to: '/explore', label: '广场', icon: Compass }];

  const rightItems = user
    ? [
        { to: '/explore', label: '广场', icon: Compass },
        { to: '/analytics', label: '统计', icon: BarChart3 },
      ]
    : [{ to: '/login', label: '登录', icon: UserIcon }];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 px-3 pt-1.5 pb-safe bg-white/90 dark:bg-[#101014]/90 backdrop-blur-md border-t border-black/[0.07] dark:border-white/[0.08]">
      <div className="max-w-md mx-auto flex items-center justify-around">
        {leftItems.map((item) => {
          const active = pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              href={item.to}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-medium transition-colors ${
                active ? 'text-neutral-900 dark:text-white' : 'text-neutral-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <button
          onClick={onOpenUpload}
          className="-mt-4 w-12 h-12 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-lg flex items-center justify-center active:scale-95 transition-transform border-4 border-[#F9F9F8] dark:border-[#0A0A0C]"
          aria-label="上传图片"
        >
          <Upload className="w-5 h-5" />
        </button>

        {rightItems.map((item) => {
          const active = pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              href={item.to}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-medium transition-colors ${
                active ? 'text-neutral-900 dark:text-white' : 'text-neutral-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
