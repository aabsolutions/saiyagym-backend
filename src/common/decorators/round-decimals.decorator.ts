import { Transform } from 'class-transformer';

/**
 * Rounds a number to `decimals` places before validation. Clients convert lb/in input to kg/cm
 * (225 lb → 102.05828325 kg); without this, `maxDecimalPlaces` rejects the whole document.
 * Anything that isn't a finite number passes through untouched for the validators to judge.
 */
export const RoundDecimals = (decimals: number) =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' && Number.isFinite(value) ? roundTo(value, decimals) : value,
  );

export const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
