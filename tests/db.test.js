import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialMasters, initialSettings } from '../js/db.js';

test('初期マスタが仕様 4.2 / 4.3 どおり', () => {
  const m = initialMasters();
  assert.deepEqual(
    m.types.map((t) => [t.id, t.name, t.countsAsCup]),
    [
      ['drip', 'ドリップ', true],
      ['latte', 'ラテ', true],
      ['can', '缶コーヒー', true],
      ['can_latte', '缶ラテ', true],
      ['beans', '豆購入', false],
    ],
  );
  assert.deepEqual(
    m.placeCategories.map((c) => [c.id, c.name, c.hasStores]),
    [
      ['home', '自宅', false],
      ['vending', '自販機', false],
      ['conv', 'コンビニ', true],
      ['cafe', 'カフェ', true],
    ],
  );
  assert.deepEqual(
    m.places.map((p) => [p.categoryId, p.name]),
    [
      ['conv', 'ファミマ'],
      ['conv', 'セブン'],
      ['conv', 'ローソン'],
    ],
  );
  assert.ok([...m.types, ...m.placeCategories, ...m.places].every((x) => x.archived === false));
});

test('初期設定: 週は月曜始まり', () => {
  const s = Object.fromEntries(initialSettings().map((r) => [r.key, r.value]));
  assert.equal(s.weekStart, 1);
  assert.equal(s.schemaVersion, 2);
});
