'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { UploadCloud } from 'lucide-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { Sidebar } from '@/components/Sidebar';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { MobileBottomNav } from '@/components/MobileBottomNav';
import { UploadStudio } from '@/components/UploadStudio';
import { UploadIsland, type IslandUploadItem } from '@/components/UploadIsland';
import { CommandPalette } from '@/components/CommandPalette';
import { api, directUploadFile } from '@/lib/api';

export const RefreshContext = React.createContext<{ refreshKey: number; openUpload: () => void }>({
  refreshKey: 0,
  openUpload: () => {},
});

export const useAppRefresh = () => React.useContext(RefreshContext);

export const Protected: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly }) => {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user && adminOnly && user.role !== 'admin') router.replace('/gallery');
  }, [loading, user, adminOnly, router]);

  if (loading) return <div className="py-28 text-center text-xs text-neutral-400">正在恢复会话...</div>;
  if (!user || (adminOnly && user.role !== 'admin')) return null;
  return <>{children}</>;
};

const ShellInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login';

  const [uploadOpen, setUploadOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [islandItems, setIslandItems] = useState<IslandUploadItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [siteMeta, setSiteMeta] = useState<Record<string, unknown>>({});
  const [bannerClosed, setBannerClosed] = useState(false);

  const startBackgroundUpload = useCallback((files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith('image/'));
    if (valid.length === 0) return;

    const created: IslandUploadItem[] = valid.map((f) => ({
      id: `${Date.now()}-${Math.random()}`,
      name: f.name,
      pct: 5,
      stage: '准备直传',
      done: false,
    }));
    setIslandItems((prev) => [...created, ...prev]);

    valid.forEach(async (file, i) => {
      const id = created[i].id;
      try {
        const res = await directUploadFile(file, {
          engine: 'smart',
          visibility: 'public',
          strip_gps: true,
          onProgress: (pct, stage) => {
            setIslandItems((prev) => prev.map((x) => (x.id === id ? { ...x, pct, stage } : x)));
          },
        });
        setIslandItems((prev) =>
          prev.map((x) =>
            x.id === id
              ? { ...x, pct: 100, done: true, instant: res.instant, asset: res.asset, stage: res.instant ? '⚡ 秒传' : '完成' }
              : x
          )
        );
        setRefreshKey((k) => k + 1);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '失败';
        setIslandItems((prev) => prev.map((x) => (x.id === id ? { ...x, error: msg, stage: msg } : x)));
      }
    });
  }, []);

  useEffect(() => {
    api.siteInfo().then((r) => setSiteMeta(r.site || {})).catch(() => {});
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    if (isAuthPage) return;

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'u') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault();
          setUploadOpen(true);
        }
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        startBackgroundUpload(files);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, [startBackgroundUpload, isAuthPage]);

  // Clean distraction-free full-viewport layout for /login (no sidebar, search bar, upload button, or bottom nav)
  if (isAuthPage) {
    return (
      <RefreshContext.Provider value={{ refreshKey, openUpload: () => setUploadOpen(true) }}>
        <div className="min-h-[100dvh] flex flex-col pt-safe pb-safe">{children}</div>
      </RefreshContext.Provider>
    );
  }

  return (
    <RefreshContext.Provider value={{ refreshKey, openUpload: () => setUploadOpen(true) }}>
      <div
        className="min-h-[100dvh] flex"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
          if (files.length > 0) {
            startBackgroundUpload(files);
          }
        }}
      >
        <Sidebar onOpenUpload={() => setUploadOpen(true)} />

        <div className="flex-1 min-w-0 flex flex-col min-h-[100dvh]">
          <div className="sticky top-0 z-30 pt-safe bg-[#F9F9F8]/85 dark:bg-[#0A0A0C]/85 backdrop-blur-md border-b border-black/[0.06] dark:border-white/[0.07]">
            {Boolean(siteMeta.site_announcement) && !bannerClosed && (
              <div className="px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs flex items-center justify-between gap-2">
                <span className="truncate mx-auto font-medium">{String(siteMeta.site_announcement)}</span>
                <button onClick={() => setBannerClosed(true)} className="opacity-70 hover:opacity-100 shrink-0 px-1">×</button>
              </div>
            )}
            <Navbar onOpenUpload={() => setUploadOpen(true)} onOpenCommand={() => setCmdOpen(true)} />
          </div>
          <main className="flex-1 w-full py-2 sm:py-4">{children}</main>
          <Footer onOpenUpload={() => setUploadOpen(true)} onOpenCommand={() => setCmdOpen(true)} siteIcp={String(siteMeta.site_icp || '')} />
        </div>

        <MobileBottomNav onOpenUpload={() => setUploadOpen(true)} />

        {dragging && (
          <div className="fixed inset-0 z-[90] bg-[#0A0A0C]/70 backdrop-blur-md border-2 border-dashed border-white/25 flex items-center justify-center pointer-events-none px-4">
            <div className="px-8 py-6 rounded-3xl bg-[#131317] border border-white/[0.08] shadow-2xl text-center space-y-2 text-white">
              <UploadCloud className="w-10 h-10 mx-auto text-neutral-200" />
              <div className="font-semibold text-base">松开上传图片</div>
            </div>
          </div>
        )}

        <UploadIsland
          items={islandItems}
          onClearDone={() => setIslandItems([])}
          onExpandStudio={() => setUploadOpen(true)}
        />

        <UploadStudio
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => setRefreshKey((k) => k + 1)}
        />
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onOpenUpload={() => setUploadOpen(true)} />
      </div>
    </RefreshContext.Provider>
  );
};

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider>
    <ToastProvider>
      <AuthProvider>
        <ShellInner>{children}</ShellInner>
      </AuthProvider>
    </ToastProvider>
  </ThemeProvider>
);
