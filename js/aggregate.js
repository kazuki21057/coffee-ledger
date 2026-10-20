// 集計ロジック(純粋関数のみ。DOM・DB に依存しない)
// 日付は 'YYYY-MM-DD' 文字列のまま扱い、内部計算は UTC の暦日演算で行う(タイムゾーンで日付がずれないように)。

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 'YYYY-MM-DD' として実在する日付か */
export function isValidDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  return fromUTC(toUTC(s)) === s;
}

/** Date オブジェクトから端末ローカル日付の 'YYYY-MM-DD' を作る */
export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function addDays(dateStr, n) {
  return fromUTC(toUTC(dateStr) + n * 86400000);
}

/** 曜日(0=日曜 … 6=土曜) */
export function dayOfWeek(dateStr) {
  return new Date(toUTC(dateStr)).getUTCDay();
}

/** 2 日付の差(b - a、日数) */
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/**
 * 期間の範囲(両端を含む)。
 * @param {'week'|'month'|'year'} granularity
 * @param {string} anchorDate 期間内の任意の日付
 * @param {number} weekStart 週の開始曜日(0=日曜 … 6=土曜、既定は月曜=1)
 */
export function periodRange(granularity, anchorDate, weekStart = 1) {
  const [y, m] = anchorDate.split('-').map(Number);
  if (granularity === 'week') {
    const diff = (dayOfWeek(anchorDate) - weekStart + 7) % 7;
    const start = addDays(anchorDate, -diff);
    return { start, end: addDays(start, 6) };
  }
  if (granularity === 'month') {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(last)}` };
  }
  if (granularity === 'year') {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  throw new Error(`不明な粒度: ${granularity}`);
}

/** anchorDate を含む期間から delta 期間ずらした期間の開始日 */
export function shiftPeriod(granularity, anchorDate, delta, weekStart = 1) {
  const { start } = periodRange(granularity, anchorDate, weekStart);
  const [y, m] = start.split('-').map(Number);
  if (granularity === 'week') return addDays(start, 7 * delta);
  if (granularity === 'month') {
    const idx = y * 12 + (m - 1) + delta;
    return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}-01`;
  }
  return `${y + delta}-01-01`;
}

/**
 * 1 日あたり平均の分母となる経過日数。
 * 今日を含む期間は開始日〜今日、過去の期間は全日数、未来の期間は 0。
 */
export function elapsedDays(range, today) {
  if (today < range.start) return 0;
  const end = today < range.end ? today : range.end;
  return daysBetween(range.start, end) + 1;
}

/** 1 日あたり金額(経過日数 0 なら null) */
export function perDayAmount(total, days) {
  return days > 0 ? total / days : null;
}

export function inRange(dateStr, range) {
  return dateStr >= range.start && dateStr <= range.end;
}

function typeCounts(typeMap, typeId) {
  const t = typeMap.get(typeId);
  return t ? t.countsAsCup === true : false;
}

function sortByAmountDesc(a, b) {
  return b.amount - a.amount || b.count - a.count;
}

/**
 * 期間内の集計。
 * - total: 合計金額
 * - cups: 杯数(countsAsCup=true の種類のみ)
 * - avgPerCup: 杯数対象の金額 ÷ 杯数(杯数 0 なら null)
 * - byType: [{typeId, amount, count, ratio}] 金額降順
 * - byPlaceCategory: [{placeCategoryId(未設定は null), amount, count}] 金額降順
 * - byPlace: {区分ID: [{placeId(店未指定は null), amount, count}]} 金額降順
 */
export function summarize(entries, types, range) {
  const typeMap = new Map(types.map((t) => [t.id, t]));
  let total = 0;
  let cups = 0;
  let cupAmount = 0;
  // 豆の袋から淹れた杯は、記録上の金額(0 円)ではなく袋の 1 杯あたり単価で平均に入れる
  const unitCosts = bagUnitCosts(entries);
  let count = 0;
  const byType = new Map();
  const byCat = new Map();
  const byPlace = new Map();

  for (const e of entries) {
    if (!inRange(e.date, range)) continue;
    count += 1;
    total += e.amount;
    if (typeCounts(typeMap, e.typeId)) {
      cups += 1;
      cupAmount += e.bagId && unitCosts.get(e.bagId) != null ? unitCosts.get(e.bagId) : e.amount;
    }
    const t = byType.get(e.typeId) || { typeId: e.typeId, amount: 0, count: 0 };
    t.amount += e.amount;
    t.count += 1;
    byType.set(e.typeId, t);

    const catId = e.placeCategoryId ?? null;
    const c = byCat.get(catId) || { placeCategoryId: catId, amount: 0, count: 0 };
    c.amount += e.amount;
    c.count += 1;
    byCat.set(catId, c);

    if (catId !== null) {
      if (!byPlace.has(catId)) byPlace.set(catId, new Map());
      const pm = byPlace.get(catId);
      const pid = e.placeId ?? null;
      const p = pm.get(pid) || { placeId: pid, amount: 0, count: 0 };
      p.amount += e.amount;
      p.count += 1;
      pm.set(pid, p);
    }
  }

  const byTypeArr = [...byType.values()]
    .map((t) => ({ ...t, ratio: total > 0 ? t.amount / total : 0 }))
    .sort(sortByAmountDesc);
  const byPlaceObj = {};
  for (const [catId, pm] of byPlace) byPlaceObj[catId] = [...pm.values()].sort(sortByAmountDesc);

  return {
    total,
    count,
    cups,
    avgPerCup: cups > 0 ? cupAmount / cups : null,
    byType: byTypeArr,
    byPlaceCategory: [...byCat.values()].sort(sortByAmountDesc),
    byPlace: byPlaceObj,
  };
}

