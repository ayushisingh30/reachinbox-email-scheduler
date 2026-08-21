import Papa from 'papaparse';

const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isValidEmail(value) {
  const email = String(value ?? '').trim();
  if (email.length === 0 || email.length > 254) return false;
  if (email.includes('..')) return false;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at > 64) return false;
  return EMAIL_RE.test(email);
}

function unwrapAngleBrackets(cell) {
  const match = /<([^<>]+)>/.exec(cell);
  return match ? match[1] : cell;
}

/**
 * Parses an uploaded CSV/TXT in the browser purely so the compose form can show
 * counts before the user commits. The backend re-parses and re-validates the
 * same content; this is UX, not a trust boundary.
 *
 * No column name is assumed - every cell that contains an "@" is a candidate.
 */
export function parseRecipientFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: 'greedy',
      complete: ({ data }) => {
        const seen = new Set();
        const recipients = [];
        const invalidSamples = [];
        let invalidCount = 0;
        let duplicateCount = 0;

        for (const row of data) {
          const cells = Array.isArray(row) ? row : Object.values(row ?? {});

          for (const rawCell of cells) {
            const cell = unwrapAngleBrackets(String(rawCell ?? ''))
              .trim()
              .replace(/^["']|["']$/g, '')
              .trim();

            // Name and id columns simply do not participate.
            if (!cell.includes('@')) continue;

            if (!isValidEmail(cell)) {
              invalidCount += 1;
              if (invalidSamples.length < 5) invalidSamples.push(cell.slice(0, 80));
              continue;
            }

            const normalized = cell.toLowerCase();
            if (seen.has(normalized)) {
              duplicateCount += 1;
              continue;
            }
            seen.add(normalized);
            recipients.push(normalized);
          }
        }

        resolve({
          recipients,
          validCount: recipients.length,
          invalidCount,
          duplicateCount,
          invalidSamples,
        });
      },
      error: (err) => reject(new Error(err?.message || 'Could not read that file.')),
    });
  });
}
