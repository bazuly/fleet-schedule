"use client";

import { useEffect, useState, type ReactNode } from "react";
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

const MIN_W = 320;
const MIN_H = 140;

function applyOp(op: Op, clientX: number, clientY: number): WindowGeometry {
  const dx = clientX - op.sx;
  const dy = clientY - op.sy;
  const s = op.start;
  if (op.kind === "move") {
    return {
      ...s,
      x: Math.max(-s.w + 120, Math.min(window.innerWidth - 120, s.x + dx)),
      y: Math.max(0, Math.min(window.innerHeight - 32, s.y + dy)),
    };
  }
  return { ...s, w: Math.max(MIN_W, s.w + dx), h: Math.max(MIN_H, s.h + dy) };
}

export default function FloatingWindow({ title, geometry, zIndex, accent, onChange, onFocus, onClose, children }: Props) {
  const [op, setOp] = useState<Op | null>(null);
  const [draft, setDraft] = useState<WindowGeometry | null>(null);
  const g = op && draft ? draft : geometry;

  useEffect(() => {
    if (!op) return;
    const onMove = (e: MouseEvent) => setDraft(applyOp(op, e.clientX, e.clientY));
    const onUp = (e: MouseEvent) => {
      setOp(null);
      setDraft(null);
      onChange(applyOp(op, e.clientX, e.clientY));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [op, onChange]);

  const toggleCollapsed = () => onChange({ ...geometry, collapsed: !geometry.collapsed });

  return (
    <div
      className={styles.window}
      style={{ left: g.x, top: g.y, width: g.w, height: g.collapsed ? undefined : g.h, zIndex }}
      onMouseDownCapture={onFocus}
    >
      <div
        className={styles.titleBar}
        style={accent ? { borderTopColor: accent } : undefined}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          setOp({ kind: "move", sx: e.clientX, sy: e.clientY, start: geometry });
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
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOp({ kind: "resize", sx: e.clientX, sy: e.clientY, start: geometry });
            }}
          />
        </>
      )}
    </div>
  );
}