// ---- 豆の袋(豆購入の記録 = 1 袋) ----

export const BEANS_TYPE_ID = 'beans';

export function isBeanPurchase(e) {
  return e.typeId === BEANS_TYPE_ID;
}

/** 袋ごとの杯数(bagId で紐づく記録の件数) */
export function bagCupCounts(entries) {
  const counts = new Map();
  for (const e of entries) if (e.bagId) counts.set(e.bagId, (counts.get(e.bagId) || 0) + 1);
  return counts;
}

/**
 * 袋の状況。
 * - 開封中: 1 杯あたり単価 = 購入金額 ÷ 予定杯数(予定)
 * - 使い切り(closedAt あり): 1 杯あたり単価 = 購入金額 ÷ 実際の杯数(実績)
 * currentUnit は「今の杯数で割った場合」の参考値(杯数が増えるほど下がる)。
 */
export function bagStatus(bag, counts) {
  const count = counts.get(bag.id) || 0;
  const planned = bag.plannedCups || 0;
  const closed = Boolean(bag.closedAt);
  const plannedUnit = planned > 0 ? bag.amount / planned : null;
  const currentUnit = count > 0 ? bag.amount / count : null;
  return { count, planned, closed, plannedUnit, currentUnit, unitCost: closed ? currentUnit : plannedUnit };
}

/** 袋 ID → 1 杯あたり単価(予定または実績。決まらなければ含めない) */
export function bagUnitCosts(entries) {
  const counts = bagCupCounts(entries);
  const map = new Map();
  for (const e of entries) {
    if (!isBeanPurchase(e)) continue;
    const u = bagStatus(e, counts).unitCost;
    if (u != null) map.set(e.id, u);
  }
  return map;
}

/** 開封中の袋(予定杯数があり、使い切っていない豆購入)を新しい順に */
export function openBags(entries) {
  return entries.filter((e) => isBeanPurchase(e) && !e.closedAt && e.plannedCups > 0).sort(compareRecency);
}

/** 豆のプルダウンの並び順: 最後に買った日が新しい順 → order 順。非表示は除く */
export function beanOrder(entries, beans) {
  const last = new Map();
  for (const e of entries) {
    if (!isBeanPurchase(e) || !e.beanId) continue;
    if (!last.has(e.beanId) || e.date > last.get(e.beanId)) last.set(e.beanId, e.date);
  }
  return beans
    .filter((b) => !b.archived)
    .sort((a, b) => (last.get(b.id) || '').localeCompare(last.get(a.id) || '') || a.order - b.order);
}

/** その豆の直近の購入記録(予定杯数・金額の自動入力用) */
export function lastPurchaseOf(entries, beanId) {
  let best = null;
  for (const e of entries) if (isBeanPurchase(e) && e.beanId === beanId && (!best || compareRecency(e, best) < 0)) best = e;
  return best;
}

/** 前期間比。前期間が 0 円のときは rate=null(「前期間なし」表示用) */
export function periodComparison(currentTotal, previousTotal) {
  return {
    diff: currentTotal - previousTotal,
    rate: previousTotal === 0 ? null : (currentTotal - previousTotal) / previousTotal,
  };
}

/**
 * 直近 n 期間(古い順、最後が anchorDate を含む期間)の種類別合計。
 * @returns {{start:string,end:string,total:number,byType:Object<string,number>}[]}
 */
export function compareSeries(entries, types, granularity, anchorDate, n, weekStart = 1) {
  const periods = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const a = shiftPeriod(granularity, anchorDate, -i, weekStart);
    periods.push({ ...periodRange(granularity, a, weekStart), total: 0, byType: {} });
  }
  if (periods.length === 0) return periods;
  const first = periods[0].start;
  const last = periods[periods.length - 1].end;
  for (const e of entries) {
    if (e.date < first || e.date > last) continue;
    const p = periods.find((x) => inRange(e.date, x));
    if (!p) continue;
    p.total += e.amount;
    p.byType[e.typeId] = (p.byType[e.typeId] || 0) + e.amount;
  }
  return periods;
}

/** 記録の新しさ比較(日付 → 作成日時の降順) */
export function compareRecency(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ca = a.createdAt || '';
  const cb = b.createdAt || '';
  if (ca === cb) return 0;
  return ca < cb ? 1 : -1;
}

export function presetKey(e) {
  return `${e.typeId}|${e.placeCategoryId ?? ''}|${e.placeId ?? ''}|${e.amount}`;
}

