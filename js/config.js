/*
 * config.js - このファイルだけを書き換えて公開してください
 *
 * ここに同期設定を書いておくと、QRコードを読み取った端末すべてに
 * 自動で同じ設定が行き渡ります（各端末での入力は不要です）。
 * 値の取得方法は README.md「端末間の自動共有」を参照してください。
 */
window.APP_CONFIG = {
  /* QRコードに埋め込むURL。空欄なら「いま開いているURL」を使います。
     例: 'https://owari-gumi.github.io/juki-tenken/' */
  baseUrl: 'https://owari11-code.github.io/owarigumi-juki-tenken/',

  /* Supabase の Project URL。末尾の /rest/v1/ は付けない
     例: 'https://abcdefghijk.supabase.co' */
  supabaseUrl: 'https://kxfjojymrkajrqiqdnth.supabase.co',

  /* Supabase の anon public / publishable キー
     （'eyJ…' または 'sb_publishable_…' で始まる文字列。secret キーは使わない） */
  supabaseAnonKey: 'sb_publishable_SpG4b0FcHVQ3F_S_g9LBqw_vu2NtXCS',

  /* 共有コード。同じコードの端末どうしでデータを共有します。
     現場や年度で分けたい場合はここを変えたものを別フォルダで公開してください。 */
  space: 'default',

  /* 会社名（帳票の表示用） */
  company: ''
};
