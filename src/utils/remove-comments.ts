/**
 * Removes single-line comments (//) from a multi-line string.
 * Only removes comments that:
 * - Start with '//' after trimming whitespace
 * - Occupy an entire line (no code on the same line)
 *
 * @param code - The input string containing code with potential comments
 * @returns The code string with comment lines removed
 *
 * @example
 * ```typescript
 * const input = `
 * function test() {
 *   // This comment will be removed
 *   const x = 5;
 *   const y = 10; // This inline comment stays
 * }`;
 *
 * const result = removeComments(input);
 * // Result will have the first comment line removed, but keep the inline comment
 * ```
 */
export function removeComments(code: string): string {
  return code
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//');
    })
    .join('\n');
}
