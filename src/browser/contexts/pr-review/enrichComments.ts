import type { ReviewComment } from "@/api/types";
import type { ReviewThread } from "@/browser/contexts/github";

/**
 * Join GraphQL review-thread resolution info onto REST review comments.
 * REST comments carry no thread ID or resolution state, so without this
 * enrichment resolved threads render as unresolved.
 */
export function enrichCommentsWithThreads(
  comments: ReviewComment[],
  threads: ReviewThread[]
): ReviewComment[] {
  if (threads.length === 0) return comments;

  const threadByCommentId = new Map<number, ReviewThread>();
  for (const thread of threads) {
    for (const comment of thread.comments.nodes) {
      threadByCommentId.set(comment.databaseId, thread);
    }
  }

  return comments.map((comment) => {
    const thread = threadByCommentId.get(comment.id);
    if (!thread) return comment;
    return {
      ...comment,
      pull_request_review_thread_id: thread.id,
      is_resolved: thread.isResolved,
      resolved_by: thread.resolvedBy
        ? {
            login: thread.resolvedBy.login,
            avatar_url: thread.resolvedBy.avatarUrl,
          }
        : null,
    };
  });
}
