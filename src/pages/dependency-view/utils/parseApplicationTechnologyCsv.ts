import { type RelationshipType } from './eaMetaModel';

export type ApplicationTechnologyCsvRow = {
  applicationId: string;
  technologyId: string;
  relationshipType: RelationshipType;
  attributes: Record<string, unknown>;
};

export type ApplicationTechnologyCsvParseSuccess = {
  ok: true;
  mappings: ApplicationTechnologyCsvRow[];
};

export type ApplicationTechnologyCsvParseFailure = {
  ok: false;
  errors: string[];
};

export type ApplicationTechnologyCsvParseResult =
  | ApplicationTechnologyCsvParseSuccess
  | ApplicationTechnologyCsvParseFailure;

const normalizeHeader = (value: string) => value.trim().toLowerCase();

const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

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
      if (text[i + 1] === '\n') i += 1;
      pushField();
      pushRow();
      continue;
    }

    field += ch;
  }

  pushField();
  pushRow();

  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();

  return rows;
};

export function parseAndValidateApplicationTechnologyCsv(csvText: string): ApplicationTechnologyCsvParseResult {
  const errors: string[] = [];

  const rows = parseCsv(csvText);
  if (rows.length === 0) return { ok: false, errors: ['CSV is empty.'] };

  const header = rows[0].map(normalizeHeader);
  const requiredColumns = ['applicationid', 'technologyid'] as const;

  const indexByColumn = new Map<string, number>();
  header.forEach((h, idx) => {
    if (h) indexByColumn.set(h, idx);
  });

  const missing = requiredColumns.filter((col) => !indexByColumn.has(col));
  if (missing.length > 0) {
    return { ok: false, errors: [`Missing required column(s): ${missing.join(', ')}.`] };
  }

  const relationshipTypeIdx = indexByColumn.get('relationshiptype');

  const mappings: ApplicationTechnologyCsvRow[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (row.every((c) => c.trim() === '')) continue;

    const displayRow = r + 1;

    const rawAppId = (row[indexByColumn.get('applicationid')!] ?? '').trim();
    const rawTechId = (row[indexByColumn.get('technologyid')!] ?? '').trim();

    const rawRelType =
      relationshipTypeIdx === undefined ? '' : (row[relationshipTypeIdx] ?? '').trim().toUpperCase();

    if (!rawAppId) errors.push(`Row ${displayRow}: applicationId is required.`);
    if (!rawTechId) errors.push(`Row ${displayRow}: technologyId is required.`);

    // Mapping rule: application -> technology uses DEPLOYED_ON.
    const relationshipType: RelationshipType = 'DEPLOYED_ON';
    if (rawRelType && rawRelType !== 'DEPLOYED_ON') {
      errors.push(
        `Row ${displayRow}: relationshipType must be DEPLOYED_ON for Application–Technology mappings (got "${rawRelType}").`,
      );
    }

    const attributes: Record<string, unknown> = {};
    for (const [col, idx] of indexByColumn) {
      if (col === 'applicationid' || col === 'technologyid' || col === 'relationshiptype') continue;
      const value = (row[idx] ?? '').trim();
      if (value !== '') attributes[col] = value;
    }

    if (rawAppId && rawTechId && (!rawRelType || rawRelType === 'DEPLOYED_ON')) {
      mappings.push({
        applicationId: rawAppId,
        technologyId: rawTechId,
        relationshipType,
        attributes,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (mappings.length === 0) return { ok: false, errors: ['No application–technology rows found.'] };

  return { ok: true, mappings };
}
