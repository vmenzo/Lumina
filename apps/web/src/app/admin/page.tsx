'use client';

import React, { useCallback, useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ShieldCheck, Users, Layers, Ticket, Settings, ScrollText,
  Sparkles, Ban, CheckCircle2, Trash2, Save, ShieldAlert
} from 'lucide-react';
import { api, formatBytes, type AnalyticsTrendPoint } from '@/lib/api';
import type { Asset, AuditLog, InviteCode, RolePolicy, User } from '@/types';
import { Protected } from '@/components/AppShell';
import { useToast } from '@/context/ToastContext';

function AdminContent() {
  const { toast } = useToast();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState<Record<string, number>>({});
  const [queueInfo, setQueueInfo] = useState<Record<string, unknown>>({});
  const [siteTrend, setSiteTrend] = useState<AnalyticsTrendPoint[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [policies, setPolicies] = useState<RolePolicy[]>([]);
  const [modItems, setModItems] = useState<Asset[]>([]);
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [general, setGeneral] = useState<Record<string, unknown>>({});
  const [security, setSecurity] = useState<Record<string, unknown>>({ referer_mode: 'off', referer_list: [] });
  const [refererText, setRefererText] = useState('');
  const [ipBlacklistText, setIpBlacklistText] = useState('');
  const [storageProfiles, setStorageProfiles] = useState<Array<{ id: number; name: string; provider: string; endpoint: string; region: string; bucket: string; access_key_id: string; public_url: string; is_active: boolean; is_default: boolean }>>([]);
  const [spName, setSpName] = useState('');
  const [spProvider, setSpProvider] = useState('r2');
  const [spEndpoint, setSpEndpoint] = useState('');
  const [spBucket, setSpBucket] = useState('');
  const [spAk, setSpAk] = useState('');
  const [spSk, setSpSk] = useState('');
  const [spPub, setSpPub] = useState('');

  const loadAll = useCallback(async () => {
    const [d, u, p, m, inv, s, l] = await Promise.all([
      api.adminDashboard(),
      api.adminUsers(),
      api.adminPolicies(),
      api.adminModeration('pending'),
      api.adminInvites(),
      api.adminSettings(),
      api.adminLogs(),
    ]);
    setStats(d.stats || {});
    setQueueInfo(d.queue || {});
    setUsers(u.users || []);
    setPolicies(p.policies || []);
    setModItems(m.items || []);
    setInvites(inv.invites || []);
    setGeneral(s.general || {});
    const sec = s.security || { referer_mode: 'off', referer_list: [] };
    setSecurity(sec);
    const list = Array.isArray(sec.referer_list) ? (sec.referer_list as string[]) : [];
    setRefererText(list.join('\n'));
    const ips = Array.isArray(sec.ip_blacklist) ? (sec.ip_blacklist as string[]) : [];
    setIpBlacklistText(ips.join('\n'));
    setLogs(l.logs || []);
    api.adminStorageProfiles().then((r) => setStorageProfiles(r.profiles || [])).catch(() => {});
    api.adminAnalytics().then((r) => setSiteTrend(r.trend || [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadAll().catch((e) => toast(e.message, 'error'));
  }, [loadAll, toast]);

  const updatePolicyField = (role: string, patch: Partial<RolePolicy>) => {
    setPolicies((prev) => prev.map((p) => (p.role === role ? { ...p, ...patch } : p)));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">管理后台</h1>
          <p className="text-xs text-neutral-400 mt-1">系统概览、用户与策略管理</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                const r = await api.adminTestStorage();
                toast(`存储引擎连通性检测完成 (${r.elapsed_ms}ms)`);
                loadAll();
              } catch (e: unknown) {
                toast(e instanceof Error ? e.message : '存储检测失败', 'error');
              }
            }}
            className="px-3.5 py-2 rounded-full bg-black/[0.06] dark:bg-white/[0.08] text-xs font-medium"
          >
            测试存储连通性
          </button>
        <button
          onClick={async () => {
            const r = await api.adminRunGC();
            toast(`GC 完成: 清理过期 ${r.gc_result.expired_assets || 0} / 物理对象 ${r.gc_result.gc_objects || 0}`);
            loadAll();
          }}
          className="px-4 py-2 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-medium flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" /> 立即执行 CAS GC
        </button>
        </div>
      </div>

      <Tabs.Root value={tab} onValueChange={setTab} className="space-y-6">
        <Tabs.List className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl bg-black/[0.04] dark:bg-[#131317] border border-black/[0.05] dark:border-white/[0.07] text-xs">
          {[
            { id: 'overview', label: '概览与队列', icon: ShieldCheck },
            { id: 'users', label: '用户管理', icon: Users },
            { id: 'policies', label: '角色策略矩阵', icon: Layers },
            { id: 'moderation', label: `审核队列 (${modItems.length})`, icon: Ban },
            { id: 'invites', label: '邀请码', icon: Ticket },
            { id: 'settings', label: '站点与防盗链', icon: Settings },
            { id: 'logs', label: '审计日志', icon: ScrollText },
          ].map((t) => (
            <Tabs.Trigger
              key={t.id}
              value={t.id}
              className="px-3.5 py-2 rounded-xl font-medium flex items-center gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-[#1C1C22] data-[state=active]:shadow-sm transition-all"
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview" className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: '注册用户', val: stats.total_users ?? 0 },
              { label: '活跃图片资产', val: stats.total_assets ?? 0 },
              { label: '物理对象数', val: stats.total_objects ?? 0 },
              { label: 'CAS 去重节省', val: formatBytes(stats.saved_bytes ?? 0) },
              { label: 'Local NVMe 占用', val: formatBytes(stats.local_bytes ?? 0) },
              { label: 'Cloudflare R2 占用', val: formatBytes(stats.r2_bytes ?? 0) },
              { label: '累计浏览量', val: stats.total_views ?? 0 },
              { label: '待审核对象', val: stats.pending_mod ?? 0 },
            ].map((c) => (
              <div key={c.label} className="p-4 rounded-2xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07]">
                <div className="text-[11px] text-neutral-400">{c.label}</div>
                <div className="text-lg font-semibold font-mono mt-1 tabular-nums">{c.val}</div>
              </div>
            ))}
          </div>
          {siteTrend.length > 0 && (
            <div className="p-5 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">全站近 14 天上传与访问趋势</span>
                <div className="flex items-center gap-3 text-[11px] text-neutral-400">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-neutral-900 dark:bg-white inline-block" /> 浏览</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> 上传</span>
                </div>
              </div>
              <div className="flex items-end justify-between gap-1 sm:gap-2 h-36 pt-2 overflow-x-auto no-scrollbar">
                {siteTrend.map((pt) => {
                  const maxV = Math.max(1, ...siteTrend.map((x) => x.views));
                  const maxU = Math.max(1, ...siteTrend.map((x) => x.uploads));
                  return (
                    <div key={pt.date} className="flex-1 min-w-[18px] flex flex-col items-center gap-1 h-full justify-end">
                      <div className="w-full flex items-end justify-center gap-0.5 flex-1">
                        <div title={`${pt.date} 浏览: ${pt.views}`} style={{ height: `${Math.max(4, Math.round((pt.views / maxV) * 100))}%` }} className="w-2 rounded-t bg-neutral-900/80 dark:bg-white/80" />
                        <div title={`${pt.date} 上传: ${pt.uploads}`} style={{ height: `${Math.max(4, Math.round((pt.uploads / maxU) * 100))}%` }} className="w-2 rounded-t bg-emerald-500/85" />
                      </div>
                      <span className="text-[9px] font-mono text-neutral-400">{pt.date.slice(3)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-5 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] text-xs space-y-2">
            <div className="font-medium">Asynq (Redis 7) 异步队列状态</div>
            <pre className="p-3 rounded-xl bg-neutral-100 dark:bg-black/40 font-mono text-[11px] overflow-x-auto">
              {JSON.stringify(queueInfo, null, 2)}
            </pre>
          </div>
        </Tabs.Content>

        <Tabs.Content value="users">
          <div className="rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="border-b border-black/[0.05] dark:border-white/[0.06] text-neutral-400">
                <tr>
                  <th className="p-4">用户</th>
                  <th className="p-4">角色</th>
                  <th className="p-4">已用 / 配额</th>
                  <th className="p-4">状态</th>
                  <th className="p-4">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="p-4">
                      <div className="font-medium">{u.username}</div>
                      <div className="text-[11px] text-neutral-400">{u.email}</div>
                    </td>
                    <td className="p-4">
                      <select
                        value={u.role}
                        onChange={async (e) => {
                          await api.adminUpdateUser(u.id, { role: e.target.value, status: u.status });
                          toast('角色已更新');
                          loadAll();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-[#1C1C22]"
                      >
                        <option value="user">user</option>
                        <option value="pro">pro</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="p-4 font-mono tabular-nums">
                      {formatBytes(u.storage_used_bytes)} / {formatBytes(u.storage_quota_bytes)}
                    </td>
                    <td className="p-4">{u.status}</td>
                    <td className="p-4">
                      <button
                        onClick={async () => {
                          await api.adminUpdateUser(u.id, { role: u.role, status: u.status === 'active' ? 'banned' : 'active' });
                          toast('状态已更新');
                          loadAll();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-black/[0.05] dark:bg-[#1C1C22]"
                      >
                        {u.status === 'active' ? '封禁' : '解封'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        {/* Editable Role Policy Matrix */}
        <Tabs.Content value="policies" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {policies.map((p) => (
            <div key={p.role} className="p-5 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
              <div className="flex items-center justify-between font-semibold text-sm">
                <span>{p.display_name} ({p.role})</span>
                <button
                  onClick={async () => {
                    await api.adminUpdatePolicy(p.role, p);
                    toast(`已保存 ${p.display_name} 策略`);
                    loadAll();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-medium flex items-center gap-1"
                >
                  <Save className="w-3 h-3" /> 保存
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] text-neutral-400 block mb-1">存储配额 (GB)</label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.5}
                    value={Number((p.storage_quota_bytes / 1024 / 1024 / 1024).toFixed(2))}
                    onChange={(e) => updatePolicyField(p.role, { storage_quota_bytes: Math.round(Number(e.target.value) * 1024 * 1024 * 1024) })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-neutral-400 block mb-1">单文件上限 (MB)</label>
                  <input
                    type="number"
                    min={1}
                    value={Math.round(p.max_file_size_bytes / 1024 / 1024)}
                    onChange={(e) => updatePolicyField(p.role, { max_file_size_bytes: Math.round(Number(e.target.value) * 1024 * 1024) })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-neutral-400 block mb-1">每分钟限流 (req/min)</label>
                  <input
                    type="number"
                    min={1}
                    value={p.rate_limit_per_min}
                    onChange={(e) => updatePolicyField(p.role, { rate_limit_per_min: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-neutral-400 block mb-1">月度上传上限 (0=不限)</label>
                  <input
                    type="number"
                    min={0}
                    value={p.monthly_upload_limit ?? 0}
                    onChange={(e) => updatePolicyField(p.role, { monthly_upload_limit: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-neutral-400 block mb-1">默认存储引擎</label>
                  <select
                    value={p.default_engine}
                    onChange={(e) => updatePolicyField(p.role, { default_engine: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-[#1C1C22] outline-none"
                  >
                    <option value="smart">smart</option>
                    <option value="local">local</option>
                    <option value="r2">r2</option>
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.require_moderation}
                      onChange={(e) => updatePolicyField(p.role, { require_moderation: e.target.checked })}
                    />
                    <span>强制先审后发</span>
                  </label>
                </div>
              </div>
            </div>
          ))}
        </Tabs.Content>

        <Tabs.Content value="moderation" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {modItems.length === 0 ? (
            <div className="col-span-full py-16 text-center text-xs text-neutral-400">当前无待审核图片</div>
          ) : (
            modItems.map((m) => (
              <div key={m.id} className="rounded-2xl overflow-hidden bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07]">
                <img src={m.thumb_url || m.direct_url} alt={m.original_name} className="w-full h-48 object-cover" />
                <div className="p-3.5 space-y-2 text-xs">
                  <div className="font-medium truncate">{m.original_name}</div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await api.adminModerateAction(m.object_id, 'pass');
                        toast('已放行');
                        loadAll();
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-600 flex items-center justify-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> 放行
                    </button>
                    <button
                      onClick={async () => {
                        await api.adminModerateAction(m.object_id, 'block', '违规内容');
                        toast('已封禁 SHA-256 并触发 Asynq CDN Purge');
                        loadAll();
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-rose-500/15 text-rose-500 flex items-center justify-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> 封禁
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </Tabs.Content>

        <Tabs.Content value="invites" className="space-y-4 text-xs">
          <button
            onClick={async () => {
              await api.adminCreateInvites(5, 'user', 1, 30);
              toast('已生成 5 枚邀请码');
              loadAll();
            }}
            className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium"
          >
            批量生成 5 枚邀请码
          </button>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {invites.map((c) => (
              <div key={c.id} className="p-4 rounded-2xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] flex justify-between">
                <span className="font-mono font-medium">{c.code}</span>
                <span className="text-neutral-400 font-mono">{c.used_count}/{c.max_uses} · {c.role}</span>
              </div>
            ))}
          </div>
        </Tabs.Content>

        {/* General + Referer Security Settings */}
        <Tabs.Content value="settings" className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="p-6 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] space-y-4">
            <div className="font-semibold text-sm">基础站点配置</div>
            <div className="space-y-3">
              <input
                value={String(general.site_name || '')}
                onChange={(e) => setGeneral({ ...general, site_name: e.target.value })}
                placeholder="站点名称"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none"
              />
              <input
                value={String(general.site_subtitle || '')}
                onChange={(e) => setGeneral({ ...general, site_subtitle: e.target.value })}
                placeholder="站点副标题"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none"
              />
              <input
                value={String(general.site_announcement || '')}
                onChange={(e) => setGeneral({ ...general, site_announcement: e.target.value })}
                placeholder="全站顶部公告条（留空则隐藏）"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none"
              />
              <input
                value={String(general.site_icp || '')}
                onChange={(e) => setGeneral({ ...general, site_icp: e.target.value })}
                placeholder="页脚 ICP 备案号 / 自定义版权文字（可选）"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(general.allow_registration)}
                  onChange={(e) => setGeneral({ ...general, allow_registration: e.target.checked })}
                />
                允许新用户注册
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(general.require_invite_code)}
                  onChange={(e) => setGeneral({ ...general, require_invite_code: e.target.checked })}
                />
                注册需邀请码
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(general.allow_guest_upload)}
                  onChange={(e) => setGeneral({ ...general, allow_guest_upload: e.target.checked })}
                />
                允许游客上传
              </label>
            </div>
            <button
              onClick={async () => {
                await api.adminSaveSetting('general', general);
                toast('站点配置已保存');
              }}
              className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium"
            >
              保存基础配置
            </button>
          </div>

          <div className="p-6 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] space-y-4">
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" /> 防盗链策略 (Referer Policy)
            </div>
            <div>
              <label className="text-[11px] text-neutral-400 block mb-1">校验模式</label>
              <select
                value={String(security.referer_mode || 'off')}
                onChange={(e) => setSecurity({ ...security, referer_mode: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none"
              >
                <option value="off">关闭防盗链</option>
                <option value="whitelist">白名单模式 (仅允许列表内域名引用)</option>
                <option value="blacklist">黑名单模式 (拦截列表内域名引用)</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-neutral-400 block mb-1">域名列表（每行一个）</label>
              <textarea
                rows={4}
                value={refererText}
                onChange={(e) => setRefererText(e.target.value)}
                placeholder={'yourdomain.com\nblog.yourdomain.com'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none"
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(security.block_empty_referer)}
                onChange={(e) => setSecurity({ ...security, block_empty_referer: e.target.checked })}
              />
              拦截空 Referer
            </label>
            <div>
              <label className="text-[11px] text-neutral-400 block mb-1">IP 黑名单（每行一个 IP）</label>
              <textarea
                rows={3}
                value={ipBlacklistText}
                onChange={(e) => setIpBlacklistText(e.target.value)}
                placeholder={'1.2.3.4\n5.6.7.8'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none"
              />
            </div>
            <button
              onClick={async () => {
                const domains = refererText
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                const ipList = ipBlacklistText
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                await api.adminSaveSetting('security', { ...security, referer_list: domains, ip_blacklist: ipList });
                toast('防盗链与 IP 黑名单策略已保存并立即生效');
              }}
              className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium"
            >
              保存安全风控配置
            </button>
          </div>

          <div className="p-6 rounded-3xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">外部存储策略组 (S3 / R2 / OSS / COS)</div>
              <button
                onClick={async () => {
                  try {
                    const r = await api.adminTestMail();
                    toast(`SMTP 测试邮件已发送至 ${r.to}`);
                  } catch (e: unknown) {
                    toast(e instanceof Error ? e.message : 'SMTP 未配置或发送失败', 'error');
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-black/[0.06] dark:bg-white/[0.08] font-medium"
              >
                发送 SMTP 测试邮件
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input value={spName} onChange={(e) => setSpName(e.target.value)} placeholder="策略名 (如 aliyun-oss)" className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none" />
              <select value={spProvider} onChange={(e) => setSpProvider(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none">
                <option value="r2">Cloudflare R2</option>
                <option value="oss">阿里云 OSS</option>
                <option value="cos">腾讯云 COS</option>
                <option value="minio">MinIO</option>
                <option value="s3">AWS S3 / Backblaze B2</option>
              </select>
              <input value={spBucket} onChange={(e) => setSpBucket(e.target.value)} placeholder="Bucket 名称" className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none" />
              <input value={spEndpoint} onChange={(e) => setSpEndpoint(e.target.value)} placeholder="Endpoint (https://...)" className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none" />
              <input value={spAk} onChange={(e) => setSpAk(e.target.value)} placeholder="Access Key ID" className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none" />
              <input type="password" value={spSk} onChange={(e) => setSpSk(e.target.value)} placeholder="Secret Access Key" className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none" />
              <input value={spPub} onChange={(e) => setSpPub(e.target.value)} placeholder="自定义公开访问域名 (可选)" className="sm:col-span-2 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none" />
              <button
                onClick={async () => {
                  try {
                    await api.adminSaveStorageProfile({
                      name: spName,
                      provider: spProvider,
                      endpoint: spEndpoint,
                      bucket: spBucket,
                      access_key_id: spAk,
                      secret_access_key: spSk,
                      public_url: spPub,
                      is_active: true,
                    });
                    toast('存储策略组已保存');
                    setSpName(''); setSpBucket(''); setSpEndpoint(''); setSpAk(''); setSpSk(''); setSpPub('');
                    loadAll();
                  } catch (e: unknown) {
                    toast(e instanceof Error ? e.message : '保存失败', 'error');
                  }
                }}
                className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium"
              >
                添加存储桶策略
              </button>
            </div>
            {storageProfiles.length > 0 && (
              <div className="space-y-2 pt-2">
                {storageProfiles.map((sp) => (
                  <div key={sp.id} className="p-3 rounded-2xl bg-neutral-100 dark:bg-[#1C1C22] flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{sp.name} <span className="uppercase text-[10px] text-neutral-400">({sp.provider})</span></div>
                      <div className="text-[11px] font-mono text-neutral-400 truncate">{sp.bucket} · {sp.endpoint}</div>
                    </div>
                    <button
                      onClick={async () => {
                        await api.adminDeleteStorageProfile(sp.id);
                        toast('已删除策略组');
                        loadAll();
                      }}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Tabs.Content>

        <Tabs.Content value="logs" className="space-y-2 text-xs">
          {logs.map((l) => (
            <div key={l.id} className="p-3.5 rounded-2xl bg-white dark:bg-[#131317] border border-black/[0.06] dark:border-white/[0.07] flex items-center justify-between gap-3">
              <div>
                <span className="font-medium">{l.username}</span> · <span className="font-mono text-neutral-500">{l.action}</span>
                <span className="text-neutral-400 ml-2">({l.target_type}:{l.target_id})</span>
              </div>
              <span className="text-[11px] font-mono text-neutral-400 tabular-nums">{new Date(l.created_at).toLocaleString()}</span>
            </div>
          ))}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Protected adminOnly>
      <AdminContent />
    </Protected>
  );
}
