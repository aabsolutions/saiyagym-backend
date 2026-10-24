import { plainToInstance } from 'class-transformer';
import { IsNumber, IsOptional, validateSync } from 'class-validator';
import { RoundDecimals, roundTo } from './round-decimals.decorator';

class Body {
  @IsOptional()
  @RoundDecimals(3)
  @IsNumber({ maxDecimalPlaces: 3 })
  weightKg?: number | null;
}

const parse = (weightKg: unknown) => plainToInstance(Body, { weightKg });

describe('RoundDecimals', () => {
  it('rounds a converted imperial value so maxDecimalPlaces accepts it', () => {
    const body = parse(225 * 0.45359237); // 225 lb
    expect(body.weightKg).toBe(102.058);
    expect(validateSync(body)).toHaveLength(0);
  });

  it('keeps values that already fit', () => {
    expect(parse(102.5).weightKg).toBe(102.5);
    expect(parse(0).weightKg).toBe(0);
  });

  it.each([null, undefined, '100', Number.NaN])('leaves %p for the validators', (value) => {
    expect(parse(value).weightKg).toBe(value);
  });

  it('rounds to the requested places', () => {
    expect(roundTo(160 * 0.45359237, 2)).toBe(72.57); // 160 lb
    expect(roundTo(32 * 2.54, 1)).toBe(81.3); // 32 in
  });
});
