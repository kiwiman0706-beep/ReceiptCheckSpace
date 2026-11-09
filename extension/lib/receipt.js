// 「要確認レセプト一覧」CSV を行データに変換する。chrome API に依存しない。
import { parseCsv } from './csv.js';

const COLUMNS = {
  patientNo: '患者番号',
  name: '患者氏名',
  date: '診察日',
  dept: '診療科',
  doctor: '医師',
  insurance: '保険',
  category: 'チェック区分',
  content: 'チェック内容',
  url: '該当カルテ',
};
const COLUMN_KEYS = Object.keys(COLUMNS);

/** "202511" → "2025年11月" */
export function ymLabel(ym) {
  if (!ym) return '';
  return `${ym.slice(0, 4)}年${Number(ym.slice(4, 6))}月`;
}

/** "2025年 12月" などから "202512" を取り出す */
export function parseYm(s) {
  const m = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(s || '');
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}${String(mm).padStart(2, '0')}`;
}

/** ファイル名の _YYYYMMDD_HHMM（または _YYYYMMDD）から出力日時 "YYYY-MM-DDTHH:MM" を取り出す */
export function parseExportedAt(fileName) {
  const m = /(\d{4})(\d{2})(\d{2})(?:_(\d{2})(\d{2}))?(?!\d)/.exec(fileName || '');
  if (!m) return null;
  const time = m[4] ? `${m[4]}:${m[5]}` : '00:00';
  return `${m[1]}-${m[2]}-${m[3]}T${time}`;
}

/** カルテURLから内部IDと日付を取り出す */
export function parseKarteUrl(url) {
  const m = /\/patients\/([^/?#\s]+)\/(\d{8})/.exec(url || '');
  if (!m) return null;
  return { karteId: m[1], ymd: m[2] };
}

/** "M/D" と診療年月から YYYYMMDD を作る（URLに日付がないときの予備） */
function ymdFromDate(date, ym) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec((date || '').trim());
  if (!m || !ym) return '';
  let year = Number(ym.slice(0, 4));
  const month = Number(m[1]);
  // 診療年月が1月で診察日が12月なら前年（念のため）
  if (Number(ym.slice(4, 6)) === 1 && month === 12) year -= 1;
  return `${year}${String(month).padStart(2, '0')}${String(Number(m[2])).padStart(2, '0')}`;
}

/** "00001:山田　一郎" → "山田　一郎" */
export function stripCode(s) {
  const m = /^\s*[0-9A-Za-z]+[:：](.*)$/.exec(s || '');
  return (m ? m[1] : s || '').trim();
}

/** 保険欄を空白で区切り、重複を除いた配列にする */
export function insuranceTokens(s) {
  const out = [];
  for (const t of (s || '').split(/[\s　]+/)) {
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 行の同一性キー（SPEC 4.1） */
export function rowKey(r) {
  return `${r.karteId}|${r.ymd}|${r.category}|${r.content}`;
}

export class ReceiptFormatError extends Error {}

/**
 * CSV の文字列を解析する。
 * 戻り値: { ym, exportedAt, fileName, rows, warnings }
 *   ym はヘッダーの診療年月 → なければURLの日付で最も多い年月 → それでもなければ null
 */
export function parseReceiptCsv(text, fileName = '') {
  const table = parseCsv(text);
  const warnings = [];
  const exportedAt = parseExportedAt(fileName);

  if (table.length === 0) {
    return { ym: null, exportedAt, fileName, rows: [], warnings };
  }

  const header = table[0].map((c) => c.trim());
  if (!header.includes(COLUMNS.patientNo) || !header.includes(COLUMNS.url)) {
    throw new ReceiptFormatError('要確認レセプト一覧のCSVではないようです（「患者番号」「該当カルテ」の列が見つかりません）');
  }

  const idx = {};
  COLUMN_KEYS.forEach((k, i) => {
    const at = header.indexOf(COLUMNS[k]);
    idx[k] = at >= 0 ? at : i;
  });

  let ym = null;
  const metaAt = header.indexOf('診療年月');
  if (metaAt >= 0) ym = parseYm(header[metaAt + 1]);
  if (!ym) ym = parseYm(header.join(' '));

  const rows = [];
  const seen = new Map();
  const ymCount = new Map();

  for (let li = 1; li < table.length; li++) {
    const cells = table[li].map((c) => c.trim());
    const r = {};
    for (const k of COLUMN_KEYS) r[k] = cells[idx[k]] ?? '';
    if (!r.patientNo && !r.url) {
      warnings.push(`${li + 1}行目：患者番号もカルテURLもないため読み飛ばしました`);
      continue;
    }
    const parsedUrl = parseKarteUrl(r.url);
    if (parsedUrl) {
      r.karteId = parsedUrl.karteId;
      r.ymd = parsedUrl.ymd;
      const y = r.ymd.slice(0, 6);
      ymCount.set(y, (ymCount.get(y) || 0) + 1);
    } else {
      r.karteId = `no-${r.patientNo}`;
      r.ymd = '';
      warnings.push(`${li + 1}行目：該当カルテのURLが読み取れません`);
    }
    r.line = li + 1;
    rows.push(r);
  }

  if (!ym && ymCount.size > 0) {
    ym = [...ymCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  for (const r of rows) {
    if (!r.ymd) r.ymd = ymdFromDate(r.date, ym);
    r.doctorName = stripCode(r.doctor);
    r.deptName = stripCode(r.dept);
    r.insuranceList = insuranceTokens(r.insurance);
    let key = rowKey(r);
    const dup = seen.get(key) || 0;
    seen.set(key, dup + 1);
    if (dup > 0) key = `${key}#${dup + 1}`;
    r.key = key;
  }

  return { ym, exportedAt, fileName, rows, warnings };
}

/**
 * 「公費(負担者番号なし) 受給者番号が登録されていません。」の行か。
 * 負担者番号が入っている行（「公費21XXXXXX 受給者番号が…」）は対象外。
 */
export function isNoPayerNumber(r) {
  return /^公費\s*[(（]\s*負担者番号なし\s*[)）]/.test((r.content || '').trim());
}

/** 患者番号の数値比較（桁数が違っても数値順） */
export function comparePatientNo(a, b) {
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}
