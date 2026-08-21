const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateTimeWithSeconds = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatDateTime(value, { withSeconds = false } = {}) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return (withSeconds ? dateTimeWithSeconds : dateTime).format(date);
}

/** "in 4 min" / "12 min ago" - the queue view is all about relative timing. */
export function formatRelative(value) {
  if (!value) return '';
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return '';

  const diffSeconds = Math.round((target - Date.now()) / 1000);
  const absolute = Math.abs(diffSeconds);

  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (absolute >= seconds || unit === 'second') {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return '';
}

export function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

/** Converts the millisecond delay stored on a campaign back into a readable gap. */
export function formatDelay(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** `datetime-local` inputs need a local (not UTC) "YYYY-MM-DDTHH:mm" string. */
export function toLocalInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
