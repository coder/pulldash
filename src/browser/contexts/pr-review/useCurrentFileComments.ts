import { useMemo } from "react";
import type { ReviewComment } from "@/api/types";
import { usePRReviewSelector } from ".";

const EMPTY_COMMENTS: ReviewComment[] = [];

/** Get comments for current file */
export function useCurrentFileComments(): ReviewComment[] {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const comments = usePRReviewSelector((s) => s.comments);
  return useMemo(() => {
    if (!selectedFile) return EMPTY_COMMENTS;
    return comments.filter((c) => c.path === selectedFile);
  }, [selectedFile, comments]);
}
