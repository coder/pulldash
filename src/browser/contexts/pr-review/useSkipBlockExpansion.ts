import { useCallback } from "react";
import { useGitHub } from "@/browser/contexts/github";
import { diffService } from "@/browser/lib/diff";
import { usePRReviewStore, usePRReviewSelector, type DiffLine } from ".";

export function useSkipBlockExpansion() {
  const store = usePRReviewStore();
  const github = useGitHub();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const expandedSkipBlocks = usePRReviewSelector((s) => s.expandedSkipBlocks);
  const expandingSkipBlocks = usePRReviewSelector((s) => s.expandingSkipBlocks);

  const expandSkipBlock = useCallback(
    async (skipIndex: number, startLine: number, count: number) => {
      if (!selectedFile) return;

      const key = store.getSkipBlockKey(selectedFile, skipIndex);

      // Already expanded or expanding
      if (expandedSkipBlocks[key] || expandingSkipBlocks.has(key)) return;

      store.setSkipBlockExpanding(key, true);

      try {
        // Fetch the file content from the head commit
        const content = await github.getFileContent(
          owner,
          repo,
          selectedFile,
          pr.head.sha
        );

        if (!content) {
          console.error("Failed to fetch file for skip block expansion");
          return;
        }

        // Get highlighted lines via WebWorker
        const expandedLines = await diffService.highlightLines(
          content,
          selectedFile,
          startLine,
          count
        );

        store.setExpandedSkipBlock(key, expandedLines);

        // Focus the first expanded line so user can continue with keyboard
        if (expandedLines.length > 0) {
          const firstLine = expandedLines[0];
          const firstLineNum =
            firstLine.newLineNumber || firstLine.oldLineNumber;
          if (firstLineNum) {
            store.setFocusedLine(firstLineNum, "new");
          }
        }
      } catch (error) {
        console.error("Failed to expand skip block:", error);
      } finally {
        store.setSkipBlockExpanding(key, false);
      }
    },
    [
      store,
      owner,
      repo,
      pr.head.sha,
      selectedFile,
      expandedSkipBlocks,
      expandingSkipBlocks,
    ]
  );

  // Create a getExpandedLines function that uses the subscribed state directly
  const getExpandedLines = useCallback(
    (skipIndex: number): DiffLine[] | null => {
      if (!selectedFile) return null;
      const key = `${selectedFile}:${skipIndex}`;
      return expandedSkipBlocks[key] ?? null;
    },
    [selectedFile, expandedSkipBlocks]
  );

  const isExpanding = useCallback(
    (skipIndex: number): boolean => {
      if (!selectedFile) return false;
      const key = `${selectedFile}:${skipIndex}`;
      return expandingSkipBlocks.has(key);
    },
    [selectedFile, expandingSkipBlocks]
  );

  return { expandSkipBlock, isExpanding, getExpandedLines };
}
