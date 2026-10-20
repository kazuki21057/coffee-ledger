import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  periodRange,
  shiftPeriod,
  summarize,
  periodComparison,
  compareSeries,
  quickPresets,
  lastAmountFor,
  storeOrder,
  isValidDate,
  normalizeName,
  findPlaceByName,
  filterEntries,
  groupByDate,
  lastCreated,
  needsBackupReminder,
  elapsedDays,
  perDayAmount,
} from '../js/aggregate.js';
import { TYPES, PLACES, entry } from './fixtures.js';

describe('periodRange: 週・月・年の境界', () => {
  test('月末(30日・31日)', () => {
    assert.deepEqual(periodRange('month', '2026-04-15'), { start: '2026-04-01', end: '2026-04-30' });
    assert.deepEqual(periodRange('month', '2026-12-31'), { start: '2026-12-01', end: '2026-12-31' });
  });
  test('うるう年の 2 月は 29 日まで、平年は 28 日まで', () => {
    assert.deepEqual(periodRange('month', '2028-02-29'), { start: '2028-02-01', end: '2028-02-29' });
    assert.deepEqual(periodRange('month', '2027-02-10'), { start: '2027-02-01', end: '2027-02-28' });
    assert.deepEqual(periodRange('month', '2100-02-01'), { start: '2100-02-01', end: '2100-02-28' });
  });
  test('年は暦年', () => {
    assert.deepEqual(periodRange('year', '2026-12-31'), { start: '2026-01-01', end: '2026-12-31' });
  });
  test('週: 月曜始まり(既定)で年をまたぐ', () => {
    // 2026-01-01 は木曜
    assert.deepEqual(periodRange('week', '2026-01-01'), { start: '2025-12-29', end: '2026-01-04' });
    // 月曜当日・日曜当日
    assert.deepEqual(periodRange('week', '2025-12-29', 1), { start: '2025-12-29', end: '2026-01-04' });
    assert.deepEqual(periodRange('week', '2026-01-04', 1), { start: '2025-12-29', end: '2026-01-04' });
  });
  test('週: 日曜始まり・土曜始まりで結果が変わる', () => {
    assert.deepEqual(periodRange('week', '2026-01-01', 0), { start: '2025-12-28', end: '2026-01-03' });
    assert.deepEqual(periodRange('week', '2026-01-01', 6), { start: '2025-12-27', end: '2026-01-02' });
    // 日曜当日は日曜始まりなら週頭、月曜始まりなら週末
    assert.equal(periodRange('week', '2026-01-04', 0).start, '2026-01-04');
    assert.equal(periodRange('week', '2026-01-04', 1).end, '2026-01-04');
  });
  test('週: うるう日をまたぐ', () => {
    // 2028-02-29 は火曜
    assert.deepEqual(periodRange('week', '2028-02-29'), { start: '2028-02-28', end: '2028-03-05' });
  });
  test('shiftPeriod: 月末から前後の月へ', () => {
    assert.equal(shiftPeriod('month', '2026-03-31', -1), '2026-02-01');
    assert.equal(shiftPeriod('month', '2026-01-15', -1), '2025-12-01');
    assert.equal(shiftPeriod('month', '2026-12-15', 1), '2027-01-01');
    assert.equal(shiftPeriod('year', '2026-06-01', -2), '2024-01-01');
    assert.equal(shiftPeriod('week', '2026-01-01', -1), '2025-12-22');
  });
  test('isValidDate', () => {
    assert.equal(isValidDate('2028-02-29'), true);
    assert.equal(isValidDate('2027-02-29'), false);
    assert.equal(isValidDate('2026/01/01'), false);
    assert.equal(isValidDate('2026-1-1'), false);
  });
});

