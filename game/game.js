// 噹噹噹! 病人怎麼了? · 新進護理師心電圖訓練
// Made from the 《我熱愛值班》 template (see README.md, 授權).
//
// A medical ward in 3D, played by a new night-shift charge nurse with twelve beds around the
// nurse station. Nine call bells ring one after another (levels.js): go back to the station,
// answer the bell, walk to the bed, read the strip on the monitor, assess the patient and call the
// doctor. Each level is a short branching story with three hearts; finish it with a heart left
// and the nurse earns a coin. Between calls there is the rest room: a sofa and a toilet.
// Everything clinical a player sees is data in levels.js; this file only plays it.
//
// three.js is vendored under game/vendor/ so the page needs nothing from another site.
import * as THREE from './vendor/three/three.module.js';
import { RoundedBoxGeometry } from './vendor/three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from './vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from './vendor/three/addons/utils/BufferGeometryUtils.js';
import { LEVELS, QUIET_BEDS, CPR, FLOW, SBAR_KEYS } from './levels.js';
import { CHATTER } from './chatter.js';
import { createEcg } from './ecg.js';

// game.css hangs off this class; set it here too so a host page that owns <body> still gets it
document.body.classList.add('game-page');

const $ = id => document.getElementById(id);
const FONT_UI = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
const FONT_NUM = '"JetBrains Mono", Consolas, monospace';
// The floor (x east, z south, north is -z): the nurse station in the middle of an open hall; the
// rest room to the east; patient rooms in a ㄇ round the hall -- room 01 down the west side, rooms
// 02 to 05 along the north. Every bed has its head to the room's west wall (see bed()).
const XW = -12.4, XE = 14.9, ZN = -11.4, ZS = 4.6;
const HALL = { x0: -8.4, x1: 8.4, z0: -5.8, z1: 4.0 };
const YAW = THREE.MathUtils.degToRad(35), PITCH = THREE.MathUtils.degToRad(40);

// What the game is called, and the line that says what it was made from. A game made from this
// template keeps CREDIT on its start card and its summary (see README.md, 授權).
const GAME = { title: '噹噹噹! 病人怎麼了?', edition: '新進護理師心電圖訓練', site: location.host };
const CREDIT = { text: '以《我熱愛值班》範本製作', url: 'https://drcharming.net/' };

try {
  await boot();
} catch (err) {
  console.error(err);
  $('loading').textContent = '這台裝置無法顯示 3D 畫面（需要 WebGL）';
  $('loading').classList.add('err');
}

