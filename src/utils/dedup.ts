/**
 * Removes consecutive duplicate values from an array using a custom comparison function.
 * Non-consecutive duplicates are preserved.
 *
 * @param array - The input array to deduplicate
 * @param compareFn - Function to compare if two elements are equal.
 *                    Defaults to strict equality (===)
 * @returns A new array with consecutive duplicates removed
 *
 * @example
 * // Using default comparison (strict equality)
 * dedup([1, 1, 2, 2, 3]) // => [1, 2, 3]
 *
 * // Using custom comparison for objects
 * dedup([{id: 1}, {id: 1}, {id: 2}], (a, b) => a.id === b.id) // => [{id: 1}, {id: 2}]
 *
 * // Using custom comparison for case-insensitive strings
 * dedup(['A', 'a', 'B'], (a, b) => a.toLowerCase() === b.toLowerCase()) // => ['A', 'B']
 */
export function dedup<T>(
  array: T[],
  compareFn: (a: T, b: T) => boolean = (a, b) => a === b,
): T[] {
  // Handle edge cases: empty arrays or single-element arrays
  if (array.length <= 1) {
    // Return a copy to avoid mutating the original array
    return array.slice();
  }

  // Initialize result with the first element (always keep the first item)
  const result: T[] = [array[0]];

  // Iterate through the array starting from the second element
  for (let i = 1; i < array.length; i++) {
    // Only add the current element if it's different from the previous one
    // Use the custom comparison function to determine equality
    if (!compareFn(array[i], array[i - 1])) {
      result.push(array[i]);
    }
    // Skip consecutive duplicates (they won't be added to result)
  }

  return result;
}
