/* Menus deroulants au style du site : remplace automatiquement chaque <select> natif.
   Le <select> reste dans la page (cache) : .value, onchange et oninput continuent de fonctionner. */
(function () {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

  function enhance(sel) {
    if (sel.dataset.ui || sel.multiple) return;
    sel.dataset.ui = '1';
    const w = document.createElement('div'); w.className = 'sel';
    if (sel.style.width) w.style.width = sel.style.width;
    sel.parentNode.insertBefore(w, sel); w.appendChild(sel); sel.tabIndex = -1;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'selb'; b.innerHTML = '<span class="sell"></span><i>▾</i>';
    const m = document.createElement('div'); m.className = 'selm'; w.append(b, m);
    b.disabled = sel.disabled;

    const label = () => { const o = sel.options[sel.selectedIndex]; b.firstChild.textContent = o ? o.textContent : ''; };
    const build = () => { m.innerHTML = [...sel.options].map((o, i) => `<div class="selo ${i === sel.selectedIndex ? 'on' : ''}" data-i="${i}"><span>${esc(o.textContent)}</span><em>${i === sel.selectedIndex ? '✓' : ''}</em></div>`).join(''); };
    const open = () => {
      document.querySelectorAll('.sel.open').forEach(x => x !== w && x.classList.remove('open'));
      build(); w.classList.add('open');
      const r = b.getBoundingClientRect(); w.classList.toggle('up', innerHeight - r.bottom < 280 && r.top > 280);
    };
    const close = () => w.classList.remove('open');
    const choose = i => {
      if (i < 0 || i >= sel.options.length) return;
      sel.selectedIndex = i; label();
      sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // garde le libelle a jour quand le code change la valeur (sel.value = ...)
    Object.defineProperty(sel, 'value', { get() { return valueDesc.get.call(sel); }, set(v) { valueDesc.set.call(sel, v); label(); }, configurable: true });

    b.onclick = () => (w.classList.contains('open') ? close() : open());
    m.onclick = e => { const o = e.target.closest('.selo'); if (!o) return; choose(+o.dataset.i); close(); b.focus(); };
    b.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); choose(sel.selectedIndex + 1); if (w.classList.contains('open')) build(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); choose(sel.selectedIndex - 1); if (w.classList.contains('open')) build(); }
      else if (e.key === 'Escape') close();
    };
    label();
  }

  const scan = root => { if (root.tagName === 'SELECT') enhance(root); else if (root.querySelectorAll) root.querySelectorAll('select').forEach(enhance); };
  document.addEventListener('click', e => document.querySelectorAll('.sel.open').forEach(w => { if (!w.contains(e.target)) w.classList.remove('open'); }));
  new MutationObserver(ms => ms.forEach(mu => mu.addedNodes.forEach(n => n.nodeType === 1 && scan(n)))).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan(document)); else scan(document);
})();