describe('summarize', () => {
  const entries = [
    entry('2026-10-01', 'drip', 120, 'conv', 'seven'),
    entry('2026-10-02', 'latte', 180, 'conv', 'famima'),
    entry('2026-10-03', 'drip', 0, 'home'),
    entry('2026-10-04', 'beans', 1500, 'cafe', null),
    entry('2026-10-05', 'can', 130),
    entry('2026-10-06', 'drip', 120, 'conv', null),
    entry('2026-09-30', 'drip', 999, 'conv', 'seven'), // 範囲外
  ];
  const s = summarize(entries, TYPES, periodRange('month', '2026-10-10'));

  test('合計・件数', () => {
    assert.equal(s.total, 120 + 180 + 0 + 1500 + 130 + 120);
    assert.equal(s.count, 6);
  });
  test('豆購入は杯数・平均単価から除外され、合計には含まれる', () => {
    assert.equal(s.cups, 5);
    assert.equal(s.avgPerCup, (120 + 180 + 0 + 130 + 120) / 5);
  });
  test('杯数 0 のとき平均は null', () => {
    const only = summarize([entry('2026-10-01', 'beans', 2000)], TYPES, periodRange('month', '2026-10-01'));
    assert.equal(only.cups, 0);
    assert.equal(only.avgPerCup, null);
    assert.equal(only.total, 2000);
  });
  test('種類別: 金額降順・構成比', () => {
    assert.deepEqual(
      s.byType.map((t) => [t.typeId, t.amount, t.count]),
      [
        ['beans', 1500, 1],
        ['drip', 240, 3],
        ['latte', 180, 1],
        ['can', 130, 1],
      ],
    );
    const ratioSum = s.byType.reduce((a, t) => a + t.ratio, 0);
    assert.ok(Math.abs(ratioSum - 1) < 1e-9);
  });
  test('区分別: 場所未指定は null として集計', () => {
    assert.deepEqual(
      s.byPlaceCategory.map((c) => [c.placeCategoryId, c.amount, c.count]),
      [
        ['cafe', 1500, 1],
        ['conv', 420, 3],
        [null, 130, 1],
        ['home', 0, 1],
      ],
    );
  });
  test('店別: 区分ごと、店未指定は placeId=null', () => {
    assert.deepEqual(
      s.byPlace.conv.map((p) => [p.placeId, p.amount]),
      [
        ['famima', 180],
        ['seven', 120],
        [null, 120],
      ],
    );
    assert.deepEqual(s.byPlace.cafe, [{ placeId: null, amount: 1500, count: 1 }]);
    assert.ok(!('null' in s.byPlace));
  });
  test('記録が無い期間', () => {
    const empty = summarize(entries, TYPES, periodRange('month', '2025-01-01'));
    assert.equal(empty.total, 0);
    assert.equal(empty.cups, 0);
    assert.equal(empty.avgPerCup, null);
    assert.deepEqual(empty.byType, []);
  });
});

describe('1日あたり金額(経過日数で割る)', () => {
  test('今日を含む期間は開始日〜今日の日数', () => {
    assert.equal(elapsedDays(periodRange('month', '2026-10-20'), '2026-10-20'), 20);
    assert.equal(elapsedDays(periodRange('month', '2026-10-01'), '2026-10-01'), 1);
    // 月曜始まりの週で水曜なら 3 日
    assert.equal(elapsedDays(periodRange('week', '2026-10-21', 1), '2026-10-21'), 3);
    assert.equal(elapsedDays(periodRange('year', '2026-10-20'), '2026-10-20'), 293);
  });
  test('過去の期間は全日数(うるう年の 2 月・年を含む)', () => {
    assert.equal(elapsedDays(periodRange('month', '2028-02-10'), '2028-03-05'), 29);
    assert.equal(elapsedDays(periodRange('month', '2027-02-10'), '2027-03-05'), 28);
    assert.equal(elapsedDays(periodRange('week', '2026-10-01', 0), '2026-10-20'), 7);
    assert.equal(elapsedDays(periodRange('year', '2028-06-01'), '2029-01-01'), 366);
  });
  test('未来の期間は 0 日で、平均は null', () => {
    const d = elapsedDays(periodRange('month', '2026-11-05'), '2026-10-20');
    assert.equal(d, 0);
    assert.equal(perDayAmount(1000, d), null);
  });
  test('合計 ÷ 日数', () => {
    assert.equal(perDayAmount(3100, 31), 100);
    assert.equal(perDayAmount(0, 5), 0);
  });
});

describe('periodComparison', () => {
  test('前期間 0 円のときは率なし(null)、差額は表示できる', () => {
    assert.deepEqual(periodComparison(1200, 0), { diff: 1200, rate: null });
    assert.deepEqual(periodComparison(0, 0), { diff: 0, rate: null });
  });
  test('通常の増減', () => {
    assert.deepEqual(periodComparison(1500, 1000), { diff: 500, rate: 0.5 });
    assert.deepEqual(periodComparison(500, 1000), { diff: -500, rate: -0.5 });
  });
});

