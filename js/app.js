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
} from './aggregate.js';

// ---------------------------------------------------------------- 共通

const state = {
  entries: [],
  types: [],
  placeCategories: [],
  places: [],
  settings: {},
  view: 'record',
  prevTab: 'record',
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

// ---------------------------------------------------------------- 起動

async function start() {
  setupNavigation();
  setupRecord();
  db.onChange(queueRefresh);
  try {
    await refresh();
  } catch (err) {
    console.error(err);
    showToast('データベースを開けませんでした。ブラウザの設定を確認してください。', null, 10000);
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
