// Values are stored at full precision; rounding happens only when building API responses.
// toPrecision(12) removes float noise first, so 18.225 (stored as 18.22499999...) rounds to 18.23.
function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(Number((value * factor).toPrecision(12))) / factor;
}

export function round2(value) {
  return roundTo(value, 2);
}

export function round2OrNull(value) {
  return value == null ? null : round2(value);
}

export function round6(value) {
  return roundTo(value, 6);
}

/**
 * A catalog price shown as an approximate "average market price", not the scraped figure: steps
 * get coarser as the price grows, which also rounds away the .99/.49-style shelf pricing a shown
 * exact figure would otherwise still look scraped from. Used only for catalog display values
 * (never for a user's own product prices, and never for sorting or filtering, which use the
 * precise stored figure).
 */
export function roundMarketPrice(value) {
  if (value == null) return null;
  const step = value < 5 ? 0.1 : value < 20 ? 0.5 : value < 100 ? 1 : 5;
  const rounded = Math.round(Number((value / step).toPrecision(12))) * step;
  return Number(rounded.toPrecision(12));
}

const SQLITE_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// SQLite returns CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" (UTC); PostgreSQL returns Date objects.
export function toIsoDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (SQLITE_TIMESTAMP.test(value)) return new Date(`${value.replace(' ', 'T')}Z`).toISOString();
  return new Date(value).toISOString();
}
