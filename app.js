/* Report parser — browser edition.
 *
 * Mirrors report2xlsx.py: same field patterns, same two-sheet output.
 * Everything runs locally in the page; no data leaves the browser.
 */

'use strict';

const FIELD_KEYS = [
  ['date',        'Дата'],
  ['time',        'Час'],
  ['target_no',   '№\\s*цілі'],
  ['result',      'Результат'],
  ['settlement',  'Н\\.?\\s?П\\.?'],
  ['region',      'Обл\\.'],
  ['unit',        'Підрозділ'],
  ['callsign',    'Позивний'],
  ['weapon',      'Зброя'],
  ['height',      'Висота'],
  ['description', 'Опис'],
  ['comment',     'Коментар'],
];

// Caliber separator may be the Cyrillic х (U+0445) or a Latin x; the decimal
// comma is optional and the caliber may be a single number (e.g. "40 мм").
// The count separator may be a hyphen, en- or em-dash.
const AMMO_SRC = 'Набій\\s+([0-9]+(?:[.,][0-9]+)?(?:\\s*[хx\u0445\u00d7X]\\s*[0-9]+)?)\\s*мм(?:\\s*\\((.*)\\))?\\s*[-\u2013\u2014]\\s*([0-9]+)';

// Artillery shells use "Снаряд" instead of "Набій": same shape, own sheet.
const SHELL_SRC = 'Снаряд\\s+([0-9]+(?:[.,][0-9]+)?(?:\\s*[хx\u0445\u00d7X]\\s*[0-9]+)?)\\s*мм(?:\\s*\\((.*)\\))?\\s*[-\u2013\u2014]\\s*([0-9]+)';

// Guided missiles: "Розхід ЗКР до ЗРК – 1".
const MISSILE_SRC = 'Розхід\\s+ЗКР[^0-9]*[-\u2013\u2014]?\\s*([0-9]+)';

const AMMO_BLOCK_HEAD = /^\s*НАБОЇ\s*:?\s*$/i;
// Item line: "<type> - <count>", e.g. "ОФЗ - 78" or "5,45пс - 84".
// \w is ASCII-only in JS, so the type class is spelled out for Cyrillic.
const AMMO_BLOCK_ITEM = /^\s*([А-Яа-яІіЇїЄєA-Za-z0-9][А-Яа-яІіЇїЄєA-Za-z0-9,.\- ]*?)\s*[-\u2013\u2014]\s*([0-9]+)\s*$/u;
const CALIBER_CONTEXT = /^\s*([0-9][0-9\-]*)\s+([0-9]+)\s*мм\s*$/;

const REPORT_START = /^\s*Дата\s*:/i;

const KEY_LINE = new RegExp(
  '^\\s*(' + FIELD_KEYS.map(([, p]) => p).join('|') + ')\\s*:', 'i');

function splitReports(text) {
  const blocks = [];
  let current = [];

  for (const line of text.split(/\r?\n/)) {
    if (REPORT_START.test(line)) {
      if (current.length) blocks.push(current.join('\n').trim());
      current = [line];
    } else if (line.trim()) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join('\n').trim());
  return blocks.filter(Boolean);
}

function parseReport(block) {
  const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const record = {};
  const ammoTest = new RegExp(AMMO_SRC, 'i');

  for (const [key, pattern] of FIELD_KEYS) {
    const rx = new RegExp('^' + pattern + '\\s*:\\s*(.*)$', 'i');
    let value = '';

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(rx);
      if (!m) continue;

      value = m[1].trim();
      // values may wrap onto following lines that are not new fields
      let j = i + 1;
      while (j < lines.length && lines[j]
             && !KEY_LINE.test(lines[j])
             && !ammoTest.test(lines[j])) {
        value += ' ' + lines[j];
        j++;
      }
      break;
    }
    record[key] = value;
  }

  const ammo = [];
  const rxAll = new RegExp(AMMO_SRC, 'gi');
  let m;
  while ((m = rxAll.exec(block)) !== null) {
    ammo.push({
      caliber: m[1].replace(/\s+/g, ''),
      platform: (m[2] || '').trim(),
      count: parseInt(m[3], 10),
    });
  }

  return { record, ammo, shells: collect(SHELL_SRC, block),
           missiles: collectMissiles(block),
           blockItems: collectBlockItems(lines) };
}

function collect(src, block) {
  const out = [];
  const rx = new RegExp(src, 'gi');
  let m;
  while ((m = rx.exec(block)) !== null) {
    out.push({
      caliber: m[1].replace(/\s+/g, ''),
      platform: (m[2] || '').trim(),
      count: parseInt(m[3], 10),
    });
  }
  return out;
}

