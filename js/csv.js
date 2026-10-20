// CSV 入出力(純粋関数 + ファイル入出力の薄い層)
// 形式: UTF-8(BOM 付き)・カンマ区切り・CRLF・RFC 4180 のクォート
import { isValidDate, normalizeName, findByName, findPlaceByName, compareRecency } from './aggregate.js';

// 1.0〜1.3 の 9 列(読み込みのみ対応)と、豆の袋の情報を末尾に足した 13 列(1.4〜)
export const CSV_COLUMNS_V1 = ['id', 'date', 'amount', 'type', 'placeCategory', 'place', 'note', 'createdAt', 'updatedAt'];
export const CSV_COLUMNS_V2 = [...CSV_COLUMNS_V1, 'bean', 'plannedCups', 'closedAt', 'bagId'];
// 1.5〜: 購入量(g)・1 回の量(g)を追加
export const CSV_COLUMNS = [...CSV_COLUMNS_V2, 'grams', 'gramsPerCup'];
const BOM = '﻿';
const NOTE_MAX = 100;

function escapeField(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 記録を CSV 文字列(BOM 付き)にする。種類・区分・店は表示名で出力 */
export function toCSV(entries, { types, placeCategories, places, beans = [] }) {
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const catName = new Map(placeCategories.map((c) => [c.id, c.name]));
  const placeName = new Map(places.map((p) => [p.id, p.name]));
  const beanName = new Map(beans.map((b) => [b.id, b.name]));
  const rows = [CSV_COLUMNS.join(',')];
  const sorted = [...entries].sort((a, b) => -compareRecency(a, b));
  for (const e of sorted) {
    rows.push(
      [
        e.id,
        e.date,
        e.amount,
        typeName.get(e.typeId) ?? e.typeId,
        e.placeCategoryId ? catName.get(e.placeCategoryId) ?? e.placeCategoryId : '',
        e.placeId ? placeName.get(e.placeId) ?? '' : '',
        e.note ?? '',
        e.createdAt,
        e.updatedAt,
        e.beanId ? beanName.get(e.beanId) ?? '' : '',
        e.plannedCups ?? '',
        e.closedAt ?? '',
        e.bagId ?? '',
        e.grams ?? '',
        e.gramsPerCup ?? '',
      ]
        .map(escapeField)
        .join(','),
    );
  }
  return `${BOM}${rows.join('\r\n')}\r\n`;
}

/**
 * RFC 4180 の CSV を解析する。BOM の有無・CRLF/LF の両方に対応。
 * @returns {{fields:string[], line:number}[]} line は各レコードの開始行番号(1 始まり)
 */
export function parseCSV(text) {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const pushRecord = () => {
    fields.push(field);
    records.push({ fields, line: recordLine });
    fields = [];
    field = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      pushRecord();
      line += 1;
      recordLine = line;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== '' || fields.length > 0) pushRecord();
  // 空行は除外
  return records.filter((r) => !(r.fields.length === 1 && r.fields[0] === ''));
}

function isValidIso(s) {
  return typeof s === 'string' && s.trim() !== '' && !Number.isNaN(Date.parse(s));
}

/**
 * CSV テキストを検証して行データにする(マスタ照合はしない)。
 * @returns {{rows:object[], errors:{line:number,message:string}[], fatal:string|null}}
 */
export function parseImport(text) {
  const records = parseCSV(text);
  const errors = [];
  if (records.length === 0) return { rows: [], errors, fatal: 'ファイルが空です' };
  const header = records[0].fields.map((h) => h.trim());
  const columns = [CSV_COLUMNS, CSV_COLUMNS_V2, CSV_COLUMNS_V1].find((c) => header.join(',') === c.join(','));
  if (!columns) {
    return { rows: [], errors, fatal: `見出し行が不正です(期待: ${CSV_COLUMNS.join(',')})` };
  }
  const rows = [];
  for (const { fields, line } of records.slice(1)) {
    if (fields.length !== columns.length) {
      errors.push({ line, message: `列数が不正です(${fields.length} 列)` });
      continue;
    }
    const [id, date, amount, type, placeCategory, place, note, createdAt, updatedAt, bean = '', planned = '', closedAt = '', bagId = '', grams = '', gramsPerCup = ''] = fields;
    const amountStr = amount.trim();
    let message = null;
    if (id.trim() === '') message = 'id が空です';
    else if (!isValidDate(date.trim())) message = `日付の形式が不正です(${date})`;
    else if (!/^\d+$/.test(amountStr)) message = `金額は 0 以上の整数で入力してください(${amount})`;
    else if (normalizeName(type) === '') message = '種類が空です';
    else if (normalizeName(place) !== '' && normalizeName(placeCategory) === '') message = '店が指定されていますが区分が空です';
    else if ([...note].length > NOTE_MAX) message = `メモが ${NOTE_MAX} 文字を超えています`;
    else if (!isValidIso(createdAt) || !isValidIso(updatedAt)) message = '作成日時・更新日時の形式が不正です';
    else if (planned.trim() !== '' && !/^[1-9]\d*$/.test(planned.trim())) message = `予定杯数は 1 以上の整数で入力してください(${planned})`;
    else if (closedAt.trim() !== '' && !isValidDate(closedAt.trim())) message = `使い切り日の形式が不正です(${closedAt})`;
    else if ([grams, gramsPerCup].some((g) => g.trim() !== '' && !/^\d+(\.\d+)?$/.test(g.trim()))) message = `購入量・1回の量は数値(g)で入力してください(${grams}/${gramsPerCup})`;
    if (message) {
      errors.push({ line, message });
      continue;
    }
    rows.push({
      line,
      id: id.trim(),
      date: date.trim(),
      amount: Number(amountStr),
      type: normalizeName(type),
      placeCategory: normalizeName(placeCategory),
      place: normalizeName(place),
      note,
      createdAt: createdAt.trim(),
      updatedAt: updatedAt.trim(),
      bean: normalizeName(bean),
      plannedCups: planned.trim() === '' ? null : Number(planned.trim()),
      closedAt: closedAt.trim() || null,
      grams: grams.trim() === '' ? null : Number(grams.trim()),
      gramsPerCup: gramsPerCup.trim() === '' ? null : Number(gramsPerCup.trim()),
      bagId: bagId.trim() || null,
    });
  }
  return { rows, errors, fatal: null };
}

function nextOrder(items) {
  return items.reduce((m, x) => Math.max(m, x.order ?? 0), -1) + 1;
}

function isNewer(a, b) {
  return Date.parse(a) > Date.parse(b);
}

/**
 * 取込計画を作る(DB には書かない)。名前でマスタを照合し、無ければ新規作成する。
 * - 新規の種類: countsAsCup=true
 * - 新規の区分: その区分で店が指定された行があれば hasStores=true、無ければ false
 * - id をキーにマージ: 既存 id は updatedAt が新しい方を採用、新規 id は追加
 * @param {{rows:object[]}} parsed parseImport の結果
 * @param {object[]} existingEntries
 * @param {{types:object[],placeCategories:object[],places:object[]}} masters
 * @param {()=>string} genId
 */
export function planImport(parsed, existingEntries, masters, genId) {
  const types = [...masters.types];
  const cats = [...masters.placeCategories];
  const places = [...masters.places];
  const beans = [...(masters.beans || [])];
  const newBeans = [];
  const newTypes = [];
  const newCats = [];
  const newPlaces = [];

  const catsWithStores = new Set(parsed.rows.filter((r) => r.place && r.placeCategory).map((r) => r.placeCategory));

  const resolveType = (name) => {
    let t = findByName(types, name);
    if (!t) {
      t = { id: genId(), name, countsAsCup: true, order: nextOrder(types), archived: false };
      types.push(t);
      newTypes.push(t);
    }
    return t.id;
  };
  const resolveCat = (name) => {
    if (!name) return null;
    let c = findByName(cats, name);
    if (!c) {
      c = { id: genId(), name, hasStores: catsWithStores.has(name), order: nextOrder(cats), archived: false };
      cats.push(c);
      newCats.push(c);
    }
    return c.id;
  };
  const resolvePlace = (catId, name) => {
    if (!catId || !name) return null;
    let p = findPlaceByName(places, catId, name);
    if (!p) {
      p = {
        id: genId(),
        categoryId: catId,
        name,
        order: nextOrder(places.filter((x) => x.categoryId === catId)),
        archived: false,
      };
      places.push(p);
      newPlaces.push(p);
    }
    return p.id;
  };

  const resolveBean = (name) => {
    if (!name) return null;
    let b = findByName(beans, name);
    if (!b) {
      b = { id: genId(), name, order: nextOrder(beans), archived: false };
      beans.push(b);
      newBeans.push(b);
    }
    return b.id;
  };

  // ファイル内で同じ id が重複した場合も updatedAt が新しい方を採用する
  const incoming = new Map();
  for (const r of parsed.rows) {
    const prev = incoming.get(r.id);
    if (!prev || isNewer(r.updatedAt, prev.updatedAt)) incoming.set(r.id, r);
  }

  const existing = new Map(existingEntries.map((e) => [e.id, e]));
  const toAdd = [];
  const toUpdate = [];
  let unchanged = 0;
  for (const r of incoming.values()) {
    const cur = existing.get(r.id);
    if (cur && !isNewer(r.updatedAt, cur.updatedAt)) {
      unchanged += 1;
      continue;
    }
    const placeCategoryId = resolveCat(r.placeCategory);
    const entry = {
      id: r.id,
      date: r.date,
      amount: r.amount,
      typeId: resolveType(r.type),
      placeCategoryId,
      placeId: resolvePlace(placeCategoryId, r.place),
      note: r.note,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
    // 豆の袋の情報は値があるときだけ持たせる(旧形式の記録と同じ形を保つ)
    const beanId = resolveBean(r.bean);
    if (beanId) entry.beanId = beanId;
    if (r.plannedCups != null) entry.plannedCups = r.plannedCups;
    if (r.closedAt) entry.closedAt = r.closedAt;
    if (r.bagId) entry.bagId = r.bagId;
    if (r.grams != null) entry.grams = r.grams;
    if (r.gramsPerCup != null) entry.gramsPerCup = r.gramsPerCup;
    (cur ? toUpdate : toAdd).push(entry);
  }
  return { toAdd, toUpdate, unchanged, newTypes, newPlaceCategories: newCats, newPlaces, newBeans };
}

/** ファイル名 coffee-log_YYYYMMDD.csv */
export function csvFilename(dateStr) {
  return `coffee-log_${dateStr.replace(/-/g, '')}.csv`;
}

// ---- ファイル入出力(ブラウザ専用の薄い層) ----

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file) {
  return file.text();
}
