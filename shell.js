/* Shared shell for the duty assistant workspace: top bar with tab navigation.
 *
 * Each page includes this file and calls initShell({active: 'form'}).
 * The tab list lives here only, so adding a page is a one-line change.
 */

'use strict';

const SHELL_TABS = [
  { id: 'form',    href: 'form.html',    label: 'Шаблонізатор', hint: 'поля → текст' },
  { id: 'summary', href: 'summary.html', label: 'Зведення',     hint: 'текст → рапорт' },
  { id: 'excel',   href: 'index.html',   label: 'Застосування', hint: 'пачка → Excel' },
];

function initShell(opts) {
  if (typeof document === 'undefined') return;

  const active = (opts && opts.active) || '';
  const bar = document.createElement('div');
  bar.className = 'shell-bar';

  const brand = document.createElement('a');
  brand.className = 'shell-brand';
  brand.href = 'form.html';
  brand.innerHTML = '<span class="shell-mark">ПЧ</span>'
                  + '<span class="shell-title">Робоче місце помічника чергового</span>';
  bar.appendChild(brand);

  const nav = document.createElement('nav');
  nav.className = 'shell-tabs';
  nav.setAttribute('role', 'tablist');

  for (const tab of SHELL_TABS) {
    const a = document.createElement('a');
    a.href = tab.href;
    a.className = 'shell-tab' + (tab.id === active ? ' is-active' : '');
    a.setAttribute('role', 'tab');
    a.setAttribute('aria-selected', tab.id === active ? 'true' : 'false');
    a.innerHTML = '<span class="tab-label">' + tab.label + '</span>'
                + '<span class="tab-hint">' + tab.hint + '</span>';
    nav.appendChild(a);
  }

  bar.appendChild(nav);
  document.body.insertBefore(bar, document.body.firstChild);
  document.body.classList.add('has-shell');

  // number keys switch tabs quickly
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= SHELL_TABS.length) {
      location.href = SHELL_TABS[n - 1].href;
    }
  });
}

window.initShell = initShell;
window.SHELL_TABS = SHELL_TABS;