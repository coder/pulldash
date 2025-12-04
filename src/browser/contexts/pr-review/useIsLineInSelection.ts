import { usePRReviewSelector } from ".";

/** Check if a specific line is in the selection range */
export function useIsLineInSelection(
  lineNumber: number,
  side: "old" | "new"
): boolean {
  return usePRReviewSelector((s) => {
    if (!s.focusedLine || !s.focusedLineSide) return false;
    // Must match side
    if (s.focusedLineSide !== side) return false;
    if (!s.selectionAnchor) return s.focusedLine === lineNumber;
    // For selection ranges, we currently only support same-side selection
    if (s.selectionAnchorSide !== side)
      return s.focusedLine === lineNumber && s.focusedLineSide === side;
    const start = Math.min(s.focusedLine, s.selectionAnchor);
    const end = Math.max(s.focusedLine, s.selectionAnchor);
    return lineNumber >= start && lineNumber <= end;
  });
}
