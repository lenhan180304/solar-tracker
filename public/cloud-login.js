/* Trang đăng nhập bản CLOUD: hiện/ẩn mật khẩu, "Quên mật khẩu?". Đăng nhập vẫn do doLogin() gốc xử lý. */
(function () {
  var eye = document.getElementById('lgEye'), pass = document.getElementById('lgPass');
  var err = document.getElementById('loginErr'), forgot = document.getElementById('lgForgot');
  var form = document.querySelector('#login form');
  if (eye && pass) eye.addEventListener('click', function () {
    var show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', show ? 'true' : 'false');
    eye.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    pass.focus();
  });
  // Chưa có chức năng tự khôi phục mật khẩu: hướng dẫn liên hệ quản trị viên (admin đặt lại ở Cài đặt > Người dùng)
  if (forgot && err) forgot.addEventListener('click', function (e) {
    e.preventDefault();
    err.className = 'info';
    err.textContent = 'Liên hệ quản trị viên để được đặt lại mật khẩu.';
  });
  if (form && err) form.addEventListener('submit', function () { err.className = ''; }, true);
})();

/* Đặt quầng sáng mặt trời và vệt phản chiếu đúng vị trí mặt trời trong ảnh nền (ảnh 1672x941, background-size: cover) */
(function () {
  var IW = 1672, IH = 941, SX = 812, SY = 672, GY = 770;
  var sun = document.getElementById('lgSun'), glint = document.getElementById('lgGlint');
  if (!sun) return;
  function place() {
    var W = innerWidth, H = innerHeight, s = Math.max(W / IW, H / IH);
    var ox = (W - IW * s) / 2, oy = (H - IH * s) / 2;
    sun.style.left = (ox + SX * s) + 'px'; sun.style.top = (oy + SY * s) + 'px';
    if (glint) { glint.style.left = (ox + SX * s) + 'px'; glint.style.top = (oy + GY * s) + 'px'; }
  }
  place(); addEventListener('resize', place);
})();

/* Mây giữ đúng tỉ lệ ảnh (2048x640) ở mọi kích thước màn hình: bề rộng ô lặp = chiều cao lớp x 3.2 */
(function () {
  var layers = document.querySelectorAll('.lg-clouds i');
  function size() { for (var i = 0; i < layers.length; i++) { var h = layers[i].offsetHeight; if (h) layers[i].style.setProperty('--tw', Math.max(innerWidth, Math.round(h * 2048 / 640)) + 'px'); } }
  size(); addEventListener('resize', size);
  var lg = document.getElementById('login');
  if (lg && window.MutationObserver) new MutationObserver(size).observe(lg, { attributes: true, attributeFilter: ['class'] });
})();
