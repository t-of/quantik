import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'quantik.' で始める。
const STORE = 'quantik.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'quantik', text: '4×4の盤に4種の形を置き、縦・横・区画で4種を揃えたら勝ちの対戦パズル' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- ここからアプリ本体 ----
//
// quantik: 4×4 の盤（2×2 の区画が 4 つ）に、4 種の形（球・立方体・円錐・円柱）を 2 個ずつ交互に置く。
// 先手・後手は色（明/暗の木）で区別。置いたマスと同じ行・列・区画に「相手の」同じ形があると置けない
// （自分の同じ形はよい）。置いた結果、行・列・区画のどれかに 4 種がそろえば勝ち。
// 置ける手が 1 つもなければその手番の負け（引き分けはない）。
import { checkWin, genMoves, blocked, decode, winningLines } from './ai.js';

let G = null; // 対局中の状態。null ならタイトル画面
let selected = null; // 今選んでいる形（0〜3）
let epoch = 0; // 新しい対局・待った のたびに増やし、古い CPU の返事を無視する

function remaining(board, side) {
  const n = [2, 2, 2, 2];
  for (const v of board) if (v >= 0 && (v >> 2) === side) n[v & 3]--;
  return n;
}
function legalCells(board, side, shape) {
  const cells = [];
  for (let i = 0; i < 16; i++) if (!blocked(board, i, side, shape)) cells.push(i);
  return cells;
}
function playerLabel(side) {
  if (G.mode === '2p') return side === 0 ? '1人目' : '2人目';
  if (G.mode === 'cvc') return side === 0 ? 'CPU（先手）' : 'CPU（後手）';
  return side === G.human ? 'あなた' : 'CPU';
}
function isCpuTurn() { return !G.winner && (G.mode === 'cvc' || (G.mode === 'cpu' && G.turn !== G.human)); }
function isInteractive() {
  return !G.winner && (G.mode === '2p' || (G.mode === 'cpu' && G.turn === G.human));
}
function canPlace() { return isInteractive() && selected != null; }

function newGame(mode, human) {
  epoch++;
  G = { mode, human, board: Array(16).fill(-1), turn: 0, winner: null, winLine: null, note: null, history: [] };
  selected = firstShape();
  render();
  maybeCpuTurn();
}
function firstShape() {
  if (!G) return null;
  const moves = genMoves(G.board, G.turn);
  return moves.length ? decode(moves[0])[1] : null;
}

function placePiece(cell, shape) {
  G.history.push({ board: G.board.slice(), turn: G.turn, note: G.note });
  G.board[cell] = (G.turn << 2) | shape;
  const win = checkWin(G.board, cell);
  if (win) {
    G.winner = G.turn;
    G.winLine = winningLines(G.board, cell)[0];
    render();
    return;
  }
  const next = 1 - G.turn;
  if (!genMoves(G.board, next).length) {
    G.winner = G.turn; // 相手が置けない＝この手の勝ち
    G.winLine = null;
    render();
    return;
  }
  G.turn = next;
  G.note = null;
  selected = firstShape();
  render();
  maybeCpuTurn();
}

function undo() {
  const steps = G.mode === 'cpu' && G.history.length >= 2 ? 2 : 1; // CPU の手も合わせて戻す
  for (let i = 0; i < steps && G.history.length; i++) {
    const h = G.history.pop();
    G.board = h.board; G.turn = h.turn; G.note = h.note;
  }
  G.winner = null; G.winLine = null;
  epoch++; // 進行中だった CPU の思考を無効にする
  selected = firstShape();
  render();
  maybeCpuTurn();
}

