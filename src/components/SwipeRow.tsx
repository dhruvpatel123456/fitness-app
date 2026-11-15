// A list row that can be swiped left to delete. (Deleting is also available
// from the row's own edit sheet, so swiping is never the only way.)

import { Trash2 } from 'lucide-react';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

export function SwipeRow({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; id: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (leaving || (e.pointerType === 'mouse' && e.button !== 0)) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false };
    suppressClick.current = false;
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || e.pointerId !== s.id) return;
    const moveX = e.clientX - s.x;
    const moveY = e.clientY - s.y;
    if (!s.active) {
      if (Math.abs(moveY) > 10 && Math.abs(moveY) > Math.abs(moveX)) {
        start.current = null; // a vertical scroll, not a swipe
        return;
      }
      if (moveX < -10 && Math.abs(moveX) > Math.abs(moveY) * 1.5) {
        s.active = true;
        suppressClick.current = true;
        setDragging(true);
        try {
          row.current?.setPointerCapture(s.id);
        } catch {
          // Capture is a nicety; the swipe still works without it.
        }
      } else {
        return;
      }
    }
    setDx(Math.min(0, moveX));
  };

  const finish = (cancelled: boolean) => {
    const s = start.current;
    start.current = null;
    if (!s?.active) return;
    setDragging(false);
    const width = row.current?.offsetWidth ?? 320;
    if (!cancelled && dx < -Math.min(140, width * 0.38)) {
      setLeaving(true);
      setDx(-width);
      window.setTimeout(onDelete, 150);
    } else {
      setDx(0);
    }
  };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-end gap-2 bg-danger pr-5 text-white dark:text-black" aria-hidden>
        <Trash2 size={20} />
        <span className="text-sm font-semibold">Delete</span>
      </div>
      <div
        ref={row}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => finish(false)}
        onPointerCancel={() => finish(true)}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
        className="relative select-none bg-surface"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 0.16s ease-out',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  );
}
