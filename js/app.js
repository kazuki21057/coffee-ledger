// 画面制御・イベント
import * as db from './db.js';
import {
  localDateString,
  addDays,
  isValidDate,
  quickPresets,
  lastAmountFor,
  storeOrder,
  normalizeName,
  findPlaceByName,
  lastCreated,
  needsBackupReminder,
  periodRange,
  shiftPeriod,
  summarize,
  periodComparison,
  compareSeries,
  elapsedDays,
  perDayAmount,
  filterEntries,
  groupByDate,
  findByName,
} from './aggregate.js';
import * as charts from './charts.js';
import { toCSV, parseImport, planImport, csvFilename, downloadText, readFileText } from './csv.js';
import { APP_VERSION, CHANGELOG } from './version.js';

// ---------------------------------------------------------------- 共通

const state = {
  entries: [],
  types: [],
  placeCategories: [],
  places: [],
  settings: {},
  view: 'dashboard',
  prevTab: 'dashboard',
};

const $ = (id) => document.getElementById(id);
const numberFmt = new Intl.NumberFormat('ja-JP');

/** ¥1,234 形式(負数は −¥1,234) */
export function yen(n) {
  const v = Math.round(n);
  return `${v < 0 ? '−' : ''}¥${numberFmt.format(Math.abs(v))}`;
}

/** 小さな要素ビルダー */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected', 'hidden'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function today() {
  return localDateString(new Date());
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

const byOrder = (a, b) => a.order - b.order;
const typeById = (id) => state.types.find((t) => t.id === id);
const catById = (id) => state.placeCategories.find((c) => c.id === id);
const placeById = (id) => state.places.find((p) => p.id === id);

function typeName(id) {
  return typeById(id)?.name ?? '(不明な種類)';
}

/** 場所の表示名: 「コンビニ・セブン」「自宅」「場所なし」 */
function placeLabel(placeCategoryId, placeId) {
  if (!placeCategoryId) return '場所なし';
  const c = catById(placeCategoryId)?.name ?? '(不明な区分)';
  const p = placeId ? placeById(placeId)?.name : null;
  return p ? `${c}・${p}` : c;
}

function entrySummary(e) {
  return `${typeName(e.typeId)}｜${placeLabel(e.placeCategoryId, e.placeId)}｜${yen(e.amount)}`;
}

// ---------------------------------------------------------------- トースト

let toastTimer = null;

function showToast(message, action = null, ms = 5000) {
  const t = $('toast');
  $('toast-msg').textContent = message;
  const btn = $('toast-action');
  btn.hidden = !action;
  btn.onclick = null;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = async () => {
      hideToast();
      try {
        await action.run();
      } catch (err) {
        console.error(err);
        showToast('元に戻せませんでした');
      }
    };
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  $('toast').hidden = true;
  clearTimeout(toastTimer);
}

// ---------------------------------------------------------------- 画面切替

const TITLES = { record: '記録', dashboard: 'ダッシュボード', history: '履歴', settings: '設定', help: 'ヘルプ' };
const TABS = ['record', 'dashboard', 'history'];
const renderers = {};

function showView(view) {
  if (TABS.includes(view)) state.prevTab = view;
  state.view = view;
  for (const v of Object.keys(TITLES)) $(`view-${v}`).hidden = v !== view;
  $('page-title').textContent = TITLES[view];
  $('back-btn').hidden = TABS.includes(view);
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  closeMenu();
  renderCurrent();
  window.scrollTo(0, 0);
}

function renderCurrent() {
  renderers[state.view]?.();
}

function closeMenu() {
  $('menu').hidden = true;
  $('menu-btn').setAttribute('aria-expanded', 'false');
}

function setupNavigation() {
  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showView(tab.dataset.view));
  $('back-btn').addEventListener('click', () => showView(state.prevTab));
  $('menu-btn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = $('menu').hidden;
    $('menu').hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', String(open));
  });
  for (const item of document.querySelectorAll('#menu [data-view]')) {
    item.addEventListener('click', () => showView(item.dataset.view));
  }
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.menu-wrap')) closeMenu();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeMenu();
  });
}

// ---------------------------------------------------------------- データ

async function refresh() {
  const all = await db.loadAll();
  Object.assign(state, all);
  state.types.sort(byOrder);
  state.placeCategories.sort(byOrder);
  state.places.sort(byOrder);
  renderCurrent();
}

let refreshQueued = false;
function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(async () => {
    refreshQueued = false;
    try {
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('データの読み込みに失敗しました');
    }
  });
}

/** 記録を保存し、元に戻せるトーストを出す */
async function saveEntry(entry, { previous = null, message = '保存しました' } = {}) {
  await db.put('entries', entry);
  showToast(message, {
    label: '元に戻す',
    run: async () => {
      if (previous) await db.put('entries', previous);
      else await db.deleteEntry(entry.id);
      showToast('元に戻しました', null, 2500);
    },
  });
}

function buildEntry({ typeId, placeCategoryId, placeId, amount, note = '', date = today() }) {
  const ts = nowIso();
  const cat = catById(placeCategoryId);
  return {
    id: newId(),
    date,
    amount,
    typeId,
    placeCategoryId: placeCategoryId || null,
    placeId: cat?.hasStores ? placeId || null : null,
    note,
    createdAt: ts,
    updatedAt: ts,
  };
}

// ---------------------------------------------------------------- 記録画面

const form = {
  editing: null, // 編集中の元の記録
  returnTo: null,
  typeId: null,
  placeCategoryId: null,
  placeId: null,
  addingStore: false,
  storeBeforeAdd: null,
  amountTouched: false,
  dateAuto: true,
};

function isActiveCombo(p) {
  const t = typeById(p.typeId);
  if (!t || t.archived) return false;
  if (p.placeCategoryId) {
    const c = catById(p.placeCategoryId);
    if (!c || c.archived) return false;
  }
  if (p.placeId) {
    const pl = placeById(p.placeId);
    if (!pl || pl.archived) return false;
  }
  return true;
}