// ---- CPU（ai.js を Worker で動かす。最後まで読み切る。序盤は book.json を引く） ----
const cpu = new Worker('./ai.js', { type: 'module' });
let cpuAsk = 0;
function maybeCpuTurn() {
  if (!isCpuTurn()) return;
  const myEpoch = epoch;
  const id = ++cpuAsk;
  cpu.onmessage = (e) => {
    if (e.data.id !== cpuAsk || myEpoch !== epoch) return; // やり直し・待った のあとの返事は捨てる
    const { cell, shape, win } = e.data;
    G.note = G.mode === 'cvc' ? `${playerLabel(G.turn)}: ${win ? '勝ちを読み切りました' : '読み切りでは負け'}`
      : win ? 'CPU: 勝ちを読み切りました' : 'CPU: 読み切りでは負け。あなたの間違いを待っています';
    placePiece(cell, shape);
  };
  // CPU 同士は速すぎて見えないので、1 手ごとに少し間をあける
  if (G.mode === 'cvc') setTimeout(() => { if (myEpoch === epoch) cpu.postMessage({ id, board: G.board, side: G.turn }); }, 700);
  else cpu.postMessage({ id, board: G.board, side: G.turn });
}

// ---- 斜め上から見た立体のコマ（手持ちの SVG）。形ごとに別の体積を描く ----
function woodColors(side) {
  return side ? ['#6b5340', '#4f3c2c', '#3b2c20', '#1e1610'] : ['#fbf5e8', '#eadcc0', '#cdbb98', '#8a7a5e'];
}
function pieceSVG(shape, side, size) {
  const [top, left, right, line] = woodColors(side);
  const st = `stroke="${line}" stroke-width="2" stroke-linejoin="round"`;
  const r = 26, k = 10, by = 106, h = 46, ty = by - h;
  let body;
  if (shape === 0) { // 球
    const gid = `g${side}`;
    body = `<defs><radialGradient id="${gid}" cx="35%" cy="30%" r="75%">`
      + `<stop offset="0%" stop-color="${top}"/><stop offset="60%" stop-color="${left}"/><stop offset="100%" stop-color="${right}"/>`
      + `</radialGradient></defs>`
      + `<ellipse cx="50" cy="${by + 2}" rx="${r - 2}" ry="${k - 3}" fill="${right}" opacity="0.4"/>`
      + `<circle cx="50" cy="${by - r}" r="${r}" fill="url(#${gid})" ${st}/>`;
  } else if (shape === 1) { // 立方体
    const pt = (x, y) => `${x} ${y}`;
    body = `<path d="M${pt(50 - r, ty)}L${pt(50, ty + k)}V${ty + k + h}L${pt(50 - r, ty + h)}Z" fill="${left}" ${st}/>`
      + `<path d="M${pt(50, ty + k)}L${pt(50 + r, ty)}V${ty + h}L${pt(50, ty + k + h)}Z" fill="${right}" ${st}/>`
      + `<path d="M${pt(50 - r, ty)}L${pt(50, ty + k)}L${pt(50 + r, ty)}L${pt(50, ty - k)}Z" fill="${top}" ${st}/>`;
  } else if (shape === 2) { // 円錐
    body = `<path d="M50 ${ty}L${50 - r} ${by}A${r} ${k} 0 0 0 50 ${by + k}Z" fill="${left}" ${st}/>`
      + `<path d="M50 ${ty}L50 ${by + k}A${r} ${k} 0 0 0 ${50 + r} ${by}Z" fill="${right}" ${st}/>`;
  } else { // 円柱
    body = `<path d="M${50 - r} ${ty}V${by}A${r} ${k} 0 0 0 ${50 + r} ${by}V${ty}Z" fill="${left}" ${st}/>`
      + `<path d="M50 ${ty}V${by + k}A${r} ${k} 0 0 0 ${50 + r} ${by}V${ty}Z" fill="${right}"/>`
      + `<path d="M${50 - r} ${ty}V${by}A${r} ${k} 0 0 0 ${50 + r} ${by}V${ty}" fill="none" ${st}/>`
      + `<ellipse cx="50" cy="${ty}" rx="${r}" ry="${k}" fill="${top}" ${st}/>`;
  }
  return `<svg viewBox="0 0 100 120" width="${size}" height="${size * 1.2}" aria-hidden="true">${body}</svg>`;
}

