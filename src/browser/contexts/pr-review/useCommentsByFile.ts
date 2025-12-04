import { useMemo } from "react";
import type { ReviewComment } from "@/api/types";
import { usePRReviewSelector } from ".";

/** Get comments grouped by file path */
export function useCommentsByFile(): Record<string, ReviewComment[]> {
  const comments = usePRReviewSelector((s) => s.comments);
  return useMemo(() => {
    const grouped: Record<string, ReviewComment[]> = {};
    for (const comment of comments) {
      if (!grouped[comment.path]) grouped[comment.path] = [];
      grouped[comment.path].push(comment);
    }
    return grouped;
  }, [comments]);
}
