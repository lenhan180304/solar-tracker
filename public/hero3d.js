/* Khối 3D tấm pin (Three.js) cho bản CLOUD. Dữ liệu lấy từ CHÍNH gói dữ liệu mà giao diện đang nhận (hàm render), không có nguồn riêng.
   Không có dữ liệu thật thì mô hình mờ đi và ghi "Chờ dữ liệu"; không bịa số.
   Hình học theo quy ước của mô phỏng MATLAB (matlab_sim/panel_axes.m): M1 = 90° tấm nằm ngang, M2 xoay quanh trục đứng. Quy ước góc chưa được xác nhận trên hệ thật. */
import * as THREE from '/vendor/three.module.min.js';

const root = document.getElementById('hero3d');
if (root) boot();

function boot() {
  const stage = root.querySelector('.h3-stage'), canvas = document.getElementById('h3Canvas');
  const $ = (id) => document.getElementById(id);
  const set = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
  catch (e) { renderer = null; }
  if (!renderer) { root.classList.add('nogl'); hookData(null); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  const target = new THREE.Vector3(0, 0.95, 0);
  let camAz = 0.78, camEl = 0.42, camDist = 4.6;

  const css = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n) || d).trim() || d;
  const mats = {};
  const panelTex = (cellCol, lineCol) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 320; const x = c.getContext('2d');
    x.fillStyle = cellCol; x.fillRect(0, 0, 512, 320); x.strokeStyle = lineCol; x.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 320); x.stroke(); }
    for (let j = 0; j <= 5; j++) { x.beginPath(); x.moveTo(0, j * 64); x.lineTo(512, j * 64); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  };
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a94a3, metalness: 0.5, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.4, roughness: 0.6 });
  mats.face = new THREE.MeshStandardMaterial({ map: panelTex('#1f3a68', '#7fa0d6'), metalness: 0.2, roughness: 0.35 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xaab3c0, metalness: 0.6, roughness: 0.4 });

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8892a0, 1.05));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 6, 2); scene.add(sun);

  const grid = new THREE.GridHelper(8, 16, 0x94a3b8, 0xcbd5e1); grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.9), dark); base.position.y = 0.05; scene.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 20), metal); post.position.y = 0.55; scene.add(post);
  const pivotY = 1.05;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 24), edge); hub.position.y = 1.0; scene.add(hub);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 12), edge); // trục nghiêng, quay cùng tấm
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 1.05), [edge, edge, mats.face, edge, edge, edge]);
  const grp = new THREE.Group(); grp.add(panel); scene.add(grp);
  // tia hướng pháp tuyến + chấm hổ phách (chi tiết riêng: hướng tấm đang quay về)
  const amber = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), amber); scene.add(dot);
  const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
  const ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.7 })); grp.add(ray);
  grp.add(axle); axle.rotation.z = Math.PI / 2;     // dọc theo X cục bộ (hướng "phải" của tấm)

  const AZ0 = 90, M2SIGN = -1, M1ZERO = 90;
  const toThree = (e, n, u) => new THREE.Vector3(e, u, -n);   // (Đông, Bắc, Lên) -> three (x, y lên, z)
  let cur = { m1: 90, m2: 90 }, tgt = { m1: 90, m2: 90 }, hasAng = false;
  const rad = (d) => d * Math.PI / 180;
  function pose() {
    const psi = rad(AZ0 + M2SIGN * cur.m2), th = rad(M1ZERO - cur.m1);
    const h = [Math.sin(psi), Math.cos(psi), 0], t = [Math.cos(psi), -Math.sin(psi), 0];
    const n = [Math.sin(th) * h[0], Math.sin(th) * h[1], Math.cos(th)];
    const uR = [M2SIGN * t[0], M2SIGN * t[1], 0];
    const X = toThree(uR[0], uR[1], uR[2]).normalize(), Y = toThree(n[0], n[1], n[2]).normalize(), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    const m = new THREE.Matrix4().makeBasis(X, Y, Z);
    grp.quaternion.setFromRotationMatrix(m);
    grp.position.set(0, pivotY, 0).addScaledVector(Y, 0.08);
    dot.position.copy(grp.position).addScaledVector(Y, 1.25);
    ray.scale.set(1, 1.25, 1);
  }

  function themeColors() {
    const bg = css('--surface2', '#f1f5f9'); void bg;
    const dk = (document.documentElement.getAttribute('data-theme') === 'dark') || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:dark)').matches);
    grid.material.color.set(dk ? 0x475569 : 0xcbd5e1); grid.material.opacity = dk ? 0.6 : 0.5;
    base.material.color.set(dk ? 0x334155 : 0x4b5563); metal.color.set(dk ? 0x94a3b8 : 0x8a94a3);
    mats.face.map = panelTex(dk ? '#1d3a6b' : '#1f3a68', dk ? '#6f93cf' : '#7fa0d6'); mats.face.needsUpdate = true;
    hemi(dk);
    dirty = true;
  }
  function hemi(dk) { scene.children.forEach(o => { if (o.isHemisphereLight) o.intensity = dk ? 0.75 : 1.05; if (o.isDirectionalLight) o.intensity = dk ? 1.0 : 1.4; }); }

  let dirty = true, visible = true, drag = null;
  function size() { const w = stage.clientWidth || 600, h = stage.clientHeight || 360; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }
  function place() { camera.position.set(target.x + camDist * Math.cos(camEl) * Math.sin(camAz), target.y + camDist * Math.sin(camEl), target.z + camDist * Math.cos(camEl) * Math.cos(camAz)); camera.lookAt(target); }
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  function frame() {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dm1 = tgt.m1 - cur.m1, dm2 = tgt.m2 - cur.m2;
    if (Math.abs(dm1) > 0.02 || Math.abs(dm2) > 0.02) {
      const k = reduce ? 1 : 0.12; cur.m1 += dm1 * k; cur.m2 += dm2 * k; dirty = true;
    }
    if (!dirty) return;
    dirty = false; pose(); place(); renderer.render(scene, camera);
  }
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; camAz -= (e.clientX - drag.x) * 0.008; camEl = Math.max(0.08, Math.min(1.35, camEl + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; dirty = true; });
  const end = () => { drag = null; }; canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); camDist = Math.max(3, Math.min(9, camDist + e.deltaY * 0.004)); dirty = true; }, { passive: false });
  new ResizeObserver(size).observe(stage);
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) dirty = true; }).observe(root);
  new MutationObserver(themeColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change', themeColors);
  size(); themeColors(); place(); requestAnimationFrame(frame);

  hookData((d) => {
    const a1 = Number(d.motor1Angle), a2 = Number(d.motor2Angle);
    if (Number.isFinite(a1) && Number.isFinite(a2)) { tgt.m1 = Math.max(0, Math.min(180, a1)); tgt.m2 = Math.max(0, Math.min(180, a2)); if (!hasAng) { cur = { ...tgt }; hasAng = true; } dirty = true; }
  });
}

