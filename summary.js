/* Daily summary generator — browser edition.
 *
 * Parses a Ukrainian air-defence briefing in free-form prose and renders the
 * standard report layout. Mirrors summarize.py; everything stays local.
 */

'use strict';

const NUM_WORDS = {
  'нуль': 0, 'один': 1, 'одна': 1, 'одне': 1, 'два': 2, 'дві': 2,
  'три': 3, 'чотири': 4, "п'ять": 5, 'пять': 5, 'шість': 6, 'сім': 7,
  'вісім': 8, "дев'ять": 9, 'девять': 9, 'десять': 10,
  'одинадцять': 11, 'дванадцять': 12, 'тринадцять': 13,
  'чотирнадцять': 14, "п'ятнадцять": 15, 'шістнадцять': 16,
  'сімнадцять': 17, 'вісімнадцять': 18, "дев'ятнадцять": 19,
  'двадцять': 20, 'тридцять': 30, 'сорок': 40, "п'ятдесят": 50,
};

const MISSING = '--';

function toInt(token) {
  if (!token) return null;
  const t = String(token).trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return Object.prototype.hasOwnProperty.call(NUM_WORDS, t) ? NUM_WORDS[t] : null;
}

const PERIOD_RE = /з\s+(\d{1,2}[:.]\d{2})\s+(\d{1,2}[.\s]\d{1,2}[.\s]\d{2,4})\s+(?:до|по)\s+(\d{1,2}[:.]\d{2})\s+(\d{1,2}[.\s]\d{1,2}[.\s]\d{2,4})/i;
const ZONE_RE = /(Т[Гг]р\s*ППО\s*[«"“'][^»"”']+[»"”'])/u;
const UA = '[а-яіїєА-ЯІЇЄ]';
const APPLIED_RE = new RegExp('(\\d+)\\s*[-–—]?\\s*(крилат' + UA + '*\\s+ракет' + UA + '*|ударн' + UA + '*\\s+БпЛА|БпЛА)', 'gi');
const REACTIVE_TOTAL_RE = /ударних\s+БпЛА\s*\(\s*з\s+них\s*[-–—]?\s*(\d+)\s+БпЛА\s+реактивн/i;
const DESTROYED_HEAD_RE = new RegExp('Знищено\\s*:?\\s*(\\d+)\\s*[-–—]\\s*(крилат' + UA + '*\\s+ракет' + UA + '*|ударн' + UA + '*\\s+БпЛА)', 'gi');
const DESTROYED_CRUISE_RE = new RegExp('Знищено\\s+(\\d+)\\s*[-–—]\\s*крилат' + UA + '*\\s+ракет', 'i');
const BY_FORCE_RE = new RegExp('(\\d+)\\s*[-–—]\\s*(ударн' + UA + '*\\s+БпЛА|крилат' + UA + '*\\s+ракет' + UA + '*|БпЛА)\\s+силами\\s+([^;.\\n]+?)(?:[;.]|$)', 'gim');
const WEAPONS_RE = /Застосовувала?с[яь]\s+зброя\s*:?\s*([^\n]+)/i;
const LEFT_ZONE_RE = /Вийшли\s+із\s+зони\s+відповідальності[^:]*:\s*([^\n]+)/i;
const LOST_RE = /Локаційно\s+втрачено\s*:?\s*([^\n.]+)/i;
const USES_RE = /застосовували\s+зброю\s*[-–—]\s*(\d+)\s*раз/i;
const CI_RE = /Уражено\s+об[’'`]?єкт[а-яіїєА-ЯІЇЄ]*\s+критичної\s+інфраструктури\s*[-–—]\s*(\d+)/iu;
const CI_DETAILS_RE = /(\d{1,2}:\d{2})\s+([\s\S]+)/g;
const SIGNER_RE = /^\s*(ТВО\s+командира[^\n]*)\n\s*([^\n]*?)\s{2,}([А-ЯІЇЄA-Z][^\n]*)\s*$/m;

function normDate(raw) {
  const parts = String(raw).trim().split(/[.\s]+/).filter(Boolean);
  if (parts.length !== 3) return String(raw).trim();
  const [d, m, y] = parts;
  return String(parseInt(d, 10)).padStart(2, '0') + '.'
       + String(parseInt(m, 10)).padStart(2, '0') + '.' + y;
}

const normTime = raw => String(raw).replace(/\./g, ':');

function parse(text) {
  const d = { warnings: [] };
  const flat = text.replace(/[ \t]+/g, ' ');

  let m = flat.match(PERIOD_RE);
  if (m) {
    d.from_time = normTime(m[1]);
    d.from_date = normDate(m[2]);
    d.to_time = normTime(m[3]);
    d.to_date = normDate(m[4]);
  } else {
    d.warnings.push('Період не знайдено');
    d.from_time = d.from_date = d.to_time = d.to_date = MISSING;
  }

  m = text.match(ZONE_RE);
  d.zone = m ? m[1].trim() : MISSING;
  if (!m) d.warnings.push('Зону відповідальності не знайдено');

  // ---- applied (digits first, then spelled-out numbers)
  const applied = {};
  let g;
  const rxApplied = new RegExp(APPLIED_RE.source, 'gi');
  while ((g = rxApplied.exec(flat)) !== null) {
    const kind = g[2].toLowerCase();
    const key = kind.includes('ракет') ? 'cruise' : 'uav';
    if (!(key in applied)) applied[key] = parseInt(g[1], 10);
  }
  if (!('cruise' in applied) || !('uav' in applied)) {
    const words = Object.keys(NUM_WORDS).join('|');
    const rxWord = new RegExp(
      '(' + words + ')\\s*[-–—]?\\s*(крилат' + UA + '*\\s+ракет' + UA
      + '*|ударн' + UA + '*\\s+БпЛА|БпЛА)', 'gi');
    while ((g = rxWord.exec(flat)) !== null) {
      const n = toInt(g[1]);
      if (n === null) continue;
      const kind = g[2].toLowerCase();
      const key = kind.includes('ракет') ? 'cruise' : 'uav';
      if (!(key in applied)) applied[key] = n;
    }
  }
  d.applied_cruise = applied.cruise || 0;
  d.applied_uav = applied.uav || 0;

  m = flat.match(REACTIVE_TOTAL_RE);
  d.applied_uav_reactive = m ? parseInt(m[1], 10) : 0;

  // ---- destroyed
  const destroyed = { cruise: null, uav: null };
  const rxHead = new RegExp(DESTROYED_HEAD_RE.source, 'gi');
  while ((g = rxHead.exec(flat)) !== null) {
    const kind = g[2].toLowerCase();
    destroyed[kind.includes('ракет') ? 'cruise' : 'uav'] = parseInt(g[1], 10);
  }
  m = flat.match(DESTROYED_CRUISE_RE);
  if (m && destroyed.cruise === null) destroyed.cruise = parseInt(m[1], 10);

  d.destroyed_cruise = destroyed.cruise === null ? MISSING : destroyed.cruise;
  d.destroyed_uav = destroyed.uav === null ? MISSING : destroyed.uav;

  // ---- by force
  d.by_force = [];
  const rxForce = new RegExp(BY_FORCE_RE.source, 'gim');
  while ((g = rxForce.exec(flat)) !== null) {
    const kind = g[2].toLowerCase();
    d.by_force.push({
      count: parseInt(g[1], 10),
      kind: kind.includes('ракет') ? 'крилата ракета' : 'ударний БпЛА',
      force: g[3].replace(/\s+/g, ' ').replace(/[ .;,]+$/, ''),
    });
  }

  // ---- weapons
  m = text.match(WEAPONS_RE);
  if (m) {
    d.weapons = m[1].split(/[,;]/).map(w => w.trim()).filter(Boolean);
  } else {
    d.weapons = [];
    d.warnings.push('Перелік зброї не знайдено');
  }

  // ---- left the zone
  m = flat.match(LEFT_ZONE_RE);
  if (m) {
    const chunk = m[1];
    const total = chunk.match(/^\s*(\d+)/);
    d.left_total = total ? parseInt(total[1], 10) : MISSING;
    d.left_regions = [];
    for (const part of chunk.split(/[;,]/)) {
      const r = part.match(/(\d+)\s*[-–—]?\s*(?:в|у)?\s*([А-ЯІЇЄ][а-яіїє]*)\s*(?:област|обл)/u);
      if (r) d.left_regions.push({ count: parseInt(r[1], 10), region: r[2] });
    }
  } else {
    d.left_total = MISSING;
    d.left_regions = [];
  }

  // ---- lost locally
  m = flat.match(LOST_RE);
  if (m) {
    const chunk = m[1];
    const uav = chunk.match(/(\d+)[^0-9]*БпЛА/);
    const cruise = chunk.match(/(\d+)[^0-9]*ракет/);
    d.lost_uav = uav ? parseInt(uav[1], 10) : 0;
    d.lost_cruise = cruise ? parseInt(cruise[1], 10) : 0;
  } else {
    d.lost_uav = MISSING;
    d.lost_cruise = MISSING;
  }

  // ---- weapon uses
  m = flat.match(USES_RE);
  d.weapon_uses = m ? parseInt(m[1], 10) : MISSING;

  // ---- critical infrastructure
  m = flat.match(CI_RE);
  d.ci_count = m ? parseInt(m[1], 10) : 0;

  d.ci_details = [];
  if (d.ci_count) {
    let idx = flat.indexOf('критичної інфраструктури');
    if (idx < 0) idx = flat.search(/Уражено\s+об[’'`]?єкт/iu);
    const tail = idx >= 0 ? flat.slice(idx) : '';
    const rxDet = new RegExp(CI_DETAILS_RE.source, 'g');
    let c;
    while ((c = rxDet.exec(tail)) !== null) {
      let body = c[2].trim();
      body = body.split(/\n\s*(?:ТВО|Підрозділи)/)[0].trim();
      if (body.length > 15) {
        d.ci_details.push({ time: normTime(c[1]), text: body });
      }
    }
  }

  // ---- signer
  m = text.match(SIGNER_RE);
  if (m) {
    d.signer_role = m[1].trim();
    d.signer_rank = m[2].trim();
    d.signer_name = m[3].trim();
  } else {
    d.signer_role = d.signer_rank = d.signer_name = MISSING;
    d.warnings.push('Підпис не розпізнано');
  }

  return d;
}

function pct(part, total) {
  if (typeof total !== 'number' || !total) return '';
  return ` (${Math.round((part / total) * 100)}%)`;
}

function render(d) {
  const out = [];
  out.push("Бажаю здоров'я!");
  out.push('');
  out.push(`У період з ${d.from_time} ${d.from_date} до ${d.to_time} ${d.to_date} `
    + `в межах зони відповідальності ${d.zone} противником було застосовано:`);
  out.push(`${d.applied_cruise} – крилатих ракет`);
  if (d.applied_uav_reactive) {
    out.push(`${d.applied_uav} - ударних БпЛА (з них - ${d.applied_uav_reactive} БпЛА реактивних).`);
  } else {
    out.push(`${d.applied_uav} - ударних БпЛА.`);
  }

  if (typeof d.destroyed_uav === 'number') {
    out.push(`Знищено: ${d.destroyed_uav} - ударних БпЛА${pct(d.destroyed_uav, d.applied_uav)}:`);
    const byUav = d.by_force.filter(b => b.kind === 'ударний БпЛА');
    byUav.forEach((b, i) => out.push(
      `${b.count} - ударних БпЛА силами ${b.force}${i < byUav.length - 1 ? ';' : '.'}`));
  }

  if (typeof d.destroyed_cruise === 'number') {
    out.push(`Знищено ${d.destroyed_cruise} – крилатих ракет${pct(d.destroyed_cruise, d.applied_cruise)}:`);
    const byCr = d.by_force.filter(b => b.kind === 'крилата ракета');
    byCr.forEach((b, i) => out.push(
      `${b.count} – крилату ракету силами ${b.force}${i < byCr.length - 1 ? ';' : '.'}`));
  }

  if (d.weapons.length) out.push('Застосовувалась зброя: ' + d.weapons.join(', '));

  if (d.left_total !== MISSING || d.left_regions.length) {
    const parts = d.left_regions.map(r => `${r.count} - в ${r.region} область`);
    const tail = parts.length ? ` (${parts.join('; ')})` : '';
    out.push(`Вийшли із зони відповідальності ${d.zone}: ${d.left_total} - ударних БпЛА${tail}`);
  }

  if (d.lost_uav !== MISSING || d.lost_cruise !== MISSING) {
    out.push(`Локаційно втрачено: ${d.lost_uav} - ударних БпЛА та ${d.lost_cruise} крилатих ракет.`);
  }

  if (d.weapon_uses !== MISSING) {
    out.push(`Підрозділи ${d.zone} застосовували зброю - ${d.weapon_uses} разів.`);
  }

  if (d.ci_count) {
    out.push('');
    out.push(`Уражено об'єктів критичної інфраструктури - ${d.ci_count} об'єкт:`);
    for (const det of d.ci_details) out.push(`${det.time} ${det.text}`);
  }

  out.push('');
  out.push(d.signer_role);
  if (d.signer_rank !== MISSING) {
    out.push(d.signer_rank.padEnd(22) + d.signer_name);
  } else {
    out.push(d.signer_name);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- ui

const el = id => document.getElementById(id);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function run() {
  const text = el('src').value;
  const status = el('status');
  const body = el('report');

  if (!text.trim()) {
    status.textContent = 'порожньо';
    status.className = 'status err';
    body.textContent = '';
    return;
  }

  const data = parse(text);
  const report = render(data);

  body.textContent = report;
  el('warn').textContent = data.warnings.length
    ? '[!] ' + data.warnings.join('; ')
    : '';

  const found = ['applied_cruise', 'applied_uav', 'destroyed_uav', 'destroyed_cruise']
    .filter(k => typeof data[k] === 'number').length;
  status.textContent = data.warnings.length
    ? `готово, але ${data.warnings.length} полів не знайдено`
    : 'готово — усі поля розпізнано';
  status.className = data.warnings.length ? 'status err' : 'status ok';
}

async function copyOut() {
  const txt = el('report').textContent;
  if (!txt.trim()) return;
  try {
    await navigator.clipboard.writeText(txt);
    el('status').textContent = 'скопійовано';
    el('status').className = 'status ok';
  } catch (e) {
    el('status').textContent = 'не вдалось скопіювати';
    el('status').className = 'status err';
  }
}

function downloadOut() {
  const txt = el('report').textContent;
  if (!txt.trim()) return;
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dopovid.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function clearAll() {
  el('src').value = '';
  el('report').textContent = '';
  el('status').textContent = '';
  el('warn').textContent = '';
  el('src').focus();
}

if (el('run')) {
  el('run').addEventListener('click', run);
  el('copy').addEventListener('click', copyOut);
  el('dl').addEventListener('click', downloadOut);
  el('clr').addEventListener('click', clearAll);
}

window.summaryParser = { parse, render };