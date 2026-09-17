/*
 * excavation.js - 地山の掘削・土止め支保工の点検項目
 *
 * 根拠（労働安全衛生規則）
 *   ・第355条〜第367条（明り掘削の作業）
 *       点検者を指名して、作業開始前・大雨の後・中震以上の地震の後に、
 *       浮石・き裂の有無と状態、含水・湧水・凍結の状態の変化を点検する
 *   ・第368条〜第375条（土止め支保工）
 *       7日を超えない期間ごと、中震以上の地震の後、大雨等で地山が急に弱くなるおそれの
 *       ある事態の後に、部材の損傷・変形・腐食・変位・脱落、切りばりの緊圧の度合、
 *       部材の接続部・取付け部・交さ部の状態を点検する
 *   ・第519条（開口部等の墜落防止）、第526条（昇降設備）
 */
(function (global) {
  'use strict';

  /* shoring … 土止め支保工の点検（7日以内ごと）の対象になるか */
  var TYPES = [
    { id: 'open', name: '明り掘削（素掘り・法付け）', shoring: false },
    { id: 'slope', name: '法面・切土', shoring: false },
    { id: 'strut', name: '土止め支保工（切ばり式）', shoring: true },
    { id: 'trench', name: '溝掘削（建込み式簡易土留め等）', shoring: true },
    { id: 'self', name: '自立式土留め（矢板・親杭横矢板等）', shoring: true }
  ];

  var SECTIONS = [
    {
      id: 'ex1', phase: 'pre',
      title: '地山の点検',
      note: '点検者を指名して行います。作業開始前のほか、大雨の後・中震以上の地震の後にも行います。',
      items: [
        { id: 'ex1-1', label: '点検者を指名して点検している' },
        { id: 'ex1-2', label: '浮石がない（ある場合は状態を確認し、取り除いた）' },
        { id: 'ex1-3', label: 'き裂がない（ある場合は状態を確認し、措置した）' },
        { id: 'ex1-4', label: '含水・湧水の状態に変化がない' },
        { id: 'ex1-5', label: '凍結の状態に変化がない' },
        { id: 'ex1-6', label: '掘削面のこう配・高さが計画のとおりである' },
        { id: 'ex1-7', label: '掘削箇所の肩に、土砂・資材・機械を近づけすぎていない' }
      ]
    },
    {
      id: 'ex2', phase: 'pre',
      title: '作業の安全措置',
      note: '崩壊・墜落・埋設物の損傷・機械との接触を防ぐための確認です。',
      items: [
        { id: 'ex2-1', label: '地山の掘削作業主任者を選任し、作業を直接指揮している', hint: '掘削面の高さが2m以上の場合' },
        { id: 'ex2-2', label: '崩壊・落下のおそれのある箇所への立入禁止の措置をした' },
        { id: 'ex2-3', label: '埋設物（ガス管・水道管・電線等）の位置を確認し、防護している' },
        { id: 'ex2-4', label: '掘削機械・運搬機械の運行経路と誘導者を決め、周知した' },
        { id: 'ex2-5', label: '全員が保護帽を着用している' },
        { id: 'ex2-6', label: '作業に必要な明るさがある' },
        { id: 'ex2-7', label: '安全に昇り降りできる設備がある', hint: '深さが1.5mを超える箇所' },
        { id: 'ex2-8', label: '掘削箇所の端に墜落防止の措置（手すり・柵等）がある' }
      ]
    },
    {
      id: 'ex3', phase: 'shoring',
      title: '土止め支保工の点検',
      note: '7日を超えない期間ごと、中震以上の地震の後、大雨等の後に行います。異常があれば直ちに補強・補修します。',
      items: [
        { id: 'ex3-1', label: '部材の損傷・変形・腐食・変位・脱落がない' },
        { id: 'ex3-2', label: '切ばりの緊圧の度合が適切である' },
        { id: 'ex3-3', label: '部材の接続部・取付け部・交さ部の状態に異常がない' },
        { id: 'ex3-4', label: '矢板・背板のすき間から土砂が流れ出ていない' },
        { id: 'ex3-5', label: '組立図のとおりに組み立てられている' },
        { id: 'ex3-6', label: '周辺の地盤に沈下・き裂・湧水の変化がない' },
        { id: 'ex3-7', label: '土止め支保工作業主任者を選任している', hint: '組立て・解体の作業を行うとき' }
      ]
    }
  ];

  var PHASES = [
    {
      id: 'pre', name: '地山の作業開始前点検', kicker: 'GROUND', daily: true,
      timings: ['作業開始前', '大雨の後', '中震以上の地震の後', '発破の後']
    },
    {
      id: 'shoring', name: '土止め支保工の点検', kicker: 'SHORING', daily: false, intervalDays: 7,
      timings: ['定期（7日以内ごと）', '中震以上の地震の後', '大雨等の後']
    }
  ];

  function type(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return TYPES[0];
  }

  function typeName(id) { return type(id).name; }

  function hasShoring(typeId) { return !!type(typeId).shoring; }

  function phasesFor(typeId) {
    return PHASES.filter(function (p) { return p.id !== 'shoring' || hasShoring(typeId); });
  }

  function sectionsFor(phase) {
    return SECTIONS.filter(function (s) { return s.phase === phase; });
  }

  function itemLabel(itemId) {
    for (var s = 0; s < SECTIONS.length; s++) {
      for (var i = 0; i < SECTIONS[s].items.length; i++) {
        if (SECTIONS[s].items[i].id === itemId) return SECTIONS[s].items[i].label;
      }
    }
    return itemId;
  }

  global.ExcavationData = {
    TYPES: TYPES,
    PHASES: PHASES,
    SECTIONS: SECTIONS,
    type: type,
    typeName: typeName,
    hasShoring: hasShoring,
    phasesFor: phasesFor,
    sectionsFor: sectionsFor,
    itemLabel: itemLabel
  };
})(window);
