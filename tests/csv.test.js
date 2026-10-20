import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, parseCSV, parseImport, planImport, csvFilename, CSV_COLUMNS, CSV_COLUMNS_V1 } from '../js/csv.js';
import { TYPES, CATS, PLACES, entry } from './fixtures.js';

const MASTERS = { types: TYPES, placeCategories: CATS, places: PLACES };
// 既存のテストは旧形式(9 列)の行で書いている。新形式は末尾の「豆の袋の列」で検証する
const HEADER = CSV_COLUMNS_V1.join(',');

function idGen() {
  let n = 0;
  return () => `new${(n += 1)}`;
}

describe('toCSV', () => {
  test('BOM 付き・CRLF・表示名で出力、店なしは空欄', () => {
    const csv = toCSV(
      [entry('2026-10-01', 'drip', 120, 'conv', 'seven', { id: 'a' }), entry('2026-10-02', 'drip', 0, 'home', null, { id: 'b' })],
      MASTERS,
    );
    assert.ok(csv.startsWith('﻿'));
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines[0], CSV_COLUMNS.join(','));
    assert.match(lines[1], /^a,2026-10-01,120,ドリップ,コンビニ,セブン,,/);
    assert.match(lines[2], /^b,2026-10-02,0,ドリップ,自宅,,,/);
    assert.equal(lines[3], '');
    assert.ok(!/(^|[^\r])\n/.test(csv), 'LF 単独の改行が無い');
  });
  test('ファイル名', () => {
    assert.equal(csvFilename('2026-10-12'), 'coffee-log_20261012.csv');
  });
});

describe('往復(出力 → 入力で一致)', () => {
  test('カンマ・改行・ダブルクォートを含むメモ', () => {
    const notes = ['甘め, 氷少なめ', '1行目\r\n2行目', '1行目\n2行目', '"限定"の豆', '""', 'カンマ,と"引用"と\n改行'];
    const entries = notes.map((note, i) => entry(`2026-10-0${i + 1}`, 'latte', 180 + i, 'conv', 'famima', { id: `n${i}`, note }));
    const csv = toCSV(entries, MASTERS);
    const parsed = parseImport(csv);
    assert.equal(parsed.fatal, null);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(
      parsed.rows.map((r) => r.note),
      notes,
    );
    const plan = planImport(parsed, [], MASTERS, idGen());
    const strip = ({ id, date, amount, typeId, placeCategoryId, placeId, note, createdAt, updatedAt }) => ({
      id,
      date,
      amount,
      typeId,
      placeCategoryId,
      placeId,
      note,
      createdAt,
      updatedAt,
    });
    assert.deepEqual(plan.toAdd.map(strip), entries.map(strip));
    assert.deepEqual(plan.newTypes, []);
    assert.deepEqual(plan.newPlaces, []);
  });
});

describe('BOM 付き / なし の読み込み', () => {
  const body = `${HEADER}\r\nx1,2026-10-01,120,ドリップ,コンビニ,セブン,,2026-10-01T00:00:00.000Z,2026-10-01T00:00:00.000Z\r\n`;
  test('BOM 付き', () => {
    const r = parseImport(`﻿${body}`);
    assert.equal(r.fatal, null);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].id, 'x1');
  });
  test('BOM なし・LF 改行', () => {
    const r = parseImport(body.replace(/\r\n/g, '\n'));
    assert.equal(r.fatal, null);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].type, 'ドリップ');
  });
  test('最終行に改行が無くても読める', () => {
    assert.equal(parseCSV('a,b\r\n1,2').length, 2);
  });
});

