import { useMemo } from "react";
import type { PullRequestFile } from "@/api/types";
import { usePRReviewSelector } from ".";

/** Get the current file object */
export function useCurrentFile(): PullRequestFile | null {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const files = usePRReviewSelector((s) => s.files);
  return useMemo(() => {
    if (!selectedFile) return null;
    return files.find((f) => f.filename === selectedFile) ?? null;
  }, [selectedFile, files]);
}
