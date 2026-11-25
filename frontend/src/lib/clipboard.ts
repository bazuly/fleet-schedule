/** Сериализация в TSV, совместимая с Excel и Google Sheets. */
export function toTsv(matrix: string[][]): string {
  return matrix
    .map((row) =>
      row
        .map((v) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
        .join("\t"),
    )
    .join("\n");
}

export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === "\t") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  row.push(field);
  rows.push(row);
  // Excel добавляет перевод строки в конце — отбрасываем пустой хвост.
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/** HTML-таблица нужна, чтобы при вставке в Excel/Sheets сохранялась заливка. */
export function toHtmlTable(values: string[][], bgs: (string | null)[][], fgs: (string | null)[][]): string {
  const body = values
    .map((row, r) => {
      const cells = row.map((v, c) => {
        const style = [
          bgs[r]?.[c] ? `background-color:${bgs[r][c]}` : "",
          fgs[r]?.[c] ? `color:${fgs[r][c]}` : "",
        ]
          .filter(Boolean)
          .join(";");
        return `<td${style ? ` style="${style}"` : ""}>${escapeHtml(v)}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  return `<table>${body}</table>`;
}