function renderRecord() {
  renderBackupNotice();
  renderPresets();
  renderTypeChips();
  renderCatChips();
  renderStoreArea();
  updateSaveState();
}

function renderBackupNotice() {
  const last = state.settings.lastExportAt ? localDateString(new Date(state.settings.lastExportAt)) : null;
  $('backup-notice').hidden = !needsBackupReminder(last, state.entries, today());
}

function renderPresets() {
  const box = $('presets');
  const presets = quickPresets(state.entries, today(), 6, 90, isActiveCombo);
  box.replaceChildren(
    ...presets.map((p) => {
      const main = h(
        'button',
        { type: 'button', class: 'preset-main', 'aria-label': `${typeName(p.typeId)} ${placeLabel(p.placeCategoryId, p.placeId)} ${yen(p.amount)} を今日の記録として保存` },
        h('span', { class: 'p-amount' }, yen(p.amount)),
        h('span', { class: 'p-type' }, typeName(p.typeId)),
        h('span', { class: 'p-place' }, placeLabel(p.placeCategoryId, p.placeId)),
      );
      attachPress(main, () => quickSave(p), () => loadIntoForm(p));
      return h(
        'div',
        { class: 'preset' },
        main,
        h('button', { type: 'button', class: 'preset-edit', 'aria-label': '内容を修正して保存', title: '修正して保存', onclick: () => loadIntoForm(p) }, '✎'),
      );
    }),
  );
  $('quick-hint').hidden = presets.length === 0;
  if (presets.length === 0) box.append(h('p', { class: 'empty' }, 'まだ記録がありません。下のフォームから最初の記録をどうぞ。'));

  const last = lastCreated(state.entries);
  const same = $('same-as-last');
  const usable = last && isActiveCombo(last);
  same.disabled = !usable;
  same.textContent = usable ? `前回と同じ(${entrySummary(last)})` : '前回と同じ';
}

/** タップと長押しを区別する(長押し 500ms で onLong) */
function attachPress(el, onTap, onLong) {
  let timer = null;
  let longFired = false;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', () => {
    longFired = false;
    timer = setTimeout(() => {
      longFired = true;
      onLong();
    }, 500);
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  el.addEventListener('click', (ev) => {
    if (longFired) {
      ev.preventDefault();
      longFired = false;
      return;
    }
    onTap();
  });
}

async function quickSave(p) {
  try {
    await saveEntry(buildEntry({ ...p, date: today() }));
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました');
  }
}

async function saveSameAsLast() {
  const last = lastCreated(state.entries);
  if (!last) return;
  try {
    await saveEntry(buildEntry({ ...last, date: today() }));
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました');
  }
}

function renderTypeChips() {
  const types = state.types.filter((t) => !t.archived || t.id === form.typeId);
  $('type-chips').replaceChildren(
    ...types.map((t) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(form.typeId === t.id),
          onclick: () => {
            form.typeId = t.id;
            renderTypeChips();
            autoFillAmount();
            updateSaveState();
          },
        },
        t.name,
      ),
    ),
  );
}

function renderCatChips() {
  const cats = state.placeCategories.filter((c) => !c.archived || c.id === form.placeCategoryId);
  $('cat-chips').replaceChildren(
    ...cats.map((c) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(form.placeCategoryId === c.id),
          onclick: () => selectCategory(form.placeCategoryId === c.id ? null : c.id),
        },
        c.name,
      ),
    ),
  );
}

function selectCategory(catId) {
  form.placeCategoryId = catId;
  form.placeId = null;
  form.addingStore = false;
  $('store-new-name').value = '';
  $('store-error').hidden = true;
  renderCatChips();
  renderStoreArea({ focusInput: true });
  autoFillAmount();
}

function renderStoreArea({ focusInput = false } = {}) {
  const cat = catById(form.placeCategoryId);
  const area = $('store-area');
  if (!cat || !cat.hasStores) {
    area.hidden = true;
    form.placeId = null;
    return;
  }
  area.hidden = false;
  const stores = storeOrder(state.entries, state.places, cat.id, today());
  const select = $('store-select');
  const options = [h('option', { value: '' }, '店を選択'), ...stores.map((p) => h('option', { value: p.id }, p.name))];
  // 編集中の記録が非表示の店を参照している場合も選択肢に残す
  const current = form.placeId ? placeById(form.placeId) : null;
  if (current && !stores.includes(current)) options.push(h('option', { value: current.id }, `${current.name}(非表示)`));
  options.push(h('option', { value: '__new__' }, '＋ 新しく追加…'));
  select.replaceChildren(...options);

  const noStores = stores.length === 0 && !current;
  const showAdd = form.addingStore || noStores;
  select.hidden = noStores;
  select.value = form.addingStore && !form.placeId ? '__new__' : form.placeId || '';
  $('store-add').hidden = !showAdd;
  $('store-cancel-btn').hidden = noStores;
  if (showAdd && focusInput) $('store-new-name').focus();
}

function onStoreSelectChange() {
  const v = $('store-select').value;
  $('store-error').hidden = true;
  if (v === '__new__') {
    form.storeBeforeAdd = form.placeId;
    form.placeId = null;
    form.addingStore = true;
    $('store-new-name').value = '';
    renderStoreArea({ focusInput: true });
    return;
  }
  form.addingStore = false;
  form.placeId = v || null;
  renderStoreArea();
  autoFillAmount();
}

function cancelStoreAdd() {
  form.addingStore = false;
  form.placeId = form.storeBeforeAdd;
  $('store-new-name').value = '';
  $('store-error').hidden = true;
  renderStoreArea();
  autoFillAmount();
}

function showStoreError(msg) {
  const el = $('store-error');
  el.textContent = msg;
  el.hidden = false;
}

