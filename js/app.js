import { HOUSES, PRICE_MAX, MAX_NIGHTS } from './data.js';
import { loadState, saveState, clearState } from './storage.js';

/* ---------- Помощники ---------- */
const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat('ru-RU');
const money = (n) => `${fmt.format(n)} ₽`;

function plural(n, [one, few, many]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const GUESTS = ['гость', 'гостя', 'гостей'];
const NIGHTS = ['ночь', 'ночи', 'ночей'];
// «до 4 гостей», «до 21 гостя» — после «до» нужен родительный падеж
const upToGuests = (n) => `до ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'гостя' : 'гостей'}`;

const STATUS = {
  free: { text: 'Свободен', badge: '' },
  selected: { text: 'Выбран', badge: '✓' },
  busy: { text: 'Занят', badge: '✕' },
  mine: { text: 'Ваша бронь', badge: '★' },
};

const houseById = new Map(HOUSES.map((h) => [h.id, h]));

function isValidBooking(b) {
  if (!b || typeof b !== 'object') return false;
  const h = houseById.get(b.houseId);
  return (
    !!h &&
    typeof b.id === 'string' &&
    /^ЕМ-\d{4,}$/.test(b.id) &&
    Number.isInteger(b.num) && b.num > 0 &&
    Number.isInteger(b.guests) && b.guests >= 1 && b.guests <= h.capacity &&
    Number.isInteger(b.nights) && b.nights >= 1 && b.nights <= MAX_NIGHTS &&
    Number.isFinite(b.total) && b.total > 0
  );
}

/* ---------- Состояние ---------- */
const loaded = loadState(isValidBooking);

const state = {
  bookings: loaded.data.bookings,
  seq: loaded.data.seq,
  selectedId: null,
  filters: { guests: 0, maxPrice: PRICE_MAX, onlyFree: false },
  touched: new Set(),
  triedSubmit: false,
  submitting: false,
  storageOk: loaded.error !== 'blocked',
};

const dom = {
  pins: $('#map-pins'),
  mapEmpty: $('#map-empty'),
  list: $('#house-list'),
  listEmpty: $('#list-empty'),
  count: $('#f-count'),
  fGuests: $('#f-guests'),
  fPrice: $('#f-price'),
  fPriceOut: $('#f-price-out'),
  fFree: $('#f-free'),
  fReset: $('#f-reset'),
  cardPanel: $('#card-panel'),
  cardInfo: $('#card-info'),
  form: $('#booking-form'),
  guests: $('#b-guests'),
  nights: $('#b-nights'),
  guestsHint: $('#b-guests-hint'),
  guestsErr: $('#b-guests-err'),
  nightsErr: $('#b-nights-err'),
  houseErr: $('#b-house-err'),
  total: $('#b-total'),
  calc: $('#b-calc'),
  submit: $('#b-submit'),
  success: $('#b-success'),
  bookingsBody: $('#bookings-body'),
  bookingsSum: $('#bookings-sum'),
  bookingsTitle: $('#bookings-title'),
  demoReset: $('#demo-reset'),
  toast: $('#toast'),
  trees: $('#trees'),
  road: $('#road'),
};

/* ---------- Статусы ---------- */
const bookingFor = (id) => state.bookings.find((b) => b.houseId === id);
const isAvailable = (h) => !h.busy && !bookingFor(h.id);
const selectedHouse = () => (state.selectedId ? houseById.get(state.selectedId) : null);

function statusOf(h) {
  if (bookingFor(h.id)) return 'mine';
  if (h.busy) return 'busy';
  if (h.id === state.selectedId) return 'selected';
  return 'free';
}

function matchesFilters(h) {
  const f = state.filters;
  return h.capacity >= f.guests && h.pricePerNight <= f.maxPrice && (!f.onlyFree || isAvailable(h));
}

/* ---------- Уведомления ---------- */
let toastTimer;
function notify(message, tone = 'info') {
  dom.toast.textContent = message;
  dom.toast.classList.toggle('is-warn', tone === 'warn');
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 6000);
}

