import { usePRReviewSelector } from ".";

/** Check if a specific line is within a comment's range (for multi-line comments) */
export function useIsLineInCommentRange(lineNumber: number): boolean {
  // Use pre-computed lookup for O(1) check (Fix 3)
  return usePRReviewSelector((s) => {
    if (!s.selectedFile) return false;
    const lookup = s.commentRangeLookup[s.selectedFile];
    return lookup?.has(lineNumber) ?? false;
  });
}
