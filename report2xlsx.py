#!/usr/bin/env python3
"""Parse structured unit reports (Ukrainian) into a spreadsheet.

Input: plain text, one or more reports. A new report starts at a "Дата:" line.
Output: .xlsx with two sheets — one row per report, and an ammunition sheet
(one row per ammunition type per report).

Standard library only.
"""

import re
import sys
import zipfile

FIELD_KEYS = [
    ("date", r"Дата"),
    ("time", r"Час"),
    ("target_no", r"№\s*цілі"),
    ("result", r"Результат"),
    ("settlement", r"Н\.?\s?П\.?"),
    ("region", r"Обл\."),
    ("unit", r"Підрозділ"),
    ("callsign", r"Позивний"),
    ("weapon", r"Зброя"),
    ("height", r"Висота"),
    ("description", r"Опис"),
    ("comment", r"Коментар"),
]

# Platform names may contain their own parentheses, e.g. "(ЗУ-23-4(2))",
# so the greedy group is anchored to the trailing count instead of the paren.
# Caliber is written "12,7х99", "23х152" or a single number like "40": the
# separator is the Cyrillic letter х (U+0445) or a Latin x, and the decimal
# comma is optional. The count separator may be a hyphen, en- or em-dash.
AMMO_RE = re.compile(
    r"Набій\s+([0-9]+(?:[.,][0-9]+)?(?:\s*[хx\u0445\u00d7X]\s*[0-9]+)?)\s*мм"
    r"(?:\s*\((.*)\))?"
    r"\s*[-\u2013\u2014]\s*([0-9]+)",
    re.I,
)

# Artillery shells use "Снаряд" instead of "Набій": same shape, own sheet.
SHELL_RE = re.compile(
    r"Снаряд\s+([0-9]+(?:[.,][0-9]+)?(?:\s*[хx\u0445\u00d7X]\s*[0-9]+)?)\s*мм"
    r"(?:\s*\((.*)\))?"
    r"\s*[-\u2013\u2014]\s*([0-9]+)",
    re.I,
)

# Guided missiles: "Розхід ЗКР до ЗРК – 1".
MISSILE_RE = re.compile(
    r"Розхід\s+ЗКР[^0-9]*[-\u2013\u2014]?\s*([0-9]+)", re.I)

# A "НАБОЇ:" block lists shell types under one caliber:
#   НАБОЇ:
#   23-2  23мм
#   ОФЗ - 78
#   ОФЗТ - 20
#   5,45пс - 84
AMMO_BLOCK_HEAD = re.compile(r"^\s*НАБОЇ\s*:?\s*$", re.I)
AMMO_BLOCK_ITEM = re.compile(
    r"^\s*([0-9][0-9,.\-]*\s*(?:мм)?|[А-ЯІЇЄA-Z][\w,.\-\u0445x×]*)\s*"
    r"[-\u2013\u2014]\s*([0-9]+)\s*$", re.U)
CALIBER_CONTEXT = re.compile(r"^\s*([0-9][0-9\-]*)\s+([0-9]+)\s*мм\s*$")

REPORT_START = re.compile(r"^\s*Дата\s*:", re.I)
KEY_LINE = re.compile(
    r"^\s*(" + "|".join(p for _, p in FIELD_KEYS) + r")\s*:", re.I)


def split_reports(text):
    """Split a batch of reports into individual blocks."""
    blocks, current = [], []
    for line in text.splitlines():
        if REPORT_START.match(line):
            if current:
                blocks.append("\n".join(current).strip())
            current = [line]
        elif line.strip():
            current.append(line)
    if current:
        blocks.append("\n".join(current).strip())
    return [b for b in blocks if b]


