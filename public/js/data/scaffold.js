/*
 * data.js - 足場の種類と点検項目の定義
 *
 * 社内の「足場点検表」(足場点検表.xlsx) の各シートを、そのまま項目として起こしたもの。
 * 元請及び組立解体業者は全項目、使用業者は「墜落防止設備の取りはずし・脱落の有無」のみ。
 *
 * 項目を追加・変更するときは SECTIONS を編集する。記録は項目IDで保存しているため、
 * IDを変えなければ過去の記録の表示は崩れない。
 */
(function (global) {
  'use strict';

  /* 足場の種類 */
  var SCAFFOLD_TYPES = [
    { id: 'waku', name: "わく組足場" },
    { id: 'tankan', name: "単管足場" },
    { id: 'kusabi', name: "くさび緊結式足場" },
    { id: 'tsuri_d', name: "土木つり（棚）足場" },
    { id: 'tsuri_k', name: "建築つり（棚）足場" },
    { id: 'kodai', name: "作業構台" },
    { id: 'rolling', name: "ローリングタワー" }
  ];

  /* 点検を行う立場。元請は全項目、使用業者は墜落防止設備の取りはずし・脱落のみ */
  var ROLES = [
    { id: 'prime', name: '元請及び組立解体業者', short: '元請', kicker: 'PRIME' },
    { id: 'user', name: '使用業者', short: '使用業者', kicker: 'USER' }
  ];

  /* 点検時期（労働安全衛生規則 第567条ほか） */
  var TIMINGS = [
    "足場使用開始前",
    "悪天候後",
    "地震後",
    "足場の組立後",
    "一部解体後",
    "変更後",
    "その他"
  ];

  /* 点検者の区分 */
  var INSPECTOR_KINDS = ['元請', '組立業者'];

  /* 点検資格の種類（元請の点検で○を付ける） */
  var QUALIFICATIONS = [
    "足場の組立て等作業主任者（能力向上教育を受けた者）",
    "足場の設置等の届出に係る「計画作成参画者」に必要な資格を有する者",
    "建災防が行う「施工管理者等のための足場点検実務研修」修了者",
    "全国仮設安全事業協同組合が行う「仮設安全監理者資格取得講座」受講者"
  ];

  /* 点検結果の記号。帳票の凡例と同じ（良：○／即時改善：△／否：×／該当なし：／） */
  var RESULTS = [
    { id: 'ok', mark: '\u25cb', label: '良', cls: 'c-ok' },
    { id: 'fix', mark: '\u25b3', label: '即時改善', cls: 'c-fix' },
    { id: 'ng', mark: '\u00d7', label: '否', cls: 'c-ng' },
    { id: 'na', mark: '\uff0f', label: '該当なし', cls: 'c-na' }
  ];

  /*
   * 点検項目。SECTIONS[足場の種類][立場] = セクションの配列
   * 項目IDは「種類-立場の頭文字-セクション番号-項目番号」
   */
  var SECTIONS = {
  waku: {
    prime: [
      {
        id: 'waku-p-1', title: "床材の損傷",
        items: [
          { id: 'waku-p-1-1', label: "床材の取付状態は計画通りか" },
          { id: 'waku-p-1-2', label: "床付布枠に変形、損傷はないか" },
          { id: 'waku-p-1-3', label: "つかみ金具の外れ止めは確実にロックされているか" },
          { id: 'waku-p-1-4', label: "床材と床材の隙間は3ｃｍ以下にされているか" },
          { id: 'waku-p-1-5', label: "床材の幅は40ｃｍ以上確保されているか" },
          { id: 'waku-p-1-6', label: "床材と建地の隙間は12ｃｍ未満となっているか" }
        ]
      },
      {
        id: 'waku-p-2', title: "緊結部・接続部・取付部のゆるみ",
        items: [
          { id: 'waku-p-2-1', label: "建枠、布枠の取付状態は計画通りか" },
          { id: 'waku-p-2-2', label: "建枠は、アームロックなどで確実に接続されているか" },
          { id: 'waku-p-2-3', label: "脚柱ｼﾞｮｲﾝﾄ、ｱｰﾑﾛｯｸはﾛｯｸされているか" },
          { id: 'waku-p-2-4', label: "建枠、布枠の取付に緩みはないか" }
        ]
      },
      {
        id: 'waku-p-3', title: "緊結材・緊結金具",
        items: [
          { id: 'waku-p-3-1', label: "クランプ等の緊結金具に損傷、腐食はないか" },
          { id: 'waku-p-3-2', label: "継手金具（ジョイント、ア－ムロック）に損傷、腐食はないか" }
        ]
      },
      {
        id: 'waku-p-4', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'waku-p-4-1', label: "交差筋かい、下桟、幅木、手すり枠などの取付状態は計画通りか", hint: "上さんは、ﾒｯｼｭｼ-ﾄ・防網を使用しない場合必要" },
          { id: 'waku-p-4-2', label: "交差筋かい、下桟、幅木、上桟、手すり枠の脱落はないか" },
          { id: 'waku-p-4-3', label: "交差筋かいピンは確実にロックされているか" },
          { id: 'waku-p-4-4', label: "交差筋かいは全層全スパン両面に設置されているか" },
          { id: 'waku-p-4-5', label: "妻面に手すり及び中桟は設置されているか" }
        ]
      },
      {
        id: 'waku-p-5', title: "落下防止措置の取りはずし・脱落の有無",
        items: [
          { id: 'waku-p-5-1', label: "幅木、ﾒｯｼｭｼｰﾄ、防網等の取付状態は計画通りか" },
          { id: 'waku-p-5-2', label: "幅木、ﾒｯｼｭｼｰﾄ、防網は取り外されていないか" },
          { id: 'waku-p-5-3', label: "幅木は脚柱等に確実に取付けられているか" },
          { id: 'waku-p-5-4', label: "ﾒｯｼｭｼｰﾄは全てのはと目で、緊結されているか" },
          { id: 'waku-p-5-5', label: "防網はつり綱で確実に緊結されているか" },
          { id: 'waku-p-5-6', label: "朝顔は確実に固定されているか" }
        ]
      },
      {
        id: 'waku-p-6', title: "脚部（沈下・滑動）",
        items: [
          { id: 'waku-p-6-1', label: "ベース金具、根がらみ、敷板、敷角の設置は計画通りか" },
          { id: 'waku-p-6-2', label: "敷板、敷角に異常な沈下、滑動はないか" },
          { id: 'waku-p-6-3', label: "ベース金具は敷板に確実に釘止めされているか" },
          { id: 'waku-p-6-4', label: "根がらみは所定の位置にクランプで緊結されているか" }
        ]
      },
      {
        id: 'waku-p-7', title: "補強材の取付",
        items: [
          { id: 'waku-p-7-1', label: "交差筋かい、控え、壁つなぎの取付状態は計画通りか" },
          { id: 'waku-p-7-2', label: "交差筋かい、控え、壁つなぎは取り外されていないか" },
          { id: 'waku-p-7-3', label: "専用の壁つなぎ用金具が使用されているか" },
          { id: 'waku-p-7-4', label: "控えはクランプで緊結されているか" }
        ]
      },
      {
        id: 'waku-p-8', title: "損傷の有無",
        items: [
          { id: 'waku-p-8-1', label: "建枠、布枠、交差筋かいに変形、損傷はないか" }
        ]
      },
      {
        id: 'waku-p-9', title: "その他",
        items: [
          { id: 'waku-p-9-1', label: "足場組立解体作業主任者名の表示があるか" },
          { id: 'waku-p-9-2', label: "最大積載荷重表示が明示されているか" },
          { id: 'waku-p-9-3', label: "昇降設備はあるか、つまづき等の恐れはないか。" },
          { id: 'waku-p-9-4', label: "安全看板類の設置は関係者へ周知するのに適切な位置か" }
        ]
      }
    ],
    user: [
      {
        id: 'waku-u-1', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'waku-u-1-1', label: "交差筋かい、下桟、幅木、手すり枠などの取付状態は計画通りか", hint: "上さんは、ﾒｯｼｭｼ-ﾄ・防網を使用しない場合必要" },
          { id: 'waku-u-1-2', label: "交差筋かい、下桟、幅木、上桟、手すり枠の脱落はないか" },
          { id: 'waku-u-1-3', label: "交差筋かいピンは確実にロックされているか" },
          { id: 'waku-u-1-4', label: "交差筋かいは全層全スパン両面に設置されているか" },
          { id: 'waku-u-1-5', label: "妻面に手すり及び中桟は設置されているか" }
        ]
      }
    ]
  },
  tankan: {
    prime: [
      {
        id: 'tankan-p-1', title: "床材の損傷",
        items: [
          { id: 'tankan-p-1-1', label: "床材の取付状態は計画通りか" },
          { id: 'tankan-p-1-2', label: "床材に変形、損傷はないか" },
          { id: 'tankan-p-1-3', label: "床材は腕木にｺﾞﾑﾊﾞﾝﾄﾞ等で確実に固定されているか" },
          { id: 'tankan-p-1-4', label: "床材と床材の隙間は3ｃｍ以下にされているか" },
          { id: 'tankan-p-1-5', label: "床材の幅は40ｃｍ以上確保されているか" },
          { id: 'tankan-p-1-6', label: "床材と建地の隙間は12ｃｍ未満となっているか" }
        ]
      },
      {
        id: 'tankan-p-2', title: "緊結部・接続部・取付部のゆるみ",
        items: [
          { id: 'tankan-p-2-1', label: "建地、布材、腕木の取付状態は計画通りか" },
          { id: 'tankan-p-2-2', label: "建地は、単管ｼﾞｮｲﾝﾄ等で確実に接続されているか" },
          { id: 'tankan-p-2-3', label: "布、腕木は専用緊結金具で確実に取り付けられているか" },
          { id: 'tankan-p-2-4', label: "建地、布、腕木の取付部にゆるみはないか" }
        ]
      },
      {
        id: 'tankan-p-3', title: "緊結材・緊結金具",
        items: [
          { id: 'tankan-p-3-1', label: "緊結金具(ｸﾗﾝﾌﾟ等）に損傷、腐食はないか" },
          { id: 'tankan-p-3-2', label: "継手金具（ｼﾞｮｲﾝﾄ等）に損傷、腐食はないか" }
        ]
      },
      {
        id: 'tankan-p-4', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'tankan-p-4-1', label: "手すり、中桟、幅木等の取付状態は計画通りか" },
          { id: 'tankan-p-4-2', label: "手すり、中桟、幅木の脱落はないか" },
          { id: 'tankan-p-4-3', label: "手すり、中桟、幅木は確実に固定されているか" },
          { id: 'tankan-p-4-4', label: "手すりの高さは85（90）ｃｍ以上か" },
          { id: 'tankan-p-4-5', label: "中桟の高さは35ｃｍ以上50ｃｍ以下か" },
          { id: 'tankan-p-4-6', label: "妻面に手すり及び中桟は設置されているか" }
        ]
      },
      {
        id: 'tankan-p-5', title: "落下防止措置の取りはずし・脱落の有無",
        items: [
          { id: 'tankan-p-5-1', label: "幅木、ﾒｯｼｭｼｰﾄ、防網等の取付状態は計画通りか" },
          { id: 'tankan-p-5-2', label: "幅木、ﾒｯｼｭｼｰﾄ、防網は取り外されていないか" },
          { id: 'tankan-p-5-3', label: "幅木は脚柱等に確実に取付けられているか" },
          { id: 'tankan-p-5-4', label: "ﾒｯｼｭｼｰﾄは全てのはと目で、緊結されているか" },
          { id: 'tankan-p-5-5', label: "防網は、つり綱で確実に緊結されているか" },
          { id: 'tankan-p-5-6', label: "朝顔は確実に固定されているか" }
        ]
      },
      {
        id: 'tankan-p-6', title: "脚部（沈下・滑動）",
        items: [
          { id: 'tankan-p-6-1', label: "ベース金具、根がらみ、敷板、敷角の設置は計画通りか" },
          { id: 'tankan-p-6-2', label: "敷板、敷角に異常な沈下、滑動はないか" },
          { id: 'tankan-p-6-3', label: "ベース金具は敷板に確実に釘止めされているか" },
          { id: 'tankan-p-6-4', label: "根絡みは所定の位置にクランプで緊結されているか" }
        ]
      },
      {
        id: 'tankan-p-7', title: "補強材の取付",
        items: [
          { id: 'tankan-p-7-1', label: "筋かい、控え、壁つなぎの取付状態は計画通りか" },
          { id: 'tankan-p-7-2', label: "筋かい、控え、壁つなぎは取り外されていないか" },
          { id: 'tankan-p-7-3', label: "専用の壁つなぎ用金具が使用されているか" },
          { id: 'tankan-p-7-4', label: "控えはクランプで緊結されているか" }
        ]
      },
      {
        id: 'tankan-p-8', title: "損傷の有無",
        items: [
          { id: 'tankan-p-8-1', label: "建地、布、腕木に変形、損傷はないか" }
        ]
      },
      {
        id: 'tankan-p-9', title: "その他",
        items: [
          { id: 'tankan-p-9-1', label: "足場組立解体作業主任者名の表示があるか" },
          { id: 'tankan-p-9-2', label: "最大積載荷重表示が明示されているか" },
          { id: 'tankan-p-9-3', label: "昇降設備はあるか、つまづき等の恐れはないか。" },
          { id: 'tankan-p-9-4', label: "安全看板類の設置は関係者へ周知するのに適切な位置か" }
        ]
      }
    ],
    user: [
      {
        id: 'tankan-u-1', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'tankan-u-1-1', label: "手すり、中桟、幅木等の取付状態は計画通りか" },
          { id: 'tankan-u-1-2', label: "手すり、中桟、幅木の脱落はないか" },
          { id: 'tankan-u-1-3', label: "手すり、中桟、幅木は確実に固定されているか" },
          { id: 'tankan-u-1-4', label: "手すりの高さは85（90）ｃｍ以上か" },
          { id: 'tankan-u-1-5', label: "中桟の高さは35ｃｍ以上50ｃｍ以下か" },
          { id: 'tankan-u-1-6', label: "妻面に手すり及び中桟は設置されているか" }
        ]
      }
    ]
  },
  kusabi: {
    prime: [
      {
        id: 'kusabi-p-1', title: "床材の損傷",
        items: [
          { id: 'kusabi-p-1-1', label: "床材の取付状態は計画通りか" },
          { id: 'kusabi-p-1-2', label: "床付布枠に変形、損傷はないか" },
          { id: 'kusabi-p-1-3', label: "床付き布わくは、外れ止めが確実にロックされているか" },
          { id: 'kusabi-p-1-4', label: "床材と床材の隙間は3ｃｍ以下にされているか" },
          { id: 'kusabi-p-1-5', label: "床材の幅は40ｃｍ以上確保されているか" },
          { id: 'kusabi-p-1-6', label: "床材と建地の隙間は12ｃｍ未満となっているか" }
        ]
      },
      {
        id: 'kusabi-p-2', title: "緊結部・接続部・取付部のゆるみ",
        items: [
          { id: 'kusabi-p-2-1', label: "建地、布材、腕木の取付状態は計画通りか" },
          { id: 'kusabi-p-2-2', label: "建地は、抜け止めピン等で確実に接続されているか" },
          { id: 'kusabi-p-2-3', label: "布のくさびは建地緊結部に確実に打ち込まれているか" },
          { id: 'kusabi-p-2-4', label: "腕木のくさびは建地緊結部に確実に打ち込まれているか" },
          { id: 'kusabi-p-2-5', label: "建地、布、腕木の取付部にゆるみはないか" }
        ]
      },
      {
        id: 'kusabi-p-3', title: "緊結材・緊結金具",
        items: [
          { id: 'kusabi-p-3-1', label: "緊結金具(ｸﾗﾝﾌﾟ等）に損傷、腐食はないか" },
          { id: 'kusabi-p-3-2', label: "継手金具（ｼﾞｮｲﾝﾄ等）に損傷、腐食はないか" }
        ]
      },
      {
        id: 'kusabi-p-4', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'kusabi-p-4-1', label: "手すり、中桟、幅木等の取付状態は計画通りか" },
          { id: 'kusabi-p-4-2', label: "手すり、中桟、幅木の脱落はないか" },
          { id: 'kusabi-p-4-3', label: "手すり、中桟、幅木は確実に固定されているか" },
          { id: 'kusabi-p-4-4', label: "手すりの高さは85（90）ｃｍ以上か" },
          { id: 'kusabi-p-4-5', label: "中桟の高さは35ｃｍ以上50ｃｍ以下か" },
          { id: 'kusabi-p-4-6', label: "妻面に手すり及び中桟は設置されているか" }
        ]
      },
      {
        id: 'kusabi-p-5', title: "落下防止措置の取りはずし・脱落の有無",
        items: [
          { id: 'kusabi-p-5-1', label: "幅木、ﾒｯｼｭｼｰﾄ、防網等の取付状態は計画通りか" },
          { id: 'kusabi-p-5-2', label: "幅木、ﾒｯｼｭｼｰﾄ、防網は取り外されていないか" },
          { id: 'kusabi-p-5-3', label: "幅木は脚柱等に確実に取付けられているか" },
          { id: 'kusabi-p-5-4', label: "ﾒｯｼｭｼｰﾄは全てのはと目で、緊結されているか" },
          { id: 'kusabi-p-5-5', label: "防網はつり綱で確実に緊結されているか" },
          { id: 'kusabi-p-5-6', label: "朝顔は確実に固定されているか" }
        ]
      },
      {
        id: 'kusabi-p-6', title: "脚部（沈下・滑動）",
        items: [
          { id: 'kusabi-p-6-1', label: "ベース金具、根がらみ、敷板、敷角の設置は計画通りか" },
          { id: 'kusabi-p-6-2', label: "敷板、敷角に異常な沈下、滑動はないか" },
          { id: 'kusabi-p-6-3', label: "ベース金具は敷板に確実に釘止めされているか" },
          { id: 'kusabi-p-6-4', label: "根がらみは所定の位置にクランプで緊結されているか" }
        ]
      },
      {
        id: 'kusabi-p-7', title: "補強材の取付",
        items: [
          { id: 'kusabi-p-7-1', label: "交差筋かい、控え、壁つなぎの取付状態は計画通りか" },
          { id: 'kusabi-p-7-2', label: "交差筋かい、控え、壁つなぎは取り外されていないか" },
          { id: 'kusabi-p-7-3', label: "専用の壁つなぎ用金具が使用されているか" },
          { id: 'kusabi-p-7-4', label: "控えはクランプで緊結されているか" }
        ]
      },
      {
        id: 'kusabi-p-8', title: "損傷の有無",
        items: [
          { id: 'kusabi-p-8-1', label: "建枠、布枠、交差筋かいに変形、損傷はないか" }
        ]
      },
      {
        id: 'kusabi-p-9', title: "その他",
        items: [
          { id: 'kusabi-p-9-1', label: "足場組立解体作業主任者名の表示があるか" },
          { id: 'kusabi-p-9-2', label: "最大積載荷重表示が明示されているか" },
          { id: 'kusabi-p-9-3', label: "昇降設備はあるか、つまづき等の恐れはないか。" },
          { id: 'kusabi-p-9-4', label: "安全看板類の設置は関係者へ周知するのに適切な位置か" }
        ]
      }
    ],
    user: [
      {
        id: 'kusabi-u-1', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'kusabi-u-1-1', label: "手すり、中桟、幅木等の取付状態は計画通りか" },
          { id: 'kusabi-u-1-2', label: "手すり、中桟、幅木の脱落はないか" },
          { id: 'kusabi-u-1-3', label: "手すり、中桟、幅木は確実に固定されているか" },
          { id: 'kusabi-u-1-4', label: "手すりの高さは85（90）ｃｍ以上か" },
          { id: 'kusabi-u-1-5', label: "中桟の高さは35ｃｍ以上50ｃｍ以下か" },
          { id: 'kusabi-u-1-6', label: "妻面に手すり及び中桟は設置されているか" }
        ]
      }
    ]
  },
  tsuri_d: {
    prime: [
      {
        id: 'tsuri_d-p-1', title: "床材の損傷",
        items: [
          { id: 'tsuri_d-p-1-1', label: "床材の取付状態は計画通りか" },
          { id: 'tsuri_d-p-1-2', label: "床材に変形、損傷はないか" },
          { id: 'tsuri_d-p-1-3', label: "床材は根太、つり桁に番線等で確実に固定されているか" },
          { id: 'tsuri_d-p-1-4', label: "床材は、すき間なく設置されているか" }
        ]
      },
      {
        id: 'tsuri_d-p-2', title: "緊結部・接続部・取付部のゆるみ",
        items: [
          { id: 'tsuri_d-p-2-1', label: "根太、つり桁の設置状態は計画通りか" },
          { id: 'tsuri_d-p-2-2', label: "根太は、つり桁に緊結金具等で確実に固定されているか" },
          { id: 'tsuri_d-p-2-3', label: "根太は、つり桁に変形、損傷、腐食はないか" }
        ]
      },
      {
        id: 'tsuri_d-p-3', title: "緊結材・緊結金具",
        items: [
          { id: 'tsuri_d-p-3-1', label: "クランプ等の緊結金具に損傷、腐食はないか" }
        ]
      },
      {
        id: 'tsuri_d-p-4', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'tsuri_d-p-4-1', label: "手すり、中桟、幅木（側板）の取付状態は計画通りか" },
          { id: 'tsuri_d-p-4-2', label: "手すり、中さん、幅木の脱落はないか" },
          { id: 'tsuri_d-p-4-3', label: "手すり、中さん、幅木は確実に固定されているか" },
          { id: 'tsuri_d-p-4-4', label: "手すりの高さは８５（９０）㎝以上か" },
          { id: 'tsuri_d-p-4-5', label: "中桟の高さは３５㎝以上５０㎝以下か" }
        ]
      },
      {
        id: 'tsuri_d-p-5', title: "落下防止措置の取りはずし・脱落の有無",
        items: [
          { id: 'tsuri_d-p-5-1', label: "幅木、ﾒｯｼｭｼｰﾄ、防網等の取付状態は計画通りか" },
          { id: 'tsuri_d-p-5-2', label: "幅木、ﾒｯｼｭｼｰﾄ、防網は取り外されていないか" },
          { id: 'tsuri_d-p-5-3', label: "幅木は脚柱等に確実に取付けられているか" },
          { id: 'tsuri_d-p-5-4', label: "ﾒｯｼｭｼｰﾄは全てのはと目で、緊結されているか" },
          { id: 'tsuri_d-p-5-5', label: "防網は、つり綱で確実に緊結されているか" },
          { id: 'tsuri_d-p-5-6', label: "朝顔は確実に固定されているか" }
        ]
      },
      {
        id: 'tsuri_d-p-6', title: "補強材の取付",
        items: [
          { id: 'tsuri_d-p-6-1', label: "筋かい、控え、振れ止めの取付状態は計画通りか" },
          { id: 'tsuri_d-p-6-2', label: "筋かい、控え、振れ止めは取り外されていないか" },
          { id: 'tsuri_d-p-6-3', label: "振れ止めはクランプ等で緊結されているか" },
          { id: 'tsuri_d-p-6-4', label: "控えはクランプで緊結されているか" }
        ]
      },
      {
        id: 'tsuri_d-p-7', title: "つり装置の歯止めの機能・突りょうとつり索との取付",
        items: [
          { id: 'tsuri_d-p-7-1', label: "つりチェ－ン間隔（強度計算）は計画通りか" },
          { id: 'tsuri_d-p-7-2', label: "チェ－ンリング等のつり部材に亀裂、変形、腐食はないか" },
          { id: 'tsuri_d-p-7-3', label: "つり部材、つり元金具、フックに亀裂、変形、腐食はないか" },
          { id: 'tsuri_d-p-7-4', label: "つり金具は、つり桁と確実に固定されているか" }
        ]
      },
      {
        id: 'tsuri_d-p-8', title: "その他",
        items: [
          { id: 'tsuri_d-p-8-1', label: "足場組立解体作業主任者名の表示があるか" },
          { id: 'tsuri_d-p-8-2', label: "最大積載荷重表示が明示されているか" },
          { id: 'tsuri_d-p-8-3', label: "昇降設備はあるか、つまづき等の恐れはないか。" },
          { id: 'tsuri_d-p-8-4', label: "安全看板類の設置は関係者へ周知するのに適切な位置か" }
        ]
      }
    ],
    user: [
      {
        id: 'tsuri_d-u-1', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'tsuri_d-u-1-1', label: "手すり、中桟、幅木（側板）の取付状態は計画通りか" },
          { id: 'tsuri_d-u-1-2', label: "手すり、中さん、幅木の脱落はないか" },
          { id: 'tsuri_d-u-1-3', label: "手すり、中さん、幅木は確実に固定されているか" },
          { id: 'tsuri_d-u-1-4', label: "手すりの高さは８５（９０）㎝以上か" },
          { id: 'tsuri_d-u-1-5', label: "中桟の高さは３５㎝以上５０㎝以下か" }
        ]
      }
    ]
  },
  tsuri_k: {
    prime: [
      {
        id: 'tsuri_k-p-1', title: "床材の損傷",
        items: [
          { id: 'tsuri_k-p-1-1', label: "床材の取付状態は計画通りか" },
          { id: 'tsuri_k-p-1-2', label: "床材に変形、損傷はないか" },
          { id: 'tsuri_k-p-1-3', label: "床材は根太、つり桁に番線等で確実に固定されているか" },
          { id: 'tsuri_k-p-1-4', label: "床材は、すき間なく設置されているか" }
        ]
      },
      {
        id: 'tsuri_k-p-2', title: "緊結部・接続部・取付部のゆるみ",
        items: [
          { id: 'tsuri_k-p-2-1', label: "根太、つり桁の設置状態は計画通りか" },
          { id: 'tsuri_k-p-2-2', label: "根太は、つり桁に緊結金具等で確実に固定されているか" },
          { id: 'tsuri_k-p-2-3', label: "根太は、つり桁に変形、損傷、腐食はないか" }
        ]
      },
      {
        id: 'tsuri_k-p-3', title: "緊結材・緊結金具",
        items: [
          { id: 'tsuri_k-p-3-1', label: "クランプ等の緊結金具に損傷、腐食はないか" }
        ]
      },
      {
        id: 'tsuri_k-p-4', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'tsuri_k-p-4-1', label: "手すり、中桟、幅木（側板）の取付状態は計画通りか" },
          { id: 'tsuri_k-p-4-2', label: "手すり、中さん、幅木の脱落はないか" },
          { id: 'tsuri_k-p-4-3', label: "手すり、中さん、幅木は確実に固定されているか" },
          { id: 'tsuri_k-p-4-4', label: "手すりの高さは８５（９０）㎝以上か" },
          { id: 'tsuri_k-p-4-5', label: "中桟の高さは３５㎝以上５０㎝以下か" }
        ]
      },
      {
        id: 'tsuri_k-p-5', title: "落下防止措置の取りはずし・脱落の有無",
        items: [
          { id: 'tsuri_k-p-5-1', label: "幅木、ﾒｯｼｭｼｰﾄ、防網等の取付状態は計画通りか" },
          { id: 'tsuri_k-p-5-2', label: "幅木、ﾒｯｼｭｼｰﾄ、防網は取り外されていないか" },
          { id: 'tsuri_k-p-5-3', label: "幅木は脚柱等に確実に取付けられているか" },
          { id: 'tsuri_k-p-5-4', label: "ﾒｯｼｭｼｰﾄは全てのはと目で、緊結されているか" },
          { id: 'tsuri_k-p-5-5', label: "防網は、つり綱で確実に緊結されているか" },
          { id: 'tsuri_k-p-5-6', label: "朝顔は確実に固定されているか" }
        ]
      },
      {
        id: 'tsuri_k-p-6', title: "補強材の取付",
        items: [
          { id: 'tsuri_k-p-6-1', label: "筋かい、控え、振れ止めの取付状態は計画通りか" },
          { id: 'tsuri_k-p-6-2', label: "筋かい、控え、振れ止めは取り外されていないか" },
          { id: 'tsuri_k-p-6-3', label: "振れ止めはクランプ等で緊結されているか" },
          { id: 'tsuri_k-p-6-4', label: "控えはクランプで緊結されているか" }
        ]
      },
      {
        id: 'tsuri_k-p-7', title: "つり装置の歯止めの機能・突りょうとつり索との取付",
        items: [
          { id: 'tsuri_k-p-7-1', label: "つりチェ－ン間隔（強度計算）は計画通りか" },
          { id: 'tsuri_k-p-7-2', label: "チェ－ンリング等のつり部材に亀裂、変形、腐食はないか" },
          { id: 'tsuri_k-p-7-3', label: "つり部材、つり元金具、フックに亀裂、変形、腐食はないか" },
          { id: 'tsuri_k-p-7-4', label: "つり金具は、つり桁と確実に固定されているか" }
        ]
      },
      {
        id: 'tsuri_k-p-8', title: "その他",
        items: [
          { id: 'tsuri_k-p-8-1', label: "足場組立解体作業主任者名の表示があるか" },
          { id: 'tsuri_k-p-8-2', label: "最大積載荷重表示が明示されているか" },
          { id: 'tsuri_k-p-8-3', label: "昇降設備はあるか、つまづき等の恐れはないか。" },
          { id: 'tsuri_k-p-8-4', label: "安全看板類の設置は関係者へ周知するのに適切な位置か" }
        ]
      }
    ],
    user: [
      {
        id: 'tsuri_k-u-1', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'tsuri_k-u-1-1', label: "手すり、中桟、幅木（側板）の取付状態は計画通りか" },
          { id: 'tsuri_k-u-1-2', label: "手すり、中さん、幅木の脱落はないか" },
          { id: 'tsuri_k-u-1-3', label: "手すり、中さん、幅木は確実に固定されているか" },
          { id: 'tsuri_k-u-1-4', label: "手すりの高さは８５（９０）㎝以上か" },
          { id: 'tsuri_k-u-1-5', label: "中桟の高さは３５㎝以上５０㎝以下か" }
        ]
      }
    ]
  },
  kodai: {
    prime: [
      {
        id: 'kodai-p-1', title: "脚部の点検",
        items: [
          { id: 'kodai-p-1-1', label: "脚部の取付状態は計画通りか" },
          { id: 'kodai-p-1-2', label: "部材の損傷及び腐食はないか" },
          { id: 'kodai-p-1-3', label: "支柱は軟弱地盤等で根入れがされているか" },
          { id: 'kodai-p-1-4', label: "支柱は梁、水平つなき、筋かい等により、一体化されているか" },
          { id: 'kodai-p-1-5', label: "緊結部、接続部、取付部は、緊結金具で固定されているか" }
        ]
      },
      {
        id: 'kodai-p-2', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'kodai-p-2-1', label: "手すり、中桟、幅木（側板）の取付状態は計画通りか" },
          { id: 'kodai-p-2-2', label: "手すり、中さん、幅木の脱落はないか" },
          { id: 'kodai-p-2-3', label: "手すり、中さん、幅木は確実に固定されているか" },
          { id: 'kodai-p-2-4', label: "手すりの高さは８５（９０）㎝以上か" },
          { id: 'kodai-p-2-5', label: "中桟の高さは３５㎝以上５０㎝以下か" }
        ]
      },
      {
        id: 'kodai-p-3', title: "落下防止措置の取りはずし・脱落の有無",
        items: [
          { id: 'kodai-p-3-1', label: "幅木、ﾒｯｼｭｼｰﾄ、防網等の取付状態は計画通りか" },
          { id: 'kodai-p-3-2', label: "幅木、ﾒｯｼｭｼｰﾄ、防網は取り外されていないか" },
          { id: 'kodai-p-3-3', label: "幅木は脚柱等に確実に取付けられているか" },
          { id: 'kodai-p-3-4', label: "ﾒｯｼｭｼｰﾄは全てのはと目で、緊結されているか" },
          { id: 'kodai-p-3-5', label: "防網は、つり綱で確実に緊結されているか" }
        ]
      },
      {
        id: 'kodai-p-4', title: "緊結材・緊結金具",
        items: [
          { id: 'kodai-p-4-1', label: "緊結材及び緊結金具等の取付状態は計画通りか" },
          { id: 'kodai-p-4-2', label: "ボルト等の緊結材及び緊結金具に損傷、腐食はないか" },
          { id: 'kodai-p-4-3', label: "ブルマン等の緊結材及び緊結金具に損傷、腐食はないか" },
          { id: 'kodai-p-4-4', label: "クランプ等の緊結材及び緊結金具に損傷、腐食はないか" }
        ]
      },
      {
        id: 'kodai-p-5', title: "補強材の取付",
        items: [
          { id: 'kodai-p-5-1', label: "水平つなぎの取付状態は計画通りか" },
          { id: 'kodai-p-5-2', label: "最上層及び５層以内ごとに水平つなぎが設けられているか" },
          { id: 'kodai-p-5-3', label: "水平つなぎは、わく面方向５わく以内に設けられているか" },
          { id: 'kodai-p-5-4', label: "水平つなぎは、交さ筋かい方向４スパン以内毎に設けられているか" },
          { id: 'kodai-p-5-5', label: "水平つなぎを設けた層全体に床付き布わくが設けられているか" },
          { id: 'kodai-p-5-6', label: "筋かいは全層全スパンにわたって枠組の両面に取付けられているか" },
          { id: 'kodai-p-5-7', label: "筋かいピンは完全にロックされているか" }
        ]
      },
      {
        id: 'kodai-p-6', title: "作業構台上の表示",
        items: [
          { id: 'kodai-p-6-1', label: "最大積載荷重表示が明示されているか" }
        ]
      },
      {
        id: 'kodai-p-7', title: "その他",
        items: [
          { id: 'kodai-p-7-1', label: "足場組立解体作業主任者名の表示があるか" },
          { id: 'kodai-p-7-2', label: "昇降設備はあるか、つまづき等の恐れはないか。" },
          { id: 'kodai-p-7-3', label: "安全看板類の設置は関係者へ周知するのに適切な位置か" }
        ]
      }
    ],
    user: [
      {
        id: 'kodai-u-1', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'kodai-u-1-1', label: "手すり、中桟、幅木（側板）の取付状態は計画通りか" },
          { id: 'kodai-u-1-2', label: "手すり、中さん、幅木の脱落はないか" },
          { id: 'kodai-u-1-3', label: "手すり、中さん、幅木は確実に固定されているか" },
          { id: 'kodai-u-1-4', label: "手すりの高さは８５（９０）㎝以上か" },
          { id: 'kodai-u-1-5', label: "中桟の高さは３５㎝以上５０㎝以下か" }
        ]
      }
    ]
  },
  rolling: {
    prime: [
      {
        id: 'rolling-p-1', title: "床材の損傷",
        items: [
          { id: 'rolling-p-1-1', label: "床付布枠に変形、損傷はないか" },
          { id: 'rolling-p-1-2', label: "つかみ金具の外れ止めは確実にロックされているか" },
          { id: 'rolling-p-1-3', label: "床材と床材の隙間は3ｃｍ以下にされているか" },
          { id: 'rolling-p-1-4', label: "床材の幅は40ｃｍ以上確保されているか" },
          { id: 'rolling-p-1-5', label: "床材と建地の隙間は12ｃｍ未満となっているか" }
        ]
      },
      {
        id: 'rolling-p-2', title: "緊結部・接続部・取付部のゆるみ",
        items: [
          { id: 'rolling-p-2-1', label: "建わく、布わく、手すりわく、控えわくの変形、腐食はないか" },
          { id: 'rolling-p-2-2', label: "建わくは、ア－ムロック、ピン等で確実に接続されているか" },
          { id: 'rolling-p-2-3', label: "控えわくは建てわくに確実に固定されているか" },
          { id: 'rolling-p-2-4', label: "手すりわくの固定は良いか" }
        ]
      },
      {
        id: 'rolling-p-3', title: "緊結材・緊結金具",
        items: [
          { id: 'rolling-p-3-1', label: "クランプ等の緊結金具に損傷、腐食はないか" },
          { id: 'rolling-p-3-2', label: "継手金具（ジョイント、ア－ムロック）に損傷、腐食はないか" }
        ]
      },
      {
        id: 'rolling-p-4', title: "最上段の墜落防止設備",
        items: [
          { id: 'rolling-p-4-1', label: "手すり、中桟、幅木等の変形、腐食はないか" },
          { id: 'rolling-p-4-2', label: "手すり、中桟、幅木の脱落はないか" },
          { id: 'rolling-p-4-3', label: "手すり、中桟、幅木は確実に固定されているか" },
          { id: 'rolling-p-4-4', label: "手すりの高さは85（90）ｃｍ以上か" },
          { id: 'rolling-p-4-5', label: "中桟の高さは35ｃｍ以上50ｃｍ以下か" }
        ]
      },
      {
        id: 'rolling-p-5', title: "各階の落下防止措置",
        items: [
          { id: 'rolling-p-5-1', label: "幅木は脚柱等に確実に取り付けれているか" },
          { id: 'rolling-p-5-2', label: "幅木、垂直ネットは取り外されていないか" },
          { id: 'rolling-p-5-3', label: "垂直ネットは確実に緊結されているか" }
        ]
      },
      {
        id: 'rolling-p-6', title: "昇降設備",
        items: [
          { id: 'rolling-p-6-1', label: "昇降設備に損傷、腐食はないか" },
          { id: 'rolling-p-6-2', label: "昇降設備は確実に固定されているか" },
          { id: 'rolling-p-6-3', label: "安全ブロック、ロリップは確実に取付けているか" },
          { id: 'rolling-p-6-4', label: "安全ブロック、ロリップに損傷、腐食はないか" }
        ]
      },
      {
        id: 'rolling-p-7', title: "脚部（沈下・滑動）",
        items: [
          { id: 'rolling-p-7-1', label: "控えわくのジャッキベ－スは確実に固定されているか" },
          { id: 'rolling-p-7-2', label: "キャスタ－車輪のストッパ－の作動は確実か" },
          { id: 'rolling-p-7-3', label: "作業場所が軟弱地盤や勾配のある場所で使用していないか" },
          { id: 'rolling-p-7-4', label: "段差がある場所は、水平にされているか" }
        ]
      },
      {
        id: 'rolling-p-8', title: "その他",
        items: [
          { id: 'rolling-p-8-1', label: "ロ－リングタワ－の状況は計画通りか" },
          { id: 'rolling-p-8-2', label: "最大積載荷重表示が明示されているか" },
          { id: 'rolling-p-8-3', label: "取扱い説明の表示はあるか、又見やすいか" },
          { id: 'rolling-p-8-4', label: "取扱責任者の表示はあるか、又見やすいか" }
        ]
      }
    ],
    user: [
      {
        id: 'rolling-u-1', title: "墜落防止設備の取りはずし・脱落の有無",
        items: [
          { id: 'rolling-u-1-1', label: "手すり、中桟、幅木等の変形、腐食はないか" },
          { id: 'rolling-u-1-2', label: "手すり、中桟、幅木の脱落はないか" },
          { id: 'rolling-u-1-3', label: "手すり、中桟、幅木は確実に固定されているか" },
          { id: 'rolling-u-1-4', label: "手すりの高さは85（90）ｃｍ以上か" },
          { id: 'rolling-u-1-5', label: "中桟の高さは35ｃｍ以上50ｃｍ以下か" }
        ]
      }
    ]
  }
  };

  function typeName(id) {
    for (var i = 0; i < SCAFFOLD_TYPES.length; i++) {
      if (SCAFFOLD_TYPES[i].id === id) return SCAFFOLD_TYPES[i].name;
    }
    return 'その他の足場';
  }

  function role(id) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].id === id) return ROLES[i];
    return ROLES[0];
  }

  function roleName(id) { return role(id).name; }

  /** 足場の種類と立場に応じた点検セクションを返す */
  function sectionsFor(typeId, roleId) {
    var byType = Object.prototype.hasOwnProperty.call(SECTIONS, typeId) ? SECTIONS[typeId] : null;
    if (!byType) return [];
    var list = Object.prototype.hasOwnProperty.call(byType, roleId) ? byType[roleId] : null;
    return list || [];
  }

  /** その組み合わせの点検項目の総数 */
  function itemCount(typeId, roleId) {
    return sectionsFor(typeId, roleId).reduce(function (n, s) { return n + s.items.length; }, 0);
  }

  function result(id) {
    for (var i = 0; i < RESULTS.length; i++) if (RESULTS[i].id === id) return RESULTS[i];
    return null;
  }
  function resultMark(id) { var r = result(id); return r ? r.mark : ''; }
  function resultLabel(id) { var r = result(id); return r ? r.label : '\u30fc'; }

  /** 点検項目ラベルの逆引き（過去の記録を表示するため全項目から探す） */
  function itemLabel(itemId) {
    var keys = Object.keys(SECTIONS);
    for (var k = 0; k < keys.length; k++) {
      var roles = SECTIONS[keys[k]];
      var rks = Object.keys(roles);
      for (var r = 0; r < rks.length; r++) {
        var secs = roles[rks[r]];
        for (var s = 0; s < secs.length; s++) {
          for (var i = 0; i < secs[s].items.length; i++) {
            if (secs[s].items[i].id === itemId) return secs[s].items[i].label;
          }
        }
      }
    }
    return itemId;
  }

  global.ScaffoldData = {
    SCAFFOLD_TYPES: SCAFFOLD_TYPES,
    ROLES: ROLES,
    TIMINGS: TIMINGS,
    INSPECTOR_KINDS: INSPECTOR_KINDS,
    QUALIFICATIONS: QUALIFICATIONS,
    RESULTS: RESULTS,
    SECTIONS: SECTIONS,
    typeName: typeName,
    role: role,
    roleName: roleName,
    sectionsFor: sectionsFor,
    itemCount: itemCount,
    result: result,
    resultMark: resultMark,
    resultLabel: resultLabel,
    itemLabel: itemLabel
  };
})(window);
