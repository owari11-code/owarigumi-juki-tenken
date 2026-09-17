/*
 * categories.js - 点検の種類をひとつの形にそろえる
 *
 * 重機・足場・玉掛け・地山/土留は、それぞれ項目の持ち方が違うため、
 * 画面側が同じ書き方で扱えるよう、ここで共通の形に包む。
 *
 *   targetKind … 点検対象の置き場所（重機は machines、それ以外は targets）
 *   phases     … 点検の区分（作業開始前・作業終了時・元請/使用業者 など）
 *   dailyPhase … 「本日点検済み」の判定に使う区分
 *   sheet      … 帳票の形（monthly = 月間のマス目 / event = 1回1枚）
 */
(function (global) {
  'use strict';

  var H = global.HeavyData;
  var S = global.ScaffoldData;
  var R = global.RiggingData;
  var E = global.ExcavationData;

  var RESULTS_3 = [
    { id: 'ok', mark: '○', label: '良', cls: 'c-ok' },
    { id: 'ng', mark: '×', label: '否', cls: 'c-ng' },
    { id: 'na', mark: '／', label: '該当なし', cls: 'c-na' }
  ];

  var CATEGORIES = {
    heavy: {
      id: 'heavy', name: '重機', kicker: 'MACHINE', targetKind: 'machines', unit: '台',
      types: H.MACHINE_TYPES,
      typeName: H.machineTypeName,
      phasesFor: function () {
        return [
          { id: 'pre', name: '作業開始前点検', kicker: 'BEFORE WORK', daily: true },
          { id: 'post', name: '作業終了時点検', kicker: 'AFTER WORK', daily: false }
        ];
      },
      sectionsFor: function (phase, type) { return H.sectionsFor(phase, type); },
      itemLabel: H.itemLabel,
      results: RESULTS_3,
      dailyPhase: 'pre',
      sheet: 'monthly',
      source: '厚生労働省「建設機械施工業務及び土工業務 安全衛生のポイント／建設機械の基本と点検等」(2020.3)'
    },
    scaffold: {
      id: 'scaffold', name: '足場', kicker: 'SCAFFOLD', targetKind: 'targets', unit: '基',
      types: S.SCAFFOLD_TYPES,
      typeName: S.typeName,
      phasesFor: function () {
        return [
          { id: 'user', name: '使用業者の作業開始前点検', kicker: 'USER', daily: true, role: 'user',
            sub: '墜落防止設備の取りはずし・脱落の有無（毎日）' },
          { id: 'prime', name: '元請・組立解体業者の点検', kicker: 'PRIME', daily: false, role: 'prime',
            sub: '組立後・悪天候後・地震後・変更後などの全項目点検' }
        ];
      },
      sectionsFor: function (phase, type) { return S.sectionsFor(type, phase); },
      itemLabel: S.itemLabel,
      results: S.RESULTS,
      dailyPhase: 'user',
      sheet: 'event',
      hasFixes: true,
      timings: S.TIMINGS,
      inspectorKinds: S.INSPECTOR_KINDS,
      qualifications: S.QUALIFICATIONS,
      source: '社内様式「足場点検表」'
    },
    rigging: {
      id: 'rigging', name: '玉掛け', kicker: 'RIGGING', targetKind: 'targets', unit: '件',
      types: R.TYPES,
      typeName: R.typeName,
      phasesFor: function () { return R.PHASES; },
      sectionsFor: function (phase) { return R.sectionsFor(phase); },
      itemLabel: R.itemLabel,
      results: RESULTS_3,
      dailyPhase: 'pre',
      sheet: 'monthly',
      source: 'クレーン等安全規則（玉掛け用具・作業開始前の点検）、厚生労働省「まんがでわかる クレーン・玉掛け作業の安全衛生」(2021.3)'
    },
    excavation: {
      id: 'excavation', name: '地山・土留', kicker: 'GROUND', targetKind: 'targets', unit: '箇所',
      types: E.TYPES,
      typeName: E.typeName,
      phasesFor: function (type) { return E.phasesFor(type); },
      sectionsFor: function (phase) { return E.sectionsFor(phase); },
      itemLabel: E.itemLabel,
      results: RESULTS_3,
      dailyPhase: 'pre',
      sheet: 'monthly',
      hasShoring: E.hasShoring,
      source: '労働安全衛生規則（明り掘削の作業・土止め支保工）'
    }
  };

  var ORDER = ['heavy', 'scaffold', 'rigging', 'excavation'];

  function get(id) {
    return Object.prototype.hasOwnProperty.call(CATEGORIES, id) ? CATEGORIES[id] : null;
  }

  /** 記録や対象がどの点検の種類か（以前の重機アプリの記録は category を持たない） */
  function of(obj) {
    if (!obj) return CATEGORIES.heavy;
    return get(obj.category) || CATEGORIES.heavy;
  }

  function phase(cat, phaseId, type) {
    var list = cat.phasesFor(type);
    for (var i = 0; i < list.length; i++) if (list[i].id === phaseId) return list[i];
    return list[0];
  }

  function result(cat, id) {
    for (var i = 0; i < cat.results.length; i++) if (cat.results[i].id === id) return cat.results[i];
    return null;
  }

  function itemCount(cat, phaseId, type) {
    return cat.sectionsFor(phaseId, type).reduce(function (n, s) { return n + s.items.length; }, 0);
  }

  global.MT = global.MT || {};
  global.MT.cat = {
    ORDER: ORDER,
    all: function () { return ORDER.map(get); },
    get: get,
    of: of,
    phase: phase,
    result: result,
    itemCount: itemCount
  };
})(window);
