import { useEffect } from "react";
import { useGitHubStore, useGitHubSelector } from "@/browser/contexts/github";
import {
  usePRReviewStore,
  usePRReviewSelector,
  type LocalPendingComment,
} from ".";

export function usePendingReviewLoader() {
  const store = usePRReviewStore();
  const github = useGitHubStore();
  const ready = useGitHubSelector((s) => s.ready);
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);

  useEffect(() => {
    if (!ready) return;

    const fetchPendingReview = async () => {
      try {
        const result = await github.getPendingReview(owner, repo, pr.number);
        if (!result) return; // No pending review

        // Store the review node ID for submission
        store.setPendingReviewNodeId(result.id);

        // Convert to local comments
        const localComments: LocalPendingComment[] = result.comments.nodes.map(
          (c) => ({
            id: `github-${c.databaseId}`,
            nodeId: c.id,
            databaseId: c.databaseId,
            path: c.path,
            line: c.line,
            start_line: c.startLine || undefined,
            body: c.body,
            side: "RIGHT" as const,
          })
        );

        store.setPendingComments(localComments);
      } catch (error) {
        console.error("Failed to fetch pending review:", error);
      }
    };

    fetchPendingReview();
  }, [github, owner, repo, pr.number, store]);
}
