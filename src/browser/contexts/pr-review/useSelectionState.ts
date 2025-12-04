import { useMemo } from "react";
import { usePRReviewSelector } from ".";

export interface SelectionState {
  focusedLine: number | null;
  focusedLineSide: "old" | "new" | null;
  selectionAnchor: number | null;
  selectionAnchorSide: "old" | "new" | null;
  selectionStart: number | null;
  selectionEnd: number | null;
}

/**
 * Get the complete selection state computed once at the parent level.
 * This replaces per-line subscriptions with a single subscription (Fix 1).
 */
export function useSelectionState(): SelectionState {
  const focusedLine = usePRReviewSelector((s) => s.focusedLine);
  const focusedLineSide = usePRReviewSelector((s) => s.focusedLineSide);
  const selectionAnchor = usePRReviewSelector((s) => s.selectionAnchor);
  const selectionAnchorSide = usePRReviewSelector((s) => s.selectionAnchorSide);

  return useMemo(() => {
    let selectionStart: number | null = null;
    let selectionEnd: number | null = null;

    if (focusedLine !== null) {
      if (selectionAnchor !== null) {
        selectionStart = Math.min(focusedLine, selectionAnchor);
        selectionEnd = Math.max(focusedLine, selectionAnchor);
      } else {
        selectionStart = focusedLine;
        selectionEnd = focusedLine;
      }
    }

    return {
      focusedLine,
      focusedLineSide,
      selectionAnchor,
      selectionAnchorSide,
      selectionStart,
      selectionEnd,
    };
  }, [focusedLine, focusedLineSide, selectionAnchor, selectionAnchorSide]);
}
