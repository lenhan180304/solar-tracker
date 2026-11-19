/* Hiệu ứng nhỏ có mục đích cho bản CLOUD: số liệu đổi giá trị chạy êm (không nhảy). Bọc hàm setText() có sẵn, không đổi logic cũ. */
(function () {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches || typeof window.setText !== 'function') return;
  const orig = window.setText, FX = new Set(['pvV', 'pvI', 'pvP', 'batV', 'batI', 'batP', 'pfPvP', 'pfPvV', 'pfPvI', 'pfBatV', 'pfBatI', 'pfBatP', 'a1', 'a2', 'a1x', 'a2x']);
  const run = new Map();
  window.setText = function (id, t) {
    const e = FX.has(id) ? document.getElementById(id) : null, s = String(t).trim();
    if (!e || !/^-?\d+(\.\d+)?$/.test(s) || !/^-?\d+(\.\d+)?$/.test(e.textContent.trim())) return orig(id, t);
    const from = parseFloat(e.textContent), to = parseFloat(s), dec = (s.split('.')[1] || '').length;
    if (from === to) return orig(id, t);
    cancelAnimationFrame(run.get(id)); const t0 = performance.now(), D = 320;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / D), k = 1 - Math.pow(1 - p, 3);
      if (p < 1) { e.textContent = (from + (to - from) * k).toFixed(dec); run.set(id, requestAnimationFrame(step)); } else orig(id, t);
    };
    run.set(id, requestAnimationFrame(step));
  };
})();

/* Gợn sóng khi bấm nút (hiệu ứng phản hồi cho thao tác) */
(function () {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  document.addEventListener('pointerdown', function (ev) {
    const b = ev.target.closest && ev.target.closest('.btn,.badge-btn,.cpill');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, s = document.createElement('span');
    s.className = 'fx-ripple'; s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (ev.clientX - r.left - d / 2) + 'px;top:' + (ev.clientY - r.top - d / 2) + 'px';
    b.appendChild(s); setTimeout(function () { s.remove(); }, 600);
  }, { passive: true });
})();

/* Số vừa đổi giá trị: viền sáng thoáng qua ở thẻ chứa nó (báo "dữ liệu mới") */
(function () {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const last = new Map(), IDS = ['pvV', 'pvI', 'pvP', 'batV', 'batI', 'batP'];
  setInterval(function () {
    IDS.forEach(function (id) {
      const e = document.getElementById(id); if (!e) return;
      const t = e.textContent; if (last.get(id) !== undefined && last.get(id) !== t) { const c = e.closest('.card'); if (c) { c.classList.remove('fx-flash'); void c.offsetWidth; c.classList.add('fx-flash'); } }
      last.set(id, t);
    });
  }, 1000);
})();
