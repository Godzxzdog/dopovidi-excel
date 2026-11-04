#!/usr/bin/env python3
"""Generate a daily summary report from a Ukrainian air-defence briefing.

The input is free-form prose; numbers and phrases vary between days, so the
parser works on patterns rather than fixed positions. Anything it cannot read
is left blank and reported, never guessed.
"""

import re
import sys

CYR_X = "\u0445"  # Cyrillic х used inside calibers

# ---------------------------------------------------------------- numbers

NUM_WORDS = {
    "нуль": 0, "один": 1, "одна": 1, "одне": 1, "два": 2, "дві": 2,
    "три": 3, "чотири": 4, "п'ять": 5, "пять": 5, "шість": 6, "сім": 7,
    "вісім": 8, "дев'ять": 9, "девять": 9, "десять": 10,
    "одинадцять": 11, "дванадцять": 12, "тринадцять": 13,
    "чотирнадцять": 14, "п'ятнадцять": 15, "шістнадцять": 16,
    "сімнадцять": 17, "вісімнадцять": 18, "дев'ятнадцять": 19,
    "двадцять": 20, "тридцять": 30, "сорок": 40, "п'ятдесят": 50,
}


def to_int(token):
    """'12' -> 12, 'двадцять' -> 20, otherwise None."""
    if not token:
        return None
    token = token.strip().lower()
    if token.isdigit():
        return int(token)
    return NUM_WORDS.get(token)


# ---------------------------------------------------------------- patterns

PERIOD_RE = re.compile(
    r"з\s+(\d{1,2}[:.]\d{2})\s+(\d{1,2}[.\s]\d{1,2}[.\s]\d{2,4})"
    r"\s+(?:до|по)\s+(\d{1,2}[:.]\d{2})\s+(\d{1,2}[.\s]\d{1,2}[.\s]\d{2,4})",
    re.I)

ZONE_RE = re.compile(r"(Т[Гг]р\s*ППО\s*[«\"“'][^»\"”']+[»\"”'])", re.U)

# "12 – крилатихих ракет", "26 - ударних БпЛА (з них - 22 БпЛА реактивних)"
APPLIED_RE = re.compile(
    r"(\d+)\s*[-–—]?\s*(крилат\w*\s+ракет\w*|ударн\w*\s+БпЛА|БпЛА)",
    re.I)

REACTIVE_TOTAL_RE = re.compile(
    r"ударних\s+БпЛА\s*\(\s*з\s+них\s*[-–—]?\s*(\d+)\s+БпЛА\s+реактивн", re.I)

DESTROYED_HEAD_RE = re.compile(
    r"Знищено\s*:?\s*(\d+)\s*[-–—]\s*(крилат\w*\s+ракет\w*|ударн\w*\s+БпЛА)",
    re.I)

# "2 - ударних БпЛА силами ТГр ППО «Вінниця»;"
BY_FORCE_RE = re.compile(
    r"(\d+)\s*[-–—]\s*(ударн\w*\s+БпЛА|крилат\w*\s+ракет\w*|БпЛА)"
    r"\s+силами\s+([^;.\n]+?)(?:[;.]|$)", re.I | re.M)

WEAPONS_RE = re.compile(
    r"Застосовувала?с[яь]\s+зброя\s*:?\s*([^\n]+)", re.I)

LEFT_ZONE_RE = re.compile(
    r"Вийшли\s+із\s+зони\s+відповідальності[^:]*:\s*([^\n]+)", re.I)

LOST_RE = re.compile(
    r"Локаційно\s+втрачено\s*:?\s*([^\n.]+)", re.I)

USES_RE = re.compile(
    r"застосовували\s+зброю\s*[-–—]\s*(\d+)\s*раз", re.I)

CI_RE = re.compile(
    r"Уражено\s+об[’'`]?єкт\w*\s+критичної\s+інфраструктури\s*[-–—]\s*(\d+)",
    re.I)

CI_DETAILS_RE = re.compile(r"(\d{1,2}:\d{2})\s+(.+)", re.S)

SIGNER_RE = re.compile(
    r"^\s*(ТВО\s+командира[^\n]*)\n\s*([^\n]*?)\s{2,}([А-ЯІЇЄA-Z][^\n]*)\s*$",
    re.M | re.U)

MISSING = "--"


def norm_date(raw):
    """'02.11.2026' / '2 11 2026' -> '02.11.2026'."""
    parts = re.split(r"[.\s]+", raw.strip())
    parts = [p for p in parts if p]
    if len(parts) != 3:
        return raw.strip()
    d, m, y = parts
    return f"{int(d):02d}.{int(m):02d}.{y}"


