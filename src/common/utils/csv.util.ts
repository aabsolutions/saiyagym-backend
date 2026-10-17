type Cell = string | number | boolean | Date | null | undefined;

/**
 * RFC 4180 cell + CSV/formula-injection guard: user text starting with = + - @ (or tab/CR) would
 * be executed as a formula by Excel/Sheets when the file is opened ("=HYPERLINK(...)" etc.).
 * Such cells are prefixed with a single quote. Numbers are emitted as-is (negatives are fine).
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let text = value instanceof Date ? value.toISOString() : value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Invisible marker that makes Excel read the file as UTF-8 (accents). Written as a code point, never as a literal. */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Header + rows, CRLF line endings, UTF-8 BOM so Excel detects accents correctly. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
