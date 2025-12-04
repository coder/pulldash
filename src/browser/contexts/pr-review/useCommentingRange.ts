import { useMemo } from "react";
import { usePRReviewSelector } from ".";

/**
 * Get commenting range computed once at parent level.
 */
export function useCommentingRange(): { start: number; end: number } | null {
  const commentingOnLine = usePRReviewSelector((s) => s.commentingOnLine);

  return useMemo(() => {
    if (!commentingOnLine) return null;
    const start = commentingOnLine.startLine ?? commentingOnLine.line;
    const end = commentingOnLine.line;
    return { start, end };
  }, [commentingOnLine]);
}
