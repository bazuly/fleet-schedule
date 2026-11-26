"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./ContextMenu.module.css";

export type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      hint?: string;
      disabled?: boolean;
      danger?: boolean;
      swatch?: string;
      children?: MenuItem[];
      onClick?: () => void;
    };

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const margin = 8;
      const nx = Math.max(margin, Math.min(x, window.innerWidth - r.width - margin));
      const ny = Math.max(margin, Math.min(y, window.innerHeight - r.height - margin));
      setPos((prev) => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [x, y]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (Date.now() < Number(document.documentElement.dataset.fleetSuppressClick || 0)) return;
      const target = e.target;
      if (target instanceof Element && target.closest("[data-fleet-menu]")) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      data-no-grid
      data-menu
      data-fleet-menu
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return items.map((item, i) =>
    item.separator ? (
      <div key={i} className={styles.separator} />
    ) : item.children ? (
      <SubmenuItem key={i} item={item} onClose={onClose} />
    ) : (
      <ActionButton key={i} item={item} onClose={onClose} />
    ),
  );
}

function ActionButton({
  item,
  onClose,
}: {
  item: Exclude<MenuItem, { separator: true }>;
  onClose: () => void;
}) {
  // После долгого нажатия WebView шлёт ложный click мышью. Настоящее касание пункта — это touch.
  const touched = useRef(false);
  return (
    <button
      className={`${styles.item} ${item.danger ? styles.danger : ""}`}
      disabled={item.disabled}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") touched.current = true;
      }}
      onClick={() => {
        const ghost = Date.now() < Number(document.documentElement.dataset.fleetSuppressClick || 0);
        if (ghost && !touched.current) return;
        if (!item.onClick || item.disabled) return;
        onClose();
        item.onClick();
      }}
    >
      <span className={styles.label}>
        {item.swatch && <span className={styles.swatch} style={{ background: item.swatch }} />}
        {item.label}
      </span>
      {item.hint && <span className={styles.hint}>{item.hint}</span>}
    </button>
  );
}

type FlyBox = { top: number; left: number };

/** Рядом с пунктом нет места под второй столбец — раскрываем варианты внутри меню. */
function sideFits(anchor: DOMRect, width: number): boolean {
  const margin = 8;
  const spaceRight = window.innerWidth - margin - (anchor.right - 4);
  const spaceLeft = anchor.left + 4 - margin;
  return spaceRight >= width || spaceLeft >= width;
}

function scrollIntoMenu(el: HTMLElement) {
  const menu = el.closest("[data-menu]");
  if (!(menu instanceof HTMLElement)) return;
  const frame = menu.getBoundingClientRect();
  const row = el.getBoundingClientRect();
  if (row.bottom > frame.bottom - 8) menu.scrollTop += row.bottom - frame.bottom + 8;
  if (row.top < frame.top + 8) menu.scrollTop -= frame.top + 8 - row.top;
}

function SubmenuItem({
  item,
  onClose,
}: {
  item: Exclude<MenuItem, { separator: true }>;
  onClose: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const openedAt = useRef(0);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<"pending" | "inline" | FlyBox>("pending");

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (!btn) return;
    const anchor = btn.getBoundingClientRect();
    const margin = 8;
    const need = 240;
    if (!sideFits(anchor, need)) {
      setPlace((prev) => (prev === "inline" ? prev : "inline"));
      return;
    }
    const pop = popRef.current;
    const width = pop?.offsetWidth || need;
    const height = pop?.offsetHeight || 0;
    const spaceRight = window.innerWidth - margin - (anchor.right - 4);
    const spaceLeft = anchor.left + 4 - margin;
    const useRight = spaceRight >= width || spaceRight >= spaceLeft;
    let left = useRight ? anchor.right - 4 : anchor.left + 4 - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = anchor.top - 6;
    if (height) top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    left = Math.round(left);
    top = Math.round(top);
    setPlace((prev) => (typeof prev === "object" && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [open, place]);

  useLayoutEffect(() => {
    if (!open || place !== "inline") return;
    const el = inlineRef.current;
    if (!el) return;
    scrollIntoMenu(el);
    const id = requestAnimationFrame(() => scrollIntoMenu(el));
    return () => cancelAnimationFrame(id);
  }, [open, place]);

  const coarse = () => window.matchMedia("(pointer: coarse)").matches;

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const armClose = () => {
    if (coarse()) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  const show = () => {
    cancelClose();
    openedAt.current = Date.now();
    setOpen((prev) => {
      if (!prev) setPlace("pending");
      return true;
    });
  };

  const fly =
    open && typeof place === "object" && item.children && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popRef}
            data-no-grid
            data-fleet-menu
            className={`${styles.menu} ${styles.submenu}`}
            style={{ top: place.top, left: place.left }}
            onMouseEnter={cancelClose}
            onMouseLeave={armClose}
          >
            <MenuList items={item.children} onClose={onClose} />
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={styles.submenuWrap} onMouseEnter={() => !coarse() && show()} onMouseLeave={armClose}>
      <button
        ref={btnRef}
        type="button"
        className={styles.item}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            if (Date.now() - openedAt.current < 500) return;
            setOpen(false);
            return;
          }
          show();
        }}
      >
        <span>{item.label}</span>
        <span className={styles.hint}>{open && place === "inline" ? "▾" : "▸"}</span>
      </button>
      {open && place === "inline" && item.children && (
        <div ref={inlineRef} className={styles.inlineList}>
          <MenuList items={item.children} onClose={onClose} />
        </div>
      )}
      {fly}
    </div>
  );
}
