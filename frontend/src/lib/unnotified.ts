import type { Row } from "./api";
import { addDays } from "./dates";
import { cellKey, sortedRowIds, type CellData } from "./store";
import { pendingDayLabel } from "./pending";

export interface UnnotifiedTrip {
  rowId: string;
  anchor: string;
  days: string[];
  bucket: "today" | "tomorrow";
  /** Текст рейса. */
  value: string;
  /** Фамилия или машина, чтобы было понятно, кого не оповестили. */
  who: string;
}

/** Эти слова сами по себе не требуют звонка водителю. */
const SKIP_WORDS = ["ремонт", "выходной", "отпуск", "больничный", "то", "город", "простой", "в работе"];

function escapeRe(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text: string, word: string): boolean {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

/** Пустая клетка и служебные пометки вроде «Ремонт» или «простой» не считаются рейсом. */
export function isExemptTrip(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  return SKIP_WORDS.some((word) => hasWord(text, word));
}

/** Диспетчер красит надпись жёлтым, когда водитель уже оповещён. */
export function isNotifiedColor(fg: string | null | undefined): boolean {
  const color = fg?.trim().toLowerCase();
  return color === "#ffff00" || color === "#ff0" || color === "yellow";
}

function classify(day: string, today: string, tomorrow: string): "today" | "tomorrow" | null {
  if (day === today) return "today";
  if (day === tomorrow) return "tomorrow";
  return null;
}

function whoOf(row: Row): string {
  return (row.driver || row.tractor || row.trailer).split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

/** Рейсы основного графика на сегодня и завтра, где текст ещё не жёлтый. */
export function unnotifiedTrips(rows: Record<string, Row>, cells: Map<string, CellData>, today: string): UnnotifiedTrip[] {
  const tomorrow = addDays(today, 1);
  const order = new Map<string, number>();
  sortedRowIds(rows, "main").forEach((id, index) => order.set(id, index));

  const trips: UnnotifiedTrip[] = [];
  for (const [key, cell] of cells) {
    const split = key.indexOf("|");
    if (split < 0) continue;
    const rowId = key.slice(0, split);
    const anchor = key.slice(split + 1);
    const row = rows[rowId];
    if (!row || row.panel !== "main") continue;
    if (cellKey(rowId, anchor) !== key) continue;
    if (isExemptTrip(cell.value) || isNotifiedColor(cell.fg)) continue;

    const span = cell.span || 1;
    const days: string[] = [];
    let bucket: "today" | "tomorrow" | null = null;
    for (let i = 0; i < span; i++) {
      const day = i === 0 ? anchor : addDays(anchor, i);
      const kind = classify(day, today, tomorrow);
      if (!kind) continue;
      days.push(day);
      if (!bucket || kind === "today") bucket = kind;
    }
    if (!bucket || !days.length) continue;
    trips.push({ rowId, anchor, days, bucket, value: cell.value.trim(), who: whoOf(row) });
  }

  const rank = { today: 0, tomorrow: 1 };
  trips.sort((a, b) => {
    if (a.bucket !== b.bucket) return rank[a.bucket] - rank[b.bucket];
    return (order.get(a.rowId) ?? 0) - (order.get(b.rowId) ?? 0);
  });
  return trips;
}

export function unnotifiedLabel(trip: UnnotifiedTrip, today: string): string {
  const when = pendingDayLabel(trip.days, today);
  return trip.who ? `${when} · ${trip.who}` : when;
}
