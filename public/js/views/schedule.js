/*
 * views/schedule.js - 工程（工種ごとの予定と進捗、全体の進捗率）
 *
 * 進捗率の考え方
 *   予定 … 各工種の予定期間の中で日割りした「今日までに終わっているはずの割合」を、重みで平均
 *   実績 … 各工種に入力した進捗（%）を、重みで平均
 *   重み … 工種ごとに入力（金額の構成比など）。空欄なら均等
 * 実績を保存するたびに、その日の全体進捗を記録し、出来高曲線（Sカーブ）に使う。
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var M = MT.model;
  var Store = MT.store;
  var esc = U.esc;

  /** その日の全体進捗を記録（1現場・1日につき1件） */
  function snapshot(siteId) {
    var today = U.todayStr();
    var p = M.progress(siteId, today);
    if (p.actual === null) return;
    var id = 'pl_' + siteId + '_' + today.replace(/-/g, '');
    if (id.length > 64) id = id.slice(0, 64);
    var rec = Store.raw('progress_logs', id) || { id: id, createdAt: new Date().toISOString() };
    rec.siteId = siteId;
    rec.date = today;
    rec.actual = p.actual;
    rec.planned = p.planned;
    Store.put('progress_logs', rec);
  }

  /* ------------------------------------------------------------------ *
   * ガントチャート（HTML）
   * ------------------------------------------------------------------ */
  function ganttHtml(site, tasks, forPrint) {
    var span = M.scheduleSpan(site, tasks);
    if (!U.isDate(span.from) || !U.isDate(span.to) || span.from >= span.to) {
      return '<p class="muted">工期、または工種の予定期間を入力すると、工程表が表示されます。</p>';
    }
    var total = U.diffDays(span.from, span.to) + 1;
    var today = U.todayStr();
    function pos(d) { return U.clamp(U.diffDays(span.from, d) / total * 100, 0, 100); }

    // 月の目盛り
    var ticks = '';
    var ym = span.from.slice(0, 7);
    var guard = 0;
    while (ym <= span.to.slice(0, 7) && guard++ < 60) {
      var start = ym + '-01' < span.from ? span.from : ym + '-01';
      var left = pos(start);
      ticks += '<span class="g-tick" style="left:' + left + '%">' + Number(ym.slice(5)) + '月</span>';
      ym = U.addMonths(ym, 1);
    }
    var todayLine = today >= span.from && today <= span.to ? '<span class="g-today" style="left:' + pos(today) + '%"></span>' : '';

    var rows = tasks.map(function (t) {
      var bar = '';
      if (U.isDate(t.planStart) && U.isDate(t.planEnd)) {
        var l = pos(t.planStart);
        var w = Math.max(0.6, pos(U.addDays(t.planEnd, 1)) - l);
        var prog = U.clamp(U.num(t.progress) || 0, 0, 100);
        var planned = M.taskPlanned(t, today);
        var late = prog + 0.001 < planned - 10;
        bar = '<span class="g-bar' + (late ? ' late' : '') + '" style="left:' + l + '%;width:' + w + '%">' +
          '<span class="g-done" style="width:' + prog + '%"></span></span>';
      }
      return '<div class="g-row"><div class="g-name">' + esc(t.name) +
        '<span class="g-pct">' + U.fmtNum(U.num(t.progress) || 0, 0) + '%</span></div>' +
        '<div class="g-track">' + bar + todayLine + '</div></div>';
    }).join('');

    return '<div class="gantt' + (forPrint ? ' print' : '') + '">' +
      '<div class="g-row g-head"><div class="g-name">工種</div><div class="g-track">' + ticks + '</div></div>' +
      rows + '</div>' +
      '<p class="legend">帯＝予定期間　濃い部分＝進捗（実績）　赤い帯＝予定より10ポイント以上遅れ　縦線＝今日</p>';
  }

  /* ------------------------------------------------------------------ *
   * 出来高曲線（SVG）
   * ------------------------------------------------------------------ */
  function curveSvg(site, tasks) {
    var span = M.scheduleSpan(site, tasks);
    if (!U.isDate(span.from) || !U.isDate(span.to) || span.from >= span.to) return '';
    var total = U.diffDays(span.from, span.to);
    var W = 640, H = 240, L = 36, R = 10, T = 12, B = 26;
    function x(d) { return L + U.clamp(U.diffDays(span.from, d) / total, 0, 1) * (W - L - R); }
    function y(p) { return T + (1 - U.clamp(p, 0, 100) / 100) * (H - T - B); }

    var step = Math.max(1, Math.round(total / 60));
    var pts = [];
    for (var i = 0; i <= total; i += step) {
      var d = U.addDays(span.from, i);
      pts.push(x(d).toFixed(1) + ',' + y(M.progress(site.id, d).planned).toFixed(1));
    }
    pts.push(x(span.to).toFixed(1) + ',' + y(M.progress(site.id, span.to).planned).toFixed(1));

    var logs = Store.list('progress_logs', null, site.id).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var actual = logs.map(function (l) { return x(l.date).toFixed(1) + ',' + y(U.num(l.actual) || 0).toFixed(1); });

    var grid = '';
    [0, 25, 50, 75, 100].forEach(function (p) {
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(p) + '" y2="' + y(p) + '" class="c-grid"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(p) + 4) + '" class="c-label" text-anchor="end">' + p + '%</text>';
    });
    var today = U.todayStr();
    var todayLine = today >= span.from && today <= span.to
      ? '<line x1="' + x(today) + '" x2="' + x(today) + '" y1="' + T + '" y2="' + (H - B) + '" class="c-today"/>' : '';

    return '<svg class="curve" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="出来高曲線">' + grid + todayLine +
      '<polyline points="' + pts.join(' ') + '" class="c-plan"/>' +
      (actual.length > 1 ? '<polyline points="' + actual.join(' ') + '" class="c-actual"/>' : '') +
      logs.map(function (l) { return '<circle cx="' + x(l.date).toFixed(1) + '" cy="' + y(U.num(l.actual) || 0).toFixed(1) + '" r="3" class="c-dot"/>'; }).join('') +
      '<text x="' + L + '" y="' + (H - 6) + '" class="c-label">' + esc(U.formatShort(span.from)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" class="c-label" text-anchor="end">' + esc(U.formatShort(span.to)) + '</text>' +
      '</svg><p class="legend"><span class="lg-plan">―</span> 予定　<span class="lg-actual">●―</span> 実績（進捗を保存した日ごと）</p>';
  }

  /* ------------------------------------------------------------------ *
   * 現場の「工程」タブ
   * ------------------------------------------------------------------ */
  MT.siteTabs.schedule = {
    label: '工程',
    badge: function (site) {
      var p = M.progress(site.id);
      return p.actual === null ? '' : Math.round(p.actual) + '%';
    },
    render: function (site) {
      var sid = encodeURIComponent(site.id);
      var tasks = M.tasks(site.id);
      var p = M.progress(site.id);
      var label = M.progressLabel(p);
      var html = '';

      if (!tasks.length) {
        html += UI.alert('info', '工種（掘削工、コンクリート工 など）ごとに予定期間を登録すると、予定に対する進捗率を計算します。');
      } else {
        html += '<div class="kpi-grid">' +
          '<div class="kpi"><span class="kpi-fig">' + p.actual + '<span class="kpi-unit">%</span></span><span class="kpi-label">実績（全体）</span></div>' +
          '<div class="kpi"><span class="kpi-fig">' + p.planned + '<span class="kpi-unit">%</span></span><span class="kpi-label">予定（今日時点）</span></div>' +
          '<div class="kpi' + (label.cls === 'ng' ? ' alarm' : '') + '"><span class="kpi-fig small">' + esc(label.text) + '</span><span class="kpi-label">予定との差 ' + (p.diff > 0 ? '+' : '') + p.diff + 'pt</span></div>' +
          '</div>';
        html += UI.h2('GANTT', '工程表') + '<div class="card">' + ganttHtml(site, tasks) + '</div>';
        html += UI.h2('CURVE', '出来高曲線') + '<div class="card">' + curveSvg(site, tasks) + '</div>';

        html += UI.h2('PROGRESS', '進捗の入力');
        html += '<div class="card"><p class="section-note">各工種の進捗（%）を入れて「進捗を保存」を押してください。その日の全体進捗が記録されます。</p>' +
          '<div class="table-scroll"><table class="data progress-table"><thead><tr><th>工種</th><th>予定期間</th><th class="r">重み</th><th class="r">予定</th><th class="r">実績（%）</th></tr></thead><tbody>' +
          tasks.map(function (t) {
            return '<tr><td><a href="#/task/' + encodeURIComponent(t.id) + '/edit">' + esc(t.name) + '</a></td>' +
              '<td class="nowrap">' + esc(U.formatShort(t.planStart)) + '〜' + esc(U.formatShort(t.planEnd)) + '</td>' +
              '<td class="r">' + esc(t.weight === null || t.weight === undefined || t.weight === '' ? '－' : U.fmtNum(U.num(t.weight))) + '</td>' +
              '<td class="r">' + U.fmtNum(M.taskPlanned(t, U.todayStr()), 0) + '%</td>' +
              '<td class="r"><input type="number" class="pct-input" min="0" max="100" step="1" data-task="' + esc(t.id) + '" value="' + esc(U.num(t.progress) || 0) + '"></td></tr>';
          }).join('') + '</tbody></table></div>' +
          UI.btnRow('<button class="btn" id="b-progress">進捗を保存</button>') + '</div>';
      }

      html += UI.btnRow('<a class="btn secondary" href="#/task/new?site=' + sid + '">＋ 工種を追加</a>' +
        (tasks.length ? '<a class="btn plain" href="#/print/schedule?site=' + sid + '">工程表を印刷</a>' : ''));
      return html;
    },
    bind: function (site) {
      U.on('#b-progress', 'click', function () {
        var changed = 0;
        var bad = false;
        U.qsa('[data-task]').forEach(function (input) {
          var t = Store.get('tasks', input.getAttribute('data-task'));
          if (!t) return;
          var v = U.num(input.value);
          if (v === null || v < 0 || v > 100) { bad = true; return; }
          if (U.num(t.progress) !== v) {
            t.progress = v;
            if (v > 0 && !t.actualStart) t.actualStart = U.todayStr();
            if (v >= 100 && !t.actualEnd) t.actualEnd = U.todayStr();
            Store.put('tasks', t);
            changed++;
          }
        });
        if (bad) return U.toast('進捗は0〜100の数字で入力してください');
        snapshot(site.id);
        U.toast(changed ? '進捗を保存しました' : '本日の進捗を記録しました');
        MT.rerender();
      });
    }
  };

  /* ------------------------------------------------------------------ *
   * 工種の登録・編集
   * ------------------------------------------------------------------ */
  function taskForm(task, siteId) {
    var isNew = !task;
    task = task || { siteId: siteId, progress: 0 };
    var site = Store.get('sites', task.siteId);
    if (!site) return MT.notFound('現場が見つかりません。');
    var back = '#/site/' + encodeURIComponent(site.id) + '?tab=schedule';
    U.app().innerHTML = UI.backLink(back, '工程へ戻る') +
      UI.pageHead('TASK', isNew ? '工種の追加' : '工種の編集') +
      '<p class="muted">' + esc(site.name) + (site.periodFrom ? '　工期 ' + esc(U.periodText(site.periodFrom, site.periodTo)) : '') + '</p>' +
      '<div class="card">' +
      UI.field('工種', UI.text('f-name', task.name, '例：準備工／掘削工／コンクリート工'), true) +
      '<div class="field-row">' + UI.field('予定（開始）', UI.date('f-ps', task.planStart || site.periodFrom), true) +
      UI.field('予定（終了）', UI.date('f-pe', task.planEnd || site.periodTo), true) + '</div>' +
      '<div class="field-row">' + UI.field('重み', UI.number('f-weight', task.weight, ' step="any" min="0"'), false, '金額の構成比など。空欄なら均等') +
      UI.field('進捗（%）', UI.number('f-progress', U.num(task.progress) || 0, ' step="1" min="0" max="100"')) + '</div>' +
      '<div class="field-row">' + UI.field('実績（開始）', UI.date('f-as', task.actualStart)) + UI.field('実績（終了）', UI.date('f-ae', task.actualEnd)) + '</div>' +
      UI.field('備考', UI.textarea('f-note', task.note)) +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="' + esc(back) + '">キャンセル</a>') +
      (isNew ? '' : UI.btnRow('<button class="btn danger" id="b-del">この工種を削除</button>'));

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name'), ps = U.val('#f-ps'), pe = U.val('#f-pe');
      var prog = U.num(U.val('#f-progress'));
      if (!name) return U.toast('工種を入力してください');
      if (!U.isDate(ps) || !U.isDate(pe)) return U.toast('予定期間を入力してください');
      if (ps > pe) return U.toast('予定の終了日は開始日より後にしてください');
      if (prog === null || prog < 0 || prog > 100) return U.toast('進捗は0〜100で入力してください');
      task.name = name;
      task.planStart = ps;
      task.planEnd = pe;
      task.weight = U.num(U.val('#f-weight'));
      task.progress = prog;
      task.actualStart = U.val('#f-as');
      task.actualEnd = U.val('#f-ae');
      task.note = U.val('#f-note');
      Store.put('tasks', task);
      snapshot(site.id);
      U.toast('保存しました');
      U.go(back);
    });
    U.on('#b-del', 'click', function () {
      if (!confirm('工種「' + task.name + '」を削除します。よろしいですか？')) return;
      Store.remove('tasks', task.id);
      snapshot(site.id);
      U.toast('削除しました');
      U.go(back);
    });
  }

  MT.route('task/new', { form: true }, function (m, params) { taskForm(null, params.site); });
  MT.route('task/([^/]+)/edit', { form: true }, function (m) {
    var t = Store.get('tasks', m[0]);
    if (!t) return MT.notFound('工種が見つかりません。');
    taskForm(t);
  });

  /* ------------------------------------------------------------------ *
   * 印刷：工程表
   * ------------------------------------------------------------------ */
  MT.route('print/schedule', { print: true }, function (m, params) {
    var site = Store.get('sites', params.site);
    if (!site) return MT.notFound('現場が見つかりません。');
    var tasks = M.tasks(site.id);
    var p = M.progress(site.id);
    U.app().innerHTML = UI.printBar('#/site/' + encodeURIComponent(site.id) + '?tab=schedule', '用紙の向きは横がおすすめです。') +
      '<div class="print-sheet"><div class="doc">' +
      '<div class="doc-head"><div><div class="doc-title">工程表（実施状況）</div><div class="doc-sub">' + esc(U.formatDate(U.todayStr())) + '現在</div></div>' +
      '<div class="doc-sub">' + esc((global.APP_CONFIG && global.APP_CONFIG.company) || '') + '</div></div>' +
      '<table class="meta"><tbody>' +
      '<tr><th>工事名</th><td colspan="3">' + esc(site.name) + (site.contractNo ? '（工事番号：' + esc(site.contractNo) + '）' : '') + '</td></tr>' +
      '<tr><th>工期</th><td>' + esc(U.periodText(site.periodFrom, site.periodTo) || '－') + '</td><th>進捗</th><td>実績 ' + (p.actual === null ? '－' : p.actual + '%') + '／予定 ' + (p.planned === null ? '－' : p.planned + '%') + '</td></tr>' +
      '</tbody></table>' +
      ganttHtml(site, tasks, true) +
      '<table class="doc-table"><thead><tr><th>工種</th><th>予定開始</th><th>予定終了</th><th>実績開始</th><th>実績終了</th><th class="r">重み</th><th class="r">予定</th><th class="r">実績</th></tr></thead><tbody>' +
      tasks.map(function (t) {
        return '<tr><td>' + esc(t.name) + '</td><td>' + esc(U.formatShort(t.planStart)) + '</td><td>' + esc(U.formatShort(t.planEnd)) + '</td>' +
          '<td>' + esc(U.formatShort(t.actualStart)) + '</td><td>' + esc(U.formatShort(t.actualEnd)) + '</td>' +
          '<td class="r">' + (U.num(t.weight) === null ? '－' : U.fmtNum(U.num(t.weight))) + '</td>' +
          '<td class="r">' + U.fmtNum(M.taskPlanned(t, U.todayStr()), 0) + '%</td><td class="r">' + U.fmtNum(U.num(t.progress) || 0, 0) + '%</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="curve-print">' + curveSvg(site, tasks) + '</div>' +
      '</div></div>';
    UI.bindPrint();
  });
})(window);
