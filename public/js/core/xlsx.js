/*
 * core/xlsx.js - Excelブック（.xlsx）を、この場で組み立てる
 *
 * 外部の部品は使わない（CSPで外部スクリプトを禁じているため）。
 * .xlsx は「XMLをZIPでまとめたもの」なので、ZIPの書き出しからXMLの組み立てまで自前で行う。
 * 表だけでなく、Excelの本物のグラフ（横棒＝工程表、折れ線＝出来形）も入れる。
 * 本物のグラフなので、Excel側で色や期間を後から直せる。
 *
 * 使い方
 *   MT.xlsx.save('工程表.xlsx', {
 *     sheets: [{ name:'工程表', cols:[{w:18}], rows:[[{text:'工種',bold:true}], ['掘削工']], chart:{…} }]
 *   });
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
      lv.setUint16(4, 20, true);       // 展開に必要な版
      lv.setUint16(6, 0x0800, true);   // ファイル名はUTF-8
      lv.setUint16(8, 0, true);        // 無圧縮
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
      cv.setUint16(4, 20, true);       // 作成した版
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
   * シート（表）
   * ------------------------------------------------------------------ */
  // 書式：0=標準 1=見出し（太字） 2=日付 3=パーセント 4=見出し（中央）
  function cellXml(ref, v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'object') {
      if (v.date !== undefined) {
        var s = X.dateSerial(v.date);
        return s === null ? '' : '<c r="' + ref + '" s="2"><v>' + s + '</v></c>';
      }
      if (v.pct !== undefined) {
        return v.pct === null ? '' : '<c r="' + ref + '" s="3"><v>' + v.pct + '</v></c>';
      }
      if (v.num !== undefined) {
        return v.num === null ? '' : '<c r="' + ref + '"><v>' + v.num + '</v></c>';
      }
      var st = v.bold ? (v.center ? 4 : 1) : 0;
      return '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + x(v.text) + '</t></is></c>';
    }
    if (typeof v === 'number') return '<c r="' + ref + '"><v>' + v + '</v></c>';
    return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + x(v) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    var cols = '';
    (sheet.cols || []).forEach(function (c, i) {
      cols += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.w || 12) + '" customWidth="1"/>';
    });

    var rows = '';
    (sheet.rows || []).forEach(function (row, r) {
      var cells = '';
      (row || []).forEach(function (v, c) {
        cells += cellXml(X.colName(c + 1) + (r + 1), v);
      });
      if (cells) rows += '<row r="' + (r + 1) + '">' + cells + '</row>';
    });

    var view = sheet.freezeTop
      ? '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>'
      : '<sheetView workbookViewId="0"/>';

    return HEAD +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews>' + view + '</sheetViews>' +
      '<sheetFormatPr defaultRowHeight="18"/>' +
      (cols ? '<cols>' + cols + '</cols>' : '') +
      '<sheetData>' + rows + '</sheetData>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape"/>' +
      (sheet.chart ? '<drawing r:id="rId1"/>' : '') +
      '</worksheet>';
  }

  function stylesXml() {
    return HEAD +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2">' +
      '<numFmt numFmtId="164" formatCode="yyyy/m/d"/>' +
      '<numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/>' +
      '</numFmts>' +
      '<fonts count="2">' +
      '<font><sz val="11"/><color theme="1"/><name val="Meiryo UI"/></font>' +
      '<font><b/><sz val="11"/><color theme="1"/><name val="Meiryo UI"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEDF2F7"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFB0B7C3"/></left><right style="thin"><color rgb="FFB0B7C3"/></right>' +
      '<top style="thin"><color rgb="FFB0B7C3"/></top><bottom style="thin"><color rgb="FFB0B7C3"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="center"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
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

  function fill(color) {
    return color === 'none'
      ? '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
      : '<c:spPr><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' +
        '<a:ln w="9525"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill></a:ln></c:spPr>';
  }

  function lineFill(color, width) {
    return '<c:spPr><a:ln w="' + (width || 22225) + '" cap="rnd"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' +
      '<a:round/></a:ln><a:effectLst/></c:spPr>';
  }

  function txPr(size) {
    return '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + (size || 900) + '">' +
      '<a:latin typeface="Meiryo UI"/><a:ea typeface="Meiryo UI"/></a:defRPr></a:pPr><a:endParaRPr lang="ja-JP"/></a:p></c:txPr>';
  }

  function title(text) {
    return '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1">' +
      '<a:latin typeface="Meiryo UI"/><a:ea typeface="Meiryo UI"/></a:defRPr></a:pPr>' +
      '<a:r><a:rPr lang="ja-JP" sz="1200" b="1"/><a:t>' + x(text) + '</a:t></a:r></a:p></c:rich></c:tx>' +
      '<c:overlay val="0"/></c:title>';
  }

  var AX_CAT = 111111111, AX_VAL = 222222222;

  function serXml(ch, s, i) {
    var name = s.nameRef
      ? '<c:tx>' + strRef(ch.sheet, s.nameRef, [s.name]) + '</c:tx>'
      : '<c:tx><c:v>' + x(s.name) + '</c:v></c:tx>';
    var cat = '<c:cat>' + (ch.cat.text
      ? strRef(ch.sheet, ch.cat.ref, ch.cat.values)
      : numRef(ch.sheet, ch.cat.ref, ch.cat.values, ch.cat.fmt)) + '</c:cat>';
    var val = '<c:val>' + numRef(ch.sheet, s.ref, s.values, s.fmt) + '</c:val>';

    if (ch.kind === 'line') {
      return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + name +
        lineFill(s.color, s.width) +
        '<c:marker><c:symbol val="' + (s.marker || 'none') + '"/>' +
        (s.marker ? '<c:size val="5"/>' + fill(s.color) : '') + '</c:marker>' +
        cat + val + '<c:smooth val="0"/></c:ser>';
    }
    return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' + name +
      fill(s.color) + '<c:invertIfNegative val="0"/>' + cat + val + '</c:ser>';
  }

  function chartXml(ch) {
    var sers = ch.series.map(function (s, i) { return serXml(ch, s, i); }).join('');

    var plot;
    if (ch.kind === 'line') {
      plot = '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + sers +
        '<c:marker val="1"/>' +
        '<c:axId val="' + AX_CAT + '"/><c:axId val="' + AX_VAL + '"/></c:lineChart>';
    } else {
      plot = '<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>' + sers +
        '<c:gapWidth val="' + (ch.gapWidth || 40) + '"/><c:overlap val="100"/>' +
        '<c:axId val="' + AX_CAT + '"/><c:axId val="' + AX_VAL + '"/></c:barChart>';
    }

    var catAx = '<c:catAx><c:axId val="' + AX_CAT + '"/>' +
      '<c:scaling><c:orientation val="' + (ch.reverseCat ? 'maxMin' : 'minMax') + '"/></c:scaling>' +
      '<c:delete val="0"/><c:axPos val="' + (ch.kind === 'line' ? 'b' : 'l') + '"/>' +
      '<c:numFmt formatCode="' + x(ch.cat.fmt || 'General') + '" sourceLinked="0"/>' +
      '<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' + txPr(ch.catSize) +
      '<c:crossAx val="' + AX_VAL + '"/><c:crosses val="autoZero"/><c:auto val="1"/>' +
      '<c:lblAlgn val="ctr"/><c:lblOffset val="100"/>' +
      (ch.tickLblSkip ? '<c:tickLblSkip val="' + ch.tickLblSkip + '"/><c:tickMarkSkip val="' + ch.tickLblSkip + '"/>' : '') +
      '<c:noMultiLvlLbl val="0"/></c:catAx>';

    var v = ch.valAx || {};
    var valAx = '<c:valAx><c:axId val="' + AX_VAL + '"/>' +
      '<c:scaling><c:orientation val="minMax"/>' +
      (v.max !== undefined && v.max !== null ? '<c:max val="' + v.max + '"/>' : '') +
      (v.min !== undefined && v.min !== null ? '<c:min val="' + v.min + '"/>' : '') +
      '</c:scaling><c:delete val="0"/><c:axPos val="' + (ch.kind === 'line' ? 'l' : 'b') + '"/>' +
      '<c:majorGridlines/>' +
      '<c:numFmt formatCode="' + x(v.numFmt || 'General') + '" sourceLinked="0"/>' +
      '<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' + txPr() +
      '<c:crossAx val="' + AX_CAT + '"/><c:crosses val="' + (ch.reverseCat ? 'max' : 'autoZero') + '"/>' +
      '<c:crossBetween val="between"/>' +
      (v.unit ? '<c:majorUnit val="' + v.unit + '"/>' : '') +
      '</c:valAx>';

    return HEAD +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:lang val="ja-JP"/><c:roundedCorners val="0"/>' +
      '<c:chart>' +
      (ch.title ? title(ch.title) : '<c:autoTitleDeleted val="1"/>') +
      '<c:plotArea><c:layout/>' + plot + catAx + valAx +
      '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
      '</c:plotArea>' +
      (ch.legend === false ? '' : '<c:legend><c:legendPos val="b"/><c:overlay val="0"/>' + txPr() + '</c:legend>') +
      '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
      '</c:chart>' +
      '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
      '<a:ln><a:solidFill><a:srgbClr val="D0D7E2"/></a:solidFill></a:ln></c:spPr>' +
      '</c:chartSpace>';
  }

  function drawingXml(anchor) {
    var a = anchor || {};
    return HEAD +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<xdr:twoCellAnchor>' +
      '<xdr:from><xdr:col>' + (a.col || 0) + '</xdr:col><xdr:colOff>0</xdr:colOff>' +
      '<xdr:row>' + (a.row || 0) + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
      '<xdr:to><xdr:col>' + (a.col2 || 12) + '</xdr:col><xdr:colOff>0</xdr:colOff>' +
      '<xdr:row>' + (a.row2 || 24) + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
      '<xdr:graphicFrame macro="">' +
      '<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="グラフ"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>' +
      '</a:graphicData></a:graphic>' +
      '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
  }

  /* ------------------------------------------------------------------ *
   * 組み立て
   * ------------------------------------------------------------------ */
  X.build = function (spec) {
    var sheets = spec.sheets || [];
    var files = [];
    function add(name, text) { files.push({ name: name, data: utf8(text) }); }

    var types = HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';

    var wbSheets = '', wbRels = '';
    sheets.forEach(function (sh, i) {
      var n = i + 1;
      types += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      wbSheets += '<sheet name="' + x(sh.name || ('Sheet' + n)) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
      wbRels += '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
      add('xl/worksheets/sheet' + n + '.xml', sheetXml(sh));

      if (sh.chart) {
        types += '<Override PartName="/xl/drawings/drawing' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
          '<Override PartName="/xl/charts/chart' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>';
        add('xl/worksheets/_rels/sheet' + n + '.xml.rels', HEAD +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + n + '.xml"/>' +
          '</Relationships>');
        add('xl/drawings/drawing' + n + '.xml', drawingXml(sh.chart.anchor));
        add('xl/drawings/_rels/drawing' + n + '.xml.rels', HEAD +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + n + '.xml"/>' +
          '</Relationships>');
        add('xl/charts/chart' + n + '.xml', chartXml(sh.chart));
      }
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
    add('xl/styles.xml', stylesXml());

    return zip(files);
  };

  X.save = function (filename, spec) {
    MT.util.download(filename, X.build(spec),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
})(window);
