"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CommentBox.module.css";

interface Props {
  x: number;
  y: number;
  initial: string;
  onSave(comment: string): void;
  onClose(): void;
}

export default function CommentBox({ x, y, initial, onSave, onClose }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const save = () => onSave(value.trim());

  return (
    <div
      data-no-grid
      className={styles.box}
      style={{ left: Math.min(x, window.innerWidth - 320), top: Math.min(y, window.innerHeight - 220) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className={styles.title}>Комментарий</div>
      <textarea
        ref={ref}
        className={styles.input}
        value={value}
        placeholder="Текст комментария"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      />
      <div className={styles.actions}>
        <button className={styles.primary} onClick={save}>
          Сохранить
        </button>
        {initial && (
          <button className={styles.danger} onClick={() => onSave("")}>
            Удалить
          </button>
        )}
        <button onClick={onClose}>Отмена</button>
      </div>
    </div>
  );
}