// ---- 3D の盤（three.js）。ドラッグで回す、ピンチで寄る ----
const canvas = document.createElement('canvas');
canvas.className = 'board3d__canvas';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
camera.position.set(0, 6, 5.6);
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // 盤の下にはもぐらない
controls.target.set(0, 0.3, 0);
controls.update();
controls.addEventListener('change', draw);

// 影は付けない。環境光（RoomEnvironment）と弱い向きの光で質感を出す
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2e24, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 8, 4);
scene.add(sun);

// 木目（灰色の濃淡）。色はマテリアルの color で付ける。上下・左右につながるように周期を整数にする
function woodTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = (y + 9 * Math.sin((2 * Math.PI * x) / S * 2) + 3 * Math.sin((2 * Math.PI * x) / S * 7)) / S;
      const ring = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * t * 14), 6);
      const v = 255 * (0.9 - 0.16 * ring + (Math.random() - 0.5) * 0.05);
      const p = (y * S + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
const GRAIN = woodTexture();
const wood = (color, o = {}) => new THREE.MeshPhysicalMaterial({
  color, map: GRAIN, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.7, side: THREE.DoubleSide, ...o,
});

const board = new THREE.Mesh(new RoundedBoxGeometry(4.8, 0.36, 4.8, 4, 0.14), wood(0x6a4329, { clearcoat: 0.5 }));
board.position.y = -0.18;
scene.add(board);

// ---- 机の天板。盤の下に木の板を敷き、地平線まで続ける ----
{
  const box = new THREE.Box3().setFromObject(board);
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const S = 1024, PLANK = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  ['#4b3121', '#432b1c', '#503524', '#472f1f'].forEach((col, i) => {
    for (let y = i * PLANK; y < S; y += PLANK * 4) {
      g.save();
      g.beginPath(); g.rect(0, y, S, PLANK); g.clip();
      g.fillStyle = col; g.fillRect(0, y, S, PLANK);
      for (let k = 0; k < 36; k++) { // 木目の線
        const y0 = y + Math.random() * PLANK, a = 2 + Math.random() * 4, f = 60 + Math.random() * 120;
        g.strokeStyle = `rgba(24, 12, 4, ${0.06 + Math.random() * 0.14})`;
        g.lineWidth = 0.5 + Math.random() * 2;
        g.beginPath();
        for (let x = 0; x <= S; x += 16) g.lineTo(x, y0 + a * Math.sin(x / f + k));
        g.stroke();
      }
      g.restore();
      g.fillStyle = 'rgba(0, 0, 0, 0.45)'; g.fillRect(0, y, S, 2); // 板のすき間
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const FAR = 1500; // 地平線まで続いて見える広さ
  tex.repeat.set(FAR / (w * 3.2), FAR / (w * 3.2));
  const table = new THREE.Mesh(new THREE.PlaneGeometry(FAR, FAR),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, envMapIntensity: 0.4 }));
  table.rotation.x = -Math.PI / 2;
  table.position.y = box.min.y - 0.01;
  table.renderOrder = -1;
  scene.add(table);
  // 盤の落とす影
  const sc = document.createElement('canvas');
  sc.width = sc.height = 256;
  const sg = sc.getContext('2d');
  const shade = sg.createRadialGradient(128, 128, 0, 128, 128, 128 * 0.48);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.55)'); shade.addColorStop(0.55, 'rgba(0, 0, 0, 0.4)'); shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sg.fillStyle = shade; sg.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 3.2, w * 3.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = box.min.y - 0.005;
  scene.add(shadow);
}

// ホーム画面では盤をゆっくり回して見せる。対局に入ったら最初の向きに戻す（動きを控える設定なら回さない）
{
  const HOME_CAM = camera.position.clone();
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let wasHome = false;
  controls.autoRotateSpeed = 0.6;
  const spin = () => {
    const home = !!canvas.offsetParent && !!canvas.closest('.title, #homeBoard');
    controls.autoRotate = home && !still.matches;
    if (controls.autoRotate) controls.update(); // change → draw
    else if (wasHome && !home) { camera.position.copy(HOME_CAM); controls.update(); }
    wasHome = home;
    requestAnimationFrame(spin);
  };
  requestAnimationFrame(spin);
}

// 2×2 の区画がわかるように、区画ごとに市松、区画の境目は太く暗い溝にする
const CELL_COLOR = { quadA: 0x4a2e1c, quadB: 0x40281a, open: 0xb08a3a, win: 0xffd35c };
function quadrantBase(i) {
  const qr = (i >> 2) >> 1, qc = (i & 3) >> 1;
  return (qr + qc) % 2 === 0 ? CELL_COLOR.quadA : CELL_COLOR.quadB;
}
const cellGeo = new THREE.PlaneGeometry(0.92, 0.92);
const cellMeshes = [...Array(16).keys()].map((i) => {
  const m = new THREE.Mesh(cellGeo, wood(quadrantBase(i), { roughness: 0.75, clearcoat: 0 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((i % 4) - 1.5, 0.004, Math.floor(i / 4) - 1.5);
  m.userData.cell = i;
  scene.add(m);
  return m;
});
const GROOVE_THIN = new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.9 });
const GROOVE_THICK = new THREE.MeshStandardMaterial({ color: 0x140b06, roughness: 0.9 });
[-1, 0, 1].forEach((p) => { // 0 が 2×2 区画の境目（太い）、±1 はマスの境目（細い）
  const thick = p === 0;
  const mat = thick ? GROOVE_THICK : GROOVE_THIN;
  const gx = new THREE.Mesh(new THREE.BoxGeometry(thick ? 0.07 : 0.02, 0.02, 4.6), mat);
  gx.position.set(p, 0.006, 0);
  scene.add(gx);
  const gz = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.02, thick ? 0.07 : 0.02), mat);
  gz.position.set(0, 0.006, p);
  scene.add(gz);
});

