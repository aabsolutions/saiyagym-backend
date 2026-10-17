import { csvCell, toCsv, UTF8_BOM } from './csv.util';

describe('csv', () => {
  it('quotes cells with commas, quotes or newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralizes formula injection in user text', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('keeps numbers, booleans, dates and empties as values', () => {
    expect(csvCell(-2.5)).toBe('-2.5');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(new Date('2024-01-01T00:00:00Z'))).toBe('2024-01-01T00:00:00.000Z');
    expect(csvCell(null)).toBe('');
  });

  it('builds a BOM-prefixed CRLF document', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe(`${UTF8_BOM}a,b\r\n1,x\r\n`);
  });
});
