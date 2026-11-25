"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, tokenStore } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { colDay, isDayCol, scrollBus, useStore, ZOOMS } from "@/lib/store";
import styles from "./Toolbar.module.css";

const PALETTE = [
  "#fff2cc", "#ffe599", "#fce5cd", "#f9cb9c", "#f4cccc", "#ea9999",
  "#d9ead3", "#b6d7a8", "#d0e0e3", "#c9daf8", "#a4c2f4", "#d9d2e9",
  "#ead1dc", "#efefef", "#d9d9d9", "#b7b7b7", "#ffff00", "#00ff00",
];

const FONT_COLORS = [
  "#000000", "#434343", "#ffffff", "#ffff00", "#ff0000", "#ff9900",
  "#00ff00", "#0000ff", "#9900ff", "#e69138", "#cc0000", "#1155cc",
];

export type PanelKey = "unassigned" | "pickups";

interface Props {
  visible: Record<PanelKey, boolean>;
  onToggle(panel: PanelKey): void;
}

/** Кнопки тулбара не забирают фокус у таблицы, чтобы не терять выделение. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export default function Toolbar({ visible, onToggle }: Props) {
  const router = useRouter();
  const user = useStore((s) => s.user);
  const range = useStore((s) => s.range);
  const wsStatus = useStore((s) => s.wsStatus);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const syncScroll = useStore((s) => s.syncScroll);
  const zoom = useStore((s) => s.zoom);
  const [zoomMenu, setZoomMenu] = useState<{ x: number; y: number } | null>(null);
  const zoomBtnRef = useRef<HTMLButtonElement>(null);
  const [palette, setPalette] = useState<{ x: number; y: number } | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const [fontMenu, setFontMenu] = useState<{ x: number; y: number } | null>(null);
  const fontRef = useRef<HTMLDivElement>(null);
  const active = useStore((s) => s.active);
  const canMerge = (active?.colKeys.filter(isDayCol).length ?? 0) > 1;
  const paletteOpen = palette !== null;
  const setPaletteOpen = (open: boolean) => {
    if (!open) return setPalette(null);
    const rect = paletteRef.current?.getBoundingClientRect();
    setPalette(rect ? { x: rect.left + 10, y: rect.bottom + 6 } : { x: 0, y: 0 });
  };

  useEffect(() => {
    const saved = Number(localStorage.getItem("fleet.zoom"));
    if (ZOOMS.includes(saved)) useStore.getState().setZoom(saved);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea")) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        useStore.getState().stepZoom(1);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        useStore.getState().stepZoom(-1);
      } else if (e.key === "0") {
        e.preventDefault();
        useStore.getState().setZoom(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!paletteOpen && !zoomMenu && !fontMenu) return;
    const close = (e: MouseEvent) => {
      const node = e.target as Node;
      if (paletteOpen && !paletteRef.current?.contains(node)) setPalette(null);
      if (fontMenu && !fontRef.current?.contains(node)) setFontMenu(null);
      if (zoomMenu && !zoomBtnRef.current?.contains(node) && !(e.target as HTMLElement).closest("[data-zoom-menu]")) {
        setZoomMenu(null);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [paletteOpen, zoomMenu, fontMenu]);

  const logout = async () => {
    try {
      await api.logout();
    } catch {}
    tokenStore.clear();
    router.replace("/login");
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        <button onMouseDown={keepFocus} disabled={!canUndo} onClick={() => useStore.getState().undo()} title="Отменить (⌘Z)">
          ↶
        </button>
        <button onMouseDown={keepFocus} disabled={!canRedo} onClick={() => useStore.getState().redo()} title="Повторить (⌘⇧Z)">
          ↷
        </button>
      </div>

      <div className={styles.group} ref={paletteRef}>
        <button onMouseDown={keepFocus} onClick={() => setPaletteOpen(!paletteOpen)} title="Цвет заливки">
          <span className={styles.fillIcon}>🪣</span> Заливка ▾
        </button>
        {palette && (
          <div className={styles.palette} style={{ left: palette.x, top: palette.y }} onMouseDown={keepFocus}>
            {PALETTE.map((c) => (
              <button
                key={c}
                className={styles.swatch}
                style={{ background: c }}
                title={c}
                onClick={() => {
                  useStore.getState().applyBgToActive(c);
                  setPaletteOpen(false);
                }}
              />
            ))}
            <button
              className={styles.noFill}
              onClick={() => {
                useStore.getState().applyBgToActive(null);
                setPaletteOpen(false);
              }}
            >
              Без заливки
            </button>
          </div>
        )}
      </div>

      <div className={styles.group} ref={fontRef}>
        <button
          onMouseDown={keepFocus}
          title="Цвет шрифта"
          onClick={() => {
            if (fontMenu) return setFontMenu(null);
            const rect = fontRef.current?.getBoundingClientRect();
            setFontMenu(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 0, y: 0 });
          }}
        >
          <span className={styles.fontIcon}>А</span> Шрифт ▾
        </button>
        {fontMenu && (
          <div className={styles.palette} style={{ left: fontMenu.x, top: fontMenu.y }} onMouseDown={keepFocus}>
            {FONT_COLORS.map((c) => (
              <button
                key={c}
                className={styles.swatch}
                style={{ background: c }}
                title={c}
                onClick={() => {
                  useStore.getState().applyFgToActive(c);
                  setFontMenu(null);
                }}
              />
            ))}
            <button
              className={styles.noFill}
              onClick={() => {
                useStore.getState().applyFgToActive(null);
                setFontMenu(null);
              }}
            >
              Обычный чёрный
            </button>
          </div>
        )}
      </div>

      <div className={styles.group}>
        <button
          onMouseDown={keepFocus}
          disabled={!canMerge}
          title="Объединить выделенные дни в каждой строке"
          onClick={() => useStore.getState().mergeActive()}
        >
          Объединить
        </button>
      </div>

      <div className={styles.group}>
        <RangeInputs key={`${range.from}|${range.to}`} from={range.from} to={range.to} />
        <button onMouseDown={keepFocus} onClick={() => scrollBus.scrollToDay(todayIso())}>
          Сегодня
        </button>
        <button
          ref={zoomBtnRef}
          onMouseDown={keepFocus}
          title="Масштаб. Ctrl+колесо, Ctrl+плюс или Ctrl+минус"
          onClick={() => {
            if (zoomMenu) return setZoomMenu(null);
            const rect = zoomBtnRef.current?.getBoundingClientRect();
            setZoomMenu(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 0, y: 0 });
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        {zoomMenu && (
          <div className={styles.zoomMenu} style={{ left: zoomMenu.x, top: zoomMenu.y }} data-zoom-menu onMouseDown={keepFocus}>
            {ZOOMS.map((z) => (
              <button
                key={z}
                className={z === zoom ? styles.toggleOn : ""}
                onClick={() => {
                  useStore.getState().setZoom(z);
                  setZoomMenu(null);
                }}
              >
                {Math.round(z * 100)}%
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.group}>
        <button
          onMouseDown={keepFocus}
          className={visible.unassigned ? styles.toggleOn : ""}
          onClick={() => onToggle("unassigned")}
        >
          Нераспределенное
        </button>
        <button
          onMouseDown={keepFocus}
          className={visible.pickups ? styles.toggleOn : ""}
          onClick={() => onToggle("pickups")}
        >
          Заборы продукции
        </button>
        <label className={styles.checkbox} title="Окна следуют за прокруткой основного графика. Их собственная прокрутка график не сдвигает">
          <input
            type="checkbox"
            checked={syncScroll}
            onChange={(e) => useStore.getState().setSyncScroll(e.target.checked)}
          />
          синхронно
        </label>
      </div>

      <div className={styles.spacer} />

      <div className={styles.group}>
        <span
          className={`${styles.status} ${styles[wsStatus]}`}
          title={wsStatus === "online" ? "Онлайн: изменения синхронизируются" : "Нет связи с сервером"}
        />
        <span className={styles.user}>{user?.name || user?.login}</span>
        {user?.is_admin && (
          <Link className={styles.link} href="/users">
            Пользователи
          </Link>
        )}
        <button onClick={logout}>Выйти</button>
      </div>
    </div>
  );
}

function RangeInputs(props: { from: string; to: string }) {
  const [from, setFrom] = useState(props.from);
  const [to, setTo] = useState(props.to);

  const apply = () => {
    if (from && to && from <= to && (from !== props.from || to !== props.to)) {
      void useStore.getState().setRange(from, to);
    }
  };

  return (
    <>
      <label className={styles.dateLabel}>
        с
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={apply} />
      </label>
      <label className={styles.dateLabel}>
        по
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} onBlur={apply} />
      </label>
    </>
  );
}

export function FormulaBar() {
  const active = useStore((s) => s.active);
  const rows = useStore((s) => s.rows);
  const cells = useStore((s) => s.cells);
  const applyEdits = useStore((s) => s.applyEdits);
  const [draftState, setDraftState] = useState<{ key: string; value: string } | null>(null);
  const activeKey = active ? `${active.anchorRowId}|${active.anchorCol}` : "";
  // Черновик относится только к той ячейке, для которой его начали вводить.
  const draft = draftState?.key === activeKey ? draftState.value : null;
  const setDraft = (value: string | null) => setDraftState(value === null ? null : { key: activeKey, value });

  const row = active ? rows[active.anchorRowId] : null;
  let value = "";
  let label = "";
  if (active && row) {
    if (isDayCol(active.anchorCol)) {
      const day = colDay(active.anchorCol);
      value = cells.get(`${row.id}|${day}`)?.value ?? "";
      const [, m, d] = day.split("-");
      label = `${d}.${m}`;
    } else {
      const field = active.anchorCol.slice(2) as "driver" | "tractor" | "trailer" | "note";
      value = row[field];
      label = { driver: "Водитель", tractor: "Тягач", trailer: "Прицеп", note: "Заметка" }[field];
    }
    const who = row.driver || row.tractor || row.note;
    if (who) label = `${who.split("\n")[0]} · ${label}`;
  }

  const commit = () => {
    if (draft === null || !active) return;
    applyEdits([{ rowId: active.anchorRowId, col: active.anchorCol, value: draft }]);
    setDraft(null);
  };

  return (
    <div className={styles.formulaBar}>
      <div className={styles.cellRef} title={label}>
        {label || "—"}
      </div>
      <div className={styles.fx}>fx</div>
      <input
        className={styles.formulaInput}
        value={draft ?? value}
        disabled={!active}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}