describe('compareSeries', () => {
  test('直近 n 期間を古い順に、種類別に合計する', () => {
    const entries = [
      entry('2026-08-15', 'drip', 100),
      entry('2026-10-01', 'drip', 120),
      entry('2026-10-31', 'latte', 200),
      entry('2026-11-01', 'drip', 999), // 範囲外(未来)
      entry('2026-07-31', 'drip', 999), // 範囲外(過去)
    ];
    const s = compareSeries(entries, TYPES, 'month', '2026-10-10', 3);
    assert.deepEqual(
      s.map((p) => [p.start, p.end, p.total]),
      [
        ['2026-08-01', '2026-08-31', 100],
        ['2026-09-01', '2026-09-30', 0],
        ['2026-10-01', '2026-10-31', 320],
      ],
    );
    assert.deepEqual(s[2].byType, { drip: 120, latte: 200 });
  });
  test('週単位は週開始曜日に従う', () => {
    const s = compareSeries([entry('2026-01-04', 'drip', 100)], TYPES, 'week', '2026-01-05', 2, 0);
    // 日曜始まり: 2026-01-04(日)は 01-04〜01-10 の週
    assert.equal(s[1].start, '2026-01-04');
    assert.equal(s[1].total, 100);
    const m = compareSeries([entry('2026-01-04', 'drip', 100)], TYPES, 'week', '2026-01-05', 2, 1);
    // 月曜始まり: 2026-01-04(日)は前の週
    assert.equal(m[0].total, 100);
    assert.equal(m[1].total, 0);
  });
  test('年単位 5 期間', () => {
    const s = compareSeries([], TYPES, 'year', '2026-05-05', 5);
    assert.deepEqual(
      s.map((p) => p.start),
      ['2022-01-01', '2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01'],
    );
  });
});

describe('quickPresets: 順位付け', () => {
  const today = '2026-10-12';
  const entries = [
    // 組み合わせ A: ドリップ|コンビニ・セブン|120 を 3 回
    entry('2026-10-01', 'drip', 120, 'conv', 'seven'),
    entry('2026-10-05', 'drip', 120, 'conv', 'seven'),
    entry('2026-10-08', 'drip', 120, 'conv', 'seven'),
    // 組み合わせ B: ドリップ|自宅|0 を 2 回(最新は 10-10)
    entry('2026-09-20', 'drip', 0, 'home'),
    entry('2026-10-10', 'drip', 0, 'home'),
    // 組み合わせ C: ラテ|コンビニ・ファミマ|180 を 2 回(最新は 10-11) → 同率なら B より上
    entry('2026-09-01', 'latte', 180, 'conv', 'famima'),
    entry('2026-10-11', 'latte', 180, 'conv', 'famima'),
    // 組み合わせ D: 期間外(90日より前)に 5 回 → 頻度 0 扱いで後ろ
    ...[1, 2, 3, 4, 5].map((d) => entry(`2026-01-0${d}`, 'can', 130, 'vending')),
    // 同じ種類・店でも金額が違えば別の組み合わせ
    entry('2026-10-09', 'drip', 150, 'conv', 'seven'),
  ];

  test('直近90日の頻度順、同率なら新しい順、期間外は後ろ', () => {
    const p = quickPresets(entries, today);
    assert.deepEqual(
      p.map((x) => `${x.typeId}|${x.placeCategoryId}|${x.placeId}|${x.amount}|${x.count}`),
      [
        'drip|conv|seven|120|3',
        'latte|conv|famima|180|2',
        'drip|home|null|0|2',
        'drip|conv|seven|150|1',
        'can|vending|null|130|0',
      ],
    );
  });
  test('最大件数で打ち切る', () => {
    assert.equal(quickPresets(entries, today, 2).length, 2);
  });
  test('ウィンドウ境界: 90日目は含み、91日前は含まない', () => {
    const e = [entry('2026-07-15', 'drip', 100), entry('2026-07-14', 'latte', 100)];
    // 2026-10-12 の 89 日前 = 2026-07-15
    const p = quickPresets(e, today);
    assert.equal(p.find((x) => x.typeId === 'drip').count, 1);
    assert.equal(p.find((x) => x.typeId === 'latte').count, 0);
  });
  test('未来日付の記録は候補にしない、除外判定で非表示を除く', () => {
    const e = [entry('2026-10-20', 'drip', 100), entry('2026-10-01', 'latte', 100), entry('2026-10-01', 'can', 100)];
    const p = quickPresets(e, today, 6, 90, (x) => x.typeId !== 'can');
    assert.deepEqual(
      p.map((x) => x.typeId),
      ['latte'],
    );
  });
});