async function addStore() {
  const catId = form.placeCategoryId;
  const name = normalizeName($('store-new-name').value);
  if (!catId) return;
  if (!name) {
    showStoreError('店名を入力してください');
    $('store-new-name').focus();
    return;
  }
  const dup = findPlaceByName(state.places, catId, name);
  if (dup) {
    form.placeId = dup.id;
    renderStoreArea();
    showStoreError(`「${dup.name}」はすでに登録されています。既存の店を選択しました。`);
    autoFillAmount();
    return;
  }
  const order = state.places.filter((p) => p.categoryId === catId).reduce((m, p) => Math.max(m, p.order), -1) + 1;
  const place = { id: newId(), categoryId: catId, name, order, archived: false };
  try {
    await db.put('places', place);
    state.places.push(place);
    form.placeId = place.id;
    form.addingStore = false;
    $('store-new-name').value = '';
    $('store-error').hidden = true;
    renderStoreArea();
    autoFillAmount();
    showToast(`「${name}」を追加しました`, null, 2500);
  } catch (err) {
    console.error(err);
    showStoreError('店を追加できませんでした');
  }
}

function autoFillAmount() {
  if (form.amountTouched) return;
  const v = lastAmountFor(state.entries, form.typeId, form.placeCategoryId, form.placeId);
  if (v !== null) {
    $('amount').value = String(v);
    updateSaveState();
  }
}

function sanitizeAmount() {
  const input = $('amount');
  const cleaned = input.value.normalize('NFKC').replace(/[^\d]/g, '').slice(0, 7);
  if (cleaned !== input.value) input.value = cleaned;
  form.amountTouched = cleaned !== '';
  updateSaveState();
}

function setDate(value, auto = false) {
  form.dateAuto = auto;
  $('date').value = value;
  syncDateChips();
  updateSaveState();
}

function syncDateChips() {
  const v = $('date').value;
  $('date-today').setAttribute('aria-pressed', String(v === today()));
  $('date-yesterday').setAttribute('aria-pressed', String(v === addDays(today(), -1)));
}

function readForm() {
  const amountStr = $('amount').value;
  const date = $('date').value;
  const note = $('note').value;
  const valid = Boolean(form.typeId) && /^\d+$/.test(amountStr) && isValidDate(date) && [...note].length <= 100;
  return { valid, amount: Number(amountStr), date, note };
}

function updateSaveState() {
  $('save-btn').disabled = !readForm().valid;
}

function resetForm() {
  Object.assign(form, {
    editing: null,
    returnTo: null,
    typeId: null,
    placeCategoryId: null,
    placeId: null,
    addingStore: false,
    storeBeforeAdd: null,
    amountTouched: false,
  });
  $('amount').value = '';
  $('note').value = '';
  $('note-details').open = false;
  $('store-new-name').value = '';
  $('store-error').hidden = true;
  $('edit-banner').hidden = true;
  $('save-btn').textContent = '保存';
  setDate(today(), true);
  renderTypeChips();
  renderCatChips();
  renderStoreArea();
  updateSaveState();
}

/** クイック入力の内容をフォームに読み込む(日付は今日) */
function loadIntoForm(p) {
  resetForm();
  form.typeId = p.typeId;
  form.placeCategoryId = p.placeCategoryId;
  form.placeId = p.placeId;
  $('amount').value = String(p.amount);
  form.amountTouched = true;
  renderTypeChips();
  renderCatChips();
  renderStoreArea();
  updateSaveState();
  $('entry-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('amount').focus({ preventScroll: true });
}

/** 既存の記録を編集する(履歴から呼ばれる) */
export function editEntry(entry, returnTo = 'history') {
  showView('record');
  resetForm();
  Object.assign(form, {
    editing: entry,
    returnTo,
    typeId: entry.typeId,
    placeCategoryId: entry.placeCategoryId,
    placeId: entry.placeId,
    amountTouched: true,
  });
  $('amount').value = String(entry.amount);
  $('note').value = entry.note || '';
  $('note-details').open = Boolean(entry.note);
  setDate(entry.date);
  $('edit-banner').hidden = false;
  $('save-btn').textContent = '変更を保存';
  renderTypeChips();
  renderCatChips();
  renderStoreArea();
  updateSaveState();
  $('entry-form').scrollIntoView({ block: 'start' });
}

async function submitForm(ev) {
  ev.preventDefault();
  const { valid, amount, date, note } = readForm();
  if (!valid) return;
  const fields = { typeId: form.typeId, placeCategoryId: form.placeCategoryId, placeId: form.placeId, amount, note, date };
  const returnTo = form.returnTo;
  try {
    if (form.editing) {
      const base = buildEntry(fields);
      const updated = { ...base, id: form.editing.id, createdAt: form.editing.createdAt, updatedAt: nowIso() };
      await saveEntry(updated, { previous: form.editing, message: '変更を保存しました' });
    } else {
      await saveEntry(buildEntry(fields));
    }
    resetForm();
    if (returnTo) showView(returnTo);
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました');
  }
}

function setupRecord() {
  $('entry-form').addEventListener('submit', submitForm);
  $('amount').addEventListener('input', sanitizeAmount);
  $('date').addEventListener('input', () => {
    form.dateAuto = false;
    syncDateChips();
    updateSaveState();
  });
  $('date-today').addEventListener('click', () => setDate(today(), true));
  $('date-yesterday').addEventListener('click', () => setDate(addDays(today(), -1)));
  $('note').addEventListener('input', updateSaveState);
  $('store-select').addEventListener('change', onStoreSelectChange);
  $('store-add-btn').addEventListener('click', addStore);
  $('store-cancel-btn').addEventListener('click', cancelStoreAdd);
  $('store-new-name').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      addStore();
    }
  });
  $('same-as-last').addEventListener('click', saveSameAsLast);
  $('edit-cancel').addEventListener('click', () => {
    const back = form.returnTo;
    resetForm();
    if (back) showView(back);
  });
  $('backup-notice-open').addEventListener('click', () => showView('settings'));
  setDate(today(), true);
}

renderers.record = renderRecord;

// ---------------------------------------------------------------- ダッシュボード

const SERIES_N = { week: 12, month: 12, year: 5 };
const dash = { granularity: 'month', anchor: null, drillCategory: null };

