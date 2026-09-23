/*
 * xlsxread.js - Excelブック（.xlsx）を読む
 *
 * 請負代金内訳書（様式第22）を取り込むために使う。外部の部品は使わない。
 *   .xlsx は ZIP の中に XML が入っているだけなので、
 *   ①ZIPの目次を読む → ②必要なXMLだけ取り出す → ③DOMParserで読む、の順に処理する。
 * 圧縮の展開はブラウザの DecompressionStream（deflate-raw）に任せている。
 */
(function (global) {
  'use strict';

  var MT = global.MT;

  function u16(v, i) { return v.getUint16(i, true); }
  function u32(v, i) { return v.getUint32(i, true); }

  /** ZIPの目次（セントラルディレクトリ）を読んで、名前→位置の表にする */
  function zipIndex(buf) {
    var view = new DataView(buf);
    var bytes = new Uint8Array(buf);
    var end = -1;
    var limit = Math.max(0, bytes.length - 66000);
    for (var i = bytes.length - 22; i >= limit; i--) {
      if (u32(view, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('Excelのファイルとして読めません（ZIPの目次が見つかりません）');
    var count = u16(view, end + 10);
    var dirAt = u32(view, end + 16);
    var out = {};
    var p = dirAt;
    for (var k = 0; k < count; k++) {
      if (u32(view, p) !== 0x02014b50) break;
      var method = u16(view, p + 10);
      var compSize = u32(view, p + 20);
      var nameLen = u16(view, p + 28);
      var extraLen = u16(view, p + 30);
      var commentLen = u16(view, p + 32);
      var localAt = u32(view, p + 42);
      var name = '';
      for (var c = 0; c < nameLen; c++) name += String.fromCharCode(bytes[p + 46 + c]);
      try { name = decodeURIComponent(escape(name)); } catch (e) { /* ASCIIのまま使う */ }
      out[name] = { method: method, compSize: compSize, localAt: localAt };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { view: view, bytes: bytes, entries: out };
  }

  function inflateRaw(bytes) {
    if (typeof global.DecompressionStream !== 'function') {
      return Promise.reject(new Error('このブラウザでは読み込めません。Chrome や Edge の新しい版でお試しください。'));
    }
    var ds = new global.DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  /** ZIPの中の1ファイルを、文字列として取り出す */
  function readEntry(zip, name) {
    var e = zip.entries[name];
    if (!e) return Promise.resolve(null);
    var v = zip.view;
    if (u32(v, e.localAt) !== 0x04034b50) return Promise.reject(new Error('ZIPの中身が壊れています'));
    var nameLen = u16(v, e.localAt + 26);
    var extraLen = u16(v, e.localAt + 28);
    var start = e.localAt + 30 + nameLen + extraLen;
    var raw = zip.bytes.subarray(start, start + e.compSize);
    var got = e.method === 0 ? Promise.resolve(raw) : inflateRaw(raw);
    return got.then(function (out) { return new TextDecoder('utf-8').decode(out); });
  }

  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Excelの中身を読み取れませんでした');
    return doc;
  }

  /**
   * <si> や <is> の文字を取り出す。
   * ふりがな（<rPh>）は本文ではないので飛ばす（入れると「砂防堰堤サボウエンテイ」になってしまう）。
   */
  function textOf(node) {
    var s = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      var ch = node.childNodes[i];
      if (ch.nodeType !== 1) continue;
      var tag = (ch.localName || ch.nodeName || '').toLowerCase();
      if (tag === 't') s += ch.textContent;
      else if (tag === 'r') s += textOf(ch);          // 書式の変わり目で分かれた文字
    }
    return s;
  }

  /** 共有文字列（xl/sharedStrings.xml） */
  function sharedStrings(text) {
    if (!text) return [];
    var doc = parseXml(text);
    var out = [];
    var si = doc.getElementsByTagName('si');
    for (var i = 0; i < si.length; i++) out.push(textOf(si[i]));
    return out;
  }

  /** 'B12' → { col: 1, row: 11 }（どちらも0始まり） */
  function cellRef(ref) {
    var col = 0, i = 0;
    for (; i < ref.length; i++) {
      var ch = ref.charCodeAt(i);
      if (ch < 65 || ch > 90) break;
      col = col * 26 + (ch - 64);
    }
    return { col: col - 1, row: Number(ref.slice(i)) - 1 };
  }

  /** シート1枚を、rows[行][列] = 値 の形にする（空のセルは入れない） */
  function sheetRows(text, strings) {
    var doc = parseXml(text);
    var rows = [];
    var cs = doc.getElementsByTagName('c');
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      var ref = c.getAttribute('r');
      if (!ref) continue;
      var at = cellRef(ref);
      var type = c.getAttribute('t') || 'n';
      var value = null;
      if (type === 'inlineStr') {
        var is = c.getElementsByTagName('is');
        value = is.length ? textOf(is[0]) : '';
      } else {
        var vs = c.getElementsByTagName('v');
        if (!vs.length) continue;
        var raw = vs[0].textContent;
        if (type === 's') value = strings[Number(raw)] === undefined ? '' : strings[Number(raw)];
        else if (type === 'str' || type === 'e') value = raw;
        else value = Number(raw);
      }
      if (value === null || value === '') continue;
      if (!rows[at.row]) rows[at.row] = [];
      rows[at.row][at.col] = value;
    }
    return rows;
  }

  /**
   * ブックを読む。戻り値は { sheets: [{ name, rows }] }
   * rows は [行][列] の入れ子配列（値の無いところは undefined）。
   */
  MT.xlsxRead = function (arrayBuffer) {
    var zip;
    try { zip = zipIndex(arrayBuffer); } catch (e) { return Promise.reject(e); }

    return readEntry(zip, 'xl/sharedStrings.xml').then(function (ssText) {
      var strings = sharedStrings(ssText);
      return readEntry(zip, 'xl/workbook.xml').then(function (wbText) {
        var names = [];
        if (wbText) {
          var sheets = parseXml(wbText).getElementsByTagName('sheet');
          for (var i = 0; i < sheets.length; i++) names.push(sheets[i].getAttribute('name') || ('シート' + (i + 1)));
        }
        // xl/worksheets/sheetN.xml を、番号の順に読む
        var files = Object.keys(zip.entries).filter(function (n) {
          return /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
        }).sort(function (a, b) {
          return Number(a.replace(/\D+/g, '')) - Number(b.replace(/\D+/g, ''));
        });
        if (!files.length) throw new Error('シートが見つかりませんでした');
        return files.reduce(function (p, f, i) {
          return p.then(function (acc) {
            return readEntry(zip, f).then(function (text) {
              acc.push({ name: names[i] || ('シート' + (i + 1)), rows: sheetRows(text, strings) });
              return acc;
            });
          });
        }, Promise.resolve([])).then(function (list) { return { sheets: list }; });
      });
    });
  };
})(window);