function collectMissiles(block) {
  const out = [];
  const rx = new RegExp(MISSILE_SRC, 'gi');
  let m;
  while ((m = rx.exec(block)) !== null) {
    out.push({ count: parseInt(m[1], 10) });
  }
  return out;
}

// "НАБОЇ:" heading followed by "тип - кількість" lines.
function collectBlockItems(lines) {
  const out = [];
  let caliberCtx = '';
  let inBlock = false;
  const ammoTest = new RegExp(AMMO_SRC, 'i');
  const shellTest = new RegExp(SHELL_SRC, 'i');

  for (const ln of lines) {
    if (AMMO_BLOCK_HEAD.test(ln)) { inBlock = true; continue; }
    if (!inBlock) continue;

    // A line that carries its own caliber also resets the context: the
    // following items belong to it only if they lack a caliber themselves.
    const ctx = ln.match(CALIBER_CONTEXT);
    if (ctx) { caliberCtx = ctx[1] + 'мм'; continue; }

    if (KEY_LINE.test(ln) || ammoTest.test(ln) || shellTest.test(ln)) {
      inBlock = false;
      continue;
    }

    const m = ln.match(AMMO_BLOCK_ITEM);
    if (m) {
      const type = m[1].trim();
      // Type names that embed their own caliber (5,45пс, 5.45т) must not
      // inherit the caliber of the section they are listed under.
      const own = type.match(/^([0-9]+[.,][0-9]+)/);
      out.push({
        caliber: own ? own[1] : caliberCtx,
        type,
        count: parseInt(m[2], 10),
      });
    }
  }
  return out;
}

const REPORT_COLS = [
  ['date', 'Дата'], ['time', 'Час'], ['target_no', '№ цілі'],
  ['result', 'Результат'], ['settlement', 'Н.П.'], ['region', 'Область'],
  ['unit', 'Підрозділ'], ['callsign', 'Позивний'], ['weapon', 'Зброя'],
  ['height', 'Висота'], ['description', 'Опис'], ['comment', 'Коментар'],
  ['ammo_total', 'Набоїв всього'],
];

function buildData(text) {
  const blocks = splitReports(text);
  const reports = [];
  const ammoRows = [];
  const shellRows = [];
  const missileRows = [];

  blocks.forEach((block, idx) => {
    const n = idx + 1;
    const { record, ammo, shells, missiles, blockItems } = parseReport(block);

    // Items listed under "НАБОЇ:" count as ammunition too.
    for (const it of blockItems) {
      ammo.push({ caliber: it.caliber, platform: it.type, count: it.count });
    }

    record.ammo_total = ammo.reduce((s, a) => s + a.count, 0);
    record.shell_total = shells.reduce((s, a) => s + a.count, 0);
    record.missile_total = missiles.reduce((s, a) => s + a.count, 0);
    reports.push(record);

    const base = {
      report: n, date: record.date, time: record.time,
      callsign: record.callsign,
    };
    for (const a of ammo) {
      ammoRows.push(Object.assign({}, base,
        { caliber: a.caliber, platform: a.platform, count: a.count }));
    }
    for (const s of shells) {
      shellRows.push(Object.assign({}, base,
        { caliber: s.caliber, platform: s.platform, count: s.count }));
    }
    for (const m of missiles) {
      missileRows.push(Object.assign({}, base, { count: m.count }));
    }
  });

  return { reports, ammoRows, shellRows, missileRows };
}

// ---------------------------------------------------------------- xlsx

