'use strict';
// Server Cloud thật + broker cục bộ + "ESP32" giả lập (DỮ LIỆU CHỈ ĐỂ KIỂM THỬ giao diện), chạy tới khi bị dừng.
const net = require('net');
const { spawn } = require('child_process');
const makeAedes = require('aedes');
const mqtt = require('mqtt');
const path = require('path'); const CLOUD = process.argv[2] || path.join(__dirname, '..');
(async () => {
  const aedes = makeAedes();
  const broker = net.createServer(aedes.handle);
  await new Promise(r => broker.listen(18831, '127.0.0.1', r));
  const env = { ...process.env, MQTT_URL: 'mqtt://127.0.0.1:18831', JWT_SECRET: 'test-secret-test-secret-test-secret', COOKIE_SECURE: 'false', PORT: '18091',
    SAMPLE_EVERY_MS: '250', ADMIN_USER: 'admin', ADMIN_PASS: 'admin-pass-12345', DEVICES: 'tracker01:Solar Tracker 01' };
  const srv = spawn(process.execPath, ['server.js'], { cwd: CLOUD, env, stdio: 'inherit' });
  const dev = mqtt.connect('mqtt://127.0.0.1:18831', { clientId: 'esp-sim2' });
  await new Promise(r => dev.on('connect', r));
  dev.publish('st/tracker01/status', JSON.stringify({ online: true }));
  const st = { solarVoltage: 17.5, solarCurrent: 0.9, solarPower: 15.75, batteryVoltage: 12.7, batteryCurrent: 0.45, batteryPower: 5.7, motor1Angle: 90, motor2Angle: 60,
    motor1Running: false, motor2Running: false, motor1State: 'STOP', motor2State: 'STOP', autoMode: true, eStop: false, isNight: false, simMode: false,
    ldrTL: 520, ldrTR: 540, ldrBL: 500, ldrBR: 510, diffH: 30, diffV: 20, trackStatus: 'LDR LOCKED', inaPV: true, inaBattery: true, dhtOK: true, temp: 31 };
  let k = 0;
  setInterval(() => {
    k++;
    st.solarVoltage = 17 + Math.sin(k / 15); st.solarCurrent = 0.9 + 0.2 * Math.sin(k / 9); st.solarPower = st.solarVoltage * st.solarCurrent;
    st.ldrTL = 520 + Math.round(30 * Math.sin(k / 7)); st.diffH = Math.round(40 * Math.sin(k / 11));
    if (k % 60 === 20) { st.motor1Running = true; st.motor1State = 'PHẢI'; } if (k % 60 === 26) { st.motor1Running = false; st.motor1State = 'STOP'; }
    if (k % 200 === 100) st.autoMode = !st.autoMode;
    dev.publish('st/tracker01/state', JSON.stringify(st));
  }, 200);
  console.log('DEMO READY');
  process.on('SIGTERM', () => { srv.kill(); process.exit(0); });
})();