describe('不正行のスキップと報告', () => {
  const ok = (id, date = '2026-10-01', amount = '120') =>
    `${id},${date},${amount},ドリップ,コンビニ,セブン,,2026-10-01T00:00:00.000Z,2026-10-01T00:00:00.000Z`;
  const csv = [
    HEADER,
    ok('r1'),
    ok('r2', '2026/10/01'),
    ok('r3', '2026-02-30'),
    ok('r4', '2026-10-01', '12.5'),
    ok('r5', '2026-10-01', '-100'),
    ok('r6', '2026-10-01', ''),
    'r7,2026-10-01,100,ドリップ', // 列数不足
    ',2026-10-01,100,ドリップ,,,,2026-10-01T00:00:00.000Z,2026-10-01T00:00:00.000Z', // id 空
    'r9,2026-10-01,100,,,,,2026-10-01T00:00:00.000Z,2026-10-01T00:00:00.000Z', // 種類空
    'r10,2026-10-01,100,ドリップ,,セブン,,2026-10-01T00:00:00.000Z,2026-10-01T00:00:00.000Z', // 区分なしで店
    `r11,2026-10-01,100,ドリップ,,,${'あ'.repeat(101)},2026-10-01T00:00:00.000Z,2026-10-01T00:00:00.000Z`,
    'r12,2026-10-01,100,ドリップ,,,,不正,2026-10-01T00:00:00.000Z',
    ok('r13', '2026-10-01', '0'),
  ].join('\r\n');

  test('正しい行だけ取り込み、不正行は行番号付きで報告', () => {
    const r = parseImport(csv);
    assert.equal(r.fatal, null);
    assert.deepEqual(
      r.rows.map((x) => x.id),
      ['r1', 'r13'],
    );
    assert.deepEqual(
      r.errors.map((e) => e.line),
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    );
    assert.ok(r.errors.every((e) => typeof e.message === 'string' && e.message.length > 0));
  });
  test('メモ内の改行があっても行番号はファイル上の開始行', () => {
    const text = `${HEADER}\r\nm1,2026-10-01,1,ドリップ,,,"a\r\nb",2026-10-01T00:00:00.000Z,2026-10-01T00:00:00.000Z\r\nm2,bad,1,ドリップ,,,,2026-10-01T00:00:00.000Z,2026-10-01T00:00:00.000Z`;
    const r = parseImport(text);
    assert.deepEqual(r.errors, [{ line: 4, message: '日付の形式が不正です(bad)' }]);
  });
  test('見出し行が違えば全体を拒否', () => {
    const r = parseImport('id,date,amount\r\n1,2026-10-01,100');
    assert.ok(r.fatal);
    assert.equal(r.rows.length, 0);
    assert.ok(parseImport('').fatal);
  });
});

describe('planImport: id マージとマスタ照合', () => {
  const t1 = '2026-10-01T00:00:00.000Z';
  const t2 = '2026-10-02T00:00:00.000Z';
  const row = (id, updatedAt, type = 'ドリップ', cat = 'コンビニ', place = 'セブン', amount = 120) =>
    `${id},2026-10-01,${amount},${type},${cat},${place},,${t1},${updatedAt}`;

  test('既存 id は updatedAt が新しい方、新規 id は追加', () => {
    const existing = [
      { ...entry('2026-10-01', 'drip', 100, 'conv', 'seven'), id: 'same', updatedAt: t1 },
      { ...entry('2026-10-01', 'drip', 100, 'conv', 'seven'), id: 'newer', updatedAt: t2 },
      { ...entry('2026-10-01', 'drip', 100, 'conv', 'seven'), id: 'older', updatedAt: t1 },
    ];
    const text = [HEADER, row('same', t1), row('newer', t1), row('older', t2), row('fresh', t1)].join('\r\n');
    const plan = planImport(parseImport(text), existing, MASTERS, idGen());
    assert.deepEqual(
      plan.toAdd.map((e) => e.id),
      ['fresh'],
    );
    assert.deepEqual(
      plan.toUpdate.map((e) => [e.id, e.amount]),
      [['older', 120]],
    );
    assert.equal(plan.unchanged, 2);
  });
  test('ファイル内の重複 id は updatedAt が新しい方', () => {
    const text = [HEADER, row('d', t2, 'ドリップ', 'コンビニ', 'セブン', 200), row('d', t1, 'ドリップ', 'コンビニ', 'セブン', 100)].join('\n');
    const plan = planImport(parseImport(text), [], MASTERS, idGen());
    assert.deepEqual(
      plan.toAdd.map((e) => e.amount),
      [200],
    );
  });
  test('名前を正規化して照合し、無ければ新規作成(店は区分内で照合)', () => {
    const text = [
      HEADER,
      row('a', t1, ' ﾄﾞﾘｯﾌﾟ', 'コンビニ', 'ｾﾌﾞﾝ'),
      row('b', t1, 'コールドブリュー', 'カフェ', 'ブルーボトル'),
      row('c', t1, 'コールドブリュー', '職場', ''),
      row('d', t1, 'ドリップ', '駅ナカ', 'スタンドA'),
      row('e', t1, 'ドリップ', '駅ナカ', ''),
      row('f', t1, 'ドリップ', 'カフェ', 'セブン'),
    ].join('\r\n');
    const plan = planImport(parseImport(text), [], MASTERS, idGen());
    const byId = Object.fromEntries(plan.toAdd.map((e) => [e.id, e]));
    assert.equal(byId.a.typeId, 'drip');
    assert.equal(byId.a.placeId, 'seven');
    // 新規の種類は杯数に数える
    assert.deepEqual(
      plan.newTypes.map((t) => [t.name, t.countsAsCup]),
      [['コールドブリュー', true]],
    );
    assert.equal(byId.b.typeId, plan.newTypes[0].id);
    assert.equal(byId.c.typeId, plan.newTypes[0].id);
    // 新規区分: 店のある行があれば hasStores=true
    assert.deepEqual(
      plan.newPlaceCategories.map((c) => [c.name, c.hasStores]),
      [
        ['職場', false],
        ['駅ナカ', true],
      ],
    );
    assert.equal(byId.e.placeId, null);
    // 「セブン」はカフェ区分内には無いので新規作成
    assert.deepEqual(
      plan.newPlaces.map((p) => [p.categoryId, p.name]),
      [
        ['cafe', 'ブルーボトル'],
        [plan.newPlaceCategories[1].id, 'スタンドA'],
        ['cafe', 'セブン'],
      ],
    );
  });
});

