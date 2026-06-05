'use client';
import { useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen, Brain, Target, NotebookPen, Wrench, Clock,
} from 'lucide-react';

const dockItems = [
  { icon: BookOpen,     label: 'CPM',           type: 'cpm' },
  { icon: Brain,        label: 'Memoire',       type: 'memoire' },
  { icon: Target,       label: 'Skills',        type: 'skills' },
  { icon: NotebookPen,  label: 'Self-Improve',  type: 'self_improve' },
  { icon: Wrench,       label: 'Tools',         type: 'tools' },
  { icon: Clock,        label: 'Crons',         type: 'crons' },
];

const MAX_SCALE      = 1.3;          // maximum total scale at cursor center
const SIGMA          = 70;           // spread (pixels)
const ITEM_WIDTH     = 56;           // each button’s fixed layout width
const GAP            = 8;            // constant gap — never changes

export function Dock({
  activeType,
  onSelect,
}: {
  activeType: string | null;
  onSelect: (type: string) => void;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [scales, setScales] = useState<number[]>(dockItems.map(() => 1));
  const [offsets, setOffsets] = useState<number[]>(dockItems.map(() => 0));

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const mouseX = e.clientX;
    const newScales: number[] = [];

    // 1) calculate scale for each item (Gaussian)
    for (let i = 0; i < dockItems.length; i++) {
      const el = itemRefs.current[i];
      if (!el) { newScales.push(1); continue; }
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const dist = Math.abs(mouseX - centerX);
      const s = 1 + (MAX_SCALE - 1) * Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA));
      newScales.push(s);
    }

    // 2) compute push offsets — a highly‑scaled item pushes neighbours away
    const newOffsets: number[] = new Array(dockItems.length).fill(0);
    for (let i = 0; i < dockItems.length; i++) {
      const extra = (newScales[i] - 1) * ITEM_WIDTH * 0.35;  // how much it pushes
      // push items to the left
      for (let j = 0; j < i; j++) {
        const factor = 1 - (i - j) / 4;          // falloff with distance
        if (factor > 0) newOffsets[j] -= extra * factor;
      }
      // push items to the right
      for (let j = i + 1; j < dockItems.length; j++) {
        const factor = 1 - (j - i) / 4;
        if (factor > 0) newOffsets[j] += extra * factor;
      }
    }

    setScales(newScales);
    setOffsets(newOffsets);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setScales(dockItems.map(() => 1));
    setOffsets(dockItems.map(() => 0));
  }, []);

  return (
    <div className="flex justify-center mt-4">
      <div
        className="glass-bar rounded-3xl px-3 border border-white/20 shadow-2xl"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          paddingTop: 8,
          paddingBottom: 4,
          overflow: 'visible',
          width: dockItems.length * ITEM_WIDTH + (dockItems.length - 1) * GAP + 24,   // fixed width
        }}
      >
        <div className="flex items-end justify-center" style={{ gap: GAP }}>
          {dockItems.map((item, i) => {
            const isActive = activeType === item.type;
            return (
              <motion.button
                key={item.type}
                onClick={() => onSelect(item.type)}
                ref={el => { itemRefs.current[i] = el; }}
                className="flex flex-col items-center cursor-pointer select-none focus:outline-none relative"
                style={{
                  width: ITEM_WIDTH,
                  transformOrigin: 'bottom center',
                  zIndex: Math.round(scales[i] * 10),   // scaled item on top
                }}
                animate={{
                  scale: scales[i],
                  x: offsets[i],
                  y: -(scales[i] - 1) * 22,              // lift with scale
                }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 22,
                  mass: 0.7,
                }}
              >
                <item.icon
                  className={`w-6 h-6 transition-colors duration-150 ${
                    isActive ? 'text-blue-400' : 'text-slate-400'
                  }`}
                />
                <span
                  className={`text-[10px] mt-0.5 whitespace-nowrap transition-colors duration-150 ${
                    isActive ? 'text-blue-400 font-semibold' : 'text-slate-400'
                  }`}
                >
                  {item.label}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}