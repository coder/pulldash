import type { ReviewComment } from "@/api/types";
import { useGitHub, type Review } from "@/browser/contexts/github";
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

    let newReview: Review | null = null;

    try {
      // Get the pending review node ID (from GraphQL)
      const reviewNodeId = store.getPendingReviewNodeId();

      if (reviewNodeId) {
        // Submit via GraphQL - we'll find the review ID after refreshing
        await github.submitPendingReview(reviewNodeId, event, state.reviewBody);
      } else if (state.pendingComments.length > 0) {
        // Fallback: create a new review with all comments via REST
        newReview = await github.createPRReview(owner, repo, pr.number, {
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
        newReview = await github.createPRReview(owner, repo, pr.number, {
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

      // Refresh comments and reviews
      const [newComments, reviews] = await Promise.all([
        github.getPRComments(owner, repo, pr.number),
        github.getPRReviews(owner, repo, pr.number),
      ]);
      store.setComments(newComments as ReviewComment[]);
      store.setReviews(reviews);

      // If we got the review ID from REST, use it; otherwise find the latest review
      let scrollTarget: string | undefined;
      if (newReview?.id) {
        scrollTarget = `pullrequestreview-${newReview.id}`;
      } else if (reviews.length > 0) {
        // Find the most recent review (likely the one we just submitted)
        const sortedReviews = [...reviews].sort(
          (a, b) =>
            new Date(b.submitted_at ?? 0).getTime() -
            new Date(a.submitted_at ?? 0).getTime()
        );
        if (sortedReviews[0]) {
          scrollTarget = `pullrequestreview-${sortedReviews[0].id}`;
        }
      }

      store.clearReviewState();

      // Navigate to overview page and scroll to the new review
      store.selectOverview(scrollTarget);
    } finally {
      store.setSubmittingReview(false);
    }
  };

  return { submitReview };
}