async function boot() {
  await Promise.race([
    Promise.all([
      document.fonts.load(`900 64px ${FONT_UI}`, '護理站休息室緊急出口病房安全梯往廁所'),
      document.fonts.load(`700 48px ${FONT_NUM}`, '0123456789SpOHRNIBP'),
    ]),
    new Promise(r => setTimeout(r, 3000)),
  ]);

  const frame = $('frame'), canvas = $('view');
  const rng = seed => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
  // Tonight's ward name is drawn at random each shift (index.html?ward=6B picks one); every
  // ward has the same floor, only the room numbers change.
  const WARDS = ['5A', '5B', '6A', '6B', '7A', '7B'];
  const wardParam = new URLSearchParams(location.search).get('ward');
  const WARD = WARDS.includes(wardParam) ? wardParam : WARDS[Math.floor(Math.random() * WARDS.length)];
  const wb = n => `${WARD}${n}`; // a room or bed on tonight's ward: wb('02A')
  // energy under this and the nurse cannot run; at 0 they drop and the night is over
  const TIRED = 20;
  // index.html?debug: a handle for scripted playtests (window.__ward) and ] to skip half an hour
  const DEBUG = new URLSearchParams(location.search).has('debug');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a1019');
  const world = new THREE.Group();
  scene.add(world);

  // ---------- helpers ----------
  const cache = new Map();
  const M = (color, rough = 0.8, metal = 0, flat = false) => {
    const k = `${color}|${rough}|${metal}|${flat}`;
    if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: flat }));
    return cache.get(k);
  };
  const F = (color, rough = 0.75) => M(color, rough, 0, true);
  const glow = (color, intensity) => new THREE.MeshStandardMaterial({ color: '#160606', emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  const basic = opts => new THREE.MeshBasicMaterial(opts);
  const solids = [];
  const solid = (x0, z0, x1, z1) => solids.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);

  function box(p, w, h, d, mat, x, y, z, r = 0.03) {
    const rr = Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002);
    const geo = rr > 0.004 ? new RoundedBoxGeometry(w, h, d, 1, rr) : new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); p.add(m); return m;
  }
  function cyl(p, rt, rb, h, mat, x, y, z, seg = 16) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); p.add(m); return m;
  }
  function sph(p, r, mat, x, y, z, ws = 20, hs = 14) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat); m.position.set(x, y, z); p.add(m); return m;
  }
  function plane(p, w, h, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); p.add(m); return m;
  }
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  // ---------- textures ----------
  const floorTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#dfe4e6'; g.fillRect(0, 0, w, h);
    const r = rng(4);
    for (let i = 0; i < 1300; i++) { g.globalAlpha = 0.12 + r() * 0.2; g.fillStyle = ['#cdd3d6', '#f1f4f5', '#bcc4c8'][i % 3]; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
    g.globalAlpha = 1; g.fillStyle = 'rgba(80,95,105,.16)';
    g.fillRect(0, 0, w, 2); g.fillRect(0, h / 2 - 1, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w / 2 - 1, 0, 2, h);
  }, true);
  // the corridor is one polished sheet, no tile seams
  const hallTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e4e8e3'; g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 900; i++) { g.globalAlpha = 0.08 + r() * 0.14; g.fillStyle = ['#d2d8d2', '#f4f6f3'][i % 2]; g.fillRect(r() * w, r() * h, 2.2, 1); }
  }, true);
  // on-call room floor: beige speckled tiles
  const tileTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e6dcc8'; g.fillRect(0, 0, w, h);
    const r = rng(6);
    for (let i = 0; i < 1600; i++) { g.globalAlpha = 0.15 + r() * 0.25; g.fillStyle = ['#cdbfa6', '#f3ecdd', '#b9a98c'][i % 3]; g.fillRect(r() * w, r() * h, 1.6, 1.6); }
    g.globalAlpha = 1; g.fillStyle = 'rgba(110,95,75,.28)';
    for (let i = 0; i <= w; i += w / 4) { g.fillRect(i - 1, 0, 2, h); g.fillRect(0, i - 1, w, 2); }
  }, true);
  const stripeTex = (base, line, step) => canvasTex(64, 64, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); g.fillStyle = line; for (let x = 0; x < w; x += step) g.fillRect(x, 0, step / 3, h); }, true);
  // stripes that run along a bed: they change across v, the bed's width
  const rowTex = (base, line, n) => canvasTex(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); g.fillStyle = line; for (let i = 0; i < n; i++) g.fillRect(0, (i + 0.3) * h / n, w, h / n * 0.42); });
  const gownTex = stripeTex('#d9ebe7', '#9cc4be', 8);
  const blanketTex = rowTex('#f2f5f7', '#7fa7c9', 9);
  const pillowTex = rowTex('#eef2f5', '#9db7cc', 6);
  const spreadTex = rowTex('#f4f6f3', '#2f9a6c', 4);
  const paperTex = stripeTex('#e3e8ec', '#d3dbe1', 12); paperTex.repeat.set(8, 2);
  const letterTex = {};
  ['A', 'B', 'C', 'D'].forEach(L => {
    letterTex[L] = canvasTex(128, 128, g => {
      g.font = `900 112px ${FONT_UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 6; g.strokeStyle = '#6d6a62'; g.strokeText(L, 64, 70); g.fillStyle = '#f4f2ec'; g.fillText(L, 64, 70);
    });
  });
  const plaqueTex = text => canvasTex(256, 72, g => {
    g.fillStyle = '#4f7fae'; g.beginPath(); g.roundRect(0, 0, 256, 72, 10); g.fill();
    g.fillStyle = '#ffffff'; g.font = `700 46px ${FONT_NUM}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 39);
  });
  const nameTex = canvasTex(128, 160, g => {
    g.fillStyle = '#e3e6e8'; g.fillRect(0, 0, 128, 160);
    g.fillStyle = '#1f3d32'; for (let i = 0; i < 5; i++) g.fillRect(10, 12 + i * 29, 108, i ? 15 : 22);
  });
  function monitorTex(v) {
    return canvasTex(440, 300, (g) => {
      g.fillStyle = '#03060a'; g.fillRect(0, 0, 440, 300);
      const trace = (y0, color, f) => { g.strokeStyle = color; g.lineWidth = 3.4; g.beginPath(); for (let x = 10; x <= 272; x++) { const y = y0 + f(x); x === 10 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
      const beat = v.hr > 100 ? 50 : 74;
      trace(80, '#53ff8e', x => { const p = x % beat; if (p > 18 && p < 22) return -44 * Math.sin((p - 18) / 4 * Math.PI); if (p >= 22 && p < 25) return 9; if (p > 31 && p < 43) return -9 * Math.sin((p - 31) / 12 * Math.PI); return 0; });
      trace(162, '#4fe3ff', x => { const p = (x % beat) / beat; return -24 * Math.pow(Math.max(0, Math.sin(p * Math.PI)), 2) + 6; });
      trace(236, '#ffd166', x => -12 * Math.sin(x / (v.rr > 24 ? 20 : 34)));
      const num = (label, val, color, y, alarm) => {
        if (alarm) { g.fillStyle = '#d0202c'; g.fillRect(284, y - 60, 150, 78); }
        g.fillStyle = alarm ? '#ffffff' : color;
        g.font = `600 16px ${FONT_NUM}`; g.fillText(label, 294, y - 38);
        g.font = `700 56px ${FONT_NUM}`; g.fillText(String(val), 300, y + 8);
      };
      num('HR', v.hr, '#53ff8e', 80, false);
      num('SpO2', v.spo2, '#4fe3ff', 164, v.alarm);
      num('RR', v.rr, '#ffd166', 240, false);
      g.font = `600 16px ${FONT_NUM}`; g.fillStyle = '#ff9aa2'; g.fillText(`NIBP ${v.bp}`, 12, 288); g.fillStyle = '#ffb2e6'; g.fillText(`T ${v.bt}`, 190, 288);
    });
  }
  function signTex(main, sub, bg, fg, w = 512, h = 150, size) {
    return canvasTex(w, h, g => {
      g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, 14); g.fill();
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${size || (sub ? 64 : 76)}px ${FONT_UI}`; g.fillText(main, w / 2, sub ? h * 0.42 : h / 2 + 4);
      if (sub) { g.globalAlpha = 0.8; g.font = `700 24px ${FONT_NUM}`; g.fillText(sub, w / 2, h * 0.8); }
    });
  }
  const emrTex = canvasTex(320, 200, (g, w) => {
    g.fillStyle = '#e8f0f7'; g.fillRect(0, 0, w, 200); g.fillStyle = '#1f6fa8'; g.fillRect(0, 0, w, 28);
    g.fillStyle = '#fff'; g.font = `700 15px ${FONT_UI}`; g.fillText(`${WARD} 病房 · 病人清單`, 10, 19);
    for (let i = 0; i < 7; i++) { const y = 36 + i * 23; g.fillStyle = i === 1 ? '#ffd5d5' : (i % 2 ? '#fff' : '#f2f6fa'); g.fillRect(6, y, w - 12, 19); g.fillStyle = '#7d8a99'; g.fillRect(12, y + 6, 36, 7); g.fillRect(58, y + 6, 130 - (i * 17) % 60, 7); g.fillStyle = i === 1 ? '#e5383b' : (i === 3 ? '#f0a020' : '#2fa36b'); g.fillRect(w - 44, y + 5, 28, 9); }
  });

  // ---------- repeated furniture: one InstancedMesh per shape and material ----------
  // 66 beds drawn one mesh at a time would be thousands of draw calls
  const kit = new Map();
  const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
  function kitAdd(key, make, mat, x, y, z, rot, color) {
    let k = kit.get(key);
    if (!k) kit.set(key, k = { geo: make(), mat, items: [] });
    _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
    k.items.push({ m: new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s), color });
  }
  // every instance of a kit shape is drawn, seen or not, so only soft things (mattress, blanket,
  // pillow, cushions) get rounded corners; the rest are plain 12-triangle boxes
  const rgeo = (w, h, d, r) => { const rr = Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002); return r >= 0.05 && rr > 0.004 ? new RoundedBoxGeometry(w, h, d, 1, rr) : new THREE.BoxGeometry(w, h, d); };
  const kb = (mat, w, h, d, x, y, z, r = 0.03, rot, color) => kitAdd(`b${w},${h},${d},${r},${mat.uuid}`, () => rgeo(w, h, d, r), mat, x, y, z, rot, color);
  const kc = (mat, rt, rb, h, x, y, z, seg = 12, rot) => kitAdd(`c${rt},${rb},${h},${seg},${mat.uuid}`, () => new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rot);
  const kp = (mat, w, h, x, y, z, rot) => kitAdd(`p${w},${h},${mat.uuid}`, () => new THREE.PlaneGeometry(w, h), mat, x, y, z, rot);
  function flushKit() {
    for (const k of kit.values()) {
      const im = new THREE.InstancedMesh(k.geo, k.mat, k.items.length);
      const tinted = k.items.some(it => it.color);
      k.items.forEach((it, i) => { im.setMatrixAt(i, it.m); if (tinted) im.setColorAt(i, _c.set(it.color || '#ffffff')); });
      world.add(im);
    }
    kit.clear();
  }

  // ---------- the floor ----------
  // The nurse station stands in the middle of an open hall. West of the hall is room 01 (four
  // beds); north of it rooms 02 to 05 (a single, a double, a four-bed and a single); east of it the
  // rest room. Twelve beds in all. North is -z, the camera looks from the south-east. Walls that
  // stand between the camera and the floor are cut low, dollhouse style; only the far walls are
  // full height.
  const BED_STEP = 2.0;   // beds side by side along z
  const mkRoom = (n, x0, z0, z1, beds, side) => ({ n: wb(n), no: n, x0, z0, z1, beds, side, front: false });
  const ROOMS = [
    mkRoom('01', -11.9, -5.0, 4.0, 4, 'west'),
    mkRoom('02', -7.0, -10.8, HALL.z0, 2, 'north'),
    mkRoom('03', -3.5, -10.8, HALL.z0, 2, 'north'),
    mkRoom('04', 0.0, -10.8, HALL.z0, 2, 'north'),
    mkRoom('05', 3.5, -10.8, HALL.z0, 2, 'north'),
  ];
  // the beds that can ring have a call lamp and a wall monitor; the others are asleep
  const CASE_BEDS = Object.fromEntries(LEVELS.map(l => [wb(l.bed), l]));
  const HAIRS = ['#d6d6d6', '#b8b8b8', '#3a302b', '#e2e2e2', '#2b2421', '#9a9a9a', '#cfcfcf', '#4a3d36', '#bdbdbd'];
  const BEDS = [], BED = {};
  const rb = rng(31);
  ROOMS.forEach(room => {
    for (let k = 0; k < room.beds; k++) {
      const letter = 'ABCD'[k], id = `${room.n}${letter}`, lv = CASE_BEDS[id];
      const b = { id, room, letter, x0: room.x0, x: room.x0 + 1.25, z: room.z0 + 1.3 + k * BED_STEP, isCase: !!lv, lv,
        occupied: true, iv: lv ? k % 2 === 0 : rb() < 0.4, hair: HAIRS[Math.floor(rb() * HAIRS.length)] };
      BEDS.push(b); BED[id] = b;
    }
  });
  // where people stand around a bed: the head is against the room's west wall, the foot opens to the aisle
  const SPOT = {
    approach: b => [b.x - 0.2, b.z + 0.85],   // the nurse's side, facing the camera
    nurse: b => [b.x + 1.3, b.z + 0.15],
    leave: b => [b.x0 + 2.95, b.z + 0.7],
    touch: b => [b.x + 0.5, b.z],
  };

  // ---------- floors ----------
  box(world, XE - XW + 0.6, 0.7, ZS - ZN + 0.6, M('#131a26', 0.85), (XE + XW) / 2, -0.352, (ZN + ZS) / 2, 0.12);
  function floor(x0, x1, z0, z1, tex, opts = {}) {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set((x1 - x0) / (opts.tile || 1.2), (z1 - z0) / (opts.tile || 1.2));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map: t, color: opts.tint || '#ffffff', roughness: opts.rough ?? 0.32 }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, opts.y || 0.003, (z0 + z1) / 2); world.add(m);
  }
  floor(HALL.x0, HALL.x1, HALL.z0, HALL.z1, hallTex, { tile: 3, rough: 0.16 });
  ROOMS.forEach(r => floor(r.x0, r.x0 + 3.5, r.z0, r.z1, floorTex));
  floor(8.4, 14.4, -3.5, 3.5, tileTex, { tile: 2.4, y: 0.007, tint: '#f3ece4' });
  floor(-3.2, 3.2, -1.6, 1.6, floorTex, { tint: '#eef1f2', y: 0.005 });
  // ---------- walls ----------
  // each face of a wall gets its own finish, lower panel then upper wall: blue-grey and off-white
  // in the rooms, grey and pale green in the corridor
  const FIN = {
    room: [M('#9fb7c6', 0.7), M('#f1efe8', 0.9)],
    hall: [M('#c9d3d6', 0.6), M('#e3eae2', 0.9)],
    core: [M('#cfd8db', 0.7), M('#eef1ef', 0.9)],
    oncall: [M('#b9c6cf', 0.8), new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.9 })],
    shut: [M('#97a1a8', 0.8), M('#b3bcc2', 0.9)],
  };
  const capM = M('#3d4550', 0.7), trimM = M('#8aa3b3', 0.6), frameM = M('#8f979e', 0.5), leafM = M('#c3ccd2', 0.6);
  // a: finish on the +z (or +x) face, b: on the -z (or -x) face. Each face is its own half-thick
  // slab, so every piece has one material and the static floor can be merged per material.
  function wall(x0, z0, x1, z1, h, a, b) {
    const horiz = Math.abs(z1 - z0) < 1e-6, t = 0.16;
    const w = horiz ? Math.abs(x1 - x0) : t, d = horiz ? t : Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, low = Math.min(0.88, h);
    const slab = (y0, y1, mat, side) => box(world, horiz ? w : t / 2, y1 - y0, horiz ? t / 2 : d, mat,
      cx + (horiz ? 0 : side * t / 4), (y0 + y1) / 2, cz + (horiz ? side * t / 4 : 0), 0);
    slab(0, low, a[0], 1); slab(0, low, b[0], -1);
    if (h > low + 0.01) { slab(low, h, a[1], 1); slab(low, h, b[1], -1); box(world, w + (horiz ? 0 : 0.02), 0.04, d + (horiz ? 0.02 : 0), trimM, cx, low, cz, 0); }
    box(world, w, 0.02, d, capM, cx, h + 0.01, cz, 0);
    solid(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
  }
  // a wall along x with door openings; open leaves swing into the side named by `into`
  function run(x0, x1, z, h, doors, a, b, into, rail) {
    // openings are cut walking along the wall, so they must come in order of x; the room
    // lists run east to west, and unsorted they let one segment bury every door after it
    doors = [...doors].sort((p, q) => p.x - q.x);
    let cur = x0;
    const seg = (p, q) => {
      if (q - p < 0.05) return;
      wall(p, z, q, z, h, a, b);
      if (rail) for (const s of rail) kb(M('#bdb5a6', 0.45), q - p - 0.14, 0.07, 0.08, (p + q) / 2, 0.84, z + s * 0.15, 0.03);
    };
    for (const d of doors) { seg(cur, d.x - d.w / 2); cur = d.x + d.w / 2; }
    seg(cur, x1);
    for (const d of doors) {
      for (const s of [-1, 1]) kb(frameM, 0.08, h, 0.22, d.x + s * d.w / 2, h / 2, z, 0.01);
      if (into) kb(leafM, 0.05, h - 0.02, d.w - 0.08, d.x + d.w / 2 - 0.06, h / 2, z + into * (d.w / 2 + 0.06), 0.01);
    }
  }
  function runZ(z0, z1, x, h, doors, a, b) {
    doors = [...doors].sort((p, q) => p.z - q.z);
    let cur = z0;
    const seg = (p, q) => { if (q - p > 0.05) wall(x, p, x, q, h, a, b); };
    for (const d of doors) { seg(cur, d.z - d.w / 2); cur = d.z + d.w / 2; }
    seg(cur, z1);
    for (const d of doors) for (const s of [-1, 1]) kb(frameM, 0.22, h, 0.08, x, h / 2, d.z + s * d.w / 2, 0.01);
  }
  const roomDoor = r => ({ x: r.x0 + 2.85, w: 1.0 });
  // doors: each room has one, 1 m wide, into the aisle by the foot of the beds
  const northDoor = r => ({ x: r.x0 + 2.85, w: 1.0 });
  const NORTH = ROOMS.filter(r => r.side === 'north'), WEST = ROOMS.find(r => r.side === 'west');
  // the hall's north wall (rooms 02-05 open onto it), cut low; the two ends are full height
  run(-7, 7, HALL.z0, 1.0, NORTH.map(northDoor), FIN.hall, FIN.room, -1, [1]);
  wall(HALL.x0, HALL.z0, -7, HALL.z0, 2.6, FIN.hall, FIN.shut);
  wall(7, HALL.z0, HALL.x1, HALL.z0, 2.6, FIN.hall, FIN.shut);
  // each room's far wall and its partitions
  NORTH.forEach(r => wall(r.x0, r.z0, r.x0 + 3.5, r.z0, 2.6, FIN.room, FIN.shut));
  wall(-7, -10.8, -7, HALL.z0, 2.6, FIN.room, FIN.shut);
  wall(-3.5, -10.8, -3.5, HALL.z0, 1.2, FIN.room, FIN.room);
  wall(0, -10.8, 0, HALL.z0, 1.2, FIN.room, FIN.room);
  wall(3.5, -10.8, 3.5, HALL.z0, 1.2, FIN.room, FIN.room);
  wall(7, -10.8, 7, HALL.z0, 1.0, FIN.shut, FIN.room);
  // room 01, west of the hall: its door is in the east wall
  runZ(WEST.z0, WEST.z1, HALL.x0, 1.0, [{ z: WEST.z0 + 5.3, w: 1.0 }], FIN.hall, FIN.room);
  wall(WEST.x0, WEST.z0, HALL.x0, WEST.z0, 2.6, FIN.room, FIN.shut);
  wall(WEST.x0 - 0.08, WEST.z0, WEST.x0 - 0.08, WEST.z1, 2.6, FIN.room, FIN.shut);
  wall(WEST.x0, WEST.z1, HALL.x0, WEST.z1, 0.6, FIN.shut, FIN.room);
  // the wall between the corner of the hall and room 01
  wall(HALL.x0, HALL.z0, HALL.x0, WEST.z0, 2.6, FIN.hall, FIN.shut);
  // the hall's south edge is open to the entrance; a low rail keeps the nurse on the floor
  wall(HALL.x0, HALL.z1, HALL.x1, HALL.z1, 0.5, FIN.shut, FIN.hall);
  // the east wall, with the door to the rest room
  runZ(HALL.z0, HALL.z1, HALL.x1, 1.0, [{ z: 0, w: 1.4 }], FIN.core, FIN.hall);
  // the rest room: far wall tall, near walls low
  wall(8.4, -3.5, 14.4, -3.5, 2.6, FIN.core, FIN.shut);
  wall(8.4, 3.5, 14.4, 3.5, 0.6, FIN.shut, FIN.core);
  wall(14.4 + 0.08, -3.5, 14.4 + 0.08, 3.5, 0.6, FIN.shut, FIN.core);
  // the toilet in the north-east corner of the rest room, behind its own door
  const bathFin = [M('#d6dde0', 0.5), M('#eef2f3', 0.6)];
  floor(12.2, 14.4, -3.5, -1.2, tileTex, { tint: '#dfe7ea', tile: 0.9, y: 0.009 });
  runZ(-3.5, -1.2, 12.2, 1.0, [], FIN.core, bathFin);
  run(12.2, 14.4, -1.2, 1.0, [{ x: 13.0, w: 0.8 }], FIN.core, bathFin, 1, null);
  const porcelain = M('#f4f5f3', 0.3);
  cyl(world, 0.17, 0.14, 0.4, porcelain, 13.8, 0.2, -3.0, 18);
  box(world, 0.46, 0.06, 0.38, porcelain, 13.8, 0.42, -3.0, 0.03);
  box(world, 0.18, 0.42, 0.44, porcelain, 13.8, 0.62, -3.3, 0.03);
  solid(13.5, -3.35, 14.15, -2.7);
  cyl(world, 0.07, 0.09, 0.72, porcelain, 12.8, 0.36, -3.2, 12);
  box(world, 0.52, 0.14, 0.4, porcelain, 12.8, 0.79, -3.2, 0.04);
  solid(12.5, -3.45, 13.1, -3.0);
  // hanging signs: navy, white text, facing down the floor toward the camera
  // the wires are unlit: a ceiling light of the roaming pool can sit right beside one, and a lit
  // wire that close burns to a white spark that blooms and blinks as the pool moves
  const wireM = basic({ color: '#6f7780' });
  function hang(x, z, text, w = 1.9) {
    [x - w * 0.38, x + w * 0.38].forEach(xx => cyl(world, 0.008, 0.008, 0.5, wireM, xx, 2.95, z, 6));
    plane(world, w, 0.42, basic({ map: signTex(text, null, '#1f4e79', '#ffffff', 600, 130, 54), toneMapped: false, color: '#d6e6f5' }), x, 2.55, z);
  }
  // ---------- beds ----------
  const lamps = {}, monitors = {}, patients = {};
  const lampOff = M('#7d858f', 0.4);
  const lampMat = { red: glow('#ff2a2a', 7), amber: glow('#ffa62b', 5), off: lampOff };
  const okTex = monitorTex({ hr: 76, spo2: 97, rr: 16, bp: '126/78', bt: '36.8' });
  // the wall monitors: the strip of a bed that rings shows an alarm, then settles
  const TEX = {};
  for (const b of BEDS) if (b.lv) {
    const L = b.lv, vit = Object.values(L.nodes).find(n => n.vitals)?.vitals;
    TEX[b.id] = [monitorTex({ hr: L.hr0 || 80, spo2: 94, rr: 22, bp: vit ? vit.bp : '126/78', bt: '36.8', alarm: true }), okTex];
  }
  // the electric bed: white frame, rounded foot board, blue-striped spread
  const B_M = {
    frame: M('#e6e9ec', 0.5), base: M('#aab3bb', 0.6), panel: M('#c4ccd3', 0.55), wheel: M('#2d333b', 0.6), mattress: M('#e7efea', 0.9),
    blanket: new THREE.MeshStandardMaterial({ map: blanketTex, roughness: 0.95 }), pillow: new THREE.MeshStandardMaterial({ map: pillowTex, roughness: 0.95 }),
    gown: new THREE.MeshStandardMaterial({ map: gownTex, roughness: 0.9 }), skin: F('#efc7aa', 0.65), hair: F('#ffffff', 0.8),
    unit: M('#d7dde2', 0.6), cabinet: M('#ecebe4', 0.6), top: M('#9fb3c2', 0.55), pole: M('#c3cbd3', 0.35, 0.5),
    curtain: new THREE.MeshStandardMaterial({ color: '#d6e4f0', roughness: 0.95, side: THREE.DoubleSide }),
    letters: Object.fromEntries(Object.entries(letterTex).map(([L, t]) => [L, basic({ map: t, transparent: true })])),
    name: basic({ map: nameTex }), plaque: basic({ map: plaqueTex(WARD) }),
  };
  const hairGeo = () => new THREE.SphereGeometry(0.157, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  // a gently waved sheet, for the curtains bunched between the beds
  const wavy = (len, h, amp, freq) => {
    const geo = new THREE.PlaneGeometry(len, h, 40, 1), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = pos.getX(i); pos.setZ(i, Math.sin(u * freq) * amp + Math.sin(u * freq * 2.6) * amp * 0.25); }
    geo.computeVertexNormals(); return geo;
  };
  const curtainGeo = wavy(0.7, 1.9, 0.06, 26);
  function bed(b) {
    const { x, z, x0 } = b, wx = x0 + 0.08;
    for (const sx of [-0.82, 0.82]) for (const sz of [-0.36, 0.36]) kc(B_M.wheel, 0.065, 0.065, 0.06, x + sx, 0.065, z + sz, 12, [Math.PI / 2, 0, 0]);
    kb(B_M.base, 1.8, 0.1, 0.8, x, 0.18, z);
    for (const sx of [-0.5, 0.5]) kb(B_M.base, 0.14, 0.3, 0.14, x + sx, 0.36, z, 0.02);
    kb(B_M.frame, 2.08, 0.09, 1.0, x, 0.53, z);
    kb(B_M.mattress, 1.98, 0.18, 0.94, x + 0.02, 0.66, z, 0.07);
    kb(B_M.frame, 0.09, 0.62, 1.06, x - 1.06, 0.9, z, 0.04);
    kb(B_M.frame, 0.12, 0.5, 1.1, x + 1.07, 0.78, z, 0.05);
    kb(B_M.panel, 0.02, 0.28, 0.84, x + 1.14, 0.74, z, 0.01);
    for (const sz of [-0.53, 0.53]) { kb(B_M.frame, 0.8, 0.22, 0.06, x - 0.42, 0.86, z + sz, 0.03); kb(B_M.frame, 0.68, 0.2, 0.06, x + 0.5, 0.84, z + sz, 0.03); }
    kb(B_M.pillow, 0.38, 0.13, 0.64, x - 0.78, 0.82, z, 0.06, [0, 0, -0.26]);
    const pt = new THREE.Group(); world.add(pt); patients[b.id] = pt;
    if (b.occupied) {
      kitAdd('head', () => new THREE.SphereGeometry(0.15, 12, 10), B_M.skin, x - 0.6, 0.97, z);
      kitAdd('hair', hairGeo, B_M.hair, x - 0.6, 0.97, z, [0, 0, Math.PI / 2], b.hair);
      kb(B_M.gown, 0.3, 0.12, 0.62, x - 0.32, 0.83, z, 0.05);
      kb(B_M.blanket, 1.36, 0.15, 0.9, x + 0.27, 0.8, z, 0.07);
      kb(B_M.blanket, 1.08, 0.12, 0.54, x + 0.2, 0.88, z, 0.06);
    } else kb(B_M.blanket, 0.5, 0.08, 0.9, x + 0.68, 0.79, z, 0.04);
    // head unit on the wall: gases, call button, the bed letter and its green plaque
    kb(B_M.unit, 0.07, 1.0, 1.25, wx + 0.04, 1.5, z, 0.02);
    [['#2fa36b', -0.42], ['#f4f4f4', -0.29], ['#f2c230', -0.16]].forEach(([c, dz]) => kc(M(c, 0.4), 0.04, 0.04, 0.035, wx + 0.09, 1.18, z + dz, 12, [0, 0, Math.PI / 2]));
    kb(M('#d33a3a', 0.5), 0.04, 0.14, 0.14, wx + 0.09, 1.56, z - 0.36, 0.02);
    kp(B_M.letters[b.letter], 0.24, 0.24, wx + 0.085, 1.86, z + 0.32, [0, Math.PI / 2, 0]);
    if (b.isCase) plane(world, 0.3, 0.085, basic({ map: plaqueTex(b.id) }), wx + 0.085, 1.7, z + 0.32).rotation.y = Math.PI / 2;
    else kp(B_M.plaque, 0.3, 0.085, wx + 0.085, 1.7, z + 0.32, [0, Math.PI / 2, 0]);
    kp(B_M.name, 0.24, 0.3, wx + 0.085, 1.45, z + 0.32, [0, Math.PI / 2, 0]);
    if (b.isCase) lamps[b.id] = sph(world, 0.055, lampOff, wx + 0.1, 1.9, z - 0.36, 14, 10);
    else kitAdd('lamp', () => new THREE.SphereGeometry(0.055, 12, 8), lampOff, wx + 0.1, 1.9, z - 0.36);
    // bedside cabinet with the wood top, and the curtain bunched against the wall between beds
    kb(B_M.cabinet, 0.44, 0.72, 0.44, wx + 0.36, 0.36, z - 0.74, 0.02);
    kb(B_M.top, 0.48, 0.04, 0.48, wx + 0.36, 0.74, z - 0.74, 0.01);
    kb(M('#c9c8c0', 0.5), 0.36, 0.02, 0.012, wx + 0.36, 0.5, z - 0.515, 0);
    kitAdd('curtain', () => curtainGeo, B_M.curtain, wx + 0.5, 1.23, z - 1.0);
    solid(x - 1.12, z - 0.52, x + 1.14, z + 0.52);
    solid(wx + 0.12, z - 0.98, wx + 0.6, z - 0.5);
    if (b.iv) {
      const px = wx + 0.42, pz = z + 0.7;
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; kb(B_M.pole, 0.28, 0.025, 0.035, px + Math.cos(a) * 0.13, 0.06, pz + Math.sin(a) * 0.13, 0.01, [0, -a, 0]); }
      kc(B_M.pole, 0.018, 0.018, 1.95, px, 1.0, pz, 8);
      kb(new THREE.MeshStandardMaterial({ color: '#e6f3fa', roughness: 0.2, transparent: true, opacity: 0.8 }), 0.05, 0.24, 0.15, px, 1.78, pz + 0.08, 0.02);
      kb(M('#eef0f3', 0.5), 0.13, 0.2, 0.17, px + 0.06, 1.2, pz, 0.02);
      solid(px - 0.12, pz - 0.12, px + 0.12, pz + 0.12);
    }
    if (b.isCase) wallMonitor(b);
  }
  function wallMonitor(b) {
    const g = new THREE.Group(); g.position.set(b.x0 + 0.1, 0, b.z - 0.62); world.add(g);
    box(g, 0.42, 0.06, 0.06, M('#9aa4ae', 0.4, 0.3), 0.21, 2.05, 0, 0.02);
    const mon = new THREE.Group(); mon.position.set(0.44, 2.05, 0); mon.rotation.y = 0.9; g.add(mon);
    box(mon, 0.58, 0.42, 0.12, M('#2b3138', 0.5), 0, 0, 0, 0.03);
    monitors[b.id] = plane(mon, 0.52, 0.355, basic({ map: TEX[b.id] ? TEX[b.id][1] : okTex, toneMapped: false }), 0, 0, 0.062);
  }
  BEDS.forEach(bed);
  // ---------- core rooms ----------
  function chair(x, z, rot = 0, seat = '#33404d') {
    const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = rot; world.add(c);
    cyl(c, 0.27, 0.27, 0.04, M('#2e3640', 0.5), 0, 0.05, 0, 18);
    cyl(c, 0.03, 0.03, 0.4, M('#8a939d', 0.4, 0.5), 0, 0.26, 0, 10);
    box(c, 0.48, 0.07, 0.46, M(seat, 0.7), 0, 0.47, 0, 0.03);
    box(c, 0.44, 0.5, 0.06, M(seat, 0.7), 0, 0.8, -0.24, 0.03);
    return c;
  }
  const shelfM = M('#9aa1a8', 0.5, 0.3), binColors = ['#e4572e', '#4f86c6', '#f3a712', '#29a36a', '#b56fd8', '#e94f87', '#3fb6c6'];
  function shelf(x, z, w, rotated) {
    const W = rotated ? 0.45 : w, D = rotated ? w : 0.45;
    for (let i = 0; i < 4; i++) kb(shelfM, W, 0.03, D, x, 0.2 + i * 0.42, z, 0);
    for (const s of [-1, 1]) kb(shelfM, rotated ? 0.45 : 0.04, 1.5, rotated ? 0.04 : 0.45, x + (rotated ? 0 : s * w / 2), 0.75, z + (rotated ? s * w / 2 : 0), 0);
    const r = rng(Math.round(x * 13 + z * 7));
    for (let i = 0; i < 3; i++) for (let k = 0; k < Math.floor(w / 0.32); k++) if (r() < 0.8) {
      const off = -w / 2 + 0.2 + k * 0.32;
      kb(M(binColors[Math.floor(r() * 7)], 0.6), rotated ? 0.34 : 0.26, 0.22, rotated ? 0.26 : 0.34, x + (rotated ? 0 : off), 0.33 + i * 0.42, z + (rotated ? off : 0), 0.02);
    }
    solid(x - W / 2, z - D / 2, x + W / 2, z + D / 2);
  }
  const counterM = M('#e9e6df', 0.5), sinkM = M('#cfd6dc', 0.25, 0.4);
  const plinthM = M('#7f9fb4', 0.6), whiteTopM = M('#f2f4f5', 0.3), baseWoodM = M('#7f9fb4', 0.55), topM = M('#eef1f3', 0.45);
  function counter(x0, z0, x1, z1, h, d, faceM, topMat) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.Group(); g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); g.rotation.y = -Math.atan2(z1 - z0, x1 - x0); world.add(g);
    box(g, len, h - 0.12, d, faceM, 0, (h - 0.12) / 2 + 0.06, 0, 0.02);
    box(g, len - 0.04, 0.08, d - 0.06, plinthM, 0, 0.04, 0, 0);
    box(g, len + 0.04, 0.05, d + 0.12, topMat, 0, h - 0.035, 0, 0.015);
    solid(Math.min(x0, x1) - d / 2, Math.min(z0, z1) - d / 2, Math.max(x0, x1) + d / 2, Math.max(z0, z1) + d / 2);
  }
  // ---------- nurse station ----------
  // A white-topped counter round three sides with the staff sitting behind it, the call bell in a
  // gap in the front counter, charting screens along the back, and a ceiling panel with a cool
  // light that marks the station from anywhere in the hall.
  const sinkM2 = sinkM;
  counter(-3, -1.6, 3, -1.6, 0.84, 0.6, baseWoodM, whiteTopM);
  counter(-3, -1.6, -3, 1.6, 0.84, 0.5, baseWoodM, whiteTopM);
  counter(3, -1.6, 3, 1.6, 0.84, 0.5, baseWoodM, whiteTopM);
  counter(-3, 1.6, -0.8, 1.6, 0.84, 0.5, baseWoodM, whiteTopM);
  counter(0.8, 1.6, 3, 1.6, 0.84, 0.5, baseWoodM, whiteTopM);
  chair(-1.8, 0.35, 0); chair(1.8, 0.35, 0); chair(-0.7, -0.7, Math.PI);
  // the screens on the back counter, facing the camera
  [-1.6, 0, 1.6].forEach(x => {
    box(world, 0.08, 0.3, 0.08, M('#2b3138', 0.5), x, 1.0, -1.55, 0.01);
    box(world, 0.64, 0.42, 0.05, M('#22272e', 0.5), x, 1.3, -1.55, 0.02);
    plane(world, 0.58, 0.36, basic({ map: emrTex }), x, 1.3, -1.52);
  });
  // the call bell: a console in the gap in the front counter; its lamp is red while a bell rings
  box(world, 1.0, 0.9, 0.5, M('#d9dee2', 0.4), 0, 0.45, 1.6, 0.04);
  box(world, 0.72, 0.04, 0.34, M('#2b3138', 0.5), 0, 0.92, 1.58, 0.01);
  const bellLamp = sph(world, 0.11, lampOff, 0, 1.06, 1.6, 14, 10);
  plane(world, 0.9, 0.26, basic({ map: signTex('呼叫鈴', null, '#8a1f1f', '#ffffff', 360, 100, 52), toneMapped: false, color: '#f0d6d6' }), 0, 1.42, 1.68);
  solid(-0.5, 1.3, 0.5, 1.9);
  // the ceiling panel; its sides carry a cool light
  const octagon = (hx, hz, c) => {
    const s = new THREE.Shape();
    [[-hx + c, -hz], [hx - c, -hz], [hx, -hz + c], [hx, hz - c], [hx - c, hz], [-hx + c, hz], [-hx, hz - c], [-hx, -hz + c]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    s.closePath(); return s;
  };
  const ringShape = octagon(3.55, 2.2, 0.3);
  ringShape.holes.push(new THREE.Path(octagon(3.2, 1.85, 0.25).getPoints()));
  const stationRing = new THREE.Mesh(new THREE.ExtrudeGeometry(ringShape, { depth: 0.18, bevelEnabled: false }), [
    M('#e4eaee', 0.55),
    new THREE.MeshStandardMaterial({ color: '#dfe8ec', emissive: '#9fd0ff', emissiveIntensity: 0.45, roughness: 0.5 }),
  ]);
  stationRing.rotation.x = -Math.PI / 2; stationRing.position.set(0, 2.72, 0); world.add(stationRing);
  [[-3.4, -2.0], [3.4, -2.0], [-3.4, 2.0], [3.4, 2.0]].forEach(([x, z]) => cyl(world, 0.01, 0.01, 0.4, M('#9aa4ae', 0.4), x, 3.05, z, 6));
  [-0.9, 0.9].forEach(x => cyl(world, 0.008, 0.008, 0.3, M('#9aa4ae', 0.4), x, 2.48, 2.35, 6));
  plane(world, 2.4, 0.62, basic({ map: signTex(`${WARD} 護理站`, 'NURSE STATION', '#1f4e79', '#ffffff'), color: '#e6eef6' }), 0, 2.02, 2.35);
  // the crash cart by the entrance, where the nurse can reach it
  const crash = (cx, cz) => {
    box(world, 0.78, 1.0, 0.58, M('#d43a3c', 0.5), cx, 0.5, cz, 0.04);
    for (let i = 0; i < 4; i++) box(world, 0.68, 0.015, 0.02, M('#ffd0d0', 0.4), cx, 0.25 + i * 0.2, cz + 0.3, 0);
    box(world, 0.44, 0.2, 0.34, M('#f0c02f', 0.5), cx, 1.1, cz, 0.03);
    plane(world, 0.22, 0.1, basic({ color: '#56ffa0', toneMapped: false }), cx, 1.14, cz + 0.175);
    solid(cx - 0.4, cz - 0.3, cx + 0.4, cz + 0.3);
  };
  crash(-5.2, 3.4);
  hang(-5.2, 2.2, '急救車', 1.4); hang(-8.4, 3.0, '← 01 病房', 1.7); hang(0, -4.6, `${WARD}02 – ${WARD}05 ↑`, 2.6); hang(7.6, 2.2, '休息室 →', 1.6);

  // ---------- rest room: a sofa to lie on, and a toilet ----------
  const sofaM = M('#6f9a94', 0.8), sofaDark = M('#557a75', 0.8);
  box(world, 3.0, 0.4, 0.9, sofaDark, 10.4, 0.2, -2.95, 0.04);
  box(world, 2.8, 0.14, 0.72, sofaM, 10.4, 0.47, -2.88, 0.06);
  box(world, 3.0, 0.5, 0.22, sofaM, 10.4, 0.75, -3.37, 0.06);
  box(world, 0.24, 0.56, 0.9, sofaDark, 8.98, 0.5, -2.95, 0.05); box(world, 0.24, 0.56, 0.9, sofaDark, 11.82, 0.5, -2.95, 0.05);
  solid(8.8, -3.5, 12.0, -2.5);
  const sleepBlanket = box(world, 1.3, 0.14, 0.8, new THREE.MeshStandardMaterial({ map: spreadTex, roughness: 0.95 }), 11.2, 0.62, -2.88, 0.06);
  sleepBlanket.visible = false;
  // a small table with a drink, a water dispenser, a bin
  box(world, 1.0, 0.05, 0.7, M('#c9a77a', 0.5), 10.2, 0.72, 1.6, 0.02); cyl(world, 0.05, 0.05, 0.7, M('#8a7a66', 0.5), 10.2, 0.36, 1.6, 8);
  cyl(world, 0.05, 0.045, 0.1, M('#f4f4f2', 0.4), 10.0, 0.8, 1.6, 12);
  solid(9.65, 1.25, 10.75, 1.95);
  chair(9.0, 1.7, Math.PI / 2); chair(11.4, 1.7, -Math.PI / 2);
  box(world, 0.42, 1.2, 0.42, M('#dfe6ea', 0.35), 14.0, 0.6, 2.9, 0.04); box(world, 0.3, 0.3, 0.3, M('#9fd0ff', 0.2), 14.0, 1.35, 2.9, 0.03); solid(13.75, 2.65, 14.25, 3.15);
  plane(world, 0.9, 0.3, basic({ map: signTex('休息室', null, '#2f6f6a', '#ffffff', 360, 120, 56), toneMapped: false, color: '#e0f0ee' }), 11.4, 2.2, -3.4);
  const lampArm = cyl(world, 0.012, 0.012, 0.42, M('#2b2f36', 0.5), 12.0, 0.9, -3.3, 8); lampArm.rotation.x = 0.0;
  sph(world, 0.06, glow('#ffd59a', 4), 12.0, 1.15, -3.3, 10, 8);
  // where the rest room's routines happen
  const REST = { sofa: [8.8, -3.5, 12.0, -2.5], wake: [10.4, -1.9], toiletAt: [13.4, -2.4], toiletOut: [13.0, -0.7], sleeper: [10.9, 0.62, -2.88], zzz: [10.4, 1.3, -2.9] };

  // ---------- plants at the entrance ----------
  function plant(x, z) {
    cyl(world, 0.22, 0.17, 0.42, M('#d9dde0', 0.7), x, 0.21, z, 16);
    [[0, 0.62, 0, 0.3], [0.12, 0.85, 0.05, 0.22], [-0.1, 0.8, -0.06, 0.2]].forEach(([dx, y, dz, r]) => sph(world, r, F('#3f8a52', 0.8), x + dx, y, z + dz, 8, 6));
    solid(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
  }
  plant(-7.8, 3.3); plant(7.8, 3.3);

  // ---------- people ----------
  const coatM = new THREE.MeshStandardMaterial({ color: '#f6f8fa', roughness: 0.85, side: THREE.DoubleSide, flatShading: true });
  function person(o) {
    const g = new THREE.Group();
    const skinM = F(o.skin || '#f0c6a6', 0.65), topM = F(o.top, 0.85), pantsM = F(o.pants || o.top, 0.85), shoeM = F(o.shoes || '#eceff2', 0.6);
    const pose = o.pose || 'stand';
    const lift = pose === 'sit' ? -0.36 : 0;
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      if (pose === 'stand') {
        const hip = new THREE.Group(); hip.position.set(s * 0.085, 0.74, 0); g.add(hip);
        cyl(hip, 0.068, 0.062, 0.66, pantsM, 0, -0.33, 0, 8);
        box(hip, 0.12, 0.08, 0.25, shoeM, 0, -0.7, 0.04, 0.035);
        legs.push(hip);
      } else {
        const th = cyl(g, 0.072, 0.072, 0.44, pantsM, s * 0.085, 0.5, 0.2, 8); th.rotation.x = Math.PI / 2;
        cyl(g, 0.062, 0.06, 0.46, pantsM, s * 0.085, 0.26, 0.4, 8);
        box(g, 0.12, 0.08, 0.25, shoeM, s * 0.085, 0.04, 0.46, 0.035);
      }
    }
    cyl(g, 0.19, 0.215, 0.6, topM, 0, 0.99 + lift, 0, 10);
    const sh = sph(g, 0.205, topM, 0, 1.27 + lift, 0, 10, 6); sh.scale.set(1, 0.42, 0.82);
    let armM = topM;
    if (o.coat) {
      armM = coatM;
      // short coat (PGY) ends at the hip; long coat (residents and up) reaches the knee
      const short = o.coat === 'short' || pose !== 'stand';
      const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.226, short ? 0.25 : 0.28, short ? 0.6 : 0.92, 12, 1, true, 0.42, Math.PI * 2 - 0.84), coatM);
      coat.position.set(0, pose === 'stand' ? (short ? 1.03 : 0.87) : 1.0 + lift, 0); g.add(coat);
      const cs = sph(g, 0.215, coatM, 0, 1.275 + lift, -0.01, 10, 6); cs.scale.set(1.02, 0.42, 0.8);
    }
    for (const s of [-1, 1]) {
      const shp = new THREE.Group(); shp.position.set(s * 0.258, 1.27 + lift, 0); shp.rotation.z = s * 0.1; g.add(shp);
      cyl(shp, 0.064, 0.056, 0.56, armM, 0, -0.27, 0, 8);
      sph(shp, 0.06, skinM, 0, -0.58, 0, 8, 6);
      arms.push(shp);
    }
    cyl(g, 0.07, 0.075, 0.1, skinM, 0, 1.36 + lift, 0, 8);
    const hy = 1.58 + lift;
    sph(g, 0.205, skinM, 0, hy, 0, 12, 10);
    for (const s of [-1, 1]) sph(g, 0.022, M('#1d1a1a', 0.4), s * 0.072, hy + 0.02, 0.19, 6, 5);
    const hm = F(o.hairColor || '#1d1817', 0.75);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.222, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), hm);
    cap.position.set(0, hy + 0.012, -0.012); cap.rotation.x = -0.32; g.add(cap);
    if (o.hair === 'pony') { sph(g, 0.09, hm, 0, hy + 0.08, -0.2, 8, 6); const tail = cyl(g, 0.07, 0.03, 0.3, hm, 0, hy - 0.08, -0.27, 8); tail.rotation.x = 0.35; }
    if (o.hair === 'bob') { const b = sph(g, 0.225, hm, 0, hy - 0.045, -0.04, 12, 8); b.scale.set(1.04, 0.92, 1); }
    if (o.mask) box(g, 0.21, 0.11, 0.07, F('#b9d8f0', 0.9), 0, hy - 0.08, 0.165, 0.03);
    if (o.clip) box(g, 0.24, 0.3, 0.03, F('#a77b4f', 0.7), 0, 1.06 + lift, 0.23, 0.01);
    if (o.steth) {
      const st = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.013, 6, 16, Math.PI), M('#2d3138', 0.5));
      st.rotation.z = Math.PI; st.rotation.x = -0.28; st.position.set(0, 1.27 + lift, 0.17); g.add(st);
    }
    if (o.badge) box(g, 0.075, 0.095, 0.02, M('#ffffff', 0.5), -0.1, 1.13 + lift, 0.215, 0.01);
    g.userData = { legs, arms, person: true };
    world.add(g);
    return g;
  }
  const place = (obj, x, z, rot = 0) => { obj.position.set(x, 0, z); obj.rotation.y = rot; return obj; };
  const PGY_LOOK = { m: { hair: 'short', hairColor: '#1b1716' }, f: { hair: 'pony', hairColor: '#141110' } };
  const players = {}, sleepers = {};
  for (const k of ['m', 'f']) {
    // the shift starts in front of the station, the nurse facing it
    // the player is a nurse in teal scrubs (no white coat), a stethoscope round the neck
    players[k] = place(person({ top: '#5fb8ad', steth: true, badge: true, ...PGY_LOOK[k] }), 0, 3.3, Math.PI);
    players[k].rotation.order = 'YXZ'; // turn first, then lean forward over a chest
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40), basic({ color: '#45e3cc', transparent: true, opacity: 0.9, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; players[k].add(ring);
    // lying on the rest-room sofa, head toward the west
    const holder = place(person({ top: '#5fb8ad', pose: 'sit', ...PGY_LOOK[k] }), 10.4, -2.78, 0);
    world.add(holder);
    cyl(holder, 0.045, 0.036, 0.11, M('#f4f4f2', 0.5), 0.2, 1.0, 0.3, 12);   // a paper cup
    holder.visible = false; sleepers[k] = holder;
  }
  players.f.visible = false;
  let player = players.m;

  const NURSE = { top: '#f5f6f8', hair: 'pony', hairColor: '#6b3f22', clip: true, badge: true };
  const nurseByBed = {};   // nobody waits at the bed tonight; collide() still looks here
  // the night staff at the station: 淑芬學姊 and 阿哲 (the chief resident) behind the front counter, 雅琪 at the screens
  const sitShufen = place(person({ top: '#f5f6f8', hair: 'bob', hairColor: '#2c201d', pose: 'sit', mask: true }), -1.8, 0.35, 0);
  const sitAzhe = place(person({ top: '#7fb2dc', coat: 'long', steth: true, hair: 'short', hairColor: '#231c19', pose: 'sit', mask: true }), 1.8, 0.35, 0);
  const sitYaqi = place(person({ top: '#f5f6f8', hair: 'pony', hairColor: '#3a2a24', pose: 'sit', mask: true }), -0.7, -0.7, Math.PI);
  // the family member who comes to the station when a bell rings
  const visitor = place(person({ top: '#9a8aa8', pants: '#4b4f5a', hair: 'short', hairColor: '#2a2420' }), -2.0, 2.7, Math.PI * 0.85);
  visitor.visible = false;
  // the senior nurse's cry when a level goes wrong is on the bedside screen; nobody else is on the floor

  // the rest of the night staff walk the hall; they are scenery, so the player walks through them
  const staff = [];
  function walker(look, path, opts = {}) {
    const obj = place(person({ ...NURSE, ...look }), path[0][0], path[0][1], 0);
    const n = { obj, path, i: 1, dir: 1, wait: Math.random() * 3, speed: opts.speed || 1.25, phase: Math.random() * 6, active: opts.active !== false, once: !!opts.once, face: opts.face };
    obj.visible = n.active;
    staff.push(n);
    return n;
  }
  const wPinyu = walker({}, [[-6.8, -4.7], [6.8, -4.7], [6.8, 2.5]]);
  const wShuhan = walker({ hair: 'bob', hairColor: '#2c201d', clip: false }, [[6.8, 2.6], [-6.8, 2.6], [-6.8, -3.0]]);
  // everyone who can be spoken to (chatter.js), and how close the nurse has to be: the station
  // staff sit behind the counter, so they are reached from across it
  const TALKERS = [
    { key: 'pinyu', obj: wPinyu.obj, walker: wPinyu, reach: 1.3 }, { key: 'shuhan', obj: wShuhan.obj, walker: wShuhan, reach: 1.3 },
    { key: 'shufen', obj: sitShufen, reach: 2.4 }, { key: 'yaqi', obj: sitYaqi, reach: 2.4 }, { key: 'azhe', obj: sitAzhe, reach: 2.4 },
  ];
  function updateStaff(dt) {
    for (const n of staff) {
      if (!n.active) continue;
      const { obj, path } = n, { legs, arms } = obj.userData;
      if (n.wait > 0) { n.wait -= dt; legs.forEach(l => { l.rotation.x *= 0.8; }); arms.forEach(a => { a.rotation.x *= 0.8; }); continue; }
      const [tx, tz] = path[n.i], dx = tx - obj.position.x, dz = tz - obj.position.z, d = Math.hypot(dx, dz);
      if (d < 0.05) {
        if (n.once && n.i === path.length - 1) { n.active = false; if (n.face != null) obj.rotation.y = n.face; legs.forEach(l => { l.rotation.x = 0; }); arms.forEach(a => { a.rotation.x = 0; }); continue; }
        if (n.i === path.length - 1 || n.i === 0) n.dir = -n.dir;
        n.i += n.dir; n.wait = n.once ? 0 : 0.6 + Math.random() * 2.4;
        continue;
      }
      const step = Math.min(d, n.speed * dt);
      obj.position.x += dx / d * step; obj.position.z += dz / d * step;
      let diff = Math.atan2(dx, dz) - obj.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      obj.rotation.y += diff * Math.min(1, dt * 10);
      n.phase += dt * n.speed * 3.4;
      const sw = Math.sin(n.phase) * 0.5;
      legs[0].rotation.x = sw; legs[1].rotation.x = -sw; arms[0].rotation.x = -sw * 0.6; arms[1].rotation.x = sw * 0.6;
    }
  }
  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight('#8f9dc8', '#2a2730', 1.05); scene.add(hemi);
  // moonlight through the windows; its shadow box follows the camera, so it stays sharp on a long floor
  const moon = new THREE.DirectionalLight('#b0c2ff', 1.0);
  const MOON = new THREE.Vector3(-10, 18, 10);
  moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -16, right: 16, top: 14, bottom: -14, near: 1, far: 70 });
  moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.03;
  scene.add(moon, moon.target);
  const point = (color, intensity, dist, x, y, z) => { const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); scene.add(l); return l; };
  // the floor has far more ceiling lights than a forward renderer should carry, so a fixed
  // pool of point lights moves to the fixtures nearest the camera
  const FIX = [];
  [[-5, 0.5], [5, 0.5], [0, -4.6], [-5.5, -4.6], [5.5, -4.6], [0, 3.2]].forEach(([x, z]) => FIX.push([x, z, '#f4f6ff', 9, 8]));
  FIX.push([0, 0, '#eef6ff', 14, 9]);
  FIX.push([11.4, 0, '#ffcf9a', 2.5, 6]);
  ROOMS.forEach(r => { const zc = (r.z0 + r.z1) / 2; FIX.push([r.x0 + 1.75, zc, '#7d95d6', 3.2, 7.5]); if (r.beds > 2) FIX.push([r.x0 + 1.75, zc + (r.beds === 4 ? 2.2 : 0), '#7d95d6', 3.2, 7.5], [r.x0 + 1.75, zc - 2.2, '#7d95d6', 3.2, 7.5]); });
  const pool = Array.from({ length: 7 }, () => point('#ffffff', 0, 8, 0, 2.7, 0));
  let poolAt = null;
  let poolDim = 1;
  function updateLights(target) {
    const dim = S.t < PACE.lightsOn ? 0.6 : 1;  // first called after S exists (updateCamera at the end of boot)
    if (poolAt && poolAt.distanceToSquared(target) < 1 && dim === poolDim) return;
    poolAt = (poolAt || new THREE.Vector3()).copy(target); poolDim = dim;
    const near = FIX.map(f => [f, (f[0] - target.x) ** 2 + (f[1] - target.z) ** 2]).sort((a, b) => a[1] - b[1]);
    pool.forEach((l, i) => { const f = near[i][0]; l.position.set(f[0], 2.7, f[1]); l.color.set(f[2]); l.intensity = f[3] * (f[2] === '#7d95d6' ? 1 : dim); l.distance = f[4]; });
  }
  point('#ffc27a', 5, 4, 12.0, 1.1, -3.3); // the rest room's lamp
  // two roaming alarm lights follow the most urgent red and amber beds, so the light count stays fixed
  const alarmRed = point('#ff2d2d', 0, 4.5, 0, 1.9, 7.6), alarmAmber = point('#ffae3d', 0, 3.5, 0, 1.9, 7.6);

  flushKit();
  // Everything that never moves, changes material or hides is baked into one mesh per material:
  // a few hundred draw calls become a few dozen, which is what an integrated GPU can carry.
  function bake(keep) {
    world.updateMatrixWorld(true);
    const groups = new Map(), baked = [];
    world.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible) return;
      for (let q = o; q && q !== world; q = q.parent) if (keep.has(q) || q.userData.person || !q.visible) return;
      // indexed and non-indexed geometry cannot share a merge, so they go to separate groups
      const geo = o.geometry, key = `${o.material.uuid}|${geo.index ? 'i' : 'n'}|${Object.keys(geo.attributes).sort().join()}`;
      if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [] });
      groups.get(key).geos.push(geo.clone().applyMatrix4(o.matrixWorld));
      baked.push(o);
    });
    baked.forEach(o => o.parent.remove(o));
    for (const { mat, geos } of groups.values()) world.add(new THREE.Mesh(mergeGeometries(geos), mat));
  }
  bake(new Set([...Object.values(lamps), ...Object.values(monitors), sleepBlanket, stationRing, bellLamp]));
  // only people and beds cast moon shadows; walls and props just receive them
  world.traverse(o => {
    if (!o.isMesh) return;
    const flat = !Array.isArray(o.material) && o.material.isMeshBasicMaterial;
    let person = false;
    for (let q = o; q; q = q.parent) if (q.userData.person) { person = true; break; }
    o.receiveShadow = !flat;
    o.castShadow = !flat && (person || o.isInstancedMesh);
  });

  // ---------- render pipeline ----------
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const camDir = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 2 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, cam));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.86));
  composer.addPass(new OutputPass());
  let vw = 16, vh = 9;
  // render scale, lowered when the GPU cannot keep up (see frameLoop) and raised again when it can
  let quality = 1;
  function resize() {
    const r = frame.getBoundingClientRect();
    vw = Math.max(16, r.width); vh = Math.max(9, r.height);
    const dpr = Math.max(0.6, Math.min(window.devicePixelRatio || 1, 1.75) * quality);
    renderer.setPixelRatio(dpr); renderer.setSize(vw, vh, false);
    composer.setPixelRatio(dpr); composer.setSize(vw, vh);
  }
  new ResizeObserver(resize).observe(frame);
  resize();

  const camTarget = new THREE.Vector3(0, 0.6, 2);
  let zoom = 4.9;
  function updateCamera(dt, snap) {
    const want = S.map ? new THREE.Vector3(1.5, 0, -5.5) : new THREE.Vector3(player.position.x, 0.6, player.position.z - 0.4);
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    camTarget.lerp(want, k);
    zoom += ((S.map ? 17 : 4.9) - zoom) * (snap ? 1 : 1 - Math.exp(-dt * 5));
    cam.position.copy(camTarget).addScaledVector(camDir, 60);
    cam.lookAt(camTarget);
    const hw = zoom * vw / vh;
    cam.left = -hw; cam.right = hw; cam.top = zoom; cam.bottom = -zoom;
    cam.updateProjectionMatrix();
    const sh = S.map ? 40 : 16;
    if (moon.shadow.camera.right !== sh) { Object.assign(moon.shadow.camera, { left: -sh, right: sh, top: sh * 0.9, bottom: -sh * 0.9 }); moon.shadow.camera.updateProjectionMatrix(); }
    moon.target.position.copy(camTarget); moon.position.copy(camTarget).add(MOON);
    updateLights(camTarget);
  }


  // ---------- the night ----------
  // Nine call bells ring one after another (levels.js). Between them the nurse can rest on the
  // sofa, use the toilet, or talk to the staff. Time only matters for the nurse's own needs.
  const START = 1 * 60, END = 8 * 60;   // the shift runs 01:00 to 08:00
  const PACE = {
    walk: 0.9, bed: 0.25, sleep: 7.2,
    quiet: 2.6,             // nothing to do: the night moves on faster
    lightsOn: 6 * 60,       // dawn: the hall lights come back up
  };
  const pickN = (list, n) => list.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  // everything about tonight: the clock, the nurse's needs, the nine levels, the counts for the summary
  //   level state: wait (not rung yet) | ring (bell ringing at the station) | go (answered: walk to the bed)
  //                | win (done; a coin if it was finished with a heart left)
  const S = {
    started: false, mode: 'walk', map: false, t: START, energy: 82, bladder: 20, ended: false, paused: false, pgy: 'm',
    lv: LEVELS.map((L, i) => ({ i, state: 'wait', hearts: 3, tries: 0, coin: false })),
    coins: 0, ringing: null, nextBellAt: START + 10,
    quiz: { read: { right: 0, total: 0 } },
    stats: { sleptMin: 0, redo: 0, lost: 0 },
    sleepStart: 0,
  };
  const LV = S.lv;
  const levelBed = i => wb(LEVELS[i].bed);
  // the portraits: placeholders drawn by tools/make-placeholders.mjs. Put your own art in
  // assets/game/char/ under the same names; if it is .png, change .svg here and in index.html
  const IMG = n => `assets/game/char/${n}.svg`;
  const ME = e => IMG(`pgy_${S.pgy}_${e}`);
  const preload = () => ['worried', 'panic', 'relieved', 'stern', 'shocked', 'caring', 'thankful', 'neutral']
    .map(e => `nurse_${e}`)
    .concat(['nervous', 'sleepy', 'scolded', 'confident', 'survived', 'neutral'].map(e => `pgy_${S.pgy}_${e}`))
    .forEach(n => { const i = new Image(); i.src = IMG(n); });
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const asLines = t => (Array.isArray(t) ? t : [t]).flatMap(x => String(x).split('\n'));
  // levels still to do: rung and answered but not finished
  const pending = () => LV.filter(l => l.state === 'go');
  const doneCount = () => LV.filter(l => l.state === 'win').length;

  // ---------- markers ----------
  const marks = $('marks');
  const mk = (cls, html) => { const d = document.createElement('div'); d.className = `mk ${cls}`; d.innerHTML = html; marks.appendChild(d); return d; };
  const caseMarks = {}, edges = {};
  const BELL_AT = new THREE.Vector3(0, 2.3, 1.7);
  const markTarget = i => (LV[i].state === 'ring' ? BELL_AT : (b => new THREE.Vector3(b.x + 0.3, 2.3, b.z))(BED[levelBed(i)]));
  function markFor(i) {
    if (!caseMarks[i]) {
      caseMarks[i] = mk('red', '<span class="bang">!</span><span class="lbl"></span>');
      const d = document.createElement('div'); d.className = 'edge red'; d.innerHTML = '<i></i><span></span>'; d.hidden = true; marks.appendChild(d); edges[i] = d;
    }
    return caseMarks[i];
  }
  const bedTags = BEDS.map(b => ({ b, el: mk('tag dimlbl', `<span class="lbl">${b.id}</span>`) }));
  // room numbers over each door
  const roomTags = ROOMS.map(r => ({ p: r.side === 'west' ? new THREE.Vector3(HALL.x0, 1.5, r.z0 + 5.3) : new THREE.Vector3(r.x0 + 2.85, 1.5, HALL.z0), el: mk('tag', `<span class="lbl">${r.n}</span>`) }));
  const placeTags = [
    { p: new THREE.Vector3(0, 2.9, -0.4), el: mk('tag', '<span class="lbl">護理站</span>') },
    { p: new THREE.Vector3(11.4, 1.7, -2.4), el: mk('tag', '<span class="lbl">休息室</span>') },
    { p: new THREE.Vector3(13.4, 1.3, -2.8), el: mk('tag dimlbl', '<span class="lbl">廁所</span>'), near: 6 },
  ];
  const zzz = mk('zzz', 'Z z z'); zzz.hidden = true;
  const prompt = document.createElement('div'); prompt.className = 'mk';
  prompt.innerHTML = '<span class="prompt"><span class="key" id="promptKey">E</span><span id="promptText"></span></span>'; prompt.hidden = true; marks.appendChild(prompt);
  const v3 = new THREE.Vector3();
  const project = p => { v3.copy(p).project(cam); return v3; };
  const setPos = (el, v) => { el.style.left = `${((v.x + 1) / 2 * 100).toFixed(2)}%`; el.style.top = `${((1 - v.y) / 2 * 100).toFixed(2)}%`; };

  // ---------- HUD ----------
  const fmt = t => { const m = Math.floor(t) % 1440, h = Math.floor(m / 60), mm = m % 60; return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
  function setMeter(id, v, warnAt, badAt, invert) {
    const el = $(id); el.style.width = `${Math.max(2, Math.min(100, v))}%`;
    const bad = invert ? v > badAt : v < badAt, warn = invert ? v > warnAt : v < warnAt;
    el.className = bad ? 'bad' : warn ? 'warn' : '';
  }
  const hearts = (n, total = 3) => '♥'.repeat(Math.max(0, n)) + '♡'.repeat(Math.max(0, total - n));
  let hudTimer = 0, lastBoard = '';
  function renderHud() {
    $('clock').textContent = fmt(S.t);
    $('coins').textContent = `${S.coins} / ${LEVELS.length}`;
    $('untilHandover').textContent = `完成 ${doneCount()} / ${LEVELS.length} 間病房`;
    setMeter('mEnergy', S.energy, 40, 20); $('tEnergy').textContent = `${Math.round(S.energy)}%`;
    setMeter('mBladder', S.bladder, 70, 85, true); $('tBladder').textContent = `${Math.round(S.bladder)}%`;
    // the station board: every room, and a warning on the ones not finished
    const row = l => {
      const L = LEVELS[l.i], cls = `st-${l.state}`;
      const status = l.state === 'wait' ? '還沒有呼叫' : l.state === 'ring' ? '🔔 呼叫鈴響了！' : l.state === 'go' ? `⚠ 尚未完成 ${l.tries ? hearts(l.hearts) : ''}` : `✓ ${hearts(l.hearts)}${l.coin ? ' 🪙' : ''}`;
      return `<li class="${cls}"><b>Room ${L.n}</b><span>${l.state === 'wait' ? '—' : `${L.bed}${l.state === 'win' ? ` · ${esc(L.name)}` : ''}`}</span><time>${status}</time></li>`;
    };
    const board = `<header>病房總覽 <b>🪙 ${S.coins} / ${LEVELS.length}</b></header><ol>${LV.map(row).join('')}</ol>`;
    if (board !== lastBoard) { lastBoard = board; $('calls').innerHTML = board; }
    $('goal').innerHTML = goalText();
  }
  function goalText() {
    if (S.mode === 'sleep') return '坐著喝水休息中……按 <b>E</b> 起來';
    if (S.mode === 'toilet') return '上廁所中…';
    if (S.ringing != null) return '呼叫鈴響了！回<b>護理站</b>，在呼叫鈴旁按 <b>E</b> 接聽';
    const go = pending()[0];
    if (go) return `去 <b>${LEVELS[go.i].bed}</b>（Room ${LEVELS[go.i].n}）處理：走到床邊按 <b>E</b>`;
    if (S.energy < TIRED) return '精力不到 20%，跑不動了。快去<b>休息室</b>的沙發坐下喝水休息，歸零就會累倒';
    if (S.bladder >= 85) return '快憋不住了，去<b>休息室</b>的廁所';
    if (!LV.some(l => l.state === 'wait')) return '所有病房都處理完了。';
    return S.energy < 70 ? '等下一個呼叫鈴。精力有點低，去<b>休息室</b>的沙發坐下喝水休息吧' : '等下一個呼叫鈴。可以去<b>休息室</b>坐坐，或跟同事聊聊';
  }
  let toastTimer = 0;
  function toast(text, secs = 4, avatar) {
    $('toastText').innerHTML = text;
    const av = $('toastAvatar');
    if (avatar) { av.style.backgroundImage = `url(${IMG(avatar)})`; av.hidden = false; $('toast').classList.add('soft'); }
    else { av.hidden = true; $('toast').classList.remove('soft'); }
    $('toast').hidden = false; toastTimer = secs;
  }

  // ---------- the call bell ----------
  const lampOn = () => { bellLamp.material = lampMat.red; };
  // the next level rings a while after the last one is done (never while the nurse is at a bed)
  const scheduleBell = (min = 8 + Math.random() * 8) => { S.nextBellAt = LV.some(l => l.state === 'wait') ? S.t + min : Infinity; };
  function bellTick() {
    if (S.ringing != null || S.t < S.nextBellAt || !['walk', 'sleep', 'toilet'].includes(S.mode)) return;
    const l = LV.find(x => x.state === 'wait'); if (!l) { S.nextBellAt = Infinity; return; }
    ringBell(l.i);
  }
  function ringBell(i) {
    const l = LV[i], L = LEVELS[i];
    l.state = 'ring'; S.ringing = i; S.nextBellAt = Infinity;
    lampOn();
    if (S.mode === 'sleep') stopSleep();
    visitor.visible = L.bell.who === '家屬';
    toast(`呼叫鈴響了！回<b>護理站</b>，在呼叫鈴旁按 <b>E</b> 接聽。`, 5);
    markFor(i).hidden = false;
  }
  let bellPhase = null;
  function openBell() {
    const i = S.ringing; if (i == null) return;
    const L = LEVELS[i];
    S.mode = 'bell'; prompt.hidden = true; keys.clear();
    bellPhase = { i, said: false };
    $('bellPic').src = IMG(L.bell.who === '家屬' ? 'nurse_worried' : 'nurse_panic');
    $('bellMe').src = ME('nervous');
    $('bellWho').textContent = `${L.bell.who} · Room ${L.n}`;
    $('bellText').innerHTML = asLines(L.bell.text).map(t => `<span>${esc(t)}</span>`).join('');
    $('bellNote').textContent = '';
    const opts = L.bell.options;
    $('bellOpts').innerHTML = opts
      ? pickN(opts.map((o, k) => k), opts.length).map((k, pos) => `<button class="btn" type="button" data-k="${k}"><span class="key">${pos + 1}</span><span>${esc(opts[k].t)}</span></button>`).join('')
      : `<button class="btn red" type="button" data-go="1">我現在過去 <span class="key">E</span></button>`;
    if (!opts && L.bell.go) $('bellNote').textContent = L.bell.go;
    $('bell').hidden = false;
  }
  function bellChoose(k) {
    const { i } = bellPhase, L = LEVELS[i], o = L.bell.options[k];
    if (!o || bellPhase.said) return;
    bellPhase.said = true;
    if (o.cost) LV[i].hearts = Math.max(1, LV[i].hearts - o.cost);
    $('bellNote').innerHTML = (o.cost ? `<b class="cost">♥ −${o.cost}</b> ` : '') + esc(o.say);
    $('bellOpts').innerHTML = `<button class="btn red" type="button" data-go="1">前往 ${L.bed} 病房 <span class="key">E</span></button>`;
  }
  function bellGo() {
    if (!bellPhase) return;
    const i = bellPhase.i, L = LEVELS[i];
    $('bell').hidden = true; bellPhase = null;
    LV[i].state = 'go'; S.ringing = null; visitor.visible = false;
    bellLamp.material = lampOff;
    S.mode = 'walk'; frame.focus();
    lamps[levelBed(i)].material = lampMat.red;
    if (TEX[levelBed(i)] && monitors[levelBed(i)]) { monitors[levelBed(i)].material.map = TEX[levelBed(i)][0]; monitors[levelBed(i)].material.needsUpdate = true; }
    toast(`${L.bed}（Room ${L.n}）的監視器在響！往病房跑，走到床邊按 <b>E</b>。`, 4);
  }
  $('bellOpts').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) bellGo(); else bellChoose(Number(b.dataset.k));
  });

  // ---------- interactions ----------
  function nearest() {
    if (S.mode !== 'walk') return null;
    const p = player.position;
    let best = null, bd = 1e9;
    for (const l of pending()) {
      const b = BED[levelBed(l.i)], [tx, tz] = SPOT.touch(b), d = Math.hypot(p.x - tx, p.z - tz);
      if (d < 1.6 && d < bd) { bd = d; best = { kind: 'bed', i: l.i, key: 'E', label: `處理 ${LEVELS[l.i].bed}（Room ${LEVELS[l.i].n}）` }; }
    }
    if (S.ringing != null) { const d = Math.hypot(p.x - 0, p.z - 2.3); if (d < 1.5 && d < bd) { bd = d; best = { kind: 'bell', key: 'E', label: '接呼叫鈴' }; } }
    if (S.bladder > 15) { const d = Math.hypot(p.x - REST.toiletAt[0], p.z - REST.toiletAt[1]); if (d < 0.9 && d < bd) { bd = d; best = { kind: 'toilet', key: 'E', label: '上廁所' }; } }
    {
      const [x0, z0, x1, z1] = REST.sofa, d = Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(z0 - p.z, 0, p.z - z1));
      if (d < 0.95 && d < bd) { bd = d; best = { kind: 'sleep', key: 'E', label: '坐下喝水休息' }; }
    }
    if (!best) {
      let td = 1e9;
      for (const t of TALKERS) {
        if (!t.obj.visible) continue;
        const d = Math.hypot(p.x - t.obj.position.x, p.z - t.obj.position.z);
        if (d < t.reach && d < td) { td = d; best = { kind: 'chat', key: 'E', label: `跟${CHATTER[t.key].name}聊聊`, talker: t }; }
      }
    }
    return best;
  }
  function act() {
    if (!S.started || S.ended) return;
    if (S.mode === 'walk') {
      const n = nearest(); if (!n) return;
      if (n.kind === 'bed') openBedside(n.i);
      else if (n.kind === 'bell') openBell();
      else if (n.kind === 'sleep') startSleep();
      else if (n.kind === 'toilet') useToilet();
      else if (n.kind === 'chat') openChat(n.talker);
      return;
    }
    if (S.mode === 'bell') { const b = $('bellOpts').querySelector('[data-go]'); if (b) b.click(); return; }
    if (S.mode === 'sleep') { stopSleep('自己醒來了。'); return; }
    if (S.mode === 'chat') closeChat();
  }

  // ---------- small talk ----------
  // E beside anyone on the ward. A line fits the hour and the nurse (worn out, bursting);
  // a gift (a coffee) is given once a night; lines do not repeat until all have been said.
  const DBACK = $('dBack').innerHTML, said = {};
  let talking = null;
  function openChat(t) {
    const who = CHATTER[t.key], id = t.id || t.key, name = t.name || who.name;
    const s = { evening: S.t < 2 * 60, night: S.t >= 2 * 60 && S.t < 5 * 60, dawn: S.t >= 5 * 60,
      hungry: false, tired: S.energy < 45, needLoo: S.bladder >= 70 };
    S.gifts = S.gifts || {};
    const heard = (said[id] = said[id] || new Set());
    let fit = who.lines.map((l, i) => [l, i]).filter(([l]) => (!l.when || l.when(s)) && !(l.gift && S.gifts[id]));
    if (!fit.length) fit = [[who.lines[0], 0]];
    if (fit.every(([, i]) => heard.has(i))) fit.forEach(([, i]) => heard.delete(i));
    const fresh = fit.filter(([, i]) => !heard.has(i)), first = fresh.filter(([l]) => l.pri);
    const [line, i] = pickN(first.length ? first : fresh, 1)[0];
    heard.add(i);
    talking = t; S.mode = 'chat'; prompt.hidden = true; keys.clear();
    // a walker stops and turns to the nurse; the nurse turns to them
    const o = t.obj, p = player.position;
    if (t.walker) { t.walker.wait = 1e9; o.rotation.y = Math.atan2(p.x - o.position.x, p.z - o.position.z); }
    player.rotation.y = Math.atan2(o.position.x - p.x, o.position.z - p.z);
    $('dPortrait').closest('figure').hidden = !who.faces.length;
    if (who.faces.length) $('dPortrait').src = IMG(pickN(who.faces, 1)[0]);
    $('dSpeaker').textContent = `${who.role} ${name}`;
    $('dLine').textContent = line.text;
    $('dMe').src = ME(S.energy < 45 ? 'sleepy' : 'neutral');
    $('dBack').innerHTML = '嗯，謝謝 <span class="key">E</span>';
    $('dialog').hidden = false;
    const g = line.gift;
    if (g) {
      S.gifts[id] = true;
      S.energy = Math.min(100, S.energy + (g.energy || 0)); S.bladder = Math.min(100, S.bladder + (g.bladder || 0));
      toast(g.toast, 3.5, who.faces[0]);
    }
  }
  function closeChat() {
    $('dialog').hidden = true; $('dPortrait').closest('figure').hidden = false; $('dBack').innerHTML = DBACK;
    if (talking?.walker) talking.walker.wait = 0.6 + Math.random();
    talking = null; S.mode = 'walk'; S.t += 2; frame.focus();
  }
  $('dBack').addEventListener('click', closeChat);

  // ---------- the toilet ----------
  function useToilet() {
    S.mode = 'toilet'; prompt.hidden = true; player.visible = false;
    toast('上廁所中……', 2);
    setTimeout(() => {
      if (S.mode !== 'toilet') return;
      S.bladder = 0; S.mode = 'walk'; player.visible = true;
      place(player, ...REST.toiletOut, Math.PI);
      toast('上完廁所，舒服多了。', 2.5);
    }, 2200);
  }

  // ---------- resting on the sofa ----------
  function startSleep() {
    S.mode = 'sleep'; prompt.hidden = true;
    place(player, ...REST.wake, 0); player.visible = false;
    sleepers[S.pgy].visible = true;
    S.sleepStart = S.t; S.fullNoted = S.energy >= 100;
    $('sleepMe').src = ME('sleepy');
    $('sleep').hidden = false;
  }
  function stopSleep(msg) {
    S.mode = 'walk'; $('sleep').hidden = true;
    sleepers[S.pgy].visible = false;
    player.visible = true; place(player, ...REST.wake, 0);
    if (msg) toast(msg, 2.5);
  }

  // ---------- the bedside ----------
  // One level at one bed (levels.js): the patient, the monitor to tap, and the story's choices.
  // The strip is drawn by ecg.js from the rhythm the story has set.
  const ecg = createEcg($('ecgCv'));
  const BS = { i: -1, L: null, id: null, node: null, hearts: 3, order: null, rhythm: 'sinus', hr: 70, scored: new Set(), cpr: null, canClose: true };
  // A screen that appears under a finger still tapping (the compressions, say) takes no taps for a
  // moment: on Android the next tap landed on a choice the player had not read yet.
  const holds = new WeakMap();
  const held = el => performance.now() < (holds.get(el) || 0);
  function holdTaps(el, ms) {
    holds.set(el, performance.now() + ms);
    el.classList.add('arming');
    setTimeout(() => { if (!held(el)) el.classList.remove('arming'); }, ms + 20);
  }
  // a bed with its patient: sitting up with a phone, or lying down
  function patientSvg(kind) {
    const sit = kind === 'sit';
    return `<svg viewBox="0 0 420 200" role="img" aria-label="${sit ? '坐在病床上滑手機的病人' : '躺在病床上的病人'}">
      <rect x="20" y="132" width="380" height="16" rx="8" fill="#c4ccd3"/><rect x="34" y="148" width="10" height="30" fill="#8a949d"/><rect x="376" y="148" width="10" height="30" fill="#8a949d"/>
      <rect x="14" y="70" width="12" height="82" rx="5" fill="#e6e9ec"/><rect x="394" y="96" width="12" height="56" rx="5" fill="#e6e9ec"/>
      <rect x="30" y="112" width="360" height="26" rx="12" fill="#e7efea"/>
      ${sit
        ? `<ellipse cx="86" cy="104" rx="46" ry="14" fill="#eef2f5"/><rect x="74" y="52" width="64" height="62" rx="26" fill="#d9ebe7"/><circle cx="98" cy="38" r="22" fill="#efc7aa"/><path d="M76 34 a22 22 0 0 1 44 0 a30 14 0 0 0 -44 0z" fill="#d6d6d6"/>
           <rect x="138" y="70" width="30" height="46" rx="6" fill="#2b3138" transform="rotate(18 150 90)"/><rect x="142" y="74" width="22" height="36" rx="3" fill="#7fd0ff" transform="rotate(18 150 90)"/><rect x="118" y="92" width="48" height="12" rx="6" fill="#efc7aa"/>
           <path d="M120 112 L390 112 L390 134 L120 134 Z" fill="#f2f5f7"/><path d="M120 120 h270 M120 128 h270" stroke="#7fa7c9" stroke-width="3"/>`
        : `<ellipse cx="82" cy="104" rx="52" ry="12" fill="#eef2f5"/><circle cx="82" cy="92" r="22" fill="#efc7aa"/><path d="M60 88 a22 22 0 0 1 44 0 a30 12 0 0 0 -44 0z" fill="#d6d6d6"/><rect x="104" y="88" width="280" height="46" rx="20" fill="#f2f5f7"/><path d="M110 104 h270 M110 116 h270 M110 128 h270" stroke="#7fa7c9" stroke-width="3"/>`}
    </svg>`;
  }
  const monitorSvg = `<svg viewBox="0 0 150 230" aria-hidden="true">
    <rect x="30" y="8" width="90" height="70" rx="8" fill="#39424b"/><rect x="38" y="16" width="74" height="50" rx="4" fill="#03060a"/>
    <path class="mon-line" d="M42 42 h10 l4 -16 l5 30 l5 -14 h8 l4 -8 l4 8 h14" fill="none" stroke="#53ff8e" stroke-width="2.4" stroke-linejoin="round"/>
    <rect x="72" y="78" width="6" height="92" fill="#7d8791"/><rect x="42" y="104" width="66" height="30" rx="3" fill="none" stroke="#9aa4ae" stroke-width="3"/>
    <path d="M75 170 L40 214 M75 170 L110 214 M75 170 L75 218" stroke="#7d8791" stroke-width="6" stroke-linecap="round"/>
    <circle cx="40" cy="218" r="6" fill="#39424b"/><circle cx="110" cy="218" r="6" fill="#39424b"/><circle cx="75" cy="222" r="6" fill="#39424b"/>
  </svg>`;
  $('bsMonitor').insertAdjacentHTML('afterbegin', monitorSvg);

  function openBedside(i) {
    const L = LEVELS[i], l = LV[i];
    l.tries++;
    if (l.tries > 1) { l.hearts = 3; S.stats.redo++; }
    Object.assign(BS, { i, L, hearts: l.hearts, rhythm: L.ecg0, hr: L.hr0 || 76, scored: new Set(), cpr: null, order: null });
    S.mode = 'bed'; prompt.hidden = true; keys.clear();
    document.body.classList.add('at-bedside');
    place(player, ...SPOT.approach(BED[levelBed(i)]), Math.PI);
    $('bsRoom').textContent = `Room ${L.n} · ${L.bed}`;
    $('bsPatient').innerHTML = patientSvg(L.patient);
    $('result').hidden = true; $('ecgm').hidden = true; $('flowm').hidden = true;
    $('bedside').hidden = false;
    goTo(L.start);
    frame.focus();
  }
  function goTo(id) {
    const n = BS.L.nodes[id];
    BS.id = id; BS.node = n; BS.order = null;
    if (n.ecg) { BS.rhythm = n.ecg; if (n.hr) BS.hr = n.hr; }
    renderNode();
  }
  const SAY = /^(護理師|病人|學姊|家屬)「/;
  function renderHearts() {
    $('bsHearts').innerHTML = Array.from({ length: 3 }, (_, k) => `<i class="${k < BS.hearts ? 'on' : ''}">♥</i>`).join('');
    $('bsHearts').setAttribute('aria-label', `剩下 ${BS.hearts} 顆心`);
  }
  function renderNode() {
    const n = BS.node;
    renderHearts();
    $('bsSenior').hidden = !n.senior;
    if (n.senior) $('bsSeniorImg').src = IMG(n.senior === 'cry' ? 'nurse_shocked' : 'nurse_stern');
    $('bsText').innerHTML = asLines(n.t).map(t => `<p class="${SAY.test(t) ? 'say' : ''}">${esc(t)}</p>`).join('');
    $('bsVitals').hidden = !n.vitals;
    if (n.vitals) $('bsVitals').innerHTML = `<div><small>血壓</small><b>${esc(n.vitals.bp)}</b><em>mmHg</em></div><div><small>心跳</small><b>${n.vitals.hr}</b><em>bpm</em></div>`;
    $('bsMonitor').classList.toggle('call', !!n.monitor);
    $('pcCpr').hidden = !n.cpr;
    $('bsOpts').innerHTML = '';
    if (n.end) { showResult(n); return; }
    if (n.monitor) { $('bsOpts').innerHTML = '<p class="bs-hint">👈 點一下左邊的<b>監視器</b>，看看心電圖</p>'; return; }
    if (n.cpr) { startCpr(); return; }
    if (n.opts) {
      if (!BS.order) BS.order = pickN(n.opts.map((o, k) => k), n.opts.length);
      $('bsOpts').innerHTML = BS.order.map((k, pos) => `<button class="btn bs-opt" type="button" data-pos="${pos}"><span class="key">${pos + 1}</span><span>${esc(n.opts[k].t)}</span></button>`).join('');
      return;
    }
    if (n.next) $('bsOpts').innerHTML = '<button class="btn go bs-opt" type="button" data-next="1">繼續 <span class="key">Enter</span></button>';
  }
  function loseHeart(k) {
    BS.hearts = Math.max(0, BS.hearts - k); LV[BS.i].hearts = BS.hearts;
    renderHearts();
    const h = $('bsHearts'); h.classList.remove('hit'); void h.offsetWidth; h.classList.add('hit');
  }
  function chooseOpt(pos) {
    if (S.mode !== 'bed' || BS.cpr || BS.node.end || !BS.node.opts || held($('bsOpts')) || !$('ecgm').hidden) return;
    const n = BS.node, o = n.opts[BS.order?.[pos]]; if (!o) return;
    // the one thing this game scores: reading a strip, on the first try
    if (n.quiz === 'read' && !BS.scored.has(BS.id)) { BS.scored.add(BS.id); S.quiz.read.total++; if (!o.cost) S.quiz.read.right++; }
    if (o.cost) loseHeart(o.cost);
    if (BS.hearts <= 0) {
      const tgt = BS.L.nodes[o.to];
      // the choice that took the last heart: if it leads to an ending, play it; otherwise the patient is lost
      if (tgt?.end && tgt.end !== 'win') { goTo(o.to); return; }
      showResult({ end: 'dead', t: '三顆心都用完了。病人的狀況繼續惡化……' });
      return;
    }
    goTo(o.to);
  }
  $('bsOpts').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.next) { if (!held($('bsOpts'))) goTo(BS.node.next); }
    else chooseOpt(Number(b.dataset.pos));
  });

  // the monitor: tap it to watch the strip; when the story asked for it, closing it goes on
  let ecgTimer = 0;
  function openEcg() {
    if (S.mode !== 'bed' || BS.node.end || !$('result').hidden) return;
    const must = !!BS.node.monitor;
    $('ecgm').hidden = false;
    $('ecgTitle').textContent = `Room ${BS.L.n} · ${BS.L.bed} 的心電圖（II 導程）`;
    ecg.set(BS.rhythm, BS.hr); ecg.start();
    BS.canClose = !must;
    $('ecgClose').disabled = !BS.canClose;
    $('ecgClose').textContent = BS.canClose ? '✕ 關閉' : '再看一下…';
    const bar = $('ecgBar'); bar.classList.remove('run'); void bar.offsetWidth; bar.hidden = BS.canClose; if (!BS.canClose) bar.classList.add('run');
    clearTimeout(ecgTimer);
    if (!BS.canClose) ecgTimer = setTimeout(() => { BS.canClose = true; $('ecgClose').disabled = false; $('ecgClose').textContent = '✕ 看完了，關閉'; $('ecgClose').focus(); }, 4800);
  }
  function closeEcg() {
    if ($('ecgm').hidden || !BS.canClose) return;
    clearTimeout(ecgTimer);
    $('ecgm').hidden = true; ecg.stop(); frame.focus();
    if (BS.node.monitor && !BS.node.end) goTo(BS.node.next);
  }
  $('bsMonitor').addEventListener('click', openEcg);
  $('ecgClose').addEventListener('click', closeEcg);
  $('bsFlow').addEventListener('click', () => { $('flowm').hidden = false; });
  $('flowClose').addEventListener('click', () => { $('flowm').hidden = true; frame.focus(); });
  $('bsPause').addEventListener('click', () => setPaused(true));

  // chest compressions to the beat (levels 8 and 9): judged on the middle presses, so a hesitant start is forgiven
  function startCpr() {
    if (BS.cpr) clearInterval(BS.cpr.timer);
    BS.cpr = { times: [], timer: setInterval(() => {
      const cp = BS.cpr; if (!cp || S.paused || !cp.times.length) return;
      if (performance.now() - cp.times[cp.times.length - 1] > CPR.maxGap * 1000) cprFail('壓胸中斷太久了。CPR 一旦開始就盡量不要停。');
    }, 200) };
    $('pcCpr').hidden = false;
    $('pcCount').textContent = `0 / ${CPR.presses}`; $('pcRate').textContent = '準備好就開始按';
  }
  function cprFail(reason) {
    if (BS.cpr) clearInterval(BS.cpr.timer);
    BS.cpr = null;
    loseHeart(1);
    if (BS.hearts <= 0) { showResult({ end: 'dead', t: `${reason}三顆心都用完了，病人沒有救回來。` }); return; }
    toast(`${reason}再來一次！`, 3.5);
    startCpr();
  }
  function cprPress() {
    const cp = BS.cpr; if (!cp || S.paused) return;
    cp.times.push(performance.now());
    const press = $('pcPress'); press.classList.remove('hit'); void press.offsetWidth; press.classList.add('hit');
    const gaps = cp.times.slice(1).map((t, i) => t - cp.times[i]), recent = gaps.slice(-4);
    const rate = recent.length ? Math.round(60000 / (recent.reduce((a, b) => a + b, 0) / recent.length)) : 0;
    $('pcCount').textContent = `${cp.times.length} / ${CPR.presses}`;
    $('pcRate').textContent = rate ? `每分鐘 ${rate} 下 · ${rate < 100 ? '太慢' : rate > 120 ? '太快' : '剛好'}` : '';
    if (cp.times.length < CPR.presses) return;
    clearInterval(cp.timer);
    const middle = gaps.slice(2).sort((a, b) => a - b), bpm = Math.round(60000 / middle[Math.floor(middle.length / 2)]);
    BS.cpr = null;
    if (bpm < CPR.slowest) { cprFail(`壓胸太慢了（每分鐘大約 ${bpm} 下），血液送不到腦部。要壓每分鐘 100 到 120 下。`); return; }
    if (bpm > CPR.fastest) { cprFail(`壓胸太快了（每分鐘大約 ${bpm} 下），心臟來不及回血。要壓每分鐘 100 到 120 下。`); return; }
    S.t += 2;
    $('pcCpr').hidden = true;
    toast(`壓胸 ${CPR.presses} 下（每分鐘約 ${bpm} 下）。同事和急救小組接手了！`, 3.5);
    goTo(BS.node.next);
    holdTaps($('bsOpts'), 1200);
  }
  $('pcPress').addEventListener('pointerdown', e => { e.preventDefault(); cprPress(); });

  // ---------- the end of a level ----------
  const KIND = {
    win: ['VICTORY', '#e6b422'], fail: ['這一關沒有過', '#d98a2b'], dead: ['病人沒有救回來', '#cf2027'], you: ['學員淘汰', '#cf2027'],
  };
  function showResult(n) {
    if (BS.cpr) { clearInterval(BS.cpr.timer); BS.cpr = null; }
    $('pcCpr').hidden = true; $('bsOpts').innerHTML = '';
    const L = BS.L, l = LV[BS.i];
    const kind = n.end === 'win' && BS.hearts < 1 ? 'dead' : n.end;
    let coinNote = '';
    if (kind === 'win') {
      l.state = 'win'; l.hearts = BS.hearts; l.flashUntil = performance.now() + 2500;
      if (!l.coin) { l.coin = true; S.coins++; coinNote = '獲得 1 枚金幣 🪙'; } else coinNote = '這一關的金幣已經拿過了';
    } else S.stats.lost++;
    $('result').className = `gmodal result ${kind}`;
    $('rsKind').textContent = KIND[kind][0];
    $('rsSub').textContent = kind === 'win' ? `剩下 ${hearts(BS.hearts)} · ${coinNote}` : kind === 'fail' ? '病人還沒有穩定，這間病房還沒完成' : `Room ${L.n} · ${L.bed}`;
    $('rsFig').src = kind === 'win' ? ME('survived') : kind === 'fail' ? ME('nervous') : ME('scolded');
    $('rsText').innerHTML = asLines(n.t).map(t => `<p>${esc(t)}</p>`).join('');
    $('rsSbar').hidden = !(kind === 'win' && L.sbar);
    if (kind === 'win' && L.sbar) $('rsSbar').innerHTML = `<b>通報醫師的 SBAR 範例</b><dl>${SBAR_KEYS.map(([k, name]) => `<dt>${k}<small>${name}</small></dt><dd>${esc(L.sbar[k])}</dd>`).join('')}</dl>`;
    $('rsCard').innerHTML = `<b>${esc(L.card.title)}</b><ol>${L.card.points.map(p => `<li>${esc(p)}</li>`).join('')}</ol>`;
    $('rsBtns').innerHTML = kind === 'win'
      ? '<button class="btn go" type="button" data-act="back">回護理站 <span class="key">Enter</span></button>'
      : '<button class="btn go" type="button" data-act="retry">重來這一關 <span class="key">Enter</span></button><button class="btn" type="button" data-act="back">回護理站</button>';
    $('result').hidden = false;
    holdTaps($('rsBtns'), 1300);
    renderHud();
    setTimeout(() => $('rsBtns').querySelector('button')?.focus(), 60);
  }
  $('rsBtns').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || held($('rsBtns'))) return;
    if (b.dataset.act === 'retry') openBedside(BS.i); else closeBedside();
  });
  function closeBedside() {
    const i = BS.i, l = LV[i], bed = levelBed(i);
    $('bedside').hidden = true; $('result').hidden = true; $('ecgm').hidden = true; $('flowm').hidden = true;
    document.body.classList.remove('at-bedside');
    ecg.stop(); clearTimeout(ecgTimer);
    S.mode = 'walk'; place(player, ...SPOT.leave(BED[bed]), Math.PI / 2);
    frame.focus();
    if (l.state === 'win') {
      lamps[bed].material = lampOff;
      if (monitors[bed]) { monitors[bed].material.map = TEX[bed][1]; monitors[bed].material.needsUpdate = true; }
      toast(`Room ${LEVELS[i].n} 完成！${doneCount() < LEVELS.length ? '回護理站等下一個呼叫鈴。' : ''}`, 3.5);
    } else toast('這間病房還沒完成：走回床邊再按 <b>E</b>，重新處理。', 4);
    // after any attempt, the next bell is on its way
    if (S.nextBellAt === Infinity && S.ringing == null) scheduleBell();
    if (doneCount() === LEVELS.length) setTimeout(() => endShift(), 2200);
  }

  // ---------- the summary ----------
  function selfCare() {
    const lines = S.looFull ? ['夜班護理師常常一忙就憋尿，憋久了容易泌尿道感染、腎結石。再忙，也要記得上廁所。'] : [];
    return lines.length ? '<li class="tiphead">照顧自己</li>' + lines.map(t => `<li class="tip">${esc(t)}</li>`).join('') : '';
  }
  function endShift() {
    if (S.ended) return;
    S.ended = true; S.mode = 'end';
    ['bedside', 'result', 'ecgm', 'flowm', 'dialog', 'sleep', 'bell'].forEach(id => { $(id).hidden = true; });
    document.body.classList.remove('at-bedside');
    ecg.stop();
    const total = LEVELS.length, done = doneCount(), qz = S.quiz.read;
    document.querySelector('#handover .mark').textContent = `${GAME.title} · ${GAME.edition}`;
    $('hStamp').hidden = true;
    $('hWhen').textContent = `${fmt(S.t)} · ${S.collapsed ? '累倒了' : done === total ? '全部完成' : S.timeUp ? '08:00 交班時間到' : '提早交班'}`;
    $('hTitle').textContent = (S.nick ? `${S.nick}護理師，` : '') + (S.collapsed ? '你累倒了' : done === total ? '九間病房都穩住了' : done ? `完成了 ${done} 間病房` : '今晚先到這裡');
    $('hStats').innerHTML = [
      ['金幣', S.coins, `/ ${total}`], ['完成的病房', done, `/ ${total}`], ['心電圖一次判讀對', qz.right, `/ ${qz.total} 題`],
      ['從這一關重來', S.stats.redo, '次'], ['沒過的關卡', S.stats.lost, '次'], ['休息了', Math.round(S.stats.sleptMin), '分鐘'],
    ].map(([k, v, u]) => `<div class="stat"><small>${k}</small><b>${v}<span>${u}</span></b></div>`).join('');
    $('hCases').innerHTML = LEVELS.map((L, i) => `<li class="tip${LV[i].state === 'win' ? '' : ' miss'}"><b>Room ${L.n} · ${L.bed}</b> ${esc(L.name)}　${LV[i].state === 'win' ? `✓ ${hearts(LV[i].hearts)}` : LV[i].tries ? '⚠ 還沒完成' : '— 沒有處理到'}</li>`).join('')
      + LEVELS.filter((L, i) => LV[i].tries).map(L => `<li class="tiphead">${esc(L.card.title)}</li>` + L.card.points.map(p => `<li class="tip">${esc(p)}</li>`).join('')).join('')
      + selfCare();
    $('hScore').textContent = qz.total ? Math.round(qz.right / qz.total * 100) : 0;
    $('hPgy').src = ME(done === total && !S.collapsed ? 'survived' : 'sleepy');
    $('hBadge').textContent = `稱號：${S.collapsed ? '累倒在護理站的夜班護理師' : done === total && !S.stats.redo ? '心電圖判讀小達人' : done === total ? '跌倒了再站起來的護理師' : S.coins >= 5 ? '穩穩的夜班帶組護理師' : '正在成長的新進護理師'}`;
    $('hChiefAvatar').style.backgroundImage = `url(${IMG('nurse_caring')})`;
    $('hChief').textContent = S.collapsed
      ? '你趴在護理站睡著了，怎麼叫都叫不醒，只好請組長來接手整層樓。夜班再忙，也要找空檔躺一下：照顧好自己，才照顧得了病人。'
      : '警報響了，先看病人、再看波形：意識、脈搏、導線、貼片、生命徵象，最後通報醫師。這一套流程，是夜班最重要的功夫。';
    S.result = `我在《${GAME.title}》${GAME.edition}拿到 ${S.coins}/${total} 枚金幣，心電圖一次判讀對 ${qz.right}/${qz.total} 題${S.collapsed ? `，${fmt(S.t)} 累倒了` : ''}。`;
    $('handover').hidden = false;
  }
  // ---------- sharing the night ----------
  // The summary on screen, redrawn as a story-sized card (1080×1920). A phone opens its share sheet
  // with it -- Instagram and Facebook offer their stories there; the web cannot post a story itself --
  // and a computer saves the picture instead.
  const shareUrl = () => `${location.origin}${location.pathname}`;
  const summaryStats = () => [...$('hStats').querySelectorAll('.stat')].map(el => {
    const b = el.querySelector('b'), unit = b.querySelector('span')?.textContent || '';
    return [el.querySelector('small').textContent, b.textContent.slice(0, b.textContent.length - unit.length).trim(), unit.trim()];
  });
  function shareText() {
    const badge = $('hBadge').textContent;
    return [`🌙 ${GAME.title}｜${GAME.edition}`, $('hWhen').textContent, $('hTitle').textContent,
      ...summaryStats().map(([k, v, u]) => `・${k} ${v}${u ? ` ${u}` : ''}`),
      badge, `你能拿幾枚金幣？👉 ${shareUrl()}`, CREDIT.text].join('\n');
  }
  // text that wraps by character, as Chinese does
  function wrapText(g, text, width) {
    const lines = []; let line = '';
    for (const ch of text) { if (g.measureText(line + ch).width > width && line) { lines.push(line); line = ch; } else line += ch; }
    if (line) lines.push(line);
    return lines;
  }
  function pill(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // 大爛班's stamp, upright on a canvas of its own: two rings and the name, in ink worn like
  // rubber (the same specks every time). The summary turns it with CSS; the share card turns it
  // as it draws it, in a brighter red for its dark background.
  function drawStamp(cv, color) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, r = rng(9);
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
    g.clearRect(0, 0, w, h);
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = 12; pill(g, 8, 8, w - 16, h - 16, 26); g.stroke();
    g.lineWidth = 4; pill(g, 26, 26, w - 52, h - 52, 14); g.stroke();
    g.font = `900 ${Math.round(h * 0.52)}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('大爛班', w / 2, h / 2 + h * 0.03);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 420; i++) { g.globalAlpha = 0.25 + r() * 0.6; g.beginPath(); g.arc(r() * w, r() * h, 0.6 + r() * 2.6, 0, Math.PI * 2); g.fill(); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    return cv;
  }
  async function drawShareCard() {
    const cv = $('shareCanvas'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a1220'); bg.addColorStop(0.6, '#151c2f'); bg.addColorStop(1, '#2b1830');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, 560, 40, W / 2, 560, 560); glow.addColorStop(0, 'rgba(69, 227, 204, .22)'); glow.addColorStop(1, 'rgba(69, 227, 204, 0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, 1150);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#45e3cc'; g.font = `700 36px ${font}`; g.fillText(`${GAME.edition}`, W / 2, 118);
    g.fillStyle = '#eef3f6'; g.font = `900 100px ${font}`; g.fillText(GAME.title, W / 2, 228);
    // the nurse, as on the summary
    const px = 250, py = 280, pw = 580, ph = 600, img = new Image();
    img.src = $('hPgy').src;
    try { await img.decode(); } catch { /* drawn without the portrait */ }
    g.save(); pill(g, px, py, pw, ph, 40); g.clip();
    const pg = g.createLinearGradient(0, py, 0, py + ph); pg.addColorStop(0, '#2a3e55'); pg.addColorStop(1, '#152131'); g.fillStyle = pg; g.fillRect(px, py, pw, ph);
    if (img.naturalWidth) { const k = Math.max(pw / img.naturalWidth, ph / img.naturalHeight); g.drawImage(img, px + (pw - img.naturalWidth * k) / 2, py, img.naturalWidth * k, img.naturalHeight * k); }
    g.restore();
    g.fillStyle = '#f0b45a'; g.font = `700 42px ${font}`; g.fillText($('hWhen').textContent, W / 2, 962);
    g.fillStyle = '#ffffff'; g.font = `900 66px ${font}`;
    let y = 1052;
    for (const line of wrapText(g, $('hTitle').textContent, 960).slice(0, 3)) { g.fillText(line, W / 2, y); y += 84; }
    const badge = $('hBadge').textContent.replace(/^稱號：/, '');
    g.font = `700 38px ${font}`;
    const bw = Math.min(980, g.measureText(badge).width + 84);
    y += 6; pill(g, (W - bw) / 2, y - 50, bw, 72, 36);
    g.fillStyle = 'rgba(69, 227, 204, .15)'; g.fill(); g.strokeStyle = 'rgba(69, 227, 204, .6)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#c4f6ee'; g.fillText(badge, W / 2, y); y += 96;
    const stats = summaryStats(), cols = stats.length > 6 ? 3 : 2, cw = 960 / cols;
    stats.forEach(([k, v, u], i) => {
      const cx = 60 + cw * (i % cols) + cw / 2, cy = y + Math.floor(i / cols) * 128;
      g.fillStyle = '#8fa3b6'; g.font = `600 32px ${font}`; g.fillText(k, cx, cy);
      g.font = `800 62px ${font}`; const vw = g.measureText(v).width; g.font = `600 30px ${font}`; const uw = u ? g.measureText(u).width + 10 : 0;
      g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = `800 62px ${font}`; g.fillText(v, cx - (vw + uw) / 2, cy + 70);
      if (u) { g.fillStyle = '#8fa3b6'; g.font = `600 30px ${font}`; g.fillText(u, cx - (vw + uw) / 2 + vw + 10, cy + 70); }
      g.textAlign = 'center';
    });
    // 大爛班: the summary's stamp, slanted, in the room under the numbers (and short of the
    // closing line however many lines the title took)
    if (false) {
      const stamp = drawStamp(Object.assign(document.createElement('canvas'), { width: 460, height: 200 }), '#ff4a50');
      const below = y + Math.ceil(stats.length / cols) * 128 - 10;
      g.save(); g.translate(W / 2 + 70, Math.min(below, H - 290)); g.rotate(-12 * Math.PI / 180); g.globalAlpha = 0.92;
      g.drawImage(stamp, -184, -80, 368, 160); g.restore();
    }
    g.fillStyle = '#eef3f6'; g.font = `800 46px ${font}`; g.fillText('你能拿幾枚金幣？', W / 2, H - 150);
    g.fillStyle = '#45e3cc'; g.font = `700 38px ${font}`; g.fillText(GAME.site, W / 2, H - 92);
    // the credit line the license asks for (README.md, 授權)
    g.fillStyle = '#8fa3b6'; g.font = `500 26px ${font}`; g.fillText(CREDIT.text, W / 2, H - 46);
  }
  let shareFile = null;
  async function openShare() {
    $('share').hidden = false; $('shareGo').hidden = true; $('shareHint').textContent = '圖卡產生中……';
    await drawShareCard();
    shareFile = null;
    $('shareCanvas').toBlob(b => {
      shareFile = b && new File([b], `${GAME.title}.png`, { type: 'image/png' });
      const can = !!shareFile && !!navigator.canShare?.({ files: [shareFile] });
      $('shareGo').hidden = !can;
      $('shareHint').textContent = can ? '按「分享」，選 Instagram 或 Facebook，就能發到限時動態。'
        : '這台裝置沒有分享選單：先下載圖片，再從手機相簿分享到限時動態。';
      (can ? $('shareGo') : $('shareSave')).focus();
    }, 'image/png');
  }
  // the share sheet opens straight from the tap, with the picture made beforehand
  $('shareGo').addEventListener('click', () => { if (shareFile) navigator.share({ files: [shareFile], title: GAME.title, text: shareText() }).catch(() => {}); });
  $('shareSave').addEventListener('click', () => $('shareCanvas').toBlob(b => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${GAME.title}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png'));
  $('shareClose').addEventListener('click', () => { $('share').hidden = true; });
  $('hShare').addEventListener('click', openShare);
  $('btnEnd').addEventListener('click', () => { if (S.started) endShift(); });
  $('btnMap').addEventListener('click', () => { S.map = !S.map; frame.focus(); });


  // ---------- start ----------
  // only the nickname is kept, in this browser
  const KEYS = { name: 'dingdingding_ecg_name' };
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: nothing is kept */ } },
  };
  $('gName').value = store.get(KEYS.name);
  // the credit line on the start card and the summary (README.md, 授權)
  document.querySelectorAll('.credit').forEach(el => el.replaceChildren(`${CREDIT.text} · `,
    Object.assign(document.createElement('a'), { href: CREDIT.url, target: '_blank', rel: 'noopener', textContent: new URL(CREDIT.url).host })));
  const startHint = (text, err = false) => { $('gHint').hidden = false; $('gHint').textContent = text; $('gHint').classList.toggle('err', err); };
  $('gName').addEventListener('input', () => {
    if (!$('gName').value.trim() || !$('gName').hasAttribute('aria-invalid')) return;
    $('gName').removeAttribute('aria-invalid'); $('gHint').classList.remove('err'); $('gHint').hidden = true;
  });
  document.querySelectorAll('.pick [data-pgy]').forEach(b => b.addEventListener('click', () => {
    if (!$('gName').value.trim()) {
      startHint('請先輸入暱稱，才能開始值班。', true);
      $('gName').setAttribute('aria-invalid', 'true'); $('gName').focus(); return;
    }
    goSideways();
    document.querySelectorAll('.pick button').forEach(x => { x.disabled = true; });
    S.nick = $('gName').value.trim().slice(0, 40);
    store.set(KEYS.name, S.nick);
    const k = b.dataset.pgy;
    S.pgy = k;
    players.m.visible = k === 'm'; players.f.visible = k === 'f';
    player = players[k];
    $('start').hidden = true;
    showBrief();
  }));

  // ---------- the handover ----------
  // the standard procedure, and how to play; time starts only when the player says they are ready
  function showBrief() {
    $('briefTitle').textContent = `今晚，${WARD} 病房交給你了`;
    $('briefMe').src = ME('confident');
    $('briefLevel').textContent = `${S.nick ? `${S.nick}護理師` : '你'} · 今晚的帶組護理師，手上有 12 床`;
    $('briefFlow').innerHTML = `<h3>${esc(FLOW.title)}</h3><ol>${FLOW.steps.map(s => `<li><b>${esc(s.t)}</b>${s.yes ? `<small>${esc(s.yes)}</small>` : ''}${s.no ? `<small>${esc(s.no)}</small>` : ''}</li>`).join('')}</ol>`;
    $('flowBody').innerHTML = $('briefFlow').innerHTML;
    $('brief').hidden = false;
    setTimeout(() => $('briefGo').focus(), 60);
  }
  function beginShift() {
    if ($('brief').hidden) return;
    $('brief').hidden = true;
    S.started = true; frame.focus();
    preload();
    toast(`${fmt(S.t)} 接班，${WARD} 病房交給你了。先在護理站附近等呼叫鈴吧。`, 5);
  }
  $('briefGo').addEventListener('click', beginShift);
  $('hudWard').textContent = `${WARD} 病房 · 值班`;
  // on a touch screen the controls are the stick and the buttons on it, so say those instead of keys
  if (matchMedia('(pointer: coarse)').matches) {
    $('gKeys').innerHTML = '<dt><span class="key">搖桿</span></dt><dd>左下角：往任何方向滑就會走，推到底用跑的</dd>'
      + '<dt><span class="key">E</span></dt><dd>右下角：接呼叫鈴、處理病人、休息、上廁所（走近就會出現提示）</dd>'
      + '<dt><span class="key">床邊</span></dt><dd>直接點監視器和選項</dd>';
    document.querySelector('#brief .bkeys').innerHTML = '<div><span class="key">搖桿</span>走路，推到底跑</div><div><span class="key">E</span>接呼叫鈴、處理病人</div><div class="wide"><span class="key">床邊</span>點監視器、點選項；心跳停了，照節拍點「壓胸」</div>';
  }

  // ---------- input ----------
  const keys = new Set();
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const MOVE = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
  window.addEventListener('keydown', e => {
    if (typing(e)) { if (e.key === 'Escape') { e.target.blur(); frame.focus(); } return; }
    const k = e.key.toLowerCase();
    if (!$('share').hidden) { if (k === 'escape') { e.preventDefault(); $('share').hidden = true; } return; }
    if (S.ended && k === 's' && !e.repeat && !$('handover').hidden) { e.preventDefault(); openShare(); return; }
    if (S.paused) { if (['p', 'escape', 'enter', ' '].includes(k)) { e.preventDefault(); setPaused(false); } return; }
    if (k === 'p' && !e.repeat && S.started && !S.ended) { e.preventDefault(); setPaused(true); return; }
    if (!$('brief').hidden) { if (k === 'enter' || k === ' ') { e.preventDefault(); beginShift(); } return; }
    if (!S.started || S.ended) return;
    if (S.mode === 'bell') {
      if (/^[1-3]$/.test(k) && !e.repeat) { e.preventDefault(); if (!bellPhase.said && LEVELS[bellPhase.i].bell.options) { const b = $('bellOpts').querySelectorAll('button')[Number(k) - 1]; if (b) b.click(); } }
      else if ((k === 'e' || k === 'enter' || k === ' ') && !e.repeat) { e.preventDefault(); const b = $('bellOpts').querySelector('[data-go]'); if (b) b.click(); }
      return;
    }
    if (S.mode === 'bed') {
      e.preventDefault();
      if (!$('flowm').hidden) { if (['escape', 'enter', ' '].includes(k)) $('flowClose').click(); return; }
      if (!$('ecgm').hidden) { if (['escape', 'enter', ' ', 'e'].includes(k)) closeEcg(); return; }
      if (!$('result').hidden) { if ((k === 'enter' || k === ' ') && !e.repeat) $('rsBtns').querySelector('button')?.click(); return; }
      if (BS.cpr) { if ((k === 'c' || k === ' ') && !e.repeat) cprPress(); return; }
      if (/^[1-3]$/.test(k) && !e.repeat) chooseOpt(Number(k) - 1);
      else if ((k === 'enter' || k === ' ') && !e.repeat && BS.node?.next && !BS.node.monitor) $('bsOpts').querySelector('[data-next]')?.click();
      else if ((k === 'm' || k === 'e') && !e.repeat) openEcg();
      return;
    }
    if (MOVE.includes(k) || k === ' ') e.preventDefault();
    keys.add(k);
    if ((k === 'e' || k === ' ' || k === 'enter') && !e.repeat) act();
    if (k === 'm' && !e.repeat) S.map = !S.map;
    if (k === ']' && DEBUG) { S.t += 30; toast(`（測試）時間快轉到 ${fmt(S.t)}`, 1.5); }
    if (k === 'escape' && S.mode === 'chat') closeChat();
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  frame.addEventListener('pointerdown', e => { if (!e.target.closest('input, button, select')) frame.focus(); });
  // the thumb stick: x to the right, y up the screen, each -1..1; past STICK_RUN the nurse runs.
  // It floats: the thumb goes down anywhere in the lower-left corner and the ring centres under it,
  // kept whole inside the corner, so a big phone need not reach for one spot; let go and it drifts back.
  const stick = { x: 0, y: 0, mag: 0 }, STICK_DEAD = 0.2, STICK_RUN = 0.85;
  const stickZone = $('stickZone'), stickEl = $('stick'), knob = $('stickKnob');
  let centre = null;
  function stickAt(e) {
    const { x, y, R } = centre;
    let dx = (e.clientX - x) / R, dy = (y - e.clientY) / R;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    Object.assign(stick, { x: dx, y: dy, mag: Math.min(1, m) });
    knob.style.transform = `translate(${dx * R * 0.58}px, ${-dy * R * 0.58}px)`;
    stickEl.classList.toggle('run', stick.mag > STICK_RUN && S.energy >= TIRED);
  }
  // the thumb on the stick is followed by its pointer id; capture keeps it when it slides out of the corner
  let stickId = null;
  function stickOff() { stickId = null; Object.assign(stick, { x: 0, y: 0, mag: 0 }); knob.style.transform = stickEl.style.transform = ''; stickEl.classList.remove('on', 'run'); }
  stickZone.addEventListener('pointerdown', e => {
    e.preventDefault(); stickId = e.pointerId;
    try { stickZone.setPointerCapture(e.pointerId); } catch { /* the stick still follows this pointer */ }
    // offsetLeft/Top is where the ring rests, before any transform
    const z = stickZone.getBoundingClientRect(), R = stickEl.offsetWidth / 2;
    const cx = Math.min(Math.max(e.clientX - z.left, R), z.width - R), cy = Math.min(Math.max(e.clientY - z.top, R), z.height - R);
    centre = { x: z.left + cx, y: z.top + cy, R };
    stickEl.classList.add('on');
    stickEl.style.transform = `translate(${cx - R - stickEl.offsetLeft}px, ${cy - R - stickEl.offsetTop}px)`;
    stickAt(e);
  });
  stickZone.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickAt(e); });
  ['pointerup', 'pointercancel'].forEach(ev => stickZone.addEventListener(ev, e => { if (e.pointerId === stickId) stickOff(); }));
  stickZone.addEventListener('lostpointercapture', e => { if (e.pointerId === stickId) stickOff(); });
  // phones: put the page sideways where the browser allows it (Android, from a tap, in full
  // screen); elsewhere the cover in index.html asks for the phone to be turned, and turning it
  // upright mid-shift stops the clock
  const PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600;
  function goSideways() {
    if (!PHONE || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  const upright = matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 600px)');
  upright.addEventListener('change', () => { if (upright.matches) { stickOff(); setPaused(true); } });
  $('touchAct').addEventListener('click', act);

  // ---------- pause ----------
  // the whole shift stands still: the clock, the strip, the player's needs. Whatever was open
  // (the bedside, a bell) is still there on resume.
  let resumeFocus = null;
  function setPaused(on) {
    if (on === S.paused || (on && (!S.started || S.ended))) return;
    S.paused = on;
    ecg.hold(on);
    keys.clear();
    // chest compressions are timed in real time: a pause starts them over
    if (on && BS.cpr) { BS.cpr.times = []; $('pcCount').textContent = `0 / ${CPR.presses}`; $('pcRate').textContent = '暫停過了，從第一下重新開始壓'; }
    $('pause').hidden = !on;
    if (on) { resumeFocus = document.activeElement; $('pauseGo').focus(); }
    else (resumeFocus?.isConnected && resumeFocus !== document.body ? resumeFocus : frame).focus();
  }
  $('btnPause').addEventListener('click', () => setPaused(true));
  $('pauseGo').addEventListener('click', () => setPaused(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') setPaused(true); });
  // ---------- movement ----------
  // The player is a circle among the floor's boxes. It is a little slimmer than the shoulders
  // (0.3) so a 1 m door and a room's aisle leave room to spare; a nurse waiting at a bed's foot
  // stands in that aisle, so she is a small circle the player slides round, not a box.
  const R = 0.25, NURSE_R = 0.15;
  function collide(p) {
    for (let it = 0; it < 3; it++) {
      for (const b of solids) {
        const cx = Math.max(b[0], Math.min(p.x, b[2])), cz = Math.max(b[1], Math.min(p.z, b[3]));
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (R - d) / d; p.x += dx * k; p.z += dz * k; }
        else {
          const opts = [[b[0] - R - p.x, 0], [b[2] + R - p.x, 0], [0, b[1] - R - p.z], [0, b[3] + R - p.z]];
          opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
          p.x += opts[0][0]; p.z += opts[0][1];
        }
      }
      for (const n of Object.values(nurseByBed)) {
        if (!n.visible) continue;
        const dx = p.x - n.position.x, dz = p.z - n.position.z, d = Math.hypot(dx, dz), min = R + NURSE_R;
        if (d >= min) continue;
        if (d > 1e-6) { p.x += dx / d * (min - d); p.z += dz / d * (min - d); } else p.x += min;
      }
    }
    p.x = Math.max(XW + R, Math.min(XE - R, p.x)); p.z = Math.max(ZN + R, Math.min(ZS - R, p.z));
  }
  // Pressed into a wall a hand's width beside a door (or into the nurse, or a bed's corner), the
  // player used to stand pinned against the edge. When a step gets almost nowhere, feel to each
  // side, a short step at a time so the feeler cannot pass through a wall, for the nearest spot
  // with the way ahead open, and slide toward it. `slideSide` remembers the last choice so the
  // player does not flicker between two openings.
  let slideSide = 1;
  function walkStep(p, dir, d) {
    const x = p.x, z = p.z;
    p.x += dir.x * d; p.z += dir.z * d; collide(p);
    if (Math.hypot(p.x - x, p.z - z) > d * 0.3) return;
    const tx = -dir.z, tz = dir.x;
    let best = null;
    for (const s of [slideSide, -slideSide]) {
      const q = { x, z };
      for (let i = 1; i <= 8; i++) {
        const lx = q.x, lz = q.z;
        q.x += tx * s * 0.07; q.z += tz * s * 0.07; collide(q);
        if ((q.x - lx) * tx * s + (q.z - lz) * tz * s < 0.035) break;
        const f = { x: q.x + dir.x * 0.3, z: q.z + dir.z * 0.3 }; collide(f);
        if ((f.x - q.x) * dir.x + (f.z - q.z) * dir.z > 0.285) { if (!best || i < best.i) best = { i, s }; break; }
      }
    }
    if (!best) return;
    slideSide = best.s;
    p.x = x + tx * slideSide * d; p.z = z + tz * slideSide * d; collide(p);
  }
  const fwd = new THREE.Vector3(-Math.sin(YAW), 0, -Math.cos(YAW)), right = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
  let walkPhase = 0;
  function move(dt) {
    let ix = 0, iz = 0;
    if (keys.has('arrowup') || keys.has('w')) iz += 1;
    if (keys.has('arrowdown') || keys.has('s')) iz -= 1;
    if (keys.has('arrowright') || keys.has('d')) ix += 1;
    if (keys.has('arrowleft') || keys.has('a')) ix -= 1;
    const thumb = stick.mag > STICK_DEAD;
    if (thumb) { ix = stick.x; iz = stick.y; }
    const { legs, arms } = player.userData;
    if (S.mode !== 'walk' || (!ix && !iz)) {
      walkPhase = 0; legs.forEach(l => { l.rotation.x *= 0.7; }); arms.forEach(a => { a.rotation.x *= 0.7; });
      return;
    }
    const dir = new THREE.Vector3().addScaledVector(right, ix).addScaledVector(fwd, iz).normalize();
    // Shift, or the stick pushed to its rim, runs; under 20% there is nothing left to run on
    // (TIRED), and a short reminder says so
    const wantRun = keys.has('shift') || (thumb && stick.mag > STICK_RUN);
    const run = wantRun && S.energy >= TIRED;
    if (wantRun && !run && performance.now() > (S.noRunAt || 0)) { S.noRunAt = performance.now() + 8000; toast('精力不到 20%，跑不動了。', 2.5); }
    const speed = (run ? 4.6 : 2.9) * (S.energy < 15 ? 0.75 : 1) * 1.3;
    // a slow frame moves the full distance, in steps short enough that a wall cannot be skipped
    const steps = Math.ceil(dt / 0.04);
    for (let i = 0; i < steps; i++) walkStep(player.position, dir, speed * dt / steps);
    if (run) S.energy = Math.max(0, S.energy - dt * 0.4);
    const target = Math.atan2(dir.x, dir.z);
    let diff = target - player.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.rotation.y += diff * Math.min(1, dt * 14);
    walkPhase += dt * speed * 3.4;
    const sw = Math.sin(walkPhase) * 0.6;
    legs[0].rotation.x = sw; legs[1].rotation.x = -sw; arms[0].rotation.x = -sw * 0.7; arms[1].rotation.x = sw * 0.7;
  }

  // ---------- loop ----------
  function updateMarks() {
    const n = nearest(), now = performance.now(), asleep = S.mode === 'sleep';
    for (const l of LV) {
      const el = markFor(l.i), edge = edges[l.i];
      const live = l.state === 'ring' || l.state === 'go';
      el.hidden = asleep || S.mode === 'bed' || !(live || now < (l.flashUntil || 0));
      if (el.hidden) { edge.hidden = true; continue; }
      if (live) {
        el.className = 'mk red';
        el.querySelector('.bang').textContent = '!';
        el.querySelector('.lbl').textContent = l.state === 'ring' ? '呼叫鈴' : LEVELS[l.i].bed;
      } else { el.className = 'mk done'; el.querySelector('.bang').textContent = '✓'; el.querySelector('.lbl').textContent = ''; }
      const v = project(markTarget(l.i));
      setPos(el, v);
      const off = Math.abs(v.x) > 0.94 || Math.abs(v.y) > 0.9;
      edge.hidden = !(off && live && S.mode === 'walk');
      if (!edge.hidden) {
        const s = Math.max(Math.abs(v.x) / 0.84, v.y > 0 ? v.y / 0.76 : -v.y / 0.62);
        edge.style.left = `${((v.x / s + 1) / 2 * 100).toFixed(2)}%`; edge.style.top = `${((1 - v.y / s) / 2 * 100).toFixed(2)}%`;
        edge.querySelector('i').style.setProperty('--a', `${Math.atan2(-v.y, v.x)}rad`);
        edge.querySelector('span').textContent = l.state === 'ring' ? '呼叫鈴' : LEVELS[l.i].bed;
      }
    }
    const p = player.position, busy = new Set(pending().map(l => levelBed(l.i)));
    // bed labels only inside the room the player stands in; room numbers by the doors
    bedTags.forEach(({ b, el }) => {
      const r = b.room, inside = p.x > r.x0 && p.x < r.x0 + 3.5 && p.z > r.z0 && p.z < r.z1;
      el.hidden = S.map || asleep || S.mode === 'bed' || !inside || busy.has(b.id);
      if (!el.hidden) setPos(el, project(v3.set(b.x + 0.3, 1.3, b.z)));
    });
    roomTags.forEach(({ p: pp, el }) => {
      el.hidden = asleep || S.mode === 'bed' || (!S.map && Math.hypot(p.x - pp.x, p.z - pp.z) > 7);
      if (!el.hidden) setPos(el, project(pp));
    });
    placeTags.forEach(({ p: pp, el, near }) => {
      el.hidden = asleep || S.mode === 'bed' || (!!near && !S.map && Math.hypot(p.x - pp.x, p.z - pp.z) > near);
      if (!el.hidden) setPos(el, project(pp));
    });
    zzz.hidden = true;
    if (!zzz.hidden) setPos(zzz, project(v3.set(...REST.zzz)));
    prompt.hidden = !n;
    if (n) { $('promptKey').textContent = n.key; $('promptText').textContent = n.label; setPos(prompt, project(player.position.clone().setY(2.2))); }
  }
  let last = performance.now(), pulse = 0;
  // adaptive resolution: an integrated GPU can drop to a few frames a second, and the walk runs
  // in slow motion below 20 (dt is capped), so trade pixels for frames
  const perf = { frames: 0, time: 0, since: performance.now() };
  function adapt(rawDt) {
    if (document.visibilityState !== 'visible' || rawDt > 0.5 || performance.now() - perf.since < 4000) return;
    perf.frames++; perf.time += rawDt;
    if (perf.time < 2) return;
    const fps = perf.frames / perf.time;
    perf.frames = 0; perf.time = 0;
    const next = fps < 20 ? Math.max(0.75, quality - 0.1) : fps > 45 ? Math.min(1, quality + 0.1) : quality;
    if (next !== quality) { quality = next; resize(); }
  }
  function runFrame(now) {
    const rawDt = Math.max(0, (now - last) / 1000), dt = Math.min(0.12, rawDt); last = now;
    adapt(rawDt);
    if (S.started && !S.ended && !S.paused) {
      // game minutes per real second: sleep fast-forwards, a bed runs slow so the choices are not a
      // race against the clock, a ringing bell waits
      const rate = S.mode === 'sleep' ? PACE.sleep : S.mode === 'bed' ? PACE.bed : S.mode === 'bell' ? 0
        : S.mode === 'walk' && !pending().length && S.ringing == null ? PACE.quiet : PACE.walk;
      const gm = dt * rate;
      S.t += gm;
      if (S.mode === 'sleep') { S.energy = Math.min(100, S.energy + gm * 0.45); S.stats.sleptMin += gm; }
      else S.energy = Math.max(0, S.energy - gm * 0.045);
      S.bladder = Math.min(100, S.bladder + gm * 0.15);
      move(dt);
      if (S.mode === 'sleep') {
        if (S.energy >= 100 && !S.fullNoted) { S.fullNoted = true; toast('精力補滿了。想起來就按 E，也可以繼續休息。', 4); }
        $('sleepBar').style.width = `${S.energy}%`; $('sleepPct').textContent = `${Math.round(S.energy)}%`;
      }
      bellTick();
      if (S.energy < TIRED && !S.warned20) { S.warned20 = true; toast('精力剩 20%，跑不動了。找空檔去休息室坐下喝水休息。', 5); }
      if (S.energy < 10 && !S.warned10) { S.warned10 = true; toast('精力剩 10%……眼皮好重。再不休息，就要撐不住了。', 5); }
      if (S.bladder >= 100) {
        S.looFull = true;
        if (S.mode === 'sleep') stopSleep('憋不住了，被尿意叫醒。');
        else if (S.mode === 'walk' && performance.now() > (S.looNagAt || 0)) {
          S.looNagAt = performance.now() + 9000;
          toast(pickN(['憋不住了！快去休息室的廁所！', '尿意已經滿了，走路都要夾著走……快去廁所！'], 1)[0], 4);
        }
      }
      if (S.energy >= 30) S.warned20 = S.warned10 = false;
      if (S.t >= END && S.mode === 'walk' && !S.ended) { S.timeUp = true; keys.clear(); endShift(); }
      if (S.energy <= 0 && S.mode === 'walk' && !S.ended) { S.collapsed = true; keys.clear(); endShift(); }
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').hidden = true; }
      hudTimer -= dt; if (hudTimer <= 0) { hudTimer = 0.25; renderHud(); }
    }
    if (!S.paused) pulse += dt;
    if (S.started && !S.ended && !S.paused) updateStaff(dt);
    // the lamps of the beds that ring, and the roaming alarm light
    let redBed = null;
    for (const l of LV) if (l.state === 'go') { if (!redBed) redBed = levelBed(l.i); }
    const k = 0.65 + 0.35 * Math.sin(pulse * 6);
    if (redBed) { alarmRed.position.set(BED[redBed].x0 + 0.55, 2.35, BED[redBed].z); alarmRed.intensity = 5 * k; }
    else if (S.ringing != null) { alarmRed.position.set(0, 2.2, 1.9); alarmRed.intensity = 4 * k; } else alarmRed.intensity = 0;
    alarmAmber.intensity = 0;
    updateCamera(dt);
    composer.render();
    updateMarks();
  }
  function frameLoop(now) { runFrame(now); requestAnimationFrame(frameLoop); }
  updateCamera(0, true);
  // compile every material up front: otherwise each part of the floor stalls the first time
  // it comes into view, which on an integrated GPU freezes the walk for a second or two
  renderer.compile(scene, cam);
  renderHud();
  $('loading').hidden = true;
  $('start').hidden = false;
  // index.html?debug exposes a handle for scripted playtests; on its own it changes nothing but ]
  if (DEBUG) {
    window.__ward = { S, BS, LV, LEVELS, ecg, TALKERS, openChat, step: (n = 1) => { for (let i = 0; i < n; i++) runFrame(last + 1000 / 60); }, ringBell, openBell, bellGo, bellChoose, openBedside, goTo, chooseOpt, openEcg, closeEcg, cprPress, BED, WARD, renderer, scene, composer, solids, startSleep, place, nearest, endShift, closeBedside, get player() { return player; }, get quality() { return quality; } };
  }
  requestAnimationFrame(frameLoop);
}
