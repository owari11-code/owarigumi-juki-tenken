/*
 * views/home.js - ホーム
 *   事務所：ダッシュボード（稼働中の現場・本日の点検・注意すべきこと）
 *   現場  ：QRで入った現場の一覧
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var M = MT.model;
  var Store = MT.store;
  var Session = MT.session;
  var Cat = MT.cat;
  var esc = U.esc;

  MT.route('', { access: 'field' }, function () {
    if (Session.isAdmin()) return dashboard();
    return fieldHome();
  });

  /* ------------------------------------------------------------------ *
   * ダッシュボード（事務所）
   * ------------------------------------------------------------------ */
  function dashboard() {
    var sites = M.sites({ activeOnly: true });
    var today = U.todayStr();
    var alerts = M.alerts();
    var total = 0, done = 0;
    var perSite = sites.map(function (s) {
      var st = M.siteToday(s.id);
      total += st.total;
      done += st.done;
      return { site: s, today: st, progress: M.progress(s.id, today) };
    });
    var tools = Store.list('tools');
    var lent = tools.filter(function (t) { var st = M.toolState(t); return st.state === 'lent' || st.state === 'overdue'; }).length;
    var staffToday = M.assignments({ date: today });

    var html = UI.pageHead('DASHBOARD', U.formatDate(today) + '（' + U.weekday(today) + '）');

    html += '<div class="kpi-grid">' +
      kpi(sites.filter(function (s) { return s.status !== 'planned'; }).length, '現場', '施工中の現場', '#/sites') +
      kpi(done + '<span class="of">/' + total + '</span>', '', '本日の点検（完了／対象）', '#/sites') +
      kpi(alerts.filter(function (a) { return a.level === 2; }).length, '件', '対応が必要なこと', '#alerts', alerts.some(function (a) { return a.level === 2; })) +
      kpi(lent, '点', '貸出中の工具', '#/tools') +
      '</div>';

    html += UI.btnRow('<a class="btn lead" href="#/scan">■ QRを読み取る</a>');

    html += '<h2 id="alerts"><span class="kicker">ALERT</span>注意すべきこと</h2>';
    if (!alerts.length) {
      html += UI.empty('いま対応が必要なことはありません。');
    } else {
      html += '<ul class="alert-list">' + alerts.slice(0, 40).map(function (a) {
        return '<li class="lv' + a.level + '"><a href="' + esc(a.href) + '">' +
          '<span class="al-mark">' + (a.level === 2 ? '要対応' : '確認') + '</span>' +
          '<span class="al-body">' + (a.site ? '<span class="al-site">' + esc(a.site.name) + '</span>' : '') +
          esc(a.text) + '</span></a></li>';
      }).join('') + '</ul>';
      if (alerts.length > 40) html += '<p class="muted">ほか ' + (alerts.length - 40) + ' 件</p>';
    }

    html += UI.h2('SITES', '稼働中の現場');
    if (!perSite.length) {
      html += '<div class="card blueprint">' + UI.corners() +
        '<p><strong>はじめに</strong></p>' +
        '<p>①工事現場を登録　→　②重機・足場などの点検対象や資材を登録　→　③QRコードを印刷して現場に掲示・貼付　→　④現場ではQRを読むだけで記録できます。</p>' +
        '</div>';
    }
    html += '<ul class="list">';
    perSite.forEach(function (x) {
      var s = x.site;
      var st = x.today;
      var p = x.progress;
      var staff = staffToday.filter(function (a) { return a.siteId === s.id; }).length;
      var subs = [];
      if (s.contractNo) subs.push(esc(s.contractNo));
      if (s.periodTo) subs.push('工期末 ' + esc(U.formatShort(s.periodTo)));
      subs.push('配置 ' + staff + '名');
      var progressHtml = p.actual === null ? '' :
        '<span class="mini-progress">' + UI.meter(p.actual) + '<span>実績 ' + p.actual + '%／予定 ' + p.planned + '%</span></span>';
      var tags = [];
      if (st.ng) tags.push({ cls: 'ng', text: '否あり ' + st.ng });
      if (st.total) tags.push(st.done === st.total ? { cls: 'done', text: '本日点検 完了' } : { cls: 'none', text: '本日未点検 ' + (st.total - st.done) });
      if (s.status === 'planned') tags.push({ cls: 'none', text: '着工前' });
      tags.push(M.progressLabel(p));
      html += '<li>' + UI.rowLink('#/site/' + encodeURIComponent(s.id), {
        count: st.total ? Math.round(st.done / st.total * 100) : '－',
        unit: st.total ? '%点検' : '',
        countClass: !st.total ? 'idle' : (st.done === st.total ? 'done' : ''),
        main: s.name,
        subHtml: subs.join(' ／ ') + progressHtml,
        tags: tags
      }) + '</li>';
    });
    html += '</ul>';
    html += UI.btnRow('<a class="btn secondary" href="#/site/new">＋ 工事現場を登録</a><a class="btn plain" href="#/sites">すべての現場</a>');

    U.app().innerHTML = html;
    U.qsa('[data-scroll]').forEach(function (el) {
      el.addEventListener('click', function () {
        var target = document.getElementById(el.getAttribute('data-scroll'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /** 指標のタイル。href が「#名前」なら、その見出しまでスクロールする */
  function kpi(figureHtml, unit, label, href, alarm) {
    var inner = '<span class="kpi-fig">' + figureHtml + (unit ? '<span class="kpi-unit">' + esc(unit) + '</span>' : '') + '</span>' +
      '<span class="kpi-label">' + esc(label) + '</span>';
    if (href.indexOf('#/') !== 0) {
      return '<button type="button" class="kpi' + (alarm ? ' alarm' : '') + '" data-scroll="' + esc(href.slice(1)) + '">' + inner + '</button>';
    }
    return '<a class="kpi' + (alarm ? ' alarm' : '') + '" href="' + esc(href) + '">' + inner + '</a>';
  }

  /* ------------------------------------------------------------------ *
   * 現場の端末（QRで入った）
   * ------------------------------------------------------------------ */
  function fieldHome() {
    var list = Session.fieldSites();
    var html = UI.pageHead('FIELD', 'マル点');

    html += UI.btnRow('<a class="btn lead" href="#/scan">■ QRを読み取る</a>');

    if (!list.length) {
      html += '<div class="card blueprint">' + UI.corners() +
        '<p><strong>現場の方へ</strong></p>' +
        '<p>現場に掲示されたQRコード、または重機・足場・資材などに貼られたQRコードを、スマートフォンのカメラで読み取ってください。ログインは不要です。</p>' +
        '</div>' +
        '<p class="muted">事務所の方は<a href="#/login">ログイン</a>してください。</p>';
      U.app().innerHTML = html;
      return;
    }

    html += UI.h2('SITES', 'この端末で使える現場');
    html += '<ul class="list">';
    list.forEach(function (s) {
      var site = Store.get('sites', s.id);
      var name = (site && site.name) || s.name || '（名称未取得）';
      var tags = [];
      if (s.invalid) tags.push({ cls: 'ng', text: 'QRを読み直してください' });
      else if (site && !site.depot) {
        var st = M.siteToday(site.id);
        if (st.total) tags.push(st.done === st.total ? { cls: 'done', text: '本日点検 完了' } : { cls: 'none', text: '本日未点検 ' + (st.total - st.done) });
      }
      html += '<li>' + UI.rowLink(s.depot ? '#/tools-field' : '#/site/' + encodeURIComponent(s.id), {
        count: s.depot ? '工' : '現',
        unit: s.depot ? 'TOOLS' : 'SITE',
        countClass: s.invalid ? 'idle' : '',
        main: name,
        subHtml: s.depot ? '工具の持ち出し・返却' : '点検・資材・機械の記録',
        tags: tags
      }) + '</li>';
    });
    html += '</ul>';
    html += '<p class="muted">使わなくなった現場は、<a href="#/settings">設定</a>から外せます。</p>';
    U.app().innerHTML = html;
  }
})(window);
