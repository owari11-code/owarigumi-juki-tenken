/*
 * views/entrant.js - 新規入場者調査票（参考様式第4号）
 *
 * 個人情報の扱い
 *   ・現場の端末（QR）からは「書けるが読めない」。送ったあとは端末から消える。
 *   ・一覧・印刷ができるのは、事務所（ログイン）だけ。
 *   資格の欄は data/licenses.js（愛知県 土木工事現場必携・法令が出典）を使う。
 */
(function (global) {
  'use strict';

  var MT = global.MT;
  var U = MT.util;
  var UI = MT.ui;
  var Store = MT.store;
  var Session = MT.session;
  var Sync = MT.sync;
  var L = MT.licenses;
  var esc = U.esc;

  var YN = [['', '選んでください'], ['yes', 'はい'], ['no', 'いいえ']];
  var CONTRACT = [['', '選んでください'], ['done', '取り交わし済み'], ['not', '未だ']];
  var YEARS = [['', '選んでください'], ['1', '1年以内'], ['2', '1〜3年'], ['3', '3年以上']];
  var HEALTH = [['', '選んでください'], ['1', 'よい'], ['2', 'まあまあである'], ['3', 'あまりよくない']];
  var BLOOD = [['', ''], ['A', 'A'], ['B', 'B'], ['O', 'O'], ['AB', 'AB']];

  function labelOf(opts, v) {
    for (var i = 0; i < opts.length; i++) if (opts[i][0] === String(v || '')) return opts[i][1];
    return '';
  }

  function ageOf(birth, at) {
    if (!U.isDate(birth)) return '';
    var d = at || U.todayStr();
    var a = Number(d.slice(0, 4)) - Number(birth.slice(0, 4));
    if (d.slice(5) < birth.slice(5)) a--;
    return a >= 0 && a < 130 ? a : '';
  }

  function listOf(siteId) {
    return Store.list('entrants', null, siteId).sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  }

  /* 送り終えたものは、この端末から消す（現場に個人情報を残さないため） */
  function purgeSent() {
    if (Session.isAdmin()) return;
    Store.list('entrants').forEach(function (e) {
      var raw = Store.raw('entrants', e.id);
      if (raw && !raw._dirty) Store.forget('entrants', e.id);
    });
  }
  Store.ready.then(purgeSent);
  Sync.onStatus(function (st) { if (!st.running) purgeSent(); });
  // 送信が終わって「未送信」でなくなった時点で消す
  Store.onChange(function () { purgeSent(); });

  /* ------------------------------------------------------------------ *
   * 現場の画面（QR）に出す案内
   * ------------------------------------------------------------------ */
  MT.entrantFieldSection = function (site) {
    return UI.h2('ENTRY', '新規入場者調査票') +
      '<div class="card"><p class="section-note">この現場で初めて働く方は、入場前に記入してください。' +
      '書いた内容は事務所に送られます。<strong>この端末には残りません。</strong></p>' +
      UI.btnRow('<a class="btn secondary" href="#/entrant/new?site=' + encodeURIComponent(site.id) + '">新規入場者調査票を書く</a>') +
      '</div>';
  };

  /* ------------------------------------------------------------------ *
   * 現場の「入場者」タブ（事務所だけ）
   * ------------------------------------------------------------------ */
  MT.siteTabs.entrant = {
    label: '入場者',
    badge: function (site) {
      var n = listOf(site.id).length;
      return n ? String(n) : '';
    },
    render: function (site) {
      var sid = encodeURIComponent(site.id);
      var all = listOf(site.id);
      var html = UI.h2('ENTRY', '新規入場者調査票');
      if (!all.length) {
        html += UI.empty('まだ提出がありません。現場のQRから書いてもらえます。');
      } else {
        html += '<ul class="list">' + all.map(function (e) {
          var tags = [];
          if (e.alone === 'yes') tags.push({ cls: e.roshi === 'yes' ? 'none' : 'ng', text: e.roshi === 'yes' ? '一人親方・労災加入' : '一人親方・未加入' });
          if (e.health === 'no') tags.push({ cls: 'warn', text: '健診未受診' });
          if (e.condition === '3') tags.push({ cls: 'warn', text: '体調に不安' });
          return '<li>' + UI.rowLink('#/entrant/' + encodeURIComponent(e.id), {
            count: Number(e.date.slice(8)), unit: Number(e.date.slice(5, 7)) + '月',
            countClass: 'done',
            main: e.name || '（氏名なし）',
            subHtml: esc([e.belong || e.company, e.job].filter(Boolean).join('　／　')),
            tags: tags
          }) + '</li>';
        }).join('') + '</ul>';
      }
      html += UI.btnRow('<a class="btn secondary" href="#/entrant/new?site=' + sid + '">事務所で代わりに入力する</a>');
      return html;
    }
  };

  /* ------------------------------------------------------------------ *
   * 入力
   * ------------------------------------------------------------------ */
  function licenseHtml(sel, other) {
    sel = sel || [];
    other = other || {};
    return L.GROUPS.map(function (g) {
      return '<div class="lic-group"><div class="lic-name">' + esc(g.name) +
        (g.note ? '<span class="lic-note">' + esc(g.note) + '</span>' : '') + '</div>' +
        '<div class="lic-items">' + g.items.map(function (it) {
          var key = g.id + '.' + it.id;
          return UI.checkbox('lic-' + g.id + '-' + it.id, it.name, sel.indexOf(key) >= 0);
        }).join('') + '</div>' +
        UI.field('その他（' + g.name + '）', UI.text('lo-' + g.id, other[g.id], '講習名を書いてください')) +
        '</div>';
    }).join('');
  }

  function form(rec, siteId) {
    var isNew = !rec;
    rec = rec || { siteId: siteId, date: U.todayStr(), emergency: [{}, {}], licenses: [], licenseOther: {} };
    var site = Store.get('sites', rec.siteId);
    if (!site) return MT.notFound('現場が見つかりません。');
    if (!MT.requireSiteAccess(site.id)) return;

    var admin = Session.isAdmin();
    var back = admin
      ? (isNew ? '#/site/' + encodeURIComponent(site.id) + '?tab=entrant' : '#/entrant/' + encodeURIComponent(rec.id))
      : '#/site/' + encodeURIComponent(site.id);
    var em = rec.emergency && rec.emergency.length ? rec.emergency : [{}, {}];

    var html = UI.backLink(back, '戻る') +
      UI.pageHead('ENTRY', '新規入場者調査票') +
      '<p class="muted">' + esc(site.name) + '</p>' +
      UI.alert('info', 'この調査票の個人情報は、<strong>安全衛生管理および緊急時の連絡・対応</strong>のために使います。' +
        '厳重に管理し、法令に定める場合を除いて第三者には提供しません。不要になったときは責任を持って処分します。');

    html += UI.h2('BASIC', '本人のこと') + '<div class="card">' +
      UI.field('新規入場日', UI.date('f-date', rec.date || U.todayStr()), true) +
      UI.field('ふりがな', UI.text('f-kana', rec.kana)) +
      UI.field('氏名', UI.text('f-name', rec.name), true) +
      '<div class="field-row">' +
      UI.field('生年月日', UI.date('f-birth', rec.birth)) +
      UI.field('血液型', UI.select('f-blood', BLOOD, rec.blood)) +
      '</div>' +
      UI.field('現住所', UI.text('f-address', rec.address)) +
      UI.field('電話番号', UI.text('f-tel', rec.tel, '090-0000-0000', ' inputmode="tel"')) +
      '</div>';

    html += UI.h2('SOS', '緊急連絡先') + '<div class="card">' +
      em.slice(0, 2).map(function (e, i) {
        return '<div class="em-row"><div class="section-note">連絡先 ' + (i + 1) + (i ? '（任意）' : '') + '</div>' +
          '<div class="field-row">' +
          UI.field('氏名', UI.text('e-n' + i, e.name)) +
          UI.field('続柄', UI.text('e-r' + i, e.rel, '例：妻')) +
          '</div>' +
          UI.field('電話番号', UI.text('e-t' + i, e.tel, '', ' inputmode="tel"')) +
          UI.field('現住所', UI.text('e-a' + i, e.address)) + '</div>';
      }).join('') + '</div>';

    html += UI.h2('COMPANY', '働いている会社') + '<div class="card">' +
      UI.field('事業者名（一次）', UI.text('f-company', rec.company)) +
      UI.field('所属会社', UI.text('f-belong', rec.belong)) +
      '<div class="field-row">' +
      UI.field('雇用年月日', UI.date('f-hire', rec.hireDate)) +
      UI.field('職種', UI.text('f-job', rec.job, '例：土工')) +
      '</div>' +
      UI.field('雇用契約書', UI.select('f-contract', CONTRACT, rec.contract)) +
      '</div>';

    html += UI.h2('SURVEY', 'アンケート') + '<div class="card">' +
      UI.field('あなたは一人親方・中小事業主ですか', UI.select('f-alone', YN, rec.alone)) +
      UI.field('（はいの方）労災保険に特別加入していますか', UI.select('f-roshi',
        [['', '選んでください'], ['yes', 'している'], ['no', '未加入']], rec.roshi)) +
      UI.field('建設現場で働きはじめてどのくらいになりますか', UI.select('f-years', YEARS, rec.years)) +
      '<div class="field-row">' +
      UI.field('健康診断を受けましたか', UI.select('f-health',
        [['', '選んでください'], ['yes', '受けた'], ['no', '受けていない']], rec.health)) +
      UI.field('受けた月', UI.text('f-healthYm', rec.healthYm, '例：2026年4月')) +
      '</div>' +
      UI.field('最近の健康状態はどうですか', UI.select('f-condition', HEALTH, rec.condition)) +
      UI.field('この現場へ来る前に、事業主から送り出し教育を受けましたか', UI.select('f-sendoff', YN, rec.sendoff)) +
      UI.field('建設業退職金共済手帳等を持っていますか', UI.select('f-taishoku',
        [['', '選んでください'], ['yes', '持っている'], ['no', '持っていない']], rec.taishoku), false,
        '持っていない方は、会社を通じて共済手帳の発行を受けてください') +
      '</div>';

    html += UI.h2('LICENSE', '資格について') +
      '<p class="section-note">持っている資格に印を付けてください。免許証・修了証は現場に携帯してください。</p>' +
      '<div class="card lic-box">' + licenseHtml(rec.licenses, rec.licenseOther) + '</div>';

    html += UI.h2('PLEDGE', '誓約') + '<div class="card">' +
      '<ul class="pledge">' +
      '<li>私は、当作業所の新規入場者教育を受けました。</li>' +
      '<li>作業所の遵守事項や安全基準を守り、自分の身を守り、周囲の人の安全にも気を配って作業します。</li>' +
      '<li>どんな小さなケガでも、必ず当日に報告します。危険箇所や有害箇所を見つけたときは、直ちに安全衛生責任者または元請職員に連絡します。</li>' +
      '<li>個人情報の取扱いについて、了承しました。</li>' +
      '</ul>' +
      UI.checkbox('f-agree', '上の内容に同意します', !!rec.agree) +
      UI.field('氏名（自署の代わりに入力）', UI.text('f-sign', rec.sign)) +
      '</div>';

    html += UI.btnRow('<button class="btn lead block" id="b-save">提出する</button>') +
      UI.btnRow('<a class="btn plain" href="' + esc(back) + '">キャンセル</a>' +
        (isNew || !admin ? '' : '<button class="btn danger" id="b-del">この調査票を削除</button>'));

    U.app().innerHTML = html;

    U.on('#b-save', 'click', function () {
      var name = U.val('#f-name');
      var date = U.val('#f-date');
      if (!name) return U.toast('氏名を入れてください');
      if (!U.isDate(date)) return U.toast('新規入場日を入れてください');
      if (!U.checked('#f-agree')) return U.toast('誓約の内容に同意してください');

      var sel = [];
      var other = {};
      L.GROUPS.forEach(function (g) {
        g.items.forEach(function (it) {
          if (U.checked('#lic-' + g.id + '-' + it.id)) sel.push(g.id + '.' + it.id);
        });
        var o = U.val('#lo-' + g.id);
        if (o) other[g.id] = o;
      });

      rec.siteId = site.id;
      rec.date = date;
      rec.kana = U.val('#f-kana');
      rec.name = name;
      rec.birth = U.val('#f-birth');
      rec.blood = U.val('#f-blood');
      rec.address = U.val('#f-address');
      rec.tel = U.val('#f-tel');
      rec.emergency = [0, 1].map(function (i) {
        return { name: U.val('#e-n' + i), rel: U.val('#e-r' + i), tel: U.val('#e-t' + i), address: U.val('#e-a' + i) };
      }).filter(function (e) { return e.name || e.tel; });
      rec.company = U.val('#f-company');
      rec.belong = U.val('#f-belong');
      rec.hireDate = U.val('#f-hire');
      rec.job = U.val('#f-job');
      rec.contract = U.val('#f-contract');
      rec.alone = U.val('#f-alone');
      rec.roshi = U.val('#f-roshi');
      rec.years = U.val('#f-years');
      rec.health = U.val('#f-health');
      rec.healthYm = U.val('#f-healthYm');
      rec.condition = U.val('#f-condition');
      rec.sendoff = U.val('#f-sendoff');
      rec.taishoku = U.val('#f-taishoku');
      rec.licenses = sel;
      rec.licenseOther = other;
      rec.agree = true;
      rec.sign = U.val('#f-sign') || name;
      Store.put('entrants', rec);

      if (Session.isAdmin()) {
        U.toast('提出しました');
        return U.go('#/entrant/' + encodeURIComponent(rec.id));
      }
      U.go('#/entrant-done');
    });

    U.on('#b-del', 'click', function () {
      if (!confirm('この調査票を削除します。よろしいですか？')) return;
      Store.remove('entrants', rec.id);
      U.toast('削除しました');
      U.go('#/site/' + encodeURIComponent(site.id) + '?tab=entrant');
    });
  }

  MT.route('entrant/new', { access: 'field', form: true }, function (m, params) { form(null, params.site); });
  MT.route('entrant/([^/]+)/edit', { form: true }, function (m) {
    var e = Store.get('entrants', m[0]);
    if (!e) return MT.notFound('調査票が見つかりません。');
    form(e);
  });

  /* 提出後（現場の端末） */
  MT.route('entrant-done', { access: 'field' }, function () {
    var pending = Store.list('entrants').length;
    U.app().innerHTML = UI.pageHead('ENTRY', '提出しました') +
      UI.alert('info', '<strong>ありがとうございました。</strong>調査票は事務所に送られます。' +
        (pending ? '電波が届いていないときは、つながった時点で自動的に送られます。' : '') +
        'この端末には内容は残りません。') +
      UI.btnRow('<a class="btn lead" href="#/">現場の画面へ戻る</a>');
  });

  /* ------------------------------------------------------------------ *
   * 1件の表示（事務所だけ）
   * ------------------------------------------------------------------ */
  function kv(label, value) {
    return '<tr><th>' + esc(label) + '</th><td>' + (value ? esc(value) : '－') + '</td></tr>';
  }

  MT.route('entrant/([^/]+)', {}, function (m) {
    var e = Store.get('entrants', m[0]);
    if (!e) {
      if (MT.sync.status().running) return MT.loading();
      return MT.notFound('調査票が見つかりません。');
    }
    var site = Store.get('sites', e.siteId) || {};
    var id = encodeURIComponent(e.id);

    var html = UI.backLink('#/site/' + encodeURIComponent(e.siteId) + '?tab=entrant', '入場者へ戻る') +
      UI.pageHead('ENTRY', '新規入場者調査票') +
      '<p class="muted">' + esc(site.name) + '　' + esc(U.formatDate(e.date)) + ' 入場</p>';

    html += '<div class="card"><table class="kv"><tbody>' +
      kv('ふりがな', e.kana) + kv('氏名', e.name) +
      kv('生年月日', e.birth ? U.formatDate(e.birth) + '（' + ageOf(e.birth, e.date) + '歳）' : '') +
      kv('血液型', e.blood ? e.blood + '型' : '') +
      kv('現住所', e.address) + kv('電話番号', e.tel) +
      '</tbody></table></div>';

    html += UI.h2('SOS', '緊急連絡先') + '<div class="card"><table class="kv"><tbody>' +
      (e.emergency || []).map(function (x) {
        return kv(x.name + (x.rel ? '（' + x.rel + '）' : ''), [x.tel, x.address].filter(Boolean).join('　'));
      }).join('') + '</tbody></table></div>';

    html += UI.h2('COMPANY', '会社・アンケート') + '<div class="card"><table class="kv"><tbody>' +
      kv('事業者名（一次）', e.company) + kv('所属会社', e.belong) +
      kv('雇用年月日', e.hireDate ? U.formatDate(e.hireDate) : '') +
      kv('職種', e.job) + kv('雇用契約書', labelOf(CONTRACT, e.contract)) +
      kv('一人親方・中小事業主', labelOf(YN, e.alone)) +
      kv('労災保険の特別加入', e.roshi === 'yes' ? 'している' : e.roshi === 'no' ? '未加入' : '') +
      kv('建設現場の経験', labelOf(YEARS, e.years)) +
      kv('健康診断', e.health === 'yes' ? '受けた' + (e.healthYm ? '（' + e.healthYm + '）' : '') : e.health === 'no' ? '受けていない' : '') +
      kv('最近の健康状態', labelOf(HEALTH, e.condition)) +
      kv('送り出し教育', labelOf(YN, e.sendoff)) +
      kv('建退共手帳', e.taishoku === 'yes' ? '持っている' : e.taishoku === 'no' ? '持っていない' : '') +
      '</tbody></table></div>';

    var groups = L.byGroup(e.licenses);
    html += UI.h2('LICENSE', '資格');
    if (!groups.length && !Object.keys(e.licenseOther || {}).length) {
      html += UI.empty('申告された資格はありません。');
    } else {
      html += '<div class="card"><table class="kv"><tbody>' +
        groups.map(function (g) { return kv(g.group, g.names.join('、')); }).join('') +
        Object.keys(e.licenseOther || {}).map(function (k) {
          return kv('その他', e.licenseOther[k]);
        }).join('') +
        '</tbody></table></div>';
    }

    html += UI.btnRow('<a class="btn secondary" href="#/entrant/' + id + '/edit">修正する</a>' +
      '<a class="btn plain" href="#/print/entrant?id=' + id + '">印刷（参考様式第4号）</a>');
    U.app().innerHTML = html;
  });

  /* ------------------------------------------------------------------ *
   * 印刷（参考様式第4号）
   * ------------------------------------------------------------------ */
  function box(on, text) {
    return '<span class="en-box">' + (on ? '☑' : '□') + esc(text) + '</span>';
  }

  MT.route('print/entrant', { print: true }, function (m, params) {
    var e = Store.get('entrants', params.id);
    if (!e) return MT.notFound('調査票が見つかりません。');
    var site = Store.get('sites', e.siteId) || {};
    var sel = e.licenses || [];
    var other = e.licenseOther || {};

    // 申告のあったものだけを載せる（全64項目を並べるとA4・1枚に収まらないため）
    var lic = L.GROUPS.map(function (g) {
      var got = g.items.filter(function (it) { return sel.indexOf(g.id + '.' + it.id) >= 0; });
      if (!got.length && !other[g.id]) return '';
      return '<tr><th>' + esc(g.name) + '</th><td>' +
        got.map(function (it) { return box(true, it.name); }).join('') +
        (other[g.id] ? '<span class="en-box">☑その他（' + esc(other[g.id]) + '）</span>' : '') +
        '</td></tr>';
    }).join('');
    if (!lic) lic = '<tr><td class="en-none">申告のあった資格はありません。</td></tr>';

    var em = (e.emergency || []).concat([{}, {}]).slice(0, 2);

    U.app().innerHTML = UI.printBar('#/entrant/' + encodeURIComponent(e.id), '用紙の向きは「縦」です。') +
      '<div class="print-sheet"><div class="doc en-doc">' +
      '<div class="en-head"><span class="en-form">参考様式第4号</span>' +
      '<span class="en-title">新規入場者調査票</span>' +
      '<span class="en-day">新規入場日　' + esc(U.formatDate(e.date)) + '</span></div>' +
      '<table class="meta"><tbody>' +
      '<tr><th>作業所</th><td>' + esc(site.name || '') + '</td><th>元請確認欄</th><td></td></tr>' +
      '</tbody></table>' +
      '<p class="en-note">下記調査票の個人情報については、安全衛生管理および緊急時の連絡・対応のために使用いたします。' +
      'また、当社において厳重に管理し、法令に定める場合を除き、第三者には提供いたしません。不要となった時は、責任を持って処分いたします。</p>' +
      '<table class="doc-table en-table"><tbody>' +
      '<tr><th>ふりがな</th><td>' + esc(e.kana || '') + '</td>' +
      '<th>生年月日</th><td>' + (e.birth ? esc(U.formatDate(e.birth)) + '（' + ageOf(e.birth, e.date) + '）歳' : '') + '</td>' +
      '<th>血液型</th><td>' + esc(e.blood || '') + '型</td></tr>' +
      '<tr><th>氏　名</th><td colspan="5">' + esc(e.name || '') + '</td></tr>' +
      '<tr><th>現住所</th><td colspan="3">' + esc(e.address || '') + '</td><th>TEL</th><td>' + esc(e.tel || '') + '</td></tr>' +
      '</tbody></table>' +
      '<table class="doc-table en-table"><thead><tr>' +
      '<th class="en-side" rowspan="3">緊急連絡先</th><th>氏　　　名</th><th>続柄</th><th>電話番号</th><th>現　住　所</th></tr></thead><tbody>' +
      em.map(function (x) {
        return '<tr><td>' + esc(x.name || '') + '</td><td>' + esc(x.rel || '') + '</td>' +
          '<td>' + esc(x.tel || '') + '</td><td>' + esc(x.address || '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<table class="doc-table en-table"><tbody>' +
      '<tr><th>事業者名（一次）</th><td>' + esc(e.company || '') + '</td>' +
      '<th>雇用年月日</th><td>' + (e.hireDate ? esc(U.formatDate(e.hireDate)) : '') + '</td></tr>' +
      '<tr><th>所属会社</th><td>' + esc(e.belong || '') + '</td>' +
      '<th>職　種</th><td>' + esc(e.job || '') + '</td></tr>' +
      '<tr><th>雇用契約書</th><td colspan="3">' +
      box(e.contract === 'done', '取り交わし済み') + box(e.contract === 'not', '未　だ') + '</td></tr>' +
      '</tbody></table>' +
      '<table class="doc-table en-table"><tbody>' +
      '<tr><th class="en-q">あなたは一人親方・中小事業主ですか</th><td>' +
      box(e.alone === 'yes', 'はい') + box(e.alone === 'no', 'いいえ') + '</td></tr>' +
      '<tr><th class="en-q">1.に○を付けた方は、労災保険に特別加入していますか</th><td>' +
      box(e.roshi === 'yes', 'している') + box(e.roshi === 'no', '未加入') + '</td></tr>' +
      '<tr><th class="en-q">建設現場で働きはじめてどのくらいになりますか</th><td>' +
      box(e.years === '1', '1年以内') + box(e.years === '2', '1〜3年') + box(e.years === '3', '3年以上') + '</td></tr>' +
      '<tr><th class="en-q">健康診断を受けましたか</th><td>' +
      box(e.health === 'yes', '受けた（' + (e.healthYm || '　　　　') + '）') + box(e.health === 'no', '受けていない') + '</td></tr>' +
      '<tr><th class="en-q">最近の健康状態はどうですか</th><td>' +
      box(e.condition === '1', 'よい') + box(e.condition === '2', 'まあまあである') + box(e.condition === '3', 'あまりよくない') + '</td></tr>' +
      '<tr><th class="en-q">この現場へ来る前に事業主から送り出し教育を受けてきましたか</th><td>' +
      box(e.sendoff === 'yes', 'はい') + box(e.sendoff === 'no', 'いいえ') + '</td></tr>' +
      '<tr><th class="en-q">建設業退職金共済手帳等を持っていますか</th><td>' +
      box(e.taishoku === 'yes', '持っている') + box(e.taishoku === 'no', 'いない') + '</td></tr>' +
      '</tbody></table>' +
      '<div class="en-sec">（資格について）<span class="en-sub">申告のあったものを記載</span></div>' +
      '<table class="doc-table en-table en-lic"><tbody>' + lic + '</tbody></table>' +
      '<div class="en-sec">【 誓約書 】</div>' +
      '<ul class="en-pledge">' +
      '<li>私は、当作業所新規入場者教育を受けました。</li>' +
      '<li>作業所の遵守事項や安全基準を遵守し、自分の身を守り、また周囲の人の安全にも気を配り作業します。</li>' +
      '<li>どんな小さなケガでも、必ず当日に報告します。危険箇所や有害箇所を発見したときは、直ちに安全衛生責任者もしくは、元請職員等に連絡します。</li>' +
      '<li>個人情報の取扱いについて、了承しました。</li>' +
      '</ul>' +
      '<table class="doc-table en-table"><tbody><tr>' +
      '<th>回答者サイン</th><td>' + esc(e.sign || e.name || '') + '</td>' +
      '<th>提出</th><td>' + esc(U.formatDate(e.date)) + '</td></tr></tbody></table>' +
      '</div></div>';
    UI.bindPrint();
  });
})(window);
