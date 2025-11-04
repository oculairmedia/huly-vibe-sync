/**
 * Utility Functions
 * 
 * General-purpose utilities used throughout the application
 */

/**
 * Timeout wrapper for async operations
 * Races a promise against a timeout, rejecting if the timeout occurs first
 * 
 * @param {Promise} promise - The promise to wrap with a timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operation - Description of the operation (for error messages)
 * @returns {Promise} Resolves with promise result or rejects on timeout
 * 
 * @example
 * const result = await withTimeout(
 *   fetchData(),
 *   5000,
 *   'Fetching data from API'
 * );
 */
export async function withTimeout(promise, timeoutMs, operation) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms: ${operation}`)), timeoutMs)
    )
  ]);
}

/**
 * Process items in batches with concurrency control
 * Useful for rate-limiting API calls or controlling parallel operations
 * 
 * @param {Array} items - Items to process
 * @param {number} batchSize - Number of items to process concurrently
 * @param {Function} processFunction - Async function to process each item
 * @returns {Promise<Array>} Array of Promise.allSettled results
 * 
 * @example
 * const results = await processBatch(
 *   projects,
 *   5,
 *   async (project) => syncProject(project)
 * );
 */
export async function processBatch(items, batchSize, processFunction) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processFunction));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Format milliseconds duration into human-readable string
 * Converts ms to a compact, readable format (e.g., "2d 5h", "45m 30s")
 * 
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 * 
 * @example
 * formatDuration(90000)    // "1m 30s"
 * formatDuration(3600000)  // "1h 0m"
 * formatDuration(86400000) // "1d 0h"
 */
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
