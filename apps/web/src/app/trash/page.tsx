'use client';

import React, { useEffect, useState } from 'react';
import { RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import { api, formatBytes } from '@/lib/api';
import type { Asset } from '@/types';
import { Protected } from '@/components/AppShell';
import { useToast } from '@/context/ToastContext';

function TrashContent() {
  const { toast } = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => api.listAssets({ trash: 'true' }).then((r) => setAssets(r.assets || []));
  useEffect(() => {
    load();
  }, []);

  const restore = async (id: number) => {
    await api.restoreAsset(id);
    toast('已还原至画廊');
    load();
  };

  const destroy = async (id: number) => {
    await api.deleteAsset(id, true);
    toast('已彻底删除');
    load();
  };

  const restoreAll = async () => {
    if (assets.length === 0) return;
    setBusy(true);
    try {
      const res = await api.batchAssets({ ids: assets.map((a) => a.id), action: 'restore' });
      toast(`已全部还原 ${res.processed} 张图片`);
      load();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '还原失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const emptyAll = async () => {
    if (assets.length === 0) return;
    if (!window.confirm(`确定彻底清空回收站中的 ${assets.length} 张图片吗？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      const res = await api.emptyTrash();
      toast(`已清空 ${res.deleted} 张图片，释放 ${formatBytes(res.freed_bytes)}`);
      load();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : '清空失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">回收站</h1>
          <p className="text-xs text-neutral-400 mt-1">文件保留 30 天后自动清理</p>
        </div>

        {assets.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <button
              disabled={busy}
              onClick={restoreAll}
              className="px-3.5 py-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.1] font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" /> 全部还原 ({assets.length})
            </button>
            <button
              disabled={busy}
              onClick={emptyAll}
              className="px-3.5 py-2 rounded-full bg-rose-500 text-white hover:bg-rose-600 font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              <AlertTriangle className="w-3.5 h-3.5" /> 一键清空回收站
            </button>
          </div>
        )}
      </div>

      {assets.length === 0 ? (
        <div className="py-24 text-center text-xs text-neutral-400">回收站是空的</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {assets.map((a) => (
            <div key={a.id} className="rounded-2xl overflow-hidden bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07]">
              <img src={a.thumb_url || a.direct_url} alt={a.original_name} className="w-full aspect-square object-cover opacity-80" />
              <div className="p-3 space-y-2 text-xs">
                <div className="font-medium truncate">{a.original_name}</div>
                <div className="text-[11px] text-neutral-400 tabular-nums">{formatBytes(a.size_bytes)}</div>
                <div className="flex gap-1.5 pt-1">
                  <button
                    onClick={() => restore(a.id)}
                    className="flex-1 py-1.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.1] flex items-center justify-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> 还原
                  </button>
                  <button
                    onClick={() => destroy(a.id)}
                    className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                    title="彻底删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RecycleBinPage() {
  return (
    <Protected>
      <TrashContent />
    </Protected>
  );
}
