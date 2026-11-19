/* Bản CLOUD: số liệu đổi giá trị chạy êm (không nhảy). Bọc hàm setText() có sẵn, không đổi logic gốc. */
(function () {
  if (typeof window.setText !== 'function' || (window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches)) return;
  var orig = window.setText;
  var FX = { pvV: 1, pvI: 1, pvP: 1, batV: 1, batI: 1, batP: 1, pfPvP: 1, pfBatV: 1, a1: 1, a2: 1, a1x: 1, a2x: 1, wxT: 1 };
  var NUM = /^-?\d+(\.\d+)?$/, run = {};
  window.setText = function (id, t) {
    var e = FX[id] ? document.getElementById(id) : null, s = String(t).trim();
    if (!e || !NUM.test(s) || !NUM.test(e.textContent.trim()) || document.hidden) return orig(id, t);
    var from = parseFloat(e.textContent), to = parseFloat(s), dec = (s.split('.')[1] || '').length;
    if (from === to) return orig(id, t);
    cancelAnimationFrame(run[id]);
    var t0 = performance.now(), D = 350;
    var step = function (now) {
      var p = Math.min(1, (now - t0) / D), k = 1 - Math.pow(1 - p, 3);
      if (p < 1) { e.textContent = (from + (to - from) * k).toFixed(dec); run[id] = requestAnimationFrame(step); } else orig(id, t);
    };
    run[id] = requestAnimationFrame(step);
  };
})();
