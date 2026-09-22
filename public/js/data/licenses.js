/*
 * data/licenses.js - 新規入場者調査票の「資格」欄
 *
 * 出典
 *   ・愛知県 土木工事現場必携（令和8年4月版）P.519
 *       「土木工事に関する主な作業主任者」＝地山の掘削及び土止め支保工／コンクリート破砕器／
 *         型枠支保工の組立て等／足場の組立て等／コンクリート橋架設等／鋼橋架設等（取り壊し含む）／
 *         ずい道等の掘削等／ずい道等の覆工　等
 *       「作業主任者ではないが資格が必要な技能」＝玉掛け／高所作業車運転／小型移動式クレーン　等
 *   ・同 P.551　フルハーネス型墜落制止用器具に係る特別教育
 *       （高さ2m以上で作業床を設けることが困難なところでの作業）
 *   ・労働安全衛生法 第61条・施行令 第20条（就業制限＝免許）
 *   ・同 施行令 第6条（作業主任者を選任すべき作業）
 *   ・労働安全衛生規則 第36条（特別教育を必要とする業務）
 *
 * ＊ID（id）は記録に残る値なので、変えないでください。
 *   文言の修正や項目の追加は自由に行えます。
 */
(function (global) {
  'use strict';

  var GROUPS = [
    {
      id: 'menkyo',
      name: '免許（就業制限の業務）',
      note: '免許証の携帯が必要です',
      items: [
        { id: 'crane5', name: 'クレーン・デリック運転士（つり上げ5t以上）' },
        { id: 'mcrane5', name: '移動式クレーン運転士（つり上げ5t以上）' },
        { id: 'gasweld', name: 'ガス溶接作業主任者' },
        { id: 'boiler', name: 'ボイラー技士' },
        { id: 'blast', name: '発破技士' },
        { id: 'highpress', name: '高圧室内作業主任者' },
        { id: 'diver', name: '潜水士' }
      ]
    },
    {
      id: 'shunin',
      name: '技能講習（作業主任者）',
      note: '現場必携 P.519 の「土木工事に関する主な作業主任者」',
      items: [
        { id: 'jiyama', name: '地山の掘削及び土止め支保工' },
        { id: 'katawaku', name: '型枠支保工の組立て等' },
        { id: 'ashiba', name: '足場の組立て等' },
        { id: 'kobashi', name: '鋼橋架設等（取り壊しを含む）' },
        { id: 'conbashi', name: 'コンクリート橋架設等' },
        { id: 'zuidou', name: 'ずい道等の掘削等' },
        { id: 'zuidoufuku', name: 'ずい道等の覆工' },
        { id: 'conkaitai', name: 'コンクリート造の工作物の解体等' },
        { id: 'hasaiki', name: 'コンクリート破砕器' },
        { id: 'sanketsu', name: '酸素欠乏・硫化水素危険（第一種・第二種）' },
        { id: 'yuki', name: '有機溶剤' },
        { id: 'tokka', name: '特定化学物質及び四アルキル鉛等' },
        { id: 'namari', name: '鉛' },
        { id: 'sekimen', name: '石綿' },
        { id: 'mokuzai', name: '木材加工用機械' }
      ]
    },
    {
      id: 'ginou',
      name: '技能講習（運転・玉掛け等）',
      items: [
        { id: 'kensetsu3', name: '車両系建設機械（整地・運搬・積込み用及び掘削用）3t以上' },
        { id: 'kaitai3', name: '車両系建設機械（解体用）3t以上' },
        { id: 'kiso3', name: '車両系建設機械（基礎工事用）3t以上' },
        { id: 'kogata', name: '小型移動式クレーン（つり上げ1t以上5t未満）' },
        { id: 'tamakake1', name: '玉掛け（1t以上）' },
        { id: 'koujo10', name: '高所作業車（10m以上）' },
        { id: 'fuseichi1', name: '不整地運搬車（1t以上）' },
        { id: 'fork1', name: 'フォークリフト（1t以上）' },
        { id: 'shovel1', name: 'ショベルローダー等（1t以上）' },
        { id: 'gascut', name: 'ガス溶接' }
      ]
    },
    {
      id: 'tokubetsu',
      name: '特別教育',
      note: '労働安全衛生規則 第36条',
      items: [
        { id: 'harness', name: 'フルハーネス型墜落制止用器具（高さ2m以上・作業床が困難な箇所）' },
        { id: 'ashiba_t', name: '足場の組立て、解体又は変更の作業' },
        { id: 'rope', name: 'ロープ高所作業' },
        { id: 'kensetsu3m', name: '車両系建設機械（整地・運搬・積込み用及び掘削用）3t未満' },
        { id: 'kaitai3m', name: '車両系建設機械（解体用）3t未満' },
        { id: 'kiso3m', name: '車両系建設機械（基礎工事用）3t未満・自走しないもの' },
        { id: 'roller', name: 'ローラー（締固め用機械）' },
        { id: 'concpour', name: 'コンクリート打設用車両系建設機械' },
        { id: 'boring', name: 'ボーリングマシン' },
        { id: 'fuseichi1m', name: '不整地運搬車（1t未満）' },
        { id: 'koujo10m', name: '高所作業車（10m未満）' },
        { id: 'fork1m', name: 'フォークリフト（1t未満）' },
        { id: 'shovel1m', name: 'ショベルローダー等（1t未満）' },
        { id: 'crane5m', name: 'クレーン（つり上げ5t未満）' },
        { id: 'mcrane1m', name: '移動式クレーン（つり上げ1t未満）' },
        { id: 'tamakake1m', name: '玉掛け（1t未満）' },
        { id: 'makiage', name: '巻上げ機' },
        { id: 'lift', name: '建設用リフト' },
        { id: 'gondola', name: 'ゴンドラ' },
        { id: 'arc', name: 'アーク溶接等' },
        { id: 'kensaku', name: '研削といしの取替え等' },
        { id: 'denki', name: '電気取扱（低圧・高圧）' },
        { id: 'sanketsu_t', name: '酸素欠乏危険作業（第一種・第二種）' },
        { id: 'funjin', name: '粉じん作業' },
        { id: 'sekimen_t', name: '石綿等が使用されている建築物等の解体等' },
        { id: 'chainsaw', name: '伐木等の業務（チェーンソー）' }
      ]
    },
    {
      id: 'kyoiku',
      name: 'その他の教育',
      note: '法定の特別教育ではありませんが、現場で求められるもの',
      items: [
        { id: 'shokucho', name: '職長・安全衛生責任者教育' },
        { id: 'shokucho_up', name: '職長等能力向上教育' },
        { id: 'ashiba_up', name: '足場の組立て等作業主任者能力向上教育' },
        { id: 'karibarai', name: '刈払機取扱作業者' },
        { id: 'shindou', name: '振動工具取扱作業者' },
        { id: 'marunoko', name: '丸のこ等取扱作業者' }
      ]
    }
  ];

  var MAP = {};
  GROUPS.forEach(function (g) {
    g.items.forEach(function (it) { MAP[g.id + '.' + it.id] = g.name + '／' + it.name; });
  });

  global.MT.licenses = {
    GROUPS: GROUPS,
    /** 'ginou.tamakake1' → '技能講習（運転・玉掛け等）／玉掛け（1t以上）' */
    nameOf: function (key) { return MAP[key] || key; },
    /** 選ばれた資格を、区分ごとにまとめて返す */
    byGroup: function (keys) {
      var out = [];
      GROUPS.forEach(function (g) {
        var names = [];
        g.items.forEach(function (it) {
          if (keys && keys.indexOf(g.id + '.' + it.id) >= 0) names.push(it.name);
        });
        if (names.length) out.push({ group: g.name, names: names });
      });
      return out;
    }
  };
})(window);
