/*
 * rigging.js - 玉掛け作業の点検項目
 *
 * 根拠
 *   ・クレーン等安全規則 第213条〜第220条（玉掛け用具の安全係数・不適格な用具・作業開始前の点検）
 *   ・同 第221条・第222条（玉掛けの資格）、第69条〜第74条の2（移動式クレーンの作業）
 *   ・厚生労働省「まんがでわかる クレーン・玉掛け作業の安全衛生」（2021.3）の要点
 *     （資格・立入禁止・合図・つり荷の下に入らない）
 *
 * 項目を増やすときは、IDを変えずに足していく（過去の記録の表示が崩れないように）。
 */
(function (global) {
  'use strict';

  var TYPES = [
    { id: 'mobile', name: '移動式クレーン（ラフテレーン・トラック）' },
    { id: 'crawler', name: 'クローラクレーン' },
    { id: 'loader', name: '車両積載形クレーン（ユニック等）' },
    { id: 'backhoe', name: 'クレーン機能付きバックホウ' },
    { id: 'fixed', name: '天井クレーン・門型クレーン' },
    { id: 'other', name: 'その他（チェーンブロック等）' }
  ];

  var SECTIONS = [
    {
      id: 'rg1', phase: 'pre',
      title: '作業前の体制',
      note: '資格・合図・立入禁止など、作業に入る前に決めておくことです。',
      items: [
        { id: 'rg1-1', label: '玉掛け者は資格を持っている', hint: 'つり上げ荷重1t以上は玉掛け技能講習、1t未満は特別教育' },
        { id: 'rg1-2', label: 'クレーン等の運転者は必要な資格を持っている', hint: '5t以上は免許、1t以上5t未満（移動式）は小型移動式クレーン運転技能講習、1t未満は特別教育' },
        { id: 'rg1-3', label: '合図者を指名し、合図の方法を運転者と確認した' },
        { id: 'rg1-4', label: 'つり荷の質量を確かめ、定格荷重を超えていない' },
        { id: 'rg1-5', label: '作業半径内・つり荷の下への立入禁止の措置をした（カラーコーン等）' },
        { id: 'rg1-6', label: 'アウトリガーを最大限に張り出し、地盤の状態と敷板を確認した' },
        { id: 'rg1-7', label: '架空電線などの障害物との離れを確認した' }
      ]
    },
    {
      id: 'rg2', phase: 'pre',
      title: '玉掛け用具の点検（作業開始前）',
      note: 'その日の作業を始める前に、使う用具の異常の有無を点検します。基準に合わない用具は使いません。',
      items: [
        { id: 'rg2-1', label: 'ワイヤロープ：1よりの間で素線の断線が10％未満である' },
        { id: 'rg2-2', label: 'ワイヤロープ：直径の減少が公称径の7％以下である' },
        { id: 'rg2-3', label: 'ワイヤロープ：キンク・著しい形くずれ・腐食がない' },
        { id: 'rg2-4', label: 'つりチェーン：伸びが製造時の5％以下、リンク断面の直径の減少が10％以下、き裂がない' },
        { id: 'rg2-5', label: 'フック・シャックル・リング等：変形・き裂がない' },
        { id: 'rg2-6', label: '繊維スリング（ベルト・ロープ）：切断・著しい損傷・腐食がない' },
        { id: 'rg2-7', label: 'フックの外れ止め装置が機能している' },
        { id: 'rg2-8', label: '端末にフック・シャックル・リング又はアイを備えている（エンドレスでないもの）' },
        { id: 'rg2-9', label: '使用荷重の表示を確かめ、つり荷に合った用具を選んだ', hint: '安全係数はワイヤロープ6以上、フック・シャックル5以上' }
      ]
    },
    {
      id: 'rg3', phase: 'pre',
      title: 'つり方の確認',
      note: '死亡災害の多くは「つり荷の落下」です。つり方と立ち位置を作業前に確認します。',
      items: [
        { id: 'rg3-1', label: 'つり角度は原則60度以内とし、それに合った用具の組合せにした' },
        { id: 'rg3-2', label: '地切りで一旦止め、荷の安定と玉掛けの状態を確かめる' },
        { id: 'rg3-3', label: '1本づりなど、不安定なつり方をしない' },
        { id: 'rg3-4', label: '角のある荷には当て物をして用具を保護する' },
        { id: 'rg3-5', label: '介錯ロープを使い、つり荷に直接手を触れない' },
        { id: 'rg3-6', label: 'つり荷の下・つり荷の動線に入らない（入らせない）' },
        { id: 'rg3-7', label: '合図は指名した合図者だけが行う' }
      ]
    }
  ];

  var PHASES = [
    { id: 'pre', name: '玉掛け作業開始前点検', kicker: 'RIGGING', daily: true }
  ];

  function typeName(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i].name;
    return 'その他';
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

  global.RiggingData = {
    TYPES: TYPES,
    PHASES: PHASES,
    SECTIONS: SECTIONS,
    typeName: typeName,
    sectionsFor: sectionsFor,
    itemLabel: itemLabel
  };
})(window);