def norm_time(raw):
    return raw.replace(".", ":")


def parse(text):
    data = {"warnings": []}
    flat = re.sub(r"[ \t]+", " ", text)

    m = PERIOD_RE.search(flat)
    if m:
        data["from_time"] = norm_time(m.group(1))
        data["from_date"] = norm_date(m.group(2))
        data["to_time"] = norm_time(m.group(3))
        data["to_date"] = norm_date(m.group(4))
    else:
        data["warnings"].append("Період не знайдено")
        for k in ("from_time", "from_date", "to_time", "to_date"):
            data[k] = MISSING

    m = ZONE_RE.search(text)
    data["zone"] = m.group(1).strip() if m else MISSING
    if not m:
        data["warnings"].append("Зону відповідальності не знайдено")

    # ---- applied
    applied = {}
    for m in APPLIED_RE.finditer(flat):
        count = int(m.group(1))
        kind = m.group(2).lower()
        key = "cruise" if "ракет" in kind else "uav"
        if key not in applied:
            applied[key] = count
    data["applied_cruise"] = applied.get("cruise", 0)
    data["applied_uav"] = applied.get("uav", 0)

    m = REACTIVE_TOTAL_RE.search(flat)
    data["applied_uav_reactive"] = int(m.group(1)) if m else 0

    # ---- destroyed
    destroyed = {"cruise": None, "uav": None}
    for m in DESTROYED_HEAD_RE.finditer(flat):
        count = int(m.group(1))
        kind = m.group(2).lower()
        key = "cruise" if "ракет" in kind else "uav"
        destroyed[key] = count

    # explicit "Знищено 6 – крилатихих ракет:" form
    m = re.search(r"Знищено\s+(\d+)\s*[-–—]\s*крилат\w*\s+ракет", flat, re.I)
    if m and destroyed["cruise"] is None:
        destroyed["cruise"] = int(m.group(1))

    data["destroyed_cruise"] = destroyed["cruise"] if destroyed["cruise"] is not None else MISSING
    data["destroyed_uav"] = destroyed["uav"] if destroyed["uav"] is not None else MISSING

    # ---- by force
    by_force = []
    for m in BY_FORCE_RE.finditer(flat):
        force = re.sub(r"\s+", " ", m.group(3)).strip(" .;,")
        kind = m.group(2).lower()
        by_force.append({
            "count": int(m.group(1)),
            "kind": "крилата ракета" if "ракет" in kind else "ударний БпЛА",
            "force": force,
        })
    data["by_force"] = by_force

    # ---- weapons
    m = WEAPONS_RE.search(text)
    if m:
        items = [w.strip() for w in re.split(r"[,;]", m.group(1)) if w.strip()]
        data["weapons"] = items
    else:
        data["weapons"] = []
        data["warnings"].append("Перелік зброї не знайдено")

    # ---- left the zone
    m = LEFT_ZONE_RE.search(flat)
    if m:
        chunk = m.group(1)
        total = re.match(r"\s*(\d+)", chunk)
        data["left_total"] = int(total.group(1)) if total else MISSING
        regions = re.findall(r"(\d+)\s*[-–—]?\s*(?:в|у)?\s+([А-ЯІЇЄ][\w\-]*)\s*(?:област|обл)", chunk, re.U)
        data["left_regions"] = [
            {"count": int(c), "region": r.strip()} for c, r in regions
        ]
    else:
        data["left_total"] = MISSING
        data["left_regions"] = []

    # ---- lost locally
    m = LOST_RE.search(flat)
    if m:
        chunk = m.group(1)
        uav = re.search(r"(\d+)[^0-9]*БпЛА", chunk)
        cruise = re.search(r"(\d+)[^0-9]*ракет", chunk)
        data["lost_uav"] = int(uav.group(1)) if uav else 0
        data["lost_cruise"] = int(cruise.group(1)) if cruise else 0
    else:
        data["lost_uav"] = MISSING
        data["lost_cruise"] = MISSING

    # ---- weapon uses
    m = USES_RE.search(flat)
    data["weapon_uses"] = int(m.group(1)) if m else MISSING

    # ---- critical infrastructure
    m = CI_RE.search(flat)
    data["ci_count"] = int(m.group(1)) if m else 0

    data["ci_details"] = []
    if data["ci_count"]:
        idx = flat.find("критичної інфраструктури")
        tail = flat[idx:] if idx >= 0 else ""
        for mm in CI_DETAILS_RE.finditer(tail):
            t = norm_time(mm.group(1))
            body = mm.group(2).strip()
            body = re.split(r"\n\s*(?:ТВО|Підрозділи)", body)[0].strip()
            if len(body) > 15:
                data["ci_details"].append({"time": t, "text": body})

    # ---- signer
    m = SIGNER_RE.search(text)
    if m:
        data["signer_role"] = m.group(1).strip()
        data["signer_rank"] = m.group(2).strip()
        data["signer_name"] = m.group(3).strip()
    else:
        data["signer_role"] = MISSING
        data["signer_rank"] = MISSING
        data["signer_name"] = MISSING
        data["warnings"].append("Підпис не розпізнано")

    return data


