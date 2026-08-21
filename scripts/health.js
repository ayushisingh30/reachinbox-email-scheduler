#!/usr/bin/env node
'use strict';

/**
 * Prints the backend health report.
 *
 *   npm run health
 *   npm run health -- https://reachinbox-api.onrender.com
 *
 * Exits non-zero when a dependency is down, so it works in CI or a deploy gate.
 */

const target = (process.argv[2] || process.env.BACKEND_URL || 'http://localhost:5000').replace(
  /\/+$/,
  ''
);
const url = `${target}/api/health`;

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    console.error(`✖ Cannot reach ${url}`);
    console.error(`  ${err.name === 'AbortError' ? 'Request timed out.' : err.message}`);
    console.error('  Is the API running?  npm run dev:backend');
    process.exitCode = 1;
    return;
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null);
  const data = payload?.data ?? {};

  const mark = (value) => (value === 'connected' || value === 'healthy' || value === 'configured' ? '✔' : '✖');

  console.log(`\n  ${url}\n`);
  console.log(`  ${mark(data.api)} api        ${data.api ?? 'unknown'}`);
  console.log(`  ${mark(data.database)} database   ${data.database ?? 'unknown'}`);
  console.log(`  ${mark(data.redis)} redis      ${data.redis ?? 'unknown'}`);
  console.log(`  ${mark(data.smtp)} smtp       ${data.smtp ?? 'unknown'}`);

  if (data.queue) {
    const counts = Object.entries(data.queue)
      .map(([key, value]) => `${key}=${value}`)
      .join('  ');
    console.log(`\n  queue      ${counts}`);
  }

  console.log(`\n  uptime     ${data.uptimeSeconds ?? '?'}s\n`);

  // Set the code rather than calling process.exit(), so the fetch handle can
  // unwind cleanly (an abrupt exit trips a libuv assertion on Windows).
  process.exitCode = response.ok ? 0 : 1;
}

main();
