/*
 * model.js - 画面をまたいで使う「判定」や「集計」
 * （本日の点検状況・在庫数・貸出状況・進捗率・注意すべきこと など）
 */
(function (global) {
  'use strict';

  var U = global.MT.util;
  var Store = global.MT.store;
  var Cat = global.MT.cat;

  var M = {};

  /* ------------------------------------------------------------------ *
   * 現場
   * ------------------------------------------------------------------ */
  M.sites = function (opts) {
    opts = opts || {};
    return Store.list('sites', function (s) {
      if (s.depot) return !!opts.withDepot;
      if (opts.activeOnly && s.status === 'done') return false;
      return true;
    }).sort(function (a, b) {
      var order = { active: 0, planned: 1, done: 2 };
      var x = order[a.status || 'active'], y = order[b.status || 'active'];
      if (x !== y) return x - y;
      return U.byName(a, b);
    });
  };

  M.depot = function () {
    return Store.list('sites', function (s) { return !!s.depot; }).sort(function (a, b) {
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    })[0] || null;
  };

  /** 資機材置場が無ければ作る（工具の貸出に使う） */
  M.ensureDepot = function () {
    var d = M.depot();
    if (d) return d;
    return Store.put('sites', { name: '資機材置場（本社）', depot: true, status: 'active', fieldKey: U.randomKey() });
  };

  /**
   * QRの鍵が無い現場（以前の重機点検アプリで登録した現場）に鍵を付ける。
   * 事務所でログインして同期した後に呼ぶ。付けた件数を返す。
   */
  M.ensureSiteKeys = function () {
    var n = 0;
    Store.list('sites', function (s) { return !s.fieldKey; }).forEach(function (s) {
      s.fieldKey = U.randomKey();
      if (!s.status) s.status = 'active';
      Store.put('sites', s);
      n++;
    });
    return n;
  };

  M.siteStatusName = function (s) {
    return global.MT.assets.nameOf(global.MT.assets.SITE_STATUS, s.status || 'active', '施工中');
  };

  /* ------------------------------------------------------------------ *
   * 点検の対象
   * ------------------------------------------------------------------ */
  M.isHeavy = function (m) { return !m.category || m.category === 'heavy'; };

  /** 現場の点検対象（重機は machines、それ以外は targets） */
  M.targets = function (siteId, catId) {
    if (catId === 'heavy') {
      return Store.list('machines', M.isHeavy, siteId).sort(U.byName);
    }
    return Store.list('targets', function (t) { return t.category === catId; }, siteId).sort(U.byName);
  };

  M.targetKind = function (catId) { return catId === 'heavy' ? 'machines' : 'targets'; };

  M.targetOf = function (rec) {
    var id = rec.targetId || rec.machineId;
    var cat = Cat.of(rec);
    return Store.get(M.targetKind(cat.id), id);
  };

  M.targetIdOf = function (rec) { return rec.targetId || rec.machineId; };

  M.targetHref = function (catId, id) {
    return (catId === 'heavy' ? '#/machine/' : '#/target/') + encodeURIComponent(id);
  };

  /** 点検記録（古い順）。filter: { siteId, targetId, category, from, to, phase } */
  M.inspections = function (f) {
    f = f || {};
    return Store.list('inspections', function (r) {
      if (f.targetId && M.targetIdOf(r) !== f.targetId) return false;
      if (f.category && Cat.of(r).id !== f.category) return false;
      if (f.phase && r.phase !== f.phase) return false;
      if (f.from && r.date < f.from) return false;
      if (f.to && r.date > f.to) return false;
      return true;
    }, f.siteId).sort(U.byDateAsc);
  };

  /** 足場：是正日が入っていない「否・即時改善」の数 */
  M.openFixes = function (rec) {
    if (Cat.of(rec).id !== 'scaffold') return 0;
    var results = rec.results || {};
    var fixes = rec.fixes || {};
    return Object.keys(results).filter(function (k) {
      return (results[k] === 'ng' || results[k] === 'fix') && !(fixes[k] && fixes[k].date);
    }).length;
  };

  /** 1つの対象の本日の状況 */
  M.targetToday = function (target, catId) {
    var cat = Cat.get(catId);
    var today = U.todayStr();
    var recs = M.inspections({ siteId: target.siteId, targetId: target.id, from: today, to: today });
    var done = recs.some(function (r) { return r.phase === cat.dailyPhase; });
    var ng = recs.some(function (r) { return r.judgement === 'ng'; });
    return { done: done, ng: ng, records: recs };
  };

  /** 地山・土留：最後の土止め支保工点検からの日数（対象外なら null） */
  M.shoringAge = function (target) {
    var E = global.ExcavationData;
    if (target.category !== 'excavation' || !E.hasShoring(target.type)) return null;
    var recs = M.inspections({ siteId: target.siteId, targetId: target.id, phase: 'shoring' });
    var last = recs.length ? recs[recs.length - 1].date : null;
    var since = last || (target.createdAt ? U.dateStr(new Date(target.createdAt)) : U.todayStr());
    return { last: last, days: U.diffDays(since, U.todayStr()) };
  };

  /** 現場の本日の点検状況（種類ごと） */
  M.siteToday = function (siteId) {
    var out = { total: 0, done: 0, ng: 0, byCat: {} };
    Cat.ORDER.forEach(function (catId) {
      var list = M.targets(siteId, catId);
      var c = { total: list.length, done: 0, ng: 0 };
      list.forEach(function (t) {
        var st = M.targetToday(t, catId);
        if (st.done) c.done++;
        if (st.ng) c.ng++;
      });
      out.byCat[catId] = c;
      out.total += c.total;
      out.done += c.done;
      out.ng += c.ng;
    });
    return out;
  };

  /* ------------------------------------------------------------------ *
   * 機械（搬入・返却・期限）
   * ------------------------------------------------------------------ */
  M.machineLogs = function (machine) {
    return Store.list('machine_logs', function (l) { return l.machineId === machine.id; }, machine.siteId)
      .sort(U.byDateAsc);
  };

  /** 搬入・搬出の記録を、現場をまたいで全部（持出先を変えても履歴が続くように） */
  M.machineHistory = function (machine) {
    return Store.list('machine_logs', function (l) { return l.machineId === machine.id; }).sort(U.byDateAsc);
  };

  /** すべての重機・機械（現場をまたいだ一覧） */
  M.allMachines = function (heavyOnly) {
    return Store.list('machines', function (m) { return !heavyOnly || M.isHeavy(m); }).sort(function (a, b) {
      if (M.isHeavy(a) !== M.isHeavy(b)) return M.isHeavy(a) ? -1 : 1;
      return U.byName(a, b);
    });
  };

  /** 置場にある（どの現場にも出していない） */
  M.isAtDepot = function (machine) {
    var d = M.depot();
    return !!d && !!machine && machine.siteId === d.id;
  };

  /** いまどこにあるか */
  M.machineWhere = function (machine) {
    if (M.isAtDepot(machine)) return { atDepot: true, site: M.depot(), label: machine.place || '置場' };
    var s = Store.get('sites', machine.siteId);
    return { atDepot: false, site: s || null, label: s ? s.name : '（現場が見つかりません）' };
  };

  /**
   * 現場へ出す／置場へ戻す。
   * 出ていた現場に「搬出」、移した先に「搬入」を記録して、台帳の現場を書き換える。
   */
  M.moveMachine = function (machine, toSiteId, date, person, note) {
    var depot = M.ensureDepot();
    var from = machine.siteId;
    if (!toSiteId || from === toSiteId) return machine;
    if (from && from !== depot.id) {
      Store.put('machine_logs', {
        siteId: from, machineId: machine.id, type: 'carry_out', date: date, person: person, note: note || ''
      });
    }
    machine.siteId = toSiteId;
    if (toSiteId === depot.id) {
      machine.returnedDate = date;
    } else {
      Store.put('machine_logs', {
        siteId: toSiteId, machineId: machine.id, type: 'carry_in', date: date, person: person, note: note || ''
      });
      machine.carryInDate = date;
      machine.returnedDate = '';
    }
    return Store.put('machines', machine);
  };

  /** 現場にあるか。記録（搬入・搬出）を優先し、無ければ台帳の日付を使う */
  M.machineState = function (machine) {
    var logs = M.machineLogs(machine);
    var lastIn = null, lastOut = null;
    logs.forEach(function (l) {
      if (l.type === 'carry_in') { lastIn = l.date; lastOut = null; }
      if (l.type === 'carry_out') lastOut = l.date;
    });
    if (!logs.length) {
      lastIn = machine.carryInDate || null;
      lastOut = machine.returnedDate || null;
      if (lastIn && lastOut && lastOut < lastIn) lastOut = null;
    }
    if (lastOut) return { state: 'out', inDate: lastIn, outDate: lastOut, label: '搬出済 ' + U.formatShort(lastOut) };
    if (lastIn) return { state: 'in', inDate: lastIn, outDate: null, label: '現場にあり（' + U.formatShort(lastIn) + '搬入）' };
    return { state: 'none', inDate: null, outDate: null, label: '搬入の記録なし' };
  };

  /**
   * 機械の注意事項（期限切れ・返却予定など）。
   * 現場から搬出済みのものは出さない。置場に置いてあるものは、期限を見張り続ける。
   */
  M.machineWarnings = function (machine) {
    var st = M.machineState(machine);
    if (st.state === 'out' && !M.isAtDepot(machine)) return [];
    var UI = global.MT.ui;
    var out = [];
    [['inspectionExpiry', '特定自主検査'], ['shakenExpiry', '車検'], ['insuranceExpiry', '保険']].forEach(function (f) {
      var t = UI.dueTag(machine[f[0]], f[1], 30);
      if (t && t.level) out.push(t);
    });
    if (machine.ownership === 'lease' && U.isDate(machine.returnPlanDate)) {
      var t = UI.dueTag(machine.returnPlanDate, '返却予定', 7);
      if (t && t.level) out.push(t);
    }
    return out;
  };

  /* ------------------------------------------------------------------ *
   * 資材（在庫）
   * ------------------------------------------------------------------ */
  M.stockLogs = function (material) {
    return Store.list('stock_logs', function (l) { return l.materialId === material.id; }, material.siteId)
      .sort(U.byDateAsc);
  };

  /** 在庫数と、記録ごとの残数 */
  M.stock = function (material) {
    var qty = 0;
    var rows = M.stockLogs(material).map(function (l) {
      var n = U.num(l.qty) || 0;
      if (l.type === 'in') qty += n;
      else if (l.type === 'use' || l.type === 'out') qty -= n;
      else if (l.type === 'adjust') qty = n;
      return { log: l, balance: Math.round(qty * 1000) / 1000 };
    });
    return { qty: Math.round(qty * 1000) / 1000, rows: rows };
  };

  M.stockLow = function (material) {
    var min = U.num(material.minQty);
    if (min === null) return false;
    return M.stock(material).qty <= min;
  };

  /* ------------------------------------------------------------------ *
   * 工具（貸出）
   * ------------------------------------------------------------------ */
  M.lendsOf = function (tool) {
    return Store.list('lends', function (l) { return l.toolId === tool.id; }).sort(function (a, b) {
      return ((a.outDate || '') + (a.createdAt || '')).localeCompare((b.outDate || '') + (b.createdAt || ''));
    });
  };

  M.toolState = function (tool) {
    var lends = M.lendsOf(tool);
    var open = null;
    for (var i = lends.length - 1; i >= 0; i--) {
      if (!lends[i].returnedDate) { open = lends[i]; break; }
    }
    if (tool.status === 'retired') return { state: 'retired', label: '使用中止', cls: 'none', lend: open };
    if (open) {
      var overdue = U.isDate(open.dueDate) && open.dueDate < U.todayStr();
      return {
        state: overdue ? 'overdue' : 'lent',
        label: overdue ? '返却期限切れ' : '貸出中',
        cls: overdue ? 'ng' : 'warn',
        lend: open
      };
    }
    if (tool.status === 'repair') return { state: 'repair', label: '修理中', cls: 'none', lend: null };
    return { state: 'available', label: '保管中', cls: 'ok', lend: null };
  };

  /* ------------------------------------------------------------------ *
   * 工程（進捗率）
   * ------------------------------------------------------------------ */
  M.tasks = function (siteId) {
    return Store.list('tasks', null, siteId).sort(function (a, b) {
      var x = (a.planStart || '9999') + (a.order || 0), y = (b.planStart || '9999') + (b.order || 0);
      return x < y ? -1 : x > y ? 1 : U.byName(a, b);
    });
  };

  /**
   * 工程の重み。積算金額（amount）が入っていれば、それをそのまま重みにする。
   * 金額を入れていない工種は「1」のままなので、金額を入れた工種にくらべてほぼ0として扱われる
   * （画面では、金額の入っていない工種を数えて知らせる）。
   */
  function weight(t) {
    var a = U.num(t.amount);
    if (a !== null && a > 0) return a;
    var w = U.num(t.weight);
    return w !== null && w > 0 ? w : 1;
  }
  M.taskWeight = weight;

  /**
   * 工種ごとの構成比率と、金額の内訳。
   * 分母（全体金額）は、現場に「純工事費」が入っていればそれを使う。
   * 入っていなければ、入力された金額（または重み）の合計を分母にする（＝合計100%）。
   */
  M.taskRatios = function (tasks, site) {
    var total = 0, amountSum = 0, withAmount = 0;
    tasks.forEach(function (t) {
      total += weight(t);
      var a = U.num(t.amount);
      if (a !== null && a > 0) { amountSum += a; withAmount++; }
    });
    var net = site ? U.num(site.netCost) : null;
    var base = net !== null && net > 0 && withAmount > 0 ? net : total;
    var byId = {};
    tasks.forEach(function (t) { byId[t.id] = base > 0 ? weight(t) / base * 100 : 0; });
    return {
      byId: byId,
      total: total,
      base: base,
      net: net,
      usesNet: base === net && net > 0 && withAmount > 0,
      amountSum: amountSum,
      withAmount: withAmount,
      missing: tasks.length - withAmount,
      fromAmount: withAmount > 0,
      /** 全体金額のうち、工程に入っている割合（100%なら過不足なし） */
      coverage: base > 0 ? amountSum / base * 100 : 0
    };
  };

  /** 共通仮設費から作る「準備工」「後片付」の金額 */
  M.commonSplit = function (site) {
    var common = site ? U.num(site.commonCost) : null;
    if (common === null || common <= 0) return null;
    var share = U.num(site.prepShare);
    if (share === null || share < 0 || share > 100) share = 50;
    var prep = Math.round(common * share / 100);
    return { common: common, share: share, prep: prep, cleanup: common - prep };
  };

  /** 変更後の期間が入っているか */
  M.hasRev = function (t) { return U.isDate(t.revStart) && U.isDate(t.revEnd); };

  /**
   * その日に終わっているはずの割合（期間で按分）
   *   useRev = true なら、変更後の期間で計算する（入っていなければ当初の予定）
   */
  M.taskPlanned = function (t, dateStr, useRev) {
    var rev = useRev && M.hasRev(t);
    var from = rev ? t.revStart : t.planStart;
    var to = rev ? t.revEnd : t.planEnd;
    if (!U.isDate(from) || !U.isDate(to)) return 0;
    if (dateStr < from) return 0;
    if (dateStr >= to) return 100;
    var total = U.diffDays(from, to) + 1;
    var done = U.diffDays(from, dateStr) + 1;
    return U.clamp(done / total * 100, 0, 100);
  };

  M.progress = function (siteId, dateStr) {
    var date = dateStr || U.todayStr();
    var tasks = M.tasks(siteId);
    if (!tasks.length) return { planned: null, actual: null, tasks: tasks, diff: null };
    var sw = 0, sp = 0, sa = 0, sr = 0, anyRev = false;
    tasks.forEach(function (t) {
      var w = weight(t);
      sw += w;
      sp += w * M.taskPlanned(t, date);
      sr += w * M.taskPlanned(t, date, true);
      sa += w * U.clamp(U.num(t.progress) || 0, 0, 100);
      if (M.hasRev(t)) anyRev = true;
    });
    var planned = Math.round(sp / sw * 10) / 10;
    var actual = Math.round(sa / sw * 10) / 10;
    return {
      planned: planned,
      actual: actual,
      revised: anyRev ? Math.round(sr / sw * 10) / 10 : null,
      diff: Math.round((actual - (anyRev ? sr / sw : planned)) * 10) / 10,
      tasks: tasks
    };
  };

  M.progressLabel = function (p) {
    if (p.actual === null) return { cls: 'none', text: '工程未登録' };
    if (p.actual >= 100) return { cls: 'done', text: '完了' };
    if (p.diff <= -10) return { cls: 'ng', text: '遅れ ' + Math.abs(p.diff) + 'pt' };
    if (p.diff < -3) return { cls: 'warn', text: 'やや遅れ' };
    return { cls: 'ok', text: '順調' };
  };

  /** 工程の全体期間（工期、無ければ工種の予定の最小〜最大） */
  M.scheduleSpan = function (site, tasks) {
    var from = site.periodFrom, to = site.periodTo;
    tasks.forEach(function (t) {
      [t.planStart, t.revStart].forEach(function (d) { if (U.isDate(d) && (!from || d < from)) from = d; });
      [t.planEnd, t.revEnd].forEach(function (d) { if (U.isDate(d) && (!to || d > to)) to = d; });
    });
    return { from: from, to: to };
  };

  /* ------------------------------------------------------------------ *
   * 人員配置
   * ------------------------------------------------------------------ */
  M.activeOn = function (a, dateStr) {
    return (!a.from || a.from <= dateStr) && (!a.to || a.to >= dateStr);
  };

  M.assignments = function (filter) {
    filter = filter || {};
    return Store.list('assignments', function (a) {
      if (filter.staffId && a.staffId !== filter.staffId) return false;
      if (filter.date && !M.activeOn(a, filter.date)) return false;
      return true;
    }, filter.siteId).sort(function (a, b) {
      return ((a.from || '') + (a.role || '')).localeCompare((b.from || '') + (b.role || ''));
    });
  };

  M.staffList = function (includeInactive) {
    return Store.list('staff', function (s) { return includeInactive || s.active !== false; }).sort(function (a, b) {
      return String(a.kana || a.name || '').localeCompare(String(b.kana || b.name || ''), 'ja');
    });
  };

  /* ------------------------------------------------------------------ *
   * 注意すべきこと（ダッシュボード・現場の概要）
   *   level 2 = 対応が必要 / 1 = 近いうちに確認
   * ------------------------------------------------------------------ */
  M.alerts = function (siteId) {
    var out = [];
    var today = U.todayStr();
    var sites = siteId ? [Store.get('sites', siteId)].filter(Boolean) : M.sites({ activeOnly: true });

    sites.forEach(function (site) {
      if (site.depot || site.status === 'done') return;
      var sHref = '#/site/' + encodeURIComponent(site.id);

      Cat.ORDER.forEach(function (catId) {
        var cat = Cat.get(catId);
        M.targets(site.id, catId).forEach(function (t) {
          var href = M.targetHref(catId, t.id);
          var st = M.targetToday(t, catId);
          if (st.ng) out.push({ level: 2, site: site, text: cat.name + '「' + t.name + '」本日の点検で否あり', href: href });
          if (catId === 'scaffold') {
            var open = 0;
            M.inspections({ siteId: site.id, targetId: t.id }).forEach(function (r) { open += M.openFixes(r); });
            if (open) out.push({ level: 2, site: site, text: '足場「' + t.name + '」是正が済んでいない指摘 ' + open + ' 件', href: href });
          }
          if (catId === 'excavation') {
            var age = M.shoringAge(t);
            if (age && age.days > 7) {
              out.push({ level: 2, site: site, text: '土止め支保工「' + t.name + '」の点検が' + (age.last ? age.days + '日' : '一度も') + '行われていません（7日以内ごと）', href: href });
            }
          }
        });
      });

      Store.list('machines', null, site.id).forEach(function (m) {
        M.machineWarnings(m).forEach(function (w) {
          out.push({ level: w.level, site: site, text: '「' + m.name + '」' + w.text, href: '#/machine/' + encodeURIComponent(m.id) });
        });
      });

      Store.list('materials', null, site.id).forEach(function (mat) {
        if (M.stockLow(mat)) {
          out.push({ level: 1, site: site, text: '資材「' + mat.name + '」の在庫が発注点以下（' + U.fmtNum(M.stock(mat).qty) + ' ' + (mat.unit || '') + '）', href: '#/material/' + encodeURIComponent(mat.id) });
        }
      });

      var p = M.progress(site.id, today);
      if (p.actual !== null && p.actual < 100 && p.diff <= -10) {
        out.push({ level: 1, site: site, text: '工程が予定より ' + Math.abs(p.diff) + ' ポイント遅れています（予定 ' + p.planned + '%／実績 ' + p.actual + '%）', href: sHref + '?tab=schedule' });
      }
    });

    if (!siteId) {
      Store.list('tools').forEach(function (tool) {
        var st = M.toolState(tool);
        if (st.state === 'overdue') {
          out.push({ level: 2, site: null, text: '工具「' + tool.name + '」の返却期限が過ぎています（' + (st.lend.borrower || '') + '）', href: '#/tool/' + encodeURIComponent(tool.id) });
        }
      });
      // 置場に置いてある重機・機械も、特定自主検査・車検の期限を見る
      M.allMachines().forEach(function (mc) {
        if (!M.isAtDepot(mc)) return;
        M.machineWarnings(mc).forEach(function (w) {
          out.push({ level: w.level, site: null, text: '置場の「' + mc.name + '」' + w.text, href: '#/machine/' + encodeURIComponent(mc.id) });
        });
      });
    }

    return out.sort(function (a, b) { return b.level - a.level; });
  };

  global.MT.model = M;
})(window);
