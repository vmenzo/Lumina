'use client';

import React, { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { KeyRound, Plus, Trash2, Copy, Terminal, Download, Shuffle, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import type { APIToken } from '@/types';
import { Protected } from '@/components/AppShell';
import { useToast } from '@/context/ToastContext';

function TokensContent() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<APIToken[]>([]);
  const [name, setName] = useState('');
  const [expireDays, setExpireDays] = useState(0);
  const [plainToken, setPlainToken] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState('picgo');
  const [randomAlbum, setRandomAlbum] = useState('');
  const [randomTag, setRandomTag] = useState('');

  const load = () => api.listTokens().then((r) => setTokens(r.tokens || []));
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const res = await api.createToken(name.trim(), ['upload', 'read'], expireDays);
      setPlainToken(res.plain_token);
      setName('');
      toast('API Token 已生成（请立即复制保存）');
      load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '生成失败', 'error');
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
  const tokStr = plainToken || 'lum_你的令牌';

  const picgoConfig = JSON.stringify(
    {
      url: `${origin}/api/v1/upload`,
      paramName: 'file',
      jsonPath: 'data.url',
      customHeader: JSON.stringify({ 'X-API-Token': tokStr }),
    },
    null,
    2
  );

  const lskyConfig = JSON.stringify(
    {
      version: 'V2',
      url: `${origin}/api/v1/lsky/upload`,
      token: `Bearer ${tokStr}`,
      
    },
    null,
    2
  );

  const sharexObj = {
    Version: '15.0.0',
    Name: 'Lumina',
    DestinationType: 'ImageUploader',
    RequestMethod: 'POST',
    RequestURL: `${origin}/api/v1/upload`,
    Headers: {
      'X-API-Token': tokStr,
    },
    Body: 'MultipartFormData',
    FileFormName: 'file',
    URL: '{json:data.url}',
    ThumbnailURL: '{json:data.asset.thumb_url}',
    DeletionURL: '',
  };
  const sharexConfig = JSON.stringify(sharexObj, null, 2);

  const curlSnippet = `curl -X POST "${origin}/api/v1/upload" \\
  -H "X-API-Token: ${tokStr}" \\
  -F "file=@/path/to/photo.png"`;

  const upicSnippet = `API URL: ${origin}/api/v1/upload
Method: POST
Field Name: file
Header: X-API-Token = ${tokStr}
URL Path: ["data", "url"]`;

  const downloadShareX = () => {
    const blob = new Blob([sharexConfig], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lumina.sxcu';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 lumina.sxcu');
  };

  const randomParams = new URLSearchParams();
  if (randomAlbum.trim()) randomParams.set('album', randomAlbum.trim());
  if (randomTag.trim()) randomParams.set('tag', randomTag.trim());
  const randomUrl = `${origin}/api/v1/random${randomParams.toString() ? '?' + randomParams.toString() : ''}`;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">API 与集成</h1>
      </div>

      <form onSubmit={create} className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] flex flex-wrap gap-3 text-xs">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="令牌备注名 (如 Typora MacBook / ShareX)"
          className="flex-1 min-w-[200px] px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
        />
        <select
          value={expireDays}
          onChange={(e) => setExpireDays(Number(e.target.value))}
          className="px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
        >
          <option value={0}>永不过期</option>
          <option value={30}>30 天</option>
          <option value={90}>90 天</option>
          <option value={365}>365 天</option>
        </select>
        <button type="submit" className="px-4 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> 创建令牌
        </button>
      </form>

      {plainToken && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between gap-3 text-xs">
          <div className="min-w-0">
            <div className="font-medium text-emerald-700 dark:text-emerald-400">请立即保存令牌（仅显示一次）：</div>
            <div className="font-mono mt-1 break-all">{plainToken}</div>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(plainToken);
              toast('Token 已复制');
            }}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white shrink-0 flex items-center gap-1"
          >
            <Copy className="w-3.5 h-3.5" /> 复制
          </button>
        </div>
      )}

      <div className="space-y-2">
        {tokens.map((t) => (
          <div key={t.id} className="p-4 rounded-2xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <KeyRound className="w-4 h-4 text-neutral-400" />
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-[11px] font-mono text-neutral-400">
                  {t.token_prefix}•••••••• · scopes: {t.scopes.join(', ')}
                </div>
              </div>
            </div>
            <button
              onClick={async () => {
                await api.deleteToken(t.id);
                toast('令牌已吊销');
                load();
              }}
              className="p-1.5 rounded-full text-neutral-400 hover:text-rose-500"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Multi-Client Integration Hub */}
      <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium flex items-center gap-1.5"><Terminal className="w-4 h-4" /> 客户端生态一键配置</span>
          <button
            onClick={downloadShareX}
            className="px-3 py-1.5 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> 下载 ShareX (.sxcu)
          </button>
        </div>

        <Tabs.Root value={clientTab} onValueChange={setClientTab} className="space-y-3">
          <Tabs.List className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-neutral-100 dark:bg-white/[0.06] text-xs">
            {[
              { id: 'picgo', label: 'PicGo / PicList / Typora' },
              { id: 'lsky', label: 'Lsky Pro v2 兼容' },
              { id: 'sharex', label: 'ShareX (.sxcu)' },
              { id: 'upic', label: 'uPic (macOS)' },
              { id: 'curl', label: 'cURL / CI' },
            ].map((item) => (
              <Tabs.Trigger
                key={item.id}
                value={item.id}
                className="px-3 py-1.5 rounded-xl font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-800 data-[state=active]:shadow-sm"
              >
                {item.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {[
            { id: 'picgo', content: picgoConfig },
            { id: 'lsky', content: lskyConfig },
            { id: 'sharex', content: sharexConfig },
            { id: 'upic', content: upicSnippet },
            { id: 'curl', content: curlSnippet },
          ].map((panel) => (
            <Tabs.Content key={panel.id} value={panel.id} className="space-y-2">
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(panel.content);
                    toast('配置已复制');
                  }}
                  className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" /> 复制配置
                </button>
              </div>
              <pre className="p-4 rounded-2xl bg-neutral-100 dark:bg-black/40 text-[11px] font-mono overflow-x-auto">{panel.content}</pre>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </div>

      {/* Random Image API Builder */}
      <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-3 text-xs">
        <div className="font-medium flex items-center gap-1.5">
          <Shuffle className="w-4 h-4" /> 随机图 API
        </div>
        <p className="text-neutral-400">默认 302 跳转至图片，追加 <code className="font-mono">&amp;format=json</code> 返回 JSON。</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            value={randomAlbum}
            onChange={(e) => setRandomAlbum(e.target.value)}
            placeholder="限定相册 Slug (可选)"
            className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] font-mono outline-none"
          />
          <input
            value={randomTag}
            onChange={(e) => setRandomTag(e.target.value)}
            placeholder="限定标签 Tag (可选，如 壁纸)"
            className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/[0.06] outline-none"
          />
        </div>
        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-neutral-100 dark:bg-black/40 font-mono text-[11px]">
          <span className="truncate">{randomUrl}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                navigator.clipboard.writeText(randomUrl);
                toast('随机图接口已复制');
              }}
              className="hover:text-neutral-900 dark:hover:text-white flex items-center gap-1"
            >
              <Copy className="w-3.5 h-3.5" /> 复制
            </button>
            <a href={randomUrl} target="_blank" rel="noreferrer" className="hover:text-neutral-900 dark:hover:text-white">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
      {/* WebDAV & Chrome Extension Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-2.5">
          <div className="font-medium text-sm">WebDAV 网盘挂载</div>
          <p className="text-neutral-400 leading-relaxed">
            支持标准 WebDAV 客户端挂载访问。
          </p>
          <div className="p-3 rounded-xl bg-neutral-100 dark:bg-black/40 font-mono text-[11px] space-y-1">
            <div className="truncate">地址: {origin}/webdav/</div>
            <div>账号: 你的登录用户名</div>
            <div>密码: 登录密码 或 上方创建的 API Token</div>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${origin}/webdav/`);
              toast('WebDAV 挂载地址已复制');
            }}
            className="px-3 py-1.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium inline-flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> 复制 WebDAV 地址
          </button>
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-black/[0.06] dark:border-white/[0.07] space-y-2.5">
          <div className="font-medium text-sm">Chrome / Edge 右键转存扩展</div>
          <p className="text-neutral-400 leading-relaxed">
            加载 <code className="font-mono">extensions/chrome-extension</code> 即可在浏览器右键转存图片。
          </p>
          <ol className="list-decimal list-inside space-y-1 text-neutral-500 dark:text-neutral-400">
            <li>打开 <code className="font-mono">chrome://extensions</code> 并开启「开发者模式」</li>
            <li>点击「加载已解压的扩展程序」，选择 <code className="font-mono">extensions/chrome-extension</code></li>
            <li>点击插件图标填入站点地址与上方生成的 API Token 即可使用</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export default function ApiTokensPage() {
  return (
    <Protected>
      <TokensContent />
    </Protected>
  );
}
