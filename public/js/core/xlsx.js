/*
 * core/xlsx.js - Excelブック（.xlsx）を、この場で組み立てる
 *
 * 外部の部品は使わない（CSPで外部スクリプトを禁じているため）。
 * .xlsx は「XMLをZIPでまとめたもの」なので、ZIPの書き出しからXMLの組み立てまで自前で行う。
 *
 * できること
 *   ・文字・数値・日付・パーセントのセル、書式（太字・色・罫線・塗り・配置・縦書き）
 *   ・セルの結合、行の高さ、列幅、枠の固定、目盛線を隠す、印刷の設定
 *   ・Excelの本物のグラフ（横棒＝工程表／折れ線＝出来形／散布図＝表に重ねる曲線）
 *
 * 使い方
 *   MT.xlsx.save('工程表.xlsx', { sheets: [ { name:'工程表', rows:[…], … } ] });
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var X = {};
  MT.xlsx = X;

  /* ------------------------------------------------------------------ *
   * 文字とXML
   * ------------------------------------------------------------------ */
  var encoder = null;
  function utf8(s) {
    if (!encoder) encoder = new TextEncoder();
    return encoder.encode(s);
  }

  function x(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  var HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  /** 1 → A, 27 → AA */
  X.colName = function (n) {
    var s = '';
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = (n - 1 - r) / 26;
    }
    return s;
  };

  /** Excelの日付（1899-12-30 からの日数） */
  X.dateSerial = function (dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
    var a = Date.UTC(1899, 11, 30);
    var p = dateStr.split('-');
    var b = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return Math.round((b - a) / 86400000);
  };

  /* ------------------------------------------------------------------ *
   * ZIP（無圧縮で格納する。Excelはこの形式も読める）
   * ------------------------------------------------------------------ */
  var CRC = (function () {
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(files) {
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    var parts = [], central = [], offset = 0, total = 0;

    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);

      var lh = new Uint8Array(30);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      parts.push(lh, name, data);

      var ch = new Uint8Array(46);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.push(ch, name);

      offset += lh.length + name.length + data.length;
    });

    var cdSize = 0;
    central.forEach(function (b) { cdSize += b.length; });

    var eo = new Uint8Array(22);
    var ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    var all = parts.concat(central, [eo]);
    all.forEach(function (b) { total += b.length; });
    var out = new Uint8Array(total);
    var at = 0;
    all.forEach(function (b) { out.set(b, at); at += b.length; });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 書式（使われたぶんだけ作って、同じものは1つにまとめる）
   *   spec = { sz, b, i, color, name, fill, border:{l,r,t,b}, align:{h,v,wrap,rot}, fmt }
   *   border の各辺 = 'thin' | 'medium' | 'thick' | 'double' | {s:'thick', c:'FF0000'}
   * ------------------------------------------------------------------ */
  var BASE_FONT = 'Meiryo UI';

  function Styles() {
    this.numFmts = [];                                   // [{id, code}]
    this.fonts = ['<font><sz val="11"/><color rgb="FF000000"/><name val="' + BASE_FONT + '"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.map = {};
  }

  function pick(list, xml) {
    var i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }

  Styles.prototype.numFmt = function (code) {
    for (var i = 0; i < this.numFmts.length; i++) if (this.numFmts[i].code === code) return this.numFmts[i].id;
    var id = 164 + this.numFmts.length;
    this.numFmts.push({ id: id, code: code });
    return id;
  };

  Styles.prototype.id = function (spec) {
    if (!spec) return 0;
    var key = JSON.stringify(spec);
    if (this.map[key] !== undefined) return this.map[key];

    var f = '<font>' + (spec.b ? '<b/>' : '') + (spec.i ? '<i/>' : '') +
      '<sz val="' + (spec.sz || 11) + '"/><color rgb="FF' + (spec.color || '000000') + '"/>' +
      '<name val="' + (spec.name || BASE_FONT) + '"/></font>';
    var fontId = pick(this.fonts, f);

    var fillId = 0;
    if (spec.fill) {
      fillId = pick(this.fills, '<fill><patternFill patternType="solid">' +
        '<fgColor rgb="FF' + spec.fill + '"/><bgColor indexed="64"/></patternFill></fill>');
    }

    var borderId = 0;
    if (spec.border) {
      var b = spec.border;
      var side = function (tag, v) {
        if (!v) return '<' + tag + '/>';
        var st = typeof v === 'string' ? v : v.s;
        var c = (typeof v === 'string' ? '000000' : (v.c || '000000'));
        return '<' + tag + ' style="' + st + '"><color rgb="FF' + c + '"/></' + tag + '>';
      };
      borderId = pick(this.borders, '<border>' + side('left', b.l) + side('right', b.r) +
        side('top', b.t) + side('bottom', b.b) + '<diagonal/></border>');
    }

    var numId = spec.fmt ? this.numFmt(spec.fmt) : 0;
    var a = spec.align;
    var xf = '<xf numFmtId="' + numId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0"' +
      (numId ? ' applyNumberFormat="1"' : '') + ' applyFont="1"' +
      (fillId ? ' applyFill="1"' : '') + (borderId ? ' applyBorder="1"' : '') +
      (a ? ' applyAlignment="1"' : '') + '>' +
      (a ? '<alignment' + (a.h ? ' horizontal="' + a.h + '"' : '') + (a.v ? ' vertical="' + a.v + '"' : '') +
        (a.wrap ? ' wrapText="1"' : '') + (a.rot ? ' textRotation="' + a.rot + '"' : '') +
        (a.shrink ? ' shrinkToFit="1"' : '') + '/>' : '') +
      '</xf>';
    this.xfs.push(xf);
    var id = this.xfs.length - 1;
    this.map[key] = id;
    return id;
  };

  Styles.prototype.xml = function () {
    return HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.numFmts.length ? '<numFmts count="' + this.numFmts.length + '">' +
        this.numFmts.map(function (n) { return '<numFmt numFmtId="' + n.id + '" formatCode="' + x(n.code) + '"/>'; }).join('') +
        '</numFmts>' : '') +
      '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts>' +
      '<fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills>' +
      '<borders count="' + this.borders.length + '">' + this.borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  };

  /* ------------------------------------------------------------------ *
   * セル・シート
   * ------------------------------------------------------------------ */
  function cellXml(ref, v, styles) {
    if (v === null || v === undefined || v === '') return '';

    var spec = null, val = v;
    if (typeof v === 'object') {
      spec = v.s || null;
      if (v.date !== undefined) {
        if (!v.date) return spec ? '<c r="' + ref + '" s="' + styles.id(spec) + '"/>' : '';
        val = X.dateSerial(v.date);
        if (val === null) return '';
        spec = Object.assign({ fmt: 'yyyy/m/d' }, spec || {});
      } else if (v.pct !== undefined) {
        if (v.pct === null) return spec ? '<c r="' + ref + '" s="' + styles.id(spec) + '"/>' : '';
        val = v.pct;
        spec = Object.assign({ fmt: '0.0"%"' }, spec || {});
      } else if (v.num !== undefined) {
        if (v.num === null || v.num === '') return spec ? '<c r="' + ref + '" s="' + styles.id(spec) + '"/>' : '';
        val = v.num;
      } else if (v.text !== undefined) {
        val = v.text;
        if (v.bold) spec = Object.assign({ b: true }, spec || {});
      } else if (v.v !== undefined) {
        val = v.v;
      } else {
        // 書式だけのセル（罫線を引くため）
        return '<c r="' + ref + '" s="' + styles.id(spec) + '"/>';
      }
    }

    var s = spec ? ' s="' + styles.id(spec) + '"' : '';
    if (val === null || val === undefined || val === '') return spec ? '<c r="' + ref + '"' + s + '/>' : '';
    if (typeof val === 'number') return '<c r="' + ref + '"' + s + '><v>' + val + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + x(val) + '</t></is></c>';
  }

  function sheetXml(sheet, styles) {
    var cols = '';
    (sheet.cols || []).forEach(function (c, i) {
      if (!c) return;
      cols += '<col min="' + (i + 1) + '" max="' + (c.to || i + 1) + '" width="' + (c.w || 9) + '" customWidth="1"/>';
    });

    var rows = '';
    (sheet.rows || []).forEach(function (row, r) {
      if (!row) return;
      var list = Array.isArray(row) ? row : (row.cells || []);
      var cells = '';
      list.forEach(function (v, c) {
        cells += cellXml(X.colName(c + 1) + (r + 1), v, styles);
      });
      var h = !Array.isArray(row) && row.h ? ' ht="' + row.h + '" customHeight="1"' : '';
      if (cells || h) rows += '<row r="' + (r + 1) + '"' + h + '>' + cells + '</row>';
    });

    var pane = '';
    if (sheet.freeze) {
      var topLeft = X.colName((sheet.freeze.x || 0) + 1) + ((sheet.freeze.y || 0) + 1);
      pane = '<pane' + (sheet.freeze.x ? ' xSplit="' + sheet.freeze.x + '"' : '') +
        (sheet.freeze.y ? ' ySplit="' + sheet.freeze.y + '"' : '') +
        ' topLeftCell="' + topLeft + '" activePane="bottomRight" state="frozen"/>';
    }

    var p = sheet.print || {};
    var merges = sheet.merges && sheet.merges.length
      ? '<mergeCells count="' + sheet.merges.length + '">' +
        sheet.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>'
      : '';

    return HEAD +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      (p.fitW || p.fitH ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '') +
      '<sheetViews><sheetView workbookViewId="0"' +
      (sheet.gridLines === false ? ' showGridLines="0"' : '') +
      (sheet.zoom ? ' zoomScale="' + sheet.zoom + '" zoomScaleNormal="' + sheet.zoom + '"' : '') + '>' +
      pane + '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="' + (sheet.rowHeight || 18) + '"/>' +
      (cols ? '<cols>' + cols + '</cols>' : '') +
      '<sheetData>' + rows + '</sheetData>' +
      merges +
      '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>' +
      '<pageSetup paperSize="' + (p.paper || 9) + '" orientation="' + (p.landscape === false ? 'portrait' : 'landscape') + '"' +
      (p.fitW ? ' fitToWidth="' + p.fitW + '"' : '') + (p.fitH ? ' fitToHeight="' + p.fitH + '"' : '') +
      (p.fitW || p.fitH ? ' scale="100"' : '') + '/>' +
      (sheet.__drawing ? '<drawing r:id="rId1"/>' : '') +
      '</worksheet>';
  }

  /* ------------------------------------------------------------------ *
   * グラフ
   * ------------------------------------------------------------------ */
  function strRef(sheet, ref, values) {
    var pts = '';
    values.forEach(function (v, i) { pts += '<c:pt idx="' + i + '"><c:v>' + x(v) + '</c:v></c:pt>'; });
    return '<c:strRef><c:f>' + x(sheet) + '!' + ref + '</c:f>' +
      '<c:strCache><c:ptCount val="' + values.length + '"/>' + pts + '</c:strCache></c:strRef>';
  }

  function numRef(sheet, ref, values, fmt) {
    var pts = '';
    values.forEach(function (v, i) {
      if (v === null || v === undefined || v === '') return;
      pts += '<c:pt idx="' + i + '"><c:v>' + v + '</c:v></c:pt>';
    });
    return '<c:numRef><c:f>' + x(sheet) + '!' + ref + '</c:f>' +
      '<c:numCache><c:formatCode>' + x(fmt || 'General') + '</c:formatCode>' +
      '<c:ptCount val="' + values.length + '"/>' + pts + '</c:numCache></c:numRef>';
  }

  function fillPr(color) {
    return color === 'none'
      ? '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
      : '<c:spPr><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' +
        '<a:ln w="9525"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill></a:ln></c:spPr>';
  }

  function linePr(color, width, dash) {
    return '<c:spPr><a:ln w="' + (width || 19050) + '" cap="rnd"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' +
      (dash ? '<a:prstDash val="' + dash + '"/>' : '') + '<a:round/></a:ln><a:effectLst/></c:spPr>';
  }

  function txPr(size) {
    return '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + (size || 900) + '">' +
      '<a:latin typeface="' + BASE_FONT + '"/><a:ea typeface="' + BASE_FONT + '"/></a:defRPr></a:pPr>' +
      '<a:endParaRPr lang="ja-JP"/></a:p></c:txPr>';
  }

  function titleXml(text) {
    return '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1">' +
      '<a:latin typeface="' + BASE_FONT + '"/><a:ea typeface="' + BASE_FONT + '"/></a:defRPr></a:pPr>' +
      '<a:r><a:rPr lang="ja-JP" sz="1200" b="1"/><a:t>' + x(text) + '</a:t></a:r></a:p></c:rich></c:tx>' +
      '<c:overlay val="0"/></c:title>';
  }

  var AX1 = 111111111, AX2 = 222222222;

  function serXml(ch, s, i) {
    var name = s.nameRef
      ? '<c:tx>' + strRef(ch.sheet, s.nameRef, [s.name]) + '</c:tx>'
      : '<c:tx><c:v>' + x(s.name) + '</c:v></c:tx>';

    if (ch.kind === 'scatter') {
      return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + name +
        linePr(s.color, s.width, s.dash) +
        '<c:marker><c:symbol val="none"/></c:marker>' +
        '<c:xVal>' + numRef(s.sheet || ch.sheet, s.xRef, s.xValues, 'General') + '</c:xVal>' +
        '<c:yVal>' + numRef(s.sheet || ch.sheet, s.yRef, s.yValues, 'General') + '</c:yVal>' +
        '<c:smooth val="0"/></c:ser>';
    }

    var cat = '<c:cat>' + (ch.cat.text
      ? strRef(ch.sheet, ch.cat.ref, ch.cat.values)
      : numRef(ch.sheet, ch.cat.ref, ch.cat.values, ch.cat.fmt)) + '</c:cat>';
    var val = '<c:val>' + numRef(ch.sheet, s.ref, s.values, s.fmt) + '</c:val>';

    if (ch.kind === 'line') {
      return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + name +
        linePr(s.color, s.width, s.dash) +
        '<c:marker><c:symbol val="' + (s.marker || 'none') + '"/>' +
        (s.marker ? '<c:size val="5"/>' + fillPr(s.color) : '') + '</c:marker>' +
        cat + val + '<c:smooth val="0"/></c:ser>';
    }
    return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + name +
      fillPr(s.color) + '<c:invertIfNegative val="0"/>' + cat + val + '</c:ser>';
  }

  function axisXml(kind, opt, id, crossId, pos, hidden) {
    var v = opt || {};
    return '<c:' + kind + '><c:axId val="' + id + '"/>' +
      '<c:scaling><c:orientation val="' + (v.reverse ? 'maxMin' : 'minMax') + '"/>' +
      (v.max !== undefined && v.max !== null ? '<c:max val="' + v.max + '"/>' : '') +
      (v.min !== undefined && v.min !== null ? '<c:min val="' + v.min + '"/>' : '') +
      '</c:scaling><c:delete val="' + (hidden ? 1 : 0) + '"/><c:axPos val="' + pos + '"/>' +
      (v.grid ? '<c:majorGridlines/>' : '') +
      '<c:numFmt formatCode="' + x(v.numFmt || 'General') + '" sourceLinked="0"/>' +
      '<c:majorTickMark val="' + (hidden ? 'none' : 'out') + '"/><c:minorTickMark val="none"/>' +
      '<c:tickLblPos val="' + (hidden ? 'none' : 'nextTo') + '"/>' + txPr(v.size) +
      '<c:crossAx val="' + crossId + '"/><c:crosses val="' + (v.crosses || 'autoZero') + '"/>' +
      (kind === 'catAx' ? '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>' +
        (v.skip ? '<c:tickLblSkip val="' + v.skip + '"/><c:tickMarkSkip val="' + v.skip + '"/>' : '') +
        '<c:noMultiLvlLbl val="0"/>' : '<c:crossBetween val="' + (v.between || 'between') + '"/>' +
        (v.unit ? '<c:majorUnit val="' + v.unit + '"/>' : '')) +
      '</c:' + kind + '>';
  }

  function chartXml(ch) {
    var sers = ch.series.map(function (s, i) { return serXml(ch, s, i); }).join('');
    var plot, axes;

    if (ch.kind === 'scatter') {
      plot = '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>' + sers +
        '<c:axId val="' + AX1 + '"/><c:axId val="' + AX2 + '"/></c:scatterChart>';
      axes = axisXml('valAx', ch.xAx, AX1, AX2, 'b', ch.hideAxes) +
        axisXml('valAx', ch.yAx, AX2, AX1, 'l', ch.hideAxes);
    } else if (ch.kind === 'line') {
      plot = '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + sers +
        '<c:marker val="1"/><c:axId val="' + AX1 + '"/><c:axId val="' + AX2 + '"/></c:lineChart>';
      axes = axisXml('catAx', ch.cat, AX1, AX2, 'b', false) +
        axisXml('valAx', ch.valAx, AX2, AX1, 'l', false);
    } else {
      plot = '<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>' + sers +
        '<c:gapWidth val="' + (ch.gapWidth || 40) + '"/><c:overlap val="100"/>' +
        '<c:axId val="' + AX1 + '"/><c:axId val="' + AX2 + '"/></c:barChart>';
      var catOpt = Object.assign({}, ch.cat, { reverse: ch.reverseCat });
      var valOpt = Object.assign({ grid: true, crosses: ch.reverseCat ? 'max' : 'autoZero' }, ch.valAx);
      axes = axisXml('catAx', catOpt, AX1, AX2, 'l', false) +
        axisXml('valAx', valOpt, AX2, AX1, 'b', false);
    }

    var layout = ch.full
      ? '<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/>' +
        '<c:x val="0"/><c:y val="0"/><c:w val="1"/><c:h val="1"/></c:manualLayout></c:layout>'
      : '<c:layout/>';

    return HEAD +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:lang val="ja-JP"/><c:roundedCorners val="0"/>' +
      '<c:chart>' +
      (ch.title ? titleXml(ch.title) : '<c:autoTitleDeleted val="1"/>') +
      '<c:plotArea>' + layout + plot + axes +
      '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
      '</c:plotArea>' +
      (ch.legend ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/>' + txPr() + '</c:legend>' : '') +
      '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
      '</c:chart>' +
      '<c:spPr>' + (ch.transparent
        ? '<a:noFill/><a:ln><a:noFill/></a:ln>'
        : '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="D0D7E2"/></a:solidFill></a:ln>') +
      '</c:spPr></c:chartSpace>';
  }

  function anchorXml(anchor, rid, id) {
    var a = anchor || {};
    return '<xdr:twoCellAnchor>' +
      '<xdr:from><xdr:col>' + (a.col || 0) + '</xdr:col><xdr:colOff>' + (a.colOff || 0) + '</xdr:colOff>' +
      '<xdr:row>' + (a.row || 0) + '</xdr:row><xdr:rowOff>' + (a.rowOff || 0) + '</xdr:rowOff></xdr:from>' +
      '<xdr:to><xdr:col>' + (a.col2 || 12) + '</xdr:col><xdr:colOff>' + (a.colOff2 || 0) + '</xdr:colOff>' +
      '<xdr:row>' + (a.row2 || 24) + '</xdr:row><xdr:rowOff>' + (a.rowOff2 || 0) + '</xdr:rowOff></xdr:to>' +
      '<xdr:graphicFrame macro="">' +
      '<xdr:nvGraphicFramePr><xdr:cNvPr id="' + id + '" name="グラフ' + id + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="' + rid + '"/>' +
      '</a:graphicData></a:graphic>' +
      '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
  }

  /* ------------------------------------------------------------------ *
   * 組み立て
   * ------------------------------------------------------------------ */
  X.build = function (spec) {
    var sheets = spec.sheets || [];
    var styles = new Styles();
    var files = [];
    function add(name, text) { files.push({ name: name, data: utf8(text) }); }

    var types = HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';

    var wbSheets = '', wbRels = '', chartNo = 0;

    sheets.forEach(function (sh, i) {
      var n = i + 1;
      var charts = sh.charts || (sh.chart ? [sh.chart] : []);
      sh.__drawing = charts.length > 0;

      types += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      wbSheets += '<sheet name="' + x(sh.name || ('Sheet' + n)) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
      wbRels += '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
      add('xl/worksheets/sheet' + n + '.xml', sheetXml(sh, styles));

      if (!charts.length) return;

      var anchors = '', rels = '';
      charts.forEach(function (ch, k) {
        chartNo++;
        var rid = 'rId' + (k + 1);
        anchors += anchorXml(ch.anchor, rid, k + 2);
        rels += '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + chartNo + '.xml"/>';
        types += '<Override PartName="/xl/charts/chart' + chartNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>';
        add('xl/charts/chart' + chartNo + '.xml', chartXml(ch));
      });
      types += '<Override PartName="/xl/drawings/drawing' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
      add('xl/worksheets/_rels/sheet' + n + '.xml.rels', HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + n + '.xml"/>' +
        '</Relationships>');
      add('xl/drawings/drawing' + n + '.xml', HEAD +
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"' +
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + anchors + '</xdr:wsDr>');
      add('xl/drawings/_rels/drawing' + n + '.xml.rels', HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>');
    });

    types += '</Types>';

    add('[Content_Types].xml', types);
    add('_rels/.rels', HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');
    add('xl/workbook.xml', HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<workbookPr date1904="0"/><sheets>' + wbSheets + '</sheets></workbook>');
    add('xl/_rels/workbook.xml.rels', HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wbRels +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');
    add('xl/styles.xml', styles.xml());

    return zip(files);
  };

  X.save = function (filename, spec) {
    MT.util.download(filename, X.build(spec),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
})(window);
