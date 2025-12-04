import { useEffect } from "react";
import type { PullRequestFile } from "@/api/types";
import { diffService } from "@/browser/lib/diff";
import { usePRReviewStore, usePRReviewSelector, type ParsedDiff } from ".";

const diffCache = new Map<string, ParsedDiff>();
const pendingFetches = new Map<
  string,
  { promise: Promise<ParsedDiff>; controller: AbortController }
>();
const MAX_CACHE_SIZE = 100;

// Check if a diff is already cached (sync check)
function getDiffFromCache(file: PullRequestFile): ParsedDiff | null {
  if (!file.patch || !file.sha) {
    return { hunks: [] };
  }
  return diffCache.get(file.sha) ?? null;
}

// Abort all pending fetches (used when navigating rapidly)
function abortAllPendingFetches() {
  for (const [key, { controller }] of pendingFetches) {
    controller.abort();
    pendingFetches.delete(key);
  }
}

async function fetchParsedDiff(
  file: PullRequestFile,
  signal?: AbortSignal
): Promise<ParsedDiff> {
  if (!file.patch || !file.sha) {
    return { hunks: [] };
  }

  const cacheKey = file.sha;

  // Check cache first
  if (diffCache.has(cacheKey)) {
    return diffCache.get(cacheKey)!;
  }

  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // If there's already a pending fetch for this file, wait for it
  const existing = pendingFetches.get(cacheKey);
  if (existing) {
    // If caller wants to abort, wrap the promise
    if (signal) {
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort);
        existing.promise
          .then(resolve)
          .catch(reject)
          .finally(() => signal.removeEventListener("abort", onAbort));
      });
    }
    return existing.promise;
  }

  // Create new fetch with its own controller
  const controller = new AbortController();

  // Link to caller's signal
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  const fetchPromise = (async () => {
    // Use WebWorker for diff parsing (off main thread)
    const parsed = await diffService.parseDiff(
      file.patch!,
      file.filename,
      file.previous_filename
    );

    // Clean up pending entry
    pendingFetches.delete(cacheKey);

    if (!parsed.hunks) {
      return { hunks: [] };
    }

    // Add to cache
    if (diffCache.size >= MAX_CACHE_SIZE) {
      const firstKey = diffCache.keys().next().value;
      if (firstKey) diffCache.delete(firstKey);
    }
    diffCache.set(cacheKey, parsed);

    return parsed;
  })();

  pendingFetches.set(cacheKey, { promise: fetchPromise, controller });

  // Clean up on error
  fetchPromise.catch(() => {
    pendingFetches.delete(cacheKey);
  });

  return fetchPromise;
}

export function useDiffLoader() {
  const store = usePRReviewStore();
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const files = usePRReviewSelector((s) => s.files);
  const loadedDiffs = usePRReviewSelector((s) => s.loadedDiffs);

  useEffect(() => {
    if (!selectedFile) return;

    const file = files.find((f) => f.filename === selectedFile);
    if (!file) return;

    const currentFile = selectedFile;

    // Check cache synchronously - instant if cached
    const cached = getDiffFromCache(file);
    if (cached) {
      if (!loadedDiffs[currentFile]) {
        store.setLoadedDiff(currentFile, cached);
      }
      return;
    }

    // Already loaded in store
    if (loadedDiffs[currentFile]) return;

    // Abort ALL pending fetches - only care about current file
    abortAllPendingFetches();

    // Start fetch immediately (no debounce - we have deduplication)
    // Show loading only if fetch takes > 50ms
    const loadingTimeoutId = setTimeout(() => {
      if (
        store.getSnapshot().selectedFile === currentFile &&
        !store.getSnapshot().loadedDiffs[currentFile]
      ) {
        store.setDiffLoading(currentFile, true);
      }
    }, 50);

    // Fetch immediately
    fetchParsedDiff(file)
      .then((diff) => {
        if (store.getSnapshot().selectedFile === currentFile) {
          store.setLoadedDiff(currentFile, diff);
          store.setDiffLoading(currentFile, false);

          // Prefetch next files aggressively (5 ahead, 2 behind)
          const currentIndex = files.findIndex(
            (f) => f.filename === currentFile
          );
          const filesToPrefetch = [
            ...files.slice(Math.max(0, currentIndex - 2), currentIndex),
            ...files.slice(currentIndex + 1, currentIndex + 6),
          ].filter(
            (f) =>
              !store.getSnapshot().loadedDiffs[f.filename] &&
              !getDiffFromCache(f)
          );

          // Prefetch all in parallel
          Promise.all(
            filesToPrefetch.map((pfile) =>
              fetchParsedDiff(pfile)
                .then((pdiff) => store.setLoadedDiff(pfile.filename, pdiff))
                .catch(() => {})
            )
          );
        }
      })
      .catch((err) => {
        if (
          err?.name !== "AbortError" &&
          store.getSnapshot().selectedFile === currentFile
        ) {
          console.error(err);
          store.setDiffLoading(currentFile, false);
        }
      });

    // Cleanup: cancel loading timeout
    return () => {
      clearTimeout(loadingTimeoutId);
      store.setDiffLoading(currentFile, false);
    };
  }, [selectedFile, files, loadedDiffs, store]);
}
