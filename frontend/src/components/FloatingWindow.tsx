"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./FloatingWindow.module.css";

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
}

interface Props {
  title: string;
  geometry: WindowGeometry;
  zIndex: number;
  accent?: string;
  onChange(g: WindowGeometry): void;
  onFocus(): void;
  onClose(): void;
  children: ReactNode;
}

type Op = { kind: "move" | "resize"; sx: number; sy: number; start: WindowGeometry };

const MIN_H = 140;

function clampGeometry(g: WindowGeometry, vw: number, vh: number): WindowGeometry {
  const margin = 8;
  const w = Math.min(g.w, Math.max(160, vw - margin * 2));
  const h = g.collapsed ? g.h : Math.min(g.h, Math.max(120, vh - margin * 2));
  const x = Math.min(Math.max(margin, g.x), Math.max(margin, vw - w - margin));
  const visible = g.collapsed ? 36 : h;
  const y = Math.min(Math.max(margin, g.y), Math.max(margin, vh - visible - margin));
  return { ...g, x, y, w, h };
}

function fitsViewport(g: WindowGeometry, vw: number, vh: number): boolean {
  const bottom = g.collapsed ? g.y + 36 : g.y + g.h;
  return g.w <= vw - 16 && g.x >= 8 && g.y >= 8 && g.x + g.w <= vw - 8 && bottom <= vh - 8;
}

/** На экране окно целиком внутри кадра. Сохранённый размер не переписывается, пока его не меняют на этом экране. */
function displayGeometry(g: WindowGeometry, vw: number, vh: number): WindowGeometry {
  if (g.collapsed || fitsViewport(g, vw, vh)) return clampGeometry(g, vw, vh);
  const h = Math.min(g.h, Math.round(vh * 0.4), vh - 16);
  return clampGeometry({ ...g, h }, vw, vh);
}

function applyOp(op: Op, clientX: number, clientY: number): WindowGeometry {
  const dx = clientX - op.sx;
  const dy = clientY - op.sy;
  const s = op.start;
  const minW = Math.min(320, Math.max(160, window.innerWidth - 8));
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  if (op.kind === "move") {
    return clampGeometry({ ...s, x: s.x + dx, y: s.y + dy }, vw, vh);
  }
  return clampGeometry({ ...s, w: Math.max(minW, s.w + dx), h: Math.max(MIN_H, s.h + dy) }, vw, vh);
}

export default function FloatingWindow({ title, geometry, zIndex, accent, onChange, onFocus, onClose, children }: Props) {
  const [op, setOp] = useState<Op | null>(null);
  const [draft, setDraft] = useState<WindowGeometry | null>(null);
  const [frame, setFrame] = useState(() =>
    typeof window === "undefined" ? { w: 1200, h: 800 } : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    const read = () => setFrame({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const fitted = displayGeometry(geometry, frame.w, frame.h);
  const g = op && draft ? draft : fitted;
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  useEffect(() => {
    if (!op) return;
    const onMove = (e: PointerEvent) => setDraft(applyOp(op, e.clientX, e.clientY));
    const onUp = (e: PointerEvent) => {
      const visual = applyOp(op, e.clientX, e.clientY);
      const current = geometryRef.current;
      setOp(null);
      setDraft(null);
      if (!fitsViewport(current, window.innerWidth, window.innerHeight)) return;
      onChange(op.kind === "move" ? { ...current, x: visual.x, y: visual.y } : visual);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [op, onChange]);

  const toggleCollapsed = () => onChange({ ...geometry, collapsed: !geometry.collapsed });

  return (
    <div
      className={styles.window}
      style={{ left: g.x, top: g.y, width: g.w, height: g.collapsed ? undefined : g.h, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <div
        className={styles.titleBar}
        style={accent ? { borderTopColor: accent } : undefined}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          setOp({ kind: "move", sx: e.clientX, sy: e.clientY, start: fitted });
        }}
        onDoubleClick={toggleCollapsed}
      >
        <span className={styles.title}>{title}</span>
        <div className={styles.buttons}>
          <button title={g.collapsed ? "Развернуть" : "Свернуть"} onClick={toggleCollapsed}>
            {g.collapsed ? "▢" : "–"}
          </button>
          <button title="Скрыть окно" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      {!g.collapsed && (
        <>
          <div className={styles.content}>{children}</div>
          <div
            className={styles.resize}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              setOp({ kind: "resize", sx: e.clientX, sy: e.clientY, start: fitted });
            }}
          />
        </>
      )}
    </div>
  );
}
