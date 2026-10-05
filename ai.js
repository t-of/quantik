// quantik のルールと CPU（Web Worker）。勝ち負けだけを最後まで読み切る（完全解析）。
//
// 盤（外向き）は長さ 16 の配列。空きは -1、駒は (色<<2 | 形)（色 0/1、形 0〜3）。
// 読み切りの中では、マスの値を 0=空き / 1+色*4+形 にした Int8Array と、ビット盤で持つ。
// 初期局面は後手必勝（tools/solve.mjs で読み切り、node で 12 秒ほど）。

const ROWS = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]];
const COLS = [[0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15]];
const QUADS = [[0, 1, 4, 5], [2, 3, 6, 7], [8, 9, 12, 13], [10, 11, 14, 15]];
const LINES = [...ROWS, ...COLS, ...QUADS];
// マス i を含む 3 本の線（行・列・区画）。勝ちの表示（main.js）でも使う
export const CELL_LINES = Array.from({ length: 16 }, (_, i) => LINES.filter((line) => line.includes(i)));

export function blocked(board, i, side, shape) {
  if (board[i] !== -1) return true;
  const opp = ((1 - side) << 2) | shape;
  return CELL_LINES[i].some((line) => line.some((j) => board[j] === opp));
}

// マス i を含む線のうち、4 マス埋まっていて形が 4 種とも違う線
export function winningLines(board, i) {
  return CELL_LINES[i].filter((line) => {
    let shapes = 0;
    for (const j of line) {
      if (board[j] === -1) return false;
      shapes |= 1 << (board[j] & 3);
    }
    return shapes === 0b1111;
  });
}
export const checkWin = (board, i) => winningLines(board, i).length > 0;

// side が置けるすべての手を「マス*4+形」で
export function genMoves(board, side) {
  const used = [0, 0, 0, 0];
  for (const v of board) if (v >= 0 && (v >> 2) === side) used[v & 3]++;
  const moves = [];
  for (let s = 0; s < 4; s++) {
    if (used[s] >= 2) continue;
    for (let i = 0; i < 16; i++) if (!blocked(board, i, side, s)) moves.push(i * 4 + s);
  }
  return moves;
}
export const decode = (m) => [m >> 2, m & 3]; // → [cell, shape]

// ---- 読み切り ----

const LIDX = Array.from({ length: 16 }, (_, i) => LINES.map((l, k) => (l.includes(i) ? k : -1)).filter((k) => k >= 0));
// マス i と行・列・区画を共有するマス（相手がここに置いた形は、この範囲に置けなくなる）
const ZONE = LIDX.map((ks) => ks.reduce((m, k) => LINES[k].reduce((mm, j) => mm | (1 << j), m), 0));

// 区画の形を保つ盤の対称 128 通り: 上下の帯の入れ替え×帯の中の行の入れ替え（8）× 列も同じ（8）× 転置（2）
const SYMS = (() => {
  const rowPerms = [];
  for (const sb of [0, 1]) for (const s0 of [0, 1]) for (const s1 of [0, 1]) {
    const [b0, b1] = sb ? [2, 0] : [0, 2];
    rowPerms.push([b0 + s0, b0 + 1 - s0, b1 + s1, b1 + 1 - s1]);
  }
  const syms = [];
  for (const rp of rowPerms) for (const cp of rowPerms) for (const t of [0, 1]) {
    const p = new Int8Array(16); // p[変換後のマス] = 元のマス
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const R = t ? cp[c] : rp[r], C = t ? rp[r] : cp[c];
      p[R * 4 + C] = r * 4 + c;
    }
    syms.push(p);
  }
  return syms;
})();

const b = new Int8Array(16);
const occ = new Int32Array(8); // occ[色*4+形] = その駒があるマスのビット
const lmask = new Int8Array(12), lcnt = new Int8Array(12); // 線ごとの形のビットと埋まった数
let filled = 0, count = 0;

function load(board) {
  b.fill(0); occ.fill(0); lmask.fill(0); lcnt.fill(0); filled = 0; count = 0;
  for (let i = 0; i < 16; i++) if (board[i] !== -1) place(i, 1 + board[i]);
}
function place(i, v) {
  b[i] = v; filled |= 1 << i; occ[v - 1] |= 1 << i; count++;
  for (const k of LIDX[i]) { lmask[k] |= 1 << ((v - 1) & 3); lcnt[k]++; }
}
function unplace(i, v) {
  b[i] = 0; filled &= ~(1 << i); occ[v - 1] &= ~(1 << i); count--;
  for (const k of LIDX[i]) {
    lcnt[k]--; lmask[k] = 0;
    for (const j of LINES[k]) if (b[j]) lmask[k] |= 1 << ((b[j] - 1) & 3);
  }
}
function moves(side) {
  const res = [];
  for (let s = 0; s < 4; s++) {
    const own = occ[side * 4 + s];
    if (own & (own - 1)) continue; // 2 個とも置いた
    let block = filled, o = occ[(1 - side) * 4 + s];
    while (o) { block |= ZONE[31 - Math.clz32(o & -o)]; o &= o - 1; }
    let free = ~block & 0xffff;
    while (free) { const i = 31 - Math.clz32(free & -free); free &= free - 1; res.push(i * 4 + s); }
  }
  return res;
}
// 置けば即勝ち（線に 3 種そろっていて、残りの形をそこに置ける）
const winsNow = (m) => LIDX[m >> 2].some((k) => lcnt[k] === 3 && lmask[k] === (15 ^ (1 << (m & 3))));

