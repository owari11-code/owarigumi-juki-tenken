/*
 * policy.js - 「誰が・どのデータを・読めるか／書けるか」の決まり
 *
 * 事務所（ログイン）… 下の ADMIN_KINDS をすべて読み書きできる。
 * 現場（QR）       … QRの現場のデータだけを読み、決められた記録だけを書ける。
 *                     現場の管理情報（QRの鍵・メモ）は渡さない。
 */
import { ID_RE, ISO_RE } from './db.js';
import { isPlainObject } from './http.js';

/* 扱うデータの種別 */
export const ADMIN_KINDS = [
  'sites',          // 工事現場（資機材置場を含む）
  'machines',       // 重機・機械（リース・法定検査の期限を含む）
  'targets',        // 点検の対象（足場・玉掛け・地山/土留）
  'inspections',    // 点検記録
  'materials',      // 資材
  'stock_logs',     // 資材の搬入・使用・搬出
  'machine_logs',   // 機械の搬入・搬出
  'tools',          // 小型機械・工具
  'lends',          // 工具の貸出
  'tasks',          // 工程（工種）
  'progress_logs',  // 進捗率の記録
  'staff',          // 社員
  'assignments',    // 人員配置
  'ky',             // リスクアセスメントKY活動表
  'entrants'        // 新規入場者調査票（個人情報。現場へは渡さない）
];

/* 現場（QR）が読める種別。siteId がQRの現場のものだけ */
export const FIELD_SITE_KINDS = ['machines', 'targets', 'materials', 'stock_logs', 'machine_logs'];
/* 資機材置場のQRで読める種別 */
export const FIELD_DEPOT_KINDS = ['tools', 'lends'];
/* 点検記録とKY活動表は、直近の分だけ渡す */
export const FIELD_RECENT_KINDS = ['inspections', 'ky'];
export const FIELD_INSPECTION_DAYS = 62;

/*
 * 現場（QR）が書ける種別と、参照先の確かめ方。
 * 参照先は同じ現場のものでなければならない（よその現場の在庫や記録を狂わせないため）。
 */
export const FIELD_WRITE = {
  inspections: { refs: [['targetId', ['machines', 'targets']], ['machineId', ['machines']]] },
  stock_logs: { refs: [['materialId', ['materials']]] },
  machine_logs: { refs: [['machineId', ['machines']]] },
  lends: { refs: [['toolId', ['tools']]], depot: true },
  ky: { refs: [] },
  // 新規入場者調査票は「書けるが読めない」。現場の端末に個人情報を残さないため、
  // FIELD_SITE_KINDS にも FIELD_RECENT_KINDS にも入れない。
  entrants: { refs: [] }
};

/* siteId を持たない種別（それ以外は必須） */
const NO_SITE_KINDS = ['sites', 'staff'];

const DEFAULT_ROW_LIMIT = 32 * 1024;
/* KY活動表は参加者12名分の自筆サイン（線の通り道）を持つため、他より大きく取る */
const ROW_LIMIT = { inspections: 64 * 1024, ky: 96 * 1024, entrants: 64 * 1024 };

export const MAX_ROWS = 200;
export const MAX_BODY = 2 * 1024 * 1024;

/** 送られてきた行の形を検査し、使ってよい列だけで組み立て直す */
export function normalizeRows(incoming, allowedKinds) {
  if (!Array.isArray(incoming)) return { error: ['bad_shape', '形式が正しくありません。'] };
  if (incoming.length > MAX_ROWS) return { error: ['too_many', '一度に送れる件数を超えています。'] };
  const rows = [];
  const rejected = [];
  const seen = new Set();
  for (const item of incoming) {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !ID_RE.test(item.id)) {
      return { error: ['bad_id', '識別子の形式が正しくありません。'] };
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (typeof item.kind !== 'string' || allowedKinds.indexOf(item.kind) < 0) {
      rejected.push({ id: item.id, code: 'bad_kind' });
      continue;
    }
    if (!isPlainObject(item.data)) {
      rejected.push({ id: item.id, code: 'bad_data' });
      continue;
    }
    const limit = ROW_LIMIT[item.kind] || DEFAULT_ROW_LIMIT;
    if (JSON.stringify(item.data).length > limit) {
      rejected.push({ id: item.id, code: 'row_too_large' });
      continue;
    }
    const data = { ...item.data, id: item.id };
    delete data._dirty;
    delete data._rejected;
    if (NO_SITE_KINDS.indexOf(item.kind) < 0 && (typeof data.siteId !== 'string' || !ID_RE.test(data.siteId))) {
      rejected.push({ id: item.id, code: 'bad_site' });
      continue;
    }
    rows.push({ id: item.id, kind: item.kind, data, deleted: item.deleted === true });
  }
  return { rows, rejected };
}

/** 現場（QR）に渡してよい現場情報だけを残す */
export function siteForField(data) {
  const out = { ...data };
  delete out.fieldKey;
  delete out.note;
  return out;
}

function sameApproval(a, b) {
  return isPlainObject(a) && isPlainObject(b) &&
    a.name === b.name && a.at === b.at && (a.userId || '') === (b.userId || '');
}

/**
 * 確認欄の書き換えを検査する。
 *   manager  … 点検記録の現場代理人
 *   engineer … 点検記録の主任技術者
 *   prime    … 新規入場者調査票の元請確認欄
 *
 *   ・新しく付ける確認は、ログイン中の本人の名前でしか付けられない
 *   ・取り消しは、本人か管理者だけ（明示的な取り消しの指示 _unapprove がある場合のみ）
 *   ・古い画面から送られて確認が抜けていても、サーバー側の確認は消さない
 */
export const APPROVAL_KEYS = ['manager', 'engineer', 'prime'];

export function mergeApprovals(user, prevApprovals, data) {
  const prev = isPlainObject(prevApprovals) ? prevApprovals : {};
  const next = isPlainObject(data.approvals) ? data.approvals : {};
  const unapprove = Array.isArray(data._unapprove) ? data._unapprove : [];
  const out = {};
  for (const key of APPROVAL_KEYS) {
    const p = prev[key];
    const n = next[key];
    if (n && p && sameApproval(n, p)) {
      out[key] = p;
      continue;
    }
    if (n) {
      if (!user || !isPlainObject(n) || n.userId !== user.id) return { error: 'bad_approval' };
      out[key] = {
        name: user.name,
        userId: user.id,
        at: typeof n.at === 'string' && ISO_RE.test(n.at) ? n.at : new Date().toISOString()
      };
      continue;
    }
    if (p) {
      const canRemove = user && (user.role === 'admin' || p.userId === user.id);
      if (unapprove.indexOf(key) >= 0 && canRemove) continue;
      out[key] = p;
    }
  }
  return { value: Object.keys(out).length ? out : null };
}

/** 日付の文字列（YYYY-MM-DD）を n 日前にずらす */
export function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}