describe('lastAmountFor: 店優先 → 区分フォールバック', () => {
  const entries = [
    entry('2026-10-01', 'drip', 120, 'conv', 'seven'),
    entry('2026-10-05', 'drip', 110, 'conv', 'famima'),
    entry('2026-10-03', 'drip', 100, 'conv', null),
    entry('2026-10-04', 'latte', 200, 'conv', 'seven'),
  ];
  test('店が一致する記録があれば、より新しい区分一致より優先', () => {
    assert.equal(lastAmountFor(entries, 'drip', 'conv', 'seven'), 120);
  });
  test('店が一致する記録が無ければ区分一致の最新', () => {
    assert.equal(lastAmountFor(entries, 'drip', 'conv', 'lawson'), 110);
  });
  test('店未選択なら区分一致の最新', () => {
    assert.equal(lastAmountFor(entries, 'drip', 'conv', null), 110);
  });
  test('区分も一致しなければ null、区分未指定なら null', () => {
    assert.equal(lastAmountFor(entries, 'drip', 'cafe', null), null);
    assert.equal(lastAmountFor(entries, 'drip', null, null), null);
  });
  test('同じ日付なら作成日時が新しい方', () => {
    const e = [entry('2026-10-01', 'drip', 100, 'home'), entry('2026-10-01', 'drip', 0, 'home')];
    assert.equal(lastAmountFor(e, 'drip', 'home', null), 0);
  });
});

describe('storeOrder', () => {
  test('直近90日の利用回数順、同数なら order 順、非表示と他区分は除外', () => {
    const places = [...PLACES, { id: 'old', categoryId: 'conv', name: '閉店', order: 3, archived: true }];
    const entries = [
      entry('2026-10-01', 'drip', 120, 'conv', 'lawson'),
      entry('2026-10-02', 'drip', 120, 'conv', 'lawson'),
      entry('2026-10-03', 'drip', 120, 'conv', 'seven'),
      ...[1, 2, 3].map((d) => entry(`2026-01-0${d}`, 'drip', 120, 'conv', 'famima')), // 期間外
    ];
    assert.deepEqual(
      storeOrder(entries, places, 'conv', '2026-10-12').map((p) => p.id),
      ['lawson', 'seven', 'famima'],
    );
    assert.deepEqual(storeOrder(entries, places, 'cafe', '2026-10-12'), []);
  });
});

describe('名前の正規化・重複判定', () => {
  test('前後空白・全角半角を正規化', () => {
    assert.equal(normalizeName('　ｾﾌﾞﾝ '), 'セブン');
    assert.equal(normalizeName('ＡＢＣ　Ｃａｆｅ'), 'ABC Cafe');
  });
  test('同じ区分内でのみ重複とみなす', () => {
    assert.equal(findPlaceByName(PLACES, 'conv', ' ｾﾌﾞﾝ').id, 'seven');
    assert.equal(findPlaceByName(PLACES, 'cafe', 'セブン'), null);
  });
});

describe('履歴用ユーティリティ', () => {
  const entries = [
    entry('2026-10-01', 'drip', 120, 'conv', 'seven'),
    entry('2026-10-01', 'latte', 180, 'conv', null),
    entry('2026-10-03', 'drip', 0, 'home'),
    entry('2026-10-04', 'can', 130),
  ];
  test('絞り込み', () => {
    assert.equal(filterEntries(entries, { typeId: 'drip' }).length, 2);
    assert.equal(filterEntries(entries, { placeCategoryId: 'conv' }).length, 2);
    assert.equal(filterEntries(entries, { placeCategoryId: 'conv', placeId: '__none__' }).length, 1);
    assert.equal(filterEntries(entries, { placeCategoryId: '__none__' }).length, 1);
    assert.equal(filterEntries(entries, { start: '2026-10-02', end: '2026-10-03' }).length, 1);
  });
  test('日ごとにまとめ、新しい順・日別合計', () => {
    const g = groupByDate(entries);
    assert.deepEqual(
      g.map((x) => [x.date, x.total, x.entries.length]),
      [
        ['2026-10-04', 130, 1],
        ['2026-10-03', 0, 1],
        ['2026-10-01', 300, 2],
      ],
    );
  });
  test('最後に保存した記録は作成日時で決める', () => {
    const e = [
      entry('2026-10-05', 'drip', 1, null, null, { createdAt: '2026-10-05T09:00:00.000Z' }),
      entry('2026-09-01', 'latte', 2, null, null, { createdAt: '2026-10-06T09:00:00.000Z' }),
    ];
    assert.equal(lastCreated(e).typeId, 'latte');
    assert.equal(lastCreated([]), null);
  });
  test('バックアップ通知: 最終エクスポートから30日以上', () => {
    const e = [entry('2026-01-01', 'drip', 1)];
    assert.equal(needsBackupReminder('2026-09-12', e, '2026-10-12'), true);
    assert.equal(needsBackupReminder('2026-09-13', e, '2026-10-12'), false);
    assert.equal(needsBackupReminder(null, e, '2026-10-12'), true);
    assert.equal(needsBackupReminder(null, [entry('2026-10-01', 'drip', 1)], '2026-10-12'), false);
    assert.equal(needsBackupReminder(null, [], '2026-10-12'), false);
  });
});
