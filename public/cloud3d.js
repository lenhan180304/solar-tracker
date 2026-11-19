/* Cảnh 3D (Three.js) cho bản CLOUD: (1) nền trang đăng nhập (chỉ minh họa, không có số liệu), (2) khối cảnh ở trang Tổng quan nối với dữ liệu THẬT.
   Dữ liệu lấy từ chính hàm render() của giao diện; mất dữ liệu thì mô hình mờ đi, không bịa số.
   Hình học theo quy ước mô phỏng MATLAB (panel_axes.m): M1 = 90° tấm nằm ngang, M2 xoay quanh trục đứng. Quy ước góc chưa xác nhận trên hệ thật.
   Điện thoại / máy yếu: bản nhẹ (không bóng đổ, pixel ratio 1, ~30 khung/giây); trang đăng nhập trên điện thoại không dựng 3D. */
import * as THREE from '/vendor/three.module.min.js';

const LITE = innerWidth < 700 || (navigator.hardwareConcurrency || 8) <= 4 || matchMedia('(pointer:coarse)').matches && innerWidth < 1000;
const REDUCE = matchMedia('(prefers-reduced-motion:reduce)').matches;
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; };
const css = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || d;

function makeTracker(canvas, opts) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, alpha: true, powerPreference: 'low-power' }); } catch (e) { return null; }
  renderer.setPixelRatio(LITE ? 1 : Math.min(devicePixelRatio || 1, 2));
  if (!LITE) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
  const target = new THREE.Vector3(0, opts.ty ?? 0.9, 0);
  let camAz = opts.az ?? 0.8, camEl = opts.el ?? 0.38, camDist = opts.dist ?? 5.2;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x7a8696, 1.0); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(4, 6.5, 3);
  if (!LITE) { key.castShadow = true; key.shadow.mapSize.set(1024, 1024); const c = key.shadow.camera; c.left = -4; c.right = 4; c.top = 4; c.bottom = -4; key.shadow.radius = 4; key.shadow.bias = -0.0005; }
  scene.add(key);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(4.2, 64), new THREE.MeshStandardMaterial({ color: 0x1a2330, roughness: 0.95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = !LITE; scene.add(ground);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.64, 96), new THREE.MeshBasicMaterial({ color: 0x8aa0b8, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring);

  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa5b4, metalness: 0.75, roughness: 0.38 });
  const darkSt = new THREE.MeshStandardMaterial({ color: 0x3b4553, metalness: 0.6, roughness: 0.55 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.14, 48), darkSt); base.position.y = 0.07; base.castShadow = base.receiveShadow = !LITE; scene.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.95, 24), steel); post.position.y = 0.6; post.castShadow = !LITE; scene.add(post);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 32), steel); hub.position.y = 1.1; hub.castShadow = !LITE; scene.add(hub);

  const tex = (() => {
    const c = document.createElement('canvas'); c.width = 768; c.height = 480; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 768, 480); g.addColorStop(0, '#163d7a'); g.addColorStop(1, '#0d2a57'); x.fillStyle = g; x.fillRect(0, 0, 768, 480);
    x.strokeStyle = 'rgba(160,200,255,.55)'; x.lineWidth = 2.5;
    for (let i = 0; i <= 12; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 480); x.stroke(); }
    for (let j = 0; j <= 7; j++) { x.beginPath(); x.moveTo(0, j * 68.5); x.lineTo(768, j * 68.5); x.stroke(); }
    x.strokeStyle = 'rgba(220,235,255,.9)'; x.lineWidth = 4; for (let i = 0; i <= 12; i += 3) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 480); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  })();
  const faceMat = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.15, roughness: 0.28, clearcoat: LITE ? 0 : 0.6, clearcoatRoughness: 0.2 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc3cad4, metalness: 0.8, roughness: 0.35 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 1.25), [frameMat, frameMat, faceMat, frameMat, frameMat, frameMat]);
  panel.castShadow = !LITE;
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 14), steel); axle.rotation.z = Math.PI / 2;
  const grp = new THREE.Group(); grp.add(panel, axle); scene.add(grp);
  // tia pháp tuyến + chấm hổ phách: hướng tấm đang quay về (điểm nhấn xanh dương)
  const amber = 0x4c9dff;   // điểm nhấn xanh dương
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), new THREE.MeshBasicMaterial({ color: amber })); scene.add(dot);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: amber, transparent: true, opacity: 0.75 })); grp.add(ray);

  const AZ0 = 90, M2S = -1, M1Z = 90, PIV = 1.18;
  const to3 = (e, n, u) => new THREE.Vector3(e, u, -n);
  const rad = (d) => d * Math.PI / 180;
  let cur = { m1: 90, m2: 90 }, tgt = { m1: 90, m2: 90 }, hasAng = false, dirty = true, visible = true, drag = null, t0 = performance.now();
  function pose() {
    const psi = rad(AZ0 + M2S * cur.m2), th = rad(M1Z - cur.m1);
    const h = [Math.sin(psi), Math.cos(psi)], t = [Math.cos(psi), -Math.sin(psi)];
    const n = [Math.sin(th) * h[0], Math.sin(th) * h[1], Math.cos(th)];
    const X = to3(M2S * t[0], M2S * t[1], 0).normalize(), Y = to3(n[0], n[1], n[2]).normalize(), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    grp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    grp.position.set(0, PIV, 0).addScaledVector(Y, 0.1);
    dot.position.copy(grp.position).addScaledVector(Y, 1.4); ray.scale.set(1, 1.4, 1);
  }
  function theme() {
    const dk = isDark();
    ground.material.color.set(dk ? 0x18212d : 0xdfe5ec); ring.material.color.set(dk ? 0x6f86a0 : 0x8aa0b8);
    darkSt.color.set(dk ? 0x2b3441 : 0x56606e);
    hemi.intensity = dk ? 0.7 : 1.05; key.intensity = dk ? 1.7 : 2.0; dirty = true;
  }
  function place() { camera.position.set(target.x + camDist * Math.cos(camEl) * Math.sin(camAz), target.y + camDist * Math.sin(camEl), target.z + camDist * Math.cos(camEl) * Math.cos(camAz)); camera.lookAt(target); }
  function size() { const p = canvas.parentElement; const w = p.clientWidth || 600, h = p.clientHeight || 360; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }
  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    if (LITE && now - last < 33) return; last = now;
    if (opts.idle && !REDUCE && !drag) {              // trang đăng nhập: tấm pin lắc nhẹ + camera quay chậm (minh họa)
      const s = (now - t0) / 1000; cur.m1 = 90 + 22 * Math.sin(s * 0.35); cur.m2 = 90 + 40 * Math.sin(s * 0.22); camAz += 0.0016; dirty = true;
    } else {
      const d1 = tgt.m1 - cur.m1, d2 = tgt.m2 - cur.m2;
      if (Math.abs(d1) > 0.02 || Math.abs(d2) > 0.02) { const k = REDUCE ? 1 : 0.12; cur.m1 += d1 * k; cur.m2 += d2 * k; dirty = true; }
    }
    if (!dirty) return; dirty = false; pose(); place(); renderer.render(scene, camera);
  }
  if (opts.interactive) {
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; camAz -= (e.clientX - drag.x) * 0.008; camEl = Math.max(0.08, Math.min(1.3, camEl + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; dirty = true; });
    const end = () => { drag = null; }; canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); camDist = Math.max(3, Math.min(9, camDist + e.deltaY * 0.004)); dirty = true; }, { passive: false });
  }
  new ResizeObserver(size).observe(canvas.parentElement);
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) dirty = true; }).observe(canvas);
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change', theme);
  size(); theme(); place(); requestAnimationFrame(frame);
  return {
    setAngles(a1, a2) { tgt.m1 = Math.max(0, Math.min(180, a1)); tgt.m2 = Math.max(0, Math.min(180, a2)); if (!hasAng) { cur = { ...tgt }; hasAng = true; } dirty = true; },
  };
}