/** Двухшаговая кнопка вместо confirm(): первый клик просит подтвердить, второй выполняет. */
function armConfirm(btn, confirmText, action) {
  if (btn.dataset.armed === '1') {
    clearTimeout(Number(btn.dataset.timer));
    btn.dataset.armed = '';
    btn.classList.remove('is-armed');
    btn.textContent = btn.dataset.label;
    action();
    return;
  }
  btn.dataset.label = btn.textContent;
  btn.dataset.armed = '1';
  btn.classList.add('is-armed');
  btn.textContent = confirmText;
  const t = setTimeout(() => {
    btn.dataset.armed = '';
    btn.classList.remove('is-armed');
    btn.textContent = btn.dataset.label;
  }, 4000);
  btn.dataset.timer = String(t);
}

/* ---------- Построение схемы и списка (один раз) ---------- */
const HOUSE_SHAPE =
  '<svg class="pin__shape" viewBox="0 0 44 44" aria-hidden="true"><path d="M22 3 L41 19 V41 H3 V19 Z"></path></svg>';

const pinEls = new Map();
const itemEls = new Map();

function buildHouses() {
  for (const h of HOUSES) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    pin.dataset.id = h.id;
    pin.style.setProperty('--x', `${h.x}%`);
    pin.style.setProperty('--y', `${h.y}%`);
    pin.innerHTML = `
      <span class="pin__mark">${HOUSE_SHAPE}<span class="pin__num">${h.num}</span><span class="pin__badge" aria-hidden="true"></span></span>
      <span class="pin__label" aria-hidden="true"><span class="pin__name">${h.name}</span><span class="pin__state"></span></span>`;
    dom.pins.append(pin);
    pinEls.set(h.id, pin);

    const li = document.createElement('li');
    li.innerHTML = `
      <button type="button" class="house" data-id="${h.id}">
        <span class="house__num" aria-hidden="true">${h.num}</span>
        <span class="house__main">
          <span class="house__name">${h.name}</span>
          <span class="house__meta">${upToGuests(h.capacity)} · ${h.features.slice(0, 2).join(', ')}</span>
        </span>
        <span class="house__price">${money(h.pricePerNight)}<small> / ночь</small></span>
        <span class="chip"></span>
      </button>`;
    dom.list.append(li);
    itemEls.set(h.id, li);
  }
}

/** Деревья на схеме: случайные, но одинаковые при каждой загрузке. Не ставим их на дорогу, в озеро и на домики. */
function plantTrees() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const roadPts = [];
  try {
    const len = dom.road.getTotalLength();
    for (let d = 0; d <= len; d += 20) roadPts.push(dom.road.getPointAtLength(d));
  } catch { /* без дороги — просто без проверки */ }

  const lake = document.getElementById('lake');
  const inLake = (x, y) => {
    const pts = [[x, y], [x + 20, y], [x - 20, y], [x, y + 20], [x, y - 20]];
    try {
      return pts.some(([px, py]) => lake.isPointInFill(new DOMPoint(px, py)));
    } catch {
      return x > 520 && y > 250; // запасной вариант для старых браузеров
    }
  };
  const near = (x, y, pts, r) => pts.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < r * r);
  const housePts = HOUSES.map((h) => ({ x: h.x * 10, y: h.y * 7 }));

  const ns = 'http://www.w3.org/2000/svg';
  let planted = 0;
  for (let i = 0; i < 600 && planted < 95; i++) {
    const x = rnd() * 1000;
    const y = rnd() * 700;
    if (inLake(x, y)) continue;
    if (near(x, y, roadPts, 40)) continue;
    if (near(x, y, housePts, 80)) continue;
    if (x < 170 && y > 410 && y < 570) continue; // поле
    if (y > 630 && x < 260) continue; // подпись дороги
    const r = 10 + rnd() * 9;
    const g = document.createElementNS(ns, 'g');
    const c1 = document.createElementNS(ns, 'circle');
    c1.setAttribute('cx', x.toFixed(1));
    c1.setAttribute('cy', y.toFixed(1));
    c1.setAttribute('r', r.toFixed(1));
    c1.setAttribute('class', 'm-tree');
    const c2 = document.createElementNS(ns, 'circle');
    c2.setAttribute('cx', (x + r * 0.2).toFixed(1));
    c2.setAttribute('cy', (y + r * 0.2).toFixed(1));
    c2.setAttribute('r', (r * 0.45).toFixed(1));
    c2.setAttribute('class', 'm-tree-core');
    g.append(c1, c2);
    dom.trees.append(g);
    planted++;
  }
}