def parse_report(block):
    """Return (report dict, ammo, shells, missiles, block_items).

    ammo   — "Набій <калібр> мм (<платформа>) - <кількість>"
    shells — same shape with "Снаряд" (artillery)
    missiles — "Розхід ЗКР до ЗРК – <кількість>"
    block    — items listed under a "НАБОЇ:" heading
    """
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    record = {}

    for key, pattern in FIELD_KEYS:
        rx = re.compile(r"^" + pattern + r"\s*:\s*(.*)$", re.I)
        value = ""
        for i, ln in enumerate(lines):
            m = rx.match(ln)
            if not m:
                continue
            value = m.group(1).strip()
            # values may wrap onto following lines that are not new fields
            j = i + 1
            while (j < len(lines) and lines[j]
                   and not KEY_LINE.match(lines[j])
                   and not AMMO_RE.search(lines[j])):
                value += " " + lines[j]
                j += 1
            break
        record[key] = value

    def collect(rx):
        out = []
        for m in rx.finditer(block):
            out.append({
                "caliber": m.group(1).replace(" ", ""),
                "platform": (m.group(2) or "").strip(),
                "count": int(m.group(3)),
            })
        return out

    ammo = collect(AMMO_RE)
    shells = collect(SHELL_RE)

    missiles = [{"count": int(m.group(1))} for m in MISSILE_RE.finditer(block)]

    # "НАБОЇ:" heading followed by "тип - кількість" lines.
    block_items = []
    caliber_ctx = ""
    in_block = False
    for ln in lines:
        if AMMO_BLOCK_HEAD.match(ln):
            in_block = True
            continue
        if not in_block:
            continue
        ctx = CALIBER_CONTEXT.match(ln)
        if ctx:
            caliber_ctx = f"{ctx.group(1)}мм"
            continue
        if KEY_LINE.match(ln) or AMMO_RE.search(ln) or SHELL_RE.search(ln):
            in_block = False
            continue
        m = AMMO_BLOCK_ITEM.match(ln)
        if m:
            block_items.append({
                "caliber": caliber_ctx,
                "type": m.group(1).strip(),
                "count": int(m.group(2)),
            })

    return record, ammo, shells, missiles, block_items


# ---------------------------------------------------------------- xlsx writer

