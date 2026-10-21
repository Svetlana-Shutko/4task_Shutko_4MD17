// Сохранение броней в localStorage под одним ключом приложения.
// Весь localStorage никогда не очищается — только наш ключ.

const KEY = 'elovyi-mys:bookings:v1';

const empty = () => ({ bookings: [], seq: 0 });

/**
 * Загружает сохранённые брони.
 * Возвращает { data, error }, где error:
 *   null      — всё в порядке;
 *   'blocked' — браузер запретил доступ к хранилищу;
 *   'corrupt' — данные повреждены и не загружены;
 *   'partial' — часть записей повреждена и пропущена.
 */
export function loadState(isValidBooking) {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { data: empty(), error: 'blocked' };
  }
  if (raw === null) return { data: empty(), error: null };

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.bookings)) throw new Error('bad shape');

    const seen = new Set();
    const bookings = parsed.bookings.filter((b) => {
      if (!isValidBooking(b) || seen.has(b.houseId)) return false;
      seen.add(b.houseId);
      return true;
    });

    const maxNum = bookings.reduce((m, b) => Math.max(m, b.num), 0);
    const seq = Number.isInteger(parsed.seq) && parsed.seq >= maxNum ? parsed.seq : maxNum;
    const error = bookings.length !== parsed.bookings.length ? 'partial' : null;
    return { data: { bookings, seq }, error };
  } catch {
    return { data: empty(), error: 'corrupt' };
  }
}

/** Сохраняет брони. Возвращает false, если браузер не дал записать. */
export function saveState(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ bookings: data.bookings, seq: data.seq }));
    return true;
  } catch {
    return false;
  }
}

/** Удаляет только ключ приложения. */
export function clearState() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
