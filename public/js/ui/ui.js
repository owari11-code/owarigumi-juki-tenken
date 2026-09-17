/*
 * ui.js - 画面の部品
 * どの画面でも同じ見た目・同じ書き方になるよう、HTMLの組み立てをここに集める。
 * 引数の文字列は、ここでエスケープする（呼び出し側でHTMLを渡す引数は名前に Html を付ける）。
 */
(function (global) {
  'use strict';

  var U = global.MT.util;
  var esc = U.esc;

  var UI = {};

  UI.pageHead = function (kicker, title) {
    return '<div class="page-head"><span class="kicker">' + esc(kicker) + '</span>' +
      '<h1>' + esc(title) + '</h1></div>';
  };

  UI.backLink = function (href, label) {
    return '<a class="back-link" href="' + esc(href) + '">‹ ' + esc(label) + '</a>';
  };

  UI.corners = function () {
    return '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
  };

  UI.h2 = function (kicker, title, rightHtml) {
    return '<h2><span class="kicker">' + esc(kicker) + '</span>' + esc(title) +
      (rightHtml ? '<span class="h2-right">' + rightHtml + '</span>' : '') + '</h2>';
  };

  /** 一覧の1行。o.subHtml は組み立て済みのHTML */
  UI.rowLink = function (href, o) {
    var html = '<a class="row-link" href="' + esc(href) + '">';
    if (o.count !== undefined && o.count !== null) {
      html += '<span class="count ' + esc(o.countClass || '') + '">' +
        '<span class="n">' + esc(o.count) + '</span>' +
        (o.unit ? '<span class="unit">' + esc(o.unit) + '</span>' : '') + '</span>';
    }
    html += '<span class="body"><span class="main">' + esc(o.main) + '</span>';
    if (o.subHtml) html += '<span class="sub">' + o.subHtml + '</span>';
    if (o.tags && o.tags.length) html += '<span class="tags">' + o.tags.map(UI.tag).join('') + '</span>';
    html += '</span><span class="arrow">›</span></a>';
    return html;
  };

  UI.tag = function (t) {
    return '<span class="tag ' + esc(t.cls || 'none') + '">' + esc(t.text) + '</span>';
  };

  UI.field = function (label, inputHtml, required, hint) {
    return '<label class="field"><span>' + esc(label) +
      (required ? '<span class="required">必須</span>' : '') + '</span>' + inputHtml +
      (hint ? '<small class="hint-text">' + esc(hint) + '</small>' : '') + '</label>';
  };

  UI.text = function (id, value, placeholder, attrs) {
    return '<input type="text" id="' + id + '" value="' + esc(value || '') + '"' +
      (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + (attrs || '') + '>';
  };
  UI.date = function (id, value, attrs) {
    return '<input type="date" id="' + id + '" value="' + esc(value || '') + '"' + (attrs || '') + '>';
  };
  UI.number = function (id, value, attrs) {
    return '<input type="number" inputmode="decimal" id="' + id + '" value="' +
      esc(value === null || value === undefined ? '' : value) + '"' + (attrs || '') + '>';
  };
  UI.textarea = function (id, value, placeholder) {
    return '<textarea id="' + id + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '>' +
      esc(value || '') + '</textarea>';
  };
  /** options = [[value, label], ...] */
  UI.select = function (id, options, value, attrs) {
    return '<select id="' + id + '"' + (attrs || '') + '>' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' +
        esc(o[1]) + '</option>';
    }).join('') + '</select>';
  };
  UI.checkbox = function (id, label, checked) {
    return '<label class="check-line"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' +
      '<span>' + esc(label) + '</span></label>';
  };

  UI.btnRow = function (inner) { return '<div class="btn-row">' + inner + '</div>'; };

  UI.card = function (inner, cls) { return '<div class="card' + (cls ? ' ' + cls : '') + '">' + inner + '</div>'; };

  UI.empty = function (msg) { return '<div class="card"><p class="muted">' + esc(msg) + '</p></div>'; };

  UI.alert = function (kind, html) { return '<div class="alert ' + kind + '">' + html + '</div>'; };

  /** 上部のタブ。items = [[key, label, badge?], ...] */
  UI.tabs = function (hrefOf, items, active) {
    return '<nav class="tabs">' + items.map(function (it) {
      return '<a class="tab' + (it[0] === active ? ' on' : '') + '" href="' + esc(hrefOf(it[0])) + '">' +
        esc(it[1]) + (it[2] ? '<span class="tab-badge">' + esc(it[2]) + '</span>' : '') + '</a>';
    }).join('') + '</nav>';
  };

  /** 進み具合のバー（%） */
  UI.meter = function (pct, cls) {
    var p = U.clamp(Math.round(pct || 0), 0, 100);
    return '<span class="meter-line ' + (cls || '') + '"><span style="width:' + p + '%"></span></span>';
  };

  UI.stat = function (figureHtml, noteHtml) {
    return '<div class="stat blueprint">' + UI.corners() +
      '<div class="figure">' + figureHtml + '</div><div class="note">' + noteHtml + '</div></div>';
  };

  /** 期限の状態。days = 今日から期限まで（過ぎていれば負） */
  UI.dueTag = function (dateStr, label, warnDays) {
    if (!U.isDate(dateStr)) return null;
    var d = U.diffDays(U.todayStr(), dateStr);
    var w = warnDays === undefined ? 30 : warnDays;
    if (d < 0) return { cls: 'ng', text: label + ' 期限切れ', days: d, level: 2 };
    if (d <= w) return { cls: 'warn', text: label + ' あと' + d + '日', days: d, level: 1 };
    return { cls: 'none', text: label + ' ' + U.formatShort(dateStr), days: d, level: 0 };
  };

  /* ---------------- QR ---------------- */
  UI.baseUrl = function () {
    var cfg = global.APP_CONFIG || {};
    var local = '';
    try { local = localStorage.getItem('maruten-base-url') || ''; } catch (e) { /* 無視 */ }
    return local || cfg.baseUrl || location.href.split('#')[0];
  };

  /**
   * QRに入れる内容。現場の鍵（k）を含むので、このQRを読めばその現場の記録ができる。
   *   t: site / m(重機・機械) / g(点検対象) / mat(資材) / tool(工具)
   * 名前などは入れない（QRコードの目を粗くして、汚れたラベルでも読み取りやすくするため）。
   */
  UI.qrUrl = function (type, site, item) {
    var payload = { v: 2, t: type, s: site.id, k: site.fieldKey };
    if (item) payload.i = item.id;
    return UI.baseUrl() + '#q=' + U.b64urlEncode(JSON.stringify(payload));
  };

  UI.drawQr = function (container, text, maxWidth) {
    if (!container) return;
    try {
      container.innerHTML = global.QRCode.toSVG(text, { ecl: 'M', border: 2 });
      if (maxWidth && container.firstChild) container.firstChild.style.maxWidth = maxWidth + 'px';
    } catch (e) {
      container.innerHTML = '<div class="alert error">QRコードを作れませんでした：' + esc(e.message) + '</div>';
    }
  };

  /** 印刷ページの上部（印刷されない操作欄） */
  UI.printBar = function (backHref, noteHtml) {
    return '<div class="no-print">' + UI.backLink(backHref, '戻る') +
      '<div class="btn-row"><button class="btn" id="b-print">印刷する（PDF保存も可）</button></div>' +
      '<p class="muted">' + (noteHtml || '') +
      '印刷ダイアログの「送信先」を<strong>「PDFに保存」</strong>にすると、PDFファイルになります。</p></div>';
  };

  UI.bindPrint = function () {
    U.on('#b-print', 'click', function () { global.print(); });
  };

  /**
   * QRラベルを並べる。labels = [{ url, title, sub, badge, guide }]
   * 描画は innerHTML の後に drawLabels を呼ぶ。
   */
  UI.labelsHtml = function (labels) {
    return '<div class="print-sheet"><div class="label-grid">' + labels.map(function (l, i) {
      return '<div class="qr-label">' +
        (l.badge ? '<div class="m-badge">' + esc(l.badge) + '</div>' : '') +
        '<div class="qr" data-qr="' + i + '"></div>' +
        '<div class="m-name">' + esc(l.title) + '</div>' +
        (l.sub ? '<div class="m-sub">' + esc(l.sub) + '</div>' : '') +
        '<div class="m-guide">' + esc(l.guide || 'スマートフォンのカメラで読み取ってください') + '</div>' +
        '</div>';
    }).join('') + '</div></div>';
  };

  UI.drawLabels = function (labels) {
    labels.forEach(function (l, i) {
      UI.drawQr(U.qs('[data-qr="' + i + '"]'), l.url, 150);
    });
  };

  /** 月の選択肢 */
  UI.monthOptions = function (months, selected) {
    return months.map(function (m) { return [m, U.ymLabel(m)]; });
  };

  global.MT.ui = UI;
})(window);
