/**
 * Splits an array into chunks of a specified size.
 * The last chunk may contain fewer elements if the array length
 * is not evenly divisible by the chunk size.
 *
 * @param array - The input array to be chunked
 * @param size - The size of each chunk (must be greater than 0)
 * @returns A new array containing arrays of the specified chunk size
 * @throws Error if size is less than or equal to 0
 *
 * @example
 * chunk(['a', 'b', 'c', 'd'], 2) // => [['a', 'b'], ['c', 'd']]
 * chunk([1, 2, 3, 4, 5], 3) // => [[1, 2, 3], [4, 5]]
 * chunk(['a'], 2) // => [['a']]
 * ch
 */
export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than 0');
  }

  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
