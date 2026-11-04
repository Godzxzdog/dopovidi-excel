/* Report builder: form fields -> finished briefing text.
 *
 * The output follows the exact wording the unit uses, including the
 * sub-line indentation under "Знищено: ..." and the aligned signature.
 */

'use strict';

const INDENT = '         ';   // 9 spaces, as in the sample

const el = id => document.getElementById(id);

// ---------------------------------------------------------------- dynamic rows

function rowHtml(kind, a, b) {
  if (kind === 'left_regions') {
    return `<div class="rowline">
      <input type="number" min="0" value="${a ?? ''}" placeholder="0" class="w-num" data-k="count">
      <input type="text" value="${b ?? ''}" placeholder="Житомирську" class="grow" data-k="region">
      <span class="unit">область</span>
      <button type="button" class="del" title="видалити">×</button>
    </div>`;
  }
  return `<div class="rowline">
    <input type="number" min="0" value="${a ?? ''}" placeholder="0" class="w-num" data-k="count">
    <input type="text" value="${b ?? ''}" placeholder="силами ТГр ППО «Вінниця»" class="grow" data-k="force">
    <button type="button" class="del" title="видалити">×</button>
  </div>`;
}

function addRow(containerId, a = 0, b = '') {
  const box = el(containerId);
  const wrap = document.createElement('div');
  wrap.innerHTML = rowHtml(containerId, a, b).trim();
  const node = wrap.firstElementChild;
  node.querySelector('.del').addEventListener('click', () => node.remove());
  box.appendChild(node);
  return node;
}

function readRows(containerId) {
  return [...el(containerId).querySelectorAll('.rowline')].map(r => {
    const get = k => {
      const f = r.querySelector(`[data-k="${k}"]`);
      return f ? f.value.trim() : '';
    };
    if (containerId === 'left_regions') {
      return { count: get('count'), region: get('region') };
    }
    return { count: get('count'), force: get('force') };
  }).filter(r => r.count !== '' || (r.force || r.region) !== '');
}

if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addRow(btn.dataset.add));
  });
}

// ---------------------------------------------------------------- text

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function pluralUav(n, form) {
  // form: 'ударних БпЛА' etc. — kept literal; only the prefix number changes.
  return `${n} - ${form}`;
}

function trimZone(z) {
  return z.trim();
}