function colLetter(idx) {
  let letters = '';
  idx += 1;
  while (idx) {
    const rem = (idx - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    idx = Math.floor((idx - 1) / 26);
  }
  return letters;
}

function escXml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sheetXml(rows, widths) {
  const cols = widths.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');

  const body = rows.map((row, r) => {
    const cells = row.map((val, c) => {
      const ref = colLetter(c) + (r + 1);
      if (typeof val === 'number' && !Number.isNaN(val)) {
        return `<c r="${ref}"><v>${val}</v></c>`;
      }
      if (val === '' || val == null) return '';
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(val)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5)
                   | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9)
                   | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const dataBytes = enc.encode(content);
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, dataBytes);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + dataBytes.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function buildXlsx(sheets) {
  const n = sheets.length;

  let ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  for (let i = 1; i <= n; i++) {
    ct += `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }
  ct += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';

  const refs = sheets.map((s, i) =>
    `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${refs}</sheets></workbook>`;

  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= n; i++) {
    rels += `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`;
  }
  rels += `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const root = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
    + '<borders count="1"><border/></borders>'
    + '<cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="1"><xf fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
    + '</styleSheet>';

  const files = [
    ['[Content_Types].xml', ct],
    ['_rels/.rels', root],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', rels],
    ['xl/styles.xml', styles],
  ];
  sheets.forEach((s, i) => {
    files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths)]);
  });

  return zipStore(files);
}

// ---------------------------------------------------------------- ui

const el = id => document.getElementById(id);

function widthsFor(reports) {
  return REPORT_COLS.map(([key, label]) => {
    const longest = Math.max(label.length,
      ...reports.map(r => String(r[key] == null ? '' : r[key]).length), 0);
    return Math.min(Math.max(longest + 2, 10), 50);
  });
}

function toSheets(data) {
  const { reports, ammoRows, shellRows, missileRows } = data;

  const header = REPORT_COLS.map(([, label]) => label);
  const rows = [header, ...reports.map(r => REPORT_COLS.map(([k]) => r[k] || ''))];

  function detail(items) {
    const head = ['Звіт', 'Дата', 'Час', 'Позивний', 'Калібр',
                  'Платформа', 'Кількість'];
    return [head, ...items.map(a =>
      [a.report, a.date, a.time, a.callsign, a.caliber, a.platform, a.count])];
  }

  const sheets = [
    { name: 'Доповіді', rows, widths: widthsFor(reports) },
    { name: 'Набої', rows: detail(ammoRows), widths: [8, 12, 8, 18, 14, 28, 10] },
  ];

  if (shellRows.length) {
    sheets.push({ name: 'Снаряди', rows: detail(shellRows),
                  widths: [8, 12, 8, 18, 14, 28, 10] });
  }
  if (missileRows.length) {
    sheets.push({
      name: 'ЗКР',
      rows: [['Звіт', 'Дата', 'Час', 'Позивний', 'Кількість'],
             ...missileRows.map(m => [m.report, m.date, m.time, m.callsign, m.count])],
      widths: [8, 12, 8, 18, 10],
    });
  }

  // Summary: consumption grouped by type.
  function totals(items, key) {
    const acc = {};
    for (const it of items) {
      const label = it[key] || '(не вказано)';
      acc[label] = (acc[label] || 0) + it.count;
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }

  const summary = [['Розхід по типах'], [],
                   ['Набої — по калібрах', 'Кількість'],
                   ...totals(ammoRows, 'caliber'),
                   ['', ''], ['Набої — по платформах', 'Кількість'],
                   ...totals(ammoRows, 'platform')];

  if (shellRows.length) {
    summary.push(['', ''], ['Снаряди — по калібрах', 'Кількість'],
                 ...totals(shellRows, 'caliber'));
  }

  summary.push(['', ''],
               ['Разом набоїв', ammoRows.reduce((s, a) => s + a.count, 0)],
               ['Разом снарядів', shellRows.reduce((s, a) => s + a.count, 0)],
               ['Разом ЗКР', missileRows.reduce((s, a) => s + a.count, 0)],
               ['Доповідей', reports.length]);

  sheets.push({ name: 'Розхід по типах', rows: summary, widths: [32, 14] });
  return sheets;
}

function renderPreview(data) {
  const out = el('out');
  const { reports } = data;

  if (!reports.length) {
    out.innerHTML = '';
    return;
  }

  let h = '<div class="wrap"><table><thead><tr>';
  for (const [, label] of REPORT_COLS) h += `<th>${escXml(label)}</th>`;
  h += '</tr></thead><tbody>';

  for (const r of reports) {
    h += '<tr>';
    for (const [k] of REPORT_COLS) h += `<td>${escXml(r[k] || '')}</td>`;
    h += '</tr>';
  }
  h += '</tbody></table></div>';
  out.innerHTML = h;
}

function download() {
  const text = el('t').value;
  const status = el('s');

  if (!text.trim()) {
    status.textContent = 'порожньо';
    status.className = 'status err';
    return;
  }

  const data = buildData(text);
  if (!data.reports.length) {
    status.textContent = 'не знайдено жодної доповіді (потрібен рядок «Дата:»)';
    status.className = 'status err';
    return;
  }

  const blob = buildXlsx(toSheets(data));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dopovidi.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  status.textContent = `готово: ${data.reports.length} доповідей`;
  status.className = 'status ok';
}

function preview() {
  const text = el('t').value;
  const status = el('s');

  if (!text.trim()) {
    status.textContent = 'порожньо';
    status.className = 'status err';
    return;
  }

  const data = buildData(text);
  status.textContent = `знайдено доповідей: ${data.reports.length}`;
  status.className = 'status ok';
  renderPreview(data);
}

if (el('go')) {
  el('go').addEventListener('click', download);
  el('prev').addEventListener('click', preview);
  el('clr').addEventListener('click', () => {
    el('t').value = '';
    el('out').innerHTML = '';
    el('s').textContent = '';
    el('t').focus();
  });
}

window.reportParser = { buildData, toSheets, buildXlsx };