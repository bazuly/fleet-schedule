"""Импорт листа «МСК 20 тонн» из выгрузки Google Sheets (xlsx), начиная с октября 2025.

Заливка объединённых ячеек в файле хранится только у первой ячейки — копируем её
на остальные дни блока, чтобы цвет в графике совпадал с таблицей.
Заметки ячеек становятся комментариями.

Запуск (из корня репозитория, база уже с миграциями):
    .import/venv/bin/python scripts/import_sheet.py .import/plan.xlsx
"""

import json
import subprocess
import sys
import urllib.request
from datetime import date, datetime

import openpyxl

API = "http://localhost:8080/api"

START = date(2025, 10, 1)
SECTION_TITLES = {"НЕРАСПРЕДЕЛЕННОЕ", "Забор продукции"}


def panel_of(row: int) -> str:
    if 4 <= row <= 16:
        return "unassigned"
    if 75 <= row <= 84:
        return "pickups"
    return "main"


def hex_color(color, skip_black: bool) -> str | None:
    if color is None or color.type != "rgb" or not isinstance(color.rgb, str):
        return None
    raw = color.rgb
    if len(raw) != 8 or raw in ("00000000", "FFFFFFFF"):
        return None
    if skip_black and raw[2:] == "000000":
        return None
    return "#" + raw[2:].lower()


def text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    return str(value).strip()


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else ".import/plan.xlsx"
    wb = openpyxl.load_workbook(path, data_only=False)
    ws = wb[wb.sheetnames[0]]

    dates: dict[int, date] = {}
    for col in range(4, ws.max_column + 1):
        value = ws.cell(1, col).value
        if isinstance(value, datetime) and value.date() >= START:
            dates[col] = value.date()

    # (row, col) -> cell payload. Заливку блока дописываем после обхода.
    payloads: dict[tuple[int, int], dict] = {}
    for row in range(3, 97):
        if row == 21:
            continue
        for col, day in dates.items():
            cell = ws.cell(row, col)
            bg = None
            if cell.fill and cell.fill.patternType == "solid":
                bg = hex_color(cell.fill.fgColor, skip_black=False)
            fg = hex_color(cell.font.color, skip_black=True) if cell.font else None
            comment = cell.comment.text.strip() if cell.comment and cell.comment.text else ""
            value = text(cell.value)
            if value or bg or fg or comment:
                payloads[(row, col)] = {
                    "day": day,
                    "value": value,
                    "bg": bg,
                    "fg": fg,
                    "comment": comment,
                }

    for merge in ws.merged_cells.ranges:
        if merge.min_row < 3 or merge.min_row > 96 or merge.min_col not in dates:
            continue
        anchor = payloads.get((merge.min_row, merge.min_col))
        if not anchor or not anchor["bg"]:
            continue
        for col in range(merge.min_col + 1, merge.max_col + 1):
            if col not in dates:
                continue
            key = (merge.min_row, col)
            cell = payloads.get(key)
            if cell is None:
                payloads[key] = {
                    "day": dates[col],
                    "value": "",
                    "bg": anchor["bg"],
                    "fg": None,
                    "comment": "",
                }
            elif not cell["bg"]:
                cell["bg"] = anchor["bg"]

    planned = []
    for row in range(3, 97):
        if row == 21:
            continue
        has_cells = any(key[0] == row for key in payloads)
        label = text(ws.cell(row, 1).value)
        tractor = text(ws.cell(row, 2).value)
        trailer = text(ws.cell(row, 3).value)
        if not has_cells and not label and not tractor and not trailer:
            continue
        panel = panel_of(row)
        is_title = label in SECTION_TITLES
        if panel == "main":
            driver, note = label, ""
        else:
            driver, note = "", "" if is_title else label
        planned.append((row, panel, driver, tractor, trailer, note))

    subprocess.run(
        ["docker", "exec", "-i", "fleet-schedule-db-1", "psql", "-U", "fleet", "-d", "fleet", "-c",
         "TRUNCATE schedule_rows CASCADE;"],
        check=True,
        capture_output=True,
    )

    token = call("POST", "/auth/login", {"login": "admin", "password": "admin"})["token"]
    id_by_row: dict[int, str] = {}
    notes = []
    for row, panel, driver, tractor, trailer, note in planned:
        created = call(
            "POST",
            "/rows",
            {"panel": panel, "position": float(row), "driver": driver, "tractor": tractor, "trailer": trailer},
            token,
        )
        id_by_row[row] = created["id"]
        if note:
            notes.append({"id": created["id"], "note": note})
    if notes:
        call("PATCH", "/rows", notes, token)

    cells_out = []
    for (row, _col), cell in payloads.items():
        row_id = id_by_row.get(row)
        if not row_id:
            continue
        if not (cell["value"] or cell["bg"] or cell["fg"] or cell["comment"]):
            continue
        cells_out.append(
            {
                "row_id": row_id,
                "day": cell["day"].isoformat(),
                "value": cell["value"],
                "bg": cell["bg"],
                "fg": cell["fg"],
                "comment": cell["comment"],
            }
        )
    for i in range(0, len(cells_out), 4000):
        call("PUT", "/cells", {"cells": cells_out[i : i + 4000]}, token)
    print(f"rows {len(planned)}, cells {len(cells_out)}")


def call(method: str, path: str, body: object, token: str | None = None):
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers=headers, method=method)
    with urllib.request.urlopen(request) as response:
        return json.load(response)


if __name__ == "__main__":
    main()
