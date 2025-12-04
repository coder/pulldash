import { startTransition, useEffect } from "react";
import { usePRReviewStore } from ".";

export function useKeyboardNavigation() {
  const store = usePRReviewStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Handle Ctrl/Cmd+Arrow for jumping by 10 lines
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "ArrowDown" || e.key === "ArrowUp")
      ) {
        e.preventDefault();
        store.navigateLine(
          e.key === "ArrowDown" ? "down" : "up",
          e.shiftKey,
          10
        );
        return;
      }

      // Allow other Ctrl/Cmd shortcuts to pass through (refresh, etc)
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      const state = store.getSnapshot();

      // Goto line mode
      if (state.gotoLineMode) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          store.appendGotoInput(e.key);
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          store.backspaceGotoInput();
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          store.toggleGotoLineSide();
          return;
        }
        if (e.key === "Enter" && state.gotoLineInput) {
          e.preventDefault();
          store.executeGotoLine();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          store.exitGotoMode();
          return;
        }
        return;
      }

      // Enter to expand focused skip block
      if (e.key === "Enter" && state.focusedSkipBlockIndex !== null) {
        e.preventDefault();
        // Dispatch event to expand the skip block (handled by DiffViewer)
        const event = new CustomEvent("pr-review:expand-skip-block", {
          detail: { skipIndex: state.focusedSkipBlockIndex },
        });
        window.dispatchEvent(event);
        return;
      }

      // Arrow navigation - direct call for instant response
      if (e.key === "ArrowDown") {
        e.preventDefault();
        store.navigateLine("down", e.shiftKey, 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        store.navigateLine("up", e.shiftKey, 1);
        return;
      }
      // Left/Right arrows to switch between sides in split view
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        store.navigateSide("left");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        store.navigateSide("right");
        return;
      }

      // Shortcuts
      switch (e.key.toLowerCase()) {
        case "j":
          e.preventDefault();
          // Use startTransition to allow React to interrupt rendering during rapid navigation
          startTransition(() => {
            store.navigateToNextUnviewedFile();
          });
          break;
        case "k":
          e.preventDefault();
          // Use startTransition to allow React to interrupt rendering during rapid navigation
          startTransition(() => {
            store.navigateToPrevUnviewedFile();
          });
          break;
        case "v":
          e.preventDefault();
          if (state.selectedFiles.size > 0) {
            store.toggleViewedMultiple([...state.selectedFiles]);
          } else if (state.selectedFile) {
            store.toggleViewed(state.selectedFile);
          }
          break;
        case "g":
          e.preventDefault();
          store.enterGotoMode();
          break;
        case "o":
          e.preventDefault();
          store.selectOverview();
          break;
        case "c":
          e.preventDefault();
          store.startCommentingOnFocusedLine();
          break;
        case "e":
          if (state.focusedCommentId) {
            // Check if user owns this comment
            const commentToEdit = state.comments.find(
              (c) => c.id === state.focusedCommentId
            );
            if (
              commentToEdit &&
              state.currentUser === commentToEdit.user.login
            ) {
              e.preventDefault();
              store.startEditing(state.focusedCommentId);
            }
          } else if (state.focusedPendingCommentId) {
            // Pending comments are always owned by current user
            e.preventDefault();
            store.startEditingPendingComment(state.focusedPendingCommentId);
          }
          break;
        case "r":
          if (state.focusedCommentId) {
            e.preventDefault();
            store.startReplying(state.focusedCommentId);
          }
          break;
        case "d":
          if (state.focusedCommentId) {
            // Check if user owns this comment
            const commentToDelete = state.comments.find(
              (c) => c.id === state.focusedCommentId
            );
            if (
              commentToDelete &&
              state.currentUser === commentToDelete.user.login
            ) {
              e.preventDefault();
              if (
                window.confirm("Are you sure you want to delete this comment?")
              ) {
                // Trigger delete via API - component handles this
                const event = new CustomEvent("pr-review:delete-comment", {
                  detail: { commentId: state.focusedCommentId },
                });
                window.dispatchEvent(event);
              }
            }
          } else if (state.focusedPendingCommentId) {
            // Pending comments are always owned by current user
            e.preventDefault();
            if (
              window.confirm(
                "Are you sure you want to delete this pending comment?"
              )
            ) {
              const event = new CustomEvent(
                "pr-review:delete-pending-comment",
                {
                  detail: { commentId: state.focusedPendingCommentId },
                }
              );
              window.dispatchEvent(event);
            }
          }
          break;
        case "escape":
          e.preventDefault();
          if (state.commentingOnLine) {
            store.cancelCommenting();
          } else {
            store.clearAllSelections();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);
}
