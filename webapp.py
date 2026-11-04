#!/usr/bin/env python3
"""Local web UI for the report parser.

Paste report text into the page, get an .xlsx back. Runs on 127.0.0.1 only,
no dependencies beyond the standard library and report2xlsx.py.
"""

import html
import importlib.util
import io
import os
import sys
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("rp", os.path.join(HERE, "report2xlsx.py"))
rp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rp)

_spec_sum = importlib.util.spec_from_file_location("sm", os.path.join(HERE, "summarize.py"))
summarize = importlib.util.module_from_spec(_spec_sum)
_spec_sum.loader.exec_module(summarize)

HOST = "127.0.0.1"
PORT = 8099
MAX_BODY = 5_000_000

STATIC_FILES = {
    "summary.html": "text/html; charset=utf-8",
    "summary.js": "application/javascript; charset=utf-8",
    "summary.css": "text/css; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
    "app.js": "application/javascript; charset=utf-8",
    "form.html": "text/html; charset=utf-8",
    "form.js": "application/javascript; charset=utf-8",
    "form.css": "text/css; charset=utf-8",
    "builder.js": "application/javascript; charset=utf-8",
}


PAGE = """<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>Доповіді → Excel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#111418; color:#e6e9ef; }
  header { padding:18px 24px; border-bottom:1px solid #232a33; display:flex;
           align-items:baseline; gap:14px; flex-wrap:wrap; }
  h1 { font-size:17px; margin:0; font-weight:600; letter-spacing:.2px; }
  .sub { color:#7f8b9c; font-size:13px; }
  main { padding:20px 24px 60px; max-width:1200px; }
  textarea { width:100%; min-height:340px; padding:14px; border-radius:10px;
             border:1px solid #2b333d; background:#0c0f13; color:#dfe5ee;
             font-family: ui-monospace, "SF Mono", Menlo, monospace;
             font-size:13px; line-height:1.55; resize:vertical; }
  textarea:focus { outline:none; border-color:#3d7eff; }
  .row { display:flex; gap:10px; align-items:center; margin-top:14px;
         flex-wrap:wrap; }
  button { background:#3d7eff; color:#fff; border:0; border-radius:8px;
           padding:10px 18px; font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#538cff; }
  button.ghost { background:#1b222b; color:#b9c4d3; border:1px solid #2b333d; }
  button.ghost:hover { background:#232c37; }
  .status { font-size:13px; color:#7f8b9c; }
  .status.ok { color:#4ade80; }
  .status.err { color:#f87171; }
  table { border-collapse:collapse; width:100%; margin-top:18px;
          font-size:12.5px; }
  th, td { border-bottom:1px solid #202832; padding:7px 9px; text-align:left;
           vertical-align:top; }
  th { color:#8fa0b6; font-weight:600; position:sticky; top:0;
       background:#111418; }
  td { color:#c9d3e0; }
  .wrap { overflow:auto; max-height:420px; border:1px solid #202832;
          border-radius:10px; }
  .hint { font-size:12.5px; color:#6f7c8e; margin-top:10px; line-height:1.6; }
  code { background:#1a212a; padding:1px 5px; border-radius:4px;
         font-size:12px; color:#9ec1ff; }
</style>
</head>
<body>
<header>
  <h1>Доповіді → Excel</h1>
  <span class="sub">встав текст пачкою, отримай файл</span>
</header>
<main>
  <form id="f" method="post" action="/parse" enctype="application/x-www-form-urlencoded">
    <textarea name="text" id="t" placeholder="Встав текст доповідей. Кожна починається з рядка \"Дата:\""></textarea>
    <div class="row">
      <button type="submit">Розібрати та завантажити XLSX</button>
      <button type="button" class="ghost" id="prev">Попередній перегляд</button>
      <button type="button" class="ghost" id="clr">Очистити</button>
      <span class="status" id="s"></span>
    </div>
  </form>
  <div class="hint">
    Нова доповідь починається з рядка <code>Дата:</code>.
    Розпізнаються поля: Час, № цілі, Результат, Н.П., Обл., Підрозділ,
    Позивний, Зброя, Висота, Опис, Коментар, а також рядки
    <code>Набій 12,7х99 мм (...) - 30</code>.
  </div>
  <div id="out"></div>
</main>
<script>
const ta = document.getElementById('t');
const st = document.getElementById('s');
const out = document.getElementById('out');

document.getElementById('clr').onclick = () => {
  ta.value = ''; out.innerHTML = ''; st.textContent = ''; ta.focus();
};

document.getElementById('prev').onclick = async () => {
  if (!ta.value.trim()) { st.textContent = 'порожньо'; st.className='status err'; return; }
  st.textContent = 'розбираю...'; st.className = 'status';
  try {
    const r = await fetch('/preview', { method:'POST', body: new URLSearchParams({text: ta.value}) });
    const d = await r.json();
    if (d.error) { st.textContent = d.error; st.className='status err'; return; }
    st.textContent = `знайдено доповідей: ${d.count}`;
    st.className = 'status ok';
    if (!d.count) { out.innerHTML = ''; return; }
    let h = '<div class="wrap"><table><thead><tr>';
    for (const c of d.headers) h += `<th>${esc(c)}</th>`;
    h += '</tr></thead><tbody>';
    for (const row of d.rows) {
      h += '<tr>';
      for (const v of row) h += `<td>${esc(v)}</td>`;
      h += '</tr>';
    }
    h += '</tbody></table></div>';
    out.innerHTML = h;
  } catch (e) { st.textContent = 'помилка: ' + e.message; st.className='status err'; }
};

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
</script>
</body>
</html>
"""


