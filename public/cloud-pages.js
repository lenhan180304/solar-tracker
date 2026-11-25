/* Bản CLOUD – 5 trang chức năng (Đo lường, Biểu đồ & báo cáo, Bám nắng, Thiết bị, Cài đặt).
   Chỉ bổ sung hiển thị và thao tác giao diện. KHÔNG tạo lệnh/giao thức/API mới: lệnh vẫn đi qua cmd() gốc,
   mọi giá trị hiển thị lấy từ gói dữ liệu ESP32 (render(d)). Không đụng trang Tổng quan. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var last = null;
  function txt(id, t) { var e = $(id); if (e && e.textContent !== t) e.textContent = t; }
  function cls(id, c) { var e = $(id); if (e && e.className !== c) e.className = c; }
  function num(v, n) { v = Number(v); return isFinite(v) ? v.toFixed(n) : '—'; }
  function online() { try { return typeof espOnline !== 'undefined' && !!espOnline; } catch (e) { return false; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* trình duyệt chặn lưu trữ */ } }
  function say(m, k, ms) { if (typeof toast === 'function') toast(m, k || 'warn', ms || 2600); }

  /* ---------- 1. Hộp xác nhận cho nút có data-confirm (chặn ở pha capture, không đổi onclick gốc) ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-confirm]');
    if (!b || b.disabled) return;
    if (!window.confirm(b.getAttribute('data-confirm'))) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);

  /* ---------- 2. Trạng thái lưu trên trang Cài đặt: theo xác nhận thật của ESP32 ---------- */
  var armRow = null, armTs = 0;
  var setPage = $('page-setting');
  if (setPage) setPage.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.set-row .ctl');
    if (b) { armRow = b.closest('.set-row'); armTs = Date.now(); }
  }, true);
  function rowState(row, k, t) {
    if (!row) return;
    var s = row.querySelector('.sr-save');
    if (!s) { s = document.createElement('span'); s.setAttribute('role', 'status'); (row.querySelector('.sr-t') || row).appendChild(s); }
    s.className = 'sr-save' + (k ? ' ' + k : ''); s.textContent = t;
  }
  if (typeof window.cmd === 'function') {
    var origCmd = window.cmd;
    window.cmd = function (c, val) {
      var row = (armRow && Date.now() - armTs < 400) ? armRow : null; armRow = null;
      var p = origCmd.apply(this, arguments);
      if (row) {
        rowState(row, '', 'Đang gửi tới ESP32...');
        Promise.resolve(p).then(function (a) {
          if (a && a.ok) rowState(row, 'ok', 'ESP32 đã xác nhận ' + new Date().toTimeString().slice(0, 8));
          else if (a) { var r = a.reason || 'Thất bại'; try { if (typeof REASONS !== 'undefined' && REASONS[r]) r = REASONS[r]; } catch (e) { } rowState(row, 'bad', 'Chưa lưu: ' + r); }
          else rowState(row, 'warn', 'Không gửi (đang có lệnh khác chờ xác nhận)');
        }, function () { rowState(row, 'bad', 'Không gửi được lệnh'); });
      }
      return p;
    };
  }

  /* ---------- 3. Bám nắng: khoá điều khiển chi tiết, cùng quy tắc với trang Tổng quan ---------- */
  var motors = document.querySelector('#page-tracking .motors');
  var lockMotor = true, lockMode = true, lockAll = true;
  function noteText(d) {
    if (!online()) return { k: 'bad', t: 'ESP32 chưa kết nối: không gửi được lệnh điều khiển', motor: true, mode: true, all: true };
    if (!d) return { k: '', t: 'Chờ dữ liệu từ ESP32...', motor: true, mode: true, all: true };
    if (d.eStop) return { k: 'bad', t: 'Đang DỪNG KHẨN CẤP: nhả E-STOP trước khi điều khiển', motor: true, mode: true, all: false };
    if (d.simMode) return { k: 'warn', t: 'Đang MÔ PHỎNG: MATLAB điều khiển, tắt mô phỏng tại thiết bị để điều khiển tay', motor: true, mode: true, all: false };
    if (d.controlOwner === 'LOCAL') return { k: 'warn', t: 'Đang có người điều khiển tại chỗ (LOCAL): lệnh từ Cloud bị từ chối trong 30 s', motor: true, mode: true, all: false };
    if (d.autoMode) return { k: 'ok', t: 'AUTO: ESP32 tự bám nắng, nút quay tay bị khoá. Bấm "AUTO TRACKING" để chuyển MANUAL.', motor: true, mode: false, all: false };
    return { k: 'warn', t: 'MANUAL: mỗi lần bấm quay 10°. Bấm "MANUAL MODE" để ESP32 tự bám nắng lại.', motor: false, mode: false, all: false };
  }
  var MOTOR_IDS = ['btnM1L', 'btnM1R', 'btnM2L', 'btnM2R'];
  if (motors) ['mousedown', 'mouseup', 'touchstart', 'touchend', 'click'].forEach(function (ev) {
    motors.addEventListener(ev, function (e) {
      var b = e.target.closest && e.target.closest('.mt-btns .btn:not(.safety)');
      if (b && lockMotor) { e.stopImmediatePropagation(); e.preventDefault(); if (ev === 'click') say(noteText(last).t, 'warn', 2600); }
    }, true);
  });
  var modeBtn = $('modeBtn');
  if (modeBtn) modeBtn.addEventListener('click', function (e) {
    if (lockMode) { e.stopImmediatePropagation(); e.preventDefault(); say(noteText(last).t, 'warn', 3000); }
  }, true);
  function applyLock() {
    var n = noteText(last);
    lockMotor = n.motor; lockMode = n.mode; lockAll = n.all;
    txt('trkLockNote', n.t); cls('trkLockNote', 'trk-lock' + (n.k ? ' ' + n.k : ''));
    if (motors) motors.classList.toggle('lock-motor', lockMotor);
    MOTOR_IDS.forEach(function (id) { var b = $(id); if (b && b.disabled !== lockMotor) b.disabled = lockMotor; });
    // tốc độ + hiệu chuẩn: chỉ khoá khi chưa nối được ESP32 (máy chủ cũng từ chối OFFLINE)
    document.querySelectorAll('#page-tracking .speedbar .ctl, #page-tracking .set-row .ctl').forEach(function (b) { if (b.disabled !== lockAll) b.disabled = lockAll; });
    // dvSeen: tuổi của bản tin cuối
    var ts = 0; try { ts = lastRenderTs || 0; } catch (e) { }
    if (ts) { var age = Math.max(0, Math.round((Date.now() - ts) / 1000)); txt('dvSeen', new Date(ts).toLocaleTimeString('vi-VN') + ' · ' + age + ' giây trước' + (online() ? '' : ' (ESP32 đang mất kết nối)')); }
    else txt('dvSeen', 'Chưa nhận được dữ liệu');
  }

  function motorText(run, st) { return run ? 'ĐANG QUAY' + (st && st !== 'STOP' ? ' · ' + st : '') : 'ĐANG DỪNG'; }

  function show(d) {
    last = d;
    // Đo lường: trạng thái sạc/xả theo quy ước chiều dòng đã chọn
    var ci = (typeof chargeInfo === 'function') ? chargeInfo(d) : null;
    if (ci) {
      var t = ci.text;
      if (ci.st === 'unk') t = 'Có dòng điện (chưa chọn quy ước chiều dòng)';
      txt('msChg', t);
      cls('msChg', ci.st === 'chg' ? 'chg-in' : (ci.st === 'dis' ? 'chg-out' : ''));
      txt('setChgNow', d.inaBattery ? num(d.batteryCurrent, 3) + ' A · ' + t : 'Không khả dụng (INA219 ắc quy)');
    }
    // Bám nắng: sai lệch so với ngưỡng thật của firmware (HOLD ≤ 3 %, chỉnh lại > 5 %)
    var eh = Math.abs(Number(d.errorH)) * 100, ev = Math.abs(Number(d.errorV)) * 100, m = Math.max(eh, ev), bal, bk;
    if (!isFinite(m)) { bal = '—'; bk = 'ph-sub'; }
    else if (d.isNight) { bal = 'Ban đêm: không bám nắng'; bk = 'ph-sub'; }
    else if (m <= 3) { bal = 'Cân bằng (≤ 3 %)'; bk = 'ph-sub ok'; }
    else if (m <= 5) { bal = 'Trong vùng trễ (3–5 %)'; bk = 'ph-sub ok'; }
    else { bal = d.autoMode ? 'Đang điều chỉnh (> 5 %)' : 'Lệch > 5 % (MANUAL: không tự chỉnh)'; bk = 'ph-sub warn'; }
    txt('trkBal', bal); cls('trkBal', bk);
    txt('trkM1st', motorText(!!d.motor1Running, d.motor1State)); cls('trkM1st', 'motor-state' + (d.motor1Running ? ' run' : ''));
    txt('trkM2st', motorText(!!d.motor2Running, d.motor2State)); cls('trkM2st', 'motor-state' + (d.motor2Running ? ' run' : ''));
    // Thiết bị
    var sc = [d.ldrTL, d.ldrTR, d.ldrBL, d.ldrBR], has = sc.every(function (v) { return v !== undefined && v !== null && isFinite(Number(v)); });
    var sat = d.ldrSat !== undefined ? Number(d.ldrSat) : sc.filter(function (v) { return Number(v) >= 977; }).length;
    var dark = sc.filter(function (v) { return Number(v) < 5; }).length;
    if (!has) { txt('dvLdr', 'KHÔNG CÓ DỮ LIỆU'); cls('dvLdr', 'status-na'); txt('dvLdrD', '--'); }
    else {
      txt('dvLdr', sat ? 'BÃO HÒA ' + sat + '/4' : (dark === 4 ? 'CẢ 4 RẤT TỐI' : 'ĐANG ĐỌC ADC'));
      cls('dvLdr', sat ? 'status-bad' : (dark === 4 ? 'status-warn' : 'status-ok'));
      txt('dvLdrD', 'Giá trị hiệu chuẩn ' + sc.join(' / ') + '. Cảm biến analog không tự báo lỗi; mất kết nối chỉ thấy qua giá trị bất thường.');
    }
    txt('dvDht', d.dhtOK ? 'ĐANG ĐO' : 'KHÔNG ĐỌC ĐƯỢC'); cls('dvDht', d.dhtOK ? 'status-ok' : 'status-bad');
    txt('dvLed', d.powerLed ? 'SÁNG (trạng thái ESP32 đang xuất ra chân, không có phản hồi)' : 'TẮT (trạng thái ESP32 đang xuất ra chân)');
    // Cài đặt
    txt('setFanNow', (d.dhtOK ? num(d.temp, 1) + ' °C' : '—') + ' · quạt ' + (d.fanState ? 'đang chạy' : 'tắt'));
    var ts = Number(d.tftSleep);
    txt('setTft', d.tftSleep === undefined ? '—' : (ts === 0 ? 'Không tự tắt' : 'Tự tắt sau ' + ts + ' phút'));
    txt('setLocNow', (d.lat !== undefined && d.lon !== undefined) ? num(d.lat, 4) + ', ' + num(d.lon, 4) : '—');
    applyLock();
  }

  var prev = window.render;
  if (typeof prev === 'function') {
    window.render = function () {
      var r = prev.apply(this, arguments);
      try { if (arguments[0]) show(arguments[0]); } catch (e) { /* không làm hỏng giao diện chính */ }
      return r;
    };
  }
  setInterval(applyLock, 1000);
  applyLock();

  /* ---------- 4. Cài đặt: chia nhóm dạng tab ---------- */
  var nav = $('setNav'), box = document.querySelector('#page-setting .settings');
  function visible(el) { return !!el && getComputedStyle(el).display !== 'none'; }   // theo quyền / môi trường, kể cả khi trang đang ẩn
  function pickTab(g, save) {
    if (!nav || !box) return;
    var btn = nav.querySelector('[data-g="' + g + '"]');
    if (!btn || !visible(btn)) btn = nav.querySelector('[data-g="trk"]');
    g = btn.getAttribute('data-g');
    nav.querySelectorAll('button').forEach(function (b) { var on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    box.querySelectorAll('.set-group').forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-g') === g); });
    if (save) lsSet('st_setg', g);
  }
  if (nav && box) {
    nav.setAttribute('role', 'tablist');
    nav.querySelectorAll('button').forEach(function (b) { b.setAttribute('role', 'tab'); });
    box.classList.add('set-tabs');
    nav.addEventListener('click', function (e) { var b = e.target.closest('button[data-g]'); if (b) pickTab(b.getAttribute('data-g'), true); });
    pickTab(lsGet('st_setg') || 'trk', false);
    // quyền (role-admin) được gán sau khi đăng nhập: khi quyền đổi, chọn lại nhóm đã lưu nếu nay được phép xem
    new MutationObserver(function () {
      var on = nav.querySelector('button.on'), want = lsGet('st_setg') || 'trk', wb = nav.querySelector('[data-g="' + want + '"]');
      if (!on || !visible(on) || (wb && wb !== on && visible(wb))) pickTab(want, false);
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- 5. Đổi quy ước chiều dòng ắc quy: hỏi xác nhận trước ---------- */
  var chg = $('optChg'), chgPrev = chg ? chg.value : '';
  if (chg) {
    chg.addEventListener('focus', function () { chgPrev = chg.value; });
    document.addEventListener('change', function (e) {
      if (e.target !== chg) return;
      var label = chg.options[chg.selectedIndex] ? chg.options[chg.selectedIndex].text : chg.value;
      if (!window.confirm('Đổi quy ước chiều dòng ắc quy thành "' + label + '"?\nChỉ đổi cách hiển thị đang sạc / đang xả trên trình duyệt này, không đổi số đo.')) {
        e.stopImmediatePropagation(); chg.value = chgPrev; return;
      }
      chgPrev = chg.value;
      rowState(chg.closest('.set-row'), 'ok', 'Đã lưu trên trình duyệt này');
    }, true);
  }
  var th = $('optTheme');
  if (th) th.addEventListener('change', function () { rowState(th.closest('.set-row'), 'ok', 'Đã lưu trên trình duyệt này'); });

  /* ---------- 6. Mật khẩu Wi-Fi: nút hiện/ẩn chỉ cho ô đang nhập (không bao giờ đọc mật khẩu đã lưu) ---------- */
  var eye = $('wPassEye'), wp = $('wPass');
  if (eye && wp) eye.addEventListener('click', function () {
    var show = wp.type === 'password'; wp.type = show ? 'text' : 'password';
    eye.textContent = show ? 'Ẩn' : 'Hiện'; eye.setAttribute('aria-pressed', String(show));
  });

  /* ---------- 7. Lọc nhật ký điều khiển (trên các dòng đã tải từ /api/logs) ---------- */
  var body = $('logBody'), fD = $('lfDate'), fU = $('lfUser'), fC = $('lfCmd'), fR = $('lfRes');
  function rowInfo(tr) {
    var td = tr.children; if (td.length < 4) return null;
    var m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(td[0].textContent);
    return {
      date: m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '',
      user: td[1].textContent.trim(), cmd: td[2].textContent.split(' = ')[0].trim(), res: td[3].textContent.trim()
    };
  }
  function fillSel(sel, vals) {
    var cur = sel.value, h = '<option value="">Tất cả</option>';
    vals.forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v; h += o.outerHTML; });
    if (sel.innerHTML !== h) { sel.innerHTML = h; sel.value = vals.indexOf(cur) >= 0 ? cur : ''; }
  }
  var applying = false;
  function filterLogs() {
    if (!body || applying) return;
    applying = true;
    var rows = [].slice.call(body.querySelectorAll('tr')), users = {}, cmds = {}, shown = 0, total = 0;
    rows.forEach(function (tr) { var i = rowInfo(tr); if (i) { users[i.user] = 1; cmds[i.cmd] = 1; } });
    fillSel(fU, Object.keys(users).sort()); fillSel(fC, Object.keys(cmds).sort());
    rows.forEach(function (tr) {
      var i = rowInfo(tr); if (!i) return; total++;
      var ok = (!fD.value || i.date === fD.value) && (!fU.value || i.user === fU.value) && (!fC.value || i.cmd === fC.value) &&
        (!fR.value || (fR.value === 'ok' ? i.res === 'OK' : i.res !== 'OK'));
      tr.hidden = !ok; if (ok) shown++;
    });
    txt('logHead', total ? ('Hiển thị ' + shown + ' / ' + total + ' lệnh gần nhất của thiết bị đang chọn') : '50 lệnh gần nhất của thiết bị đang chọn');
    applying = false;
  }
  if (body && fD && fU && fC && fR) {
    [fD, fU, fC, fR].forEach(function (el) { el.addEventListener('change', filterLogs); el.addEventListener('input', filterLogs); });
    new MutationObserver(filterLogs).observe(body, { childList: true });
  }
})();