// コマの素材（明るい木＝先手、暗い木＝後手）。quarto と同じ色
const WOOD = [wood(0xead3a8), wood(0x5a3820)];

// 形ごとの立体。0:球 1:立方体 2:円錐 3:円柱
const SPHERE_GEO = new THREE.SphereGeometry(0.32, 32, 24).translate(0, 0.32, 0);
const CUBE_GEO = new RoundedBoxGeometry(0.56, 0.56, 0.56, 3, 0.06).translate(0, 0.28, 0);
const CONE_GEO = new THREE.ConeGeometry(0.34, 0.66, 32).translate(0, 0.33, 0);
const CYL_GEO = new THREE.CylinderGeometry(0.3, 0.3, 0.58, 32).translate(0, 0.29, 0);
function pieceGeo(shape) {
  return shape === 0 ? SPHERE_GEO : shape === 1 ? CUBE_GEO : shape === 2 ? CONE_GEO : CYL_GEO;
}
function pieceMesh(shape, side) {
  const m = new THREE.Mesh(pieceGeo(shape), WOOD[side]);
  m.userData.shape = shape;
  return m;
}

// タイトルに出す見本の盤面（対局の途中の一場面）。値は (色 << 2) | 形
const DEMO_BOARD = Array(16).fill(-1);
Object.assign(DEMO_BOARD, { 0: 0, 3: 3, 5: 5, 6: 2, 9: 7, 10: 4, 15: 1 });

const pieceMeshes = new Map(); // マス番号 → コマ
function syncScene() {
  (G ? G.board : DEMO_BOARD).forEach((v, i) => {
    if (v >= 0 && !pieceMeshes.has(i)) {
      const m = pieceMesh(v & 3, v >> 2);
      m.position.set(cellMeshes[i].position.x, 0, cellMeshes[i].position.z);
      m.userData.cell = i;
      scene.add(m);
      pieceMeshes.set(i, m);
    } else if (v < 0 && pieceMeshes.has(i)) {
      scene.remove(pieceMeshes.get(i));
      pieceMeshes.delete(i);
    }
  });
  const legal = G && canPlace() ? legalCells(G.board, G.turn, selected) : [];
  cellMeshes.forEach((m, i) => m.material.color.setHex(
    G?.winLine?.includes(i) ? CELL_COLOR.win
      : legal.includes(i) && G.board[i] < 0 ? CELL_COLOR.open
        : quadrantBase(i)));
  draw();
}