/* ---------- Отрисовка ---------- */
function render() {
  let visible = 0;
  let free = 0;

  for (const h of HOUSES) {
    const status = statusOf(h);
    const show = matchesFilters(h);
    if (show) visible++;
    if (show && isAvailable(h)) free++;

    const label = `Домик ${h.num} «${h.name}», ${upToGuests(h.capacity)}, ${money(h.pricePerNight)} за ночь — ${STATUS[status].text.toLowerCase()}`;

    const pin = pinEls.get(h.id);
    pin.hidden = !show;
    pin.className = `pin is-${status}`;
    pin.setAttribute('aria-label', label);
    pin.setAttribute('aria-pressed', String(status === 'selected'));
    pin.setAttribute('aria-disabled', String(!isAvailable(h)));
    pin.querySelector('.pin__badge').textContent = STATUS[status].badge;
    pin.querySelector('.pin__state').textContent = `${STATUS[status].text} · ${money(h.pricePerNight)}`;

    const li = itemEls.get(h.id);
    li.hidden = !show;
    const btn = li.querySelector('.house');
    btn.className = `house is-${status}`;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(status === 'selected'));
    btn.setAttribute('aria-disabled', String(!isAvailable(h)));
    const chip = btn.querySelector('.chip');
    chip.className = `chip chip--${status}`;
    chip.textContent = `${STATUS[status].badge ? STATUS[status].badge + ' ' : ''}${STATUS[status].text}`;
  }

  dom.mapEmpty.hidden = visible > 0;
  dom.listEmpty.hidden = visible > 0;
  dom.count.textContent = `Показано ${visible} из ${HOUSES.length} · свободно ${free}`;

  renderCard();
  renderForm();
  renderBookings();
}

function renderCard() {
  const h = selectedHouse();
  if (!h) {
    dom.cardInfo.innerHTML = `
      <div class="card-empty">
        <p class="eyebrow">Карточка домика</p>
        <h2 id="card-title">Домик не выбран</h2>
        <p>Нажмите на свободный домик на схеме или в списке. Занятые отмечены знаком ✕ и пунктиром.</p>
      </div>`;
    return;
  }
  dom.cardInfo.innerHTML = `
    <p class="eyebrow">Домик № ${h.num}</p>
    <div class="card-info__title">
      <h2 id="card-title">${h.name}</h2>
      <span class="chip chip--selected">✓ Выбран</span>
    </div>
    <p class="desc">${h.description}</p>
    <dl class="facts">
      <div><dt>Вместимость</dt><dd>${upToGuests(h.capacity)}</dd></div>
      <div><dt>Цена за ночь</dt><dd>${money(h.pricePerNight)}</dd></div>
    </dl>
    <ul class="tags" aria-label="Удобства">${h.features.map((f) => `<li>${f}</li>`).join('')}</ul>`;
}

/* ---------- Форма ---------- */
function readInt(input) {
  const raw = input.value.trim();
  if (raw === '') return { error: 'Введите число' };
  if (!/^\d+$/.test(raw)) return { error: 'Нужно целое положительное число' };
  return { value: Number(raw) };
}

function validate() {
  const h = selectedHouse();
  const errors = {};
  const cap = h ? h.capacity : 8;

  const g = readInt(dom.guests);
  if (g.error) errors.guests = g.error;
  else if (g.value < 1 || g.value > cap) {
    errors.guests = h ? `В домике «${h.name}» — от 1 ${upToGuests(cap)}` : 'От 1 до 8 гостей';
  }

  const n = readInt(dom.nights);
  if (n.error) errors.nights = n.error;
  else if (n.value < 1 || n.value > MAX_NIGHTS) errors.nights = `От 1 до ${MAX_NIGHTS} ночей`;

  if (!h) errors.house = 'Сначала выберите свободный домик на схеме или в списке.';

  return { errors, house: h, guests: g.value, nights: n.value };
}