def col_letter(idx):
    letters = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def esc(v):
    t = str(v if v is not None else "")
    return (t.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def sheet_xml(rows, widths):
    cols = "".join(
        f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>'
        for i, w in enumerate(widths))
    body = []
    for r, row in enumerate(rows, 1):
        cells = []
        for c, val in enumerate(row):
            ref = f"{col_letter(c)}{r}"
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                cells.append(f'<c r="{ref}"><v>{val}</v></c>')
            elif val not in ("", None):
                cells.append(f'<c r="{ref}" t="inlineStr"><is>'
                             f'<t xml:space="preserve">{esc(val)}</t></is></c>')
        body.append(f'<row r="{r}">' + "".join(cells) + "</row>")
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<cols>{cols}</cols><sheetData>{"".join(body)}</sheetData></worksheet>')


def write_xlsx(path, sheets):
    """sheets: list of (name, rows, widths)."""
    n = len(sheets)
    ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
    for i in range(n):
        ct.append(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" '
                  'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
    ct.append('<Override PartName="/xl/styles.xml" '
              'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
              '</Types>')

    sheet_refs = "".join(
        f'<sheet name="{esc(name)}" sheetId="{i+1}" r:id="rId{i+1}"/>'
        for i, (name, _, _) in enumerate(sheets))
    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                f'<sheets>{sheet_refs}</sheets></workbook>')

    rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
    for i in range(n):
        rels.append(f'<Relationship Id="rId{i+1}" '
                    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                    f'Target="worksheets/sheet{i+1}.xml"/>')
    rels.append(f'<Relationship Id="rId{n+1}" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
                'Target="styles.xml"/></Relationships>')

    root = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/></Relationships>')

    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
              '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
              '<borders count="1"><border/></borders>'
              '<cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              '<cellXfs count="1"><xf fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
              '</styleSheet>')

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "".join(ct))
        z.writestr("_rels/.rels", root)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", "".join(rels))
        z.writestr("xl/styles.xml", styles)
        for i, (_, rows, widths) in enumerate(sheets, 1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", sheet_xml(rows, widths))


# ---------------------------------------------------------------- main

REPORT_COLS = [
    ("date", "Дата"), ("time", "Час"), ("target_no", "№ цілі"),
    ("result", "Результат"), ("settlement", "Н.П."), ("region", "Область"),
    ("unit", "Підрозділ"), ("callsign", "Позивний"), ("weapon", "Зброя"),
    ("height", "Висота"), ("description", "Опис"), ("comment", "Коментар"),
    ("ammo_total", "Набоїв всього"),
]


def main():
    if len(sys.argv) < 2:
        print("usage: report2xlsx.py input.txt [output.xlsx]", file=sys.stderr)
        return 2

    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0] + ".xlsx"

    with open(src, encoding="utf-8") as f:
        text = f.read()

    blocks = split_reports(text)
    print(f"[parse] reports found: {len(blocks)}", file=sys.stderr)

    reports, ammo_rows, shell_rows, missile_rows = [], [], [], []
    for n, block in enumerate(blocks, 1):
        rec, ammo, shells, missiles, block_items = parse_report(block)

        # Items listed under "НАБОЇ:" count as ammunition too.
        for it in block_items:
            ammo.append({"caliber": it["caliber"],
                         "platform": it["type"],
                         "count": it["count"]})

        rec["ammo_total"] = sum(a["count"] for a in ammo)
        rec["shell_total"] = sum(s["count"] for s in shells)
        rec["missile_total"] = sum(m["count"] for m in missiles)
        reports.append(rec)

        base = {"report": n, "date": rec["date"], "time": rec["time"],
                "callsign": rec["callsign"]}
        for a in ammo:
            ammo_rows.append(dict(base, caliber=a["caliber"],
                                  platform=a["platform"], count=a["count"]))
        for s in shells:
            shell_rows.append(dict(base, caliber=s["caliber"],
                                   platform=s["platform"], count=s["count"]))
        for m in missiles:
            missile_rows.append(dict(base, count=m["count"]))

    header = [label for _, label in REPORT_COLS]
    rows = [header] + [[r.get(k, "") for k, _ in REPORT_COLS] for r in reports]

    def detail(items):
        head = ["Звіт", "Дата", "Час", "Позивний", "Калібр",
                "Платформа", "Кількість"]
        data = [head] + [[a["report"], a["date"], a["time"], a["callsign"],
                          a["caliber"], a["platform"], a["count"]]
                         for a in items]
        return data, [8, 12, 8, 18, 14, 28, 10]

    ammo_data, ammo_widths = detail(ammo_rows)
    shell_data, shell_widths = detail(shell_rows)

    widths = []
    for i, (k, label) in enumerate(REPORT_COLS):
        longest = max([len(label)] +
                      [len(str(r.get(k, ""))) for r in reports] or [10])
        widths.append(min(max(longest + 2, 10), 50))
    missile_data = [["Звіт", "Дата", "Час", "Позивний", "Кількість"]] + [
        [m["report"], m["date"], m["time"], m["callsign"], m["count"]]
        for m in missile_rows]

    # Summary sheet: consumption grouped by type.
    def totals(key):
        acc = {}
        for it in ammo_rows:
            label = it[key] or "(не вказано)"
            acc[label] = acc.get(label, 0) + it["count"]
        return sorted(acc.items(), key=lambda kv: -kv[1])

    summary = [["Розхід по типах"],
               [],
               ["Набої — по калібрах", "Кількість"]]
    summary += [[k, v] for k, v in totals("caliber")]
    summary += [["", ""], ["Набої — по платформах", "Кількість"]]
    summary += [[k, v] for k, v in totals("platform")]

    if shell_rows:
        sc = {}
        for s in shell_rows:
            sc[s["caliber"]] = sc.get(s["caliber"], 0) + s["count"]
        summary += [["", ""], ["Снаряди — по калібрах", "Кількість"]]
        summary += [[k, v] for k, v in sorted(sc.items(), key=lambda kv: -kv[1])]

    summary += [["", ""],
                ["Разом набоїв", sum(a["count"] for a in ammo_rows)],
                ["Разом снарядів", sum(s["count"] for s in shell_rows)],
                ["Разом ЗКР", sum(m["count"] for m in missile_rows)],
                ["Доповідей", len(reports)]]

    sheets = [("Доповіді", rows, widths),
              ("Набої", ammo_data, ammo_widths)]
    if shell_rows:
        sheets.append(("Снаряди", shell_data, shell_widths))
    if missile_rows:
        sheets.append(("ЗКР", missile_data, [8, 12, 8, 18, 10]))
    sheets.append(("Розхід по типах", summary, [32, 14]))

    write_xlsx(out, sheets)
    print(f"[done] {out}: {len(reports)} reports, "
          f"{len(ammo_rows)} ammo, {len(shell_rows)} shells, "
          f"{len(missile_rows)} missiles")
    return 0


if __name__ == "__main__":
    sys.exit(main())