'use strict';

const crypto = require('node:crypto');
const { HOUR_MS } = require('../utils/time');

/**
 * Decides when each recipient is sent, honouring both constraints up front:
 *
 *   spacing window : startMs + index * delayBetweenEmails
 *   hourly window  : startMs + wave * 1 hour + positionInWave * delayBetweenEmails
 *
 * The later of the two wins, so 1000 emails with a 100/hour limit are spread
 * over ten hourly waves instead of being queued for one instant and then all
 * bounced forward by the worker. The worker still enforces both rules itself,
 * because a direct API call must not be able to bypass them.
 *
 * Pure function - no I/O - so the scheduling maths is unit testable.
 */
function planSchedule({ startMs, count, delayMs, hourlyLimit }) {
  const times = new Array(count);
  const gap = Math.max(0, delayMs);
  const limit = Math.max(1, hourlyLimit);

  for (let index = 0; index < count; index += 1) {
    const wave = Math.floor(index / limit);
    const positionInWave = index % limit;

    // Spacing measured from the start of the run...
    const bySpacing = startMs + index * gap;
    // ...and spacing measured from the start of this hourly wave, so a wave
    // does not dump its whole allowance on the hour boundary.
    const byHourlyWave = startMs + wave * HOUR_MS + positionInWave * gap;

    times[index] = Math.max(bySpacing, byHourlyWave);
  }

  return times;
}

/** Stable per-(campaign, recipient) identity; the DB unique index enforces it. */
function idempotencyKeyFor(campaignId, recipient) {
  return crypto.createHash('sha256').update(`${campaignId}:${recipient}`).digest('hex');
}

module.exports = { planSchedule, idempotencyKeyFor };
