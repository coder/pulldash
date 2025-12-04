import { useMemo } from "react";
import { usePRReviewSelector } from ".";

/** Get comment counts per file */
export function useCommentCountsByFile(): Record<string, number> {
  const comments = usePRReviewSelector((s) => s.comments);
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of comments) {
      counts[c.path] = (counts[c.path] || 0) + 1;
    }
    return counts;
  }, [comments]);
}
