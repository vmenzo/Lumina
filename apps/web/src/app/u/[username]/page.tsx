'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Globe, FolderKanban, Eye, Image as ImageIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { Album, Asset, User } from '@/types';
import { JustifiedGrid } from '@/components/JustifiedGrid';
import { Lightbox } from '@/components/Lightbox';

export default function PublicUserProfilePage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params?.username || '');

  const [profile, setProfile] = useState<User | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [active, setActive] = useState<Asset | null>(null);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (!username) return;
    api
      .publicProfile(username)
      .then((res) => {
        setProfile(res.user);
        setAlbums(res.albums || []);
        setAssets(res.assets || []);
        setStats(res.stats || {});
      })
      .catch((e) => setErrMsg(e.message || '无法加载该用户主页'));
  }, [username]);

  if (errMsg) {
    return <div className="py-32 text-center text-xs text-neutral-400">{errMsg}</div>;
  }
  if (!profile) {
    return <div className="py-32 text-center text-xs text-neutral-400">正在加载主页...</div>;
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 space-y-8">
      <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center font-bold text-xl uppercase">
            {profile.username[0]}
          </div>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              {profile.username}
              <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-neutral-500">
                {profile.role}
              </span>
            </h1>
            <p className="text-xs text-neutral-400 mt-0.5">{profile.bio}</p>
          </div>
        </div>
        <div className="flex items-center gap-5 text-xs text-neutral-500">
          <span className="flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> {stats.public_assets ?? 0} 张公开图片</span>
          <span className="flex items-center gap-1.5"><FolderKanban className="w-3.5 h-3.5" /> {stats.public_albums ?? 0} 个公开相册</span>
          <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> {stats.total_views ?? 0} 次浏览</span>
        </div>
      </div>

      {albums.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5"><Globe className="w-4 h-4" /> 公开相册</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {albums.map((al) => (
              <Link
                key={al.id}
                href={`/a/${al.slug}`}
                className="rounded-2xl overflow-hidden bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] hover:border-neutral-400 transition-colors"
              >
                <div className="h-28 bg-neutral-100 dark:bg-white/[0.04]">
                  {al.cover_url && <img src={al.cover_url} alt={al.title} className="w-full h-full object-cover" />}
                </div>
                <div className="p-3 text-xs">
                  <div className="font-medium truncate">{al.title}</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">{al.asset_count} 张图片</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">公开作品</h2>
        {assets.length === 0 ? (
          <div className="py-20 text-center text-xs text-neutral-400">暂无公开图片</div>
        ) : (
          <JustifiedGrid assets={assets} onOpenLightbox={setActive} />
        )}
      </div>

      <Lightbox asset={active} assets={assets} onClose={() => setActive(null)} onSelect={setActive} />
    </div>
  );
}