function setFieldError(input, errEl, message) {
  errEl.textContent = message || '';
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function renderForm() {
  const h = selectedHouse();
  const { errors, nights } = validate();

  dom.guests.max = String(h ? h.capacity : 8);
  dom.guestsHint.textContent = h ? `от 1 до ${h.capacity}` : 'от 1 до вместимости дома';

  const showAll = state.triedSubmit;
  setFieldError(dom.guests, dom.guestsErr, showAll || state.touched.has('guests') ? errors.guests : '');
  setFieldError(dom.nights, dom.nightsErr, showAll || state.touched.has('nights') ? errors.nights : '');
  dom.houseErr.textContent = showAll && errors.house ? errors.house : '';

  if (h && !errors.nights) {
    dom.total.textContent = money(h.pricePerNight * nights);
    dom.calc.textContent = `${money(h.pricePerNight)} × ${nights} ${plural(nights, NIGHTS)}`;
  } else {
    dom.total.textContent = '—';
    dom.calc.textContent = h ? `Укажите от 1 до ${MAX_NIGHTS} ночей` : 'Выберите домик, чтобы увидеть сумму';
  }
}

/* ---------- Мои брони ---------- */
function renderBookings() {
  if (state.bookings.length === 0) {
    dom.bookingsSum.textContent = '';
    dom.bookingsBody.innerHTML = `
      <p class="empty">Пока броней нет. Выберите домик и подтвердите — запись появится здесь и сохранится после обновления страницы.</p>`;
    return;
  }
  const sum = state.bookings.reduce((s, b) => s + b.total, 0);
  const n = state.bookings.length;
  dom.bookingsSum.textContent = `${n} ${plural(n, ['бронь', 'брони', 'броней'])} · ${money(sum)}`;

  dom.bookingsBody.innerHTML = `<ul class="bookings">${state.bookings
    .map((b) => {
      const h = houseById.get(b.houseId);
      const date = new Date(b.createdAt);
      const when = Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      return `
        <li class="booking">
          <div class="booking__head"><span class="booking__id">№ ${b.id}</span><span>${when}</span></div>
          <p class="booking__house">«${h.name}», домик № ${h.num}</p>
          <p class="booking__meta">${b.guests} ${plural(b.guests, GUESTS)} · ${b.nights} ${plural(b.nights, NIGHTS)} · ${money(h.pricePerNight)} за ночь</p>
          <div class="booking__foot">
            <strong>${money(b.total)}</strong>
            <button type="button" class="btn btn--danger" data-cancel="${b.id}">Отменить бронь</button>
          </div>
        </li>`;
    })
    .join('')}</ul>`;
}

/* ---------- Действия ---------- */
function persist() {
  const ok = saveState(state);
  if (!ok) {
    state.storageOk = false;
    notify('Браузер не разрешил сохранить данные. Брони будут видны только до закрытия вкладки.', 'warn');
  }
  return ok;
}

function select(id, source) {
  const h = houseById.get(id);
  if (!h) return;
  if (!isAvailable(h)) {
    notify(
      bookingFor(id)
        ? `Домик «${h.name}» уже забронирован вами. Бронь — в разделе «Мои брони».`
        : `Домик «${h.name}» занят другими гостями. Выберите свободный.`,
      'warn',
    );
    return;
  }
  state.selectedId = id;
  state.triedSubmit = false;
  dom.success.hidden = true;

  // Подстраиваем число гостей под вместимость нового дома
  const g = readInt(dom.guests);
  if (!g.error && g.value > h.capacity) dom.guests.value = String(h.capacity);

  render();

  if (source === 'list' && window.matchMedia('(max-width: 900px)').matches) {
    dom.cardPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function applyFilters() {
  state.filters = {
    guests: Number(dom.fGuests.value),
    maxPrice: Number(dom.fPrice.value),
    onlyFree: dom.fFree.checked,
  };
  dom.fPriceOut.textContent = money(state.filters.maxPrice);

  const h = selectedHouse();
  if (h && !matchesFilters(h)) {
    state.selectedId = null;
    notify(`Домик «${h.name}» не подходит под фильтры — выбор сброшен.`);
  }
  render();
}

function resetFilters() {
  dom.fGuests.value = '0';
  dom.fPrice.value = String(PRICE_MAX);
  dom.fFree.checked = false;
  applyFilters();
}

function submitBooking(e) {
  e.preventDefault();
  if (state.submitting) return; // защита от двойного клика

  state.triedSubmit = true;
  const { errors, house, guests, nights } = validate();
  renderForm();

  if (Object.keys(errors).length) {
    if (errors.guests) dom.guests.focus();
    else if (errors.nights) dom.nights.focus();
    return;
  }
  if (!isAvailable(house)) {
    notify(`Домик «${house.name}» уже занят.`, 'warn');
    return;
  }

  state.submitting = true;
  dom.submit.disabled = true;

  state.seq += 1;
  const booking = {
    id: `ЕМ-${String(state.seq).padStart(4, '0')}`,
    num: state.seq,
    houseId: house.id,
    guests,
    nights,
    total: house.pricePerNight * nights,
    createdAt: new Date().toISOString(),
  };
  state.bookings.unshift(booking);
  const saved = persist();

  state.selectedId = null;
  state.triedSubmit = false;
  state.touched.clear();
  render();

  dom.success.innerHTML = `
    <strong>Бронь № ${booking.id} оформлена.</strong>
    «${house.name}», ${guests} ${plural(guests, GUESTS)}, ${nights} ${plural(nights, NIGHTS)} — ${money(booking.total)}.
    ${saved ? '' : 'Сохранить в браузере не получилось.'}
    <a href="#bookings">Открыть «Мои брони»</a>`;
  dom.success.hidden = false;

  setTimeout(() => {
    state.submitting = false;
    dom.submit.disabled = false;
  }, 800);
}

function cancelBooking(id) {
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;
  state.bookings = state.bookings.filter((x) => x.id !== id);
  persist();
  render();
  const h = houseById.get(b.houseId);
  notify(`Бронь № ${b.id} отменена. Домик «${h.name}» снова свободен.`);
  dom.bookingsTitle.focus();
}

function resetDemo() {
  clearState();
  state.bookings = [];
  state.seq = 0;
  state.selectedId = null;
  state.triedSubmit = false;
  state.touched.clear();
  dom.success.hidden = true;
  dom.guests.value = '2';
  dom.nights.value = '2';
  resetFilters();
  notify('Демо сброшено: все брони удалены, домики снова свободны.');
}

function step(inputId, delta) {
  const input = document.getElementById(inputId);
  const max = Number(input.max);
  const cur = readInt(input);
  const base = cur.error ? 0 : cur.value;
  input.value = String(Math.min(max, Math.max(1, base + delta)));
  state.touched.add(inputId === 'b-guests' ? 'guests' : 'nights');
  renderForm();
}

/* ---------- События ---------- */
dom.pins.addEventListener('click', (e) => {
  const pin = e.target.closest('.pin');
  if (pin) select(pin.dataset.id, 'map');
});
dom.list.addEventListener('click', (e) => {
  const btn = e.target.closest('.house');
  if (btn) select(btn.dataset.id, 'list');
});

dom.fGuests.addEventListener('change', applyFilters);
dom.fPrice.addEventListener('input', applyFilters);
dom.fFree.addEventListener('change', applyFilters);
dom.fReset.addEventListener('click', resetFilters);

dom.guests.addEventListener('input', () => { state.touched.add('guests'); renderForm(); });
dom.nights.addEventListener('input', () => { state.touched.add('nights'); renderForm(); });
dom.form.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-step]');
  if (btn) step(btn.dataset.step, Number(btn.dataset.delta));
});
dom.form.addEventListener('submit', submitBooking);

dom.bookingsBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cancel]');
  if (btn) armConfirm(btn, 'Точно отменить?', () => cancelBooking(btn.dataset.cancel));
});
dom.demoReset.addEventListener('click', () => {
  armConfirm(dom.demoReset, 'Удалить все брони? Нажмите ещё раз', resetDemo);
});

/* ---------- Старт ---------- */
buildHouses();
plantTrees();
render();

if (loaded.error === 'blocked') {
  notify('Браузер запретил сохранение. Брони будут работать до закрытия вкладки.', 'warn');
} else if (loaded.error === 'corrupt') {
  notify('Сохранённые брони повреждены и не загружены. Можно бронировать заново.', 'warn');
} else if (loaded.error === 'partial') {
  notify('Часть сохранённых броней повреждена и пропущена.', 'warn');
}