# ---------------------------------------------------------------- text out

def render(d):
    pct = lambda part, total: (f" ({round(part / total * 100)}%)"
                               if isinstance(total, int) and total else "")

    destroyed_total_uav = d["destroyed_uav"] if isinstance(d["destroyed_uav"], int) else 0

    lines = []
    lines.append("Бажаю здоров'я!")
    lines.append("")
    lines.append(
        f"У період з {d['from_time']} {d['from_date']} до {d['to_time']} "
        f"{d['to_date']} в межах зони відповідальності {d['zone']} "
        f"противником було застосовано:")
    lines.append(f"{d['applied_cruise']} – крилатих ракет")
    if d["applied_uav_reactive"]:
        lines.append(
            f"{d['applied_uav']} - ударних БпЛА "
            f"(з них - {d['applied_uav_reactive']} БпЛА реактивних).")
    else:
        lines.append(f"{d['applied_uav']} - ударних БпЛА.")

    if isinstance(d["destroyed_uav"], int):
        lines.append(
            f"Знищено: {d['destroyed_uav']} - ударних БпЛА"
            f"{pct(destroyed_total_uav, d['applied_uav'] if d['applied_uav'] else None)}:")
        by_uav = [b for b in d["by_force"] if b["kind"] == "ударний БпЛА"]
        for i, b in enumerate(by_uav):
            end = ";" if i < len(by_uav) - 1 else "."
            lines.append(f"{b['count']} - ударних БпЛА силами {b['force']}{end}")

    if isinstance(d["destroyed_cruise"], int):
        lines.append(
            f"Знищено {d['destroyed_cruise']} – крилатих ракет"
            f"{pct(d['destroyed_cruise'], d['applied_cruise'] if d['applied_cruise'] else None)}:")
        by_cr = [b for b in d["by_force"] if b["kind"] == "крилата ракета"]
        for i, b in enumerate(by_cr):
            end = ";" if i < len(by_cr) - 1 else "."
            lines.append(f"{b['count']} – крилату ракету силами {b['force']}{end}")

    if d["weapons"]:
        lines.append("Застосовувалась зброя: " + ", ".join(d["weapons"]))

    if d["left_total"] != MISSING or d["left_regions"]:
        parts = [f"{r['count']} - в {r['region']} область" for r in d["left_regions"]]
        tail = f" ({'; '.join(parts)})" if parts else ""
        lines.append(
            f"Вийшли із зони відповідальності {d['zone']}: "
            f"{d['left_total']} - ударних БпЛА{tail}")

    if d["lost_uav"] != MISSING or d["lost_cruise"] != MISSING:
        lines.append(
            f"Локаційно втрачено: {d['lost_uav']} - ударних БпЛА "
            f"та {d['lost_cruise']} крилатих ракет.")

    if d["weapon_uses"] != MISSING:
        lines.append(
            f"Підрозділи {d['zone']} застосовували зброю - {d['weapon_uses']} разів.")

    if d["ci_count"]:
        lines.append("")
        lines.append(
            f"Уражено об'єктів критичної інфраструктури - {d['ci_count']} об'єкт:")
        for det in d["ci_details"]:
            lines.append(f"{det['time']} {det['text']}")

    lines.append("")
    lines.append(d["signer_role"])
    if d["signer_rank"] != MISSING:
        lines.append(f"{d['signer_rank']:<22}{d['signer_name']}")
    else:
        lines.append(d["signer_name"])
    lines.append("")
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("usage: summarize.py input.txt [output.txt]", file=sys.stderr)
        return 2

    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0] + ".report.txt"

    with open(src, encoding="utf-8") as f:
        text = f.read()

    data = parse(text)
    report = render(data)

    with open(out, "w", encoding="utf-8") as f:
        f.write(report)

    print(report)
    if data["warnings"]:
        print("\n[!] " + "; ".join(data["warnings"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())