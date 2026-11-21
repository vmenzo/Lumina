'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck, Key, Laptop, Trash2, Save } from 'lucide-react';
import Link from 'next/link';
import { api, formatBytes } from '@/lib/api';
import { generateQRCodeDataURL } from '@/lib/qrcode';
import { Protected } from '@/components/AppShell';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

function ProfileContent() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();

  const [bio, setBio] = useState(user?.bio || '');
  const [publicProfile, setPublicProfile] = useState(user?.public_profile ?? true);
  const [defaultEngine, setDefaultEngine] = useState<'smart' | 'local' | 'r2'>(user?.default_engine || 'smart');
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [sessions, setSessions] = useState<Array<{ id: string; user_agent: string; ip_address: string; current: boolean; created_at: string }>>([]);

  useEffect(() => {
    if (user) {
      setBio(user.bio);
      setDefaultEngine(user.default_engine);
      setPublicProfile(user.public_profile);
    }
    api.listSessions().then((r) => setSessions(r.sessions || [])).catch(() => {});
  }, [user]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.updateProfile({ bio, default_engine: defaultEngine, public_profile: publicProfile });
    await refresh();
    toast('个人资料已更新');
  };

  const changePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.changePassword(curPwd, newPwd);
      setCurPwd('');
      setNewPwd('');
      toast('密码已修改');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '修改失败', 'error');
    }
  };

  const pct = user && user.storage_quota_bytes > 0 ? Math.min(100, (user.storage_used_bytes / user.storage_quota_bytes) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">个人中心与安全</h1>
        <p className="text-xs text-neutral-400 mt-1">资料、密码与安全设置</p>
      </div>

      {/* Quota Card */}
      {user && (
        <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{user.username} · <span className="uppercase text-neutral-400">{user.role}</span></span>
            <span className="tabular-nums text-neutral-500">
              {formatBytes(user.storage_used_bytes)} / {formatBytes(user.storage_quota_bytes)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-black/[0.05] dark:bg-white/[0.07] overflow-hidden">
            <div className="h-full rounded-full bg-neutral-900 dark:bg-white transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <form onSubmit={saveProfile} className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
          <div className="font-medium text-sm">基础偏好</div>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="个人简介..."
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
          />
          <select
            value={defaultEngine}
            onChange={(e) => setDefaultEngine(e.target.value as 'smart' | 'local' | 'r2')}
            className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
          >
            <option value="smart">默认智能路由</option>
            <option value="local">Local NVMe</option>
            <option value="r2">Cloudflare R2</option>
          </select>
          <label className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300 cursor-pointer">
            <input type="checkbox" checked={publicProfile} onChange={(e) => setPublicProfile(e.target.checked)} />
            <span>开启创作者公开主页 (/u/{user?.username})</span>
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> 保存设置
            </button>
            {user && (
              <Link href={`/u/${encodeURIComponent(user.username)}`} className="px-3.5 py-2 rounded-xl bg-black/[0.05] dark:bg-white/[0.08] font-medium">
                查看公开主页 →
              </Link>
            )}
          </div>
        </form>

        <form onSubmit={changePwd} className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
          <div className="font-medium text-sm flex items-center gap-1.5"><Key className="w-4 h-4" /> 修改密码</div>
          <input
            type="password"
            required
            value={curPwd}
            onChange={(e) => setCurPwd(e.target.value)}
            placeholder="当前密码"
            className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
          />
          <input
            type="password"
            required
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="新密码 (至少 6 位)"
            className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
          />
          <button type="submit" className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium">
            更新密码
          </button>
        </form>
      </div>

      {/* 2FA */}
      <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> 两步验证 (TOTP)
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] ${user?.totp_enabled ? 'bg-emerald-500/15 text-emerald-600' : 'bg-black/[0.05] dark:bg-white/[0.08] text-neutral-500'}`}>
            {user?.totp_enabled ? '已开启' : '未开启'}
          </span>
        </div>

        {!user?.totp_enabled ? (
          totpSetup ? (
            <div className="space-y-2.5 pt-2">
              <div className="flex flex-col sm:flex-row items-center gap-4 p-3 rounded-2xl bg-neutral-100 dark:bg-black/40">
                <img src={generateQRCodeDataURL(totpSetup.otpauth_url, 144)} alt="2FA QR" className="w-32 h-32 rounded-xl bg-white p-1.5 shrink-0" />
                <div className="space-y-1 min-w-0">
                  <div className="font-medium">使用 Google Authenticator / 1Password 扫码绑定</div>
                  <div className="font-mono text-[11px] text-neutral-400 break-all">手动密钥: {totpSetup.secret}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="输入验证器生成的 6 位数字"
                  className="flex-1 px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none font-mono"
                />
                <button
                  onClick={async () => {
                    try {
                      await api.verify2FA(totpCode, true);
                      await refresh();
                      setTotpSetup(null);
                      toast('2FA 已启用');
                    } catch (err: unknown) {
                      toast(err instanceof Error ? err.message : '验证失败', 'error');
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium"
                >
                  验证并启用
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={async () => setTotpSetup(await api.setup2FA())}
              className="px-4 py-2 rounded-xl bg-black/[0.05] dark:bg-white/[0.08] font-medium"
            >
              配置两步验证密钥
            </button>
          )
        ) : (
          <button
            onClick={async () => {
              await api.verify2FA('', false);
              await refresh();
              toast('2FA 已关闭');
            }}
            className="px-4 py-2 rounded-xl bg-rose-500/10 text-rose-500 font-medium"
          >
            关闭两步验证
          </button>
        )}
      </div>

      {/* Active Sessions */}
      <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
        <div className="font-medium text-sm flex items-center gap-1.5"><Laptop className="w-4 h-4" /> 活跃设备会话</div>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 rounded-2xl bg-neutral-50 dark:bg-white/[0.03]">
              <div className="min-w-0">
                <div className="font-medium truncate max-w-md">{s.user_agent || 'Unknown Client'}</div>
                <div className="text-[11px] text-neutral-400">
                  IP: {s.ip_address} {s.current && '· 当前设备'}
                </div>
              </div>
              {!s.current && (
                <button
                  onClick={async () => {
                    await api.revokeSession(s.id);
                    setSessions((prev) => prev.filter((x) => x.id !== s.id));
                    toast('已踢出设备');
                  }}
                  className="p-1.5 rounded-full text-neutral-400 hover:text-rose-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Protected>
      <ProfileContent />
    </Protected>
  );
}
