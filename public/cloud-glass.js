/* Bản CLOUD: nền video (chỉ các trang bên trong) + hiệu ứng "liquid glass" khi nhấn mọi nút.
   Không đổi logic gốc: chỉ thêm lớp phủ ánh sáng tạm thời vào nút lúc nhấn rồi gỡ ra. */
(function () {
  'use strict';
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  /* ---- 1) Video nền: chạy khi đã vào trang quản lý; dừng khi ở trang đăng nhập / tab ẩn ---- */
  var v = document.getElementById('bgVideo');
  var login = document.getElementById('login');
  function syncVideo() {
    if (!v) return;
    var run = !(login && login.classList.contains('show')) && !document.hidden && !reduce.matches;
    if (run) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else if (!v.paused) v.pause();
  }
  if (v) {
    v.muted = true;
    if (login) new MutationObserver(syncVideo).observe(login, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', syncVideo);
    if (reduce.addEventListener) reduce.addEventListener('change', syncVideo);
    syncVideo();
  }

  /* ---- 2) Liquid glass khi nhấn ---- */
  var SEL = 'button, .tab, .btn, [role="button"], .seg a, input[type="submit"], input[type="button"]';
  var cur = null, ov = null, hold = null;

  function setPos(e) {
    if (!cur || !ov) return;
    var r = cur.getBoundingClientRect();
    var x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    ov.style.setProperty('--lx', x + 'px'); ov.style.setProperty('--ly', y + 'px');
    return { x: x, y: y, r: r };
  }

  function press(b, e) {
    release();
    cur = b;
    if (getComputedStyle(b).position === 'static') b.classList.add('lgx-rel');
    ov = document.createElement('span'); ov.className = 'lgx'; ov.setAttribute('aria-hidden', 'true');
    b.appendChild(ov);
    var p = setPos(e);
    if (!reduce.matches) {
      var rip = document.createElement('i'); rip.className = 'lgx-rip';
      var d = Math.max(p.r.width, p.r.height) * 2.4;
      rip.style.width = rip.style.height = d + 'px'; rip.style.left = p.x + 'px'; rip.style.top = p.y + 'px';
      ov.appendChild(rip);
      if (b.animate) hold = b.animate([{ scale: '1' }, { scale: '1.07 0.92', offset: 0.45 }, { scale: '1.045 1.01' }],
        { duration: 280, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
    }
    b.classList.add('lgx-pressed');
    var o = ov; requestAnimationFrame(function () { o.classList.add('on'); });
  }

  function release() {
    if (!cur) return;
    var b = cur, o = ov;
    cur = null; ov = null;
    if (hold) {
      if (b.animate) b.animate([{ scale: '1.045 1.01' }, { scale: '0.965 1.045', offset: 0.32 }, { scale: '1.015 0.99', offset: 0.68 }, { scale: '1' }],
        { duration: 560, easing: 'cubic-bezier(.25,.8,.25,1)' });
      hold.cancel(); hold = null;
    }
    b.classList.remove('lgx-pressed');
    if (o) { o.classList.remove('on'); setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); if (!b.querySelector('.lgx')) b.classList.remove('lgx-rel'); }, 650); }
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.button && e.button !== 0) return;
    var b = e.target.closest && e.target.closest(SEL);
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true' || b.closest('#login')) return;
    press(b, e);
  }, { passive: true });
  document.addEventListener('pointermove', function (e) { if (cur) setPos(e); }, { passive: true });
  ['pointerup', 'pointercancel', 'blur'].forEach(function (t) { (t === 'blur' ? window : document).addEventListener(t, release, { passive: true }); });
  document.addEventListener('keydown', function (e) {           // bàn phím: Enter / Space cũng có hiệu ứng
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement && document.activeElement.matches && document.activeElement.matches(SEL) && !cur) {
      var r = document.activeElement.getBoundingClientRect();
      press(document.activeElement, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    }
  });
  document.addEventListener('keyup', function (e) { if (e.key === 'Enter' || e.key === ' ') release(); });
})();
