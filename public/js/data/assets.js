/*
 * assets.js - 機械・資材・工具・人員で使う選択肢
 */
(function (global) {
  'use strict';

  /* 日常点検の対象ではない機械（リース品の搬入・返却や期限の管理に使う） */
  var EQUIPMENT_TYPES = [
    { id: 'generator', name: '発電機' },
    { id: 'compressor', name: 'コンプレッサー' },
    { id: 'pump', name: '水中ポンプ' },
    { id: 'welder', name: '溶接機' },
    { id: 'aerial', name: '高所作業車' },
    { id: 'forklift', name: 'フォークリフト' },
    { id: 'truck', name: 'ダンプ・トラック' },
    { id: 'house', name: '仮設ハウス・トイレ' },
    { id: 'plate', name: '敷鉄板・覆工板' },
    { id: 'other', name: 'その他の機械' }
  ];

  var TOOL_KINDS = [
    { id: 'power', name: '電動工具' },
    { id: 'engine', name: '発電機・溶接機・エンジン機器' },
    { id: 'survey', name: '測量機器' },
    { id: 'safety', name: '安全用品' },
    { id: 'other', name: 'その他' }
  ];

  var TOOL_STATUS = [
    { id: 'ok', name: '使用可' },
    { id: 'repair', name: '修理中' },
    { id: 'retired', name: '廃棄・使用中止' }
  ];

  var SITE_STATUS = [
    { id: 'planned', name: '着工前' },
    { id: 'active', name: '施工中' },
    { id: 'done', name: '完成' }
  ];

  var ASSIGN_ROLES = ['現場代理人', '監理技術者', '主任技術者', '担当技術者', '職長', '作業員', 'その他'];

  /* 資材の入出庫。adjust（棚卸）は数量をその値にそろえる */
  var STOCK_TYPES = [
    { id: 'in', name: '搬入', sign: 1, kicker: 'IN' },
    { id: 'use', name: '使用', sign: -1, kicker: 'USE' },
    { id: 'out', name: '搬出・返品', sign: -1, kicker: 'OUT' },
    { id: 'adjust', name: '棚卸（数量を合わせる）', sign: 0, kicker: 'COUNT' }
  ];

  function nameOf(list, id, fallback) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return fallback === undefined ? '' : fallback;
  }

  global.MT = global.MT || {};
  global.MT.assets = {
    EQUIPMENT_TYPES: EQUIPMENT_TYPES,
    TOOL_KINDS: TOOL_KINDS,
    TOOL_STATUS: TOOL_STATUS,
    SITE_STATUS: SITE_STATUS,
    ASSIGN_ROLES: ASSIGN_ROLES,
    STOCK_TYPES: STOCK_TYPES,
    nameOf: nameOf
  };
})(window);
