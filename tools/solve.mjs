// 開局ブック（../book.json）を作る。駒 BOOK_PIECES 個までのすべての局面（対称をまとめたもの）を
// 読み切り、{ キー: 手番が勝てるなら 1、負けなら 0 } で書き出す。node で 1 分ほど。
//   node tools/solve.mjs
import { writeFileSync } from 'node:fs';
import { BOOK_PIECES, solve, positionKey, genMoves, checkWin } from '../ai.js';

const t0 = Date.now();
const out = {};
function walk(board, side, n) {
  const k = positionKey(board, side);
  if (k in out) return;
  out[k] = solve(board, side) ? 1 : 0;
  if (n === BOOK_PIECES) return;
  for (const m of genMoves(board, side)) {
    board[m >> 2] = (side << 2) | (m & 3);
    if (!checkWin(board, m >> 2)) walk(board, 1 - side, n + 1);
    board[m >> 2] = -1;
  }
}
walk(Array(16).fill(-1), 0, 0);
writeFileSync(new URL('../book.json', import.meta.url), JSON.stringify(out));
console.log('初期局面:', out[positionKey(Array(16).fill(-1), 0)] ? '先手必勝' : '後手必勝',
  '局面数:', Object.keys(out).length, '時間 ms:', Date.now() - t0);
