/* Hit report builder: form fields -> "Довідка про влучання".
 *
 * Layout follows the unit's Word template: object heading centred with an
 * optional note line under it, indented body, forces list, then conclusions.
 * Optional lines appear only when their field is filled in.
 */

'use strict';

const el = id => document.getElementById(id);

const IND = '           ';      // indentation inside "Здійснено:"

function addRow(containerId, value = '') {
  const box = el(containerId);
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="rowline">
      <input type="text" value="${value.replace(/"/g, '&quot;')}"
             placeholder="31 мобільних вогневих груп, озброєних: ЗУ-23-2 - 3 од. ..." class="grow" data-k="text">
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

  // ---- 1. period
  out.push(`За період з ${d.from_time} ${d.from_date}`);
  out.push(`до ${d.to_time} ${d.to_date}`);

  // ---- 2. object + optional note
  out.push('');
  out.push(d.object);
  if (d.object_note) out.push(d.object_note);

  // ---- 3. target
  const target = d.target_count > 0
    ? `В напрямку об’єкту спрямовано: ${d.target_count} БпЛА`
      + (d.target_desc ? ` (${d.target_desc})` : '')
    : `В напрямку об’єкту спрямовано: —`;
  out.push(target);
  out.push(`Район пуску: ${d.launch_area || 'невідомо'}`);

  // ---- 4. flight parameters
  out.push(`Висота польоту: ${d.altitude};`);
  out.push(`Швидкість польоту: ${d.speed}`);
  out.push(`Метеорологічні умови: ${d.weather}`);
  out.push(`Атака об’єкту здійснювалась: ${d.attack_dir}.`);

  // ---- 5. destruction result
  out.push(`Знищено/подавлено – ${d.destroyed} БпЛА`);
  out.push('Здійснено:');
  out.push(`застосування БпЛА-перехоплювачів – ${d.interceptors};`);
  out.push(`застосувань МВГ – ${d.mvg};`);
  if (d.mvg_moves !== null) {
    out.push(`переміщень МВГ – ${d.mvg_moves} МВГ,`);
  }
  if (d.rlv !== null) out.push(`РЛВ – ${d.rlv} ;`);
  if (d.aviation !== null) out.push(`застосування тактичної авіації – ${d.aviation}.`);
  if (d.manpads !== null) out.push(`застосувань ПЗРК – ${d.manpads}`);
  out.push(`Локаційно втрачених – ${d.lost} БпЛА.`);

  // ---- 6. air-defence cover
  out.push('До протиповітряного прикриття об’єкта було залучено:');
  for (const f of d.forces) out.push(f);

  // ---- 7. hits and debris
  if (d.hits > 0) {
    out.push(`${d.hits_label} – ${d.hits} БпЛА`);
    if (d.hits_text) out.push(d.hits_text);
  }

  // ---- 8-9. conclusions
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
  // optional numbers: empty field -> null so the line is omitted
  const opt = n => (val(n) === '' ? null : num(val(n)));

  return {
    from_time: val('from_time'),
    from_date: val('from_date'),
    to_time: val('to_time'),
    to_date: val('to_date'),
    object: val('object'),
    object_note: val('object_note'),
    target_count: int('target_count'),
    target_desc: val('target_desc'),
    launch_area: val('launch_area'),
    altitude: val('altitude'),
    speed: val('speed'),
    weather: val('weather').replace(/\s+/g, ' '),
    attack_dir: val('attack_dir'),
    destroyed: int('destroyed'),
    lost: int('lost'),
    interceptors: int('interceptors'),
    mvg: int('mvg'),
    mvg_moves: opt('mvg_moves'),
    rlv: opt('rlv'),
    aviation: opt('aviation'),
    manpads: opt('manpads'),
    forces: readRows('forces'),
    hits: int('hits'),
    hits_label: val('hits_label') || 'Влучання, Падіння уламків',
    hits_text: val('hits_text'),
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
  a.download = 'dovidka-vluchannia.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

if (el('forces')) {
  addRow('forces', '31 мобільних вогневих (вогневих) груп, озброєних: ЗУ-23-2 - 3 од., ЗПУ-2 – 1 од., ПЗРК - 2 од., НР-30 - 2 од., ГШ-23 - 6 од., ВКК - 17 од., Gepard – 1 од.');
  addRow('forces', '0 екіпажів БпЛА перехоплювачів.');

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