def build_report_data(text):
    """Parse text into (reports, ammo_rows) using the shared parser."""
    blocks = rp.split_reports(text)
    reports, ammo_rows = [], []
    for n, block in enumerate(blocks, 1):
        rec, ammo = rp.parse_report(block)
        rec["ammo_total"] = sum(a["count"] for a in ammo)
        reports.append(rec)
        for a in ammo:
            ammo_rows.append({
                "report": n, "date": rec["date"], "time": rec["time"],
                "callsign": rec["callsign"], "caliber": a["caliber"],
                "platform": a["platform"], "count": a["count"],
            })
    return reports, ammo_rows


def make_xlsx_bytes(reports, ammo_rows):
    header = [label for _, label in rp.REPORT_COLS]
    rows = [header] + [[r.get(k, "") for k, _ in rp.REPORT_COLS]
                       for r in reports]
    ammo_header = ["Звіт", "Дата", "Час", "Позивний", "Калібр",
                   "Платформа", "Кількість"]
    ammo_data = [ammo_header] + [
        [a["report"], a["date"], a["time"], a["callsign"],
         a["caliber"], a["platform"], a["count"]] for a in ammo_rows]

    widths = []
    for k, label in rp.REPORT_COLS:
        longest = max([len(label)] +
                      [len(str(r.get(k, ""))) for r in reports] or [10])
        widths.append(min(max(longest + 2, 10), 50))
    ammo_widths = [8, 12, 8, 18, 14, 28, 10]

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    tmp.close()
    try:
        rp.write_xlsx(tmp.name, [("Доповіді", rows, widths),
                                 ("Набої", ammo_data, ammo_widths)])
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp.name)


class Handler(BaseHTTPRequestHandler):
    server_version = "ReportParser/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return ""
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        ctype = (self.headers.get("Content-Type") or "").lower()
        # raw body (text/plain) is used as-is; form posts carry "text="
        if ctype.startswith("application/x-www-form-urlencoded"):
            parsed = urllib.parse.parse_qs(raw, keep_blank_values=True)
            return (parsed.get("text") or [""])[0]
        return raw

    def _send(self, code, ctype, payload, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, "text/html; charset=utf-8", PAGE.encode("utf-8"))
            return

        # static files next to this script
        name = os.path.basename(urllib.parse.urlparse(self.path).path)
        if name in STATIC_FILES:
            path = os.path.join(HERE, name)
            with open(path, "rb") as f:
                data = f.read()
            self._send(200, STATIC_FILES[name], data)
            return

        self._send(404, "text/plain; charset=utf-8", b"not found")

    def do_POST(self):
        text = self._read_body()

        if self.path == "/preview":
            import json
            reports, _ = build_report_data(text)
            headers = [label for _, label in rp.REPORT_COLS]
            rows = [[r.get(k, "") for k, _ in rp.REPORT_COLS] for r in reports]
            payload = json.dumps({"count": len(reports),
                                  "headers": headers,
                                  "rows": rows}, ensure_ascii=False)
            self._send(200, "application/json; charset=utf-8",
                       payload.encode("utf-8"))
            return

        if self.path == "/summarize":
            data = summarize.parse(text)
            body = summarize.render(data)
            self._send(200, "text/plain; charset=utf-8", body.encode("utf-8"))
            return

        if self.path == "/parse":
            reports, ammo_rows = build_report_data(text)
            if not reports:
                body = html.escape("Не знайдено жодної доповіді. "
                                   "Текст має містити рядки 'Дата:'.")
                self._send(400, "text/html; charset=utf-8",
                           body.encode("utf-8"))
                return
            data = make_xlsx_bytes(reports, ammo_rows)
            name = "reports.xlsx"
            self._send(200,
                       "application/vnd.openxmlformats-officedocument"
                       ".spreadsheetml.sheet",
                       data,
                       {"Content-Disposition": f'attachment; filename="{name}"'})
            return

        self._send(404, "text/plain; charset=utf-8", b"not found")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    srv = ThreadingHTTPServer((HOST, port), Handler)
    print(f"Report parser UI: http://{HOST}:{port}/", file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", file=sys.stderr)


if __name__ == "__main__":
    main()