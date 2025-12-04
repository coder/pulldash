import { usePRReviewSelector } from ".";

/**
 * Get selection boundary info for a specific line (for drawing selection outline).
 * Uses a single selector that returns primitives to avoid re-renders of unaffected lines.
 */
export function useSelectionBoundary(
  lineNumber: number,
  side: "old" | "new"
): { isFirst: boolean; isLast: boolean; isInSelection: boolean } {
  // Use separate selectors that return booleans - only re-renders when THIS line's state changes
  const isInSelection = usePRReviewSelector((s) => {
    if (!s.focusedLine || !s.focusedLineSide) return false;
    if (s.focusedLineSide !== side) return false;
    if (!s.selectionAnchor || s.selectionAnchorSide !== side)
      return s.focusedLine === lineNumber;
    const start = Math.min(s.focusedLine, s.selectionAnchor);
    const end = Math.max(s.focusedLine, s.selectionAnchor);
    return lineNumber >= start && lineNumber <= end;
  });

  const isFirst = usePRReviewSelector((s) => {
    if (!s.focusedLine || !s.focusedLineSide) return false;
    if (s.focusedLineSide !== side) return false;
    if (!s.selectionAnchor || s.selectionAnchorSide !== side)
      return s.focusedLine === lineNumber;
    return lineNumber === Math.min(s.focusedLine, s.selectionAnchor);
  });

  const isLast = usePRReviewSelector((s) => {
    if (!s.focusedLine || !s.focusedLineSide) return false;
    if (s.focusedLineSide !== side) return false;
    if (!s.selectionAnchor || s.selectionAnchorSide !== side)
      return s.focusedLine === lineNumber;
    return lineNumber === Math.max(s.focusedLine, s.selectionAnchor);
  });

  return { isFirst, isLast, isInSelection };
}
