"use client";

import { useEffect, useRef, useState } from "react";
import { api, type CellChange } from "@/lib/api";
import { formatChangedAt, formatDayHeader } from "@/lib/dates";
import styles from "./CellHistory.module.css";

interface Props {
  x: number;
  y: number;
  rowId: string;
  day: string;
  onClose(): void;
}

function summary(change: CellChange): string {
  if (change.deleted) return "Очистил клетку";
  const value = change.value.trim();
  if (value) return value;
  const comment = change.comment.trim();
  if (comment) return `Комментарий: ${comment}`;
  if (change.bg) return "Заливка";
  if (change.fg) return "Цвет текста";
  if (change.span > 1) return `Объединение на ${change.span} дн.`;
  return "Изменение";
}

export default function CellHistory({ x, y, rowId, day, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<CellChange[] | null>(null);
  const [error, setError] = useState("");
  const header = formatDayHeader(day);

  useEffect(() => {
    let live = true;
    api
      .cellHistory(rowId, day)
      .then((list) => {
        if (live) setItems(list);
      })
      .catch((e: Error) => {
        if (live) setError(e.message || "Не удалось загрузить историю");
      });
    return () => {
      live = false;
    };
  }, [rowId, day]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      data-no-grid
      className={styles.box}
      style={{ left: Math.min(x, window.innerWidth - 340), top: Math.min(y, window.innerHeight - 280) }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={styles.title}>История · {header.date}</div>
      {error && <div className={styles.empty}>{error}</div>}
      {!error && items === null && <div className={styles.empty}>Загрузка…</div>}
      {items && items.length === 0 && (
        <div className={styles.empty}>Пока нет записей. Здесь появятся новые правки: кто изменил клетку и когда.</div>
      )}
      {items && items.length > 0 && (
        <div className={styles.list}>
          {items.map((change) => (
            <div key={change.id} className={styles.entry}>
              <div className={styles.meta}>
                <span className={styles.who}>{change.user_name || "Без имени"}</span>
                <span className={styles.when}>{formatChangedAt(change.changed_at)}</span>
              </div>
              <div className={styles.what}>
                {change.bg && <span className={styles.swatch} style={{ background: change.bg }} />}
                <span>{summary(change)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