describe('豆の袋の列(1.4〜)', () => {
  const BEANS = [{ id: 'b1', name: 'エチオピア', order: 0, archived: false }];
  test('袋と杯の往復(豆名・予定杯数・使い切り日・袋ID)', () => {
    const bag = entry('2026-10-01', 'beans', 1600, 'cafe', null, { id: 'bag1', beanId: 'b1', plannedCups: 16, closedAt: '2026-10-20' });
    const cup = entry('2026-10-02', 'drip', 0, 'home', null, { id: 'cup1', bagId: 'bag1' });
    const csv = toCSV([bag, cup], { ...MASTERS, beans: BEANS });
    assert.equal(csv.slice(1).split('\r\n')[0], CSV_COLUMNS.join(','));
    const plan = planImport(parseImport(csv), [], { ...MASTERS, beans: BEANS }, idGen());
    const byId = Object.fromEntries(plan.toAdd.map((e) => [e.id, e]));
    assert.equal(byId.bag1.beanId, 'b1');
    assert.equal(byId.bag1.plannedCups, 16);
    assert.equal(byId.bag1.closedAt, '2026-10-20');
    assert.equal(byId.cup1.bagId, 'bag1');
    assert.ok(!('beanId' in byId.cup1));
    assert.deepEqual(plan.newBeans, []);
  });
  test('未知の豆名は新規作成、旧形式(9列)のファイルも読める', () => {
    const t = '2026-10-01T00:00:00.000Z';
    const csv = [CSV_COLUMNS.join(','), `x,2026-10-01,1200,豆購入,カフェ,,,${t},${t},ケニア,12,,`].join('\r\n');
    const plan = planImport(parseImport(csv), [], { ...MASTERS, beans: BEANS }, idGen());
    assert.deepEqual(plan.newBeans.map((b) => b.name), ['ケニア']);
    assert.equal(plan.toAdd[0].beanId, plan.newBeans[0].id);
    const old = [CSV_COLUMNS_V1.join(','), `y,2026-10-01,120,ドリップ,自宅,,,${t},${t}`].join('\r\n');
    const r = parseImport(old);
    assert.equal(r.fatal, null);
    assert.equal(r.rows.length, 1);
  });
  test('予定杯数・使い切り日の不正はエラー行', () => {
    const t = '2026-10-01T00:00:00.000Z';
    const csv = [CSV_COLUMNS.join(','), `a,2026-10-01,1,豆購入,,,,${t},${t},A,0,,`, `b,2026-10-01,1,豆購入,,,,${t},${t},A,3,2026/10/2,`].join('\r\n');
    assert.deepEqual(parseImport(csv).errors.map((e) => e.line), [2, 3]);
  });
});