function weekStart() {
  return Number(state.settings.weekStart ?? 1);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function md(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

function periodLabel(g, range) {
  const [y, m] = range.start.split('-').map(Number);
  if (g === 'year') return `${y}年`;
  if (g === 'month') return `${y}年${m}月`;
  const ey = Number(range.end.slice(0, 4));
  const w = (d) => WEEKDAYS[new Date(`${d}T00:00:00`).getDay()];
  return `${y}/${md(range.start)}(${w(range.start)})〜${ey !== y ? `${ey}/` : ''}${md(range.end)}(${w(range.end)})`;
}

function seriesLabel(g, range, i, all) {
  const [y, m] = range.start.split('-').map(Number);
  if (g === 'year') return String(y);
  if (g === 'month') return m === 1 || i === 0 ? [`${m}月`, String(y)] : `${m}月`;
  const prev = all[i - 1];
  return i === 0 || (prev && prev.start.slice(0, 4) !== range.start.slice(0, 4)) ? [md(range.start), String(y)] : md(range.start);
}

/** 種類の色は表示順で固定する(期間によって色が変わらないように) */
function typeColor(typeId) {
  return charts.colorAt(state.types.findIndex((t) => t.id === typeId));
}

function renderDashboard() {
  const hasData = state.entries.length > 0;
  $('dash-empty').hidden = hasData;
  $('dash-body').hidden = !hasData;
  if (!hasData) {
    charts.destroyAll();
    return;
  }
  const g = dash.granularity;
  const ws = weekStart();
  const anchor = dash.anchor || today();
  const range = periodRange(g, anchor, ws);
  const prevRange = periodRange(g, shiftPeriod(g, anchor, -1, ws), ws);
  const cur = summarize(state.entries, state.types, range);
  const prev = summarize(state.entries, state.types, prevRange);

  for (const b of document.querySelectorAll('.seg')) b.setAttribute('aria-pressed', String(b.dataset.gran === g));
  $('period-label').textContent = periodLabel(g, range);
  const isCurrent = today() >= range.start && today() <= range.end;
  $('period-today').hidden = isCurrent;
  $('period-next').disabled = range.end >= today();

  // サマリー
  $('sum-total').textContent = yen(cur.total);
  $('sum-cups').textContent = `${cur.cups}杯`;
  $('sum-avg').textContent = cur.avgPerCup === null ? '−' : yen(cur.avgPerCup);
  // 1 日あたり平均: 今の期間は開始日〜今日、過去の期間は全日数で割る
  const days = elapsedDays(range, today());
  const perDay = perDayAmount(cur.total, days);
  $('sum-perday').textContent = perDay === null ? '−' : yen(perDay);
  $('sum-perday-sub').textContent = days > 0 ? `${days}日間で計算` : '期間がまだ始まっていません';
  const cmp = periodComparison(cur.total, prev.total);
  const diffEl = $('sum-diff');
  const rateEl = $('sum-rate');
  diffEl.classList.remove('up', 'down');
  if (cmp.rate === null) {
    diffEl.textContent = '前期間なし';
    rateEl.textContent = '前期間の支出が0円のため';
  } else {
    diffEl.textContent = `${cmp.diff > 0 ? '+' : ''}${yen(cmp.diff)}`;
    const pct = Math.abs(cmp.rate * 100).toFixed(1);
    rateEl.textContent = `${cmp.rate > 0 ? '+' : cmp.rate < 0 ? '−' : ''}${pct}%(${cmp.diff > 0 ? '増加' : cmp.diff < 0 ? '減少' : '変化なし'})`;
    if (cmp.diff > 0) diffEl.classList.add('up');
    if (cmp.diff < 0) diffEl.classList.add('down');
  }

  const chartsOk = charts.isChartAvailable();
  $('chart-error').hidden = chartsOk;

  renderTypeBreakdown(cur, chartsOk);
  renderPlaceBreakdown(cur, chartsOk);
  renderSeries(g, anchor, ws, chartsOk);
}

function renderTypeBreakdown(cur, chartsOk) {
  const empty = cur.count === 0;
  $('type-empty').hidden = !empty;
  $('type-breakdown').hidden = empty;
  if (empty) return;
  const items = cur.byType.map((t) => ({ label: typeName(t.typeId), value: t.amount, color: typeColor(t.typeId), count: t.count, ratio: t.ratio }));
  $('type-table').replaceChildren(
    ...items.map((i) =>
      h(
        'tr',
        {},
        h('td', {}, h('span', { class: 'swatch', style: `background:${i.color}`, 'aria-hidden': 'true' }), i.label),
        h('td', { class: 'num' }, yen(i.value)),
        h('td', { class: 'num' }, cur.total > 0 ? `${(i.ratio * 100).toFixed(1)}%` : '−'),
        h('td', { class: 'num' }, `${i.count}件`),
      ),
    ),
  );
  const box = $('chart-type').parentElement;
  // 合計 0 円(自宅の 0 円記録のみ等)はドーナツを描けないので表のみ
  box.hidden = !chartsOk || cur.total === 0;
  if (!box.hidden) charts.renderDonut($('chart-type'), items);
}

function renderPlaceBreakdown(cur, chartsOk) {
  const drill = dash.drillCategory ? catById(dash.drillCategory) : null;
  let items;
  if (drill) {
    $('place-title').textContent = `場所別:${drill.name}の店別`;
    items = (cur.byPlace[drill.id] || []).map((p) => ({
      label: p.placeId ? placeById(p.placeId)?.name ?? '(不明な店)' : '(店未指定)',
      value: p.amount,
    }));
  } else {
    $('place-title').textContent = '場所別';
    items = cur.byPlaceCategory.map((c) => {
      const cat = c.placeCategoryId ? catById(c.placeCategoryId) : null;
      return {
        label: c.placeCategoryId ? cat?.name ?? '(不明な区分)' : '未設定',
        value: c.amount,
        clickable: Boolean(cat?.hasStores),
        catId: c.placeCategoryId,
      };
    });
  }
  $('place-back').hidden = !drill;
  $('place-hint').hidden = Boolean(drill) || !items.some((i) => i.clickable);
  const empty = items.length === 0;
  $('place-empty').hidden = !empty;
  $('place-box').hidden = empty || !chartsOk;
  // キーボード・支援技術向けの店別リンク(グラフのタップと同じ動作)
  $('place-drill-links').replaceChildren(
    ...(drill || empty
      ? []
      : items
          .filter((i) => i.clickable)
          .map((i) => h('button', { type: 'button', class: 'link-btn small', onclick: () => drillInto(i.catId) }, `${i.label}の店別を見る`))),
  );
  if (!chartsOk) {
    $('place-drill-links').append(
      h('table', { class: 'data-table' }, h('tbody', {}, ...items.map((i) => h('tr', {}, h('td', {}, i.label), h('td', { class: 'num' }, yen(i.value)))))),
    );
    return;
  }
  if (!empty) {
    charts.renderHorizontalBars($('chart-place'), items, (idx) => {
      if (!drill && items[idx]?.clickable) drillInto(items[idx].catId);
    });
  }
}

function drillInto(catId) {
  dash.drillCategory = catId;
  renderDashboard();
}

function renderSeries(g, anchor, ws, chartsOk) {
  const n = SERIES_N[g];
  const unit = { week: '週', month: 'か月', year: '年' }[g];
  $('series-title').textContent = `期間比較(直近${n}${unit})`;
  // 選択中の期間が右端に来るよう、anchor を含む直近 n 期間を表示する
  const periods = compareSeries(state.entries, state.types, g, anchor, n, ws);
  $('series-table').replaceChildren(
    ...[...periods].reverse().map((p) => h('tr', {}, h('td', {}, periodLabel(g, p)), h('td', { class: 'num' }, yen(p.total)))),
  );
  $('chart-series').parentElement.hidden = !chartsOk;
  if (!chartsOk) return;
  const used = state.types.filter((t) => periods.some((p) => p.byType[t.id]));
  const series = used.map((t) => ({ label: t.name, data: periods.map((p) => p.byType[t.id] || 0), color: typeColor(t.id) }));
  const labels = periods.map((p, i) => seriesLabel(g, p, i, periods));
  charts.renderStacked(
    $('chart-series'),
    labels,
    series,
    periods.map((p) => p.total),
    periods.length - 1,
  );
}

function setupDashboard() {
  for (const b of document.querySelectorAll('.seg')) {
    b.addEventListener('click', () => {
      dash.granularity = b.dataset.gran;
      renderDashboard();
    });
  }
  const move = (delta) => {
    dash.anchor = shiftPeriod(dash.granularity, dash.anchor || today(), delta, weekStart());
    renderDashboard();
  };
  $('period-prev').addEventListener('click', () => move(-1));
  $('period-next').addEventListener('click', () => move(1));
  $('period-today').addEventListener('click', () => {
    dash.anchor = null;
    renderDashboard();
  });
  $('place-back').addEventListener('click', () => {
    dash.drillCategory = null;
    renderDashboard();
  });
  $('dash-go-record').addEventListener('click', () => showView('record'));
  // ライト/ダーク切替時にグラフの文字色を合わせる
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.view === 'dashboard') renderDashboard();
  });
}

