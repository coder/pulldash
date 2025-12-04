import { useMemo } from "react";
import { usePRReviewSelector, type ParsedDiff } from ".";

/** Get the current file's diff */
export function useCurrentDiff(): ParsedDiff | null {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const loadedDiffs = usePRReviewSelector((s) => s.loadedDiffs);
  return useMemo(() => {
    if (!selectedFile) return null;
    return loadedDiffs[selectedFile] ?? null;
  }, [selectedFile, loadedDiffs]);
}
