// assert だけの素朴なテスト。実行: node ai.test.mjs（20 秒ほど）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocked, checkWin, genMoves, bestMove, solve, positionKey, book } from './ai.js';

const EMPTY = () => Array(16).fill(-1);

// (1) 置けない判定と勝ち判定
{
  const b = EMPTY();
  b[0] = (0 << 2) | 1;
  assert.equal(blocked(b, 1, 1, 1), true, '同じ行の相手の同じ形は置けない');
  assert.equal(blocked(b, 4, 1, 1), true, '同じ列');
  assert.equal(blocked(b, 5, 1, 1), true, '同じ区画');
  assert.equal(blocked(b, 1, 0, 1), false, '自分の同じ形はよい');
  assert.equal(blocked(b, 1, 1, 2), false, '違う形はよい');
  assert.equal(blocked(b, 10, 1, 1), false, '関係ない場所はよい');
}
{
  const b = EMPTY();
  b[0] = 0; b[1] = (1 << 2) | 1; b[2] = 2; b[3] = (1 << 2) | 3;
  assert.equal(checkWin(b, 3), true, '4 種そろった行は勝ち（色は問わない）');
  b[3] = (1 << 2) | 0;
  assert.equal(checkWin(b, 3), false, '形が重なれば勝ちではない');
}

// (2) 1 手勝ちを必ず指す
{
  const b = EMPTY();
  b[0] = 0; b[1] = (1 << 2) | 1; b[2] = 2;
  const m = bestMove(b, 0);
  assert.deepEqual([m.cell, m.shape, m.win], [3, 3, true]);
}

// (3) 対称な局面は同じキー（左右反転＋形の入れ替え＋色の入れ替え）
{
  const a = EMPTY(); a[0] = 0; a[6] = (1 << 2) | 1;
  const c = EMPTY(); c[3] = (1 << 2) | 2; c[5] = 3; // 左右反転、形 0→2・1→3、色を入れ替えて手番も入れ替え
  assert.equal(positionKey(a, 1), positionKey(c, 0));
}

// (4) ブックと読み切りが合う（ブックの局面をいくつか、ブックなしで解き直す）
{
  const data = JSON.parse(readFileSync(new URL('./book.json', import.meta.url)));
  assert.equal(book.size, 0);
  // 初期局面は後手必勝
  assert.equal(data[positionKey(EMPTY(), 0)], 0);
  // ランダムな 5 手のあとの局面
  for (let t = 0; t < 20; t++) {
    const b = EMPTY(); let side = 0, ok = true;
    for (let n = 0; n < 5 && ok; n++) {
      const ms = genMoves(b, side); const m = ms[Math.floor(Math.random() * ms.length)];
      b[m >> 2] = (side << 2) | (m & 3); ok = !checkWin(b, m >> 2); side = 1 - side;
    }
    if (ok) assert.equal(data[positionKey(b, side)], solve(b, side) ? 1 : 0);
  }
}

// (5) 後手の CPU は、でたらめな先手に必ず勝つ
{
  for (let g = 0; g < 5; g++) {
    const b = EMPTY(); let side = 0, winner = null;
    for (;;) {
      let m;
      if (side === 0) { const ms = genMoves(b, 0); if (!ms.length) { winner = 1; break; } const r = ms[Math.floor(Math.random() * ms.length)]; m = { cell: r >> 2, shape: r & 3 }; }
      else { m = bestMove(b, 1); if (!m) { winner = 0; break; } }
      b[m.cell] = (side << 2) | m.shape;
      if (checkWin(b, m.cell)) { winner = side; break; }
      side = 1 - side;
    }
    assert.equal(winner, 1, '後手の CPU が勝つ');
  }
}

console.log('ai.test.mjs: OK');
