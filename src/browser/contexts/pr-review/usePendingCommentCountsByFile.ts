import { useMemo } from "react";
import { usePRReviewSelector } from ".";

/** Get pending comments count per file */
export function usePendingCommentCountsByFile(): Record<string, number> {
  const pendingComments = usePRReviewSelector((s) => s.pendingComments);
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of pendingComments) {
      counts[c.path] = (counts[c.path] || 0) + 1;
    }
    return counts;
  }, [pendingComments]);
}
