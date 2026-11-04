/* Hit report builder: form fields -> "Доповідь про влучання".
 *
 * Layout mirrors the unit's Word template: right-aligned period block, bold
 * object heading, indented numbered body, then free sections at the end.
 */

'use strict';

const el = id => document.getElementById(id);

const IND = '        ';          // 8 spaces before МВГ / ПЗРК lines
const IND2 = '      ';           // 6 spaces before "По маршруту..."
const PERIOD_PAD = '                                                                      ';

function addRow(containerId, value = '') {
  const box = el(containerId);
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="rowline">
      <input type="text" value="${value.replace(/"/g, '&quot;')}"
             placeholder="МВГ озброєння ВКК (SkySentinel)" class="grow" data-k="text">
      <button type="button" class="del" title="видалити">×</button>
    </div>`.trim();
  const node = wrap.firstElementChild;
  node.querySelector('.del').addEventListener('click', () => node.remove());
  box.appendChild(node);
  return node;
}

function readRows(containerId) {
  return [...el(containerId).querySelectorAll('.rowline')]
    .map(r => r.querySelector('[data-k="text"]').value.trim())
    .filter(Boolean);
}

if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addRow(btn.dataset.add));
  });
}

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function build(d) {
  const out = [];

  // ---- period block, right aligned in the original
  out.push(PERIOD_PAD + 'За період');
  out.push(PERIOD_PAD + `З ${d.from_time} ${d.from_date}`);
  out.push(PERIOD_PAD + `до ${d.to_time} ${d.to_date}`);

  // ---- object heading
  out.push('');
  out.push(d.object);

  // ---- target
  const targetLine = d.target_count > 0
    ? `В напрямку об’єкту спрямовано: ${d.target_count} БпЛА`
      + (d.target_desc ? ` (${d.target_desc})` : '')
    : 'В напрямку об’єкту спрямовано: —';
  out.push(targetLine);
  out.push(`Район пуску: ${d.launch_area || '.'}`);

  if (d.altitude) out.push(`Висота польоту: ${d.altitude};`);
  if (d.speed) out.push(`Швидкість польоту: ${d.speed}`);
  if (d.weather) out.push(`Метеорологічні умови: ${d.weather}`);
  if (d.attack_dir) out.push(`Атака об’єкту здійснювалась: ${d.attack_dir}.`);

  // ---- result
  out.push(`Знищено/подавлено – ${d.destroyed}`);
  out.push(`РЛВ – ${d.rlv} ;`);
  out.push('Здійснено:');
  out.push(`застосування БпЛА-перехоплювачів – ${d.interceptors};`);
  out.push(`застосування тактичної авіації – ${d.aviation}.`);
  out.push(`${IND}застосувань МВГ – ${d.mvg}`);
  out.push(`${IND}застосувань ПЗРК – ${d.manpads}`);

  // ---- forces
  if (d.forces.length) {
    out.push(`${IND2}По маршруту до об’єкта було залучено:`);
    for (const f of d.forces) out.push(f);
  }

  // ---- fall
  if (d.fall) out.push(d.fall);

  // ---- clarifications
  if (d.event || d.extinguish) {
    out.push('Уточнена інформація:');
    out.push('ПОДІЯ В НАСЛІДОК ВОРОЖОЇ АТАКИ');
    if (d.event) out.push(d.event);
    if (d.extinguish) out.push(d.extinguish);
  }

  // ---- conclusions
  if (d.causes) {
    out.push('Причини, що ускладнювали знищення:');
    out.push(d.causes);
  }
  if (d.decisions) {
    out.push('Прийняті рішення:');
    out.push(d.decisions);
  }

  return out.join('\n');
}

function collect() {
  const f = el('f');
  const val = n => (f.elements[n] ? f.elements[n].value.trim() : '');
  const int = n => num(val(n));

  return {
    from_time: val('from_time'),
    from_date: val('from_date'),
    to_time: val('to_time'),
    to_date: val('to_date'),
    object: val('object'),
    target_count: int('target_count'),
    target_desc: val('target_desc'),
    launch_area: val('launch_area'),
    altitude: val('altitude'),
    speed: val('speed'),
    weather: val('weather').replace(/\s+/g, ' '),
    attack_dir: val('attack_dir'),
    destroyed: int('destroyed'),
    rlv: int('rlv'),
    interceptors: int('interceptors'),
    aviation: int('aviation'),
    mvg: int('mvg'),
    manpads: int('manpads'),
    forces: readRows('forces'),
    fall: val('fall'),
    event: val('event'),
    extinguish: val('extinguish'),
    causes: val('causes'),
    decisions: val('decisions'),
  };
}

function run() {
  const text = build(collect());
  el('out').textContent = text;
  el('status').textContent = `готово — ${text.length} символів`;
  el('status').className = 'status ok';
  return text;
}

async function copyOut() {
  const txt = el('out').textContent || run();
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
  const txt = el('out').textContent || run();
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dopovid-vluchannia.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

if (el('forces')) {
  addRow('forces', 'МВГ озброєння ВКК (SkySentinel)');
  addRow('forces', 'ВГ озброєння ПЗРК Ігла 1');

  el('build').addEventListener('click', run);
  el('copy').addEventListener('click', copyOut);
  el('dl').addEventListener('click', downloadOut);
  el('reset').addEventListener('click', () => {
    setTimeout(() => { el('out').textContent = ''; el('status').textContent = ''; }, 0);
  });

  el('f').addEventListener('input', () => {
    if (el('out').textContent.trim()) run();
  });
}

window.hitBuilder = { build, collect };