'use client';

import React from 'react';

interface FooterProps {
  onOpenUpload?: () => void;
  onOpenCommand?: () => void;
  siteIcp?: string;
}

export const Footer: React.FC<FooterProps> = ({ siteIcp }) => {
  return (
    <footer className="mt-auto border-t border-black/[0.05] dark:border-white/[0.06] pb-20 md:pb-0">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between gap-3 text-[11px] text-neutral-400">
        <span className="truncate">{siteIcp || `© ${new Date().getFullYear()} Lumina`}</span>
      </div>
    </footer>
  );
};
