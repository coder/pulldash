import { useCallback } from "react";
import { useGitHub } from "@/browser/contexts/github";
import { usePRReviewStore } from ".";

export function useThreadActions() {
  const store = usePRReviewStore();
  const github = useGitHub();

  // Update both comments (diff view) and reviewThreads (overview) so
  // resolution state stays in sync across views.
  const setThreadResolved = useCallback(
    (threadId: string, isResolved: boolean) => {
      const state = store.getSnapshot();
      store.setComments(
        state.comments.map((c) =>
          c.pull_request_review_thread_id === threadId
            ? { ...c, is_resolved: isResolved }
            : c
        )
      );
      store.updateReviewThread(threadId, (t) => ({ ...t, isResolved }));
    },
    [store]
  );

  const resolveThread = useCallback(
    async (threadId: string) => {
      try {
        await github.resolveThread(threadId);
        setThreadResolved(threadId, true);
      } catch (error) {
        console.error("Failed to resolve thread:", error);
      }
    },
    [github, setThreadResolved]
  );

  const unresolveThread = useCallback(
    async (threadId: string) => {
      try {
        await github.unresolveThread(threadId);
        setThreadResolved(threadId, false);
      } catch (error) {
        console.error("Failed to unresolve thread:", error);
      }
    },
    [github, setThreadResolved]
  );

  return { resolveThread, unresolveThread };
}
