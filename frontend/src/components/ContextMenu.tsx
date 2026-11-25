"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
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

  return (
    <div
      ref={ref}
      data-no-grid
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} />
    </div>
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
  return (
    <button
      className={`${styles.item} ${item.danger ? styles.danger : ""}`}
      disabled={item.disabled}
      onClick={() => {
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

function SubmenuItem({
  item,
  onClose,
}: {
  item: Exclude<MenuItem, { separator: true }>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const r = el.getBoundingClientRect();
    setFlip(r.right > window.innerWidth - 8);
  }, [open]);

  return (
    <div className={styles.submenuWrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={styles.item} onClick={() => setOpen((v) => !v)}>
        <span>{item.label}</span>
        <span className={styles.hint}>▸</span>
      </button>
      {open && item.children && (
        <div ref={ref} className={`${styles.menu} ${styles.submenu} ${flip ? styles.submenuLeft : ""}`}>
          <MenuList items={item.children} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
