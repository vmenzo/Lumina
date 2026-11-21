'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import * as Tabs from '@radix-ui/react-tabs';
import { KeyRound, ShieldCheck, Compass, Sun, Moon } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';

function LoginForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [need2FA, setNeed2FA] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPwd, setResetNewPwd] = useState('');
  const [busy, setBusy] = useState(false);

  const { setSession, refresh } = useAuth();
  const { dark, toggle } = useTheme();
  const { toast } = useToast();
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const oauthTok = sp.get('oauth_token');
    const oauthErr = sp.get('error');
    if (oauthTok) {
      setToken(oauthTok);
      refresh().then(() => {
        toast('OAuth 登录成功');
        router.replace('/gallery');
      });
    } else if (oauthErr) {
      toast(`OAuth 登录失败: ${oauthErr}`, 'error');
    }
  }, [sp, refresh, router, toast]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') {
        const res = await api.login(identifier, password, totpCode);
        if (res.require_2fa) {
          setNeed2FA(true);
          toast(res.message || '请输入 6 位两步验证码', 'info');
          return;
        }
        if (res.token && res.user) {
          await setSession(res.token, res.user);
          toast(`欢迎回来，${res.user.username}`);
          router.push('/gallery');
        }
      } else {
        const res = await api.register(username, email, password, inviteCode);
        await setSession(res.token, res.user);
        toast('注册成功，已登录');
        router.push('/gallery');
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-[100dvh] flex flex-col justify-between overflow-hidden px-4 py-6 sm:px-8">
      {/* Subtle Ambient Glow */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(120,120,160,0.16) 0%, transparent 55%)',
        }}
      />

      {/* Minimal Top Utility Bar (Only Brand + Explore + Theme Toggle) */}
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <Link href="/explore" className="flex items-center gap-2.5 group">
          <img src="/logo.png" alt="Lumina" className="w-8 h-8 rounded-xl object-cover group-hover:scale-105 transition-transform" />
          <span className="font-semibold tracking-tight text-sm">Lumina</span>
        </Link>

        <div className="flex items-center gap-2 text-xs">
          <Link
            href="/explore"
            className="px-3.5 py-2 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-neutral-600 dark:text-neutral-300 font-medium flex items-center gap-1.5 transition-colors"
          >
            <Compass className="w-3.5 h-3.5" /> 探索广场
          </Link>
          <button
            type="button"
            onClick={toggle}
            className="p-2 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-neutral-600 dark:text-neutral-300 transition-colors"
            title="切换深浅模式"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Centered Auth Card */}
      <div className="flex-1 flex items-center justify-center py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="w-full max-w-[400px] p-7 sm:p-8 rounded-3xl bg-white/90 dark:bg-[#131317]/95 border border-black/[0.07] dark:border-white/[0.08] shadow-2xl"
        >
          <div className="mb-6 text-center space-y-1.5">
            <img src="/logo.png" alt="Lumina" className="w-12 h-12 mx-auto rounded-2xl object-cover mb-3 shadow-md" />
            <h1 className="text-xl font-semibold tracking-tight">登录 Lumina</h1>
            
          </div>

          {forgotMode ? (
            <div className="space-y-3 text-xs">
              <div className="font-medium text-sm text-center pb-1">通过邮箱找回密码</div>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="请输入注册邮箱"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] border border-transparent focus:border-neutral-400 dark:focus:border-white/25 outline-none transition-colors"
              />
              <button
                type="button"
                disabled={busy || !resetEmail}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.forgotPassword(resetEmail);
                    toast(r.message || '验证码已发送');
                  } catch (e: unknown) {
                    toast(e instanceof Error ? e.message : '发送失败', 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/[0.1] font-medium disabled:opacity-50 transition-colors"
              >
                发送 6 位邮箱验证码
              </button>
              <input
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="输入 6 位邮箱验证码"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] font-mono outline-none"
              />
              <input
                type="password"
                value={resetNewPwd}
                onChange={(e) => setResetNewPwd(e.target.value)}
                placeholder="设置新密码（至少 6 位）"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.resetPassword(resetEmail, resetCode, resetNewPwd);
                    toast(r.message || '密码已重置');
                    setForgotMode(false);
                  } catch (e: unknown) {
                    toast(e instanceof Error ? e.message : '重置失败', 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium disabled:opacity-50"
              >
                确认重置密码
              </button>
              <button
                type="button"
                onClick={() => setForgotMode(false)}
                className="w-full py-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
              >
                返回登录
              </button>
            </div>
          ) : (
            <Tabs.Root
              value={mode}
              onValueChange={(v) => {
                setMode(v as 'login' | 'register');
                setNeed2FA(false);
              }}
            >
              <Tabs.List className="grid grid-cols-2 p-1 rounded-2xl bg-neutral-100 dark:bg-[#1C1C22] text-xs mb-5">
                <Tabs.Trigger
                  value="login"
                  className="py-2 rounded-xl font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm transition-all"
                >
                  账号登录
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="register"
                  className="py-2 rounded-xl font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm transition-all"
                >
                  注册账号
                </Tabs.Trigger>
              </Tabs.List>

              <form onSubmit={submit} className="space-y-3 text-xs">
                {mode === 'login' ? (
                  <>
                    <input
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="用户名或邮箱"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] border border-transparent focus:border-neutral-400 dark:focus:border-white/25 outline-none transition-colors"
                    />
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="密码"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] border border-transparent focus:border-neutral-400 dark:focus:border-white/25 outline-none transition-colors"
                    />
                    {need2FA && (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22]">
                        <ShieldCheck className="w-4 h-4 text-neutral-500 shrink-0" />
                        <input
                          required
                          autoFocus
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value)}
                          placeholder="输入 6 位 2FA 动态码"
                          className="flex-1 bg-transparent outline-none font-mono"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="用户名 (至少 3 位)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] border border-transparent focus:border-neutral-400 dark:focus:border-white/25 outline-none transition-colors"
                    />
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="邮箱地址"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] border border-transparent focus:border-neutral-400 dark:focus:border-white/25 outline-none transition-colors"
                    />
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="密码 (至少 6 位)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22] border border-transparent focus:border-neutral-400 dark:focus:border-white/25 outline-none transition-colors"
                    />
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#1C1C22]">
                      <KeyRound className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <input
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        placeholder="邀请码 (若站点开启)"
                        className="flex-1 bg-transparent outline-none"
                      />
                    </div>
                  </>
                )}

                <button
                  disabled={busy}
                  type="submit"
                  className="w-full py-2.5 mt-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-neutral-900 font-semibold transition-all disabled:opacity-50"
                >
                  {busy ? '处理中...' : mode === 'login' ? '登录' : '创建账号'}
                </button>
              </form>

              <div className="mt-5 pt-4 border-t border-black/[0.06] dark:border-white/[0.07] space-y-2.5">
                <div className="text-[11px] text-center text-neutral-400">第三方账号快捷登录</div>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <a
                    href="/api/v1/auth/oauth/github"
                    className="py-2 rounded-xl bg-black/[0.04] dark:bg-[#1C1C22] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-center font-medium transition-colors"
                  >
                    GitHub
                  </a>
                  <a
                    href="/api/v1/auth/oauth/google"
                    className="py-2 rounded-xl bg-black/[0.04] dark:bg-[#1C1C22] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-center font-medium transition-colors"
                  >
                    Google
                  </a>
                </div>
              </div>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setForgotMode(true)}
                  className="text-[11px] text-neutral-400 hover:text-neutral-800 dark:hover:text-white transition-colors"
                >
                  忘记密码？
                </button>
              </div>
            </Tabs.Root>
          )}
        </motion.div>
      </div>

      {/* Minimal Bottom Caption */}
      <div className="text-center text-[11px] text-neutral-400">
        © 2026 Lumina
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] flex items-center justify-center text-xs text-neutral-400">正在加载...</div>}>
      <LoginForm />
    </Suspense>
  );
}