renderers.dashboard = renderDashboard;

// ---------------------------------------------------------------- 履歴

const PAGE = 200;
const hist = { typeId: '', placeCategoryId: '', placeId: '', start: '', end: '', limit: PAGE };

function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const rel = dateStr === today() ? '今日 ' : dateStr === addDays(today(), -1) ? '昨日 ' : '';
  return `${rel}${y}/${m}/${d}(${w})`;
}

function optionList(items, selected, allLabel, extra = []) {
  return [
    h('option', { value: '' }, allLabel),
    ...extra,
    ...items.map((x) => h('option', { value: x.id, selected: x.id === selected }, x.archived ? `${x.name}(非表示)` : x.name)),
  ];
}

function renderHistoryFilters() {
  $('f-type').replaceChildren(...optionList(state.types, hist.typeId, 'すべての種類'));
  $('f-type').value = hist.typeId;
  $('f-cat').replaceChildren(...optionList(state.placeCategories, hist.placeCategoryId, 'すべての場所', [h('option', { value: '__none__' }, '未設定')]));
  $('f-cat').value = hist.placeCategoryId;
  const cat = catById(hist.placeCategoryId);
  $('f-place-wrap').hidden = !cat?.hasStores;
  if (cat?.hasStores) {
    const stores = state.places.filter((p) => p.categoryId === cat.id);
    $('f-place').replaceChildren(...optionList(stores, hist.placeId, 'すべての店', [h('option', { value: '__none__' }, '(店未指定)')]));
    $('f-place').value = hist.placeId;
  }
  $('f-start').value = hist.start;
  $('f-end').value = hist.end;
  const parts = [];
  if (hist.typeId) parts.push(typeName(hist.typeId));
  if (hist.placeCategoryId === '__none__') parts.push('場所未設定');
  else if (hist.placeCategoryId) {
    const base = placeLabel(hist.placeCategoryId, hist.placeId === '__none__' ? null : hist.placeId);
    parts.push(hist.placeId === '__none__' ? `${base}・(店未指定)` : base);
  }
  if (hist.start || hist.end) parts.push(`${hist.start || '…'}〜${hist.end || '…'}`);
  $('filter-summary').textContent = parts.length ? `(${parts.join('・')})` : '';
}

function renderHistory() {
  renderHistoryFilters();
  const filtered = filterEntries(state.entries, {
    typeId: hist.typeId || null,
    placeCategoryId: hist.placeCategoryId || null,
    placeId: hist.placeId || null,
    start: hist.start || null,
    end: hist.end || null,
  });
  const total = filtered.reduce((a, e) => a + e.amount, 0);
  $('history-count').textContent = filtered.length ? `${filtered.length}件・合計 ${yen(total)}` : '';
  const groups = groupByDate(filtered);
  const list = $('history-list');
  if (filtered.length === 0) {
    list.replaceChildren(
      h('div', { class: 'card empty-state' }, h('p', {}, state.entries.length ? '条件に合う記録はありません。' : 'まだ記録がありません。')),
    );
    $('history-more').hidden = true;
    return;
  }
  let shown = 0;
  const nodes = [];
  for (const g of groups) {
    if (shown >= hist.limit) break;
    const items = g.entries.slice(0, hist.limit - shown);
    shown += items.length;
    nodes.push(
      h(
        'section',
        { class: 'day' },
        h('div', { class: 'day-head' }, h('span', {}, dayLabel(g.date)), h('strong', {}, yen(g.total))),
        h('ul', { class: 'items' }, ...items.map(historyItem)),
      ),
    );
  }
  list.replaceChildren(...nodes);
  $('history-more').hidden = shown >= filtered.length;
}

