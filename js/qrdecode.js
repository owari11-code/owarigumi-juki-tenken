/*
 * qrdecode.js - カメラ画像からQRコードを読み取る（依存ゼロ・自前実装）
 *
 * iOS Safari は標準の BarcodeDetector に非対応のため、読み取りも自前で行う。
 * 流れ:
 *   ①明暗の2値化（局所しきい値）
 *   ②切り出しシンボル（左上・右上・左下の三隅）を探す
 *   ③型番を推定し、位置合わせパターンで射影変換を作る
 *   ④モジュールを標本化して行列にする
 *   ⑤形式情報→マスク解除→符号語の並べ直し
 *   ⑥リード・ソロモンで誤り訂正し、文字列に戻す
 *
 * 表（誤り訂正のブロック構成・位置合わせパターン座標）は qrcode.js と共有する。
 */
(function (global) {
  'use strict';

  var I = global.QRCode._internals;
  var EXP = I.EXP, LOG = I.LOG, gmul = I.gmul;

  /* ------------------------------------------------------------------ *
   * ① 2値化
   * ------------------------------------------------------------------ */
  var BLOCK = 8;

  /** ImageData -> 濃淡値の配列 */
  function toGray(data, w, h) {
    var gray = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) {
      // 輝度（整数演算）。屋外の逆光でも極端に振れないよう標準の係数を使う
      gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    }
    return gray;
  }

  /**
   * 局所しきい値による2値化。8x8ブロックごとの平均を、
   * 周囲3x3ブロックで平滑化したものをしきい値にする（影や照り返しに強い）。
   */
  function binarize(gray, w, h) {
    var bw = Math.max(1, Math.ceil(w / BLOCK));
    var bh = Math.max(1, Math.ceil(h / BLOCK));
    var avg = new Uint8Array(bw * bh);
    var bx, by, x, y;

    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw; bx++) {
        var sum = 0, min = 255, max = 0, n = 0;
        var y0 = by * BLOCK, x0 = bx * BLOCK;
        var y1 = Math.min(y0 + BLOCK, h), x1 = Math.min(x0 + BLOCK, w);
        for (y = y0; y < y1; y++) {
          for (x = x0; x < x1; x++) {
            var v = gray[y * w + x];
            sum += v; n++;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        var a = n ? (sum / n) : 128;
        // ほぼ一様なブロック（余白など）は、周囲より暗くならないようにする
        if (max - min <= 24) a = min > 128 ? min - 1 : 255;
        avg[by * bw + bx] = a;
      }
    }

    var bits = new Uint8Array(w * h);
    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw; bx++) {
        var l = Math.max(0, bx - 1), r = Math.min(bw - 1, bx + 1);
        var t = Math.max(0, by - 1), b = Math.min(bh - 1, by + 1);
        var s = 0, c = 0;
        for (var yy = t; yy <= b; yy++) {
          for (var xx = l; xx <= r; xx++) { s += avg[yy * bw + xx]; c++; }
        }
        var th = s / c;
        var py1 = Math.min((by + 1) * BLOCK, h), px1 = Math.min((bx + 1) * BLOCK, w);
        for (y = by * BLOCK; y < py1; y++) {
          for (x = bx * BLOCK; x < px1; x++) {
            bits[y * w + x] = gray[y * w + x] < th ? 1 : 0; // 1 = 黒
          }
        }
      }
    }
    return bits;
  }

  /* ------------------------------------------------------------------ *
   * ② 切り出しシンボル（ファインダパターン）の探索
   * ------------------------------------------------------------------ */
  /** 1:1:3:1:1 の比率になっているか */
  function isFinderRatio(counts) {
    var total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
    if (total < 7) return false;
    var unit = total / 7;
    var tol = unit / 2;
    return Math.abs(unit - counts[0]) < tol &&
      Math.abs(unit - counts[1]) < tol &&
      Math.abs(unit * 3 - counts[2]) < tol * 3 &&
      Math.abs(unit - counts[3]) < tol &&
      Math.abs(unit - counts[4]) < tol;
  }

  function centerFromEnd(counts, end) {
    return end - counts[4] - counts[3] - counts[2] / 2;
  }

  /** 縦方向に同じ比率が続くか確かめ、中心のy座標を返す */
  function checkVertical(bits, w, h, startY, centerX, maxCount, originalTotal) {
    var counts = [0, 0, 0, 0, 0];
    var y = startY;
    while (y >= 0 && bits[y * w + centerX]) { counts[2]++; y--; }
    if (y < 0) return NaN;
    while (y >= 0 && !bits[y * w + centerX] && counts[1] <= maxCount) { counts[1]++; y--; }
    if (y < 0 || counts[1] > maxCount) return NaN;
    while (y >= 0 && bits[y * w + centerX] && counts[0] <= maxCount) { counts[0]++; y--; }
    if (counts[0] > maxCount) return NaN;

    y = startY + 1;
    while (y < h && bits[y * w + centerX]) { counts[2]++; y++; }
    if (y === h) return NaN;
    while (y < h && !bits[y * w + centerX] && counts[3] < maxCount) { counts[3]++; y++; }
    if (y === h || counts[3] >= maxCount) return NaN;
    while (y < h && bits[y * w + centerX] && counts[4] < maxCount) { counts[4]++; y++; }
    if (counts[4] >= maxCount) return NaN;

    var total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
    if (Math.abs(total - originalTotal) * 5 >= 2 * originalTotal) return NaN;
    return isFinderRatio(counts) ? centerFromEnd(counts, y) : NaN;
  }

  /** 横方向の再確認 */
  function checkHorizontal(bits, w, centerY, startX, maxCount, originalTotal) {
    var counts = [0, 0, 0, 0, 0];
    var x = startX;
    var row = centerY * w;
    while (x >= 0 && bits[row + x]) { counts[2]++; x--; }
    if (x < 0) return NaN;
    while (x >= 0 && !bits[row + x] && counts[1] <= maxCount) { counts[1]++; x--; }
    if (x < 0 || counts[1] > maxCount) return NaN;
    while (x >= 0 && bits[row + x] && counts[0] <= maxCount) { counts[0]++; x--; }
    if (counts[0] > maxCount) return NaN;

    x = startX + 1;
    while (x < w && bits[row + x]) { counts[2]++; x++; }
    if (x === w) return NaN;
    while (x < w && !bits[row + x] && counts[3] < maxCount) { counts[3]++; x++; }
    if (x === w || counts[3] >= maxCount) return NaN;
    while (x < w && bits[row + x] && counts[4] < maxCount) { counts[4]++; x++; }
    if (counts[4] >= maxCount) return NaN;

    var total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
    if (Math.abs(total - originalTotal) * 5 >= originalTotal) return NaN;
    return isFinderRatio(counts) ? centerFromEnd(counts, x) : NaN;
  }

  function findFinders(bits, w, h) {
    var found = [];

    function push(x, y, size) {
      for (var i = 0; i < found.length; i++) {
        var f = found[i];
        if (Math.abs(f.x - x) < f.size && Math.abs(f.y - y) < f.size) {
          // 同じ位置の重複検出は平均に寄せて数え上げる
          f.x = (f.x * f.n + x) / (f.n + 1);
          f.y = (f.y * f.n + y) / (f.n + 1);
          f.size = (f.size * f.n + size) / (f.n + 1);
          f.n++;
          return;
        }
      }
      found.push({ x: x, y: y, size: size, n: 1 });
    }

    var counts = [0, 0, 0, 0, 0];
    var step = Math.max(1, Math.floor(h / 240)); // 大きい画像は行を間引いて走査する
    for (var y = 0; y < h; y += step) {
      counts[0] = counts[1] = counts[2] = counts[3] = counts[4] = 0;
      var state = 0;
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var dark = bits[row + x];
        if (dark) {
          if (state === 1 || state === 3) state++;      // 明 -> 暗
          counts[state]++;
        } else {
          if (state === 0) {
            counts[0] && state++;                       // 先頭の余白は読み飛ばす
            if (state === 1) counts[1]++;
          } else if (state === 2 || state === 4) {
            if (state === 4) {
              if (isFinderRatio(counts)) {
                var cx = centerFromEnd(counts, x);
                var total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
                var maxCount = Math.ceil(total / 7 * 2);
                var cy = checkVertical(bits, w, h, y, Math.round(cx), maxCount, total);
                if (!isNaN(cy)) {
                  var cx2 = checkHorizontal(bits, w, Math.round(cy), Math.round(cx), maxCount, total);
                  if (!isNaN(cx2)) push(cx2, cy, total / 7);
                }
              }
              counts[0] = counts[2]; counts[1] = counts[3]; counts[2] = counts[4];
              counts[3] = 1; counts[4] = 0; state = 3;
            } else {
              state++;
              counts[state]++;
            }
          } else {
            counts[state]++;
          }
        }
      }
    }
    // 何度も同じ位置で検出できたものほど確からしい
    found.sort(function (a, b) { return b.n - a.n; });
    return found;
  }

  /** 3点を 左上・右上・左下 に並べ替える */
  function orderFinders(p) {
    function d2(a, b) { return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y); }
    var d01 = d2(p[0], p[1]), d12 = d2(p[1], p[2]), d02 = d2(p[0], p[2]);
    var tl, a, b;
    if (d12 >= d01 && d12 >= d02) { tl = p[0]; a = p[1]; b = p[2]; }
    else if (d02 >= d01 && d02 >= d12) { tl = p[1]; a = p[0]; b = p[2]; }
    else { tl = p[2]; a = p[0]; b = p[1]; }
    // 外積の符号で右上と左下を決める
    var cross = (a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x);
    return cross < 0 ? { tl: tl, tr: b, bl: a } : { tl: tl, tr: a, bl: b };
  }

  /* ------------------------------------------------------------------ *
   * ③ 型番の推定と位置合わせパターン
   * ------------------------------------------------------------------ */
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  function estimateDimension(o, moduleSize) {
    var d = (dist(o.tl, o.tr) / moduleSize + dist(o.tl, o.bl) / moduleSize) / 2;
    var dim = Math.round(d) + 7;
    var m = dim & 0x03;
    if (m === 0) dim++;
    else if (m === 2) dim--;
    else if (m === 3) dim -= 2;
    return dim;
  }

  /**
   * 位置合わせパターンの縦方向の確認。
   * 横方向で見つけた行は中心とは限らないため、暗い帯の上下を数えて中心yを求める。
   * counts = [上の明, 中央の暗, 下の明]
   */
  function alignCrossVertical(bits, w, h, centerX, startY, maxCount, originalTotal) {
    var counts = [0, 0, 0];
    var y = startY;
    while (y >= 0 && bits[y * w + centerX] && counts[1] <= maxCount) { counts[1]++; y--; }
    if (y < 0 || counts[1] > maxCount) return NaN;
    while (y >= 0 && !bits[y * w + centerX] && counts[0] <= maxCount) { counts[0]++; y--; }
    if (counts[0] > maxCount) return NaN;

    y = startY + 1;
    while (y < h && bits[y * w + centerX] && counts[1] <= maxCount) { counts[1]++; y++; }
    if (y === h || counts[1] > maxCount) return NaN;
    while (y < h && !bits[y * w + centerX] && counts[2] <= maxCount) { counts[2]++; y++; }
    if (counts[2] > maxCount) return NaN;

    var total = counts[0] + counts[1] + counts[2];
    if (5 * Math.abs(total - originalTotal) >= 2 * originalTotal) return NaN;
    var unit = total / 3;
    if (Math.abs(counts[0] - unit) >= unit || Math.abs(counts[1] - unit) >= unit ||
        Math.abs(counts[2] - unit) >= unit) return NaN;
    return y - counts[2] - counts[1] / 2;
  }

  /** 推定位置の周りで 1:1:1 の位置合わせパターンを探す */
  function findAlignment(bits, w, h, estX, estY, allowance, moduleSize) {
    var startX = Math.max(0, Math.floor(estX - allowance));
    var endX = Math.min(w - 1, Math.ceil(estX + allowance));
    var startY = Math.max(0, Math.floor(estY - allowance));
    var endY = Math.min(h - 1, Math.ceil(estY + allowance));
    var best = null, bestD = Infinity;
    var maxCount = Math.ceil(moduleSize * 2);

    // 位置合わせパターンの中心行は「明・暗・明」が各1モジュールずつ並ぶ。
    // 中央（暗）の中心を求めたいので、その並びで走査する。
    for (var y = startY; y <= endY; y++) {
      var counts = [0, 0, 0];
      var state = 0;
      var row = y * w;
      for (var x = startX; x <= endX; x++) {
        var dark = bits[row + x];
        if (state === 0) {                    // 前の明
          if (!dark) counts[0]++;
          else if (counts[0]) { state = 1; counts[1]++; }
        } else if (state === 1) {             // 中央の暗
          if (dark) counts[1]++;
          else { state = 2; counts[2]++; }
        } else {                              // 後ろの明
          if (!dark) { counts[2]++; continue; }
          var total = counts[0] + counts[1] + counts[2];
          var unit = total / 3;
          if (Math.abs(unit - moduleSize) < moduleSize &&
              Math.abs(counts[0] - unit) < unit && Math.abs(counts[1] - unit) < unit &&
              Math.abs(counts[2] - unit) < unit) {
            var cx = x - counts[2] - counts[1] / 2;
            var cy = alignCrossVertical(bits, w, h, Math.round(cx), y, maxCount, total);
            if (!isNaN(cy)) {
              var dd = (cx - estX) * (cx - estX) + (cy - estY) * (cy - estY);
              if (dd < bestD) { bestD = dd; best = { x: cx, y: cy }; }
            }
          }
          // いま見つけた暗を次の「中央」とみなして走査を続ける
          counts[0] = counts[2]; counts[1] = 1; counts[2] = 0; state = 1;
        }
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ *
   * 射影変換（4点→4点）
   * 単位正方形を介して、モジュール座標から画像座標へ写す行列を作る。
   * ------------------------------------------------------------------ */
  function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
    var dx3 = x0 - x1 + x2 - x3;
    var dy3 = y0 - y1 + y2 - y3;
    if (dx3 === 0 && dy3 === 0) {
      return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
    }
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    var den = dx1 * dy2 - dx2 * dy1;
    if (den === 0) return null;
    var a13 = (dx3 * dy2 - dx2 * dy3) / den;
    var a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return [
      x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0,
      y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0,
      a13, a23, 1
    ];
  }

  function adjoint(m) {
    return [
      m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
      m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
      m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
    ];
  }

  function timesM(a, b) {
    return [
      a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
      a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
      a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]
    ];
  }

  /** 元の四角形 s を 目的の四角形 d へ写す変換 */
  function quadToQuad(s, d) {
    var ms = squareToQuad(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]);
    var md = squareToQuad(d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
    if (!ms || !md) return null;
    return timesM(md, adjoint(ms));
  }

  function transformPoint(t, x, y) {
    var den = t[6] * x + t[7] * y + t[8];
    if (den === 0) return null;
    return { x: (t[0] * x + t[1] * y + t[2]) / den, y: (t[3] * x + t[4] * y + t[5]) / den };
  }

  /* ------------------------------------------------------------------ *
   * ④ 標本化してモジュール行列にする
   * ------------------------------------------------------------------ */
  function sampleGrid(bits, w, h, dimension, transform) {
    var modules = [];
    for (var y = 0; y < dimension; y++) {
      var rowArr = new Uint8Array(dimension);
      for (var x = 0; x < dimension; x++) {
        var p = transformPoint(transform, x + 0.5, y + 0.5);
        if (!p) return null;
        var px = Math.round(p.x), py = Math.round(p.y);
        if (px < 0 || py < 0 || px >= w || py >= h) return null;
        rowArr[x] = bits[py * w + px];
      }
      modules.push(rowArr);
    }
    return modules;
  }

  /* ------------------------------------------------------------------ *
   * ⑤ 形式情報・マスク解除・符号語の取り出し
   * ------------------------------------------------------------------ */
  var ECLS = ['L', 'M', 'Q', 'H'];

  /** 生成時と同じ方法で 32 通りの形式情報を作り、最も近いものを選ぶ */
  var FORMAT_TABLE = (function () {
    var out = [];
    for (var e = 0; e < 4; e++) {
      var ecl = ECLS[e];
      for (var m = 0; m < 8; m++) {
        var data = (I.ECL_FORMAT_BITS[ecl] << 3) | m;
        var rem = data;
        for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        out.push({ bits: ((data << 10) | rem) ^ 0x5412, ecl: ecl, mask: m });
      }
    }
    return out;
  })();

  function popcount(v) {
    var c = 0;
    while (v) { c += v & 1; v >>>= 1; }
    return c;
  }

  function readFormat(modules, size) {
    function bit(x, y) { return modules[y][x] ? 1 : 0; }
    var a = 0, i;
    for (i = 0; i <= 5; i++) a = (a << 1) | bit(8, i);
    a = (a << 1) | bit(8, 7);
    a = (a << 1) | bit(8, 8);
    a = (a << 1) | bit(7, 8);
    for (i = 5; i >= 0; i--) a = (a << 1) | bit(i, 8);

    var b = 0;
    for (i = 0; i < 8; i++) b = (b << 1) | bit(size - 1 - i, 8);
    for (i = 0; i < 7; i++) b = (b << 1) | bit(8, size - 7 + i);

    // 上の読み取り順は「最上位ビットから」。生成側は逆順なので合わせる
    function reverse15(v) {
      var r = 0;
      for (var k = 0; k < 15; k++) { r = (r << 1) | ((v >>> k) & 1); }
      return r;
    }
    var cands = [reverse15(a), b];
    var best = null, bestDiff = 99;
    for (var c = 0; c < cands.length; c++) {
      for (var f = 0; f < FORMAT_TABLE.length; f++) {
        var diff = popcount(cands[c] ^ FORMAT_TABLE[f].bits);
        if (diff < bestDiff) { bestDiff = diff; best = FORMAT_TABLE[f]; }
      }
    }
    return bestDiff <= 3 ? best : null;
  }

  /** 機能パターン（読み飛ばす位置）の地図 */
  function functionMap(version, size) {
    var f = [];
    var x, y;
    for (y = 0; y < size; y++) f.push(new Uint8Array(size));
    function mark(x0, y0, w0, h0) {
      for (var yy = y0; yy < y0 + h0; yy++) {
        for (var xx = x0; xx < x0 + w0; xx++) {
          if (xx >= 0 && yy >= 0 && xx < size && yy < size) f[yy][xx] = 1;
        }
      }
    }
    mark(0, 0, 9, 9);
    mark(size - 8, 0, 8, 9);
    mark(0, size - 8, 9, 8);
    for (x = 0; x < size; x++) { f[6][x] = 1; f[x][6] = 1; }
    var pos = I.getAlignmentPatternPositions(version);
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
        mark(pos[i] - 2, pos[j] - 2, 5, 5);
      }
    }
    if (version >= 7) {
      mark(size - 11, 0, 3, 6);
      mark(0, size - 11, 6, 3);
    }
    return f;
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
    return false;
  }

  function readCodewords(modules, size, version, mask) {
    var fn = functionMap(version, size);
    var bits = [];
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (fn[y][x]) continue;
          var v = modules[y][x] ? 1 : 0;
          if (maskBit(mask, x, y)) v ^= 1;
          bits.push(v);
        }
      }
    }
    var out = [];
    for (var i = 0; i + 8 <= bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      out.push(b);
    }
    return out;
  }

  /** 生成時の並べ替えを元に戻し、ブロックごとの[データ+誤り訂正]にする */
  function deinterleave(codewords, version, ecl) {
    var numBlocks = I.NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
    var blockEccLen = I.ECC_CODEWORDS_PER_BLOCK[ecl][version];
    var rawCodewords = Math.floor(I.getNumRawDataModules(version) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    for (var i = 0; i < numBlocks; i++) blocks.push([]);
    var k = 0;
    for (var idx = 0; idx < shortBlockLen + 1; idx++) {
      for (var b = 0; b < numBlocks; b++) {
        if (idx === shortBlockLen - blockEccLen && b < numShortBlocks) continue;
        if (k >= codewords.length) break;
        blocks[b].push(codewords[k++]);
      }
    }
    return { blocks: blocks, eccLen: blockEccLen };
  }

  /* ------------------------------------------------------------------ *
   * ⑥ リード・ソロモン復号（誤り訂正）
   * 多項式は「最高次から」の並びで扱う。
   * シンダイム → Berlekamp-Massey → Chien探索 → Forney の定石どおり。
   * ------------------------------------------------------------------ */
  function gdiv(a, b) {
    if (b === 0) throw new Error('0除算');
    if (a === 0) return 0;
    return EXP[(LOG[a] - LOG[b] + 255) % 255];
  }
  function ginv(a) { return EXP[(255 - LOG[a]) % 255]; }

  function polyEval(p, x) {
    var y = p[0];
    for (var i = 1; i < p.length; i++) y = gmul(y, x) ^ p[i];
    return y;
  }
  function polyScale(p, x) {
    var r = new Array(p.length);
    for (var i = 0; i < p.length; i++) r[i] = gmul(p[i], x);
    return r;
  }
  function polyAdd(p, q) {
    var len = Math.max(p.length, q.length);
    var r = new Array(len);
    for (var i = 0; i < len; i++) r[i] = 0;
    for (i = 0; i < p.length; i++) r[i + len - p.length] ^= p[i];
    for (i = 0; i < q.length; i++) r[i + len - q.length] ^= q[i];
    return r;
  }
  function polyMul(p, q) {
    var r = new Array(p.length + q.length - 1);
    for (var i = 0; i < r.length; i++) r[i] = 0;
    for (i = 0; i < p.length; i++) {
      for (var j = 0; j < q.length; j++) r[i + j] ^= gmul(p[i], q[j]);
    }
    return r;
  }

  /** シンダイム（先頭に0を置く定石の形） */
  function calcSyndromes(msg, nsym) {
    var s = [0];
    for (var i = 0; i < nsym; i++) s.push(polyEval(msg, EXP[i]));
    return s;
  }

  /** 誤り位置多項式（Berlekamp-Massey） */
  function findErrorLocator(synd, nsym) {
    var errLoc = [1], oldLoc = [1];
    for (var i = 0; i < nsym; i++) {
      var K = i + 1;
      var delta = synd[K];
      for (var j = 1; j < errLoc.length; j++) {
        delta ^= gmul(errLoc[errLoc.length - 1 - j], synd[K - j]);
      }
      oldLoc = oldLoc.concat([0]);
      if (delta !== 0) {
        if (oldLoc.length > errLoc.length) {
          var newLoc = polyScale(oldLoc, delta);
          oldLoc = polyScale(errLoc, ginv(delta));
          errLoc = newLoc;
        }
        errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
      }
    }
    while (errLoc.length && errLoc[0] === 0) errLoc.shift();
    return errLoc;
  }

  /** 誤りの位置（先頭からの添字） */
  function findErrorPositions(errLoc, msgLen) {
    var errs = errLoc.length - 1;
    var pos = [];
    for (var i = 0; i < msgLen; i++) {
      if (polyEval(errLoc, EXP[(255 - i) % 255]) === 0) pos.push(msgLen - 1 - i);
    }
    return pos.length === errs ? pos : null;
  }

  /** 誤り評価多項式 */
  function findErrorEvaluator(syndRev, errLoc, nsym) {
    var r = polyMul(syndRev, errLoc);
    return r.slice(r.length - (nsym + 1));
  }

  /**
   * 1ブロックを訂正して、データ部だけを返す。訂正できなければ null。
   */
  function rsCorrect(block, eccLen) {
    var msg = block.slice();
    var synd = calcSyndromes(msg, eccLen);
    var clean = true;
    for (var i = 1; i < synd.length; i++) if (synd[i] !== 0) { clean = false; break; }
    if (clean) return msg.slice(0, msg.length - eccLen);

    var errLoc = findErrorLocator(synd, eccLen);
    var numErr = errLoc.length - 1;
    if (numErr <= 0 || numErr * 2 > eccLen) return null;

    var errPos = findErrorPositions(errLoc, msg.length);
    if (!errPos) return null;

    // Forney: 誤りの大きさを求める。
    // ここだけは「低次から」の並びで計算する（次数のずれを避けるため）。
    var coefPos = [];
    for (i = 0; i < errPos.length; i++) coefPos.push(msg.length - 1 - errPos[i]);
    var X = [];
    for (i = 0; i < coefPos.length; i++) X.push(EXP[coefPos[i] % 255]);

    var S = [];                                  // S[j] = シンダイム j
    for (i = 0; i < eccLen; i++) S.push(synd[i + 1]);
    var sigmaLow = errLoc.slice().reverse();     // 誤り位置多項式（低次から）

    // Ω(x) = S(x)・σ(x) mod x^eccLen
    var omega = [];
    for (i = 0; i < eccLen; i++) omega.push(0);
    for (var a = 0; a < S.length; a++) {
      for (var b = 0; b < sigmaLow.length; b++) {
        if (a + b < eccLen) omega[a + b] ^= gmul(S[a], sigmaLow[b]);
      }
    }

    for (i = 0; i < X.length; i++) {
      var xiInv = ginv(X[i]);
      // σ'(X^-1) の代わりに Π(1 + Xj・X^-1) を使う（X の因子は約分で消える）
      var denom = 1;
      for (var j = 0; j < X.length; j++) {
        if (j !== i) denom = gmul(denom, 1 ^ gmul(X[j], xiInv));
      }
      if (denom === 0) return null;
      var num = 0, pw = 1;
      for (var t = 0; t < omega.length; t++) {
        num ^= gmul(omega[t], pw);
        pw = gmul(pw, xiInv);
      }
      msg[errPos[i]] ^= gdiv(num, denom);
    }

    // 訂正できたか確かめる
    var check = calcSyndromes(msg, eccLen);
    for (i = 1; i < check.length; i++) if (check[i] !== 0) return null;
    return msg.slice(0, msg.length - eccLen);
  }

  /* ------------------------------------------------------------------ *
   * ビット列 -> 文字列
   * ------------------------------------------------------------------ */
  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function bytesToUtf8(bytes) {
    var out = '';
    for (var j = 0; j < bytes.length; ) {
      var b = bytes[j];
      if (b < 0x80) { out += String.fromCharCode(b); j += 1; }
      else if (b < 0xe0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[j + 1] & 0x3f)); j += 2; }
      else if (b < 0xf0) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[j + 1] & 0x3f) << 6) | (bytes[j + 2] & 0x3f));
        j += 3;
      } else {
        var cp = ((b & 0x07) << 18) | ((bytes[j + 1] & 0x3f) << 12) | ((bytes[j + 2] & 0x3f) << 6) | (bytes[j + 3] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        j += 4;
      }
    }
    return out;
  }

  function parseBits(data, version) {
    var bitPos = 0;
    var totalBits = data.length * 8;
    function read(n) {
      var v = 0;
      for (var i = 0; i < n; i++) {
        if (bitPos >= totalBits) throw new Error('データが途中で終わっています');
        v = (v << 1) | ((data[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
        bitPos++;
      }
      return v;
    }
    function countBits(mode) {
      if (version <= 9) return mode === 1 ? 10 : mode === 2 ? 9 : 8;
      if (version <= 26) return mode === 1 ? 12 : mode === 2 ? 11 : mode === 4 ? 16 : 10;
      return mode === 1 ? 14 : mode === 2 ? 13 : mode === 4 ? 16 : 12;
    }

    var text = '';
    var bytes = [];
    while (bitPos + 4 <= totalBits) {
      var mode = read(4);
      if (mode === 0) break;                       // 終端
      if (mode === 7) { read(8); continue; }        // ECI（既定のUTF-8として扱う）
      var count = read(countBits(mode));
      if (mode === 4) {                             // バイトモード
        for (var i = 0; i < count; i++) bytes.push(read(8));
      } else if (mode === 1) {                      // 数字
        if (bytes.length) { text += bytesToUtf8(bytes); bytes = []; }
        var rest = count;
        while (rest >= 3) { var v3 = read(10); text += ('00' + v3).slice(-3); rest -= 3; }
        if (rest === 2) { var v2 = read(7); text += ('0' + v2).slice(-2); }
        else if (rest === 1) { text += String(read(4)); }
      } else if (mode === 2) {                      // 英数字
        if (bytes.length) { text += bytesToUtf8(bytes); bytes = []; }
        var r2 = count;
        while (r2 >= 2) { var pair = read(11); text += ALNUM.charAt(Math.floor(pair / 45)) + ALNUM.charAt(pair % 45); r2 -= 2; }
        if (r2 === 1) text += ALNUM.charAt(read(6));
      } else {
        throw new Error('未対応のモードです（漢字モード等）');
      }
    }
    if (bytes.length) text += bytesToUtf8(bytes);
    return text;
  }

  /* ------------------------------------------------------------------ *
   * 全体の流れ
   * ------------------------------------------------------------------ */
  function decodeMatrix(modules, size) {
    var version = (size - 17) / 4;
    if (version < 1 || version > 40 || version !== Math.floor(version)) return null;
    var fmt = readFormat(modules, size);
    if (!fmt) return null;
    var codewords = readCodewords(modules, size, version, fmt.mask);
    var di = deinterleave(codewords, version, fmt.ecl);
    var data = [];
    for (var b = 0; b < di.blocks.length; b++) {
      var fixed = rsCorrect(di.blocks[b], di.eccLen);
      if (!fixed) return null;
      for (var i = 0; i < fixed.length; i++) data.push(fixed[i]);
    }
    try {
      var text = parseBits(data, version);
      return text ? { text: text, version: version, ecl: fmt.ecl, mask: fmt.mask } : null;
    } catch (e) {
      return null;
    }
  }

  /** 2値画像から読み取る */
  function decodeBits(bits, w, h) {
    var finders = findFinders(bits, w, h);
    if (finders.length < 3) return null;

    // 上位いくつかの組み合わせを試す（画面内に他の模様があっても拾えるように）
    var tryList = finders.slice(0, 5);
    for (var a = 0; a < tryList.length; a++) {
      for (var b = a + 1; b < tryList.length; b++) {
        for (var c = b + 1; c < tryList.length; c++) {
          var res = tryTriple(bits, w, h, [tryList[a], tryList[b], tryList[c]]);
          if (res) return res;
        }
      }
    }
    return null;
  }

  function tryTriple(bits, w, h, three) {
    var o = orderFinders(three);
    var rawModule = (o.tl.size + o.tr.size + o.bl.size) / 3;
    if (!(rawModule > 0.7)) return null;

    /*
     * 切り出しシンボルの大きさは「横方向の走査」で測っているため、
     * 斜めから撮ると実際より大きく出る（正方形を斜めに横切るぶん伸びる）。
     * 左上→右上の向きから角度を求めて、その伸びを打ち消す。
     */
    var ang = Math.atan2(o.tr.y - o.tl.y, o.tr.x - o.tl.x);
    var stretch = Math.abs(Math.cos(ang)) + Math.abs(Math.sin(ang));
    var moduleSize = rawModule / (stretch > 0 ? stretch : 1);

    var base = estimateDimension(o, moduleSize);
    // 推定は誤差が出るので、前後の候補も順に試す（誤り訂正が合否を判定してくれる）
    var candidates = [base];
    for (var d = 4; d <= 12; d += 4) { candidates.push(base + d); candidates.push(base - d); }

    for (var ci = 0; ci < candidates.length; ci++) {
      var res = tryDimension(bits, w, h, o, moduleSize, candidates[ci]);
      if (res) return res;
    }
    return null;
  }

  function tryDimension(bits, w, h, o, moduleSize, dimension) {
    if (dimension < 21 || dimension > 177 || (dimension & 3) !== 1) return null;
    var version = (dimension - 17) / 4;

    var bottomRightX = o.tr.x + o.bl.x - o.tl.x;
    var bottomRightY = o.tr.y + o.bl.y - o.tl.y;

    // 位置合わせパターン（右下）が見つかると、傾きに強い変換が作れる
    var alignment = null;
    if (version >= 2) {
      var corr = 1 - 3 / (dimension - 7);
      var estX = o.tl.x + corr * (bottomRightX - o.tl.x);
      var estY = o.tl.y + corr * (bottomRightY - o.tl.y);
      for (var f = 4; f <= 16 && !alignment; f *= 2) {
        alignment = findAlignment(bits, w, h, estX, estY, f * moduleSize, moduleSize);
      }
    }

    var dimMinus3 = dimension - 3.5;
    var srcBRx, srcBRy, imgBRx, imgBRy;
    if (alignment) {
      srcBRx = dimMinus3 - 3.0;   // 位置合わせパターンの中心
      srcBRy = dimMinus3 - 3.0;
      imgBRx = alignment.x;
      imgBRy = alignment.y;
    } else {
      srcBRx = dimMinus3;
      srcBRy = dimMinus3;
      imgBRx = bottomRightX;
      imgBRy = bottomRightY;
    }

    var transform = quadToQuad(
      [3.5, 3.5, dimMinus3, 3.5, srcBRx, srcBRy, 3.5, dimMinus3],
      [o.tl.x, o.tl.y, o.tr.x, o.tr.y, imgBRx, imgBRy, o.bl.x, o.bl.y]
    );
    if (!transform) return null;

    var modules = sampleGrid(bits, w, h, dimension, transform);
    if (!modules) return null;
    var res = decodeMatrix(modules, dimension);
    if (res) return res;

    // 位置合わせパターンを使って外した場合は、四隅だけの変換でも試す
    if (alignment) {
      var t2 = quadToQuad(
        [3.5, 3.5, dimMinus3, 3.5, dimMinus3, dimMinus3, 3.5, dimMinus3],
        [o.tl.x, o.tl.y, o.tr.x, o.tr.y, bottomRightX, bottomRightY, o.bl.x, o.bl.y]
      );
      if (t2) {
        var m2 = sampleGrid(bits, w, h, dimension, t2);
        if (m2) return decodeMatrix(m2, dimension);
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 公開API
   * ------------------------------------------------------------------ */
  /** ImageData から読み取る。読めなければ null */
  function decodeImageData(imageData) {
    var w = imageData.width, h = imageData.height;
    var gray = toGray(imageData.data, w, h);
    var bits = binarize(gray, w, h);
    var res = decodeBits(bits, w, h);
    if (res) return res;
    // 白黒が反転している場合（黒地に白のQR）も試す
    for (var i = 0; i < bits.length; i++) bits[i] ^= 1;
    return decodeBits(bits, w, h);
  }

  global.QRDecode = {
    decodeImageData: decodeImageData,
    _internals: {
      binarize: binarize, toGray: toGray, findFinders: findFinders,
      decodeMatrix: decodeMatrix, decodeBits: decodeBits, rsCorrect: rsCorrect,
      readFormat: readFormat, deinterleave: deinterleave, parseBits: parseBits
    }
  };
})(window);
