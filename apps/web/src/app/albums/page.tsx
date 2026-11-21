'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { FolderPlus, Trash2, Lock, Globe, EyeOff, ExternalLink, Pencil, Copy, Image as ImageIcon, X } from 'lucide-react';
import { api, formatAssetLinksBatch } from '@/lib/api';
import type { Album } from '@/types';
import { Protected } from '@/components/AppShell';
import { useToast } from '@/context/ToastContext';

function AlbumsContent() {
  const { toast } = useToast();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [password, setPassword] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);

  // Edit album modal state
  const [editing, setEditing] = useState<Album | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editVis, setEditVis] = useState('public');
  const [editPwd, setEditPwd] = useState('');
  const [editCover, setEditCover] = useState('');

  const load = () => api.listAlbums().then((r) => setAlbums(r.albums || []));
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.createAlbum({
        title: title.trim(),
        description,
        visibility,
        password,
        parent_id: parentId ? Number(parentId) : null,
      });
      toast('相册已创建');
      setTitle('');
      setDescription('');
      setPassword('');
      load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '创建失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (al: Album) => {
    setEditing(al);
    setEditTitle(al.title);
    setEditDesc(al.description || '');
    setEditVis(al.visibility);
    setEditPwd('');
    setEditCover(al.cover_short_code || '');
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      const payload: Record<string, unknown> = {
        title: editTitle.trim(),
        description: editDesc,
        visibility: editVis,
        cover_short_code: editCover.trim(),
      };
      if (editVis === 'password' && editPwd.trim()) {
        payload.password = editPwd.trim();
      }
      await api.updateAlbum(editing.id, payload);
      toast('相册已更新');
      setEditing(null);
      load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '更新失败', 'error');
    }
  };

  const copyAlbumMarkdown = async (al: Album) => {
    try {
      const res = await api.listAssets({ album_id: String(al.id), limit: '200' });
      const list = res.assets || [];
      if (list.length === 0) {
        toast('该相册暂无图片', 'error');
        return;
      }
      await navigator.clipboard.writeText(formatAssetLinksBatch(list, 'markdown'));
      toast(`已复制相册内 ${list.length} 张图片的 Markdown`);
    } catch {
      toast('导出相册链接失败', 'error');
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('确定删除该相册吗？（相册内图片不会删除，仅移回根目录）')) return;
    await api.deleteAlbum(id);
    toast('相册已删除');
    load();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">相册</h1>
      </div>

      <form
        onSubmit={create}
        className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs"
      >
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="相册名称..."
          className="px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述 (可选)"
          className="px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
        />
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
        >
          <option value="">顶级相册</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>父相册: {a.title}</option>
          ))}
        </select>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          className="px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
        >
          <option value="public">公开相册</option>
          <option value="unlisted">仅凭链接</option>
          <option value="private">私密</option>
          <option value="password">密码保护</option>
        </select>
        <button
          disabled={busy}
          type="submit"
          className="px-4 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <FolderPlus className="w-3.5 h-3.5" /> 创建相册
        </button>
        {visibility === 'password' && (
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="设置相册访问密码..."
            className="sm:col-span-2 lg:col-span-5 px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
          />
        )}
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {albums.map((al) => (
          <motion.div
            key={al.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl overflow-hidden bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] flex flex-col justify-between"
          >
            <Link href={`/gallery?album_id=${al.id}`} className="block h-36 bg-neutral-100 dark:bg-white/[0.04] overflow-hidden relative group">
              {al.cover_url ? (
                <img src={al.cover_url} alt={al.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-400">
                  <ImageIcon className="w-7 h-7 opacity-40" />
                </div>
              )}
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] bg-black/60 text-white backdrop-blur-md">
                {al.visibility === 'public' && <Globe className="w-3 h-3" />}
                {al.visibility === 'password' && <Lock className="w-3 h-3" />}
                {al.visibility === 'private' && <EyeOff className="w-3 h-3" />}
                {al.visibility}
              </span>
            </Link>

            <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
              <div className="space-y-1">
                <Link href={`/gallery?album_id=${al.id}`} className="font-semibold text-sm hover:underline block truncate">
                  {al.title}
                </Link>
                <p className="text-xs text-neutral-400 line-clamp-2">{al.description || '暂无简介'}</p>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-black/[0.05] dark:border-white/[0.06] text-xs">
                <span className="text-neutral-400 tabular-nums">{al.asset_count} 张</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => copyAlbumMarkdown(al)}
                    className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                    title="复制相册全部 Markdown"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openEdit(al)}
                    className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                    title="编辑相册与封面"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <Link
                    href={`/a/${al.slug}`}
                    className="px-2.5 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.07] hover:bg-black/[0.08] flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> 分享页
                  </Link>
                  <button
                    onClick={() => remove(al.id)}
                    className="p-1.5 rounded-full text-neutral-400 hover:text-rose-500 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Edit Album Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveEdit} className="w-full max-w-md p-6 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.08] dark:border-white/[0.08] shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">编辑相册</h2>
              <button type="button" onClick={() => setEditing(null)} className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">相册标题</label>
                <input required value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none" />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">简介</label>
                <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none" />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">封面图片短码（可选）</label>
                <input value={editCover} onChange={(e) => setEditCover(e.target.value)} placeholder="如 hero-banner 或 8位短码" className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] font-mono outline-none" />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">可见性</label>
                <select value={editVis} onChange={(e) => setEditVis(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none">
                  <option value="public">公开相册</option>
                  <option value="unlisted">仅凭链接</option>
                  <option value="private">私密</option>
                  <option value="password">密码保护</option>
                </select>
              </div>
              {editVis === 'password' && (
                <div>
                  <label className="text-[11px] text-neutral-400 block mb-1">访问密码（留空不修改）</label>
                  <input type="password" value={editPwd} onChange={(e) => setEditPwd(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06]">取消</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium">保存修改</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function AlbumsPage() {
  return (
    <Protected>
      <AlbumsContent />
    </Protected>
  );
}
