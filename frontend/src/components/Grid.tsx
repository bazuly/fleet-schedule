"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Panel, RowField } from "@/lib/api";
import { parseTsv, toHtmlTable, toTsv } from "@/lib/clipboard";
import { daysBetween, formatDayHeader, isFirstOfMonth, todayIso } from "@/lib/dates";
import { ROW_STATUSES, statusFill } from "@/lib/status";
import {
  cellKey,
  dayCol,
  fieldCol,
  scrollBus,
  sortedRowIds,
  useStore,
  ZOOM_MAX,
  ZOOM_MIN,
  type ColKey,
  type Edit,
} from "@/lib/store";
import CellHistory from "./CellHistory";
import CommentBox from "./CommentBox";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import styles from "./Grid.module.css";

function isApp(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.app === "1";
}

/** Узкий экран и приложение: размер букв не зависит от масштаба. */
function isMobileSheet(): boolean {
  if (typeof document === "undefined") return false;
  return isApp() || window.matchMedia("(max-width: 720px)").matches;
}

/** После долгого нажатия браузер ещё шлёт «отпускание» как клик. Его нельзя считать выбором пункта меню. */
function suppressGhostClick() {
  document.documentElement.dataset.fleetSuppressClick = String(Date.now() + 450);
}

function ghostClick(): boolean {
  return Date.now() < Number(document.documentElement.dataset.fleetSuppressClick || 0);
}

export interface FrozenCol {
  field: RowField;
  title: string;
  width: number;
}

interface Props {
  panel: Panel;
  frozen: FrozenCol[];
  /** На узком экране прячет закреплённые столбцы, чтобы дни заняли всю ширину. */
  hideFrozen?: boolean;
}

/** В мобильной версии буквы не растут и не сжимаются вместе с масштабом. */
const MOBILE_FONT = 5;
const BASE_CELL = 96;
const BASE_HEADER = 40;
const BASE_GUTTER = 38;
const MIN_FROZEN: Record<string, number> = { driver: 118, tractor: 64, trailer: 64, note: 100 };
const MAX_SPAN = 62;
const OVERSCAN = 3;

type Pos = { r: number; c: number };
type Sel = { anchor: Pos; focus: Pos };
type Editing = { r: number; c: number; value: string; mode: "quick" | "full" };
type Drag = { kind: "select" } | { kind: "fill"; target: Pos };

/** Браузер прокручивает overflow:hidden-контейнеры, показывая фокусный элемент, и панели разъезжаются. */
function resetScroll(e: React.UIEvent<HTMLElement>) {
  const el = e.currentTarget;
  if (el.scrollTop || el.scrollLeft) {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  }
}

