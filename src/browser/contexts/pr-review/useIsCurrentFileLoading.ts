import { useMemo } from "react";
import { usePRReviewSelector } from ".";

/** Check if current file is loading */
export function useIsCurrentFileLoading(): boolean {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const loadingFiles = usePRReviewSelector((s) => s.loadingFiles);
  return useMemo(() => {
    if (!selectedFile) return false;
    return loadingFiles.has(selectedFile);
  }, [selectedFile, loadingFiles]);
}