// 局面のキー: 手番から見た自分/相手で色を付け直し、128 通りの対称それぞれで形を出てきた順に
// 名前を付け直した 9 進 16 桁（< 2^53）のうち最小のもの。形の入れ替え（24 通り）もこれで吸収する。
function key(side) {
  let best = Infinity;
  const map = new Int8Array(4);
  for (const p of SYMS) {
    map.fill(-1);
    let nx = 0, k = 0;
    for (let i = 0; i < 16 && k <= best; i++) {
      const v = b[p[i]];
      let d = 0;
      if (v) {
        const s = (v - 1) & 3;
        if (map[s] < 0) map[s] = nx++;
        d = 1 + map[s] * 2 + (((v - 1) >> 2) === side ? 0 : 1);
      }
      k = k * 9 + d;
    }
    if (k < best) best = k;
  }
  return best;
}

export const BOOK_PIECES = 5; // 駒 5 個までの局面は tools/solve.mjs が読み切って book.json に入れる
export const book = new Map(); // key → 1（手番の勝ち）/ 0
export const tt = new Map();

// 手番 side が勝てるか
function wins(side) {
  const ms = moves(side);
  if (!ms.length) return false;
  for (const m of ms) if (winsNow(m)) return true;
  // ponytail: 置換表は駒 11 個まで（それより先は読むほうが速い）。上限は付けていない（全部読んでも 30 万件ほど）
  const useKey = count <= 11;
  let kk;
  if (useKey) {
    kk = key(side);
    const e = count <= BOOK_PIECES ? book.get(kk) : undefined;
    if (e !== undefined) return e === 1;
    const t = tt.get(kk);
    if (t !== undefined) return t;
  }
  let r = false;
  for (const m of ms) {
    const i = m >> 2, v = 1 + side * 4 + (m & 3);
    place(i, v);
    const oppWins = wins(1 - side);
    unplace(i, v);
    if (!oppWins) { r = true; break; }
  }
  if (useKey) tt.set(kk, r);
  return r;
}

// 局面 board で手番 side が勝てるか（ブック作りとテスト用）
export function solve(board, side) { load(board); return wins(side); }
export function positionKey(board, side) { load(board); return key(side); }

// 今の局面で side の最善手。勝てるなら勝ちを保つ手（即勝ちがあればそれ）、
// 負けなら、相手の勝ち筋がいちばん少なくなる手（人が間違えやすい手）を選ぶ。
export function bestMove(board, side) {
  load(board);
  const ms = moves(side);
  if (!ms.length) return null; // 置ける手がない＝この手番の負け
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const out = (m, win) => ({ cell: m >> 2, shape: m & 3, win, lose: !win });
  const now = ms.filter(winsNow);
  if (now.length) return out(pick(now), true);
  const good = [];
  for (const m of ms) {
    const i = m >> 2, v = 1 + side * 4 + (m & 3);
    place(i, v);
    if (!wins(1 - side)) good.push(m);
    unplace(i, v);
  }
  if (good.length) return out(pick(good), true);
  // 負け: 相手の勝てる応手の数が最小の手。相手に即勝ちを渡す手はなるべく避ける
  let bestN = Infinity, bestMs = [];
  const mobility = (m) => { place(m >> 2, 1 + side * 4 + (m & 3)); const n = moves(1 - side).length; unplace(m >> 2, 1 + side * 4 + (m & 3)); return n; };
  const order = ms.map((m) => [mobility(m), m]).sort((x, y) => x[0] - y[0]).map((x) => x[1]); // 相手の手が少ない手から見ると、早く打ち切れる
  for (const m of order) {
    const i = m >> 2, v = 1 + side * 4 + (m & 3);
    place(i, v);
    let n = 0;
    for (const r of moves(1 - side)) {
      if (winsNow(r)) { n += 100; continue; }
      const j = r >> 2, w = 1 + (1 - side) * 4 + (r & 3);
      place(j, w);
      if (!wins(side)) n++;
      unplace(j, w);
      if (n > bestN) break;
    }
    unplace(i, v);
    if (n < bestN) { bestN = n; bestMs = [m]; } else if (n === bestN) bestMs.push(m);
  }
  return out(pick(bestMs), false);
}

if (typeof WorkerGlobalScope !== 'undefined') {
  // 序盤（駒 5 個まで）はブックを引く。ないと最初の数手に十数秒かかる
  const ready = fetch('./book.json').then((r) => r.json()).then((data) => {
    for (const [k, v] of Object.entries(data)) book.set(Number(k), v);
  }).catch(() => {});
  self.onmessage = async (e) => {
    await ready;
    const { id, board, side } = e.data;
    self.postMessage({ id, ...bestMove(board, side) });
  };
}
