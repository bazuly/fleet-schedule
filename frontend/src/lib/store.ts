"use client";

import { create } from "zustand";
import { addDays, todayIso } from "./dates";
import { api, type CalendarView, type Cell, type Panel, type Row, type RowField, type RowPatch, type User } from "./api";

/** Ключ колонки: "f:driver" — закреплённое поле строки, "d:2026-11-25" — день графика. */
export type ColKey = string;

export const fieldCol = (f: RowField): ColKey => `f:${f}`;
export const dayCol = (day: string): ColKey => `d:${day}`;
export const isDayCol = (c: ColKey) => c.startsWith("d:");
export const colDay = (c: ColKey) => c.slice(2);
export const colField = (c: ColKey) => c.slice(2) as RowField;

export const cellKey = (rowId: string, day: string) => `${rowId}|${day}`;

export interface CellData {
  value: string;
  bg: string | null;
  fg: string | null;
  comment: string;
  /** Сколько дней занимает ячейка. 1 — обычная клетка. */
  span: number;
}

export const EMPTY_CELL: CellData = { value: "", bg: null, fg: null, comment: "", span: 1 };

export function isBlank(c: CellData): boolean {
  return (c.span ?? 1) <= 1 && !c.value && !c.bg && !c.fg && !c.comment;
}

export function toCellData(c: Cell): CellData {
  return { value: c.value, bg: c.bg, fg: c.fg, comment: c.comment ?? "", span: c.span || 1 };
}

export interface Edit {
  rowId: string;
  col: ColKey;
  value?: string;
  bg?: string | null;
  fg?: string | null;
  comment?: string;
  span?: number;
}

interface Batch {
  cellsBefore: Cell[];
  cellsAfter: Cell[];
  rowsBefore: RowPatch[];
  rowsAfter: RowPatch[];
}

export interface ActiveSelection {
  gridId: Panel;
  rowIds: string[];
  colKeys: ColKey[];
  anchorRowId: string;
  anchorCol: ColKey;
}

export interface ClipboardData {
  tsv: string;
  values: string[][];
  bgs: (string | null)[][];
  fgs: (string | null)[][];
  comments: string[][];
  spans: number[][];
  cut?: { gridId: Panel; rowIds: string[]; colKeys: ColKey[] };
}

export type WsStatus = "connecting" | "online" | "offline";

export interface MapTarget {
  rowId: string;
  title: string;
  units: { kind: "tractor" | "trailer"; text: string }[];
}

interface State {
  user: User | null;
  rows: Record<string, Row>;
  cells: Map<string, CellData>;
  range: { from: string; to: string };
  /** День, к которому прокручен график. Общий для всех пользователей. */
  focusDay: string | null;
  loading: boolean;
  wsStatus: WsStatus;
  toast: string | null;

  undoStack: Batch[];
  redoStack: Batch[];
  clipboard: ClipboardData | null;
  active: ActiveSelection | null;
  syncScroll: boolean;
  /** 1 = 100%, как в Google Таблицах. */
  zoom: number;
  mapTargets: MapTarget[];

  setUser(u: User | null): void;
  setRange(from: string, to: string): Promise<void>;
  setFocusDay(day: string): void;
  loadCalendar(): Promise<void>;
  loadAll(): Promise<void>;
  setWsStatus(s: WsStatus): void;
  showToast(msg: string): void;

  applyRemoteCells(cells: Cell[]): void;
  applyRemoteRows(rows: Row[]): void;
  removeRowLocal(id: string): void;

  applyEdits(edits: Edit[]): void;
  undo(): void;
  redo(): void;

  setClipboard(c: ClipboardData | null): void;
  setActive(a: ActiveSelection | null): void;
  setSyncScroll(v: boolean): void;
  setZoom(z: number): void;
  stepZoom(dir: 1 | -1): void;
  openMap(t: MapTarget): void;
  closeMap(rowId: string): void;
  applyBgToActive(bg: string | null): void;
  applyFgToActive(fg: string | null): void;
  mergeActive(): void;
  setRowStatus(rowId: string, status: string): void;

  addRow(panel: Panel): Promise<void>;
  insertRow(refId: string, where: "above" | "below"): Promise<void>;
  moveRow(id: string, dir: -1 | 1): void;
  deleteRow(id: string): Promise<void>;
}

const UNDO_LIMIT = 200;
const ZOOM_KEY = "fleet.zoom";
export const ZOOMS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];

