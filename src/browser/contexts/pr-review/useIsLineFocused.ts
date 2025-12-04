import { usePRReviewSelector } from ".";

/** Check if a specific line is focused (for DiffLine component) */
export function useIsLineFocused(
  lineNumber: number,
  side: "old" | "new"
): boolean {
  return usePRReviewSelector(
    (s) => s.focusedLine === lineNumber && s.focusedLineSide === side
  );
}
