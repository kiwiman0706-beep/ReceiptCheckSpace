// パスワード付き ZIP の読み込み（samples/zip/ は tools/make_test_zips.py で作成。パスワードは test-pass）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCsvFiles, needsPassword, ZipPasswordError, ZipError } from '../extension/lib/zip.js';
import { decodeBytes } from '../extension/lib/csv.js';
import { parseReceiptCsv } from '../extension/lib/receipt.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const zip = (name) => new Uint8Array(readFileSync(join(root, 'zip', name)));
const original = new Uint8Array(readFileSync(join(root, 'original_anon', '要確認レセプト一覧_20260108_0947.csv')));
const CSV_NAME = '要確認レセプト一覧_20260108_0947.csv';

for (const name of ['zipcrypto_sjis.zip', 'aes256_utf8.zip']) {
  test(`${name}：正しいパスワードで元の CSV が取り出せる`, async () => {
    const buf = zip(name);
    assert.equal(needsPassword(buf), true);
    const files = await extractCsvFiles(buf, 'test-pass');
    assert.equal(files.length, 1);
    assert.equal(files[0].name, CSV_NAME);
    assert.deepEqual(files[0].bytes, original);
    const parsed = parseReceiptCsv(decodeBytes(files[0].bytes), files[0].name);
    assert.equal(parsed.rows.length, 55);
    assert.equal(parsed.exportedAt, '2026-01-08T09:47');
  });

  test(`${name}：パスワード違い・なしはパスワードエラー`, async () => {
    const buf = zip(name);
    await assert.rejects(extractCsvFiles(buf, 'wrong'), ZipPasswordError);
    await assert.rejects(extractCsvFiles(buf, ''), ZipPasswordError);
    await assert.rejects(extractCsvFiles(buf, undefined), ZipPasswordError);
  });
}

test('パスワードなしの ZIP', async () => {
  const buf = zip('plain.zip');
  assert.equal(needsPassword(buf), false);
  const files = await extractCsvFiles(buf);
  assert.deepEqual(files[0].bytes, original);
});

test('ZIP でないファイル', async () => {
  await assert.rejects(extractCsvFiles(original, 'x'), ZipError);
});
