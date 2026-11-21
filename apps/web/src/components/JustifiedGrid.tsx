'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye } from 'lucide-react';
import type { Asset } from '@/types';
import { ThumbImage } from '@/components/ThumbImage';
import { formatBytes } from '@/lib/api';
import { useToast } from '@/context/ToastContext';

interface JustifiedGridProps {
  assets: Asset[];
  targetRowHeight?: number;
  gap?: number;
  selectable?: boolean;
  selectedIds?: number[];
  onToggleSelect?: (id: number, e: React.MouseEvent) => void;
  onOpenLightbox: (asset: Asset) => void;
}

interface LayoutRow {
  items: Array<{ asset: Asset; width: number; height: number }>;
  height: number;
}

interface GridCardProps {
  asset: Asset;
  width: number;
  height: number;
  selectable: boolean;
  isSel: boolean;
  hasSelection: boolean;
  copiedFmt: string | null;
  onToggleSelect?: (id: number, e: React.MouseEvent) => void;
  onOpenLightbox: (asset: Asset) => void;
  onQuickCopy: (e: React.MouseEvent, id: number, fmt: 'direct' | 'md' | 'html' | 'thumb', asset: Asset) => void;
}

const GridCard = React.memo<GridCardProps>(
  ({ asset, width, height, selectable, isSel, hasSelection, copiedFmt, onToggleSelect, onOpenLightbox, onQuickCopy }) => (
    <div
      onClick={() => onOpenLightbox(asset)}
      style={{ width: `${width}px`, height: `${height}px`, contain: 'layout paint' }}
      className={`group relative rounded-xl overflow-hidden cursor-zoom-in shrink-0 border border-black/[0.05] dark:border-white/[0.07] transition-shadow duration-150 ${
        isSel ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0A0A0C]' : ''
      }`}
    >
      <ThumbImage
        src={asset.thumb_url || asset.direct_url}
        alt={asset.original_name}
        thumbhash={asset.thumbhash}
        dominantColor={asset.dominant_color}
        className="transition-transform duration-300 will-change-transform group-hover:scale-[1.02]"
      />

      {selectable && onToggleSelect && (
        <button
          onClick={(e) => onToggleSelect(asset.id, e)}
          className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center transition-opacity duration-150 ${
            isSel
              ? 'bg-white text-neutral-900 opacity-100 shadow-md'
              : hasSelection
              ? 'bg-black/60 text-white opacity-90 border border-white/25'
              : 'bg-black/55 text-white opacity-80 sm:opacity-0 sm:group-hover:opacity-100 border border-white/15'
          }`}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="hidden sm:flex absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/65 border border-white/10 text-[10px] font-mono tabular-nums text-white/90 opacity-0 group-hover:opacity-100 transition-opacity duration-150 items-center gap-1.5">
        <span>{asset.storage_engine === 'r2' ? 'R2' : 'NVMe'}</span>
        <span className="text-white/40">·</span>
        <span>{formatBytes(asset.size_bytes)}</span>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-1.5 sm:p-2 bg-gradient-to-t from-black/80 via-black/35 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150 flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-white px-1">
          <span className="truncate font-medium max-w-[72%]">{asset.original_name}</span>
          <span className="font-mono tabular-nums text-[10px] text-white/75 flex items-center gap-0.5">
            <Eye className="w-2.5 h-2.5" /> {asset.view_count}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-[#131317]/90 border border-white/[0.08]">
          {(['direct', 'md', 'html', 'thumb'] as const).map((fmt) => {
            const activeCopy = copiedFmt === fmt;
            const label = fmt === 'direct' ? '直链' : fmt === 'md' ? 'MD' : fmt === 'html' ? 'HTML' : '缩略';
            return (
              <button
                key={fmt}
                onClick={(e) => onQuickCopy(e, asset.id, fmt, asset)}
                className={`flex-1 py-1 rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-0.5 ${
                  activeCopy
                    ? 'bg-emerald-500 text-white'
                    : 'text-neutral-300 hover:bg-white/[0.12] hover:text-white'
                }`}
              >
                {activeCopy ? <Check className="w-3 h-3" /> : label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  )
);

GridCard.displayName = 'GridCard';

export const JustifiedGrid: React.FC<JustifiedGridProps> = ({
  assets,
  targetRowHeight,
  gap,
  selectable = false,
  selectedIds = [],
  onToggleSelect,
  onOpenLightbox,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1100);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth || 1100);
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        for (const entry of entries) {
          const w = Math.round(entry.contentRect.width);
          if (w > 0) setContainerWidth((prev) => (Math.abs(prev - w) > 2 ? w : prev));
        }
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const effectiveGap = gap ?? (containerWidth < 640 ? 6 : containerWidth < 1024 ? 8 : 10);
  const effectiveRowHeight =
    targetRowHeight ?? (containerWidth < 640 ? 152 : containerWidth < 1024 ? 196 : 236);

  const rows = useMemo<LayoutRow[]>(() => {
    if (!assets.length || containerWidth <= 0) return [];
    const result: LayoutRow[] = [];
    let currentRow: Array<{ asset: Asset; ratio: number }> = [];
    let ratioSum = 0;

    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      const rawRatio = a.width > 0 && a.height > 0 ? a.width / a.height : 1.333;
      const ratio = Math.max(0.55, Math.min(2.6, rawRatio));
      currentRow.push({ asset: a, ratio });
      ratioSum += ratio;

      const totalGap = (currentRow.length - 1) * effectiveGap;
      const estimatedWidth = ratioSum * effectiveRowHeight + totalGap;

      if (estimatedWidth >= containerWidth) {
        const exactHeight = (containerWidth - totalGap) / ratioSum;
        result.push({
          height: exactHeight,
          items: currentRow.map((item) => ({
            asset: item.asset,
            width: Math.min(containerWidth, item.ratio * exactHeight),
            height: exactHeight,
          })),
        });
        currentRow = [];
        ratioSum = 0;
      }
    }

    if (currentRow.length > 0) {
      const totalGap = (currentRow.length - 1) * effectiveGap;
      const maxH = effectiveRowHeight * (containerWidth < 640 ? 1.25 : 1.15);
      const rowH = Math.min(maxH, (containerWidth - totalGap) / Math.max(ratioSum, containerWidth < 640 ? 1.2 : 1.6));
      result.push({
        height: rowH,
        items: currentRow.map((item) => ({
          asset: item.asset,
          width: Math.min(containerWidth, item.ratio * rowH),
          height: rowH,
        })),
      });
    }

    return result;
  }, [assets, containerWidth, effectiveRowHeight, effectiveGap]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hasSelection = selectedIds.length > 0;

  const quickCopy = useCallback(
    async (e: React.MouseEvent, id: number, fmt: 'direct' | 'md' | 'html' | 'thumb', asset: Asset) => {
      e.stopPropagation();
      const map = {
        direct: asset.direct_url,
        md: `![${asset.original_name}](${asset.direct_url})`,
        html: `<img src="${asset.direct_url}" alt="${asset.original_name}" />`,
        thumb: asset.thumb_url || asset.direct_url,
      };
      await navigator.clipboard.writeText(map[fmt]);
      const key = `${id}-${fmt}`;
      setCopiedId(key);
      toast(`已复制 ${fmt.toUpperCase()} 链接`);
      setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1200);
    },
    [toast]
  );

  return (
    <div ref={containerRef} className="w-full flex flex-col overflow-hidden" style={{ gap: `${effectiveGap}px` }}>
      {rows.map((row, rIdx) => (
        <div
          key={rIdx}
          className="flex items-stretch w-full"
          style={{ gap: `${effectiveGap}px`, height: `${row.height}px`, contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.round(row.height)}px` }}
        >
          {row.items.map(({ asset, width, height }) => {
            const copiedFmt = copiedId?.startsWith(`${asset.id}-`) ? copiedId.split('-')[1] : null;
            return (
              <GridCard
                key={asset.id}
                asset={asset}
                width={width}
                height={height}
                selectable={selectable}
                isSel={selectedSet.has(asset.id)}
                hasSelection={hasSelection}
                copiedFmt={copiedFmt}
                onToggleSelect={onToggleSelect}
                onOpenLightbox={onOpenLightbox}
                onQuickCopy={quickCopy}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};
