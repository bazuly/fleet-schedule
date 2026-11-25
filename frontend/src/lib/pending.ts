import type { Row } from "./api";
import { addDays } from "./dates";
import { cellKey, sortedRowIds, type CellData } from "./store";

export interface PendingTask {
  panel: "unassigned" | "pickups";
  rowId: string;
  /** День, в котором лежит текст задания. */
  anchor: string;
  /** Сегодня и/или завтра, которых касается задание. */
  days: string[];
  value: string;
}

const PANELS = ["unassigned", "pickups"] as const;

/** Задания из «Нераспределённого» и «Заборов» на сегодня и завтра ещё не разнесены по графику. */
export function pendingTasks(
  rows: Record<string, Row>,
  cells: Map<string, CellData>,
  today: string,
): PendingTask[] {
  const tomorrow = addDays(today, 1);
  const watch = new Set([today, tomorrow]);
  const tasks: PendingTask[] = [];

  for (const panel of PANELS) {
    for (const rowId of sortedRowIds(rows, panel)) {
      const seen = new Set<string>();
      for (const probe of [today, tomorrow]) {
        for (let back = 0; back < 62; back++) {
          const anchor = addDays(probe, -back);
          const cell = cells.get(cellKey(rowId, anchor));
          if (!cell) continue;
          const span = cell.span || 1;
          if (span <= back) continue;
          const value = cell.value.trim();
          if (!value || seen.has(anchor)) break;
          seen.add(anchor);
          const days: string[] = [];
          for (let i = 0; i < span; i++) {
            const day = addDays(anchor, i);
            if (watch.has(day)) days.push(day);
          }
          if (days.length) tasks.push({ panel, rowId, anchor, days, value });
          break;
        }
      }
    }
  }
  return tasks;
}
