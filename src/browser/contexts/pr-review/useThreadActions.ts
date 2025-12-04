import { useGitHub } from "@/browser/contexts/github";
import { usePRReviewStore } from ".";

export function useThreadActions() {
  const store = usePRReviewStore();
  const github = useGitHub();

  const resolveThread = async (threadId: string) => {
    try {
      await github.resolveThread(threadId);
      // Update local state - mark all comments in this thread as resolved
      const state = store.getSnapshot();
      const updatedComments = state.comments.map((c) =>
        c.pull_request_review_thread_id === threadId
          ? { ...c, is_resolved: true }
          : c
      );
      store.setComments(updatedComments);
    } catch (error) {
      console.error("Failed to resolve thread:", error);
    }
  };

  const unresolveThread = async (threadId: string) => {
    try {
      await github.unresolveThread(threadId);
      // Update local state - mark all comments in this thread as unresolved
      const state = store.getSnapshot();
      const updatedComments = state.comments.map((c) =>
        c.pull_request_review_thread_id === threadId
          ? { ...c, is_resolved: false }
          : c
      );
      store.setComments(updatedComments);
    } catch (error) {
      console.error("Failed to unresolve thread:", error);
    }
  };

  return { resolveThread, unresolveThread };
}
