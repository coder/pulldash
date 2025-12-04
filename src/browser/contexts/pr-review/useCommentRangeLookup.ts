import { useMemo } from "react";
import { usePRReviewSelector } from ".";

/**
 * Get pre-computed comment range lookup for current file.
 * Returns a Set for O(1) lookups.
 */
export function useCommentRangeLookup(): Set<number> | null {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const commentRangeLookup = usePRReviewSelector((s) => s.commentRangeLookup);

  return useMemo(() => {
    if (!selectedFile) return null;
    return commentRangeLookup[selectedFile] ?? null;
  }, [selectedFile, commentRangeLookup]);
}
