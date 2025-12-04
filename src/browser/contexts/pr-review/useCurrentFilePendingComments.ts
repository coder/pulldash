import { useMemo } from "react";
import { usePRReviewSelector, type LocalPendingComment } from ".";

const EMPTY_PENDING_COMMENTS: LocalPendingComment[] = [];

/** Get pending comments for current file */
export function useCurrentFilePendingComments(): LocalPendingComment[] {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const pendingComments = usePRReviewSelector((s) => s.pendingComments);
  return useMemo(() => {
    if (!selectedFile) return EMPTY_PENDING_COMMENTS;
    return pendingComments.filter((c) => c.path === selectedFile);
  }, [selectedFile, pendingComments]);
}