function draw() { renderer.render(scene, camera); }
new ResizeObserver(() => {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦長の画面でも盤の横が切れないように、縦の画角を広げる
  camera.fov = w < h ? (2 * Math.atan(Math.tan((19 * Math.PI) / 180) * (h / w)) * 180) / Math.PI : 38;
  camera.updateProjectionMatrix();
  draw();
}).observe(canvas);

// 動かさずに離したらタップ（ドラッグは回転）
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  downAt = null;
  if (!G || !canPlace()) return;
  const r = canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObjects([...cellMeshes, ...pieceMeshes.values()], true)[0];
  if (!hit) return;
  const cell = hit.object.userData.cell;
  if (G.board[cell] < 0 && !blocked(G.board, cell, G.turn, selected)) placePiece(cell, selected);
});

// ---- 画面 ----
function render() {
  const stage = document.getElementById('stage');
  stage.innerHTML = G ? gameHTML() : titleHTML();
  document.getElementById('board3d').appendChild(canvas);
  controls.enabled = !!G; // タイトルの盤は眺めるだけ（スクロールの邪魔をしない）
  syncScene();
  document.getElementById('home').hidden = !G;
  if (G) bindGame(); else bindTitle();
}

function titleHTML() {
  return `
    <div class="title">
      <h2>quantik</h2>
      <div class="board3d board3d--title" id="board3d"></div>
      <p class="hint">4×4 の盤に球・立方体・円錐・円柱を 2 個ずつ。行・列・区画のどれかで 4 種そろえたら勝ち</p>
      <button class="pill pill--big" data-start="cpu0">CPU と対戦（先手）</button>
      <button class="pill pill--big" data-start="cpu1">CPU と対戦（後手）</button>
      <button class="pill pill--big" data-start="2p">2人で遊ぶ</button>
      <button class="pill pill--big" data-start="cvc">CPU 同士の対戦を見る</button>
      ${rulesHTML()}
    </div>`;
}

// ---- ルール説明の図（上から見た盤。コマはトレイと同じ絵） ----
// pieces: { マス: [形, 色] }。marks: { マス: 'x' 置けない / 'win' そろった }
function figBoard(pieces, marks = {}) {
  const U = 40, P = 4, W = U * 4 + P * 2;
  let svg = `<rect class="fig__board" width="${W}" height="${W}" rx="6"/>`;
  for (let i = 0; i < 16; i++) {
    const x = P + (i % 4) * U, y = P + Math.floor(i / 4) * U;
    const q = (((i >> 2) >> 1) + ((i & 3) >> 1)) % 2;
    svg += `<rect class="fig__cell fig__cell--${marks[i] === 'win' ? 'win' : q ? 'b' : 'a'}" x="${x + 1}" y="${y + 1}" width="${U - 2}" height="${U - 2}"/>`;
    if (pieces[i]) svg += pieceSVG(...pieces[i], 30).replace('<svg ', `<svg x="${x + 5}" y="${y + 1}" `);
    if (marks[i] === 'x') svg += `<path class="fig__x" d="M${x + 12} ${y + 12}L${x + U - 12} ${y + U - 12}M${x + U - 12} ${y + 12}L${x + 12} ${y + U - 12}"/>`;
  }
  svg += `<path class="fig__quad" d="M${W / 2} ${P}V${W - P}M${P} ${W / 2}H${W - P}"/>`;
  return `<svg class="fig" viewBox="0 0 ${W} ${W}" width="${W}" aria-hidden="true">${svg}</svg>`;
}
function figItem(svg, text) {
  return `<figure class="figs__item">${svg}<figcaption>${text}</figcaption></figure>`;
}
function rulesHTML() {
  const shapes = (side) => [0, 1, 2, 3].map((s) => pieceSVG(s, side, 30)).join('');
  // 相手の球（マス 5）と同じ行・列・区画
  const blockedMarks = {};
  for (const i of [4, 6, 7, 1, 9, 13, 0]) blockedMarks[i] = 'x';
  return `
    <details class="rules">
      <summary>ルール</summary>
      <h3>1. 盤とコマ</h3>
      <div class="figs">
        ${figItem(figBoard({}), '4×4 の盤。太い線で 2×2 の区画が 4 つに分かれている')}
        <figure class="figs__item"><div class="fig__set">${shapes(0)}</div><div class="fig__set">${shapes(1)}</div>
          <figcaption>球・立方体・円錐・円柱を 2 個ずつ。明るい木が先手、暗い木が後手。交互に 1 個ずつ置く</figcaption></figure>
      </div>
      <h3>2. 相手と同じ形は並べられない</h3>
      <div class="figs">
        ${figItem(figBoard({ 5: [0, 1] }, blockedMarks), '相手の球があると、同じ行・列・区画（×）には自分の球を置けない。自分の同じ形の近くには置いてよい')}
      </div>
      <h3>3. 4 種そろえて勝ち</h3>
      <div class="figs">
        ${figItem(figBoard({ 0: [0, 0], 1: [1, 1], 2: [2, 0], 3: [3, 1] }, { 0: 'win', 1: 'win', 2: 'win', 3: 'win' }), '行・列で 4 種そろえば、最後に置いた人の勝ち。色はどちらでもよい')}
        ${figItem(figBoard({ 10: [3, 1], 11: [0, 0], 14: [2, 1], 15: [1, 0] }, { 10: 'win', 11: 'win', 14: 'win', 15: 'win' }), '2×2 の区画でも同じ')}
      </div>
      <h3>4. 置けなければ負け</h3>
      <ul>
        <li>自分の番に置ける場所が 1 つもなければ負け。引き分けはない。</li>
      </ul>
    </details>`;
}
function bindTitle() {
  document.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.start;
    if (v === '2p' || v === 'cvc') newGame(v, null); else newGame('cpu', v === 'cpu0' ? 0 : 1);
  }));
}

