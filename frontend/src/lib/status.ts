/** Ручной статус строки. Пустая строка — заливки нет. */
export const ROW_STATUSES = [
  { id: "work", label: "В работе", fill: "#fce5cd" },
  { id: "dayoff", label: "Выходной", fill: "#ffe566" },
  { id: "sick", label: "Больничный", fill: "#ffe566" },
  { id: "free", label: "Свободен", fill: "#93c47d" },
  { id: "repair", label: "Ремонт", fill: "#ef5350" },
] as const;

export type RowStatus = (typeof ROW_STATUSES)[number]["id"];

export function statusFill(status: string | undefined | null): string | undefined {
  return ROW_STATUSES.find((s) => s.id === status)?.fill;
}
