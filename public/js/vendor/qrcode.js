/*
 * qrcode.js - 依存ゼロのQRコード生成ライブラリ（バイトモード / Model 2 / Version 1-40）
 * オフライン環境・ファイル直開きでも動作するよう外部CDNを使わず自前実装している。
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * GF(256) 演算 (原始多項式 0x11D)
   * ------------------------------------------------------------------ */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* ------------------------------------------------------------------ *
   * リード・ソロモン
   * ------------------------------------------------------------------ */
  function rsGeneratorPoly(degree) {
    var result = new Uint8Array(degree);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gmul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gmul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, generator) {
    var result = new Uint8Array(generator.length);
    for (var k = 0; k < data.length; k++) {
      var factor = data[k] ^ result[0];
      for (var s = 0; s < result.length - 1; s++) result[s] = result[s + 1];
      result[result.length - 1] = 0;
      for (var j = 0; j < result.length; j++) {
        result[j] ^= gmul(generator[j], factor);
      }
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 誤り訂正テーブル (index 0 は未使用 / version 1-40)
   * ------------------------------------------------------------------ */
  var ECC_CODEWORDS_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };

  var NUM_ERROR_CORRECTION_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };

  var ECL_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* ------------------------------------------------------------------ *
   * 容量計算
   * ------------------------------------------------------------------ */
  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function getNumDataCodewords(ver, ecl) {
    return (
      Math.floor(getNumRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver]
    );
  }

  function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var size = ver * 4 + 17;
    // バージョン32のみ規格上の例外（等間隔則から外れる）
    var step = ver === 32 ? 26 : Math.ceil((size - 13) / (2 * numAlign - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 文字列 -> UTF-8 バイト列
   * ------------------------------------------------------------------ */
  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        i++;
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * ビットバッファ
   * ------------------------------------------------------------------ */
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.append = function (value, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  /* ------------------------------------------------------------------ *
   * データ符号化
   * ------------------------------------------------------------------ */
  function charCountBits(ver) {
    return ver <= 9 ? 8 : 16;
  }

  function encodeToCodewords(bytes, ver, ecl) {
    var capacityBits = getNumDataCodewords(ver, ecl) * 8;
    var bb = new BitBuffer();
    bb.append(0x4, 4); // バイトモード
    bb.append(bytes.length, charCountBits(ver));
    for (var i = 0; i < bytes.length; i++) bb.append(bytes[i], 8);

    // 終端 + パディング
    var bits = bb.bits;
    for (var t = 0; t < 4 && bits.length < capacityBits; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    var codewords = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
      codewords.push(v);
    }
    var padBytes = [0xec, 0x11];
    for (var p = 0; codewords.length < capacityBits / 8; p++) {
      codewords.push(padBytes[p % 2]);
    }
    return codewords;
  }

  function addEccAndInterleave(data, ver, ecl) {
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var gen = rsGeneratorPoly(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k + datLen);
      k += datLen;
      var ecc = rsRemainder(dat, gen);
      var block = dat.slice();
      if (i < numShortBlocks) block.push(0); // 整列用のダミー（後段で読み飛ばす）
      for (var e = 0; e < ecc.length; e++) block.push(ecc[e]);
      blocks.push(block);
    }

    var result = [];
    for (var idx = 0; idx < shortBlockLen + 1; idx++) {
      for (var b = 0; b < blocks.length; b++) {
        if (idx === shortBlockLen - blockEccLen && b < numShortBlocks) continue;
        result.push(blocks[b][idx]);
      }
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * マトリクス生成
   * ------------------------------------------------------------------ */
  function QRMatrix(ver, ecl) {
    this.version = ver;
    this.ecl = ecl;
    this.size = ver * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (var y = 0; y < this.size; y++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
  }

  QRMatrix.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  QRMatrix.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  QRMatrix.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  QRMatrix.prototype.drawFunctionPatterns = function () {
    var i;
    for (i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    var alignPos = getAlignmentPatternPositions(this.version);
    var n = alignPos.length;
    for (i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignmentPattern(alignPos[i], alignPos[j]);
      }
    }

    this.drawFormatBits(0); // 仮置き（領域予約）
    this.drawVersion();
  };

  QRMatrix.prototype.drawFormatBits = function (mask) {
    var data = (ECL_FORMAT_BITS[this.ecl] << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;

    for (var k = 0; k <= 5; k++) this.setFunctionModule(8, k, getBit(bits, k));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (var m = 9; m < 15; m++) this.setFunctionModule(14 - m, 8, getBit(bits, m));

    for (var p = 0; p < 8; p++) this.setFunctionModule(this.size - 1 - p, 8, getBit(bits, p));
    for (var q = 8; q < 15; q++) this.setFunctionModule(8, this.size - 15 + q, getBit(bits, q));
    this.setFunctionModule(8, this.size - 8, true); // 常時暗モジュール
  };

  QRMatrix.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (this.version << 12) | rem;
    for (var k = 0; k < 18; k++) {
      var bit = getBit(bits, k);
      var a = this.size - 11 + (k % 3);
      var b = Math.floor(k / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  };

  QRMatrix.prototype.drawCodewords = function (data) {
    var i = 0;
    for (var right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < this.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  QRMatrix.prototype.applyMask = function (mask) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  QRMatrix.prototype.getPenaltyScore = function () {
    var size = this.size, m = this.modules;
    var penalty = 0;
    var x, y, run, color;

    // 規則1: 同色5連以上
    for (y = 0; y < size; y++) {
      run = 1; color = m[y][0];
      for (x = 1; x < size; x++) {
        if (m[y][x] === color) { run++; }
        else { if (run >= 5) penalty += 3 + (run - 5); color = m[y][x]; run = 1; }
      }
      if (run >= 5) penalty += 3 + (run - 5);
    }
    for (x = 0; x < size; x++) {
      run = 1; color = m[0][x];
      for (y = 1; y < size; y++) {
        if (m[y][x] === color) { run++; }
        else { if (run >= 5) penalty += 3 + (run - 5); color = m[y][x]; run = 1; }
      }
      if (run >= 5) penalty += 3 + (run - 5);
    }

    // 規則2: 2x2 同色ブロック
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) penalty += 3;
      }
    }

    // 規則3: 1:1:3:1:1 + 4空白 パターン
    var pat = [true, false, true, true, true, false, true, false, false, false, false];
    var rpat = pat.slice().reverse();
    function matches(get, start, p) {
      for (var i = 0; i < 11; i++) if (get(start + i) !== p[i]) return false;
      return true;
    }
    for (y = 0; y < size; y++) {
      (function (row) {
        var get = function (i) { return m[row][i]; };
        for (var s = 0; s + 11 <= size; s++) {
          if (matches(get, s, pat)) penalty += 40;
          if (matches(get, s, rpat)) penalty += 40;
        }
      })(y);
    }
    for (x = 0; x < size; x++) {
      (function (col) {
        var get = function (i) { return m[i][col]; };
        for (var s = 0; s + 11 <= size; s++) {
          if (matches(get, s, pat)) penalty += 40;
          if (matches(get, s, rpat)) penalty += 40;
        }
      })(x);
    }

    // 規則4: 暗モジュール比率
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m[y][x]) dark++;
    var total = size * size;
    var k = Math.floor(Math.abs(dark * 20 - total * 10) / total);
    penalty += k * 10;

    return penalty;
  };

  function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
  }

  /* ------------------------------------------------------------------ *
   * 公開API
   * ------------------------------------------------------------------ */
  function encode(text, options) {
    options = options || {};
    var ecl = options.ecl || 'M';
    if (!ECC_CODEWORDS_PER_BLOCK[ecl]) throw new Error('不正な誤り訂正レベル: ' + ecl);
    var bytes = toUtf8Bytes(String(text));
    var minVersion = options.minVersion || 1;
    var maxVersion = options.maxVersion || 40;

    var ver = -1;
    for (var v = minVersion; v <= maxVersion; v++) {
      var capacityBits = getNumDataCodewords(v, ecl) * 8;
      if (4 + charCountBits(v) + bytes.length * 8 <= capacityBits) { ver = v; break; }
    }
    if (ver < 0) throw new Error('データが大きすぎてQRコードに収まりません（' + bytes.length + ' バイト）');

    var dataCodewords = encodeToCodewords(bytes, ver, ecl);
    var allCodewords = addEccAndInterleave(dataCodewords, ver, ecl);

    var qr = new QRMatrix(ver, ecl);
    qr.drawFunctionPatterns();
    qr.drawCodewords(allCodewords);

    var mask = options.mask;
    if (mask === undefined || mask === null) {
      var minPenalty = Infinity;
      for (var i = 0; i < 8; i++) {
        qr.applyMask(i);
        qr.drawFormatBits(i);
        var p = qr.getPenaltyScore();
        if (p < minPenalty) { minPenalty = p; mask = i; }
        qr.applyMask(i); // 元に戻す
      }
    }
    qr.applyMask(mask);
    qr.drawFormatBits(mask);

    return { size: qr.size, version: ver, ecl: ecl, mask: mask, modules: qr.modules };
  }

  /** SVG文字列を返す（印刷時にきれいに出るようベクタで生成） */
  function toSVG(text, options) {
    options = options || {};
    var qr = encode(text, options);
    var border = options.border === undefined ? 2 : options.border;
    var dim = qr.size + border * 2;
    var parts = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) parts.push('M' + (x + border) + ',' + (y + border) + 'h1v1h-1z');
      }
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="QRコード">' +
      '<rect width="100%" height="100%" fill="#ffffff"/>' +
      '<path d="' + parts.join('') + '" fill="#000000"/></svg>'
    );
  }

  function toDataURL(text, options) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toSVG(text, options));
  }

  global.QRCode = {
    encode: encode,
    toSVG: toSVG,
    toDataURL: toDataURL,
    _internals: {
      getNumDataCodewords: getNumDataCodewords,
      toUtf8Bytes: toUtf8Bytes,
      encodeToCodewords: encodeToCodewords,
      addEccAndInterleave: addEccAndInterleave,
      /* 読み取り側(qrdecode.js)と表を共有する */
      ECC_CODEWORDS_PER_BLOCK: ECC_CODEWORDS_PER_BLOCK,
      NUM_ERROR_CORRECTION_BLOCKS: NUM_ERROR_CORRECTION_BLOCKS,
      ECL_FORMAT_BITS: ECL_FORMAT_BITS,
      getNumRawDataModules: getNumRawDataModules,
      getAlignmentPatternPositions: getAlignmentPatternPositions,
      gmul: gmul, EXP: EXP, LOG: LOG
    }
  };
})(typeof window !== 'undefined' ? window : this);
