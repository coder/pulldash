import { usePRReviewSelector } from ".";

/** Check if a specific line is being commented on */
export function useIsLineCommenting(lineNumber: number): boolean {
  return usePRReviewSelector((s) => s.commentingOnLine?.line === lineNumber);
}
