// ロジック部分のテスト（SPEC 7章の受け入れ条件のうち、画面なしで確認できるもの）
// 実行: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBytes, parseCsv } from '../extension/lib/csv.js';
import { parseReceiptCsv, comparePatientNo, parseExportedAt } from '../extension/lib/receipt.js';
import { applyReload, summaryText, isSameList, isOlderThan } from '../extension/lib/diff.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const load = (rel) => {
  const name = rel.split('/').pop();
  return parseReceiptCsv(decodeBytes(readFileSync(join(root, rel))), name);
};
const anonDir = 'original_anon';
const anonCsv = readdirSync(join(root, anonDir)).find((f) => f.endsWith('.csv'));

test('CSV パーサ：クォート・CRLF・空行・列数違い', () => {
  const rows = parseCsv('a,"b,c","d""e"\r\n\r\n1,2\n"x\ny",z\r\n');
  assert.deepEqual(rows, [['a', 'b,c', 'd"e'], ['1', '2'], ['x\ny', 'z']]);
  assert.deepEqual(parseCsv(''), []);
});

test('round1：108行・診療年月 2025年11月', () => {
  const p = load('round1_20251205_1012.csv');
  assert.equal(p.rows.length, 108);
  assert.equal(p.ym, '202511');
  assert.equal(p.exportedAt, '2025-12-05T10:12');
  assert.equal(new Set(p.rows.map((r) => r.key)).size, 108);
});

test('患者番号は数値順（16033 が 121146 より前）', () => {
  const p = load('round1_20251205_1012.csv');
  const nos = [...new Set(p.rows.map((r) => r.patientNo))].sort(comparePatientNo);
  assert.ok(nos.indexOf('16033') < nos.indexOf('121146'));
});

test('URL から内部IDと日付を取る', () => {
  const p = load('round1_20251205_1012.csv');
  const r = p.rows[0];
  assert.equal(r.url, `https://digikar.jp/#/karte/patients/${r.karteId}/${r.ymd}`);
  assert.match(r.ymd, /^202511\d\d$/);
});

test('round1 → round2：解消86／継続22／新規1、要再確認', () => {
  const r1 = load('round1_20251205_1012.csv');
  const r2 = load('round2_20251206_0915.csv');
  const { record: rec1 } = applyReload(null, r1, '202511', 1);
  // round2 にも残る行のうち 3 行と、解消する行 2 行を済にしておく
  const r2keys = new Set(r2.rows.map((r) => r.key));
  const staying = rec1.rows.filter((r) => r2keys.has(r.key)).slice(0, 3);
  const leaving = rec1.rows.filter((r) => !r2keys.has(r.key)).slice(0, 2);
  for (const r of [...staying, ...leaving]) rec1.done[r.key] = true;
  rec1.memos[staying[0].karteId] = 'テストメモ';

  const { record: rec2, summary } = applyReload(rec1, r2, '202511', 2);
  assert.equal(rec2.rows.length, 23);
  assert.equal(summary.resolved, 86);
  assert.equal(summary.cont, 22);
  assert.equal(summary.added, 1);
  assert.equal(summary.recheck, 3);
  assert.equal(rec2.rows.find((r) => r.status === 'new').patientNo, '400001');
  for (const r of staying) assert.equal(rec2.rows.find((x) => x.key === r.key).status, 'recheck');
  assert.deepEqual(rec2.done, {});
  assert.equal(rec2.memos[staying[0].karteId], 'テストメモ');
  assert.equal(summaryText(summary), '前回 108件 → 今回 23件（解消 86／継続 22／新規 1）。済にしたのに残っている行：3件');

  // round3（ヘッダーのみ）→ すべて解消
  const r3 = load('round3_20251206_1420.csv');
  assert.equal(r3.ym, '202511');
  assert.equal(r3.rows.length, 0);
  const { record: rec3, summary: s3 } = applyReload(rec2, r3, '202511', 3);
  assert.equal(rec3.rows.length, 0);
  assert.equal(s3.resolved, 23);
  assert.equal(rec3.history.length, 3);
});

test('同じファイルの読み直し・古いファイルの判定', () => {
  const r1 = load('round1_20251205_1012.csv');
  const r2 = load('round2_20251206_0915.csv');
  const { record } = applyReload(null, r2, '202511', 1);
  assert.equal(isSameList(record, load('round2_20251206_0915.csv')), true);
  assert.equal(isSameList(record, r1), false);
  assert.equal(isOlderThan(record, r1), true);
});

test('original_anon：55行・40人・2025年12月・全角英字の氏名', () => {
  const p = load(`${anonDir}/${anonCsv}`);
  assert.equal(p.rows.length, 55);
  assert.equal(new Set(p.rows.map((r) => r.karteId)).size, 40);
  assert.equal(p.ym, '202512');
  assert.ok(p.rows.some((r) => r.name === 'ＳＡＭＰＬＥ　ＪＯＨＮ　ＤＯＥ'));
  assert.equal(new Set(p.rows.map((r) => r.url)).size, 49);
  assert.equal(p.exportedAt, '2026-01-08T09:47');
});

test('空のファイル・UTF-8 のファイル', () => {
  const empty = parseReceiptCsv(decodeBytes(new Uint8Array()), 'x.csv');
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.ym, null);
  const utf8 = new TextEncoder().encode('﻿患者番号,患者氏名,診察日,診療科,医師,保険,チェック区分,チェック内容,該当カルテ\r\n1,テスト,1/5,,,,公費,x,https://digikar.jp/#/karte/patients/1/20250105\r\n');
  const p = parseReceiptCsv(decodeBytes(utf8), 'y.csv');
  assert.equal(p.ym, '202501');
  assert.equal(p.rows[0].name, 'テスト');
  assert.throws(() => parseReceiptCsv('a,b\n1,2', 'z.csv'));
  assert.equal(parseExportedAt('要確認レセプト一覧_20260108.pdf'), '2026-01-08T00:00');
});

test('負担者番号なしの判定（負担者番号がある行は対象外）', async () => {
  const { isNoPayerNumber } = await import('../extension/lib/receipt.js');
  assert.equal(isNoPayerNumber({ content: '公費(負担者番号なし) 受給者番号が登録されていません。' }), true);
  assert.equal(isNoPayerNumber({ content: '公費（負担者番号なし） 受給者番号が登録されていません。' }), true);
  assert.equal(isNoPayerNumber({ content: '公費21999999 受給者番号が登録されていません。' }), false);
  assert.equal(isNoPayerNumber({ content: 'デパケンＲ錠１００ｍｇ：適応症がついていません。' }), false);
  const p = load(`${anonDir}/${anonCsv}`);
  const hidden = p.rows.filter(isNoPayerNumber);
  assert.ok(hidden.length > 0);
  assert.ok(p.rows.some((r) => r.category === '公費' && !isNoPayerNumber(r)), '負担者番号ありの公費行は残る');
});