/**
 * クイック入力候補。組み合わせ「種類＋区分＋店＋金額」を
 * 直近 windowDays 日(today を含む)の頻度順、同率なら新しい順に最大 limit 件。
 * 期間内の利用が無い組み合わせも、頻度 0 として新しい順に後ろへ並べる(過去入力の流用のため)。
 * @param {(e:object)=>boolean} [isActive] 非表示の種類・場所を含む組み合わせを除外する判定
 */
export function quickPresets(entries, today, limit = 6, windowDays = 90, isActive = () => true) {
  const windowStart = addDays(today, -(windowDays - 1));
  const map = new Map();
  for (const e of entries) {
    if (e.date > today) continue;
    const key = presetKey(e);
    let p = map.get(key);
    if (!p) {
      p = {
        key,
        typeId: e.typeId,
        placeCategoryId: e.placeCategoryId ?? null,
        placeId: e.placeId ?? null,
        amount: e.amount,
        count: 0,
        latest: e,
      };
      map.set(key, p);
    }
    if (e.date >= windowStart) p.count += 1;
    if (compareRecency(e, p.latest) < 0) p.latest = e;
  }
  return [...map.values()]
    .filter((p) => isActive(p))
    .sort((a, b) => b.count - a.count || compareRecency(a.latest, b.latest))
    .slice(0, limit)
    .map(({ latest, ...rest }) => ({ ...rest, lastDate: latest.date }));
}

/**
 * 直近金額。店が一致する記録を優先し、無ければ区分が一致する記録。
 * 区分が未指定(null)の場合は null を返す(場所を選んだときだけ自動入力する)。
 */
export function lastAmountFor(entries, typeId, placeCategoryId, placeId) {
  if (!typeId || !placeCategoryId) return null;
  let byPlace = null;
  let byCat = null;
  for (const e of entries) {
    if (e.typeId !== typeId || e.placeCategoryId !== placeCategoryId) continue;
    if (!byCat || compareRecency(e, byCat) < 0) byCat = e;
    if (placeId && e.placeId === placeId && (!byPlace || compareRecency(e, byPlace) < 0)) byPlace = e;
  }
  if (byPlace) return byPlace.amount;
  return byCat ? byCat.amount : null;
}

/**
 * 店のプルダウンの並び順。区分内の非表示でない店を、
 * 直近 windowDays 日の利用回数順 → order 順で返す。
 */
export function storeOrder(entries, places, categoryId, today, windowDays = 90) {
  const windowStart = addDays(today, -(windowDays - 1));
  const counts = new Map();
  for (const e of entries) {
    if (e.placeCategoryId !== categoryId || !e.placeId) continue;
    if (e.date < windowStart || e.date > today) continue;
    counts.set(e.placeId, (counts.get(e.placeId) || 0) + 1);
  }
  return places
    .filter((p) => p.categoryId === categoryId && !p.archived)
    .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.order - b.order);
}

/** 名前の正規化(前後空白除去・全角半角の統一) */
export function normalizeName(s) {
  return String(s ?? '').normalize('NFKC').trim();
}

/** 同じ区分内で同名の店を探す(非表示の店も含む) */
export function findPlaceByName(places, categoryId, name) {
  const n = normalizeName(name);
  return places.find((p) => p.categoryId === categoryId && normalizeName(p.name) === n) || null;
}

/** 同名の要素を探す(種類・区分用) */
export function findByName(items, name) {
  const n = normalizeName(name);
  return items.find((x) => normalizeName(x.name) === n) || null;
}

/** 絞り込み(履歴用)。条件が null/空のものは無視する */
export function filterEntries(entries, { typeId, placeCategoryId, placeId, start, end } = {}) {
  return entries.filter(
    (e) =>
      (!typeId || e.typeId === typeId) &&
      (!placeCategoryId ||
        (placeCategoryId === '__none__' ? !e.placeCategoryId : e.placeCategoryId === placeCategoryId)) &&
      (!placeId || (placeId === '__none__' ? !e.placeId : e.placeId === placeId)) &&
      (!start || e.date >= start) &&
      (!end || e.date <= end),
  );
}

/** 日付の新しい順に日ごとにまとめる */
export function groupByDate(entries) {
  const sorted = [...entries].sort(compareRecency);
  const groups = [];
  for (const e of sorted) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== e.date) {
      g = { date: e.date, total: 0, entries: [] };
      groups.push(g);
    }
    g.total += e.amount;
    g.entries.push(e);
  }
  return groups;
}

/** 最後に保存した記録(作成日時が最も新しいもの) */
export function lastCreated(entries) {
  let best = null;
  for (const e of entries) if (!best || (e.createdAt || '') > (best.createdAt || '')) best = e;
  return best;
}

/**
 * バックアップ通知を出すか。最後のエクスポートから threshold 日以上経過、
 * エクスポート未実施なら最初の記録から threshold 日以上経過で true。
 */
export function needsBackupReminder(lastExportDate, entries, today, threshold = 30) {
  if (entries.length === 0) return false;
  if (lastExportDate) return daysBetween(lastExportDate, today) >= threshold;
  const oldest = entries.reduce((m, e) => (e.date < m ? e.date : m), entries[0].date);
  return daysBetween(oldest, today) >= threshold;
}