/* Nối vào gói dữ liệu của giao diện: bọc hàm render() có sẵn, không đụng tới logic cũ. */
function hookData(onAngles) {
  const $ = (id) => document.getElementById(id);
  const set = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
  const fx = (v, n) => (Number.isFinite(Number(v)) ? Number(v).toFixed(n) : '—');
  let lastTs = 0;
  function show(d) {
    lastTs = Date.now(); root.classList.remove('stale');
    const pvOk = !!d.inaPV;
    set('h3P', pvOk ? fx(d.solarPower, 1) : '—');
    set('h3Sub', pvOk ? 'Điện áp ' + fx(d.solarVoltage, 2) + ' V · dòng điện ' + fx(d.solarCurrent, 2) + ' A' : 'Cảm biến INA219 PV không khả dụng');
    set('h3M1', fx(d.motor1Angle, 1) + '°' + (d.motor1Running ? ' · đang quay' : ''));
    set('h3M2', fx(d.motor2Angle, 1) + '°' + (d.motor2Running ? ' · đang quay' : ''));
    set('h3Mode', d.autoMode ? 'Tự động (AUTO)' : 'Thủ công (MANUAL)');
    set('h3Trk', d.trackStatus ? String(d.trackStatus) : '—');
    const st = $('h3State'); let k = 'ok', t = d.autoMode ? 'Đang bám nắng' : 'Điều khiển tay';
    if (d.eStop) { k = 'bad'; t = 'Dừng khẩn cấp'; } else if (d.isNight) { k = 'warn'; t = 'Chế độ ban đêm'; }
    if (st) { st.className = 'h3-state ' + k; st.querySelector('b').textContent = t; }
    if (onAngles) onAngles(d);
  }
  const prev = window.render;
  if (typeof prev === 'function') window.render = function (d) { const r = prev.apply(this, arguments); try { if (d) show(d); } catch (e) { /* không ảnh hưởng giao diện chính */ } return r; };
  setInterval(() => {
    if (lastTs && Date.now() - lastTs > 8000) {
      root.classList.add('stale'); const st = $('h3State');
      if (st) { st.className = 'h3-state'; st.querySelector('b').textContent = 'Mất dữ liệu'; }
    }
  }, 2000);
}
