'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? '/gallery' : '/explore');
    }
  }, [user, loading, router]);

  return (
    <div className="py-32 text-center text-xs text-neutral-400">
      正在进入 Lumina 画廊...
    </div>
  );
}
