# 重機 日常点検アプリ

建設機械にQRコードを貼り付け、スマートフォンで読み取るだけで日常点検ができるWebアプリです。
ログイン不要。記録は端末間で自動共有されます。

## できること

- 工事現場ごとに重機を登録し、重機ごとのQRコードをアプリ内で生成
- QRコードをA4のラベルシートとして印刷（貼付用）
- QRを読むだけで点検フォームが開き、その場で点検を記録
- 点検記録を現場ごと・重機ごと・期間ごとに絞り込んで、いつでも印刷／PDF保存
- 現場のスマホと事務所のパソコンで記録を自動共有

## ファイル構成

```
重機点検アプリ/
├─ index.html        画面の入れ物
├─ css/style.css     スタイル（画面用＋印刷用）
└─ js/
   ├─ config.js      ★公開前に書き換えるのはこのファイルだけ
   ├─ qrcode.js      QRコード生成（自作・外部通信なし）
   ├─ data.js        機種区分と点検項目の定義
   ├─ store.js       データ保存（端末内）
   ├─ sync.js        端末間の自動共有
   └─ app.js         画面遷移と描画
```

---

# 導入手順

大きく3ステップです。**①データの保管場所を作る（Supabase）→ ②設定を書き込む → ③公開する（GitHub Pages）**。
全部無料でできます。初回の所要時間は30分ほどです。

## ステップ1　データの保管場所を作る（Supabase）

端末どうしでデータを共有するための置き場です。

1. <https://supabase.com> を開き、右上の **Start your project** からサインアップ（GitHubアカウントかメールでOK）。
2. **New project** を押す。
   - Name：`juki-tenken` など分かる名前
   - Database Password：自動生成のままでよい（**控えは保存しておく**）
   - Region：`Northeast Asia (Tokyo)` を選ぶ（現場からの反応が速くなります）
   - **Create new project** を押し、準備完了まで1〜2分待つ。
3. 左メニューの **SQL Editor**（電卓のようなアイコン）を開き、下のSQLを貼り付けて **Run** を押す。

（このSQLはアプリの **設定** 画面からもコピーできます。何度実行しても問題ありません。）

```sql
-- 点検データの置き場（1テーブルだけ）
create table if not exists public.juki_records (
  id         text primary key,
  space      text not null,
  kind       text not null,
  data       jsonb not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists juki_records_space_updated_idx
  on public.juki_records (space, updated_at);

-- 更新のたびにサーバー側の時刻を打ち直す（取りこぼし防止）
create or replace function public.juki_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists juki_touch_trg on public.juki_records;
create trigger juki_touch_trg
  before insert or update on public.juki_records
  for each row execute function public.juki_touch();

-- ログインを使わないため、匿名キーでの読み書きを許可する
alter table public.juki_records enable row level security;

drop policy if exists "app access" on public.juki_records;
create policy "app access" on public.juki_records
  for all to anon using (true) with check (true);
```

実行後に `Success. No rows returned` と出れば成功です。

4. 次の2つを控える。画面上部の **Connect** ボタン →**App Frameworks** タブを開くと2つまとめて表示されるので、それが一番簡単です。
   （個別に開く場合は `https://supabase.com/dashboard/project/_/settings/api-keys` と
   `https://supabase.com/dashboard/project/_/settings/general`）
   - **Project URL** … `https://xxxxxxxxxxxx.supabase.co`
   - **キー** … `anon public`（`eyJ…`）または `publishable`（`sb_publishable_…`）。**どちらでも使えます**

> **注意1：** Project URL は `https://xxxxxxxxxxxx.supabase.co` **まで**です。
> 管理画面には `.../rest/v1/` 付きで表示される箇所がありますが、`/rest/v1/` は付けません
> （付いていてもアプリ側で自動的に取り除きます）。
>
> **注意2：** `service_role` や `sb_secret_…` のキーは絶対に使わないでください（全権限のキーです）。

## ステップ2　設定を書き込む

`js/config.js` をメモ帳などで開き、控えた値を入れて保存します。

```js
window.APP_CONFIG = {
  baseUrl: 'https://<GitHubのユーザー名>.github.io/juki-tenken/',
  supabaseUrl: 'https://xxxxxxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...（anon public キー）',
  space: 'owarigumi',      // 共有コード。社名など、他社と重ならない文字列
  company: '株式会社○○組'
};
```

`baseUrl` はステップ3で決まるURLです。GitHubのユーザー名とリポジトリ名が決まっていれば
先に書いてしまって構いません（後から直しても大丈夫です）。

**このファイルに書いておけば、QRから開いた全ての端末に設定が自動で行き渡ります。**
各スマホでの設定入力は不要です。

## ステップ3　公開する（GitHub Pages）

1. <https://github.com> でアカウントを作成（無料）。
2. 右上の **＋ → New repository**。
   - Repository name：`juki-tenken`
   - **Public** を選ぶ
   - **Create repository** を押す
3. 次の画面の **uploading an existing file** をクリック。
4. `重機点検アプリ` フォルダの**中身**（`index.html`、`css`、`js`）をドラッグ＆ドロップ。
   - フォルダごとではなく、`index.html` が一番上に来るようにしてください。
