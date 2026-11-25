/* Bản CLOUD – trang Tổng quan: Trung tâm điều khiển động cơ + các ô hiển thị bổ sung.
   KHÔNG tạo lệnh/giao thức mới: dùng lại cmd(), toggleAuto(), setSpeed(), bindMotorBtn() của giao diện gốc
   (lệnh m1_left / m1_right / m2_left / m2_right / stop / estop_toggle / auto_toggle / speed_set).
   Mọi trạng thái hiển thị lấy từ gói dữ liệu ESP32 (render(d)); bấm nút KHÔNG tự đổi trạng thái hiển thị. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var mcc = $('dMcc');
  if (!mcc) return;
  var last = null;            // gói dữ liệu ESP32 gần nhất
  var lastTs = 0;
  var lockMotor = true, lockMode = true;

  function isOnline() {
    try { return typeof espOnline !== 'undefined' && !!espOnline; } catch (e) { return false; }
  }
  function txt(id, t) { var e = $(id); if (e && e.textContent !== t) e.textContent = t; }
  function num(v, n) { v = Number(v); return isFinite(v) ? v.toFixed(n) : '—'; }

  /* ---- nút motor: tái sử dụng hàm gốc (Cloud: mỗi lần bấm = 1 bước 10°, không có "giữ") ---- */
  if (typeof bindMotorBtn === 'function') {
    bindMotorBtn('dM1Dn', 'm1_left', 'm1_left_hold');
    bindMotorBtn('dM1Up', 'm1_right', 'm1_right_hold');
    bindMotorBtn('dM2L', 'm2_left', 'm2_left_hold');
    bindMotorBtn('dM2R', 'm2_right', 'm2_right_hold');
  }
  // Chặn ở pha capture: khi đang khoá (AUTO / offline / E-STOP / LOCAL / mô phỏng) lệnh tay KHÔNG được gửi
  ['mousedown', 'mouseup', 'touchstart', 'touchend', 'click'].forEach(function (ev) {
    mcc.addEventListener(ev, function (e) {
      var b = e.target.closest && e.target.closest('.mcc-btns .btn');
      if (b && lockMotor) {
        e.stopImmediatePropagation(); e.preventDefault();
        if (ev === 'click' && typeof toast === 'function') toast(noteText(last).t, 'warn', 2600);
      }
    }, true);
  });

  /* ---- AUTO / MANUAL: gửi lệnh có sẵn auto_toggle chỉ khi cần đổi; hiển thị theo xác nhận từ ESP32 ---- */
  window.dashMode = function (wantAuto) {
    if (!last) { if (typeof toast === 'function') toast('Chưa có dữ liệu từ ESP32', 'warn'); return; }
    if (lockMode) { if (typeof toast === 'function') toast(noteText(last).t, 'warn', 3000); return; }
    if (!!last.autoMode === !!wantAuto) return;            // đã đúng chế độ: không gửi lệnh
    if (typeof toggleAuto === 'function') toggleAuto();
  };

  /* ---- bật/tắt từng đường trên biểu đồ công suất ---- */
  window.miniPV = true; window.miniBat = true;
  window.dashSeries = function (k) {
    if (k === 'pv') window.miniPV = !window.miniPV; else window.miniBat = !window.miniBat;
    var b = $(k === 'pv' ? 'dLgPv' : 'dLgBat');
    if (b) b.setAttribute('aria-pressed', String(k === 'pv' ? window.miniPV : window.miniBat));
    if (typeof drawMini === 'function') drawMini();
  };

  /* ---- lý do khoá + ghi chú ---- */
  function noteText(d) {
    if (!isOnline()) return { k: 'bad', t: 'ESP32 chưa kết nối: không gửi được lệnh điều khiển', motor: true, mode: true };
    if (!d) return { k: '', t: 'Chờ dữ liệu từ ESP32...', motor: true, mode: true };
    if (d.eStop) return { k: 'bad', t: 'Đang DỪNG KHẨN CẤP: nhả E-STOP trước khi điều khiển (đổi chế độ không nhả E-STOP)', motor: true, mode: true };
    if (d.simMode) return { k: 'warn', t: 'Đang MÔ PHỎNG: MATLAB điều khiển, tắt mô phỏng tại thiết bị để điều khiển tay', motor: true, mode: true };
    if (d.controlOwner === 'LOCAL') return { k: 'warn', t: 'Đang có người điều khiển tại chỗ (LOCAL): lệnh từ Cloud bị từ chối trong 30 s', motor: true, mode: true };
    if (d.autoMode) return { k: 'ok', t: 'AUTO: ESP32 tự bám nắng. Chọn MANUAL để điều khiển tay.', motor: true, mode: false };
    return { k: 'warn', t: 'MANUAL: điều khiển tay, mỗi lần bấm quay 10°. Chọn AUTO để ESP32 tự bám nắng.', motor: false, mode: false };
  }

  function stateText(run, st) { return run ? 'ĐANG QUAY' + (st && st !== 'STOP' ? ' · ' + st : '') : 'ĐANG DỪNG'; }

  function apply() {
    var d = last, n = noteText(d);
    lockMotor = n.motor; lockMode = n.mode;
    var note = $('dMccNote'); if (note) { note.textContent = n.t; note.className = 'mcc-note' + (n.k ? ' ' + n.k : ''); }
    mcc.classList.toggle('lock-motor', lockMotor);
    ['dM1Dn', 'dM1Up', 'dM2L', 'dM2R'].forEach(function (id) { var b = $(id); if (b) b.disabled = lockMotor; });
    var auto = !!(d && d.autoMode), known = !!d && isOnline();
    var ba = $('dModeAuto'), bm = $('dModeMan');
    if (ba) { ba.classList.toggle('on', known && auto); ba.disabled = lockMode; ba.setAttribute('aria-pressed', String(known && auto)); }
    if (bm) { bm.classList.toggle('on', known && !auto); bm.disabled = lockMode; bm.setAttribute('aria-pressed', String(known && !auto)); }
    // ô "Chế độ" trên dải trạng thái
    var v = $('dStModeV');
    if (v) {
      var cls = 'v ' + (!known ? 'na' : (d.eStop ? 'bad' : (auto ? 'ok' : 'warn')));
      if (v.className !== cls) v.className = cls;
      var s = v.querySelector('span'); var t = !known ? '--' : (auto ? 'AUTO' : 'MANUAL');
      if (s && s.textContent !== t) s.textContent = t;
    }
    txt('dStModeD', !known ? '--' : (d.eStop ? 'E-STOP đang bật' : (auto ? 'ESP32 tự bám nắng' : 'Điều khiển tay')));
  }

  function show(d) {
    last = d; lastTs = Date.now();
    // trạng thái motor (theo phản hồi ESP32)
    txt('dTrkM1', stateText(!!d.motor1Running, d.motor1State) + ' · ' + num(d.motor1Angle, 1) + '°');
    txt('dTrkM2', stateText(!!d.motor2Running, d.motor2State) + ' · ' + num(d.motor2Angle, 1) + '°');
    var now = new Date(); txt('dTrkUpd', now.toTimeString().slice(0, 8));
    // tốc độ hiện tại
    var spd = $('dSpd');
    if (spd) spd.querySelectorAll('[data-lv]').forEach(function (b) { b.classList.toggle('on', Number(b.dataset.lv) === Number(d.speedLevel)); });
    // nút E-STOP trong khối điều khiển
    var es = $('dEstop');
    if (es) {
      var c = 'estop ctl safety' + (d.eStop ? ' active' : ''); if (es.className !== c) es.className = c;
      txt('dEstop', d.eStop ? 'Đang dừng khẩn cấp · bấm để nhả' : 'Dừng khẩn cấp');
    }
    // thanh tỉ lệ công suất PV (định mức 20 W) và SOC ước tính của firmware
    var pb = $('pvBar'); if (pb) pb.style.width = (d.inaPV ? Math.max(0, Math.min(100, Number(d.solarPower) / 20 * 100)) : 0).toFixed(1) + '%';
    var bb = $('batBar'); if (bb) { bb.style.width = (d.inaBattery ? Math.max(0, Math.min(100, Number(d.batterySOC) || 0)) : 0) + '%'; bb.parentNode.title = 'SOC ước tính (firmware)'; }
    // tủ điện
    txt('dEnvT', d.dhtOK ? num(d.temp, 1) + ' °C' : '—');
    txt('dEnvH', d.dhtOK ? num(d.humi, 1) + ' %' : '—');
    txt('dEnvFan', d.fanState ? 'Đang chạy' : 'Tắt');
    apply();
  }

  var prev = window.render;
  if (typeof prev === 'function') {
    window.render = function () {
      var r = prev.apply(this, arguments);
      try { if (arguments[0]) show(arguments[0]); } catch (e) { /* không làm hỏng giao diện chính */ }
      return r;
    };
  }
  setInterval(apply, 1000);   // mất kết nối ESP32 -> khoá ngay cả khi không có gói dữ liệu mới
  apply();
})();