function historyItem(e) {
  const main = h(
    'button',
    { type: 'button', class: 'item-main', 'aria-label': `${entrySummary(e)} を編集` },
    h('span', { class: 'item-type' }, typeName(e.typeId)),
    h('span', { class: 'item-amount' }, yen(e.amount)),
    h('span', { class: 'item-sub' }, placeLabel(e.placeCategoryId, e.placeId), e.note ? `・${e.note}` : ''),
  );
  const li = h(
    'li',
    { class: 'item' },
    main,
    h('button', { type: 'button', class: 'item-del', 'aria-label': `${entrySummary(e)} を削除`, title: '削除', onclick: () => confirmDelete(e) }, '🗑'),
  );
  attachSwipe(li, main, () => editEntry(e, 'history'), () => confirmDelete(e));
  return li;
}

/** 左スワイプで削除、タップで編集 */
function attachSwipe(li, main, onTap, onSwipe) {
  let startX = null;
  let startY = 0;
  let dx = 0;
  let swiping = false;
  li.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' || ev.target.closest('.item-del')) return;
    startX = ev.clientX;
    startY = ev.clientY;
    dx = 0;
    swiping = false;
  });
  li.addEventListener('pointermove', (ev) => {
    if (startX === null) return;
    dx = ev.clientX - startX;
    if (!swiping && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(ev.clientY - startY)) swiping = true;
    if (swiping) li.style.transform = `translateX(${Math.min(0, dx)}px)`;
  });
  const end = () => {
    if (startX === null) return;
    li.style.transform = '';
    const fired = swiping && dx < -90;
    startX = null;
    if (fired) onSwipe();
  };
  li.addEventListener('pointerup', end);
  li.addEventListener('pointercancel', () => {
    li.style.transform = '';
    startX = null;
    swiping = false;
  });
  main.addEventListener('click', (ev) => {
    if (swiping) {
      ev.preventDefault();
      swiping = false;
      return;
    }
    onTap();
  });
}

async function confirmDelete(e) {
  if (!window.confirm(`この記録を削除しますか?\n${e.date} ${entrySummary(e)}`)) return;
  try {
    await db.deleteEntry(e.id);
    showToast('削除しました', {
      label: '元に戻す',
      run: async () => {
        await db.put('entries', e);
        showToast('元に戻しました', null, 2500);
      },
    });
  } catch (err) {
    console.error(err);
    showToast('削除に失敗しました');
  }
}

function setupHistory() {
  const bind = (id, key, extra) =>
    $(id).addEventListener('change', () => {
      hist[key] = $(id).value;
      if (extra) extra();
      hist.limit = PAGE;
      renderHistory();
    });
  bind('f-type', 'typeId');
  bind('f-cat', 'placeCategoryId', () => {
    hist.placeId = '';
  });
  bind('f-place', 'placeId');
  bind('f-start', 'start');
  bind('f-end', 'end');
  $('f-clear').addEventListener('click', () => {
    Object.assign(hist, { typeId: '', placeCategoryId: '', placeId: '', start: '', end: '', limit: PAGE });
    renderHistory();
  });
  $('history-more').addEventListener('click', () => {
    hist.limit += PAGE;
    renderHistory();
  });
}

renderers.history = renderHistory;

// ---------------------------------------------------------------- 設定

let pendingImport = null;

function formatDateTime(iso) {
  const d = new Date(iso);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function renderSettings() {
  $('last-export').textContent = state.settings.lastExportAt ? formatDateTime(state.settings.lastExportAt) : 'まだありません';
  const ws = weekStart();
  $('week-start').replaceChildren(...WEEKDAYS.map((w, i) => h('option', { value: String(i), selected: i === ws }, `${w}曜日`)));
  renderPersistStatus();
  renderMasterList('types-list', state.types, 'types', (t) => [
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.countsAsCup, onchange: (ev) => saveMaster('types', { ...t, countsAsCup: ev.target.checked }) }), '杯数に数える'),
  ]);
  renderMasterList('cats-list', state.placeCategories, 'placeCategories', (c) => [
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.hasStores, onchange: (ev) => saveMaster('placeCategories', { ...c, hasStores: ev.target.checked }) }), '店を持つ'),
  ]);
  renderStores();
}

/** 種類・区分・店の 1 行(名前変更・並べ替え・非表示) */
function masterRow(item, list, store, extra) {
  const idx = list.indexOf(item);
  const nameInput = h('input', {
    type: 'text',
    class: 'name-input',
    value: item.name,
    maxlength: store === 'places' ? '40' : '20',
    'aria-label': `${item.name}の名前`,
    onchange: (ev) => renameMaster(store, item, ev.target),
  });
  return h(
    'li',
    { class: `master-row${item.archived ? ' archived' : ''}` },
    nameInput,
    h(
      'div',
      { class: 'ctrls' },
      ...extra(item),
      h('button', { type: 'button', class: 'mini-btn', 'aria-label': `${item.name}を上へ`, disabled: idx === 0, onclick: () => moveMaster(store, list, idx, -1) }, '↑'),
      h('button', { type: 'button', class: 'mini-btn', 'aria-label': `${item.name}を下へ`, disabled: idx === list.length - 1, onclick: () => moveMaster(store, list, idx, 1) }, '↓'),
      h(
        'button',
        { type: 'button', class: 'mini-btn text', 'aria-pressed': String(item.archived), onclick: () => saveMaster(store, { ...item, archived: !item.archived }) },
        item.archived ? '再表示' : '非表示',
      ),
    ),
  );
}

