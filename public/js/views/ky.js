/*
 * views/ky.js - リスクアセスメントＫＹ活動表
 *
 * 社内様式（リスクアセスメントＫＹ活動表.docx／A4横）に合わせている。
 *   ・リスク見積は足算式：可能性（1〜3）＋ 重大性（1〜3）＝ 評価
 *       3以下 → 小さい ／ 4 → 中程度 ／ 5以上 → 大きい
 *   ・現場のQRからも作れる（朝礼でその場で入力するため）
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var Store = MT.store;
  var Session = MT.session;
  var Sign = MT.sign;
  var esc = U.esc;

  var POSS = [['1', '１ ごくまれ'], ['2', '２ ときには'], ['3', '３ ありがち']];
  var SEV = [['1', '１ 軽傷～不休'], ['2', '２ 中度～休業'], ['3', '３ 重度～死亡']];
  var BLANK = [['', '選んでください']];
  var WEATHER = ['晴', 'くもり', '雨', '雪', '強風', '猛暑'];
  var ROWS = 4;                       // 様式にある危険の行数
  var MEMBERS = 12;                   // 様式にある参加者の欄の数

  /** 可能性＋重大性からリスクの大きさを出す */
  function grade(p, s) {
    var a = U.num(p), b = U.num(s);
    if (!a || !b) return { score: 0, text: '', cls: 'none' };
    var v = a + b;
    if (v <= 3) return { score: v, text: '小さい', cls: 'ok' };
    if (v === 4) return { score: v, text: '中程度', cls: 'warn' };
    return { score: v, text: '大きい', cls: 'ng' };
  }

  function risksOf(k) {
    return (k && Array.isArray(k.risks) ? k.risks : []).filter(function (r) {
      return r && (r.hazard || r.measure);
    });
  }

  /** いちばん大きいリスク */
  function topGrade(k) {
    var best = { score: 0, text: '', cls: 'none' };
    risksOf(k).forEach(function (r) {
      var g = grade(r.p, r.s);
      if (g.score > best.score) best = g;
    });
    return best;
  }

  function listOf(siteId) {
    return Store.list('ky', null, siteId).sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  }

  function todayOf(siteId) {
    var t = U.todayStr();
    return listOf(siteId).filter(function (k) { return k.date === t; });
  }

  /**
   * 参加者。[{ name, sign }] で持つ。
   * 以前の記録は「1行に1人」の文字で入っているので、そちらからも読めるようにしている。
   */
  function people(k) {
    var list = k && Array.isArray(k.people) ? k.people : null;
    if (!list) {
      list = String((k && k.members) || '').split('\n').map(function (x) { return { name: x.trim() }; });
    }
    return list.filter(function (p) { return p && (p.name || !Sign.isEmpty(p.sign)); });
  }

  /** 現場代理人。以前は「担当者」の名前で recorder に入れていた */
  function agentOf(k) { return (k && (k.agent || k.recorder)) || ''; }

  /* ------------------------------------------------------------------ *
   * 一覧（現場のタブ／現場の画面の両方から使う）
   * ------------------------------------------------------------------ */
  function listHtml(site, limit) {
    var all = listOf(site.id);
    if (!all.length) return UI.empty('まだKY活動表がありません。');
    var rows = limit ? all.slice(0, limit) : all;
    return '<ul class="list">' + rows.map(function (k) {
      var g = topGrade(k);
      var tags = [];
      if (g.text) tags.push({ cls: g.cls === 'ok' ? 'none' : g.cls, text: 'リスク' + g.text });
      tags.push({ cls: 'none', text: people(k).length + '名' });
      return '<li>' + UI.rowLink('#/ky/' + encodeURIComponent(k.id), {
        count: Number(k.date.slice(8)), unit: Number(k.date.slice(5, 7)) + '月',
        countClass: k.date === U.todayStr() ? '' : 'done',
        main: k.work || '（作業内容なし）',
        subHtml: esc([k.leader ? 'リーダー：' + k.leader : '', k.company].filter(Boolean).join('　／　')),
        tags: tags
      }) + '</li>';
    }).join('') + '</ul>' +
      (limit && all.length > limit
        ? UI.btnRow('<a class="btn plain" href="#/ky-list?site=' + encodeURIComponent(site.id) + '">すべて見る（' + all.length + '件）</a>')
        : '');
  }

  MT.kyFieldSection = function (site) {
    var today = todayOf(site.id);
    var sid = encodeURIComponent(site.id);
    var html = UI.h2('KY', 'リスクアセスメントＫＹ活動表');
    if (!today.length) {
      html += '<div class="card"><p class="section-note">本日のKY活動表はまだありません。朝礼で話し合った内容を入れてください。</p>' +
        UI.btnRow('<a class="btn lead" href="#/ky/new?site=' + sid + '">本日のKY活動表をつくる</a>') + '</div>';
    } else {
      html += '<ul class="list">' + today.map(function (k) {
        var g = topGrade(k);
        return '<li>' + UI.rowLink('#/ky/' + encodeURIComponent(k.id), {
          count: '済', unit: 'TODAY', countClass: 'done',
          main: k.work || '（作業内容なし）',
          subHtml: esc(people(k).length + '名　' + (k.leader ? 'リーダー：' + k.leader : '')),
          tags: g.text ? [{ cls: g.cls === 'ok' ? 'none' : g.cls, text: 'リスク' + g.text }] : []
        }) + '</li>';
      }).join('') + '</ul>' +
        UI.btnRow('<a class="btn secondary" href="#/ky/new?site=' + sid + '">もう1件つくる</a>');
    }
    return html;
  };

  /* ------------------------------------------------------------------ *
   * 現場の「KY」タブ（事務所）
   * ------------------------------------------------------------------ */
  MT.siteTabs.ky = {
    label: 'KY',
    badge: function (site) {
      var n = todayOf(site.id).length;
      return n ? '本日' + n : '';
    },
    render: function (site) {
      var sid = encodeURIComponent(site.id);
      var today = todayOf(site.id);
      var html = '';
      if (!today.length) {
        html += UI.alert('warn', '<strong>本日のKY活動表がまだありません。</strong>現場のQRからでも作れます。');
      }
      html += UI.h2('LIST', 'KY活動表') + listHtml(site, 12);
      html += UI.btnRow('<a class="btn" href="#/ky/new?site=' + sid + '">KY活動表をつくる</a>');
      return html;
    }
  };

  MT.route('ky-list', { access: 'field' }, function (m, params) {
    var site = Store.get('sites', params.site);
    if (!site) return MT.notFound('現場が見つかりません。');
    if (!MT.requireSiteAccess(site.id)) return;
    U.app().innerHTML = UI.backLink(Session.isAdmin()
      ? '#/site/' + encodeURIComponent(site.id) + '?tab=ky' : '#/site/' + encodeURIComponent(site.id), '戻る') +
      UI.pageHead('KY', 'KY活動表') +
      '<p class="muted">' + esc(site.name) + '</p>' + listHtml(site);
  });

  /* ------------------------------------------------------------------ *
   * 入力
   * ------------------------------------------------------------------ */
  function riskRowHtml(i, r) {
    r = r || {};
    var g = grade(r.p, r.s);
    return '<div class="ky-row" data-row="' + i + '">' +
      '<div class="ky-row-head">危険 ' + (i + 1) +
      '<span class="ky-grade ' + g.cls + '" data-grade="' + i + '">' +
      (g.text ? '評価 ' + g.score + '（' + g.text + '）' : '可能性と重大性を選ぶと評価が出ます') + '</span></div>' +
      UI.field('この作業の潜在危険', UI.text('r-h' + i, r.hazard, '例：バックホウの旋回範囲に入って接触する')) +
      '<div class="field-row">' +
      UI.field('可能性', UI.select('r-p' + i, BLANK.concat(POSS), r.p || '')) +
      UI.field('重大性', UI.select('r-s' + i, BLANK.concat(SEV), r.s || '')) +
      '</div>' +
      UI.field('だから私たちはこうする', UI.text('r-m' + i, r.measure, '例：旋回範囲に立入禁止のカラーコーンを置く')) +
      '</div>';
  }

  /** 参加者1人分（氏名＋自筆サイン） */
  function memberRowHtml(i, p) {
    p = p || {};
    return '<div class="mem-row" data-mem="' + i + '">' +
      '<div class="mem-no">' + (i + 1) + '</div>' +
      '<div class="mem-body">' + UI.text('m-n' + i, p.name, '氏名') +
      Sign.boxHtml('m' + i, {
        label: '参加者 ' + (i + 1) + ' の自筆サイン',
        value: p.sign,
        placeholder: 'ここをタッチして署名'
      }) + '</div></div>';
  }

  function form(ky, siteId) {
    var isNew = !ky;
    ky = ky || { siteId: siteId, date: U.todayStr(), risks: [] };
    var site = Store.get('sites', ky.siteId);
    if (!site) return MT.notFound('現場が見つかりません。');
    if (!MT.requireSiteAccess(site.id)) return;
    Sign.reset();

    var admin = Session.isAdmin();
    var back = isNew
      ? (admin ? '#/site/' + encodeURIComponent(site.id) + '?tab=ky' : '#/site/' + encodeURIComponent(site.id))
      : '#/ky/' + encodeURIComponent(ky.id);
    var company = ky.company || (global.APP_CONFIG && global.APP_CONFIG.company) || '';

    var html = UI.backLink(back, '戻る') +
      UI.pageHead('KY', isNew ? 'KY活動表をつくる' : 'KY活動表の修正') +
      '<p class="muted">' + esc(site.name) + '</p>' +
      '<div class="card">' +
      '<div class="field-row">' +
      UI.field('日付', UI.date('f-date', ky.date || U.todayStr()), true) +
      UI.field('天気', UI.select('f-weather', BLANK.concat(WEATHER.map(function (w) { return [w, w]; })), ky.weather || '')) +
      '</div>' +
      '<div class="field-row">' +
      UI.field('会社名', UI.text('f-company', company)) +
      UI.field('リーダー', UI.text('f-leader', ky.leader), true) +
      '</div>' +
      UI.field('現場代理人', UI.text('f-agent', agentOf(ky) || (Session.user ? Session.user.name : ''))) +
      UI.field('作業内容', UI.textarea('f-work', ky.work, '例：〇〇地区 掘削工（バックホウ0.45㎥）、残土運搬'), true) +
      '</div>';

    html += UI.h2('RISK', '危険と対策') + '<div class="card">';
    for (var i = 0; i < ROWS; i++) html += riskRowHtml(i, (ky.risks || [])[i]);
    html += '</div>';

    html += UI.h2('GOAL', '本日の行動目標') +
      '<div class="card">' +
      UI.field('行動目標', UI.text('f-goal', ky.goal, '例：旋回範囲に入らない　ヨシ！')) +
      '</div>';

    var ppl = people(ky);
    var memRows = Math.min(MEMBERS, Math.max(4, ppl.length + 1));
    html += UI.h2('SIGN', '参加者（自筆）') +
      '<p class="section-note">氏名を入れて、ご本人がサイン欄をタッチして署名してください。' +
      '入力した人数が「作業員 ○名」になります。</p>' +
      '<div class="card"><div id="mem-list">';
    for (var p = 0; p < memRows; p++) html += memberRowHtml(p, ppl[p]);
    html += '</div>' +
      UI.btnRow('<button class="btn small plain" id="b-add-mem">参加者を増やす</button>') + '</div>';

    html += UI.btnRow('<button class="btn lead block" id="b-save">保存</button>') +
      UI.btnRow('<a class="btn plain" href="' + esc(back) + '">キャンセル</a>' +
        (isNew || !admin ? '' : '<button class="btn danger" id="b-del">この記録を削除</button>'));

    U.app().innerHTML = html;

    /* 可能性・重大性を選んだら、その場で評価を出す */
    function refresh(i) {
      var g = grade(U.val('#r-p' + i), U.val('#r-s' + i));
      var el = U.qs('[data-grade="' + i + '"]');
      if (!el) return;
      el.className = 'ky-grade ' + g.cls;
      el.textContent = g.text ? '評価 ' + g.score + '（' + g.text + '）' : '可能性と重大性を選ぶと評価が出ます';
    }
    for (var k = 0; k < ROWS; k++) {
      (function (i) {
        U.on('#r-p' + i, 'change', function () { refresh(i); });
        U.on('#r-s' + i, 'change', function () { refresh(i); });
      })(k);
    }

    U.on('#b-add-mem', 'click', function () {
      var list = U.qs('#mem-list');
      var n = list.children.length;
      if (n >= MEMBERS) return U.toast('この様式に書ける参加者は' + MEMBERS + '名までです');
      list.insertAdjacentHTML('beforeend', memberRowHtml(n, null));
      var input = U.qs('#m-n' + n);
      if (input) input.focus();
    });

    U.on('#b-save', 'click', function () {
      var date = U.val('#f-date');
      var leader = U.val('#f-leader');
      var work = U.val('#f-work');
      if (!U.isDate(date)) return U.toast('日付を入れてください');
      if (!leader) return U.toast('リーダーを入れてください');
      if (!work) return U.toast('作業内容を入れてください');

      var risks = [];
      var any = false;
      for (var i = 0; i < ROWS; i++) {
        var r = {
          hazard: U.val('#r-h' + i),
          p: U.val('#r-p' + i),
          s: U.val('#r-s' + i),
          measure: U.val('#r-m' + i)
        };
        if (r.hazard || r.measure) any = true;
        risks.push(r);
      }
      if (!any) return U.toast('危険と対策を、少なくとも1つ入れてください');

      ky.siteId = site.id;
      ky.date = date;
      ky.weather = U.val('#f-weather');
      ky.company = U.val('#f-company');
      ky.leader = leader;
      ky.agent = U.val('#f-agent');
      ky.work = work;
      ky.goal = U.val('#f-goal');

      var mem = [];
      U.qsa('#mem-list .mem-row').forEach(function (row, j) {
        var nm = U.val('#m-n' + j);
        var sg = Sign.get('m' + j);
        if (!nm && !sg) return;
        mem.push(sg ? { name: nm, sign: sg } : { name: nm });
      });
      ky.people = mem;
      delete ky.members;          // 以前の持ち方（1行に1人の文字）は残さない
      delete ky.recorder;         // 「担当者」は「現場代理人」に変えた
      ky.risks = risks;
      Store.put('ky', ky);
      U.toast('保存しました');
      U.go('#/ky/' + encodeURIComponent(ky.id));
    });

    U.on('#b-del', 'click', function () {
      if (!confirm('このKY活動表を削除します。よろしいですか？')) return;
      Store.remove('ky', ky.id);
      U.toast('削除しました');
      U.go('#/site/' + encodeURIComponent(site.id) + '?tab=ky');
    });
  }

  MT.route('ky/new', { access: 'field', form: true }, function (m, params) { form(null, params.site); });
  MT.route('ky/([^/]+)/edit', { access: 'field', form: true }, function (m) {
    var k = Store.get('ky', m[0]);
    if (!k) return MT.notFound('KY活動表が見つかりません。');
    form(k);
  });

  /* ------------------------------------------------------------------ *
   * 1件の表示
   * ------------------------------------------------------------------ */
  MT.route('ky/([^/]+)', { access: 'field' }, function (m) {
    var ky = Store.get('ky', m[0]);
    if (!ky) {
      if (MT.sync.status().running) return MT.loading();
      return MT.notFound('KY活動表が見つかりません。');
    }
    if (!MT.requireSiteAccess(ky.siteId)) return;
    var site = Store.get('sites', ky.siteId) || {};
    var admin = Session.isAdmin();
    var id = encodeURIComponent(ky.id);
    var g = topGrade(ky);

    var html = UI.backLink(admin ? '#/site/' + encodeURIComponent(ky.siteId) + '?tab=ky'
      : '#/site/' + encodeURIComponent(ky.siteId), '戻る') +
      UI.pageHead('KY', 'ＫＹ活動表') +
      '<p class="muted">' + esc(site.name) + '　' + esc(U.formatDate(ky.date)) +
      '（' + esc(U.weekday(ky.date)) + '）' + (ky.weather ? '　' + esc(ky.weather) : '') + '</p>';

    html += '<div class="card"><table class="kv"><tbody>' +
      '<tr><th>作業内容</th><td>' + U.nl2br(ky.work) + '</td></tr>' +
      '<tr><th>会社名</th><td>' + esc(ky.company || '－') + '</td></tr>' +
      '<tr><th>リーダー</th><td>' + esc(ky.leader || '－') + '</td></tr>' +
      '<tr><th>現場代理人</th><td>' + esc(agentOf(ky) || '－') + '</td></tr>' +
      '<tr><th>本日の行動目標</th><td>' + esc(ky.goal || '－') + '</td></tr>' +
      '</tbody></table></div>';

    var mem = people(ky);
    var signed = mem.filter(function (p) { return !Sign.isEmpty(p.sign); }).length;
    html += UI.h2('MEMBER', '参加者（' + mem.length + '名）');
    if (!mem.length) html += UI.empty('入力がありません。');
    else {
      html += '<div class="card"><div class="mem-view">' + mem.map(function (p) {
        var ok = !Sign.isEmpty(p.sign);
        return '<span class="mem-chip">' +
          (ok ? '<span class="mem-sig">' + Sign.svg(p.sign) + '</span>' : '') +
          '<span class="mem-nm' + (ok ? '' : ' unsigned') + '">' + esc(p.name || '（氏名なし）') + '</span></span>';
      }).join('') + '</div>' +
        '<p class="section-note">' + signed + '名が自筆で署名しています。</p></div>';
    }

    html += UI.h2('RISK', '危険と対策' + (g.text ? '（最大リスク：' + g.text + '）' : ''));
    var rs = risksOf(ky);
    if (!rs.length) html += UI.empty('入力がありません。');
    else {
      html += '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>この作業の潜在危険</th><th class="r">可能性</th><th class="r">重大性</th><th class="r">評価</th>' +
        '<th>だから私たちはこうする</th></tr></thead><tbody>' +
        rs.map(function (r) {
          var gr = grade(r.p, r.s);
          return '<tr><td>' + esc(r.hazard) + '</td>' +
            '<td class="r">' + esc(r.p || '－') + '</td><td class="r">' + esc(r.s || '－') + '</td>' +
            '<td class="r">' + (gr.text ? gr.score + '（' + esc(gr.text) + '）' : '－') + '</td>' +
            '<td>' + esc(r.measure) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    html += UI.btnRow('<a class="btn secondary" href="#/ky/' + id + '/edit">修正する</a>' +
      '<a class="btn plain" href="#/print/ky?id=' + id + '">印刷（A4横）</a>');
    U.app().innerHTML = html;
  });

  /* ------------------------------------------------------------------ *
   * 印刷（社内様式：A4横）
   * ------------------------------------------------------------------ */
  function pick(on, text) {
    return on ? '<span class="ky-pick">' + esc(text) + '</span>' : esc(text);
  }

  MT.route('print/ky', { access: 'field', print: true }, function (m, params) {
    var ky = Store.get('ky', params.id);
    if (!ky) return MT.notFound('KY活動表が見つかりません。');
    if (!MT.requireSiteAccess(ky.siteId)) return;
    var site = Store.get('sites', ky.siteId) || {};
    var mem = people(ky);
    var risks = (ky.risks || []).slice(0, ROWS);
    while (risks.length < ROWS) risks.push({});

    var body = '';
    risks.forEach(function (r) {
      var gr = grade(r.p, r.s);
      var lines = [
        [POSS[0][1], SEV[0][1], '（３以下）', '小さい'],
        [POSS[1][1], SEV[1][1], '（４）', '中程度'],
        [POSS[2][1], SEV[2][1], '（５以上）', '大きい']
      ];
      lines.forEach(function (ln, j) {
        body += '<tr>';
        if (j === 0) {
          body += '<td class="ky-haz" rowspan="3">' + U.nl2br(r.hazard || '') + '</td>';
        }
        body += '<td class="ky-lv">' + pick(String(r.p) === String(j + 1), ln[0]) + '</td>' +
          '<td class="ky-plus">' + (j === 1 ? '＋' : '') + '</td>' +
          '<td class="ky-lv">' + pick(String(r.s) === String(j + 1), ln[1]) + '</td>' +
          '<td class="ky-plus">' + (j === 1 ? '＝' : '') + '</td>' +
          '<td class="ky-ev">' + esc(ln[2]) + (gr.text === ln[3] ? '☑' : '□') + esc(ln[3]) + '</td>';
        if (j === 0) {
          body += '<td class="ky-mea" rowspan="3">' + U.nl2br(r.measure || '') + '</td>';
        }
        body += '</tr>';
      });
    });

    /* 自筆の欄。署名があればその線を、無ければ入力された氏名を載せる */
    function memCell(p) {
      return '<td>' + (p ? Sign.inkOr(p.sign, p.name) : '') + '</td>';
    }
    var cells1 = '', cells2 = '';
    for (var i = 0; i < 6; i++) {
      cells1 += memCell(mem[i]);
      cells2 += memCell(mem[i + 6]);
    }

    U.app().innerHTML = UI.printBar('#/ky/' + encodeURIComponent(ky.id), '用紙の向きは「横」にしてください。') +
      '<div class="print-sheet"><div class="ky-doc">' +
      '<table class="ky-title-row"><tbody><tr>' +
      '<td class="ky-title">リスクアセスメント　ＫＹ　活動表</td>' +
      '<th class="ky-th">現場代理人</th><td class="ky-name">' + esc(agentOf(ky) || '') + '</td>' +
      '</tr></tbody></table>' +
      '<table class="ky-top"><tbody>' +
      '<tr><th>作業所名：</th><td>' + esc(site.name || '') + '</td>' +
      '<th>' + Number(ky.date.slice(5, 7)) + '月　' + Number(ky.date.slice(8)) + '日（ ' + esc(U.weekday(ky.date)) + ' 曜）天気</th>' +
      '<td>' + esc(ky.weather || '') + '</td></tr>' +
      '<tr><th>会 社 名：</th><td>' + esc(ky.company || '') + '</td>' +
      '<th>リーダー：</th><td>' + esc(ky.leader || '') + '</td></tr>' +
      '<tr><th>作業内容：</th><td colspan="3">' + U.nl2br(ky.work || '') + '</td></tr>' +
      '</tbody></table>' +
      '<table class="ky-risk"><thead>' +
      '<tr><th rowspan="2" class="ky-haz">この作業の潜在危険</th>' +
      '<th colspan="5">リスク見積（足算式）</th>' +
      '<th rowspan="2" class="ky-mea">だから私たちはこうする</th></tr>' +
      '<tr><th>可能性</th><th>＋</th><th>重大性</th><th>＝</th><th>評価：リスクの大きさ</th></tr>' +
      '</thead><tbody>' + body + '</tbody></table>' +
      '<table class="ky-goal"><tbody><tr><th>本日の行動目標</th><td>' + esc(ky.goal || '') + '</td></tr></tbody></table>' +
      '<table class="ky-mem"><tbody>' +
      '<tr><th rowspan="2" class="ky-mem-th">参加者名<br>（自筆）</th>' + cells1 +
      '<th rowspan="2" class="ky-count">作業員<br>' + mem.length + '　名</th></tr>' +
      '<tr>' + cells2 + '</tr>' +
      '</tbody></table>' +
      '</div></div>';
    UI.bindPrint();
  });
})(window);
