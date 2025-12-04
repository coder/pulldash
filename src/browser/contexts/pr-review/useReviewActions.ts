import type { ReviewComment } from "@/api/types";
import { useGitHub } from "@/browser/contexts/github";
import { useTelemetry } from "@/browser/contexts/telemetry";
import { usePRReviewStore, usePRReviewSelector } from ".";

export function useReviewActions() {
  const store = usePRReviewStore();
  const github = useGitHub();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);
  const { track } = useTelemetry();

  const submitReview = async (
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  ) => {
    const state = store.getSnapshot();
    store.setSubmittingReview(true);

    try {
      // Get the pending review node ID (from GraphQL)
      const reviewNodeId = store.getPendingReviewNodeId();

      if (reviewNodeId) {
        // Submit via GraphQL
        await github.submitPendingReview(reviewNodeId, event, state.reviewBody);
      } else if (state.pendingComments.length > 0) {
        // Fallback: create a new review with all comments via REST
        await github.createPRReview(owner, repo, pr.number, {
          commit_id: pr.head.sha,
          event,
          body: state.reviewBody,
          comments: state.pendingComments.map(
            ({ path, line, body, side, start_line }) => ({
              path,
              line,
              body,
              side: side as "LEFT" | "RIGHT",
              start_line,
            })
          ),
        });
      } else {
        // Just submitting a review with no comments (APPROVE, etc)
        await github.createPRReview(owner, repo, pr.number, {
          commit_id: pr.head.sha,
          event,
          body: state.reviewBody,
          comments: [],
        });
      }

      // Track review submission
      track("review_submitted", {
        pr_number: pr.number,
        owner,
        repo,
        review_type: event,
        comment_count: state.pendingComments.length,
        files_reviewed: state.viewedFiles.size,
      });

      // Refresh comments
      const newComments = await github.getPRComments(owner, repo, pr.number);
      store.setComments(newComments as ReviewComment[]);

      store.clearReviewState();

      // Navigate to overview page after successful review submission
      store.selectOverview();
    } finally {
      store.setSubmittingReview(false);
    }
  };

  return { submitReview };
}
