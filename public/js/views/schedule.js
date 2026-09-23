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
  var big = false;              // 工程表を画面いっぱいに広げているか
  var lastGroup = '';           // 続けて追加するときのために、前に入れた工種を残す

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

    var anyRev = false;
    tasks.forEach(function (t) { if (M.hasRev(t)) anyRev = true; });

    var plan = [], rev = anyRev ? [] : null;
    dates.forEach(function (d) {
      var p = M.progress(site.id, d);
      plan.push(p.planned);
      if (rev) rev.push(p.revised);
    });
    var actual = dates.map(function (d) {
      if (d > today) return null;
      if (d === today) return now.actual;
      var v = null;
      logs.forEach(function (l) { if (l.date && l.date <= d) v = U.num(l.actual); });
      return v;
    });
    return { from: span.from, to: span.to, dates: dates, plan: plan, rev: rev, actual: actual, today: today };
  }

  /* ------------------------------------------------------------------ *
   * 工程表（ドラッグで編集できるマス目）
   * ------------------------------------------------------------------ */
  function barHtml(t, r, px, today) {
    var rev = M.hasRev(t);
    var out = '';

    if (U.isDate(t.planStart) && U.isDate(t.planEnd)) {
      var left = U.diffDays(r.from, t.planStart) * px;
      var w = Math.max(px, (U.diffDays(t.planStart, t.planEnd) + 1) * px);
      var prog = U.clamp(U.num(t.progress) || 0, 0, 100);
      var late = prog + 0.001 < M.taskPlanned(t, today, true) - 10;
      out += '<span class="ge-bar' + (late ? ' late' : '') + (prog >= 100 ? ' done' : '') + (rev ? ' half' : '') +
        '" data-kind="plan" style="left:' + left + 'px;width:' + w + 'px">' +
        '<span class="ge-fill" style="width:' + prog + '%"></span>' +
        '<span class="ge-h h-l" title="開始日を変える"></span>' +
        '<span class="ge-h h-r" title="終了日を変える"></span>' +
        '<span class="ge-h h-p" style="left:' + prog + '%" title="進捗を変える"></span>' +
        '<span class="ge-cap' + (prog < 18 ? ' dark' : '') + '">' + U.fmtNum(prog, 0) + '%</span></span>';
    }

    if (rev) {
      var l2 = U.diffDays(r.from, t.revStart) * px;
      var w2 = Math.max(px, (U.diffDays(t.revStart, t.revEnd) + 1) * px);
      out += '<span class="ge-bar rev" data-kind="rev" style="left:' + l2 + 'px;width:' + w2 + 'px">' +
        '<span class="ge-h h-l" title="変更後の開始日"></span>' +
        '<span class="ge-h h-r" title="変更後の終了日"></span>' +
        '<span class="ge-cap dark">変更</span></span>';
    }
    return out;
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

    var side = '<div class="ge-side-head">工種・種別</div>';
    var tracks = '';
    var prevGroup = null;
    tasks.forEach(function (t) {
      var prog = U.clamp(U.num(t.progress) || 0, 0, 100);
      var g = String(t.group || '').trim();
      side += '<div class="ge-name" data-task="' + esc(t.id) + '">' +
        '<span class="ge-nm">' +
        '<span class="ge-g' + (g && g === prevGroup ? ' cont' : '') + '">' + esc(g || '（工種なし）') + '</span>' +
        '<a href="#/task/' + encodeURIComponent(t.id) + '/edit" title="' + esc((g ? g + '／' : '') + t.name) + '">' +
        esc(t.name) + '</a></span>' +
        '<button class="ge-rev' + (M.hasRev(t) ? ' on' : '') + '" data-rev="' + esc(t.id) +
        '" title="変更後の工程（緑の帯）">変</button>' +
        '<b class="' + (prog >= 100 ? 'ok' : '') + '">' + U.fmtNum(prog, 0) + '%</b></div>';
      tracks += '<div class="ge-track" data-task="' + esc(t.id) + '">' + barHtml(t, r, px, today) + '</div>';
      prevGroup = g;
    });

    side += '<div class="ge-name new">' +
      '<span class="ge-nm">' +
      '<input type="text" id="ge-new-g" maxlength="40" placeholder="工種（大分類）" value="' + esc(lastGroup) + '">' +
      '<input type="text" id="ge-new" maxlength="40" placeholder="種別（中分類）">' +
      '</span>' +
      '<button class="ge-add" id="ge-add" title="追加">＋</button></div>';
    tracks += '<div class="ge-track new" data-task=""><span class="ge-hint">ここを横にドラッグすると、その期間で追加できます</span></div>';

    return '<div class="ge-wrap' + (big ? ' big' : '') + '" id="ge-wrap"><div class="ge" id="ge">' +
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
      '<button class="ge-z ge-big" id="ge-big">' + (big ? '元の大きさに戻す' : '大きく表示') + '</button>' +
      '<button class="ge-z ge-big" id="ge-sort" title="行の並びを、いまの予定日の順にそろえます">日付順に並べ直す</button>' +
      '<span class="legend"><span class="lg-plan">黒の枠</span>＝予定　<span class="lg-actual">赤</span>＝実績（進捗）　' +
      '<span class="lg-rev">緑</span>＝変更（「変」で作る）　うすい赤の地＝10ポイント以上の遅れ　破線＝今日</span>' +
      '</div></div>';
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
      var kind = bar ? (bar.getAttribute('data-kind') || 'plan') : 'plan';
      var bs = task ? (kind === 'rev' ? task.revStart : task.planStart) : null;
      var be = task ? (kind === 'rev' ? task.revEnd : task.planEnd) : null;
      var s0 = U.isDate(bs) ? U.diffDays(gFrom, bs) : d0;
      var e0 = U.isDate(be) ? U.diffDays(gFrom, be) : d0;

      drag = {
        mode: mode, kind: kind, track: track, task: task, bar: bar,
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
        } else if (d.kind === 'rev') {
          d.task.revStart = ps;
          d.task.revEnd = pe;
        } else {
          d.task.planStart = ps;
          d.task.planEnd = pe;
        }
        Store.put('tasks', d.task);
        snapshot(site.id);
        U.toast('保存しました');
      } else {
        var input = document.getElementById('ge-new');
        var gInput = document.getElementById('ge-new-g');
        var name = (input && input.value.trim()) || '新しい種別';
        var group = gInput ? gInput.value.trim() : '';
        lastGroup = group;
        if (input) input.value = '';
        Store.put('tasks', {
          siteId: site.id, group: group, name: name, planStart: ps, planEnd: pe,
          order: M.nextTaskOrder(site.id), progress: 0, weight: null, note: ''
        });
        snapshot(site.id);
        U.toast('「' + (group ? group + '／' : '') + name + '」を追加しました');
      }
      MT.rerender();
    }

    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);

    function addByName() {
      var input = document.getElementById('ge-new');
      var gInput = document.getElementById('ge-new-g');
      var name = input ? input.value.trim() : '';
      if (!name) { if (input) input.focus(); return U.toast('種別（中分類）を入力してください'); }
      var group = gInput ? gInput.value.trim() : '';
      lastGroup = group;
      var start = U.isDate(site.periodFrom) && site.periodFrom > U.todayStr() ? site.periodFrom : U.todayStr();
      Store.put('tasks', {
        siteId: site.id, group: group, name: name, planStart: start, planEnd: U.addDays(start, 6),
        order: M.nextTaskOrder(site.id), progress: 0, weight: null, note: ''
      });
      snapshot(site.id);
      U.toast('「' + (group ? group + '／' : '') + name + '」を追加しました。帯をドラッグして期間を合わせてください');
      MT.rerender();
    }

    U.qsa('.ge-rev', box).forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var t = Store.get('tasks', b.getAttribute('data-rev'));
        if (!t) return;
        if (M.hasRev(t)) {
          if (!confirm('「' + t.name + '」の変更後の工程を取り消します。よろしいですか？')) return;
          t.revStart = '';
          t.revEnd = '';
          U.toast('変更を取り消しました');
        } else {
          if (!U.isDate(t.planStart) || !U.isDate(t.planEnd)) return U.toast('先に予定の期間を決めてください');
          t.revStart = t.planStart;
          t.revEnd = t.planEnd;
          U.toast('変更の帯（緑）を作りました。ドラッグして期間を合わせてください');
        }
        Store.put('tasks', t);
        snapshot(site.id);
        MT.rerender();
      });
    });

    U.on('#ge-add', 'click', addByName);
    U.on('#ge-new', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addByName(); } });
    U.on('#ge-new-g', 'keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var n = document.getElementById('ge-new');
      if (n) n.focus();
    });

    /* 画面いっぱいに広げる（日数の多い工程を見渡すため） */
    U.on('#ge-big', 'click', function () {
      big = !big;
      MT.rerender();
    });

    /* 行の並びを、いまの予定日の順にそろえ直す */
    U.on('#ge-sort', 'click', function () {
      if (!confirm('行の並びを、いまの予定日の順にそろえます。よろしいですか？')) return;
      M.reorderTasksByDate(site.id);
      U.toast('日付順に並べ直しました');
      MT.rerender();
    });
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
        var late = prog + 0.001 < M.taskPlanned(t, today, true) - 10;
        bar = '<span class="g-bar' + (late ? ' late' : '') + (M.hasRev(t) ? ' half' : '') + '" style="left:' + l + '%;width:' + w + '%">' +
          '<span class="g-done" style="width:' + prog + '%"></span></span>';
      }
      if (M.hasRev(t)) {
        var l2 = pos(t.revStart);
        var w2 = Math.max(0.6, pos(U.addDays(t.revEnd, 1)) - l2);
        bar += '<span class="g-bar rev" style="left:' + l2 + '%;width:' + w2 + '%"></span>';
      }
      return '<div class="g-row"><div class="g-name">' + esc(t.name) +
        '<span class="g-pct">' + U.fmtNum(U.num(t.progress) || 0, 0) + '%</span></div>' +
        '<div class="g-track">' + bar + todayLine + '</div></div>';
    }).join('');

    return '<div class="gantt print">' +
      '<div class="g-row g-head"><div class="g-name">工種</div><div class="g-track">' + ticks + '</div></div>' +
      rows + '</div>' +
      '<p class="legend"><span class="lg-plan">黒の枠</span>＝予定　<span class="lg-actual">赤</span>＝実績（進捗）　' +
      '<span class="lg-rev">緑</span>＝変更　うすい赤の地＝10ポイント以上の遅れ　破線＝今日</p>';
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
    var revPts = c.rev ? c.dates.map(function (d, i) { return x(d).toFixed(1) + ',' + y(c.rev[i]).toFixed(1); }) : null;
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
      (revPts ? '<polyline points="' + revPts.join(' ') + '" class="c-rev"/>' : '') +
      (act.length > 1 ? '<polyline points="' + act.join(' ') + '" class="c-actual"/>' : '') + dots +
      '<text x="' + L + '" y="' + (H - 6) + '" class="c-label">' + esc(U.formatShort(c.from)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" class="c-label" text-anchor="end">' + esc(U.formatShort(c.to)) + '</text>' +
      '</svg><p class="legend"><span class="lg-plan">―</span> 予定　' +
      (revPts ? '<span class="lg-rev">―</span> 変更　' : '') +
      '<span class="lg-actual">●―</span> 実績</p>';
  }

  /* ------------------------------------------------------------------ *
   * Excelに出力（実施工程表の様式）
   *
   *   左に「工種・種別・数量・単位・構成比率」、右に月日のマス目。
   *   1つの種別につき3行（予定＝黒線／実績＝赤線／区切り）を使い、
   *   マス目の上に出来高曲線（予定＝黒・実績＝赤）を重ねる。
   * ------------------------------------------------------------------ */
  function eraDate(d) {
    if (!U.isDate(d)) return '';
    var y = Number(d.slice(0, 4)) - 2018;
    return '令和' + (y === 1 ? '元' : y) + '年' + Number(d.slice(5, 7)) + '月' + Number(d.slice(8, 10)) + '日';
  }

  function eraFiscal(y) {
    var n = y - 2018;
    return '令和' + (n === 1 ? '元' : n) + '年度';
  }

  /** 実績の帯の終わり（基準の期間のうち、進捗のぶんだけ引く） */
  function actualEnd(baseStart, baseEnd, prog, drawStart) {
    var dur = U.diffDays(baseStart, baseEnd) + 1;
    var len = Math.max(1, Math.round(dur * prog / 100));
    return U.addDays(drawStart || baseStart, len - 1);
  }

  function toExcel(site, tasks) {
    var XL = MT.xlsx;
    var today = U.todayStr();
    var r = range(site, tasks);
    var days = Math.min(r.days, 800);
    var from = r.from;
    var to = U.addDays(from, days - 1);
    // 工種（大分類）ごとにまとまるよう並べ替える（大分類が空なら、これまでどおり日付順）
    var firstOf = {};
    tasks.forEach(function (t) {
      var g = t.group || '', d = t.planStart || '9999-99-99';
      if (!firstOf[g] || d < firstOf[g]) firstOf[g] = d;
    });
    tasks = tasks.slice().sort(function (a, b) {
      var ga = a.group || '', gb = b.group || '';
      if (ga !== gb) {
        var fa = firstOf[ga], fb = firstOf[gb];
        if (fa !== fb) return fa < fb ? -1 : 1;
        return ga < gb ? -1 : 1;
      }
      var sa = a.planStart || '9999', sb = b.planStart || '9999';
      return sa < sb ? -1 : sa > sb ? 1 : U.byName(a, b);
    });
    var n = tasks.length;
    if (!n) return U.toast('工種がありません');

    var C_DAY = 6;                       // G列（0始まり）から日付のマス目
    var C_NOTE = C_DAY + days;           // 摘要
    var NCOL = C_NOTE + 1;
    var R_HEAD = 4;                      // 表の見出し（年度／月／日）の最初の行
    var R_BODY = R_HEAD + 3;             // 種別の最初の行

    /* 構成比率。純工事費（全体金額）が入っていればそれを分母に、無ければ入力の合計を分母にする */
    var ratios = M.taskRatios(tasks, site);
    function ratioOf(t) { return ratios.byId[t.id] || 0; }

    /* ---- 書式 ---- */
    var BOX = { l: 'thin', r: 'thin', t: 'thin', b: 'thin' };
    var TITLE = { sz: 16, b: true, align: { h: 'center', v: 'center' } };
    var LABEL = { sz: 10 };
    var LABEL_R = { sz: 10, color: 'C00000' };
    var TH = { sz: 9, b: true, align: { h: 'center', v: 'center', wrap: true }, border: BOX };
    var TD = { sz: 9, align: { h: 'left', v: 'center', shrink: true }, border: { l: 'thin', r: 'thin' } };
    var TD_C = { sz: 9, align: { h: 'center', v: 'center' }, border: { l: 'thin', r: 'thin' } };
    var TD_N = { sz: 9, align: { h: 'center', v: 'center' }, fmt: '#,##0.0', border: { l: 'thin', r: 'thin' } };
    var SCALE = { sz: 7, color: '555555', align: { h: 'right', v: 'center' } };
    var TICK = { sz: 6.5, color: '555555', align: { h: 'right', v: 'center' } };
    var MON = { sz: 8.5, align: { h: 'center', v: 'center' }, border: { l: 'thin', r: 'thin', t: 'thin', b: 'thin' } };
    var CAP = { sz: 6.5, align: { h: 'left', v: 'center' } };
    var CAP_R = { sz: 6.5, color: 'C00000', align: { h: 'left', v: 'center' } };
    var SUM = { sz: 7.5, align: { h: 'right', v: 'center' } };
    var SUM_R = { sz: 7.5, color: 'C00000', align: { h: 'right', v: 'center' } };
    var NOTE = { sz: 8, align: { h: 'left', v: 'center', wrap: true }, border: { l: 'thin', r: 'thin' } };

    function dayCell(i, extra) {
      var b = {};
      if (isMonthStart(i)) b.l = 'thin';
      if (extra && extra.b) b.b = extra.b;
      var s = { sz: 6.5 };
      if (b.l || b.b) s.border = b;
      return s;
    }

    var monthStarts = {};
    var monthEnds = [];
    (function () {
      var ym = from.slice(0, 7), guard = 0;
      while (ym <= to.slice(0, 7) && guard++ < 400) {
        var s = U.diffDays(from, ym + '-01');
        if (s > 0) monthStarts[s] = true;
        var last = ym + '-' + U.pad(U.daysInMonth(ym));
        monthEnds.push({ ym: ym, i: Math.min(days - 1, U.diffDays(from, last)), from: Math.max(0, s), date: last });
        ym = U.addMonths(ym, 1);
      }
    })();
    function isMonthStart(i) { return !!monthStarts[i]; }

    /* ---- 行を作る ---- */
    var rows = [], merges = [];
    function row(h) { var o = { h: h, cells: new Array(NCOL) }; rows.push(o); return o; }
    function at(ri) { return rows[ri]; }
    function put(ri, ci, v) { rows[ri].cells[ci] = v; }
    function ref(ri, ci) { return XL.colName(ci + 1) + (ri + 1); }
    function merge(r1, c1, r2, c2) { merges.push(ref(r1, c1) + ':' + ref(r2, c2)); }

    // 0: 標題
    row(26);
    put(0, 0, { text: '実　施　工　程　表', s: TITLE });
    merge(0, 0, 0, Math.min(NCOL - 1, C_NOTE));

    // 1: 工事名  2: 工期
    row(16);
    put(1, 0, { text: '工　事　名：', s: LABEL });
    put(1, 1, { text: site.name || '', s: LABEL });
    row(16);
    put(2, 0, { text: '工　期：', s: LABEL });
    put(2, 1, { text: eraDate(site.periodFrom) + (site.periodTo ? '　〜　' : ''), s: LABEL });
    put(2, 3, { text: eraDate(site.periodTo), s: LABEL_R });

    // 3: 余白
    row(6);

    /* ---- 見出し（3行） ---- */
    row(16); row(16); row(14);

    put(R_HEAD, 0, { text: '費目・工種・種別等', s: TH });
    merge(R_HEAD, 0, R_HEAD, 1);
    put(R_HEAD + 1, 0, { text: '工事延長', s: TH });
    put(R_HEAD + 1, 1, { text: site.extent || '', s: { sz: 9, align: { h: 'center', v: 'center' }, border: BOX } });
    put(R_HEAD + 2, 0, { text: '工　種', s: TH });
    put(R_HEAD + 2, 1, { text: '種　別', s: TH });

    put(R_HEAD, 2, { text: '数　量', s: TH });
    put(R_HEAD, 3, { text: '単位', s: TH });
    put(R_HEAD, 4, { text: '構成比率(%)', s: TH });
    [2, 3, 4].forEach(function (c) {
      merge(R_HEAD, c, R_HEAD + 2, c);
      put(R_HEAD + 1, c, { s: TH });
      put(R_HEAD + 2, c, { s: TH });
    });
    put(R_HEAD, 5, { s: TH });
    put(R_HEAD + 1, 5, { text: '月', s: TH });
    put(R_HEAD + 2, 5, { text: '日', s: TH });

    // 見出しの3行は、日付のマス全部に罫線を入れておく（結合セルの枠は各マスの罫線で描かれるため）
    function hdrStyle(i, extra) {
      var b = { t: 'thin', b: 'thin' };
      if (isMonthStart(i) || i === 0) b.l = 'thin';
      if (i === days - 1) b.r = 'thin';
      var s0 = { sz: (extra && extra.sz) || 8.5, align: { h: (extra && extra.h) || 'center', v: 'center' }, border: b };
      return s0;
    }
    for (var hi = 0; hi < days; hi++) {
      put(R_HEAD, C_DAY + hi, { s: hdrStyle(hi) });
      put(R_HEAD + 1, C_DAY + hi, { s: hdrStyle(hi) });
      put(R_HEAD + 2, C_DAY + hi, { s: hdrStyle(hi, { sz: 6.5, h: 'right' }) });
    }

    // 年度（4月始まり）
    (function () {
      var seg = null;
      monthEnds.forEach(function (m) {
        var y = Number(m.ym.slice(0, 4)) - (Number(m.ym.slice(5, 7)) < 4 ? 1 : 0);
        if (!seg || seg.y !== y) {
          if (seg) flush(seg);
          seg = { y: y, from: m.from, to: m.i };
        } else seg.to = m.i;
      });
      if (seg) flush(seg);
      function flush(s) {
        put(R_HEAD, C_DAY + s.from, { text: eraFiscal(s.y), s: hdrStyle(s.from) });
        if (s.to > s.from) merge(R_HEAD, C_DAY + s.from, R_HEAD, C_DAY + s.to);
      }
    })();

    // 月と日
    monthEnds.forEach(function (m) {
      put(R_HEAD + 1, C_DAY + m.from, { text: Number(m.ym.slice(5)) + '月', s: hdrStyle(m.from) });
      if (m.i > m.from) merge(R_HEAD + 1, C_DAY + m.from, R_HEAD + 1, C_DAY + m.i);
      var dim = U.daysInMonth(m.ym);
      [10, 20, dim].forEach(function (d) {
        var i = U.diffDays(from, m.ym + '-' + U.pad(d));
        if (i >= 0 && i < days) put(R_HEAD + 2, C_DAY + i, { text: String(d), s: hdrStyle(i, { sz: 6.5, h: 'right' }) });
      });
    });

    put(R_HEAD, C_NOTE, { text: '摘　要', s: TH });
    merge(R_HEAD, C_NOTE, R_HEAD + 2, C_NOTE);
    put(R_HEAD + 1, C_NOTE, { s: TH });
    put(R_HEAD + 2, C_NOTE, { s: TH });

    /* ---- 種別ごとに3行（変更後の工程があるときは4行） ---- */
    var anyRev = false;
    tasks.forEach(function (t) { if (M.hasRev(t)) anyRev = true; });
    var BLK = anyRev ? 4 : 3;      // 予定／（変更）／実績／区切り
    var LAST = BLK - 1;            // 区切りの行
    var GREEN = '00A650';
    var CAP_G = { sz: 6.5, color: GREEN, align: { h: 'left', v: 'center' } };

    tasks.forEach(function (t, k) {
      var r0 = R_BODY + k * BLK;
      var q;
      for (q = 0; q < LAST; q++) row(10);
      row(3);

      var ratio = ratioOf(t);
      var left = [
        [1, t.name || '', TD],
        [2, U.num(t.qty) === null ? '' : { num: U.num(t.qty), s: TD_N }, TD_N],
        [3, t.unit || '', TD_C],
        [4, { num: Math.round(ratio * 100) / 100, s: TD_N }, TD_N]
      ];
      left.forEach(function (c) {
        var v = c[1];
        put(r0, c[0], typeof v === 'object' && v !== null ? v : { text: v, s: c[2] });
        for (var j = 1; j < LAST; j++) put(r0 + j, c[0], { s: c[2] });
        put(r0 + LAST, c[0], { s: { sz: 9, border: { l: 'thin', r: 'thin', b: 'thin' } } });
        merge(r0, c[0], r0 + LAST, c[0]);
      });

      // 工種（大分類）は、同じものが続くあいだ1つにまとめる
      var prev = k ? (tasks[k - 1].group || '') : null;
      var cur = t.group || '';
      put(r0, 0, { text: (k && cur && cur === prev) ? '' : cur, s: TD });
      for (q = 1; q < LAST; q++) put(r0 + q, 0, { s: TD });
      put(r0 + LAST, 0, { s: { sz: 9, border: { l: 'thin', r: 'thin', b: (k + 1 < n && cur && (tasks[k + 1].group || '') === cur) ? null : 'thin' } } });
      put(r0, 5, { s: { sz: 7 } });

      // マス目の罫線（下端の区切りと、月の区切り）
      var i;
      for (i = 0; i < days; i++) put(r0 + LAST, C_DAY + i, { s: dayCell(i, { b: 'thin' }) });
      for (i = 0; i < days; i++) {
        if (!isMonthStart(i)) continue;
        for (q = 0; q < LAST; q++) put(r0 + q, C_DAY + i, { s: dayCell(i) });
      }

      put(r0, C_NOTE, { text: t.note || '', s: NOTE });
      for (q = 1; q < LAST; q++) put(r0 + q, C_NOTE, { s: NOTE });
      put(r0 + LAST, C_NOTE, { s: { sz: 8, border: { l: 'thin', r: 'thin', b: 'thin' } } });

      /** 帯を1本引く（太い下罫線で描き、右隣に出来高を書く） */
      function drawBar(ri, ds, de, color, label, lstyle) {
        if (!U.isDate(ds) || !U.isDate(de)) return;
        var a = U.clamp(U.diffDays(from, ds), 0, days - 1);
        var b = U.clamp(U.diffDays(from, de), a, days - 1);
        for (var j = a; j <= b; j++) {
          put(ri, C_DAY + j, { s: { sz: 6.5, border: { l: isMonthStart(j) ? 'thin' : null, b: { s: 'thick', c: color } } } });
        }
        if (label && b + 1 < days) put(ri, C_DAY + b + 1, { text: label, s: lstyle });
      }

      var whole = '100(' + (Math.round(ratio * 100) / 100) + ')';
      drawBar(r0, t.planStart, t.planEnd, '000000', whole, CAP);
      if (anyRev && M.hasRev(t)) drawBar(r0 + 1, t.revStart, t.revEnd, GREEN, whole, CAP_G);

      // 実績（赤）。変更後の工程があれば、そちらを基準にする
      var prog = U.clamp(U.num(t.progress) || 0, 0, 100);
      if (prog > 0) {
        var bs = M.hasRev(t) ? t.revStart : t.planStart;
        var be = M.hasRev(t) ? t.revEnd : t.planEnd;
        if (U.isDate(bs) && U.isDate(be)) {
          var st = U.isDate(t.actualStart) ? t.actualStart : bs;
          drawBar(r0 + (anyRev ? 2 : 1), st, actualEnd(bs, be, prog, st), 'C00000',
            prog + '(' + (Math.round(ratio * prog) / 100) + ')', CAP_R);
        }
      }
    });

    // 同じ大分類が続く範囲を、縦に結合する
    (function () {
      var start = 0;
      for (var k = 1; k <= n; k++) {
        var cur = k < n ? (tasks[k].group || '') : null;
        var prev = tasks[start].group || '';
        if (cur !== prev || k === n) {
          if (prev && k - start > 1) merge(R_BODY + start * BLK, 0, R_BODY + (k - 1) * BLK + LAST, 0);
          else if (k - start === 1) merge(R_BODY + start * BLK, 0, R_BODY + start * BLK + LAST, 0);
          start = k;
        }
      }
    })();

    var bodyRows = Math.max(1, n * BLK);
    var R_END = R_BODY + bodyRows;          // 種別の次の行

    /* ---- 左の目盛（0〜100%） ---- */
    (function () {
      var hs = [];
      tasks.forEach(function () {
        for (var q = 0; q < LAST; q++) hs.push(10);
        hs.push(3);
      });
      var H = 0, used = {};
      hs.forEach(function (h) { H += h; });
      for (var p = 100; p >= 0; p -= 10) {
        var y = (1 - p / 100) * H, acc = 0, idx = hs.length - 1;
        for (var i = 0; i < hs.length; i++) {
          if (y < acc + hs[i]) { idx = i; break; }
          acc += hs[i];
        }
        if (used[idx]) continue;
        used[idx] = true;
        put(R_BODY + idx, 5, { text: String(p), s: SCALE });
      }
    })();

    /* ---- 全体（金額）工程 ---- */
    rows.push({ h: 13, cells: new Array(NCOL) });
    rows.push({ h: 13, cells: new Array(NCOL) });
    var rPlan = R_END, rDone = R_END + 1;

    function botStyle(i, top) {
      var b = top ? { t: 'thin' } : { b: 'thin' };
      if (isMonthStart(i) || i === 0) b.l = 'thin';
      if (i === days - 1) b.r = 'thin';
      return { sz: 7.5, color: top ? '000000' : 'C00000', align: { h: 'right', v: 'center' }, border: b };
    }
    for (var bi = 0; bi < days; bi++) {
      put(rPlan, C_DAY + bi, { s: botStyle(bi, true) });
      put(rDone, C_DAY + bi, { s: botStyle(bi, false) });
    }

    var titleTop = { sz: 9, b: true, align: { h: 'center', v: 'center' }, border: { l: 'thin', r: 'thin', t: 'thin' } };
    var titleBot = { sz: 9, align: { h: 'center', v: 'center' }, border: { l: 'thin', r: 'thin', b: 'thin' } };
    put(rPlan, 0, { text: '全　体　（　金　額　）　工　程', s: titleTop });
    [1, 2, 3].forEach(function (c) { put(rPlan, c, { s: titleTop }); put(rDone, c, { s: titleBot }); });
    put(rDone, 0, { s: titleBot });
    merge(rPlan, 0, rDone, 3);

    put(rPlan, 4, { text: '100%', s: titleTop });
    put(rDone, 4, { s: titleBot });
    merge(rPlan, 4, rDone, 4);
    put(rPlan, 5, { text: '計画', s: { sz: 7.5, align: { h: 'center', v: 'center' }, border: { t: 'thin', l: 'thin' } } });
    put(rDone, 5, { text: '実施', s: { sz: 7.5, color: 'C00000', align: { h: 'center', v: 'center' }, border: { b: 'thin', l: 'thin' } } });

    var logs = Store.list('progress_logs', null, site.id).sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    var nowP = M.progress(site.id);
    monthEnds.forEach(function (m) {
      // 数値のままだと列が狭くて表示されないため、文字として入れる（右に揃えて左へはみ出させる）
      var pl = M.progress(site.id, m.date).planned;
      put(rPlan, C_DAY + m.i, { text: (Math.round(pl * 100) / 100).toFixed(2) + '%', s: botStyle(m.i, true) });
      if (m.date <= today || m.ym === today.slice(0, 7)) {
        var v = null;
        logs.forEach(function (l) { if (l.date && l.date <= m.date) v = U.num(l.actual); });
        if (m.ym === today.slice(0, 7)) v = nowP.actual;
        if (v !== null) put(rDone, C_DAY + m.i, { text: (Math.round(v * 100) / 100).toFixed(2) + '%', s: botStyle(m.i, false) });
      }
    });
    put(rPlan, C_NOTE, { s: { sz: 8, border: { l: 'thin', r: 'thin', t: 'thin' } } });
    put(rDone, C_NOTE, { s: { sz: 8, border: { l: 'thin', r: 'thin', b: 'thin' } } });

    /* ---- 記事 ---- */
    rows.push({ h: 18, cells: new Array(NCOL) });
    var rNote = rDone + 1;
    var noteBox = { sz: 9, align: { h: 'center', v: 'center' }, border: { t: 'thin', b: 'thin' } };
    put(rNote, 0, { text: '記　　事', s: { sz: 9, align: { h: 'center', v: 'center' }, border: BOX } });
    put(rNote, 1, { s: { sz: 9, align: { h: 'center', v: 'center' }, border: BOX } });
    merge(rNote, 0, rNote, 1);
    for (var ni = 2; ni <= C_NOTE; ni++) {
      put(rNote, ni, { s: { sz: 9, border: { t: 'thin', b: 'thin', l: ni === 2 ? 'thin' : null, r: ni === C_NOTE ? 'thin' : null } } });
    }
    merge(rNote, 2, rNote, C_NOTE);

    /* ---- 凡例（摘要の欄） ---- */
    function lgRow(text, color, style, w) {
      return [text, {
        sz: 8, color: color || '000000', align: { v: 'center' },
        border: { l: 'thin', r: 'thin', b: style ? { s: style, c: color || '000000' } : null }
      }];
    }
    var lg = [
      ['凡例', { sz: 8, b: true, align: { v: 'center' }, border: { l: 'thin', r: 'thin' } }],
      ['施工進度管理', { sz: 8, align: { v: 'center' }, border: { l: 'thin', r: 'thin' } }],
      lgRow('　予定', '000000', 'thick')
    ];
    if (anyRev) lg.push(lgRow('　変更', GREEN, 'thick'));
    lg.push(lgRow('　実績', 'C00000', 'thick'));
    lg.push(['', { sz: 8, border: { l: 'thin', r: 'thin' } }]);
    lg.push(['全体工程管理', { sz: 8, align: { v: 'center' }, border: { l: 'thin', r: 'thin' } }]);
    lg.push(lgRow('　予定（曲線）', '000000', 'medium'));
    if (anyRev) lg.push(lgRow('　変更（曲線）', GREEN, 'medium'));
    lg.push(lgRow('　実績（曲線）', 'C00000', 'medium'));

    // 区切りの行（高さ3）は避けて置く
    var lgRows = [];
    tasks.forEach(function (t, k) {
      for (var q = 0; q < LAST; q++) lgRows.push(R_BODY + k * BLK + q);
    });
    var lgStep = Math.max(1, Math.floor(lgRows.length / lg.length));
    lg.forEach(function (item, k) {
      var ri = lgRows[k * lgStep];
      if (ri !== undefined) put(ri, C_NOTE, { text: item[0], s: item[1] });
    });

    /* ---- 出来形（別シート・曲線のもと） ---- */
    var c = curveData(site, tasks);
    var hasRev = !!(c && c.rev);
    var head2 = [{ text: '日付', bold: true }, { text: '予定(%)', bold: true }];
    if (hasRev) head2.push({ text: '変更(%)', bold: true });
    head2.push({ text: '実績(%)', bold: true });

    var rows2 = [head2];
    var cols2 = [{ w: 12 }, { w: 10 }];
    if (hasRev) cols2.push({ w: 10 });
    cols2.push({ w: 10 });
    var sheet2 = { name: '出来形', freezeTop: true, cols: cols2, rows: rows2 };

    var xs = [], ys = [], rs = [], as = [];
    var COL_REV = 'C', COL_ACT = hasRev ? 'D' : 'C';
    if (c) {
      c.dates.forEach(function (d, i) {
        var line = [{ date: d }, { pct: c.plan[i] }];
        if (hasRev) line.push({ pct: c.rev[i] });
        line.push(c.actual[i] === null ? '' : { pct: c.actual[i] });
        rows2.push(line);
        xs.push(XL.dateSerial(d));
        ys.push(c.plan[i]);
        if (hasRev) rs.push(c.rev[i]);
        as.push(c.actual[i]);
      });
      var last2 = c.dates.length + 1;
      var lineSeries = [
        { name: '予定', nameRef: '$B$1', ref: '$B$2:$B$' + last2, values: ys, color: '8E9AAF', fmt: '0.0"%"' }
      ];
      if (hasRev) {
        lineSeries.push({ name: '変更', nameRef: '$C$1', ref: '$C$2:$C$' + last2, values: rs, color: GREEN, fmt: '0.0"%"' });
      }
      lineSeries.push({ name: '実績', nameRef: '$' + COL_ACT + '$1', ref: '$' + COL_ACT + '$2:$' + COL_ACT + '$' + last2, values: as, color: 'C0392B', marker: 'circle', fmt: '0.0"%"' });

      sheet2.chart = {
        kind: 'line', sheet: '出来形', legend: true,
        title: '出来形（全体進捗率）　' + site.name,
        anchor: { col: hasRev ? 5 : 4, row: 0, col2: hasRev ? 21 : 20, row2: 26 },
        cat: { ref: '$A$2:$A$' + last2, values: xs, fmt: 'm/d' },
        valAx: { min: 0, max: 100, numFmt: '0"%"', unit: 20, grid: true },
        series: lineSeries
      };
    }

    /* ---- マス目に重ねる曲線（散布図・軸も枠も出さない） ---- */
    var charts = [];
    if (c && n) {
      var lastRow = c.dates.length + 1;
      var over = [
        { name: '予定', sheet: '出来形', xRef: '$A$2:$A$' + lastRow, xValues: xs, yRef: '$B$2:$B$' + lastRow, yValues: ys, color: '000000', width: 12700 }
      ];
      if (hasRev) {
        over.push({ name: '変更', sheet: '出来形', xRef: '$A$2:$A$' + lastRow, xValues: xs, yRef: '$' + COL_REV + '$2:$' + COL_REV + '$' + lastRow, yValues: rs, color: GREEN, width: 12700 });
      }
      over.push({ name: '実績', sheet: '出来形', xRef: '$A$2:$A$' + lastRow, xValues: xs, yRef: '$' + COL_ACT + '$2:$' + COL_ACT + '$' + lastRow, yValues: as, color: 'C00000', width: 12700 });

      charts.push({
        kind: 'scatter', sheet: '出来形', full: true, transparent: true, hideAxes: true, legend: false,
        anchor: { col: C_DAY, row: R_BODY, col2: C_DAY + days, row2: R_END },
        xAx: { min: XL.dateSerial(from), max: XL.dateSerial(to) + 1 },
        yAx: { min: 0, max: 100 },
        series: over
      });
    }

    /* ---- 列幅 ---- */
    var dayW = days <= 120 ? 1.1 : days <= 250 ? 0.6 : 0.25;
    var cols = [{ w: 12 }, { w: 16 }, { w: 7 }, { w: 5 }, { w: 8 }, { w: 4.2 }];
    cols.push({ w: dayW, to: C_NOTE });         // 日付の列をまとめて指定
    cols[C_NOTE] = { w: 13 };

    var sheet1 = {
      name: '実施工程表',
      gridLines: false,
      rowHeight: 13,
      cols: cols,
      rows: rows,
      merges: merges,
      freeze: { x: C_DAY, y: R_BODY },
      print: { paper: 8, landscape: true, fitW: 1, fitH: 1 },
      charts: charts
    };

    var name = '実施工程表_' + (site.name || '現場').replace(/[\\/:*?"<>|]/g, '_') + '_' + today.replace(/-/g, '') + '.xlsx';
    XL.save(name, { sheets: [sheet1, sheet2] });
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
      M.ensureTaskOrder(site.id);        // 並び順の無い記録に、いま見えている順で番号を付ける
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
        html += UI.alert('info', '<strong>工程を作りましょう。</strong>' +
          '請負代金内訳書（様式第22）のExcelがあれば、そのまま読み込めます。' +
          '手で作るときは、下の表に工種（大分類）と種別（中分類）を入れて＋を押すか、' +
          '一番下の行を横にドラッグしてください。') +
          UI.btnRow('<a class="btn lead block" href="#/breakdown?site=' + sid + '">請負代金内訳書を読み込む</a>');
      }

      html += UI.h2('GANTT', '工程表（ドラッグで編集）') + '<div class="card">' + editorHtml(site, tasks) + '</div>';

      if (tasks.length) {
        html += UI.h2('CURVE', '出来形（全体進捗率）') + '<div class="card">' + curveSvg(site, tasks) + '</div>';

        var ratios = M.taskRatios(tasks, site);
        var contract = U.num(site.contractAmount);
        var split = M.commonSplit(site);

        html += UI.h2('AMOUNT', '金額と構成比率') + '<div class="card">' +
          '<table class="kv"><tbody>' +
          '<tr><th>請負金額</th><td>' + (contract ? U.fmtNum(contract, 0) + ' 円' : '<span class="muted">未入力</span>') + '</td></tr>' +
          '<tr><th>純工事費<br><span class="muted">（全体金額）</span></th><td>' +
          (ratios.net ? U.fmtNum(ratios.net, 0) + ' 円' +
            (contract ? '　<span class="muted">請負金額の ' + U.fmtNum(ratios.net / contract * 100, 1) + '%</span>' : '')
            : '<span class="muted">未入力（入れると、ここを分母に構成比率を出します）</span>') + '</td></tr>' +
          '<tr><th>工程の金額合計</th><td>' + (ratios.amountSum ? U.fmtNum(ratios.amountSum, 0) + ' 円' +
            (ratios.usesNet ? '　<span class="' + (Math.abs(ratios.coverage - 100) < 0.5 ? 'muted' : 'warn-text') + '">純工事費の ' +
              U.fmtNum(ratios.coverage, 1) + '%</span>' : '')
            : '<span class="muted">未入力</span>') + '</td></tr>' +
          (ratios.fromAmount && ratios.missing
            ? '<tr><th>金額が未入力</th><td class="warn-text">' + ratios.missing + ' 件（構成比率がほぼ0になります）</td></tr>'
            : '') +
          '</tbody></table>' +
          '<p class="section-note">' + (ratios.usesNet
            ? '構成比率は「積算金額 ÷ 純工事費」で出しています。'
            : ratios.fromAmount
              ? '構成比率は、入力した積算金額の合計を分母に出しています（純工事費を入れると、そちらが分母になります）。'
              : '積算金額を入れると、構成比率が金額から出ます（いまは「重み」で計算しています）。') + '</p>' +
          UI.btnRow('<a class="btn small secondary" href="#/breakdown?site=' + sid + '">請負代金内訳書を読み込む</a>' +
            '<a class="btn small plain" href="#/site/' + sid + '/edit">金額を直す</a>') + '</div>';

        if (split) {
          html += UI.h2('COMMON', '準備工・後片付（共通仮設費から）') + '<div class="card">' +
            '<p class="section-note">共通仮設費 <strong>' + U.fmtNum(split.common, 0) + ' 円</strong> を、' +
            '準備工と後片付に割り振ります。割合はいつでも変えられます。</p>' +
            '<div class="field-row">' +
            UI.field('準備工の割合（%）', UI.number('f-share', split.share, ' step="1" min="0" max="100"')) +
            UI.field('後片付の割合（%）', UI.text('f-share2', (100 - split.share) + ' %', '', ' readonly')) +
            '</div>' +
            '<table class="kv"><tbody>' +
            '<tr><th>準備工</th><td>' + U.fmtNum(split.prep, 0) + ' 円</td></tr>' +
            '<tr><th>後片付</th><td>' + U.fmtNum(split.cleanup, 0) + ' 円</td></tr>' +
            '</tbody></table>' +
            UI.btnRow('<button class="btn" id="b-share">この割合にする</button>') + '</div>';
        }

        html += UI.h2('PROGRESS', '数字で入力');
        html += '<div class="card"><p class="section-note">細かく合わせたいときは、ここに数字で入れてください。</p>' +
          '<div class="table-scroll"><table class="data progress-table"><thead><tr>' +
          '<th>工種（大分類）</th><th>種別（中分類）</th><th>予定期間</th>' +
          '<th class="r">積算金額</th><th class="r">構成比率</th><th class="r">予定</th><th class="r">実績（%）</th>' +
          '</tr></thead><tbody>' +
          tasks.map(function (t) {
            var amt = U.num(t.amount);
            return '<tr><td>' + esc(t.group || '－') + '</td>' +
              '<td><a href="#/task/' + encodeURIComponent(t.id) + '/edit">' + esc(t.name) + '</a></td>' +
              '<td class="nowrap">' + esc(U.formatShort(t.planStart)) + '〜' + esc(U.formatShort(t.planEnd)) + '</td>' +
              '<td class="r">' + (amt ? U.fmtNum(amt, 0) : '－') + '</td>' +
              '<td class="r">' + U.fmtNum(ratios.byId[t.id], 1) + '%</td>' +
              '<td class="r">' + U.fmtNum(M.taskPlanned(t, U.todayStr()), 0) + '%</td>' +
              '<td class="r"><input type="number" class="pct-input" min="0" max="100" step="1" data-task="' + esc(t.id) + '" value="' + esc(U.num(t.progress) || 0) + '"></td></tr>';
          }).join('') + '</tbody></table></div>' +
          UI.btnRow('<button class="btn" id="b-progress">進捗を保存</button>') + '</div>';
      }

      html += UI.btnRow(
        (tasks.length ? '<button class="btn secondary" id="b-excel">実施工程表をExcelに出力</button>' : '') +
        '<a class="btn plain" href="#/breakdown?site=' + sid + '">請負代金内訳書を読み込む</a>' +
        '<a class="btn plain" href="#/task/new?site=' + sid + '">工種・種別を詳しく登録</a>' +
        (tasks.length ? '<a class="btn plain" href="#/print/schedule?site=' + sid + '">工程表を印刷</a>' : ''));
      return html;
    },
    bind: function (site) {
      bindEditor(site);

      /* 準備工・後片付の割合を変える（共通仮設費の振り分け） */
      U.on('#f-share', 'input', function () {
        var v = U.num(U.val('#f-share'));
        var box = U.qs('#f-share2');
        if (box) box.value = (v === null || v < 0 || v > 100 ? '－' : (100 - v)) + ' %';
      });

      U.on('#b-share', 'click', function () {
        var v = U.num(U.val('#f-share'));
        if (v === null || v < 0 || v > 100) return U.toast('0〜100の数字で入れてください');
        var fresh = Store.get('sites', site.id);
        fresh.prepShare = v;
        Store.put('sites', fresh);
        var sp = M.commonSplit(fresh);
        var n = 0;
        M.tasks(site.id).forEach(function (t) {
          if (t.costKind !== 'prep' && t.costKind !== 'cleanup') return;
          t.amount = t.costKind === 'prep' ? sp.prep : sp.cleanup;
          Store.put('tasks', t);
          n++;
        });
        U.toast(n ? '割合を変えました' : '割合を保存しました（準備工・後片付の行がまだありません）');
        MT.rerender();
      });

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
    task = task || { siteId: siteId, progress: 0, order: M.nextTaskOrder(siteId) };
    var site = Store.get('sites', task.siteId);
    if (!site) return MT.notFound('現場が見つかりません。');
    var back = '#/site/' + encodeURIComponent(site.id) + '?tab=schedule';
    U.app().innerHTML = UI.backLink(back, '工程へ戻る') +
      UI.pageHead('TASK', isNew ? '工種・種別の追加' : '工種・種別の編集') +
      '<p class="muted">' + esc(site.name) + (site.periodFrom ? '　工期 ' + esc(U.periodText(site.periodFrom, site.periodTo)) : '') + '</p>' +
      '<div class="card">' +
      '<p class="section-note">請負代金内訳書と同じ並びで入れてください。' +
      '<strong>工種（大分類）＝砂防土工　／　種別（中分類）＝掘削工　／　数量（小分類）＝50.0 m3</strong></p>' +
      UI.field('工種（大分類）', UI.text('f-group', task.group, '例：砂防土工／法面工／コンクリート堰堤工'), false,
        '実施工程表（Excel）の「工種」欄に入ります。同じものが続くと縦に1つにまとまります') +
      UI.field('種別（中分類）', UI.text('f-name', task.name, '例：掘削工／盛土工／作業土工'), true,
        '実施工程表（Excel）の「種別」欄に入ります') +
      '<div class="field-row">' +
      UI.field('数量（小分類）', UI.number('f-qty', task.qty, ' step="any" min="0"'), false, '空欄でもかまいません') +
      UI.field('単位', UI.text('f-unit', task.unit, '例：m3／m2／式'), false) + '</div>' +
      UI.field('積算金額（円）', UI.number('f-amount', task.amount, ' step="1" min="0"'), false,
        '請負代金内訳書の金額。入れると構成比率が自動で出ます') +
      '<div class="field-row">' + UI.field('予定（開始）', UI.date('f-ps', task.planStart || site.periodFrom), true) +
      UI.field('予定（終了）', UI.date('f-pe', task.planEnd || site.periodTo), true) + '</div>' +
      '<div class="field-row">' + UI.field('重み', UI.number('f-weight', task.weight, ' step="any" min="0"'), false, '金額を入れたときは使いません。空欄なら均等') +
      UI.field('進捗（%）', UI.number('f-progress', U.num(task.progress) || 0, ' step="1" min="0" max="100"')) + '</div>' +
      '<div class="field-row">' +
      UI.field('変更（開始）', UI.date('f-rs', task.revStart), false, '工程を組み替えたときに入れます（緑の帯）') +
      UI.field('変更（終了）', UI.date('f-re', task.revEnd)) + '</div>' +
      '<div class="field-row">' + UI.field('実績（開始）', UI.date('f-as', task.actualStart)) + UI.field('実績（終了）', UI.date('f-ae', task.actualEnd)) + '</div>' +
      UI.field('備考', UI.textarea('f-note', task.note)) +
      '</div>' +
      UI.btnRow('<button class="btn" id="b-save">保存</button><a class="btn plain" href="' + esc(back) + '">キャンセル</a>') +
      (isNew ? '' : UI.btnRow('<button class="btn danger" id="b-del">この工種を削除</button>'));

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name'), ps = U.val('#f-ps'), pe = U.val('#f-pe');
      var prog = U.num(U.val('#f-progress'));
      if (!name) return U.toast('種別（中分類）を入力してください');
      if (!U.isDate(ps) || !U.isDate(pe)) return U.toast('予定期間を入力してください');
      if (ps > pe) return U.toast('予定の終了日は開始日より後にしてください');
      if (prog === null || prog < 0 || prog > 100) return U.toast('進捗は0〜100で入力してください');
      task.name = name;
      task.group = U.val('#f-group');
      task.qty = U.num(U.val('#f-qty'));
      task.unit = U.val('#f-unit');
      task.amount = U.num(U.val('#f-amount'));
      task.planStart = ps;
      task.planEnd = pe;
      task.weight = U.num(U.val('#f-weight'));
      task.progress = prog;
      var rs = U.val('#f-rs'), re = U.val('#f-re');
      if (rs && re && rs > re) return U.toast('変更の終了日は開始日より後にしてください');
      task.revStart = rs && re ? rs : '';
      task.revEnd = rs && re ? re : '';
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
