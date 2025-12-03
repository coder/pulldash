/**
 * Diff Service - Async API wrapper for the diff WebWorker
 *
 * Usage:
 *   import { diffService } from './diff';
 *   const parsed = await diffService.parseDiff(patch, filename);
 */

import type {
  WorkerRequest,
  WorkerResponse,
  ParsedDiff,
  DiffLine,
} from "./diff-worker";

// Re-export types for consumers
export type {
  ParsedDiff,
  DiffLine,
  DiffHunk,
  DiffSkipBlock,
  LineSegment,
} from "./diff-worker";

// ============================================================================
// Worker Pool
// ============================================================================

// Use all available cores, minimum 4, no upper cap
const POOL_SIZE = Math.max(navigator.hardwareConcurrency || 4, 4);

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

class DiffWorkerPool {
  private workers: Worker[] = [];
  private pendingRequests = new Map<string, PendingRequest>();
  private nextId = 0;
  private nextWorkerIndex = 0;
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;

    for (let i = 0; i < POOL_SIZE; i++) {
      const worker = new Worker("/lib/diff-worker.js", { type: "module" });

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        const pending = this.pendingRequests.get(response.id);
        if (!pending) return;

        this.pendingRequests.delete(response.id);

        if (response.type === "error") {
          pending.reject(new Error(response.error));
        } else {
          pending.resolve(response.result);
        }
      };

      worker.onerror = (error) => {
        console.error("Diff worker error:", error);
      };

      this.workers.push(worker);
    }
  }

  private getNextWorker(): Worker {
    this.ensureInitialized();
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % POOL_SIZE;
    return worker;
  }

  private generateId(): string {
    return `${Date.now()}-${this.nextId++}`;
  }

  async parseDiff(
    patch: string,
    filename: string,
    previousFilename?: string
  ): Promise<ParsedDiff> {
    const id = this.generateId();
    const worker = this.getNextWorker();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      worker.postMessage({
        type: "parse-diff",
        id,
        patch,
        filename,
        previousFilename,
      } as WorkerRequest);
    });
  }

  async highlightLines(
    content: string,
    filename: string,
    startLine: number,
    count: number
  ): Promise<DiffLine[]> {
    const id = this.generateId();
    const worker = this.getNextWorker();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      worker.postMessage({
        type: "highlight-lines",
        id,
        content,
        filename,
        startLine,
        count,
      } as WorkerRequest);
    });
  }

  /**
   * Parse multiple diffs in parallel across the worker pool.
   */
  async parseDiffBatch(
    items: Array<{
      patch: string;
      filename: string;
      previousFilename?: string;
    }>
  ): Promise<ParsedDiff[]> {
    return Promise.all(
      items.map((item) =>
        this.parseDiff(item.patch, item.filename, item.previousFilename)
      )
    );
  }

  /**
   * Terminate all workers (call on app unmount if needed).
   */
  terminate() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.pendingRequests.clear();
    this.initialized = false;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const diffService = new DiffWorkerPool();

// ============================================================================
// Cache Layer (optional, for repeated diff parsing)
// ============================================================================

const diffCache = new Map<string, ParsedDiff>();
const MAX_CACHE_SIZE = 500;

function getCacheKey(
  patch: string,
  filename: string,
  previousFilename?: string
): string {
  // Use a simple hash of the content
  let hash = 0;
  const str = `${filename}|${previousFilename || ""}|${patch}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return String(hash);
}

/**
 * Parse diff with caching.
 * Use this for diffs that may be re-parsed (e.g., when scrolling in/out of view).
 */
export async function parseDiffCached(
  patch: string,
  filename: string,
  previousFilename?: string
): Promise<ParsedDiff> {
  const key = getCacheKey(patch, filename, previousFilename);

  const cached = diffCache.get(key);
  if (cached) {
    return cached;
  }

  const result = await diffService.parseDiff(patch, filename, previousFilename);

  // Evict old entries if cache is full
  if (diffCache.size >= MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(diffCache.keys()).slice(0, 100);
    keysToDelete.forEach((k) => diffCache.delete(k));
  }

  diffCache.set(key, result);
  return result;
}

/**
 * Clear the diff cache.
 */
export function clearDiffCache() {
  diffCache.clear();
}
