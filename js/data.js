/*
 * data.js - 機種区分と点検項目の定義
 * 点検項目は「トンネル推進工業務、建設機械施工業務及び土工業務 安全衛生のポイント
 * ／建設機械の基本と点検等」(2020.3) の(4)〜(8)に基づく。
 */
(function (global) {
  'use strict';

  /* 走行装置: crawler = クローラ式 / wheel = ホイール式 */
  var MACHINE_TYPES = [
    { id: 'bulldozer', name: 'ブルドーザ', drive: 'crawler' },
    { id: 'wheel_loader', name: 'トラクタショベル（ホイール式）', drive: 'wheel' },
    { id: 'backhoe_crawler', name: '油圧ショベル・バックホウ（クローラ式）', drive: 'crawler' },
    { id: 'backhoe_wheel', name: '油圧ショベル（ホイール式）', drive: 'wheel' },
    { id: 'roller', name: 'ローラ（ロード／タイヤ／振動）', drive: 'wheel' },
    { id: 'crawler_dump', name: 'クローラダンプ・不整地運搬車', drive: 'crawler' },
    { id: 'other', name: 'その他の建設機械', drive: 'both' }
  ];

  /*
   * 点検項目
   * phase: 'pre'  = 作業開始前（始業前）点検
   *        'post' = 作業終了時点検
   * drive: 'crawler' / 'wheel' を指定した項目は該当機種のみ表示する
   */
  var SECTIONS = [
    {
      id: 'safety',
      phase: 'pre',
      title: '点検前の安全措置',
      note: '点検作業そのものの災害を防ぐための確認です。',
      items: [
        { id: 's1', label: '平坦で安全な場所に駐機した' },
        { id: 's2', label: '駐機ブレーキ・安全ロックをかけた' },
        { id: 's3', label: '傾斜地では歯止め（輪留め）をした' },
        { id: 's4', label: 'バケット等を上げて点検する場合は安全支柱で支えた' }
      ]
    },
    {
      id: 'before_start',
      phase: 'pre',
      title: '作業開始前点検（エンジン始動前）',
      note: '法令等で実施が求められる項目です。不具合があれば整備してから作業に入ります。',
      items: [
        { id: 'b1', label: '水漏れ・油漏れがない' },
        { id: 'b2', label: '冷却水の量（点検・補給）', hint: 'ラジエターが熱いときはキャップを外さない' },
        { id: 'b3', label: '各部分の油量（点検・補給）' },
        { id: 'b4', label: 'エンジンオイル等油脂類（点検・補給）' },
        { id: 'b5', label: 'ブレーキ液（点検・補給）' },
        { id: 'b6', label: '燃料タンクの水抜き' },
        { id: 'b7', label: 'ファンベルトの張り具合（調整）' },
        { id: 'b8', label: 'タイヤの空気圧', drive: 'wheel' },
        { id: 'b9', label: 'クローラ（履帯）の張り具合', drive: 'crawler' },
        { id: 'b10', label: '各部のボルト・ナットの緩みがない' },
        { id: 'b11', label: '作動油タンクの油量（点検・補給）' },
        { id: 'b12', label: '安全確認用の補助設備（ミラー等）の点検・調整' }
      ]
    },
    {
      id: 'after_start',
      phase: 'pre',
      title: 'エンジン始動後点検',
      note: '周囲に人がいないこと・障害物がないことを確認してから操作します。',
      items: [
        { id: 'a1', label: 'ブレーキの機能（ペダルの遊び・効き）' },
        { id: 'a2', label: 'クラッチの機能（遊び・操作力・ストローク）' },
        { id: 'a3', label: 'エンジンの調子（回転計・エンジン音）' },
        { id: 'a4', label: '作業装置の作動（旋回・ブーム・アーム・バケット等）' }
      ]
    },
    {
      id: 'finish',
      phase: 'post',
      title: '作業終了時点検',
      note: '作業終了後の措置を確認します。',
      items: [
        { id: 'f1', label: '安全な場所に停止し、作業装置を地面に下ろした' },
        { id: 'f2', label: '駐機ブレーキをかけてエンジンを止めた' },
        { id: 'f3', label: '傾斜地では歯止め（輪留め）をした' },
        { id: 'f4', label: '燃料補給はエンジンを止めて行った（火気・喫煙なし）' },
        { id: 'f5', label: '機械周囲の安全措置（バリケード等）を行った' },
        { id: 'f6', label: '当日の異常・損傷の有無を確認した' }
      ]
    }
  ];

  var PHASES = [
    { id: 'pre', name: '作業開始前点検' },
    { id: 'post', name: '作業終了時点検' }
  ];

  /** 機種と点検区分に応じた点検セクションを返す */
  function sectionsFor(phase, machineTypeId) {
    var type = null;
    for (var i = 0; i < MACHINE_TYPES.length; i++) {
      if (MACHINE_TYPES[i].id === machineTypeId) type = MACHINE_TYPES[i];
    }
    var drive = type ? type.drive : 'both';
    var result = [];
    for (var s = 0; s < SECTIONS.length; s++) {
      var sec = SECTIONS[s];
      if (sec.phase !== phase) continue;
      var items = [];
      for (var k = 0; k < sec.items.length; k++) {
        var it = sec.items[k];
        if (it.drive && drive !== 'both' && it.drive !== drive) continue;
        items.push(it);
      }
      result.push({ id: sec.id, title: sec.title, note: sec.note, items: items });
    }
    return result;
  }

  function machineTypeName(id) {
    for (var i = 0; i < MACHINE_TYPES.length; i++) {
      if (MACHINE_TYPES[i].id === id) return MACHINE_TYPES[i].name;
    }
    return 'その他の建設機械';
  }

  function phaseName(id) {
    for (var i = 0; i < PHASES.length; i++) {
      if (PHASES[i].id === id) return PHASES[i].name;
    }
    return id;
  }

  /** 点検項目ラベルの逆引き（過去の記録を表示するため全項目を保持） */
  function itemLabel(itemId) {
    for (var s = 0; s < SECTIONS.length; s++) {
      for (var i = 0; i < SECTIONS[s].items.length; i++) {
        if (SECTIONS[s].items[i].id === itemId) return SECTIONS[s].items[i].label;
      }
    }
    return itemId;
  }

  global.InspectionData = {
    MACHINE_TYPES: MACHINE_TYPES,
    SECTIONS: SECTIONS,
    PHASES: PHASES,
    sectionsFor: sectionsFor,
    machineTypeName: machineTypeName,
    phaseName: phaseName,
    itemLabel: itemLabel
  };
})(window);
