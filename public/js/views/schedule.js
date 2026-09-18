/*
 * views/schedule.js - 工程（工種ごとの予定と進捗、全体の進捗率）
 *
 * 工程表は、マス目の上でドラッグして作る。
 *   何も無いところを横にドラッグ … その工種の予定期間を引く
 *   帯の中央をドラッグ           … 期間ごと前後に動かす
 *   帯の左右の端をドラッグ       … 開始日・終了日を変える
 *   帯の中の丸をドラッグ         … 進捗（%）を変える
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

  var ZOOM = { day: 22, week: 8, month: 3 };
  var zoom = null;              // 'day' | 'week' | 'month'（画面を開いている間だけ覚える）
  var scrollMemo = {};          // 現場ごとの横スクロール位置
  var ROW_H = 34;

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
   * 表示する期間（工期と工種から。月の初めから月の終わりまで）
   * ------------------------------------------------------------------ */
  function range(site, tasks) {
    var span = M.scheduleSpan(site, tasks);
    var from = U.isDate(span.from) ? span.from : U.addDays(U.todayStr(), -7);
    var to = U.isDate(span.to) && span.to > from ? span.to : U.addDays(from, 60);
    var f = from.slice(0, 7) + '-01';
    var ym = to.slice(0, 7);
    var t = ym + '-' + U.pad(U.daysInMonth(ym));
    return { from: f, to: t, days: U.diffDays(f, t) + 1 };
  }

  function autoZoom(days) {
    return days <= 62 ? 'day' : days <= 220 ? 'week' : 'month';
  }

  /* ------------------------------------------------------------------ *
   * 出来高曲線のもとになる数字（画面のグラフとExcelで同じものを使う）
   * ------------------------------------------------------------------ */
  function curveData(site, tasks) {
    var span = M.scheduleSpan(site, tasks);
    if (!U.isDate(span.from) || !U.isDate(span.to) || span.from >= span.to) return null;
    var total = U.diffDays(span.from, span.to);
    var step = Math.max(1, Math.ceil(total / 50));
    var today = U.todayStr();

    var dates = [], i;
    for (i = 0; i <= total; i += step) dates.push(U.addDays(span.from, i));
    if (dates[dates.length - 1] !== span.to) dates.push(span.to);
    if (today > span.from && today < span.to && dates.indexOf(today) < 0) {
      dates.push(today);
      dates.sort();
    }

    var logs = Store.list('progress_logs', null, site.id).sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    var now = M.progress(site.id);

    var plan = dates.map(function (d) { return M.progress(site.id, d).planned; });
    var actual = dates.map(function (d) {
      if (d > today) return null;
      if (d === today) return now.actual;
      var v = null;
      logs.forEach(function (l) { if (l.date && l.date <= d) v = U.num(l.actual); });
      return v;
    });
    return { from: span.from, to: span.to, dates: dates, plan: plan, actual: actual, today: today };
  }

  /* ------------------------------------------------------------------ *
   * 工程表（ドラッグで編集できるマス目）
   * ------------------------------------------------------------------ */
  function barHtml(t, r, px, today) {
    if (!U.isDate(t.planStart) || !U.isDate(t.planEnd)) return '';
    var left = U.diffDays(r.from, t.planStart) * px;
    var w = Math.max(px, (U.diffDays(t.planStart, t.planEnd) + 1) * px);
    var prog = U.clamp(U.num(t.progress) || 0, 0, 100);
    var late = prog + 0.001 < M.taskPlanned(t, today) - 10;
    return '<span class="ge-bar' + (late ? ' late' : '') + (prog >= 100 ? ' done' : '') +
      '" style="left:' + left + 'px;width:' + w + 'px">' +
      '<span class="ge-fill" style="width:' + prog + '%"></span>' +
      '<span class="ge-h h-l" title="開始日を変える"></span>' +
      '<span class="ge-h h-r" title="終了日を変える"></span>' +
      '<span class="ge-h h-p" style="left:' + prog + '%" title="進捗を変える"></span>' +
      '<span class="ge-cap' + (prog < 18 ? ' dark' : '') + '">' + U.fmtNum(prog, 0) + '%</span></span>';
  }

  function editorHtml(site, tasks) {
    var r = range(site, tasks);
    var z = zoom || autoZoom(r.days);
    var px = ZOOM[z];
    var width = Math.max(320, r.days * px);
    var today = U.todayStr();
    var headH = px >= 16 ? 40 : 24;

    // 月の見出し
    var head = '', lines = '', ym = r.from.slice(0, 7), guard = 0;
    while (ym <= r.to.slice(0, 7) && guard++ < 120) {
      var mStart = ym + '-01';
      var dim = U.daysInMonth(ym);
      var w = dim * px;
      var left = U.diffDays(r.from, mStart) * px;
      head += '<span class="ge-m" style="left:' + left + 'px;width:' + w + 'px">' +
        (ym.slice(5) === '01' || left === 0 ? Number(ym.slice(0, 4)) + '年' : '') + Number(ym.slice(5)) + '月</span>';
      if (left > 0) lines += '<span class="ge-line" style="left:' + left + 'px"></span>';
      ym = U.addMonths(ym, 1);
    }

    // 日の目盛り（日表示のときだけ）
    var days = '';
    if (px >= 16) {
      for (var i = 0; i < r.days; i++) {
        var d = U.addDays(r.from, i);
        var wd = U.parseDate(d).getDay();
        days += '<span class="ge-d' + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : '') +
          '" style="left:' + (i * px) + 'px;width:' + px + 'px">' + Number(d.slice(8)) + '</span>';
      }
    }

    if (today >= r.from && today <= r.to) {
      lines += '<span class="ge-today" style="left:' + (U.diffDays(r.from, today) * px + px / 2) + 'px"></span>';
    }

    var side = '<div class="ge-side-head">工種</div>';
    var tracks = '';
    tasks.forEach(function (t) {
      var prog = U.clamp(U.num(t.progress) || 0, 0, 100);
      side += '<div class="ge-name" data-task="' + esc(t.id) + '">' +
        '<a href="#/task/' + encodeURIComponent(t.id) + '/edit" title="' + esc(t.name) + '">' + esc(t.name) + '</a>' +
        '<b class="' + (prog >= 100 ? 'ok' : '') + '">' + U.fmtNum(prog, 0) + '%</b></div>';
      tracks += '<div class="ge-track" data-task="' + esc(t.id) + '">' + barHtml(t, r, px, today) + '</div>';
    });

    side += '<div class="ge-name new">' +
      '<input type="text" id="ge-new" maxlength="40" placeholder="工種名（例：掘削工）">' +
      '<button class="ge-add" id="ge-add" title="工種を追加">＋</button></div>';
    tracks += '<div class="ge-track new" data-task=""><span class="ge-hint">ここを横にドラッグすると、工種を追加できます</span></div>';

    return '<div class="ge" id="ge">' +
      '<div class="ge-side" style="--head-h:' + headH + 'px">' + side + '</div>' +
      '<div class="ge-scroll" id="ge-scroll"><div class="ge-body" style="width:' + width + 'px" ' +
      'data-px="' + px + '" data-from="' + r.from + '" data-total="' + r.days + '">' +
      '<div class="ge-head" style="height:' + headH + 'px">' + head + days + '</div>' +
      '<div class="ge-lines" style="top:' + headH + 'px">' + lines + '</div>' +
      tracks + '</div></div></div>' +
      '<div class="ge-tools">' +
      '<span class="ge-zoom">表示 ' +
      ['day', 'week', 'month'].map(function (k) {
        return '<button class="ge-z' + (k === z ? ' on' : '') + '" data-zoom="' + k + '">' +
          (k === 'day' ? '日' : k === 'week' ? '週' : '月') + '</button>';
      }).join('') + '</span>' +
      '<span class="legend">帯＝予定期間　濃い部分＝進捗　赤い帯＝10ポイント以上の遅れ　縦線＝今日</span>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ *
   * ドラッグの処理
   * ------------------------------------------------------------------ */
  function bindEditor(site) {
    var box = document.getElementById('ge');
    if (!box) return;
    var scroll = document.getElementById('ge-scroll');
    var body = U.qs('.ge-body', box);
    var px = Number(body.getAttribute('data-px'));
    var gFrom = body.getAttribute('data-from');
    var totalDays = Number(body.getAttribute('data-total'));
    var drag = null;

    if (scrollMemo[site.id]) scroll.scrollLeft = scrollMemo[site.id];
    scroll.addEventListener('scroll', function () { scrollMemo[site.id] = scroll.scrollLeft; });

    U.qsa('.ge-z', box.parentNode || document).forEach(function (b) {
      b.addEventListener('click', function () {
        zoom = b.getAttribute('data-zoom');
        scrollMemo[site.id] = 0;
        MT.rerender();
      });
    });

    function dayAt(clientX, track) {
      var rect = track.getBoundingClientRect();
      return U.clamp(Math.floor((clientX - rect.left) / px), 0, totalDays - 1);
    }

    function paint(bar, startDay, endDay, prog) {
      bar.style.left = (startDay * px) + 'px';
      bar.style.width = Math.max(px, (endDay - startDay + 1) * px) + 'px';
      var fill = U.qs('.ge-fill', bar), h = U.qs('.h-p', bar), cap = U.qs('.ge-cap', bar);
      if (fill) fill.style.width = prog + '%';
      if (h) h.style.left = prog + '%';
      if (cap) { cap.textContent = U.fmtNum(prog, 0) + '%'; cap.classList.toggle('dark', prog < 18); }
    }

    box.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var track = e.target.closest ? e.target.closest('.ge-track') : null;
      if (!track) return;
      var id = track.getAttribute('data-task');
      var task = id ? Store.get('tasks', id) : null;
      var bar = e.target.closest('.ge-bar');
      var mode = 'create';
      var cls = e.target.className || '';

      if (bar && task) {
        mode = /h-l/.test(cls) ? 'left' : /h-r/.test(cls) ? 'right' : /h-p/.test(cls) ? 'progress' : 'move';
      }

      var d0 = dayAt(e.clientX, track);
      var s0 = task && U.isDate(task.planStart) ? U.diffDays(gFrom, task.planStart) : d0;
      var e0 = task && U.isDate(task.planEnd) ? U.diffDays(gFrom, task.planEnd) : d0;

      drag = {
        mode: mode, track: track, task: task, bar: bar,
        grabDay: d0, s0: s0, e0: e0,
        start: mode === 'create' ? d0 : s0,
        end: mode === 'create' ? d0 : e0,
        prog: task ? U.clamp(U.num(task.progress) || 0, 0, 100) : 0,
        moved: false
      };

      if (mode === 'create') {
        // 仮の帯をその場に出す
        var tmp = document.createElement('span');
        tmp.className = 'ge-bar temp';
        tmp.innerHTML = '<span class="ge-fill" style="width:0%"></span><span class="ge-cap"></span>';
        track.appendChild(tmp);
        drag.bar = tmp;
        var hint = U.qs('.ge-hint', track);
        if (hint) hint.style.display = 'none';
      }
      paint(drag.bar, drag.start, drag.end, drag.prog);
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* 古い端末では無視 */ }
      e.preventDefault();
    });

    box.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var d = dayAt(e.clientX, drag.track);
      if (drag.mode === 'progress') {
        var rect = drag.bar.getBoundingClientRect();
        var p = U.clamp(Math.round((e.clientX - rect.left) / rect.width * 20) * 5, 0, 100);
        if (p !== drag.prog) { drag.prog = p; drag.moved = true; }
      } else if (drag.mode === 'create') {
        drag.start = Math.min(drag.grabDay, d);
        drag.end = Math.max(drag.grabDay, d);
        drag.moved = true;
      } else if (drag.mode === 'move') {
        var shift = d - drag.grabDay;
        drag.start = U.clamp(drag.s0 + shift, 0, totalDays - 1);
        drag.end = drag.start + (drag.e0 - drag.s0);
        if (shift !== 0) drag.moved = true;
      } else if (drag.mode === 'left') {
        drag.start = Math.min(d, drag.e0);
        drag.end = drag.e0;
        drag.moved = true;
      } else if (drag.mode === 'right') {
        drag.start = drag.s0;
        drag.end = Math.max(d, drag.s0);
        drag.moved = true;
      }
      paint(drag.bar, drag.start, drag.end, drag.prog);
    });

    function finish() {
      if (!drag) return;
      var d = drag;
      drag = null;
      var ps = U.addDays(gFrom, d.start), pe = U.addDays(gFrom, d.end);

      if (!d.moved) {
        if (d.mode === 'create' && d.bar && d.bar.parentNode) d.bar.parentNode.removeChild(d.bar);
        MT.rerender();
        return;
      }

      if (d.task) {
        if (d.mode === 'progress') {
          d.task.progress = d.prog;
          if (d.prog > 0 && !d.task.actualStart) d.task.actualStart = U.todayStr();
          if (d.prog >= 100 && !d.task.actualEnd) d.task.actualEnd = U.todayStr();
          if (d.prog < 100) d.task.actualEnd = d.task.actualEnd || '';
        } else {
          d.task.planStart = ps;
          d.task.planEnd = pe;
        }
        Store.put('tasks', d.task);
        snapshot(site.id);
        U.toast('保存しました');
      } else {
        var input = document.getElementById('ge-new');
        var name = (input && input.value.trim()) || '新しい工種';
        if (input) input.value = '';
        Store.put('tasks', {
          siteId: site.id, name: name, planStart: ps, planEnd: pe,
          progress: 0, weight: null, note: ''
        });
        snapshot(site.id);
        U.toast('「' + name + '」を追加しました');
      }
      MT.rerender();
    }

    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);

    function addByName() {
      var input = document.getElementById('ge-new');
      var name = input ? input.value.trim() : '';
      if (!name) { if (input) input.focus(); return U.toast('工種名を入力してください'); }
      var start = U.isDate(site.periodFrom) && site.periodFrom > U.todayStr() ? site.periodFrom : U.todayStr();
      Store.put('tasks', {
        siteId: site.id, name: name, planStart: start, planEnd: U.addDays(start, 6),
        progress: 0, weight: null, note: ''
      });
      snapshot(site.id);
      U.toast('「' + name + '」を追加しました。帯をドラッグして期間を合わせてください');
      MT.rerender();
    }

    U.on('#ge-add', 'click', addByName);
    U.on('#ge-new', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addByName(); } });
  }

  /* ------------------------------------------------------------------ *
   * 工程表（印刷用・動かせない形）
   * ------------------------------------------------------------------ */
  function ganttPrint(site, tasks) {
    var span = M.scheduleSpan(site, tasks);
    if (!U.isDate(span.from) || !U.isDate(span.to) || span.from >= span.to) {
      return '<p class="muted">工期、または工種の予定期間を入力すると、工程表が表示されます。</p>';
    }
    var total = U.diffDays(span.from, span.to) + 1;
    var today = U.todayStr();
    function pos(d) { return U.clamp(U.diffDays(span.from, d) / total * 100, 0, 100); }

    var ticks = '', ym = span.from.slice(0, 7), guard = 0;
    while (ym <= span.to.slice(0, 7) && guard++ < 60) {
      var start = ym + '-01' < span.from ? span.from : ym + '-01';
      ticks += '<span class="g-tick" style="left:' + pos(start) + '%">' + Number(ym.slice(5)) + '月</span>';
      ym = U.addMonths(ym, 1);
    }
    var todayLine = today >= span.from && today <= span.to
      ? '<span class="g-today" style="left:' + pos(today) + '%"></span>' : '';

    var rows = tasks.map(function (t) {
      var bar = '';
      if (U.isDate(t.planStart) && U.isDate(t.planEnd)) {
        var l = pos(t.planStart);
        var w = Math.max(0.6, pos(U.addDays(t.planEnd, 1)) - l);
        var prog = U.clamp(U.num(t.progress) || 0, 0, 100);
        var late = prog + 0.001 < M.taskPlanned(t, today) - 10;
        bar = '<span class="g-bar' + (late ? ' late' : '') + '" style="left:' + l + '%;width:' + w + '%">' +
          '<span class="g-done" style="width:' + prog + '%"></span></span>';
      }
      return '<div class="g-row"><div class="g-name">' + esc(t.name) +
        '<span class="g-pct">' + U.fmtNum(U.num(t.progress) || 0, 0) + '%</span></div>' +
        '<div class="g-track">' + bar + todayLine + '</div></div>';
    }).join('');

    return '<div class="gantt print">' +
      '<div class="g-row g-head"><div class="g-name">工種</div><div class="g-track">' + ticks + '</div></div>' +
      rows + '</div>' +
      '<p class="legend">帯＝予定期間　濃い部分＝進捗（実績）　赤い帯＝予定より10ポイント以上遅れ　縦線＝今日</p>';
  }

  /* ------------------------------------------------------------------ *
   * 出来高曲線（画面・印刷）
   * ------------------------------------------------------------------ */
  function curveSvg(site, tasks) {
    var c = curveData(site, tasks);
    if (!c) return '';
    var total = U.diffDays(c.from, c.to);
    var W = 640, H = 240, L = 36, R = 10, T = 12, B = 26;
    function x(d) { return L + U.clamp(U.diffDays(c.from, d) / total, 0, 1) * (W - L - R); }
    function y(p) { return T + (1 - U.clamp(p, 0, 100) / 100) * (H - T - B); }

    var plan = c.dates.map(function (d, i) { return x(d).toFixed(1) + ',' + y(c.plan[i]).toFixed(1); });
    var act = [], dots = '';
    c.dates.forEach(function (d, i) {
      if (c.actual[i] === null || c.actual[i] === undefined) return;
      act.push(x(d).toFixed(1) + ',' + y(c.actual[i]).toFixed(1));
      dots += '<circle cx="' + x(d).toFixed(1) + '" cy="' + y(c.actual[i]).toFixed(1) + '" r="2.5" class="c-dot"/>';
    });

    var grid = '';
    [0, 25, 50, 75, 100].forEach(function (p) {
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(p) + '" y2="' + y(p) + '" class="c-grid"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(p) + 4) + '" class="c-label" text-anchor="end">' + p + '%</text>';
    });
    var todayLine = c.today >= c.from && c.today <= c.to
      ? '<line x1="' + x(c.today) + '" x2="' + x(c.today) + '" y1="' + T + '" y2="' + (H - B) + '" class="c-today"/>' : '';

    return '<svg class="curve" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="出来高曲線">' + grid + todayLine +
      '<polyline points="' + plan.join(' ') + '" class="c-plan"/>' +
      (act.length > 1 ? '<polyline points="' + act.join(' ') + '" class="c-actual"/>' : '') + dots +
      '<text x="' + L + '" y="' + (H - 6) + '" class="c-label">' + esc(U.formatShort(c.from)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" class="c-label" text-anchor="end">' + esc(U.formatShort(c.to)) + '</text>' +
      '</svg><p class="legend"><span class="lg-plan">―</span> 予定　<span class="lg-actual">●―</span> 実績</p>';
  }

  /* ------------------------------------------------------------------ *
   * Excelに出力（本物のグラフ入り）
   * ------------------------------------------------------------------ */
  function toExcel(site, tasks) {
    var X = MT.xlsx;
    var today = U.todayStr();
    var r = range(site, tasks);
    var n = tasks.length;

    /* ① 工程表（横棒グラフ） */
    var rows1 = [[{ text: '工種', bold: true }, { text: '開始', bold: true }, { text: '日数', bold: true },
      { text: '終了', bold: true }, { text: '重み', bold: true }, { text: '予定(%)', bold: true },
      { text: '実績(%)', bold: true }, { text: '実績開始', bold: true }, { text: '実績終了', bold: true },
      { text: '備考', bold: true }]];
    var names = [], offs = [], lens = [];
    tasks.forEach(function (t) {
      var ok = U.isDate(t.planStart) && U.isDate(t.planEnd);
      var len = ok ? U.diffDays(t.planStart, t.planEnd) + 1 : null;
      names.push(t.name || '（名称なし）');
      offs.push(ok ? X.dateSerial(t.planStart) : null);
      lens.push(len);
      rows1.push([
        t.name, ok ? { date: t.planStart } : '', { num: len },
        ok ? { date: t.planEnd } : '',
        { num: U.num(t.weight) },
        { pct: Math.round(M.taskPlanned(t, today) * 10) / 10 },
        { pct: U.clamp(U.num(t.progress) || 0, 0, 100) },
        U.isDate(t.actualStart) ? { date: t.actualStart } : '',
        U.isDate(t.actualEnd) ? { date: t.actualEnd } : '',
        t.note || ''
      ]);
    });

    var last1 = n + 1;
    var sheet1 = {
      name: '工程表', freezeTop: true,
      cols: [{ w: 24 }, { w: 12 }, { w: 8 }, { w: 12 }, { w: 8 }, { w: 10 }, { w: 10 }, { w: 12 }, { w: 12 }, { w: 24 }],
      rows: rows1
    };
    if (n) {
      sheet1.chart = {
        kind: 'bar', sheet: '工程表', reverseCat: true, legend: false, gapWidth: 45,
        title: site.name + '　工程表（' + U.formatDate(today) + '現在）',
        anchor: { col: 10, row: 0, col2: 27, row2: Math.max(24, n + 4) },
        cat: { ref: '$A$2:$A$' + last1, values: names, text: true },
        series: [
          { name: '開始', nameRef: '$B$1', ref: '$B$2:$B$' + last1, values: offs, color: 'none' },
          { name: '日数', nameRef: '$C$1', ref: '$C$2:$C$' + last1, values: lens, color: '2F6DB5' }
        ],
        valAx: {
          min: X.dateSerial(r.from), max: X.dateSerial(r.to) + 1, numFmt: 'm/d',
          unit: r.days <= 70 ? 7 : r.days <= 200 ? 14 : 30
        }
      };
    }

    /* ② 出来形（折れ線グラフ） */
    var c = curveData(site, tasks);
    var rows2 = [[{ text: '日付', bold: true }, { text: '予定(%)', bold: true }, { text: '実績(%)', bold: true }]];
    var sheet2 = { name: '出来形', freezeTop: true, cols: [{ w: 12 }, { w: 10 }, { w: 10 }], rows: rows2 };
    if (c) {
      c.dates.forEach(function (d, i) {
        rows2.push([{ date: d }, { pct: c.plan[i] }, c.actual[i] === null ? '' : { pct: c.actual[i] }]);
      });
      var last2 = c.dates.length + 1;
      sheet2.chart = {
        kind: 'line', sheet: '出来形',
        title: '出来形（全体進捗率）　' + site.name,
        anchor: { col: 4, row: 0, col2: 20, row2: 26 },
        cat: { ref: '$A$2:$A$' + last2, values: c.dates.map(X.dateSerial), fmt: 'm/d' },
        tickLblSkip: Math.max(1, Math.ceil(c.dates.length / 12)),
        series: [
          { name: '予定', nameRef: '$B$1', ref: '$B$2:$B$' + last2, values: c.plan, color: '8E9AAF', fmt: '0.0"%"' },
          { name: '実績', nameRef: '$C$1', ref: '$C$2:$C$' + last2, values: c.actual, color: 'C0392B', marker: 'circle', fmt: '0.0"%"' }
        ],
        valAx: { min: 0, max: 100, numFmt: '0"%"', unit: 20 }
      };
    }

    var name = '工程表_' + (site.name || '現場').replace(/[\\/:*?"<>|]/g, '_') + '_' + today.replace(/-/g, '') + '.xlsx';
    X.save(name, { sheets: [sheet1, sheet2] });
    U.toast('Excelに出力しました');
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

      if (tasks.length) {
        html += '<div class="kpi-grid">' +
          '<div class="kpi"><span class="kpi-fig">' + p.actual + '<span class="kpi-unit">%</span></span><span class="kpi-label">実績（全体）</span></div>' +
          '<div class="kpi"><span class="kpi-fig">' + p.planned + '<span class="kpi-unit">%</span></span><span class="kpi-label">予定（今日時点）</span></div>' +
          '<div class="kpi' + (label.cls === 'ng' ? ' alarm' : '') + '"><span class="kpi-fig small">' + esc(label.text) + '</span><span class="kpi-label">予定との差 ' + (p.diff > 0 ? '+' : '') + p.diff + 'pt</span></div>' +
          '</div>';
      } else {
        html += UI.alert('info', '<strong>工種を追加してください。</strong>下の表の「工種名」を入れて＋を押すか、' +
          '一番下の行を横にドラッグすると、その期間で工種を追加できます。');
      }

      html += UI.h2('GANTT', '工程表（ドラッグで編集）') + '<div class="card">' + editorHtml(site, tasks) + '</div>';

      if (tasks.length) {
        html += UI.h2('CURVE', '出来形（全体進捗率）') + '<div class="card">' + curveSvg(site, tasks) + '</div>';

        html += UI.h2('PROGRESS', '数字で入力');
        html += '<div class="card"><p class="section-note">細かく合わせたいときは、ここに数字で入れてください。</p>' +
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

      html += UI.btnRow(
        (tasks.length ? '<button class="btn secondary" id="b-excel">Excelに出力（グラフ入り）</button>' : '') +
        '<a class="btn plain" href="#/task/new?site=' + sid + '">工種を詳しく登録</a>' +
        (tasks.length ? '<a class="btn plain" href="#/print/schedule?site=' + sid + '">工程表を印刷</a>' : ''));
      return html;
    },
    bind: function (site) {
      bindEditor(site);

      U.on('#b-excel', 'click', function () {
        try {
          toExcel(site, M.tasks(site.id));
        } catch (e) {
          U.toast('Excelに出力できませんでした：' + e.message);
          if (global.console) console.error(e);
        }
      });

      U.on('#b-progress', 'click', function () {
        var changed = 0;
        var bad = false;
        U.qsa('[data-task]').forEach(function (input) {
          if (input.tagName !== 'INPUT' || input.type !== 'number') return;
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
   * 工種の登録・編集（重みや備考など、細かい入力）
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
      ganttPrint(site, tasks) +
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
