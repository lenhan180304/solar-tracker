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
