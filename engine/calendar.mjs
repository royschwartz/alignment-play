// The calendar is derived from story minutes (spec/time.md). Never the device date.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export function makeCalendar({ year, month, day, hour }) {
  const base = Date.UTC(year, month - 1, day, hour, 0);
  const startOfDay = hour * 60;
  const startWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const at = minute => {
    const d = new Date(base + minute * 60000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(),
      hour: d.getUTCHours(), min: d.getUTCMinutes(), weekday: d.getUTCDay() };
  };
  const dayIndex = minute => Math.floor((startOfDay + minute) / 1440);
  const minuteOfDay = minute => (((startOfDay + minute) % 1440) + 1440) % 1440;
  // The story minute at which a given day (0 = the first day) reaches an hour.
  const minuteAt = (day, hourOfDay, min = 0) => day * 1440 + hourOfDay * 60 + min - startOfDay;
  const weekday = minute => (startWeekday + dayIndex(minute)) % 7;
  const weekIndex = minute => Math.floor((dayIndex(minute) + startWeekday) / 7);

  return { at, dayIndex, minuteOfDay, minuteAt, weekday, weekIndex, dateLabel, timeLabel };

  function dateLabel(minute) {
    const c = at(minute);
    return `${MONTHS[c.month]} ${ordinal(c.date)}, ${c.year}`;
  }
  // "6 PM" on the hour, as in Roy's mockup; "6:05 PM" between.
  function timeLabel(minute) {
    const c = at(minute), h = c.hour % 12 || 12, half = c.hour < 12 ? 'AM' : 'PM';
    return c.min ? `${h}:${String(c.min).padStart(2, '0')} ${half}` : `${h} ${half}`;
  }
}

export function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return n + (teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

// Hour windows may run past midnight: [21, 32] means 9 pm to 8 am.
export function inHours(minuteOfDay, [from, to]) {
  const h = minuteOfDay / 60;
  if (to <= 24) return h >= from && h < to;
  return h >= from || h < to - 24;
}

export function band(minuteOfDay) {
  const h = minuteOfDay / 60;
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}