function renderMasterList(listId, items, store, extra) {
  $(listId).replaceChildren(...items.map((it) => masterRow(it, items, store, extra)));
}

function renderStores() {
  const groups = state.placeCategories.filter((c) => c.hasStores || state.places.some((p) => p.categoryId === c.id));
  $('stores-list').replaceChildren(
    ...groups.map((c) => {
      const stores = state.places.filter((p) => p.categoryId === c.id);
      return h(
        'div',
        { class: 'store-group' },
        h('h3', {}, c.hasStores ? c.name : `${c.name}(店を持たない区分)`),
        stores.length
          ? h(
              'ul',
              { class: 'master-list' },
              ...stores.map((p) =>
                masterRow(p, stores, 'places', (pl) => [
                  h(
                    'select',
                    { 'aria-label': `${pl.name}の区分`, onchange: (ev) => moveStoreCategory(pl, ev.target) },
                    ...state.placeCategories.map((cat) => h('option', { value: cat.id, selected: cat.id === pl.categoryId }, cat.name)),
                  ),
                ]),
              ),
            )
          : h('p', { class: 'hint' }, 'まだ店がありません。'),
      );
    }),
  );
  const sel = $('set-store-cat');
  const prev = sel.value;
  const options = state.placeCategories.filter((c) => c.hasStores && !c.archived);
  sel.replaceChildren(...options.map((c) => h('option', { value: c.id }, c.name)));
  if (options.some((c) => c.id === prev)) sel.value = prev;
  $('set-store-add').disabled = options.length === 0;
}

async function saveMaster(store, item) {
  try {
    await db.put(store, item);
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました');
  }
}

function duplicateOf(store, item, name, categoryId = item?.categoryId) {
  const others = (store === 'types' ? state.types : store === 'placeCategories' ? state.placeCategories : state.places).filter(
    (x) => x.id !== item?.id,
  );
  return store === 'places' ? findPlaceByName(others, categoryId, name) : findByName(others, name);
}

async function renameMaster(store, item, input) {
  const name = normalizeName(input.value);
  if (!name) {
    input.value = item.name;
    showToast('名前を空にはできません');
    return;
  }
  if (duplicateOf(store, item, name)) {
    input.value = item.name;
    showToast(`「${name}」はすでに登録されています`);
    return;
  }
  await saveMaster(store, { ...item, name });
}

async function moveMaster(store, list, idx, delta) {
  const j = idx + delta;
  if (j < 0 || j >= list.length) return;
  const reordered = [...list];
  [reordered[idx], reordered[j]] = [reordered[j], reordered[idx]];
  try {
    await db.putMany({ [store]: reordered.map((x, i) => ({ ...x, order: i })) });
  } catch (err) {
    console.error(err);
    showToast('並べ替えに失敗しました');
  }
}

async function moveStoreCategory(place, select) {
  const categoryId = select.value;
  if (duplicateOf('places', place, place.name, categoryId)) {
    select.value = place.categoryId;
    showToast(`移動先に「${place.name}」がすでにあります`);
    return;
  }
  const order = state.places.filter((p) => p.categoryId === categoryId).reduce((m, p) => Math.max(m, p.order), -1) + 1;
  await saveMaster('places', { ...place, categoryId, order });
  // 過去の記録の区分も店に合わせて付け替える(店と区分の対応を保つ)
  const affected = state.entries.filter((e) => e.placeId === place.id && e.placeCategoryId !== categoryId);
  if (affected.length) {
    const ts = nowIso();
    await db.putMany({ entries: affected.map((e) => ({ ...e, placeCategoryId: categoryId, updatedAt: ts })) });
    showToast(`${affected.length}件の記録の区分を変更しました`);
  }
}

async function addMaster(store, inputId, errorId, build) {
  const input = $(inputId);
  const err = $(errorId);
  const name = normalizeName(input.value);
  err.hidden = true;
  const fail = (msg) => {
    err.textContent = msg;
    err.hidden = false;
    input.focus();
  };
  if (!name) return fail('名前を入力してください');
  const item = build(name);
  if (!item) return fail('追加先の区分がありません');
  if (duplicateOf(store, null, name, item.categoryId)) return fail(`「${name}」はすでに登録されています`);
  await saveMaster(store, item);
  input.value = '';
  showToast(`「${name}」を追加しました`, null, 2500);
}

const nextOrderOf = (items) => items.reduce((m, x) => Math.max(m, x.order), -1) + 1;

async function renderPersistStatus() {
  const el = $('persist-status');
  const btn = $('persist-btn');
  if (!navigator.storage?.persisted) {
    el.textContent = 'このブラウザはストレージの永続化に対応していません。CSVで定期的にバックアップしてください。';
    btn.hidden = true;
    return;
  }
  const persisted = await navigator.storage.persisted();
  el.textContent = persisted
    ? '永続化されています。ブラウザが容量不足で自動的にデータを消すことはありません(ブラウザのデータ削除やアンインストールでは消えます)。'
    : '永続化されていません。容量不足時にブラウザがデータを消す可能性があります。CSVで定期的にバックアップしてください。';
  btn.hidden = persisted;
}

async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch (err) {
    console.error(err);
    return false;
  }
}

async function exportCsv() {
  try {
    const text = toCSV(state.entries, state);
    downloadText(text, csvFilename(today()));
    await db.setSetting('lastExportAt', nowIso());
    showToast(`${state.entries.length}件を書き出しました`);
  } catch (err) {
    console.error(err);
    showToast('書き出しに失敗しました');
  }
}

