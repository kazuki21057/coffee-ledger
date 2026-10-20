// IndexedDB アクセス(外部ライブラリを使わない薄いラッパー)

export const DB_NAME = 'coffee-ledger';
export const SCHEMA_VERSION = 2;
export const STORES = ['entries', 'types', 'placeCategories', 'places', 'beans', 'settings'];

/** 初期マスタ(仕様 4.2 / 4.3) */
export function initialMasters() {
  const types = [
    ['drip', 'ドリップ', true],
    ['latte', 'ラテ', true],
    ['can', '缶コーヒー', true],
    ['can_latte', '缶ラテ', true],
    ['beans', '豆購入', false],
  ].map(([id, name, countsAsCup], order) => ({ id, name, countsAsCup, order, archived: false }));
  const placeCategories = [
    ['home', '自宅', false],
    ['vending', '自販機', false],
    ['conv', 'コンビニ', true],
    ['cafe', 'カフェ', true],
  ].map(([id, name, hasStores], order) => ({ id, name, hasStores, order, archived: false }));
  const places = [
    ['conv_famima', 'ファミマ'],
    ['conv_seven', 'セブン'],
    ['conv_lawson', 'ローソン'],
  ].map(([id, name], order) => ({ id, categoryId: 'conv', name, order, archived: false }));
  return { types, placeCategories, places };
}

/** 初期設定(仕様 4.4)。週の開始曜日は 0=日曜 … 6=土曜 */
export function initialSettings() {
  return [
    { key: 'weekStart', value: 1 },
    { key: 'schemaVersion', value: SCHEMA_VERSION },
  ];
}

let dbPromise = null;
const listeners = new Set();

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('トランザクションが中断されました'));
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const tx = req.transaction;
      if (ev.oldVersion < 1) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('date', 'date');
        db.createObjectStore('types', { keyPath: 'id' });
        db.createObjectStore('placeCategories', { keyPath: 'id' });
        db.createObjectStore('places', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
        const m = initialMasters();
        for (const t of m.types) tx.objectStore('types').put(t);
        for (const c of m.placeCategories) tx.objectStore('placeCategories').put(c);
        for (const p of m.places) tx.objectStore('places').put(p);
        for (const s of initialSettings()) tx.objectStore('settings').put(s);
      }
      // v2(1.4.0): 豆のマスタを追加。記録への beanId/plannedCups/closedAt/bagId の追加は任意項目なので移行不要
      if (ev.oldVersion < 2) {
        db.createObjectStore('beans', { keyPath: 'id' });
        tx.objectStore('settings').put({ key: 'schemaVersion', value: 2 });
      }
      // 将来のスキーマ変更はここに ev.oldVersion < 3 … の形で追加し、settings.schemaVersion も更新する
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('他のタブでアプリが開かれているため、データベースを更新できません'));
  });
  return dbPromise;
}

/** 書き込み後に呼ばれる通知を登録する(ダッシュボードの自動更新用) */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(stores) {
  for (const fn of listeners) fn(stores);
}

export async function getAll(store) {
  const db = await openDB();
  return promisify(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDB();
  return promisify(db.transaction(store).objectStore(store).get(key));
}

/** 1 件以上を保存する */
export async function put(store, items) {
  const list = Array.isArray(items) ? items : [items];
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const it of list) os.put(it);
  await txDone(tx);
  notify([store]);
}

/** 記録のみ物理削除できる(種類・場所は archived で非表示にする、仕様 4.5) */
export async function deleteEntry(id) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readwrite');
  tx.objectStore('entries').delete(id);
  await txDone(tx);
  notify(['entries']);
}

/**
 * 複数ストアへの書き込みを 1 トランザクションで行う(CSV 取込用)。
 * @param {Object<string, object[]>} byStore
 */
export async function putMany(byStore) {
  const stores = Object.keys(byStore).filter((s) => byStore[s].length > 0);
  if (stores.length === 0) return;
  const db = await openDB();
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) {
    const os = tx.objectStore(s);
    for (const it of byStore[s]) os.put(it);
  }
  await txDone(tx);
  notify(stores);
}

export async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await put('settings', { key, value });
}

/** 全データをまとめて読む */
export async function loadAll() {
  const [entries, types, placeCategories, places, beans, settingsRows] = await Promise.all(STORES.map((s) => getAll(s)));
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  return { entries, types, placeCategories, places, beans, settings };
}