function gameHTML() {
  const interactive = isInteractive();

  let status;
  if (G.winner != null) status = `${playerLabel(G.winner)} の勝ち！`;
  else status = `${playerLabel(G.turn)} の番`;

  const tray = trayHTML(interactive);
  const canUndo = G.history.length > 0;
  const again = G.winner != null ? `
    <div class="result">
      <button class="pill pill--big" data-again>もう一度</button>
      <button class="pill" data-title>ホームに戻る</button>
    </div>` : '';

  return `
    <div class="game">
      <p class="status">${status}</p>
      <p class="note">${G.note || ''}</p>
      <div class="board3d" id="board3d"></div>
      <p class="hint">ドラッグで回す・ピンチで寄る</p>
      <div class="tray">${tray}</div>
      <div class="controls">
        ${G.mode === 'cvc' ? '' : `<button class="pill" data-undo ${canUndo ? '' : 'disabled'}>1手戻す</button>`}
      </div>
      ${again}
    </div>`;
}

function trayHTML(interactive) {
  return [0, 1, 2, 3].map((s) => {
    const left = remaining(G.board, G.turn)[s];
    const has = interactive && left > 0;
    return `<button class="shape-btn${selected === s ? ' shape-btn--on' : ''}" data-shape="${s}" ${has ? '' : 'disabled'}>
      ${pieceSVG(s, G.turn, 32)}<small>×${left}</small>
    </button>`;
  }).join('');
}

function bindGame() {
  document.querySelectorAll('.shape-btn:not([disabled])').forEach((b) => b.addEventListener('click', () => {
    selected = Number(b.dataset.shape);
    render();
  }));
  const undoBtn = document.querySelector('[data-undo]:not([disabled])');
  if (undoBtn) undoBtn.addEventListener('click', undo);
  const again = document.querySelector('[data-again]');
  if (again) again.addEventListener('click', () => newGame(G.mode, G.human));
  const title = document.querySelector('[data-title]');
  if (title) title.addEventListener('click', goHome);
}
function goHome() { epoch++; G = null; render(); }
document.getElementById('home').addEventListener('click', goHome);

render();
