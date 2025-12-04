import type { ReviewComment } from "@/api/types";
import { useGitHub } from "@/browser/contexts/github";
import { useTelemetry } from "@/browser/contexts/telemetry";
import {
  usePRReviewStore,
  usePRReviewSelector,
  type LocalPendingComment,
} from ".";

export function useCommentActions() {
  const store = usePRReviewStore();
  const github = useGitHub();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);
  const { track } = useTelemetry();

  const addPendingComment = async (
    line: number,
    body: string,
    startLine?: number
  ) => {
    const state = store.getSnapshot();
    if (!state.selectedFile) return;

    // Create a local comment first for immediate UI feedback
    const localId = `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newComment: LocalPendingComment = {
      id: localId,
      path: state.selectedFile,
      line,
      start_line: startLine,
      body,
      side: "RIGHT",
    };

    store.addPendingComment(newComment);

    // Track comment added
    track("comment_added", {
      pr_number: pr.number,
      owner,
      repo,
      is_pending: true,
      has_range: !!startLine && startLine !== line,
    });

    // Sync to GitHub via GraphQL - this creates/adds to the pending review
    try {
      const result = await github.addPendingComment(owner, repo, pr.number, {
        path: state.selectedFile,
        line,
        body,
        startLine,
      });
      // Update the local comment with GitHub IDs
      store.updatePendingCommentWithGitHubIds(
        localId,
        result.reviewId,
        result.commentId,
        result.commentDatabaseId
      );
    } catch (error) {
      console.error("Failed to sync pending comment to GitHub:", error);
    }
  };

  const removePendingComment = async (id: string) => {
    const state = store.getSnapshot();
    const comment = state.pendingComments.find((c) => c.id === id);

    // Remove locally first
    store.removePendingComment(id);

    // Delete from GitHub via GraphQL if it was synced
    if (comment?.nodeId) {
      try {
        await github.deletePendingComment(comment.nodeId);
      } catch (error) {
        console.error("Failed to delete comment from GitHub:", error);
      }
    }
  };

  const updatePendingComment = async (id: string, newBody: string) => {
    const state = store.getSnapshot();
    const comment = state.pendingComments.find((c) => c.id === id);

    // Update locally first
    store.updatePendingCommentBody(id, newBody);

    // Update on GitHub via GraphQL if it was synced
    if (comment?.nodeId) {
      try {
        await github.updatePendingComment(comment.nodeId, newBody);
      } catch (error) {
        console.error("Failed to update comment on GitHub:", error);
      }
    }
  };

  const updateComment = async (commentId: number, newBody: string) => {
    try {
      const updatedComment = await github.updateComment(
        owner,
        repo,
        commentId,
        newBody
      );
      store.updateComment(commentId, updatedComment as ReviewComment);
    } catch (error) {
      console.error("Failed to update comment:", error);
    }
  };

  const deleteComment = async (commentId: number) => {
    try {
      await github.deleteComment(owner, repo, commentId);
      store.deleteComment(commentId);
    } catch (error) {
      console.error("Failed to delete comment:", error);
    }
  };

  const replyToComment = async (commentId: number, body: string) => {
    try {
      const newComment = await github.createPRComment(
        owner,
        repo,
        pr.number,
        body,
        {
          reply_to_id: commentId,
        }
      );
      store.addReply(newComment as ReviewComment);
    } catch (error) {
      console.error("Failed to reply to comment:", error);
    }
  };

  return {
    addPendingComment,
    removePendingComment,
    updatePendingComment,
    updateComment,
    deleteComment,
    replyToComment,
  };
}