/* ---- 1) Trang đăng nhập ---- */
const lg = document.getElementById('lgCanvas');
if (lg && innerWidth >= 900) { const lgRoot = document.getElementById('login'); let inst = null; const tryInit = () => { if (!inst && lgRoot.classList.contains('show')) inst = makeTracker(lg, { idle: true, az: 0.55, el: 0.22, dist: 8.6, ty: 2.4 }); }; tryInit(); new MutationObserver(tryInit).observe(lgRoot, { attributes: true, attributeFilter: ['class'] }); }

/* ---- 2) Khối cảnh trang Tổng quan (dữ liệu thật) ---- */
const root = document.getElementById('scene3d');
if (root) {
  const cv = document.getElementById('s3Canvas');
  const inst = makeTracker(cv, { interactive: true });
  if (!inst) root.classList.add('nogl');
  const $ = (id) => document.getElementById(id);
  const set = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
  const fx = (v, n) => (Number.isFinite(Number(v)) ? Number(v).toFixed(n) : '—');
  let lastTs = 0;
  function show(d) {
    lastTs = Date.now(); root.classList.remove('stale');
    const pvOk = !!d.inaPV;
    set('s3P', pvOk ? fx(d.solarPower, 1) : '—');
    set('s3Sub', pvOk ? 'Điện áp ' + fx(d.solarVoltage, 2) + ' V · dòng điện ' + fx(d.solarCurrent, 2) + ' A' : 'Cảm biến INA219 PV không khả dụng');
    set('s3M1', fx(d.motor1Angle, 1) + '°' + (d.motor1Running ? ' · đang quay' : ''));
    set('s3M2', fx(d.motor2Angle, 1) + '°' + (d.motor2Running ? ' · đang quay' : ''));
    set('s3Bat', d.inaBattery ? fx(d.batteryVoltage, 2) + ' V' : '—');
    set('s3Mode', d.autoMode ? 'Tự động (AUTO)' : 'Thủ công (MANUAL)');
    const st = $('s3State'); let k = 'ok', t = d.autoMode ? 'Đang bám nắng' : 'Điều khiển tay';
    if (d.eStop) { k = 'bad'; t = 'Dừng khẩn cấp'; } else if (d.isNight) { k = 'warn'; t = 'Chế độ ban đêm'; }
    if (st) { st.className = 's3-state ' + k; st.querySelector('b').textContent = t; }
    const a1 = Number(d.motor1Angle), a2 = Number(d.motor2Angle);
    if (inst && Number.isFinite(a1) && Number.isFinite(a2)) inst.setAngles(a1, a2);
  }
  const prev = window.render;
  if (typeof prev === 'function') window.render = function (d) { const r = prev.apply(this, arguments); try { if (d) show(d); } catch (e) { /* không ảnh hưởng giao diện chính */ } return r; };
  setInterval(() => { if (lastTs && Date.now() - lastTs > 8000) { root.classList.add('stale'); const st = $('s3State'); if (st) { st.className = 's3-state'; st.querySelector('b').textContent = 'Mất dữ liệu'; } } }, 2000);
}
