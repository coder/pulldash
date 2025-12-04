import { usePRReviewSelector } from ".";

/** Check if a specific line is in the commenting range */
export function useIsLineInCommentingRange(lineNumber: number): boolean {
  return usePRReviewSelector((s) => {
    if (!s.commentingOnLine) return false;
    const start = s.commentingOnLine.startLine ?? s.commentingOnLine.line;
    const end = s.commentingOnLine.line;
    return lineNumber >= start && lineNumber <= end;
  });
}
