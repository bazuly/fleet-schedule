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

const MIN_H = 140;

/** В приложении заголовок выше: крупные кнопки сворачивания и закрытия. */
function barHeight(): number {
  if (typeof document !== "undefined" && document.documentElement.dataset.app === "1") return 56;
  return 36;
}

type FrameMargin = { top: number; right: number; bottom: number; left: number };

let cachedMargin: FrameMargin | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    cachedMargin = null;
  });
}

/** В приложении окна тоже не заезжают под камеру и нижнюю системную полосу. */
function frameMargin(): FrameMargin {
  const base = 8;
  if (typeof document === "undefined" || document.documentElement.dataset.app !== "1") {
    return { top: base, right: base, bottom: base, left: base };
  }
  if (cachedMargin) return cachedMargin;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.documentElement.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (value: string) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
  cachedMargin = {
    top: base + px(cs.paddingTop),
    right: base + px(cs.paddingRight),
    bottom: base + px(cs.paddingBottom),
    left: base + px(cs.paddingLeft),
  };
  probe.remove();
  return cachedMargin;
}

function clampGeometry(g: WindowGeometry, vw: number, vh: number): WindowGeometry {
  const m = frameMargin();
  const w = Math.min(g.w, Math.max(160, vw - m.left - m.right));
  const h = g.collapsed ? g.h : Math.min(g.h, Math.max(120, vh - m.top - m.bottom));
  const x = Math.min(Math.max(m.left, g.x), Math.max(m.left, vw - w - m.right));
  const visible = g.collapsed ? barHeight() : h;
  const y = Math.min(Math.max(m.top, g.y), Math.max(m.top, vh - visible - m.bottom));
  return { ...g, x, y, w, h };
}

function fitsViewport(g: WindowGeometry, vw: number, vh: number): boolean {
  const m = frameMargin();
  const bottom = g.collapsed ? g.y + barHeight() : g.y + g.h;
  return g.w <= vw - m.left - m.right && g.x >= m.left && g.y >= m.top && g.x + g.w <= vw - m.right && bottom <= vh - m.bottom;
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

  useEffect(() => {
    if (!op) return;
    const onMove = (e: PointerEvent) => setDraft(applyOp(op, e.clientX, e.clientY));
    const onUp = (e: PointerEvent) => {
      const visual = applyOp(op, e.clientX, e.clientY);
      setOp(null);
      setDraft(null);
      // Короткий клик по заголовку не переписывает сохранённый размер.
      if (Math.abs(e.clientX - op.sx) < 3 && Math.abs(e.clientY - op.sy) < 3) return;
      // Сохраняем то, что пользователь только что сдвинул. Иначе окно, не влезающее
      // в текущий экран, после отпускания мыши прыгает обратно.
      onChange(visual);
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
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Жест всё равно ведём по событиям окна.
          }
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
            title="Потяните, чтобы изменить размер"
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Жест всё равно ведём по событиям окна.
              }
              setOp({ kind: "resize", sx: e.clientX, sy: e.clientY, start: fitted });
            }}
          />
        </>
      )}
    </div>
  );
}