async function onImportFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  const box = $('import-preview');
  try {
    const parsed = parseImport(await readFileText(file));
    if (parsed.fatal) {
      pendingImport = null;
      box.replaceChildren(h('p', { class: 'error' }, `読み込めませんでした: ${parsed.fatal}`));
      box.hidden = false;
      return;
    }
    const plan = planImport(parsed, state.entries, state, newId);
    pendingImport = plan;
    const newMasters = [
      ...plan.newTypes.map((t) => `種類「${t.name}」`),
      ...plan.newPlaceCategories.map((c) => `区分「${c.name}」`),
      ...plan.newPlaces.map((p) => `店「${p.name}」`),
    ];
    const canApply = plan.toAdd.length + plan.toUpdate.length > 0;
    box.replaceChildren(
      h('strong', {}, `読み込み内容の確認(${file.name})`),
      h(
        'ul',
        {},
        h('li', {}, `追加: ${plan.toAdd.length}件`),
        h('li', {}, `更新: ${plan.toUpdate.length}件`),
        h('li', {}, `変更なし(既存の方が新しい・同じ): ${plan.unchanged}件`),
        h('li', {}, `エラー行(取り込みません): ${parsed.errors.length}件`),
        newMasters.length ? h('li', {}, `新しく作成: ${newMasters.join('、')}`) : null,
      ),
      parsed.errors.length
        ? h('div', { class: 'import-errors' }, ...parsed.errors.map((e) => h('div', {}, `${e.line}行目: ${e.message}`)))
        : null,
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'btn', disabled: !canApply, onclick: applyImport }, '取り込む'),
        h('button', { type: 'button', class: 'btn secondary', onclick: cancelImport }, 'キャンセル'),
      ),
    );
    box.hidden = false;
  } catch (err) {
    console.error(err);
    box.replaceChildren(h('p', { class: 'error' }, 'ファイルを読み込めませんでした'));
    box.hidden = false;
  }
}

function cancelImport() {
  pendingImport = null;
  $('import-preview').hidden = true;
}

async function applyImport() {
  const plan = pendingImport;
  if (!plan) return;
  try {
    await db.putMany({
      types: plan.newTypes,
      placeCategories: plan.newPlaceCategories,
      places: plan.newPlaces,
      entries: [...plan.toAdd, ...plan.toUpdate],
    });
    cancelImport();
    showToast(`取り込みました(追加${plan.toAdd.length}件・更新${plan.toUpdate.length}件)`);
  } catch (err) {
    console.error(err);
    showToast('取り込みに失敗しました');
  }
}

function setupSettings() {
  $('week-start').addEventListener('change', (ev) => db.setSetting('weekStart', Number(ev.target.value)));
  $('export-btn').addEventListener('click', exportCsv);
  $('import-file').addEventListener('change', onImportFile);
  $('persist-btn').addEventListener('click', async () => {
    const ok = await requestPersist();
    showToast(ok ? '永続化されました' : 'ブラウザに許可されませんでした');
    renderPersistStatus();
  });
  const onEnter = (inputId, fn) =>
    $(inputId).addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        fn();
      }
    });
  const addType = () =>
    addMaster('types', 'type-new', 'type-error', (name) => ({ id: newId(), name, countsAsCup: true, order: nextOrderOf(state.types), archived: false }));
  const addCat = () =>
    addMaster('placeCategories', 'cat-new', 'cat-error', (name) => ({
      id: newId(),
      name,
      hasStores: false,
      order: nextOrderOf(state.placeCategories),
      archived: false,
    }));
  const addPlace = () =>
    addMaster('places', 'set-store-name', 'set-store-error', (name) => {
      const categoryId = $('set-store-cat').value;
      if (!categoryId) return null;
      return { id: newId(), categoryId, name, order: nextOrderOf(state.places.filter((p) => p.categoryId === categoryId)), archived: false };
    });
  $('type-add').addEventListener('click', addType);
  $('cat-add').addEventListener('click', addCat);
  $('set-store-add').addEventListener('click', addPlace);
  onEnter('type-new', addType);
  onEnter('cat-new', addCat);
  onEnter('set-store-name', addPlace);
}

renderers.settings = renderSettings;

// ---------------------------------------------------------------- ヘルプ

function formatYmd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}/${m}/${d}`;
}

function renderHelp() {
  $('app-version').textContent = `${APP_VERSION}(${formatYmd(CHANGELOG[0].date)} 更新)`;
  $('changelog').replaceChildren(
    ...CHANGELOG.flatMap((r) => [
      h('h3', {}, `${r.version}`, h('span', {}, formatYmd(r.date))),
      h('ul', {}, ...r.changes.map((c) => h('li', {}, c))),
    ]),
  );
}

renderers.help = renderHelp;

// ---------------------------------------------------------------- PWA(Service Worker)

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // 初回インストール時の clients.claim() でも controllerchange が起きるため、
  // ユーザーが「再読み込み」を押したときだけ再読み込みする
  let updateRequested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    window.location.reload();
  });
  const showUpdate = (worker) => {
    $('update-banner').hidden = false;
    $('update-reload').onclick = () => {
      updateRequested = true;
      worker.postMessage('SKIP_WAITING');
    };
  };
  // 既存の版が動いている状態で新しい版が入ったときだけ通知する(初回インストール時は出さない)
  const watch = (worker) => {
    if (!worker) return;
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      showUpdate(worker);
      return;
    }
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(worker);
    });
  };
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      // 登録完了前に更新の取得が始まっていると updatefound を取り逃すため、既存の waiting/installing も見る
      watch(reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // 開いたままでも定期的に更新を確認する
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => console.error('Service Worker の登録に失敗しました', err));
}

// ---------------------------------------------------------------- 起動

async function start() {
  setupNavigation();
  setupRecord();
  setupDashboard();
  setupHistory();
  setupSettings();
  setupServiceWorker();
  db.onChange(queueRefresh);
  try {
    await refresh();
  } catch (err) {
    console.error(err);
    showToast('データベースを開けませんでした。ブラウザの設定を確認してください。', null, 10000);
    return;
  }
  // 初回起動時にストレージの永続化を要求する(結果は設定画面に表示)
  if (!state.settings.persistRequested) {
    await requestPersist();
    await db.setSetting('persistRequested', true);
  }
  // 日付をまたいで開いたままでも「今日」がずれないように
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (form.dateAuto && !form.editing) setDate(today(), true);
      syncDateChips();
      renderCurrent();
    }
  });
}

start();
