const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** Даты везде храним как строки YYYY-MM-DD в UTC, чтобы не зависеть от часового пояса. */
export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function fromIso(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function todayIso(): string {
  const now = new Date();
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = fromIso(to).getTime();
  for (let d = fromIso(from); d.getTime() <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(toIso(d));
  }
  return out;
}

export function formatDayHeader(iso: string): { date: string; weekday: string; weekend: boolean } {
  const d = fromIso(iso);
  const dow = d.getUTCDay();
  return {
    date: `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    weekday: WEEKDAYS[dow],
    weekend: dow === 0 || dow === 6,
  };
}

export function isFirstOfMonth(iso: string): boolean {
  return iso.endsWith("-01");
}
