import { useMemo } from "react";
import { usePRReviewSelector } from ".";

/** Get the selection range for line highlighting */
export function useSelectionRange(): { start: number; end: number } | null {
  const focusedLine = usePRReviewSelector((s) => s.focusedLine);
  const selectionAnchor = usePRReviewSelector((s) => s.selectionAnchor);
  return useMemo(() => {
    if (!focusedLine) return null;
    if (!selectionAnchor) return { start: focusedLine, end: focusedLine };
    return {
      start: Math.min(focusedLine, selectionAnchor),
      end: Math.max(focusedLine, selectionAnchor),
    };
  }, [focusedLine, selectionAnchor]);
}
