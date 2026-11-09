// 一括で済・自動で済
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBytes } from '../extension/lib/csv.js';
import { parseReceiptCsv } from '../extension/lib/receipt.js';
import { applyReload, summaryText } from '../extension/lib/diff.js';
import { DEFAULT_RULES, matchesText, applyAutoDone } from '../extension/lib/bulk.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const load = (rel) => parseReceiptCsv(decodeBytes(readFileSync(join(root, rel))), rel.split('/').pop());
const anon = `original_anon/${readdirSync(join(root, 'original_anon')).find((f) => f.endsWith('.csv'))}`;
const noPayer = DEFAULT_RULES[0];

test('負担者番号なしの条件：負担者番号がある行・適応症は対象外', () => {
  assert.equal(matchesText({ content: '公費(負担者番号なし) 受給者番号が登録されていません。' }, noPayer.text), true);
  assert.equal(matchesText({ content: '公費（負担者番号なし） 受給者番号が登録されていません。' }, noPayer.text), true);
  assert.equal(matchesText({ content: '公費21999999 受給者番号が登録されていません。' }, noPayer.text), false);
  assert.equal(matchesText({ content: 'デパケンＲ錠１００ｍｇ：適応症がついていません。' }, noPayer.text), false);
  // 全角・半角を区別しない
  assert.equal(matchesText({ content: 'デパケンＲ錠１００ｍｇ：適応症がついていません。' }, 'デパケンR錠100mg'), true);
  assert.equal(matchesText({ content: 'x', insurance: '生活保護（12）' }, '生活保護'), true);
  assert.equal(matchesText({ content: 'x' }, '  '), false);
  const rows = load(anon).rows;
  assert.equal(rows.filter((r) => matchesText(r, noPayer.text)).length, 33);
});

test('自動で済：初回は条件に合う行が済になる', () => {
  const { record, summary } = applyReload(null, load(anon), '202512', 1);
  assert.equal(applyAutoDone(record, summary, DEFAULT_RULES), 33);
  assert.equal(Object.keys(record.done).length, 33);
  assert.match(summaryText(summary), /自動で済 33件/);
  // auto でない条件は当てない
  const { record: r2 } = applyReload(null, load(anon), '202512', 1);
  assert.equal(applyAutoDone(r2, null, [{ ...noPayer, auto: false }]), 0);
});

test('自動で済：前回済で今回も残った行を「要再確認」にしない', () => {
  const r1 = load('round1_20251205_1012.csv');
  const r2 = load('round2_20251206_0915.csv');
  const { record: rec1 } = applyReload(null, r1, '202511', 1);
  applyAutoDone(rec1, null, DEFAULT_RULES);
  const { record: rec2, summary } = applyReload(rec1, r2, '202511', 2);
  const before = summary.recheck;
  assert.ok(before > 0, 'round2 にも負担者番号なしの行が残っている');
  applyAutoDone(rec2, summary, DEFAULT_RULES);
  assert.equal(summary.recheck, 0);
  assert.equal(rec2.rows.filter((r) => r.status === 'recheck').length, 0);
  for (const r of rec2.rows) if (matchesText(r, noPayer.text)) assert.equal(rec2.done[r.key], true);
});