function defaultRange() {
  const today = todayIso();
  // План загружен с октября 2025; вперёд оставляем запас после сегодняшнего дня.
  const end = addDays(today, 40);
  return { from: "2025-10-01", to: end > "2026-12-31" ? end : "2026-12-31" };
}

export function sortedRowIds(rows: Record<string, Row>, panel: Panel): string[] {
  return Object.values(rows)
    .filter((r) => r.panel === panel)
    .sort((a, b) => a.position - b.position)
    .map((r) => r.id);
}

let focusSaveTimer: ReturnType<typeof setTimeout> | null = null;

function rememberCalendar(view: CalendarView) {
  if (focusSaveTimer) clearTimeout(focusSaveTimer);
  focusSaveTimer = setTimeout(() => {
    api.saveCalendar(view).catch((e) => {
      useStore.getState().showToast(`Не удалось сохранить период: ${(e as Error).message}`);
    });
  }, 500);
}

export const useStore = create<State>((set, get) => {
  /** Применяет пакет локально и отправляет его на сервер. */
  function commit(cells: Cell[], patches: RowPatch[]) {
    if (cells.length) {
      const next = new Map(get().cells);
      for (const c of cells) {
        const k = cellKey(c.row_id, c.day);
        const data = toCellData(c);
        if (isBlank(data)) next.delete(k);
        else next.set(k, data);
      }
      set({ cells: next });
      api.putCells(cells).catch((e) => {
        get().showToast(`Не удалось сохранить: ${e.message}`);
        void get().loadAll();
      });
    }
    if (patches.length) {
      const rows = { ...get().rows };
      for (const p of patches) {
        if (rows[p.id]) rows[p.id] = { ...rows[p.id], ...p };
      }
      set({ rows });
      api.patchRows(patches).catch((e) => {
        get().showToast(`Не удалось сохранить: ${e.message}`);
        void get().loadAll();
      });
    }
  }

  return {
    user: null,
    rows: {},
    cells: new Map(),
    range: defaultRange(),
    focusDay: null,
    loading: false,
    wsStatus: "connecting",
    toast: null,
    undoStack: [],
    redoStack: [],
    clipboard: null,
    active: null,
    syncScroll: true,
    zoom: 1,
    mapTargets: [],

    setUser: (user) => set({ user }),

    async loadCalendar() {
      try {
        const view = await api.calendar();
        if (view && view.from && view.to && view.from <= view.to) {
          set({ range: { from: view.from, to: view.to }, focusDay: view.focus || view.from });
        }
      } catch {
        // Период по умолчанию, если сервер ещё без сохранённого вида.
      }
    },

    setFocusDay(day) {
      if (!day || get().focusDay === day) return;
      const { range } = get();
      if (day < range.from || day > range.to) return;
      set({ focusDay: day });
      rememberCalendar({ from: range.from, to: range.to, focus: day });
    },

    async setRange(from, to) {
      if (!from || !to || from > to) return;
      if (from === get().range.from && to === get().range.to) return;
      let focus = get().focusDay;
      if (!focus || focus < from || focus > to) focus = from;
      if (focusSaveTimer) clearTimeout(focusSaveTimer);
      set({ range: { from, to }, focusDay: focus });
      try {
        const saved = await api.saveCalendar({ from, to, focus });
        set({ range: { from: saved.from, to: saved.to }, focusDay: saved.focus });
      } catch (e) {
        get().showToast(`Не удалось сохранить период: ${(e as Error).message}`);
      }
      await get().loadAll();
    },

    async loadAll() {
      set({ loading: true });
      try {
        const { from, to } = get().range;
        const [rows, cells] = await Promise.all([api.rows(), api.cells(from, to)]);
        const rowMap: Record<string, Row> = {};
        for (const r of rows) rowMap[r.id] = r;
        const cellMap = new Map<string, CellData>();
        for (const c of cells) {
          cellMap.set(cellKey(c.row_id, c.day), toCellData(c));
        }
        set({ rows: rowMap, cells: cellMap });
      } catch (e) {
        get().showToast(`Ошибка загрузки: ${(e as Error).message}`);
      } finally {
        set({ loading: false });
      }
    },

    setWsStatus: (wsStatus) => set({ wsStatus }),

    showToast(msg) {
      set({ toast: msg });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null });
      }, 4000);
    },

    applyRemoteCells(cells) {
      const { from, to } = get().range;
      const next = new Map(get().cells);
      for (const c of cells) {
        if (c.day < from || c.day > to) continue;
        const k = cellKey(c.row_id, c.day);
        const data = toCellData(c);
        if (isBlank(data)) next.delete(k);
        else next.set(k, data);
      }
      set({ cells: next });
    },

    applyRemoteRows(incoming) {
      const rows = { ...get().rows };
      for (const r of incoming) rows[r.id] = r;
      set({ rows });
    },

    removeRowLocal(id) {
      const rows = { ...get().rows };
      delete rows[id];
      const cells = new Map(get().cells);
      for (const k of cells.keys()) if (k.startsWith(`${id}|`)) cells.delete(k);
      set({ rows, cells, mapTargets: get().mapTargets.filter((t) => t.rowId !== id) });
    },

    applyEdits(edits) {
      const { cells, rows } = get();
      const cellsBefore: Cell[] = [];
      const cellsAfter: Cell[] = [];
      const rowsBefore = new Map<string, RowPatch>();
      const rowsAfter = new Map<string, RowPatch>();
      const seen = new Set<string>();

      for (const e of edits) {
        const dedupKey = `${e.rowId}|${e.col}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        if (!rows[e.rowId]) continue;

        if (isDayCol(e.col)) {
          const day = colDay(e.col);
          const prev = cells.get(cellKey(e.rowId, day)) ?? EMPTY_CELL;
          const value = e.value ?? prev.value;
          const bg = e.bg !== undefined ? e.bg : prev.bg;
          const fg = e.fg !== undefined ? e.fg : prev.fg;
          const comment = e.comment !== undefined ? e.comment : prev.comment;
          let span = e.span !== undefined ? Math.max(1, Math.min(62, e.span)) : prev.span || 1;
          // Пустая клетка не может оставаться объединением, если ширину не задали явно.
          if (!value && !bg && !fg && !comment && !(e.span !== undefined && e.span > 1)) span = 1;
          if (value === prev.value && bg === prev.bg && fg === prev.fg && comment === prev.comment && span === (prev.span || 1))
            continue;
          cellsBefore.push({ row_id: e.rowId, day, ...prev, span: prev.span || 1 });
          cellsAfter.push({ row_id: e.rowId, day, value, bg, fg, comment, span });
        } else if (e.value !== undefined) {
          const field = colField(e.col);
          const prev = rows[e.rowId][field];
          if (prev === e.value) continue;
          rowsBefore.set(e.rowId, { ...rowsBefore.get(e.rowId), id: e.rowId, [field]: prev });
          rowsAfter.set(e.rowId, { ...rowsAfter.get(e.rowId), id: e.rowId, [field]: e.value });
        }
      }

      if (!cellsAfter.length && !rowsAfter.size) return;
      const batch: Batch = {
        cellsBefore,
        cellsAfter,
        rowsBefore: [...rowsBefore.values()],
        rowsAfter: [...rowsAfter.values()],
      };
      set({
        undoStack: [...get().undoStack.slice(-UNDO_LIMIT + 1), batch],
        redoStack: [],
      });
      commit(batch.cellsAfter, batch.rowsAfter);
    },

    undo() {
      const stack = get().undoStack;
      const batch = stack[stack.length - 1];
      if (!batch) return;
      set({ undoStack: stack.slice(0, -1), redoStack: [...get().redoStack, batch] });
      commit(batch.cellsBefore, batch.rowsBefore);
    },

    redo() {
      const stack = get().redoStack;
      const batch = stack[stack.length - 1];
      if (!batch) return;
      set({ redoStack: stack.slice(0, -1), undoStack: [...get().undoStack, batch] });
      commit(batch.cellsAfter, batch.rowsAfter);
    },

    setClipboard: (clipboard) => set({ clipboard }),
    setActive: (active) => set({ active }),
    setSyncScroll: (syncScroll) => set({ syncScroll }),
    setZoom(zoom) {
      const next = ZOOMS.includes(zoom) ? zoom : 1;
      localStorage.setItem(ZOOM_KEY, String(next));
      set({ zoom: next });
    },
    stepZoom(dir) {
      const current = get().zoom;
      const index = Math.max(0, ZOOMS.indexOf(current));
      get().setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index + dir))]);
    },
    openMap(target) {
      const rest = get().mapTargets.filter((t) => t.rowId !== target.rowId);
      set({ mapTargets: [...rest, target] });
    },
    closeMap(rowId) {
      set({ mapTargets: get().mapTargets.filter((t) => t.rowId !== rowId) });
    },

    applyBgToActive(bg) {
      const a = get().active;
      if (!a) return;
      const edits: Edit[] = [];
      for (const rowId of a.rowIds)
        for (const col of a.colKeys) if (isDayCol(col)) edits.push({ rowId, col, bg });
      get().applyEdits(edits);
    },

    applyFgToActive(fg) {
      const a = get().active;
      if (!a) return;
      const edits: Edit[] = [];
      for (const rowId of a.rowIds)
        for (const col of a.colKeys) if (isDayCol(col)) edits.push({ rowId, col, fg });
      get().applyEdits(edits);
    },

    mergeActive() {
      const a = get().active;
      if (!a) return;
      const days = [...new Set(a.colKeys.filter(isDayCol).map(colDay))].sort();
      if (days.length < 2) {
        get().showToast("Выделите несколько дней в одной или нескольких строках");
        return;
      }
      const spanDays: string[] = [];
      for (let day = days[0]; day <= days[days.length - 1]; day = addDays(day, 1)) spanDays.push(day);
      if (spanDays.length > 62) {
        get().showToast("Нельзя объединить больше 62 дней");
        return;
      }
      const { cells } = get();
      const edits: Edit[] = [];
      let losesText = false;
      for (const rowId of a.rowIds) {
        const anchor = cells.get(cellKey(rowId, spanDays[0])) ?? EMPTY_CELL;
        for (const day of spanDays.slice(1)) {
          const cell = cells.get(cellKey(rowId, day));
          if (cell?.value) losesText = true;
          if (cell) edits.push({ rowId, col: dayCol(day), value: "", bg: null, fg: null, comment: "", span: 1 });
        }
        edits.push({
          rowId,
          col: dayCol(spanDays[0]),
          value: anchor.value,
          bg: anchor.bg,
          fg: anchor.fg,
          comment: anchor.comment,
          span: spanDays.length,
        });
      }
      if (losesText && !confirm("Объединить ячейки? Останется только текст левой ячейки в каждой строке.")) return;
      get().applyEdits(edits);
    },

    setRowStatus(rowId, status) {
      const row = get().rows[rowId];
      if (!row || (row.status || "") === status) return;
      const before: RowPatch = { id: rowId, status: row.status || "" };
      const after: RowPatch = { id: rowId, status };
      set({
        undoStack: [...get().undoStack.slice(-UNDO_LIMIT + 1), { cellsBefore: [], cellsAfter: [], rowsBefore: [before], rowsAfter: [after] }],
        redoStack: [],
      });
      commit([], [after]);
    },

    async addRow(panel) {
      try {
        const row = await api.createRow({ panel });
        get().applyRemoteRows([row]);
      } catch (e) {
        get().showToast(`Не удалось добавить строку: ${(e as Error).message}`);
      }
    },

    async insertRow(refId, where) {
      const { rows } = get();
      const ref = rows[refId];
      if (!ref) return;
      const ids = sortedRowIds(rows, ref.panel);
      const idx = ids.indexOf(refId);
      let position: number;
      if (where === "above") {
        const prev = idx > 0 ? rows[ids[idx - 1]].position : ref.position - 1;
        position = (prev + ref.position) / 2;
      } else {
        const next = idx < ids.length - 1 ? rows[ids[idx + 1]].position : ref.position + 1;
        position = (ref.position + next) / 2;
      }
      try {
        const row = await api.createRow({ panel: ref.panel, position });
        get().applyRemoteRows([row]);
      } catch (e) {
        get().showToast(`Не удалось добавить строку: ${(e as Error).message}`);
      }
    },

    moveRow(id, dir) {
      const { rows } = get();
      const row = rows[id];
      if (!row) return;
      const ids = sortedRowIds(rows, row.panel);
      const idx = ids.indexOf(id);
      const other = rows[ids[idx + dir]];
      if (!other) return;
      commit([], [
        { id: row.id, position: other.position },
        { id: other.id, position: row.position },
      ]);
    },

    async deleteRow(id) {
      try {
        await api.deleteRow(id);
        get().removeRowLocal(id);
      } catch (e) {
        get().showToast(`Не удалось удалить строку: ${(e as Error).message}`);
      }
    },
  };
});

type ScrollListener = (source: string, left: number) => void;
type DayListener = (day: string) => void;

/** Шина для синхронной горизонтальной прокрутки графика и плавающих окон. */
export const scrollBus = {
  listeners: new Set<ScrollListener>(),
  dayListeners: new Set<DayListener>(),
  emit(source: string, left: number) {
    for (const l of this.listeners) l(source, left);
  },
  subscribe(l: ScrollListener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  },
  scrollToDay(day: string) {
    for (const l of this.dayListeners) l(day);
  },
  subscribeDay(l: DayListener) {
    this.dayListeners.add(l);
    return () => void this.dayListeners.delete(l);
  },
};
