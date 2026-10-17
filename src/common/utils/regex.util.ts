/** Escapes user input before using it inside a RegExp / Mongo `$regex` (prevents ReDoS & injection). */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
