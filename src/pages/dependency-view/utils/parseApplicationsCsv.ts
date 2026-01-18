export type ApplicationsCsvRow = {
  id: string;
  name: string;
  criticality: 'high' | 'medium' | 'low';
  lifecycle: string;
  lifecycleState: string;
  _row: number;
};

export type ApplicationsCsvParseSuccess = {
  ok: true;
  applications: ApplicationsCsvRow[];
};

export type ApplicationsCsvParseFailure = {
  ok: false;
  errors: string[];
};

export type ApplicationsCsvParseResult = ApplicationsCsvParseSuccess | ApplicationsCsvParseFailure;

const normalizeHeader = (value: string) => value.trim().toLowerCase();

const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// Minimal CSV parser that supports:
// - commas
// - quoted fields with escaped quotes ("" -> ")
// - CRLF / LF newlines
const parseCsv = (inputText: string): string[][] => {
  const text = stripBom(inputText);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    // Avoid emitting a trailing empty row from a final newline.
    const allEmpty = row.every((c) => c.trim() === '');
    if (!(row.length === 1 && allEmpty)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      pushField();
      continue;
    }

    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }

    if (ch === '\r') {
      // Handle CRLF by skipping the next LF.
      if (text[i + 1] === '\n') i += 1;
      pushField();
      pushRow();
      continue;
    }

    field += ch;
  }

  // Flush last field/row.
  pushField();
  pushRow();

  // Drop trailing completely empty rows (common if file ends in newline)
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();

  return rows;
};

export function parseAndValidateApplicationsCsv(csvText: string): ApplicationsCsvParseResult {
  const errors: string[] = [];

  const rows = parseCsv(csvText);
  if (rows.length === 0) return { ok: false, errors: ['CSV is empty.'] };

  const header = rows[0].map(normalizeHeader);
  const requiredColumns = ['id', 'name', 'criticality', 'lifecycle', 'lifecycle_state'] as const;

  const indexByColumn = new Map<string, number>();
  header.forEach((h, idx) => {
    if (!h) return;
    if (h === 'lifecyclestate' || h === 'lifecycle state' || h === 'lifecycle_state') {
      if (!indexByColumn.has('lifecycle_state')) indexByColumn.set('lifecycle_state', idx);
      return;
    }
    indexByColumn.set(h, idx);
  });

  const missing = requiredColumns.filter((col) => !indexByColumn.has(col));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [`Missing required column(s): ${missing.join(', ')}.`],
    };
  }

  const applications: ApplicationsCsvRow[] = [];
  const seenIds = new Set<string>();

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];

    // Skip blank lines
    if (row.every((c) => c.trim() === '')) continue;

    const rawId = (row[indexByColumn.get('id')!] ?? '').trim();
    const rawName = (row[indexByColumn.get('name')!] ?? '').trim();
    const rawCriticality = (row[indexByColumn.get('criticality')!] ?? '').trim().toLowerCase();
    const rawLifecycle = (row[indexByColumn.get('lifecycle')!] ?? '').trim();
    const rawLifecycleState = (row[indexByColumn.get('lifecycle_state')!] ?? '').trim();

    const displayRow = r + 1; // 1-based CSV line number

    if (!rawId) errors.push(`Row ${displayRow}: id is required.`);
    if (!rawName) errors.push(`Row ${displayRow}: name is required.`);
    if (!rawLifecycle) errors.push(`Row ${displayRow}: lifecycle is required.`);
    if (!rawLifecycleState) errors.push(`Row ${displayRow}: lifecycle_state is required.`);

    if (rawId) {
      if (seenIds.has(rawId)) errors.push(`Row ${displayRow}: duplicate id "${rawId}".`);
      else seenIds.add(rawId);
    }

    if (rawCriticality !== 'high' && rawCriticality !== 'medium' && rawCriticality !== 'low') {
      errors.push(
        `Row ${displayRow}: criticality must be one of high | medium | low (got "${rawCriticality || '(blank)'}").`,
      );
    }

    if (
      rawId &&
      rawName &&
      rawLifecycle &&
      rawLifecycleState &&
      (rawCriticality === 'high' || rawCriticality === 'medium' || rawCriticality === 'low')
    ) {
      applications.push({
        id: rawId,
        name: rawName,
        criticality: rawCriticality,
        lifecycle: rawLifecycle,
        lifecycleState: rawLifecycleState,
        _row: displayRow,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (applications.length === 0) return { ok: false, errors: ['No application rows found.'] };

  return { ok: true, applications };
}
