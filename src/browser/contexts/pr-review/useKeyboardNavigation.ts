import { startTransition, useEffect } from "react";
import { usePRReviewStore } from ".";
import { matchesKey } from "@/browser/lib/shortcuts";

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
      if (matchesKey(e, "JUMP_UP")) {
        e.preventDefault();
        store.navigateLine("up", e.shiftKey, 10);
        return;
      }
      if (matchesKey(e, "JUMP_DOWN")) {
        e.preventDefault();
        store.navigateLine("down", e.shiftKey, 10);
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
        if (matchesKey(e, "GOTO_TOGGLE_SIDE")) {
          e.preventDefault();
          store.toggleGotoLineSide();
          return;
        }
        if (matchesKey(e, "GOTO_EXECUTE") && state.gotoLineInput) {
          e.preventDefault();
          store.executeGotoLine();
          return;
        }
        if (matchesKey(e, "GOTO_EXIT")) {
          e.preventDefault();
          store.exitGotoMode();
          return;
        }
        return;
      }

      // Enter to expand focused skip block
      if (
        matchesKey(e, "EXPAND_SECTION") &&
        state.focusedSkipBlockIndex !== null
      ) {
        e.preventDefault();
        // Dispatch event to expand the skip block (handled by DiffViewer)
        const event = new CustomEvent("pr-review:expand-skip-block", {
          detail: { skipIndex: state.focusedSkipBlockIndex },
        });
        window.dispatchEvent(event);
        return;
      }

      // Arrow navigation - direct call for instant response
      if (matchesKey(e, "NAVIGATE_DOWN")) {
        e.preventDefault();
        store.navigateLine("down", e.shiftKey, 1);
        return;
      }
      if (matchesKey(e, "NAVIGATE_UP")) {
        e.preventDefault();
        store.navigateLine("up", e.shiftKey, 1);
        return;
      }
      // Left/Right arrows to switch between sides in split view
      if (matchesKey(e, "NAVIGATE_LEFT")) {
        e.preventDefault();
        store.navigateSide("left");
        return;
      }
      if (matchesKey(e, "NAVIGATE_RIGHT")) {
        e.preventDefault();
        store.navigateSide("right");
        return;
      }

      // Shortcuts
      if (matchesKey(e, "NEXT_UNVIEWED_FILE")) {
        e.preventDefault();
        // Use startTransition to allow React to interrupt rendering during rapid navigation
        startTransition(() => {
          store.navigateToNextUnviewedFile();
        });
        return;
      }
      if (matchesKey(e, "PREV_UNVIEWED_FILE")) {
        e.preventDefault();
        startTransition(() => {
          store.navigateToPrevUnviewedFile();
        });
        return;
      }
      if (matchesKey(e, "TOGGLE_VIEWED")) {
        e.preventDefault();
        if (state.selectedFiles.size > 0) {
          store.toggleViewedMultiple([...state.selectedFiles]);
        } else if (state.selectedFile) {
          store.toggleViewed(state.selectedFile);
        }
        return;
      }
      if (matchesKey(e, "GOTO_LINE_MODE")) {
        e.preventDefault();
        store.enterGotoMode();
        return;
      }
      if (matchesKey(e, "GOTO_OVERVIEW")) {
        e.preventDefault();
        store.selectOverview();
        return;
      }
      if (matchesKey(e, "COMMENT")) {
        e.preventDefault();
        store.startCommentingOnFocusedLine();
        return;
      }
      if (matchesKey(e, "EDIT_COMMENT")) {
        if (state.focusedCommentId) {
          // Check if user can edit this comment
          // ADMIN and MAINTAIN can edit any comment, WRITE can only edit own comments
          const commentToEdit = state.comments.find(
            (c) => c.id === state.focusedCommentId
          );
          const isOwnComment =
            commentToEdit && state.currentUser === commentToEdit.user.login;
          const canEditAny =
            state.viewerPermission === "ADMIN" ||
            state.viewerPermission === "MAINTAIN";
          if (commentToEdit && (isOwnComment || canEditAny)) {
            e.preventDefault();
            store.startEditing(state.focusedCommentId);
          }
        } else if (state.focusedPendingCommentId) {
          // Pending comments are always owned by current user
          e.preventDefault();
          store.startEditingPendingComment(state.focusedPendingCommentId);
        }
        return;
      }
      if (matchesKey(e, "REPLY_COMMENT")) {
        if (state.focusedCommentId) {
          e.preventDefault();
          store.startReplying(state.focusedCommentId);
        }
        return;
      }
      if (matchesKey(e, "DELETE_COMMENT")) {
        if (state.focusedCommentId) {
          // Check if user can delete this comment
          // ADMIN and MAINTAIN can delete any comment, WRITE can only delete own comments
          const commentToDelete = state.comments.find(
            (c) => c.id === state.focusedCommentId
          );
          const isOwnCommentD =
            commentToDelete && state.currentUser === commentToDelete.user.login;
          const canDeleteAny =
            state.viewerPermission === "ADMIN" ||
            state.viewerPermission === "MAINTAIN";
          if (commentToDelete && (isOwnCommentD || canDeleteAny)) {
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
            const event = new CustomEvent("pr-review:delete-pending-comment", {
              detail: { commentId: state.focusedPendingCommentId },
            });
            window.dispatchEvent(event);
          }
        }
        return;
      }
      if (matchesKey(e, "CANCEL")) {
        e.preventDefault();
        if (state.commentingOnLine) {
          store.cancelCommenting();
        } else {
          store.clearAllSelections();
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);
}
