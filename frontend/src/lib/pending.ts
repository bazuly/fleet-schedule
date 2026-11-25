import type { Row } from "./api";
import { addDays, formatDayHeader } from "./dates";
import { cellKey, sortedRowIds, type CellData } from "./store";

export type PendingBucket = "overdue" | "today" | "tomorrow";

export interface PendingTask {
  panel: "unassigned" | "pickups";
  rowId: string;
  /** День, в котором лежит текст задания. */
  anchor: string;
  /** Дни до завтра включительно, которых касается задание. */
  days: string[];
  bucket: PendingBucket;
  value: string;
}

/** Просрочка старше этого окна — архив листа, в счётчике колокольчика её нет. */
export const OVERDUE_WINDOW_DAYS = 14;

const PANELS = ["unassigned", "pickups"] as const;
const BUCKET_ORDER: Record<PendingBucket, number> = { today: 0, tomorrow: 1, overdue: 2 };

function classify(day: string, today: string, tomorrow: string): PendingBucket | null {
  if (day < today) return "overdue";
  if (day === today) return "today";
  if (day === tomorrow) return "tomorrow";
  return null;
}

function prefer(current: PendingBucket | null, next: PendingBucket): PendingBucket {
  const urgency: Record<PendingBucket, number> = { overdue: 0, today: 1, tomorrow: 2 };
  if (!current || urgency[next] < urgency[current]) return next;
  return current;
}

/** Задания из «Нераспределённого» и «Заборов», которые ещё не стоят в графике. */
export function pendingTasks(
  rows: Record<string, Row>,
  cells: Map<string, CellData>,
  today: string,
): PendingTask[] {
  const tomorrow = addDays(today, 1);
  const rowOrder = new Map<string, number>();
  for (const panel of PANELS) {
    sortedRowIds(rows, panel).forEach((id, index) => rowOrder.set(id, index));
  }

  const tasks: PendingTask[] = [];
  for (const [key, cell] of cells) {
    const split = key.indexOf("|");
    if (split < 0) continue;
    const rowId = key.slice(0, split);
    const anchor = key.slice(split + 1);
    const row = rows[rowId];
    if (!row || (row.panel !== "unassigned" && row.panel !== "pickups")) continue;
    const value = cell.value.trim();
    if (!value) continue;
    if (cellKey(rowId, anchor) !== key) continue;

    const span = cell.span || 1;
    const days: string[] = [];
    let bucket: PendingBucket | null = null;
    for (let i = 0; i < span; i++) {
      const day = i === 0 ? anchor : addDays(anchor, i);
      const kind = classify(day, today, tomorrow);
      if (!kind) continue;
      days.push(day);
      bucket = prefer(bucket, kind);
    }
    if (!bucket || !days.length) continue;
    tasks.push({ panel: row.panel, rowId, anchor, days, bucket, value });
  }

  tasks.sort((a, b) => {
    if (a.bucket !== b.bucket) return BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (a.bucket === "overdue") {
      const ad = a.days[a.days.length - 1];
      const bd = b.days[b.days.length - 1];
      if (ad !== bd) return ad < bd ? 1 : -1;
    }
    if (a.panel !== b.panel) return a.panel === "unassigned" ? -1 : 1;
    return (rowOrder.get(a.rowId) ?? 0) - (rowOrder.get(b.rowId) ?? 0);
  });
  return tasks;
}

export function isRecentOverdue(task: PendingTask, today: string): boolean {
  const cutoff = addDays(today, -OVERDUE_WINDOW_DAYS);
  return task.days.some((day) => day >= cutoff);
}

export function pendingDayLabel(days: string[], today: string): string {
  const tomorrow = addDays(today, 1);
  const names = days.map((day) => {
    if (day === today) return "сегодня";
    if (day === tomorrow) return "завтра";
    const header = formatDayHeader(day);
    return `${header.date} ${header.weekday}`;
  });
  if (names.length <= 2) return names.join(" и ");
  return `${names[0]} — ${names[names.length - 1]}`;
}