export default function Grid({ panel, frozen, hideFrozen = false }: Props) {
  const rows = useStore((s) => s.rows);
  const cells = useStore((s) => s.cells);
  const range = useStore((s) => s.range);
  const clipboard = useStore((s) => s.clipboard);
  const applyEdits = useStore((s) => s.applyEdits);

  const rowIds = useMemo(() => sortedRowIds(rows, panel), [rows, panel]);
  const days = useMemo(() => daysBetween(range.from, range.to), [range]);
  const today = todayIso();
  const todayIdx = days.indexOf(today);
  const zoom = useStore((s) => s.zoom);
  const focusDay = useStore((s) => s.focusDay);
  const rowH = Math.round(BASE_CELL * 0.8 * zoom);
  const colW = Math.round(BASE_CELL * zoom);
  const headerH = Math.max(30, Math.round(BASE_HEADER * zoom));
  const gutterW = Math.max(28, Math.round(BASE_GUTTER * zoom));
  const scaled = (px: number) => Math.round(px * zoom);
  const [mobileSheet, setMobileSheet] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setMobileSheet(isMobileSheet());
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const fontPx = mobileSheet ? MOBILE_FONT : Math.max(1, Math.round(13 * zoom));
  const compact = zoom < 0.6;
  const [viewport, setViewport] = useState({ w: 1200, h: 600 });

  const K = frozen.length;
  const N = rowIds.length;
  const D = days.length;
  const C = K + D;
  const frozenX = useMemo(() => {
    if (hideFrozen) return Array.from({ length: frozen.length + 1 }, () => 0);
    const widths = frozen.map((f) => Math.round(f.width * zoom));
    const natural = widths.reduce((sum, w) => sum + w, 0);
    const day = Math.round(BASE_CELL * zoom);
    // Полоска прокрутки и один полный день остаются справа, остальное — под фамилии.
    const scrollbar = 16;
    const room = Math.max(0, viewport.w - gutterW - scrollbar);
    const minDay = Math.min(day, Math.max(Math.round(72 * Math.min(zoom, 1)), Math.round(room * 0.42)));
    const budget = Math.max(0, room - minDay);
    const floors = frozen.map((f) => Math.round((MIN_FROZEN[f.field] ?? 64) * Math.min(zoom, 1)));
    const floorSum = floors.reduce((sum, w) => sum + w, 0);
    let used = widths;
    if (natural > budget) {
      if (floorSum <= budget && floorSum > 0) {
        const extra = budget - floorSum;
        const flex = widths.map((w, i) => Math.max(0, w - floors[i]));
        const flexSum = flex.reduce((sum, w) => sum + w, 0) || 1;
        used = floors.map((floor, i) => floor + Math.floor((extra * flex[i]) / flexSum));
      } else if (floorSum > 0) {
        const scale = budget / floorSum;
        used = floors.map((w) => Math.max(28, Math.floor(w * scale)));
      }
      const drift = budget - used.reduce((sum, w) => sum + w, 0);
      if (used.length && drift > 0) used[0] += drift;
    }
    const xs = [0];
    for (const w of used) xs.push(xs[xs.length - 1] + Math.max(0, w));
    return xs;
  }, [frozen, zoom, viewport.w, gutterW, hideFrozen]);
  const frozenW = frozenX[K];
  const leftW = gutterW + frozenW;

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const [rawSel, setSel] = useState<Sel>(() => {
    const start = { r: 0, c: K + Math.max(0, todayIdx) };
    return { anchor: start, focus: start };
  });
  const [editing, setEditingState] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const setEditing = useCallback((e: Editing | null) => {
    editingRef.current = e;
    setEditingState(e);
  }, []);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; r: number; c: number } | null>(null);
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const touchMenuRef = useRef(false);
  /** Касание началось на водителях или машинах: это прокрутка плана, а не протягивание выделения. */
  const namesTouch = useRef(false);
  /** Жест уже прокрутил план. Следующее «нажатие мыши» от пальца не должно выбирать клетку. */
  const swallowMouse = useRef(false);
  /** Прокрутка на момент начала щипка. После жеста из неё считается настоящий масштаб. */
  const pinchCommit = useRef<{ sl0: number; st0: number; sx: number; sy: number; mx: number; my: number } | null>(null);
  const pinching = useRef(false);
  const endPressRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endPressRef.current?.(), []);
  const [noteEdit, setNoteEdit] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const [history, setHistory] = useState<{ x: number; y: number; rowId: string; day: string } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [focused, setFocused] = useState(false);
  const suppressSyncRef = useRef(false);

  const colKey = useCallback(
    (c: number): ColKey => (c < K ? fieldCol(frozen[c].field) : dayCol(days[c - K])),
    [K, frozen, days],
  );

  const valueAt = useCallback(
    (r: number, c: number): string => {
      const id = rowIds[r];
      if (!id) return "";
      if (c < K) return rows[id]?.[frozen[c].field] ?? "";
      return cells.get(cellKey(id, days[c - K]))?.value ?? "";
    },
    [rowIds, rows, cells, days, K, frozen],
  );

  const cellAt = useCallback(
    (r: number, c: number) => {
      if (c < K) return undefined;
      const id = rowIds[r];
      return id ? cells.get(cellKey(id, days[c - K])) : undefined;
    },
    [rowIds, cells, days, K],
  );

  // Объединение только явное: кнопка «Объединить» записывает span. Одинаковая заливка клетки не склеивает.
  const spanAt = useCallback(
    (r: number, dayIndex: number): number => {
      if (dayIndex < 0 || dayIndex >= D) return 1;
      const stored = cellAt(r, K + dayIndex)?.span ?? 1;
      return stored > 1 ? Math.min(stored, D - dayIndex) : 1;
    },
    [D, K, cellAt],
  );

  /** Клетка вместе с объединением, которому она принадлежит. Закреплённые колонки не объединяются. */
  const blockAt = useCallback(
    (r: number, c: number): { c0: number; c1: number } => {
      if (c < K || r < 0 || r >= N) return { c0: c, c1: c };
      const dayIndex = c - K;
      const look = Math.min(dayIndex, MAX_SPAN - 1);
      for (let back = look; back >= 0; back--) {
        const n = spanAt(r, dayIndex - back);
        if (n > back) {
          const start = dayIndex - back;
          return { c0: K + start, c1: K + start + n - 1 };
        }
      }
      return { c0: c, c1: c };
    },
    [K, N, spanAt],
  );

  // Строки и диапазон дат могут измениться извне — держим выделение в пределах таблицы.
  const sel = useMemo<Sel>(() => {
    const clamp = (p: Pos): Pos => ({
      r: Math.max(0, Math.min(N - 1, p.r)),
      c: Math.max(0, Math.min(C - 1, p.c)),
    });
    return { anchor: clamp(rawSel.anchor), focus: clamp(rawSel.focus) };
  }, [rawSel, N, C]);

  const bounds = useMemo(() => {
    const r0 = Math.min(sel.anchor.r, sel.focus.r);
    const r1 = Math.max(sel.anchor.r, sel.focus.r);
    let c0 = Math.min(sel.anchor.c, sel.focus.c);
    let c1 = Math.max(sel.anchor.c, sel.focus.c);
    // Как в Excel: выделение, задевшее объединение, захватывает его целиком.
    let changed = true;
    for (let guard = 0; changed && guard < MAX_SPAN; guard++) {
      changed = false;
      for (let r = r0; r <= r1; r++) {
        const left = blockAt(r, c0);
        const right = blockAt(r, c1);
        if (left.c0 < c0) {
          c0 = left.c0;
          changed = true;
        }
        if (right.c1 > c1) {
          c1 = right.c1;
          changed = true;
        }
      }
    }
    return { r0, r1, c0, c1 };
  }, [sel, blockAt]);

  // Сообщаем выделение в общее хранилище — его используют строка формул и заливка.
  const setActive = useStore((s) => s.setActive);
  useEffect(() => {
    if (!focused || N === 0) return;
    const ids = rowIds.slice(bounds.r0, bounds.r1 + 1);
    const cols: ColKey[] = [];
    for (let c = bounds.c0; c <= bounds.c1; c++) {
      // День внутри объединения не красим отдельно: заливка живёт в левой ячейке.
      if (c >= K && bounds.r0 === bounds.r1 && blockAt(bounds.r0, c).c0 !== c) continue;
      cols.push(colKey(c));
    }
    setActive({
      gridId: panel,
      rowIds: ids,
      colKeys: cols,
      anchorRowId: rowIds[sel.anchor.r],
      anchorCol: colKey(sel.anchor.c),
    });
  }, [focused, bounds, sel.anchor, rowIds, colKey, panel, setActive, N, blockAt, K]);

  // ---------- Прокрутка и размеры ----------

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = bodyRef.current!;
    setScroll({ top: el.scrollTop, left: el.scrollLeft });
    setTip(null);
    if (panel === "main" && D > 0) {
      const idx = Math.min(D - 1, Math.max(0, Math.round(el.scrollLeft / colW) + 2));
      const day = days[idx];
      if (day) useStore.getState().setFocusDay(day);
    }
    if (suppressSyncRef.current || pinching.current) {
      suppressSyncRef.current = false;
      return;
    }
    // Листает даты только основной график. Окна за ним следуют, но сами его не двигают.
    if (panel === "main" && useStore.getState().syncScroll) scrollBus.emit(panel, el.scrollLeft);
  };

  useEffect(
    () =>
      scrollBus.subscribe((source, left) => {
        const el = bodyRef.current;
        if (panel === "main" || source !== "main" || !useStore.getState().syncScroll) return;
        if (!el || Math.abs(el.scrollLeft - left) < 1) return;
        suppressSyncRef.current = true;
        el.scrollLeft = left;
      }),
    [panel],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let acc = 0;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      const dir = acc < 0 ? 1 : -1;
      acc = 0;
      const now = performance.now();
      if (now - last < 90) return;
      last = now;
      useStore.getState().stepZoom(dir);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Пальцы: щипок меняет масштаб картинкой, а настоящий пересчёт — один раз в конце.
  // Свайп по водителям и машинам двигает план.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let pinch: {
      dist: number;
      zoom: number;
      sx: number;
      sy: number;
      mx: number;
      my: number;
      sl0: number;
      st0: number;
      scale: number;
      target: number;
      originX: number;
      originY: number;
    } | null = null;
    let pan: {
      x: number;
      y: number;
      left: number;
      top: number;
      active: boolean;
      lx: number;
      ly: number;
      lt: number;
      vx: number;
      vy: number;
    } | null = null;
    let fling = 0;
    const stopFling = () => {
      if (fling) cancelAnimationFrame(fling);
      fling = 0;
    };
    const fingerDist = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };
    const fingerMid = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });
    const dropPress = () => {
      const press = pressRef.current;
      if (!press) return;
      window.clearTimeout(press.timer);
      pressRef.current = null;
    };
    const clearPreview = () => {
      root.style.transform = "";
      root.style.transformOrigin = "";
      root.style.willChange = "";
    };
    const quantize = (value: number) =>
      Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) * 1000) / 1000;
    const showPreview = (p: NonNullable<typeof pinch>) => {
      p.target = quantize(p.zoom * p.scale);
      p.scale = p.target / p.zoom;
      root.style.willChange = "transform";
      root.style.transformOrigin = "0 0";
      root.style.transform = `translate(${p.mx}px, ${p.my}px) scale(${p.scale}) translate(${-p.sx}px, ${-p.sy}px)`;
      useStore.getState().setZoomPreview(p.target);
    };
    const finishPinch = () => {
      const p = pinch;
      pinch = null;
      clearPreview();
      if (!p) return;
      if (Math.abs(p.target - useStore.getState().zoom) < 0.0005) {
        useStore.getState().setZoomPreview(null);
        pinching.current = false;
        return;
      }
      pinchCommit.current = { sl0: p.sl0, st0: p.st0, sx: p.sx, sy: p.sy, mx: p.mx, my: p.my };
      useStore.getState().setZoom(p.target);
      requestAnimationFrame(() => {
        pinching.current = false;
        const body = bodyRef.current;
        if (panel === "main" && body && useStore.getState().syncScroll) scrollBus.emit(panel, body.scrollLeft);
      });
    };
    const onStart = (e: TouchEvent) => {
      stopFling();
      if (e.touches.length >= 2) {
        pan = null;
        namesTouch.current = false;
        dropPress();
        setDrag(null);
        const body = bodyRef.current;
        if (!body) return;
        const rect = root.getBoundingClientRect();
        const m = fingerMid(e.touches);
        pinch = {
          dist: Math.max(1, fingerDist(e.touches)),
          zoom: useStore.getState().zoom,
          sx: m.x - rect.left,
          sy: m.y - rect.top,
          mx: m.x - rect.left,
          my: m.y - rect.top,
          sl0: body.scrollLeft,
          st0: body.scrollTop,
          scale: 1,
          target: useStore.getState().zoom,
          originX: rect.left,
          originY: rect.top,
        };
        pinching.current = true;
        return;
      }
      if (pinch) return;
      const target = e.target;
      if (e.touches.length === 1 && target instanceof Element && target.closest("[data-sheet-pan]")) {
        if (target.closest("button, textarea")) return;
        const t = e.touches[0];
        const body = bodyRef.current;
        if (!body) return;
        namesTouch.current = true;
        pan = {
          x: t.clientX,
          y: t.clientY,
          left: body.scrollLeft,
          top: body.scrollTop,
          active: false,
          lx: t.clientX,
          ly: t.clientY,
          lt: performance.now(),
          vx: 0,
          vy: 0,
        };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && pinch) {
        e.preventDefault();
        const m = fingerMid(e.touches);
        pinch.mx = m.x - pinch.originX;
        pinch.my = m.y - pinch.originY;
        pinch.scale = fingerDist(e.touches) / pinch.dist;
        showPreview(pinch);
        return;
      }
      if (e.touches.length !== 1 || !pan) return;
      const t = e.touches[0];
      const dx = t.clientX - pan.x;
      const dy = t.clientY - pan.y;
      if (!pan.active && Math.hypot(dx, dy) < 8) return;
      if (!pan.active) {
        pan.active = true;
        dropPress();
        setDrag(null);
      }
      e.preventDefault();
      const now = performance.now();
      const dt = now - pan.lt;
      if (dt > 0 && dt < 80) {
        pan.vx = (t.clientX - pan.lx) / dt;
        pan.vy = (t.clientY - pan.ly) / dt;
      }
      pan.lx = t.clientX;
      pan.ly = t.clientY;
      pan.lt = now;
      const body = bodyRef.current;
      if (!body) return;
      body.scrollLeft = pan.left - dx;
      body.scrollTop = pan.top - dy;
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) finishPinch();
      if (e.touches.length > 0) return;
      namesTouch.current = false;
      if (pan?.active) {
        swallowMouse.current = true;
        const body = bodyRef.current;
        let vx = -pan.vx;
        let vy = -pan.vy;
        pan = null;
        if (body && Math.hypot(vx, vy) > 0.05) {
          const step = () => {
            vx *= 0.92;
            vy *= 0.92;
            body.scrollLeft += vx * 16;
            body.scrollTop += vy * 16;
            if (Math.hypot(vx, vy) > 0.04) fling = requestAnimationFrame(step);
            else fling = 0;
          };
          fling = requestAnimationFrame(step);
        }
        return;
      }
      pan = null;
    };
    root.addEventListener("touchstart", onStart, { capture: true, passive: true });
    root.addEventListener("touchmove", onMove, { capture: true, passive: false });
    root.addEventListener("touchend", onEnd, { capture: true });
    root.addEventListener("touchcancel", onEnd, { capture: true });
    return () => {
      stopFling();
      clearPreview();
      pinching.current = false;
      useStore.getState().setZoomPreview(null);
      root.removeEventListener("touchstart", onStart, { capture: true });
      root.removeEventListener("touchmove", onMove, { capture: true });
      root.removeEventListener("touchend", onEnd, { capture: true });
      root.removeEventListener("touchcancel", onEnd, { capture: true });
    };
  }, []);

  const zoomRef = useRef(zoom);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    const prev = zoomRef.current;
    zoomRef.current = zoom;
    if (!el || prev === zoom) return;
    const ratio = zoom / prev;
    const commit = pinchCommit.current;
    const root = rootRef.current;
    suppressSyncRef.current = true;
    if (commit) {
      pinchCommit.current = null;
      el.scrollLeft = commit.sl0 * ratio + commit.sx * ratio - commit.mx;
      el.scrollTop = commit.st0 * ratio + commit.sy * ratio - commit.my;
      if (root) {
        root.style.transform = "";
        root.style.transformOrigin = "";
        root.style.willChange = "";
      }
    } else {
      el.scrollLeft *= ratio;
      el.scrollTop *= ratio;
    }
  }, [zoom]);

  const scrollToDay = useCallback(
    (day: string) => {
      const el = bodyRef.current;
      const idx = days.indexOf(day);
      if (!el || idx < 0) return;
      suppressSyncRef.current = true;
      el.scrollLeft = Math.max(0, (idx - 2) * colW);
    },
    [days, colW],
  );
  useEffect(() => scrollBus.subscribeDay(scrollToDay), [scrollToDay]);

  const scrollToDayRef = useRef(scrollToDay);
  scrollToDayRef.current = scrollToDay;
  const focusDayRef = useRef(focusDay);
  focusDayRef.current = focusDay;
  // При открытии и при смене периода возвращаемся к сохранённому дню, а не к сегодня.
  useEffect(() => {
    const saved = focusDayRef.current;
    const day = saved && days.includes(saved) ? saved : today;
    if (!days.includes(day)) return;
    scrollToDayRef.current(day);
    // days и today читаем на момент смены диапазона, чтобы масштаб не сбрасывал прокрутку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const ensureVisible = useCallback(
    (p: Pos) => {
      const el = bodyRef.current;
      if (!el) return;
      const y = p.r * rowH;
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + rowH > el.scrollTop + el.clientHeight) el.scrollTop = y + rowH - el.clientHeight;
      if (p.c >= K) {
        const x = (p.c - K) * colW;
        if (x < el.scrollLeft) el.scrollLeft = x;
        else if (x + colW > el.scrollLeft + el.clientWidth) el.scrollLeft = x + colW - el.clientWidth;
      }
    },
    [K, rowH, colW],
  );

  // ---------- Выделение и навигация ----------

  const focusSink = useCallback(() => {
    const s = sinkRef.current;
    if (!s) return;
    // На телефоне фокус в поле ввода сразу открывает клавиатуру. Фокус остаётся на таблице.
    if (isApp()) {
      rootRef.current?.focus({ preventScroll: true });
      return;
    }
    s.value = " ";
    s.focus({ preventScroll: true });
    s.select();
  }, []);

  useEffect(() => {
    return scrollBus.subscribeCell((target) => {
      if (target.panel !== panel || N === 0) return;
      const r = rowIds.indexOf(target.rowId);
      const dayIndex = days.indexOf(target.day);
      if (r < 0 || dayIndex < 0) return;
      const c = K + dayIndex;
      const block = blockAt(r, c);
      setSel({ anchor: { r, c: block.c0 }, focus: { r, c: block.c1 } });
      setFocused(true);
      const anchorCol = colKey(block.c0);
      useStore.getState().setActive({
        gridId: panel,
        rowIds: [rowIds[r]],
        colKeys: [anchorCol],
        anchorRowId: rowIds[r],
        anchorCol,
      });
      const el = bodyRef.current;
      if (el) {
        const top = Math.min(Math.max(0, r * rowH - rowH), Math.max(0, el.scrollHeight - el.clientHeight));
        const left = Math.min(dayIndex * colW, Math.max(0, el.scrollWidth - el.clientWidth));
        if (Math.abs(el.scrollTop - top) >= 1 || Math.abs(el.scrollLeft - left) >= 1) {
          suppressSyncRef.current = true;
          el.scrollTop = top;
          el.scrollLeft = left;
        }
      }
      focusSink();
    });
  }, [panel, N, rowIds, days, K, rowH, colW, blockAt, colKey, focusSink]);

  const select = useCallback(
    (anchor: Pos, focus: Pos = anchor, scrollTo: Pos = focus) => {
      if (anchor.r === focus.r && anchor.c === focus.c) {
        const block = blockAt(anchor.r, anchor.c);
        setSel({ anchor: { r: anchor.r, c: block.c0 }, focus: { r: anchor.r, c: block.c1 } });
      } else {
        setSel({ anchor, focus });
      }
      ensureVisible(scrollTo);
    },
    [ensureVisible, blockAt],
  );

  const clampPos = useCallback(
    (p: Pos): Pos => ({
      r: Math.max(0, Math.min(N - 1, p.r)),
      c: Math.max(hideFrozen && K < C ? K : 0, Math.min(C - 1, p.c)),
    }),
    [N, C, hideFrozen, K],
  );

  // В момент сворачивания уводим выделение с фамилий на день, чтобы строка формул не смотрела в пустоту.
  const wasHiddenRef = useRef(hideFrozen);
  useEffect(() => {
    const turnedOn = hideFrozen && !wasHiddenRef.current;
    wasHiddenRef.current = hideFrozen;
    if (!turnedOn || C <= K) return;
    setSel((s) => {
      if (s.anchor.c >= K && s.focus.c >= K) return s;
      const day = days.indexOf(today);
      const c = Math.max(K, Math.min(C - 1, K + (day >= 0 ? day : 0)));
      return { anchor: { r: s.anchor.r, c }, focus: { r: s.focus.r, c } };
    });
    if (editingRef.current && editingRef.current.c < K) setEditing(null);
  }, [hideFrozen, K, C, days, today, setEditing]);

  const isEmpty = useCallback((r: number, c: number) => valueAt(r, c) === "", [valueAt]);

  /** Ctrl+стрелка: прыжок к краю блока данных, как в Excel. */
  const jump = useCallback(
    (from: Pos, dr: number, dc: number): Pos => {
      const inside = (p: Pos) => p.r >= 0 && p.r < N && p.c >= 0 && p.c < C;
      let p = { ...from };
      const next = () => ({ r: p.r + dr, c: p.c + dc });
      if (!inside(next())) return p;
      if (!isEmpty(p.r, p.c) && !isEmpty(next().r, next().c)) {
        while (inside(next()) && !isEmpty(next().r, next().c)) p = next();
        return p;
      }
      p = next();
      while (inside(p) && isEmpty(p.r, p.c) && inside(next())) p = next();
      return p;
    },
    [N, C, isEmpty],
  );

  const move = useCallback(
    (dr: number, dc: number, extend = false, toEdge = false) => {
      if (N === 0) return;
    const from = extend ? sel.focus : sel.anchor;
    if (!extend && !toEdge) {
      const block = blockAt(from.r, from.c);
      const raw = clampPos({
        r: from.r + dr,
        c: dc > 0 ? block.c1 + 1 : dc < 0 ? block.c0 - 1 : from.c,
      });
      select(raw);
      return;
    }
    const target = clampPos(toEdge ? jump(from, dr, dc) : { r: from.r + dr, c: from.c + dc });
    if (extend) select(sel.anchor, target);
    else select(target);
  },
  [N, sel, clampPos, jump, select, blockAt],
);

  // ---------- Редактирование ----------

  const startEdit = useCallback(
    (mode: "quick" | "full", initial?: string) => {
      if (N === 0) return;
      const { r, c } = sel.anchor;
      ensureVisible(sel.anchor);
      setEditing({ r, c, mode, value: initial ?? valueAt(r, c) });
    },
    [N, sel.anchor, valueAt, ensureVisible, setEditing],
  );

  useEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: true });
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [editing]);

  const commitEdit = useCallback(
    (dr = 0, dc = 0) => {
      const e = editingRef.current;
      if (!e) return;
      setEditing(null);
      const rowId = rowIds[e.r];
      if (rowId) applyEdits([{ rowId, col: colKey(e.c), value: e.value }]);
      focusSink();
      if (dr || dc) move(dr, dc);
    },
    [rowIds, colKey, applyEdits, focusSink, setEditing, move],
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    focusSink();
  }, [focusSink, setEditing]);

  // ---------- Буфер обмена ----------

  const selectionMatrix = useCallback(() => {
    const values: string[][] = [];
    const bgs: (string | null)[][] = [];
    const fgs: (string | null)[][] = [];
    const comments: string[][] = [];
    const spans: number[][] = [];
    const sents: boolean[][] = [];
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      const vr: string[] = [];
      const br: (string | null)[] = [];
      const fr: (string | null)[] = [];
      const cr: string[] = [];
      const sr: number[] = [];
      const tr: boolean[] = [];
      for (let c = bounds.c0; c <= bounds.c1; c++) {
        const cell = cellAt(r, c);
        const block = blockAt(r, c);
        vr.push(block.c0 === c ? valueAt(r, c) : "");
        br.push(block.c0 === c ? (cell?.bg ?? null) : null);
        fr.push(block.c0 === c ? (cell?.fg ?? null) : null);
        cr.push(block.c0 === c ? (cell?.comment ?? "") : "");
        sr.push(block.c0 === c ? block.c1 - block.c0 + 1 : 1);
        tr.push(block.c0 === c ? !!cell?.sent : false);
      }
      values.push(vr);
      bgs.push(br);
      fgs.push(fr);
      comments.push(cr);
      spans.push(sr);
      sents.push(tr);
    }
    return { values, bgs, fgs, comments, spans, sents };
  }, [bounds, valueAt, cellAt, blockAt]);

  const doCopy = useCallback(
    (cut: boolean, dt?: DataTransfer | null) => {
      if (N === 0) return;
      const { values, bgs, fgs, comments, spans, sents } = selectionMatrix();
      const tsv = toTsv(values);
      if (dt) {
        dt.setData("text/plain", tsv);
        dt.setData("text/html", toHtmlTable(values, bgs, fgs));
      } else {
        void navigator.clipboard?.writeText(tsv).catch(() => {});
      }
      const cols: ColKey[] = [];
      for (let c = bounds.c0; c <= bounds.c1; c++) cols.push(colKey(c));
      useStore.getState().setClipboard({
        tsv,
        values,
        bgs,
        fgs,
        comments,
        spans,
        sents,
        cut: cut
          ? { gridId: panel, rowIds: rowIds.slice(bounds.r0, bounds.r1 + 1), colKeys: cols }
          : undefined,
      });
    },
    [N, selectionMatrix, bounds, colKey, panel, rowIds],
  );

  const doPaste = useCallback(
    (text: string) => {
      if (N === 0) return;
      const clip = useStore.getState().clipboard;
      const normalized = text.replace(/\r\n?/g, "\n");
      const internal = clip && clip.tsv === normalized ? clip : null;
      const values = internal ? internal.values : parseTsv(normalized);
      const bgs = internal ? internal.bgs : null;
      const fgs = internal ? internal.fgs : null;
      const comments = internal ? internal.comments : null;
      const spans = internal ? internal.spans : null;
      const sents = internal ? internal.sents : null;
      if (!values.length || !values[0].length) return;

      const h = values.length;
      const w = Math.max(...values.map((r) => r.length));
      // Одиночное значение заполняет всё выделение — как в Excel.
      const single = h === 1 && w === 1;
      const r0 = bounds.r0;
      const c0 = bounds.c0;
      const r1 = single ? bounds.r1 : Math.min(N - 1, r0 + h - 1);
      const c1 = single ? bounds.c1 : Math.min(C - 1, c0 + w - 1);

      const target = new Map<string, Edit>();
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const sr = single ? 0 : r - r0;
          const sc = single ? 0 : c - c0;
          const edit: Edit = { rowId: rowIds[r], col: colKey(c), value: values[sr]?.[sc] ?? "" };
          if (bgs && c >= K) {
            edit.bg = bgs[sr]?.[sc] ?? null;
            edit.fg = fgs?.[sr]?.[sc] ?? null;
            // Комментарий не размножаем, когда одно значение заливает весь диапазон.
            if (comments && (!single || (r === r0 && c === c0))) edit.comment = comments[sr]?.[sc] ?? "";
            const span = spans?.[sr]?.[sc] ?? 1;
            if (span > 1) edit.span = span;
            if (sents) edit.sent = !!sents[sr]?.[sc];
          }
          target.set(`${edit.rowId}|${edit.col}`, edit);
        }
      }

      const edits: Edit[] = [...target.values()];
      if (internal?.cut) {
        for (const rowId of internal.cut.rowIds)
          for (const col of internal.cut.colKeys) {
            const k = `${rowId}|${col}`;
            if (!target.has(k)) {
              edits.push(
                col.startsWith("d:")
                  ? { rowId, col, value: "", bg: null, fg: null, comment: "", sent: false }
                  : { rowId, col, value: "" },
              );
            }
          }
        useStore.getState().setClipboard(null);
      }
      applyEdits(edits);
      select({ r: r0, c: c0 }, { r: r1, c: c1 }, { r: r0, c: c0 });
    },
    [N, C, K, bounds, rowIds, colKey, applyEdits, select],
  );

  const clearSelection = useCallback(
    (what: "value" | "bg") => {
      const edits: Edit[] = [];
      for (let r = bounds.r0; r <= bounds.r1; r++)
        for (let c = bounds.c0; c <= bounds.c1; c++) {
          if (what === "value") edits.push({ rowId: rowIds[r], col: colKey(c), value: "" });
          else if (c >= K) edits.push({ rowId: rowIds[r], col: colKey(c), bg: null });
        }
      applyEdits(edits);
    },
    [bounds, rowIds, colKey, applyEdits, K],
  );

  const deleteSelectionCells = useCallback(() => {
    // Закрываем редактор без сохранения, иначе его текст вернётся в клетку после стирания.
    setEditing(null);
    setTip(null);
    const edits: Edit[] = [];
    const seen = new Set<string>();
    const wipeDay = (r: number, c: number) => {
      if (r < 0 || r >= N || c < K || c >= C) return;
      const block = blockAt(r, c);
      const key = `${r}:${block.c0}`;
      if (seen.has(key)) return;
      seen.add(key);
      const blank = { value: "", bg: null, fg: null, comment: "", span: 1, sent: false };
      edits.push({ rowId: rowIds[r], col: colKey(block.c0), ...blank });
      for (let k = block.c0 + 1; k <= block.c1; k++) {
        if (cellAt(r, k)) edits.push({ rowId: rowIds[r], col: colKey(k), ...blank });
      }
    };
    if (bounds.c1 >= K) {
      for (let r = bounds.r0; r <= bounds.r1; r++) {
        for (let c = Math.max(bounds.c0, K); c <= bounds.c1; c++) wipeDay(r, c);
      }
    }
    if (menu) wipeDay(menu.r, menu.c);
    if (edits.length) applyEdits(edits);
  }, [bounds, rowIds, colKey, applyEdits, K, C, N, blockAt, cellAt, menu, setEditing]);

  // ---------- Автозаполнение маркером ----------

  const fillRect = useCallback(
    (t: Pos) => {
      const { r0, r1, c0, c1 } = bounds;
      const down = t.r > r1 ? t.r - r1 : 0;
      const up = t.r < r0 ? r0 - t.r : 0;
      const right = t.c > c1 ? t.c - c1 : 0;
      const left = t.c < c0 ? c0 - t.c : 0;
      const vertical = Math.max(down, up) >= Math.max(right, left);
      if (vertical) {
        if (down) return { r0, r1: t.r, c0, c1, dir: "down" as const };
        if (up) return { r0: t.r, r1, c0, c1, dir: "up" as const };
      } else {
        if (right) return { r0, r1, c0, c1: t.c, dir: "right" as const };
        if (left) return { r0, r1, c0: t.c, c1, dir: "left" as const };
      }
      return null;
    },
    [bounds],
  );

  const applyFill = useCallback(
    (t: Pos) => {
      const rect = fillRect(t);
      if (!rect) return;
      const { r0, r1, c0, c1 } = bounds;
      const block = blockAt(r0, c0);
      const soleMerge = r0 === r1 && c0 === block.c0 && c1 === block.c1;
      const srcC0 = soleMerge ? block.c0 : c0;
      const srcC1 = soleMerge ? block.c0 : c1;
      const h = r1 - r0 + 1;
      const w = srcC1 - srcC0 + 1;
      const mod = (a: number, n: number) => ((a % n) + n) % n;
      const edits: Edit[] = [];
      for (let r = rect.r0; r <= rect.r1; r++)
        for (let c = rect.c0; c <= rect.c1; c++) {
          if (r >= r0 && r <= r1 && c >= c0 && c <= c1) continue;
          const sr = r0 + mod(r - r0, h);
          const sc = srcC0 + mod(c - srcC0, w);
          const edit: Edit = { rowId: rowIds[r], col: colKey(c), value: valueAt(sr, sc) };
          if (c >= K && sc >= K) {
            const src = cellAt(sr, sc);
            edit.bg = src?.bg ?? null;
            edit.fg = src?.fg ?? null;
            edit.sent = !!src?.sent;
            edit.span = 1;
          }
          edits.push(edit);
        }
      applyEdits(edits);
      setSel({ anchor: { r: rect.r0, c: rect.c0 }, focus: { r: rect.r1, c: rect.c1 } });
    },
    [fillRect, bounds, rowIds, colKey, valueAt, cellAt, applyEdits, K, blockAt],
  );

  // ---------- Мышь ----------

  const hitTest = useCallback(
    (clientX: number, clientY: number): { r: number; c: number } => {
      const body = bodyRef.current!.getBoundingClientRect();
      const root = rootRef.current!.getBoundingClientRect();
      const el = bodyRef.current!;
      const r = clientY < body.top ? -1 : Math.floor((clientY - body.top + el.scrollTop) / rowH);
      let c: number;
      if (clientX < body.left) {
        const x = clientX - root.left - gutterW;
        if (x < 0) c = -1;
        else {
          c = K - 1;
          for (let i = 0; i < K; i++)
            if (x < frozenX[i + 1]) {
              c = i;
              break;
            }
        }
      } else {
        c = K + Math.floor((clientX - body.left + el.scrollLeft) / colW);
      }
      return { r, c };
    },
    [K, frozenX, rowH, colW, gutterW],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (isApp() && ghostClick()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (swallowMouse.current) {
      swallowMouse.current = false;
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const target = e.target as HTMLElement;
    if (target === bodyRef.current) return; // клик по полосе прокрутки
    if (target.closest("textarea, button, [data-no-grid]")) return;
    if (N === 0) return;

    if (editingRef.current) commitEdit();
    e.preventDefault();
    if (isApp()) setFocused(true);
    focusSink();

    const hit = hitTest(e.clientX, e.clientY);
    // Клик по заголовку дня — выделяем столбец, по номеру строки — строку целиком.
    if (hit.r < 0 && hit.c < 0) {
      select({ r: 0, c: 0 }, { r: N - 1, c: C - 1 }, { r: 0, c: K });
      return;
    }
    if (hit.r < 0) {
      const c = clampPos({ r: 0, c: hit.c }).c;
      if (e.shiftKey) setSel((s) => ({ anchor: { r: 0, c: s.anchor.c }, focus: { r: N - 1, c } }));
      else setSel({ anchor: { r: 0, c }, focus: { r: N - 1, c } });
      return;
    }
    if (hit.c < 0) {
      const r = clampPos({ r: hit.r, c: 0 }).r;
      if (e.button === 2 && r >= bounds.r0 && r <= bounds.r1) return;
      if (e.shiftKey) setSel((s) => ({ anchor: { r: s.anchor.r, c: 0 }, focus: { r, c: C - 1 } }));
      else setSel({ anchor: { r, c: 0 }, focus: { r, c: C - 1 } });
      return;
    }
    if (hit.r >= N) return;
    const p = clampPos(hit);
    if (e.button === 2) {
      const inside = p.r >= bounds.r0 && p.r <= bounds.r1 && p.c >= bounds.c0 && p.c <= bounds.c1;
      if (!inside) select(p);
      return;
    }
    if (e.shiftKey) setSel((s) => ({ anchor: s.anchor, focus: p }));
    else select(p);
    if (!namesTouch.current) setDrag({ kind: "select" });
  };

  const onFillHandleDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    focusSink();
    setDrag({ kind: "fill", target: { r: bounds.r1, c: bounds.c1 } });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const el = bodyRef.current!;
      const rect = el.getBoundingClientRect();
      if (e.clientY > rect.bottom - 10) el.scrollTop += 20;
      else if (e.clientY < rect.top + 10) el.scrollTop -= 20;
      if (e.clientX > rect.right - 10) el.scrollLeft += 30;
      else if (e.clientX < rect.left + 10 && el.scrollLeft > 0 && e.clientX > rect.left - 40) el.scrollLeft -= 30;

      const p = clampPos(hitTest(e.clientX, e.clientY));
      if (drag.kind === "select") setSel((s) => ({ anchor: s.anchor, focus: p }));
      else setDrag({ kind: "fill", target: p });
    };
    const onUp = () => {
      if (drag.kind === "fill") applyFill(drag.target);
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, hitTest, clampPos, applyFill]);

  const cancelPress = () => {
    if (!pressRef.current) return;
    window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isApp() || e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest("textarea, button, [data-no-grid]")) return;
    endPressRef.current?.();
    cancelPress();
    const x = e.clientX;
    const y = e.clientY;
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      touchMenuRef.current = true;
      const hit = hitTest(x, y);
      if (hit.r >= 0 && hit.c >= 0 && hit.r < N) {
        const p = clampPos(hit);
        const inside = p.r >= bounds.r0 && p.r <= bounds.r1 && p.c >= bounds.c0 && p.c <= bounds.c1;
        if (!inside) select(p);
      }
      setDrag(null);
      setMenu({ x, y, r: hit.r, c: hit.c });
    }, 480);
    pressRef.current = { timer, x, y };
    const move = (ev: PointerEvent) => {
      const p = pressRef.current;
      if (!p) return;
      if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 12) cancelPress();
    };
    const end = () => {
      cancelPress();
      if (touchMenuRef.current) {
        suppressGhostClick();
        touchMenuRef.current = false;
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      endPressRef.current = null;
    };
    endPressRef.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (isApp()) return;
    const target = e.target as HTMLElement;
    if (target.closest("textarea, button, [data-no-grid]")) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (hit.r < 0 || hit.c < 0 || hit.r >= N) return;
    startEdit("full");
  };

  const onWheelFrozen = (e: React.WheelEvent) => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop += e.deltaY;
    el.scrollLeft += e.deltaX;
  };

  // ---------- Клавиатура ----------

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingRef.current) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;

    if (mod && (key === "c" || key === "x" || key === "v" || key === "с" || key === "ч" || key === "м")) {
      // Копирование/вставку обрабатывают события copy/cut/paste.
      return;
    }

    let handled = true;
    switch (key) {
      case "ArrowUp":
        move(-1, 0, e.shiftKey, mod);
        break;
      case "ArrowDown":
        move(1, 0, e.shiftKey, mod);
        break;
      case "ArrowLeft":
        move(0, -1, e.shiftKey, mod);
        break;
      case "ArrowRight":
        move(0, 1, e.shiftKey, mod);
        break;
      case "Tab":
        move(0, e.shiftKey ? -1 : 1);
        break;
      case "Enter":
        if (e.shiftKey) move(-1, 0);
        else startEdit("full");
        break;
      case "F2":
        startEdit("full");
        break;
      case "Delete":
      case "Backspace":
        clearSelection("value");
        break;
      case "Escape":
        useStore.getState().setClipboard(null);
        break;
      case "Home":
        select(mod ? { r: 0, c: 0 } : { r: sel.anchor.r, c: 0 });
        break;
      case "End":
        select(mod ? { r: N - 1, c: C - 1 } : { r: sel.anchor.r, c: C - 1 });
        break;
      case "PageDown":
        move(Math.max(1, Math.floor(viewport.h / rowH) - 1), 0, e.shiftKey);
        break;
      case "PageUp":
        move(-Math.max(1, Math.floor(viewport.h / rowH) - 1), 0, e.shiftKey);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      return;
    }

    if (mod && (key === "z" || key === "я")) {
      e.preventDefault();
      if (e.shiftKey) useStore.getState().redo();
      else useStore.getState().undo();
      return;
    }
    if (mod && (key === "y" || key === "н")) {
      e.preventDefault();
      useStore.getState().redo();
      return;
    }
    if (mod && (key === "a" || key === "ф")) {
      e.preventDefault();
      select({ r: 0, c: 0 }, { r: N - 1, c: C - 1 }, sel.anchor);
      return;
    }
    if (!mod && !e.altKey && key.length === 1) {
      e.preventDefault();
      startEdit("quick", key);
    }
  };

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const ed = editingRef.current;
    if (!ed) return;
    if (e.key === "Enter") {
      if (e.altKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const el = e.currentTarget;
        el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end");
        setEditing({ ...ed, value: el.value });
        return;
      }
      e.preventDefault();
      commitEdit(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (ed.mode === "quick" && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[
        e.key
      ] as [number, number];
      commitEdit(d[0], d[1]);
    }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (editingRef.current) return;
    e.preventDefault();
    doCopy(false, e.clipboardData);
  };
  const onCut = (e: React.ClipboardEvent) => {
    if (editingRef.current) return;
    e.preventDefault();
    doCopy(true, e.clipboardData);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (editingRef.current) return;
    e.preventDefault();
    doPaste(e.clipboardData.getData("text/plain"));
  };

  // ---------- Контекстное меню ----------

  const selectedRowIds = rowIds.slice(bounds.r0, bounds.r1 + 1);
  const commentTarget =
    menu && menu.c >= K && menu.r >= 0 && menu.r < N
      ? { r: menu.r, c: blockAt(menu.r, menu.c).c0 }
      : null;
  const commentText = commentTarget
    ? (cells.get(cellKey(rowIds[commentTarget.r], days[commentTarget.c - K]))?.comment ?? "")
    : "";

  const daySelection = bounds.c1 >= K && Math.max(bounds.c0, K) < bounds.c1;
  let selectionHasMerge = false;
  if (bounds.c1 >= K) {
    for (let r = bounds.r0; r <= bounds.r1 && !selectionHasMerge; r++) {
      for (let c = Math.max(bounds.c0, K); c <= bounds.c1; c++) {
        const block = blockAt(r, c);
        if (block.c1 > block.c0) {
          selectionHasMerge = true;
          break;
        }
      }
    }
  }

  const mergeSelection = () => {
    const edits: Edit[] = [];
    let losesText = false;
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      let c0 = Math.max(bounds.c0, K);
      let c1 = bounds.c1;
      if (c1 <= c0) continue;
      let grew = true;
      while (grew) {
        grew = false;
        for (let c = c0; c <= c1; c++) {
          const block = blockAt(r, c);
          if (block.c0 < c0) {
            c0 = block.c0;
            grew = true;
          }
          if (block.c1 > c1) {
            c1 = block.c1;
            grew = true;
          }
        }
      }
      const anchor = cellAt(r, c0);
      for (let c = c0 + 1; c <= c1; c++) {
        const cell = cellAt(r, c);
        if (cell?.value) losesText = true;
        if (cell) edits.push({ rowId: rowIds[r], col: colKey(c), value: "", bg: null, fg: null, comment: "", span: 1, sent: false });
      }
      edits.push({
        rowId: rowIds[r],
        col: colKey(c0),
        value: anchor?.value ?? "",
        bg: anchor?.bg ?? null,
        fg: anchor?.fg ?? null,
        comment: anchor?.comment ?? "",
        span: c1 - c0 + 1,
        sent: !!anchor?.sent,
      });
    }
    if (!edits.length) return;
    if (losesText && !confirm("Объединить ячейки? Останется только текст левой ячейки в каждой строке.")) return;
    applyEdits(edits);
  };

  const unmergeSelection = () => {
    const edits: Edit[] = [];
    const seen = new Set<string>();
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      for (let c = Math.max(bounds.c0, K); c <= bounds.c1; c++) {
        const block = blockAt(r, c);
        if (block.c1 <= block.c0) continue;
        const key = `${r}:${block.c0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edits.push({ rowId: rowIds[r], col: colKey(block.c0), span: 1 });
        for (let k = block.c0 + 1; k <= block.c1; k++) {
          const cell = cellAt(r, k);
          if (cell && !cell.value && !cell.comment) {
            edits.push({ rowId: rowIds[r], col: colKey(k), value: "", bg: null, fg: null, comment: "", span: 1, sent: false });
          }
        }
      }
    }
    applyEdits(edits);
  };
  const hasVehicleCols = frozen.some((f) => f.field === "tractor" || f.field === "trailer");
  const mapRow = menu && menu.r >= 0 && menu.r < N ? rows[rowIds[menu.r]] : null;
  const mapUnits = mapRow
    ? (["tractor", "trailer"] as const)
        .map((kind) => ({ kind, text: mapRow[kind].trim() }))
        .filter((u) => u.text)
    : [];
  const showOnMap = () => {
    if (!mapRow || !mapUnits.length) return;
    useStore.getState().openMap({
      rowId: mapRow.id,
      title: mapRow.driver.split("\n")[0].trim() || mapUnits[0].text,
      units: mapUnits,
    });
  };

  const clickedField = menu && menu.c >= 0 && menu.c < K ? frozen[menu.c].field : null;
  const canSetStatus =
    !!mapRow && (clickedField === "driver" || clickedField === "tractor" || clickedField === "trailer");
  const canEditCell = !!menu && menu.r >= 0 && menu.c >= 0 && menu.r < N && menu.c < C;
  const editPressedCell = () => {
    if (!menu || !canEditCell) return;
    const p = clampPos({ r: menu.r, c: menu.c });
    const c = blockAt(p.r, p.c).c0;
    flushSync(() => {
      setEditing({ r: p.r, c, mode: "full", value: valueAt(p.r, c) });
      select({ r: p.r, c });
    });
    const el = editorRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };
  const menuItems: MenuItem[] = [
    ...(isApp()
      ? [
          { label: "Редактировать", disabled: !canEditCell, onClick: editPressedCell } satisfies MenuItem,
          { separator: true } satisfies MenuItem,
        ]
      : []),
    ...(hasVehicleCols
      ? [
          { label: "Показать на карте", disabled: !mapUnits.length, onClick: showOnMap } satisfies MenuItem,
          { separator: true } satisfies MenuItem,
        ]
      : []),
    ...(canSetStatus && mapRow
      ? [
          {
            label: "Статус",
            children: [
              ...ROW_STATUSES.map(
                (s) =>
                  ({
                    label: s.label,
                    swatch: s.fill,
                    hint: mapRow.status === s.id ? "✓" : undefined,
                    onClick: () => useStore.getState().setRowStatus(mapRow.id, s.id),
                  }) satisfies MenuItem,
              ),
              { separator: true } satisfies MenuItem,
              {
                label: "Убрать статус",
                disabled: !mapRow.status,
                onClick: () => useStore.getState().setRowStatus(mapRow.id, ""),
              },
            ],
          } satisfies MenuItem,
          { separator: true } satisfies MenuItem,
        ]
      : []),
    { label: "Вырезать", hint: "⌘X", onClick: () => doCopy(true) },
    { label: "Копировать", hint: "⌘C", onClick: () => doCopy(false) },
    {
      label: "Вставить",
      hint: "⌘V",
      onClick: async () => {
        let text = useStore.getState().clipboard?.tsv ?? "";
        try {
          text = (await navigator.clipboard.readText()) || text;
        } catch {}
        doPaste(text);
      },
    },
    { separator: true },
    {
      label: commentText ? "Изменить комментарий" : "Добавить комментарий",
      disabled: !commentTarget,
      onClick: () => {
        if (commentTarget && menu) setNoteEdit({ ...commentTarget, x: menu.x, y: menu.y });
      },
    },
    ...(commentText
      ? [
          {
            label: "Удалить комментарий",
            onClick: () =>
              commentTarget &&
              applyEdits([{ rowId: rowIds[commentTarget.r], col: colKey(commentTarget.c), comment: "" }]),
          } satisfies MenuItem,
        ]
      : []),
    {
      label: "История изменений",
      disabled: !commentTarget,
      onClick: () => {
        if (!commentTarget || !menu) return;
        setHistory({
          x: menu.x,
          y: menu.y,
          rowId: rowIds[commentTarget.r],
          day: days[commentTarget.c - K],
        });
      },
    },
    { separator: true },
    { label: "Объединить ячейки", disabled: !daySelection, onClick: mergeSelection },
    { label: "Разъединить ячейки", disabled: !selectionHasMerge, onClick: unmergeSelection },
    { separator: true },
    { label: "Очистить содержимое", hint: "Del", onClick: () => clearSelection("value") },
    { label: "Убрать заливку", onClick: () => clearSelection("bg") },
    {
      label: "Удалить клетку",
      danger: true,
      disabled: bounds.c1 < K,
      onClick: deleteSelectionCells,
    },
    { separator: true },
    { label: "Вставить строку выше", onClick: () => void useStore.getState().insertRow(rowIds[bounds.r0], "above") },
    { label: "Вставить строку ниже", onClick: () => void useStore.getState().insertRow(rowIds[bounds.r1], "below") },
    {
      label: "Переместить строку вверх",
      disabled: bounds.r0 !== bounds.r1 || bounds.r0 === 0,
      onClick: () => {
        useStore.getState().moveRow(rowIds[bounds.r0], -1);
        select({ r: sel.anchor.r - 1, c: sel.anchor.c });
      },
    },
    {
      label: "Переместить строку вниз",
      disabled: bounds.r0 !== bounds.r1 || bounds.r0 === N - 1,
      onClick: () => {
        useStore.getState().moveRow(rowIds[bounds.r0], 1);
        select({ r: sel.anchor.r + 1, c: sel.anchor.c });
      },
    },
    { separator: true },
    {
      label: selectedRowIds.length > 1 ? `Удалить строки (${selectedRowIds.length})` : "Удалить строку",
      danger: true,
      onClick: () => {
        const n = selectedRowIds.length;
        if (!confirm(n > 1 ? `Удалить ${n} строк вместе с графиком?` : "Удалить строку вместе с графиком?")) return;
        for (const id of selectedRowIds) void useStore.getState().deleteRow(id);
      },
    },
  ];

  // ---------- Отрисовка ----------

  const r0v = Math.max(0, Math.floor(scroll.top / rowH) - OVERSCAN);
  const r1v = Math.min(N - 1, Math.ceil((scroll.top + viewport.h) / rowH) + OVERSCAN);
  const d0v = Math.max(0, Math.floor(scroll.left / colW) - OVERSCAN);
  const d1v = Math.min(D - 1, Math.ceil((scroll.left + viewport.w) / colW) + OVERSCAN);

  const bodyCells: React.ReactNode[] = [];
  for (let r = r0v; r <= r1v; r++) {
    const id = rowIds[r];
    for (let d = Math.max(0, d0v - (MAX_SPAN - 1)); d <= d1v; d++) {
      const data = cells.get(cellKey(id, days[d]));
      if (!data) continue;
      const block = blockAt(r, K + d);
      if (block.c0 !== K + d) continue;
      const span = block.c1 - block.c0 + 1;
      if (d + span - 1 < d0v) continue;
      bodyCells.push(
        <div
          key={`${id}|${d}`}
          className={styles.cell}
          style={{
            left: d * colW + 1,
            top: r * rowH + 1,
            width: span * colW - 1,
            height: rowH - 1,
            background: data.bg || (span > 1 ? "var(--surface)" : undefined),
            zIndex: span > 1 || data.value ? 2 : 1,
          }}
          onMouseEnter={
            data.comment
              ? (e) => setTip({ x: e.clientX + 14, y: e.clientY + 18, text: data.comment })
              : undefined
          }
          onMouseLeave={data.comment ? () => setTip(null) : undefined}
        >
          {data.sent && <span className={styles.sentMark} />}
          {data.comment && <span className={styles.noteMark} />}
          {data.value && (
            <span
              className={styles.cellText}
              style={{
                width: Math.max(0, span * colW - (mobileSheet ? 2 : 5)),
                height: Math.max(0, rowH - (mobileSheet ? 2 : 5)),
                color: data.fg || (data.bg ? "#202124" : undefined),
              }}
            >
              <span>{data.value}</span>
            </span>
          )}
        </div>,
      );
    }
  }

  const columnDecor: React.ReactNode[] = [];
  const headers: React.ReactNode[] = [];
  for (let d = d0v; d <= d1v; d++) {
    const h = formatDayHeader(days[d]);
    const isToday = d === todayIdx;
    const selectedCol = K + d >= bounds.c0 && K + d <= bounds.c1;
    if (h.weekend || isToday)
      columnDecor.push(
        <div
          key={`w${d}`}
          className={isToday ? styles.todayCol : styles.weekendCol}
          style={{ left: d * colW, width: colW }}
        />,
      );
    if (isFirstOfMonth(days[d]))
      columnDecor.push(<div key={`m${d}`} className={styles.monthLine} style={{ left: d * colW }} />);
    headers.push(
      <div
        key={d}
        className={`${styles.dayHeader} ${h.weekend ? styles.weekend : ""} ${isToday ? styles.today : ""} ${
          selectedCol ? styles.headerSelected : ""
        } ${isFirstOfMonth(days[d]) ? styles.monthStart : ""}`}
        style={{ left: d * colW, width: colW }}
      >
        <span className={styles.dayDate}>{h.date}</span>
        <span className={styles.dayWeekday}>{h.weekday}</span>
      </div>,
    );
  }

  const leftCells: React.ReactNode[] = [];
  for (let r = r0v; r <= r1v; r++) {
    const id = rowIds[r];
    const row = rows[id];
    const selectedRow = r >= bounds.r0 && r <= bounds.r1;
    leftCells.push(
      <div
        key={`g${id}`}
        className={`${styles.gutter} ${selectedRow ? styles.headerSelected : ""}`}
        style={{ top: r * rowH, height: rowH, width: gutterW }}
      >
        {r + 1}
      </div>,
    );
    const fill = statusFill(row?.status);
    if (!hideFrozen) frozen.forEach((f, i) => {
      const v = row?.[f.field] ?? "";
      const colored = fill && (f.field === "driver" || f.field === "tractor" || f.field === "trailer");
      leftCells.push(
        <div
          key={`${id}|${f.field}`}
          className={styles.frozenCell}
          style={{
            top: r * rowH,
            left: gutterW + frozenX[i],
            width: frozenX[i + 1] - frozenX[i],
            height: rowH,
            background: colored ? fill : undefined,
            color: colored ? "#202124" : undefined,
          }}
          title={v.length > 20 ? v : undefined}
        >
          <span>{v}</span>
        </div>,
      );
    });
  }

  // Прямоугольники выделения в двух панелях — закреплённой и прокручиваемой.
  const selRects = (r0: number, r1: number, c0: number, c1: number) => {
    const top = r0 * rowH;
    const height = (r1 - r0 + 1) * rowH;
    const frozenRect =
      c0 < K ? { left: gutterW + frozenX[c0], width: frozenX[Math.min(c1, K - 1) + 1] - frozenX[c0], top, height } : null;
    const bodyRect =
      c1 >= K
        ? { left: (Math.max(c0, K) - K) * colW, width: (c1 - Math.max(c0, K) + 1) * colW, top, height }
        : null;
    return { frozenRect, bodyRect };
  };

  const hasRows = N > 0;
  const anchorBlock = hasRows ? blockAt(sel.anchor.r, sel.anchor.c) : null;
  const selR = hasRows ? selRects(bounds.r0, bounds.r1, bounds.c0, bounds.c1) : null;
  const activeR = anchorBlock ? selRects(sel.anchor.r, sel.anchor.r, anchorBlock.c0, anchorBlock.c1) : null;
  const multi = bounds.r0 !== bounds.r1 || bounds.c0 !== bounds.c1;
  const soleBlock =
    !!anchorBlock &&
    bounds.r0 === bounds.r1 &&
    bounds.c0 === anchorBlock.c0 &&
    bounds.c1 === anchorBlock.c1;

  const fill = drag?.kind === "fill" ? fillRect(drag.target) : null;
  const fillR = fill ? selRects(fill.r0, fill.r1, fill.c0, fill.c1) : null;

  let cutR: ReturnType<typeof selRects> | null = null;
  if (clipboard?.cut && clipboard.cut.gridId === panel) {
    const rs = clipboard.cut.rowIds.map((id) => rowIds.indexOf(id)).filter((i) => i >= 0);
    const cs = clipboard.cut.colKeys
      .map((k) => (k.startsWith("f:") ? frozen.findIndex((f) => `f:${f.field}` === k) : K + days.indexOf(k.slice(2))))
      .filter((i) => i >= 0 && (i >= K ? i - K < D : true));
    if (rs.length && cs.length) cutR = selRects(Math.min(...rs), Math.max(...rs), Math.min(...cs), Math.max(...cs));
  }

  const overlay = (rect: { left: number; width: number; top: number; height: number } | null, cls: string, key: string) =>
    rect && <div key={key} className={cls} style={rect} />;

  const onEditorChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ed = editingRef.current;
    if (ed) setEditing({ ...ed, value: e.target.value });
  };

  let editorNode: React.ReactNode = null;
  if (editing) {
    const inFrozen = editing.c < K;
    const block = blockAt(editing.r, editing.c);
    const span = Math.max(1, block.c1 - block.c0 + 1);
    const left = inFrozen ? gutterW + frozenX[editing.c] : (block.c0 - K) * colW;
    const width = inFrozen
      ? Math.min(
          Math.max(0, leftW - left),
          Math.max(frozenX[editing.c + 1] - frozenX[editing.c], Math.min(scaled(220), viewport.w - 12)),
        )
      : Math.max(span * colW, Math.min(scaled(220), Math.max(span * colW, viewport.w - leftW - 12)));
    const lines = editing.value.split("\n").length;
    const editorFont = mobileSheet ? 16 : Math.max(fontPx, 14);
    editorNode = (
      <textarea
        ref={editorRef}
        className={styles.editor}
        style={{
          left,
          top: editing.r * rowH,
          width,
          height: Math.max(rowH, lines * editorFont + 6),
          fontSize: editorFont,
        }}
        value={editing.value}
        spellCheck={false}
        onChange={onEditorChange}
        onKeyDown={onEditorKeyDown}
        onBlur={() => commitEdit()}
      />
    );
  }

  const contentH = N * rowH + rowH * 2;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={`${styles.root} ${focused ? styles.focused : ""}`}
      data-compact={compact ? "" : undefined}
      style={{ fontSize: fontPx }}
      onScroll={resetScroll}
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("textarea, [data-no-grid]") || N === 0) return;
        e.preventDefault();
        const hit = hitTest(e.clientX, e.clientY);
        if (isApp()) {
          touchMenuRef.current = true;
          suppressGhostClick();
        }
        setMenu({ x: e.clientX, y: e.clientY, r: hit.r, c: hit.c });
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setFocused(false);
      }}
    >
      <textarea
        ref={sinkRef}
        className={styles.sink}
        aria-label="Таблица"
        readOnly={isApp()}
        inputMode={isApp() ? "none" : undefined}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onChange={() => {}}
      />

      <div className={styles.corner} data-sheet-pan style={{ width: leftW, height: headerH }}>
        <div className={styles.gutterHeader} style={{ width: gutterW }} />
        {!hideFrozen &&
          frozen.map((f, i) => (
            <div
              key={f.field}
              className={`${styles.frozenHeader} ${i >= bounds.c0 && i <= bounds.c1 ? styles.headerSelected : ""}`}
              style={{ left: gutterW + frozenX[i], width: frozenX[i + 1] - frozenX[i] }}
            >
              {f.title}
            </div>
          ))}
      </div>

      <div className={styles.header} style={{ left: leftW, height: headerH }} onScroll={resetScroll}>
        <div style={{ transform: `translateX(${-scroll.left}px)`, position: "relative", height: "100%" }}>
          {headers}
        </div>
      </div>

      <div
        className={styles.left}
        data-sheet-pan
        style={{ top: headerH, width: leftW }}
        onWheel={onWheelFrozen}
        onScroll={resetScroll}
      >
        <div style={{ transform: `translateY(${-scroll.top}px)`, position: "relative", height: contentH }}>
          {leftCells}
          {!hideFrozen && (
            <button
              className={styles.addRow}
              style={{ top: N * rowH, width: leftW }}
              onClick={() => void useStore.getState().addRow(panel)}
            >
              + Добавить строку
            </button>
          )}
          {selR && overlay(selR.frozenRect, `${styles.selRange} ${multi && !soleBlock ? "" : styles.selSingle}`, "sf")}
          {activeR && overlay(activeR.frozenRect, styles.selActive, "af")}
          {cutR && overlay(cutR.frozenRect, styles.cutRect, "cf")}
          {fillR && overlay(fillR.frozenRect, styles.fillPreview, "ff")}
          {editing && editing.c < K && !hideFrozen && editorNode}
        </div>
      </div>

      <div ref={bodyRef} className={styles.body} style={{ left: leftW, top: headerH }} onScroll={onScroll}>
        <div
          className={styles.bodyInner}
          style={{
            width: D * colW,
            height: contentH,
            backgroundSize: `${colW}px ${rowH}px`,
            ["--rows-h" as string]: `${N * rowH}px`,
          }}
        >
          {columnDecor}
          {bodyCells}
          {hideFrozen && (
            <button
              className={styles.addRow}
              style={{ top: N * rowH, width: "auto", zIndex: 1 }}
              onClick={() => void useStore.getState().addRow(panel)}
            >
              + Добавить строку
            </button>
          )}
          {selR && overlay(selR.bodyRect, `${styles.selRange} ${multi && !soleBlock ? "" : styles.selSingle}`, "sb")}
          {activeR && overlay(activeR.bodyRect, styles.selActive, "ab")}
          {cutR && overlay(cutR.bodyRect, styles.cutRect, "cb")}
          {fillR && overlay(fillR.bodyRect, styles.fillPreview, "fb")}
          {hasRows && bounds.c1 >= K && !editing && (
            <div
              className={styles.fillHandle}
              style={{ left: (bounds.c1 - K + 1) * colW - 4, top: (bounds.r1 + 1) * rowH - 4 }}
              onMouseDown={onFillHandleDown}
            />
          )}
          {editing && editing.c >= K && editorNode}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {history && (
        <CellHistory
          x={history.x}
          y={history.y}
          rowId={history.rowId}
          day={history.day}
          onClose={() => setHistory(null)}
        />
      )}
      {noteEdit && rowIds[noteEdit.r] && noteEdit.c >= K && (
        <CommentBox
          x={noteEdit.x}
          y={noteEdit.y}
          initial={cells.get(cellKey(rowIds[noteEdit.r], days[noteEdit.c - K]))?.comment ?? ""}
          onClose={() => setNoteEdit(null)}
          onSave={(comment) => {
            applyEdits([{ rowId: rowIds[noteEdit.r], col: colKey(noteEdit.c), comment }]);
            setNoteEdit(null);
          }}
        />
      )}
      {tip && !noteEdit && !history && !menu && (
        <div className={styles.tip} style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
