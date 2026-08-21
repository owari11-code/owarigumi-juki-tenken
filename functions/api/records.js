/*
 * /api/records - 点検データの読み書き（Supabaseへの唯一の窓口）
 *
 * ここで守っていること:
 *   ・データベースの鍵はブラウザに渡さない（環境変数からのみ読む）
 *   ・削除（DELETE）は一切通さない。消去は「削除済みの印」だけ
 *   ・共有コードはサーバー側で固定。他社のデータは指定できない
 *   ・受け取る項目・件数・大きさを検査し、想定外の列は捨てる
 *   ・別サイトからの呼び出しを拒否する
 *
 * 必要な環境変数:
 *   SUPABASE_URL          … https://〇〇.supabase.co
 *   SUPABASE_SERVICE_KEY  … service_role または sb_secret_… の鍵（暗号化して保存）
 *   SPACE                 … 共有コード（省略時 default）
 *   SESSION_SECRET        … 署名鍵（あるとセッション必須になる）
 */
import {
  TABLE, KINDS, json, fail, checkOrigin, requireSession,
  supabaseHeaders, supabaseUrl, configured, space
} from './_lib.js';

const MAX_ROWS = 200;              // 1回の送信で受け付ける最大件数
const MAX_ROW_BYTES = 32 * 1024;   // 1件あたりの上限
const MAX_BODY_BYTES = 1024 * 1024;
const PULL_LIMIT = 2000;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/* ---------------- 取得 ---------------- */
export async function onRequestGet({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  if (!configured(env)) return fail(503, 'not_configured', 'サーバー側の接続設定が未完了です。');
  if (!(await requireSession(request, env))) return fail(401, 'no_session', '利用確認が必要です。');

  const url = new URL(request.url);
  let since = url.searchParams.get('since') || '1970-01-01T00:00:00.000Z';
  if (!ISO_RE.test(since)) since = '1970-01-01T00:00:00.000Z';

  const target = supabaseUrl(env, TABLE) +
    '?select=id,kind,data,deleted,updated_at' +
    '&space=eq.' + encodeURIComponent(space(env)) +
    '&updated_at=gt.' + encodeURIComponent(since) +
    '&order=updated_at.asc&limit=' + PULL_LIMIT;

  let res;
  try {
    res = await fetch(target, { headers: supabaseHeaders(env) });
  } catch (e) {
    return fail(502, 'upstream_unreachable', 'データの保管先に接続できませんでした。');
  }
  if (!res.ok) {
    const text = await res.text();
    return fail(502, 'upstream_error', shorten(text));
  }
  const rows = await res.json();
  return json({ rows });
}

/* ---------------- 保存（追加・更新のみ） ---------------- */
export async function onRequestPost({ request, env }) {
  if (!checkOrigin(request)) return fail(403, 'bad_origin', '別のサイトからは利用できません。');
  if (!configured(env)) return fail(503, 'not_configured', 'サーバー側の接続設定が未完了です。');
  if (!(await requireSession(request, env))) return fail(401, 'no_session', '利用確認が必要です。');

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'too_large', '送信データが大きすぎます。');

  let incoming;
  try {
    incoming = JSON.parse(raw);
  } catch (e) {
    return fail(400, 'bad_json', '内容を読み取れませんでした。');
  }
  if (!Array.isArray(incoming)) return fail(400, 'bad_shape', '形式が正しくありません。');
  if (incoming.length === 0) return json({ ok: true, saved: 0 });
  if (incoming.length > MAX_ROWS) return fail(413, 'too_many', '一度に送れる件数を超えています。');

  const rows = [];
  for (const item of incoming) {
    if (!item || typeof item !== 'object') return fail(400, 'bad_row', '形式が正しくありません。');
    if (typeof item.id !== 'string' || !ID_RE.test(item.id)) {
      return fail(400, 'bad_id', '識別子の形式が正しくありません。');
    }
    if (typeof item.kind !== 'string' || KINDS.indexOf(item.kind) < 0) {
      return fail(400, 'bad_kind', '種別が正しくありません。');
    }
    if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) {
      return fail(400, 'bad_data', '内容が正しくありません。');
    }
    const size = JSON.stringify(item.data).length;
    if (size > MAX_ROW_BYTES) return fail(413, 'row_too_large', '1件あたりの大きさを超えています。');

    // 想定した列だけを組み立て直す（余計な列は渡さない）
    rows.push({
      id: item.id,
      space: space(env),          // 共有コードはサーバー側で固定する
      kind: item.kind,
      data: item.data,
      deleted: item.deleted === true
    });
  }

  let res;
  try {
    res = await fetch(supabaseUrl(env, TABLE), {
      method: 'POST',
      headers: supabaseHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows)
    });
  } catch (e) {
    return fail(502, 'upstream_unreachable', 'データの保管先に接続できませんでした。');
  }
  if (!res.ok) {
    const text = await res.text();
    return fail(502, 'upstream_error', shorten(text));
  }
  return json({ ok: true, saved: rows.length });
}

/*
 * DELETE などは、そもそもここに処理を書かない。
 * Pages Functions は未定義のメソッドに 405 を返すため、削除は届かない。
 */

function shorten(text) {
  return String(text || '').slice(0, 200);
}
