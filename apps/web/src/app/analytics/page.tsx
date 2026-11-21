'use client';

import React, { useEffect, useState } from 'react';
import { BarChart3, Eye, Image as ImageIcon, FolderKanban, HardDrive, TrendingUp } from 'lucide-react';
import { api, formatBytes, type AnalyticsTrendPoint, type MimeBreakdown } from '@/lib/api';
import type { Asset } from '@/types';
import { Protected } from '@/components/AppShell';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

function AnalyticsContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [mimes, setMimes] = useState<MimeBreakdown[]>([]);
  const [trend, setTrend] = useState<AnalyticsTrendPoint[]>([]);
  const [topAssets, setTopAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .myAnalytics()
      .then((res) => {
        setSummary(res.summary || {});
        setMimes(res.mime_breakdown || []);
        setTrend(res.trend || []);
        setTopAssets(res.top_assets || []);
      })
      .catch((e) => toast(e.message || '加载统计数据失败', 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  const maxViews = Math.max(1, ...trend.map((t) => t.views));
  const maxUploads = Math.max(1, ...trend.map((t) => t.uploads));
  const totalBytes = (summary.local_bytes || 0) + (summary.r2_bytes || 0);
  const quotaPct = user && user.storage_quota_bytes > 0 ? Math.min(100, Math.round((user.storage_used_bytes / user.storage_quota_bytes) * 100)) : 0;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart3 className="w-5 h-5" /> 数据统计
        </h1>
        
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-black/[0.04] dark:bg-[#131317] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: '活跃图片总数', val: summary.total_assets ?? 0, icon: ImageIcon },
              { label: '累计外链浏览', val: summary.total_views ?? 0, icon: Eye },
              { label: '相册数量', val: summary.total_albums ?? 0, icon: FolderKanban },
              { label: '总存储占用', val: formatBytes(totalBytes), icon: HardDrive },
            ].map((c) => (
              <div key={c.label} className="p-4 rounded-2xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07]">
                <div className="flex items-center justify-between text-[11px] text-neutral-400">
                  <span>{c.label}</span>
                  <c.icon className="w-3.5 h-3.5" />
                </div>
                <div className="text-xl font-semibold font-mono mt-1.5 tabular-nums">{c.val}</div>
              </div>
            ))}
          </div>

          {/* Quota & Dual-Engine Storage Bar */}
          {user && (
            <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">存储空间</span>
                <span className="font-mono text-neutral-400 tabular-nums">
                  {formatBytes(user.storage_used_bytes)} / {formatBytes(user.storage_quota_bytes)} ({quotaPct}%)
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden">
                <div className="h-full bg-neutral-900 dark:bg-white transition-all" style={{ width: `${quotaPct}%` }} />
              </div>
              <div className="flex flex-wrap gap-4 text-[11px] text-neutral-500">
                <span>Local NVMe: <strong className="font-mono text-neutral-800 dark:text-neutral-200">{formatBytes(summary.local_bytes || 0)}</strong></span>
                <span>Cloudflare R2: <strong className="font-mono text-neutral-800 dark:text-neutral-200">{formatBytes(summary.r2_bytes || 0)}</strong></span>
                <span>回收站待清理: <strong className="font-mono text-neutral-800 dark:text-neutral-200">{summary.trash_count || 0} 张</strong></span>
              </div>
            </div>
          )}

          {/* 14-Day Trend Chart */}
          <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium flex items-center gap-1.5"><TrendingUp className="w-4 h-4" /> 近 14 天上传与浏览趋势</span>
              <div className="flex items-center gap-3 text-[11px] text-neutral-400">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-neutral-900 dark:bg-white inline-block" /> 浏览量</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> 上传数</span>
              </div>
            </div>
            <div className="flex items-end justify-between gap-1 sm:gap-2 h-44 pt-4 overflow-x-auto no-scrollbar">
              {trend.map((pt) => (
                <div key={pt.date} className="flex-1 min-w-[18px] flex flex-col items-center gap-1 h-full justify-end group">
                  <div className="w-full flex items-end justify-center gap-0.5 flex-1">
                    <div
                      title={`${pt.date} 浏览: ${pt.views}`}
                      style={{ height: `${Math.max(4, Math.round((pt.views / maxViews) * 100))}%` }}
                      className="w-2 rounded-t bg-neutral-900/80 dark:bg-white/80 transition-all"
                    />
                    <div
                      title={`${pt.date} 上传: ${pt.uploads}`}
                      style={{ height: `${Math.max(4, Math.round((pt.uploads / maxUploads) * 100))}%` }}
                      className="w-2 rounded-t bg-emerald-500/85 transition-all"
                    />
                  </div>
                  <span className="text-[9px] font-mono text-neutral-400">{pt.date.slice(3)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Format Breakdown */}
            <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
              <div className="font-medium">图片格式分布</div>
              {mimes.length === 0 ? (
                <div className="text-neutral-400 py-8 text-center">暂无数据</div>
              ) : (
                <div className="space-y-2.5">
                  {mimes.map((m) => (
                    <div key={m.mime} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-neutral-600 dark:text-neutral-300">{m.mime}</span>
                      <span className="font-mono text-neutral-400 tabular-nums">
                        {m.count} 张 · {formatBytes(m.bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top 5 Popular Images */}
            <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
              <div className="font-medium">热门访问排行 (Top 5)</div>
              {topAssets.length === 0 ? (
                <div className="text-neutral-400 py-8 text-center">暂无图片</div>
              ) : (
                <div className="space-y-2">
                  {topAssets.map((a) => (
                    <a
                      key={a.id}
                      href={a.share_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img src={a.thumb_url || a.direct_url} alt={a.original_name} className="w-9 h-9 rounded-lg object-cover shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{a.original_name}</div>
                          <div className="text-[10px] text-neutral-400 font-mono">{formatBytes(a.size_bytes)}</div>
                        </div>
                      </div>
                      <span className="font-mono text-neutral-500 flex items-center gap-1 shrink-0">
                        <Eye className="w-3 h-3" /> {a.view_count}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Protected>
      <AnalyticsContent />
    </Protected>
  );
}
