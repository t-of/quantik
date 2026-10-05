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
// quantik: 4×4 の盤（2×2 の区画が 4 つ）に、4 種の形（●■▲✚）を 2 個ずつ交互に置く。
// 先手・後手は色で区別。置いたマスと同じ行・列・区画に「相手の」同じ形があると置けない
// （自分の同じ形はよい）。置いた結果、行・列・区画のどれかに 4 種がそろえば勝ち。
// 置ける手が 1 つもなければその手番の負け（引き分けはない）。
import { checkWin, genMoves, blocked, decode, winningLines } from './ai.js';

const SHAPES = ['●', '■', '▲', '✚'];

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
  return side === G.human ? 'あなた' : 'CPU';
}
function isCpuTurn() { return G.mode === 'cpu' && G.turn !== G.human && !G.winner; }

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
    G.note = win ? 'CPU: 勝ちを読み切りました' : 'CPU: 読み切りでは負け。あなたの間違いを待っています';
    placePiece(cell, shape);
  };
  cpu.postMessage({ id, board: G.board, side: G.turn });
}

// ---- 画面 ----
function render() {
  const stage = document.getElementById('stage');
  if (!G) { stage.innerHTML = titleHTML(); bindTitle(); return; }
  stage.innerHTML = gameHTML();
  bindGame();
}

function titleHTML() {
  return `
    <div class="title">
      <h2>quantik</h2>
      <p class="hint">4×4 の盤に●■▲✚を 2 個ずつ。行・列・区画のどれかで 4 種そろえたら勝ち</p>
      <button class="pill pill--big" data-start="cpu0">CPU と対戦（先手）</button>
      <button class="pill pill--big" data-start="cpu1">CPU と対戦（後手）</button>
      <button class="pill pill--big" data-start="2p">2人で遊ぶ</button>
    </div>`;
}
function bindTitle() {
  document.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.start;
    if (v === '2p') newGame('2p', null); else newGame('cpu', v === 'cpu0' ? 0 : 1);
  }));
}

function cellClass(i) {
  const row = i >> 2, col = i & 3;
  const cls = ['cell'];
  if (col === 1) cls.push('cell--qr');
  if (row === 1) cls.push('cell--qb');
  return cls.join(' ');
}

function gameHTML() {
  const interactive = !G.winner && (G.mode === '2p' || G.turn === G.human);
  const legal = interactive && selected != null ? legalCells(G.board, G.turn, selected) : [];

  let status;
  if (G.winner != null) status = `${playerLabel(G.winner)} の勝ち！`;
  else status = `${playerLabel(G.turn)} の番`;

  const board = Array.from({ length: 16 }, (_, i) => {
    const v = G.board[i];
    const own = v >= 0 ? v >> 2 : null;
    const shape = v >= 0 ? v & 3 : null;
    const won = G.winLine && G.winLine.includes(i);
    const canPlace = interactive && v < 0 && legal.includes(i);
    return `<button class="${cellClass(i)}${won ? ' cell--win' : ''}${canPlace ? ' cell--legal' : ''}" data-cell="${i}" ${canPlace ? '' : 'disabled'} aria-label="マス${i}">
      ${shape != null ? `<span class="piece piece--p${own}">${SHAPES[shape]}</span>` : ''}
    </button>`;
  }).join('');

  const tray = [0, 1, 2, 3].map((s) => {
    const left = remaining(G.board, G.turn)[s];
    const has = interactive && left > 0;
    return `<button class="shape-btn${selected === s ? ' shape-btn--on' : ''}" data-shape="${s}" ${has ? '' : 'disabled'}>
      <span class="piece piece--p${G.turn}">${SHAPES[s]}</span><small>×${left}</small>
    </button>`;
  }).join('');

  const canUndo = G.history.length > 0;
  const again = G.winner != null ? `
    <div class="result">
      <button class="pill pill--big" data-again>もう一度</button>
      <button class="pill" data-title>モードを選び直す</button>
    </div>` : '';

  return `
    <div class="game">
      <p class="status">${status}</p>
      <p class="note">${G.note || ''}</p>
      <div class="board">${board}</div>
      <div class="tray">${tray}</div>
      <div class="controls">
        <button class="pill" data-undo ${canUndo ? '' : 'disabled'}>1手戻す</button>
        <button class="pill" data-title>やめる</button>
      </div>
      ${again}
    </div>`;
}

function bindGame() {
  document.querySelectorAll('.shape-btn:not([disabled])').forEach((b) => b.addEventListener('click', () => {
    selected = Number(b.dataset.shape);
    render();
  }));
  document.querySelectorAll('.cell:not([disabled])').forEach((b) => b.addEventListener('click', () => {
    if (selected == null) return;
    placePiece(Number(b.dataset.cell), selected);
  }));
  const undoBtn = document.querySelector('[data-undo]:not([disabled])');
  if (undoBtn) undoBtn.addEventListener('click', undo);
  const again = document.querySelector('[data-again]');
  if (again) again.addEventListener('click', () => newGame(G.mode, G.human));
  const title = document.querySelector('[data-title]');
  if (title) title.addEventListener('click', () => { epoch++; G = null; render(); });
}

render();