function build(d) {
  const out = [];
  const zone = trimZone(d.zone);
  const zoneQ = zone;

  out.push("Бажаю здоров'я!");
  out.push('');
  out.push(`У період з ${d.from_time} ${d.from_date} до ${d.to_time} ${d.to_date} `
    + `в межах зони відповідальності ${zoneQ} противником було застосовано:`);
  out.push(`${d.applied_cruise} – крилатихих ракет`);

  if (d.applied_uav_reactive > 0) {
    out.push(`${d.applied_uav} - ударних БпЛА `
      + `(з них - ${d.applied_uav_reactive} БпЛА реактивних).`);
  } else {
    out.push(`${d.applied_uav} - ударних БпЛА.`);
  }

  if (d.destroyed_uav > 0) {
    const byUav = d.uav_forces.filter(r => num(r.count) > 0);
    const reactLine = d.destroyed_uav_reactive > 0
      ? ` (з них ${d.destroyed_uav_reactive} реактивних)` : '';
    out.push(`${d.destroyed_uav} - ударних БпЛА${reactLine}:`.replace(
      /^(\d+)/, 'Знищено: $1'));
    byUav.forEach((r, i) => {
      const line = `${num(r.count)} - ударних БпЛА ${r.force}`;
      out.push(i === 0 ? line + ';' : INDENT + line + (i === byUav.length - 1 ? '.' : ';'));
    });
    if (!byUav.length) out[out.length - 1] = out[out.length - 1].replace(/:$/, '.');
  }

  if (d.destroyed_cruise > 0) {
    const byCr = d.cr_forces.filter(r => num(r.count) > 0);
    out.push(`Знищено ${d.destroyed_cruise} – крилатихих ракет:`);
    byCr.forEach((r, i) => {
      const n = num(r.count);
      const noun = n === 1 ? 'крилату ракету' : 'крилатихих ракет';
      const line = `${n} - ${noun} ${r.force}`;
      out.push(i === 0 ? line + ';' : INDENT + line + (i === byCr.length - 1 ? '.' : ';'));
    });
    if (!byCr.length) out[out.length - 1] = out[out.length - 1].replace(/:$/, '.');
  }

  const regions = d.left_regions.filter(r => num(r.count) > 0 && r.region);
  if (d.left_total > 0 || regions.length) {
    const parts = regions.map(r => `${num(r.count)} - в ${r.region} область`);
    const tail = parts.length ? ` (${parts.join('; ')})` : '';
    out.push(`Вийшли із зони відповідальності ${zoneQ}: `
      + `${d.left_total} - ударних БпЛА${tail}`.trim());
  }

  if (d.lost_uav > 0 || d.lost_cruise > 0) {
    out.push(`Локаційно втрачено:  ${d.lost_uav} - ударних БпЛА `
      + `та ${d.lost_cruise} крилатихих ракет.`);
  }

  if (d.weapon_uses > 0) {
    out.push(`Підрозділи ${zoneQ} застосовували зброю - ${d.weapon_uses} разів.`);
  }

  if (d.weapons) out.push(`Застосовувалась зброя: ${d.weapons}`);

  if (d.ci_count > 0) {
    out.push('');
    out.push(`Уражено об’єктів критичної інфраструктури - ${d.ci_count} об’єкт:`);
    if (d.ci_text) out.push(d.ci_text.replace(/\s+/g, ' ').trim());
  }

  out.push('');
  if (d.signer_role) out.push(d.signer_role);
  out.push(`${d.signer_rank.padEnd(22)}${d.signer_name}`.trimEnd());

  return out.join('\n');
}

// ---------------------------------------------------------------- wiring

function collect() {
  const f = el('f');
  const val = n => (f.elements[n] ? f.elements[n].value.trim() : '');
  const int = n => num(val(n));

  return {
    from_time: val('from_time'),
    from_date: val('from_date'),
    to_time: val('to_time'),
    to_date: val('to_date'),
    zone: val('zone'),

    applied_cruise: int('applied_cruise'),
    applied_uav: int('applied_uav'),
    applied_uav_reactive: int('applied_uav_reactive'),

    destroyed_uav: int('destroyed_uav'),
    destroyed_uav_reactive: 0,
    destroyed_cruise: int('destroyed_cruise'),

    uav_forces: readRows('uav_forces'),
    cr_forces: readRows('cr_forces'),
    left_regions: readRows('left_regions'),

    weapons: val('weapons'),
    left_total: int('left_total'),
    lost_uav: int('lost_uav'),
    lost_cruise: int('lost_cruise'),
    weapon_uses: int('weapon_uses'),

    ci_count: int('ci_count'),
    ci_text: val('ci_text'),

    signer_role: val('signer_role'),
    signer_rank: val('signer_rank'),
    signer_name: val('signer_name'),
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
  a.download = 'dopovid.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// seed rows so the page opens with a usable shape
if (el('uav_forces')) {
  addRow('uav_forces', 0, 'силами ТГр ППО «Вінниця»');
  addRow('uav_forces', 0, 'силами армійської авіації');
  addRow('cr_forces', 0, 'силами ТГр ППО «Вінниця»');
  addRow('cr_forces', 0, 'силами армійської авіації');
  addRow('left_regions', 0, 'Житомирську');
  addRow('left_regions', 0, 'Хмельницьку');
  addRow('left_regions', 0, 'Чернівецька');

  el('build').addEventListener('click', run);
  el('copy').addEventListener('click', copyOut);
  el('dl').addEventListener('click', downloadOut);
  el('reset').addEventListener('click', () => {
    setTimeout(() => { el('out').textContent = ''; el('status').textContent = ''; }, 0);
  });

  // live update as you type
  el('f').addEventListener('input', () => {
    if (el('out').textContent.trim()) run();
  });
}

window.reportBuilder = { build, collect };