5. 下の **Commit changes** を押す。
6. 上部タブの **Settings → Pages** を開く。
   - Source：**Deploy from a branch**
   - Branch：**main** ／ フォルダ：**/ (root)** → **Save**
7. 1〜2分待つと同じ画面に公開URLが出ます。

```
https://<ユーザー名>.github.io/juki-tenken/
```

このURLをスマートフォンで開いて、画面が出れば公開成功です。
（`js/config.js` の `baseUrl` がこのURLと違っていたら、GitHub上でファイルを開いて
鉛筆マークから直し、**Commit changes** を押してください。）

> 更新のしかた：ファイルを直したら、同じリポジトリで **Add file → Upload files** から
> 上書きアップロードすれば、1〜2分で反映されます。

## ステップ4　使いはじめる

1. パソコンで公開URLを開く。右上のランプが緑の **同期済** になっていることを確認。
2. **＋ 工事現場を登録** … 工事番号・工事名・発注者・工期（カレンダーで選択）・現場代理人
3. 現場を開いて **＋ 重機を登録** … 呼び名・機種・メーカー・型式・機番
4. **QRラベルを印刷** … A4で印刷し、ラミネート等で保護して運転席から見える位置に貼付
5. 現場でQRを読み取る → 重機のページが開く → **作業開始前点検を行う**
6. 各項目を「良／否／該当なし」で答えて **点検を記録する**

機種は点検項目の出し分けに使います（クローラ式は「クローラの張り具合」、
ホイール式は「タイヤの空気圧」が表示されます）。
「否」が1つでもあると、判定は **要整備** になります。

---

# 端末間の自動共有について

- 保存した内容は数秒で他の端末に届きます。受け取り側は**アプリを開いている間、20秒ごとに自動取得**します
  （画面を切り替えて戻ったとき、通信が回復したときにも取得します）。
- 電波が届かない場所でも点検の記録はできます。端末内に保存され、**電波が戻った時点で自動送信**されます。
  右上のランプが「未送信 ○件」と出ている間は、まだ送れていない記録があるという意味です。
- 初めての端末でQRを読むと、まずサーバーから現場・重機の情報を取り寄せてから点検画面を開きます。
- 同じ内容を2台で同時に編集した場合は、**後から保存した方**が残ります。
- 現場や重機を削除すると、他の端末でも削除されます。
- 共有を分けたいときは `config.js` の `space`（共有コード）を変えて、別フォルダで公開してください。

### 押さえておいていただきたい点

公開URLを知っている人は、ログイン無しでこのデータを読み書きできます（ログイン不要と引き換えの仕組みです）。
点検記録という性質上そこまで機微ではありませんが、URLは社内・協力会社の範囲にとどめてください。
より厳密に守りたい場合は、ログイン機能の追加をご相談ください。

### うまく同期できないときは

アプリの **設定** 画面を開くと、右上のランプの下に理由が日本語で出ます。

| 表示されるメッセージ | 原因と対処 |
|---|---|
| テーブル juki_records がまだありません | ステップ1のSQLが未実行です。**設定画面の「Supabase側の準備（初回だけ必要なSQL）」からSQLをコピー**し、Supabaseの SQL Editor に貼って Run してください |
| URLの形式が正しくありません | Project URL に余分なパスが入っています。`https://〇〇.supabase.co` だけにしてください |
| キーが正しくありません | `anon public` または `publishable` のキーか確認してください（`service_role`／`secret` は不可） |
| アクセスが許可されていません | SQLのうち `create policy` の部分が実行されていません。SQLをもう一度まとめて実行してください |
| ネットワークに接続できません | 電波・回線の問題です。記録は端末内に残り、つながった時点で自動送信されます |

### バックアップ

**設定 → データを書き出す** でJSONファイルとして保存できます。
サーバー側も Supabase の管理画面（Table Editor → juki_records）から確認・エクスポートできます。

---

# 記録の印刷・PDF保存

現場のページ → **点検記録を見る** で、重機・期間を絞り込みます。
**この一覧をまとめて印刷／PDF保存** を押し、印刷ダイアログでプリンターを
**「PDFに保存」** にすると、PDFファイルになります（1件＝1ページ）。

# 点検項目の出典

厚生労働省「外国人労働者に対する安全衛生教育教材作成事業（建設業）／
『トンネル推進工業務、建設機械施工業務及び土工業務』安全衛生のポイント　建設機械の基本と点検等」
(2020.3) の次の内容に基づいています。

- (4) 点検の基本事項 … 点検前の安全措置
- (5) 作業開始前点検 … 行わなければならない点検12項目
- (6)(7) エンジン始動後点検 … ブレーキ／クラッチ／エンジンの調子／作業装置の作動
- (8) 作業終了時点検等

項目を追加・変更する場合は `js/data.js` の `SECTIONS` を編集してください。
記録は項目IDで保存されているため、IDを変えなければ過去の記録の表示は崩れません。

# 動作環境

iOS Safari / Android Chrome / Windows の Edge・Chrome（いずれも最近のバージョン）。
QRコードの生成は自前実装で、バージョン1〜40・誤り訂正L/M/Q/Hに対応しています。
