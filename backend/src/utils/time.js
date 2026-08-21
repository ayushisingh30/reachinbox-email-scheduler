'use strict';

const HOUR_MS = 60 * 60 * 1000;

/** UTC hour bucket key, e.g. 2026-08-21-14. Stable across timezones/instances. */
function hourBucket(date = new Date()) {
  const iso = new Date(date).toISOString(); // 2026-08-21T14:33:07.123Z
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}`;
}

/** First millisecond of the next UTC clock hour after `date`. */
function nextHourStart(date = new Date()) {
  const start = new Date(date);
  start.setUTCMinutes(0, 0, 0);
  return new Date(start.getTime() + HOUR_MS);
}

/** Seconds remaining in the current UTC hour, plus a small safety margin. */
function secondsUntilNextHour(date = new Date()) {
  return Math.ceil((nextHourStart(date).getTime() - new Date(date).getTime()) / 1000);
}

module.exports = { HOUR_MS, hourBucket, nextHourStart, secondsUntilNextHour };
