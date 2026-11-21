'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Zap, X, Maximize2, Loader2 } from 'lucide-react';
import type { Asset } from '@/types';

export interface IslandUploadItem {
  id: string;
  name: string;
  pct: number;
  stage: string;
  done: boolean;
  instant?: boolean;
  error?: string;
  asset?: Asset;
}

interface UploadIslandProps {
  items: IslandUploadItem[];
  onClearDone: () => void;
  onExpandStudio: () => void;
}

export const UploadIsland: React.FC<UploadIslandProps> = ({ items, onClearDone, onExpandStudio }) => {
  if (items.length === 0) return null;

  const activeCount = items.filter((i) => !i.done && !i.error).length;
  const avgPct = Math.round(items.reduce((acc, i) => acc + i.pct, 0) / items.length);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className="fixed bottom-20 md:bottom-5 right-3 sm:right-5 z-[85] w-80 rounded-2xl bg-[#131317]/95 backdrop-blur-2xl border border-white/[0.08] shadow-2xl text-neutral-100 overflow-hidden"
      >
        <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-white/[0.06] text-xs">
          <div className="flex items-center gap-2 font-medium">
            {activeCount > 0 ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-300" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>
              {activeCount > 0 ? `正在直传 ${activeCount} 张 (${avgPct}%)` : `全部 ${items.length} 张已完成`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onExpandStudio}
              className="p-1 rounded-lg hover:bg-white/[0.08] text-neutral-400 hover:text-white"
              title="打开上传工作室"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
            {activeCount === 0 && (
              <button
                onClick={onClearDone}
                className="p-1 rounded-lg hover:bg-white/[0.08] text-neutral-400 hover:text-white"
                title="收起"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-44 overflow-y-auto p-2.5 space-y-2 text-[11px]">
          {items.slice(0, 5).map((item) => (
            <div key={item.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-neutral-200 max-w-[58%]">{item.name}</span>
                <span className={`font-mono tabular-nums flex items-center gap-1 ${item.error ? 'text-rose-400' : item.done ? 'text-emerald-400' : 'text-neutral-400'}`}>
                  {item.instant && <Zap className="w-2.5 h-2.5" />}
                  {item.stage}
                </span>
              </div>
              <div className="h-1 rounded-full bg-white/[0.07] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${item.pct}%` }}
                  className={`h-full rounded-full ${item.error ? 'bg-rose-500' : item.done ? 'bg-emerald-400' : 'bg-white'}`}
                />
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
