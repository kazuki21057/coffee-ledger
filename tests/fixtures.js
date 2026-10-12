// テスト用ダミーデータ(個人データではない)
export const TYPES = [
  { id: 'drip', name: 'ドリップ', countsAsCup: true, order: 0, archived: false },
  { id: 'latte', name: 'ラテ', countsAsCup: true, order: 1, archived: false },
  { id: 'can', name: '缶コーヒー', countsAsCup: true, order: 2, archived: false },
  { id: 'can_latte', name: '缶ラテ', countsAsCup: true, order: 3, archived: false },
  { id: 'beans', name: '豆購入', countsAsCup: false, order: 4, archived: false },
];
export const CATS = [
  { id: 'home', name: '自宅', hasStores: false, order: 0, archived: false },
  { id: 'vending', name: '自販機', hasStores: false, order: 1, archived: false },
  { id: 'conv', name: 'コンビニ', hasStores: true, order: 2, archived: false },
  { id: 'cafe', name: 'カフェ', hasStores: true, order: 3, archived: false },
];
export const PLACES = [
  { id: 'famima', categoryId: 'conv', name: 'ファミマ', order: 0, archived: false },
  { id: 'seven', categoryId: 'conv', name: 'セブン', order: 1, archived: false },
  { id: 'lawson', categoryId: 'conv', name: 'ローソン', order: 2, archived: false },
];

let seq = 0;
export function entry(date, typeId, amount, placeCategoryId = null, placeId = null, extra = {}) {
  seq += 1;
  const p2 = (n) => String(n).padStart(2, '0');
  const ts = `${date}T09:${p2(Math.floor(seq / 60) % 60)}:${p2(seq % 60)}.000Z`;
  return { id: `e${seq}`, date, amount, typeId, placeCategoryId, placeId, note: '', createdAt: ts, updatedAt: ts, ...extra };
}
