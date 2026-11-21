import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Lumina · 云端图床',
  description: '高效稳定的云端图片托管与媒体管理平台',
  manifest: '/manifest.json',
  icons: { icon: '/favicon.ico', apple: '/icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Lumina' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F9F9F8' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0A0C' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="min-h-[100dvh] bg-[#F9F9F8] text-[#111113] dark:bg-[#0A0A0C] dark:text-[#F4F4F5] antialiased overflow-x-clip selection:bg-neutral-900 selection:text-white dark:selection:bg-white dark:selection:text-neutral-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
