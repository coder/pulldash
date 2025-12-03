import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  PullRequest,
  PullRequestFile,
  ReviewComment,
  PendingReviewComment,
} from "@/api/types";
import {
  useGitHub,
  useGitHubSafe,
  type GitHubClient,
} from "@/browser/contexts/github";
import { diffService } from "@/browser/lib/diff";

// ============================================================================
// File Sorting (match file tree order)
// ============================================================================

/**
 * Sort files to match the file tree display order:
 * - Files are grouped by directory
 * - At each level, folders come before files
 * - Items are sorted alphabetically within each group
 */
function sortFilesLikeTree<T extends { filename: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const aParts = a.filename.split("/");
    const bParts = b.filename.split("/");

    // Compare path segments
    const minLen = Math.min(aParts.length, bParts.length);

    for (let i = 0; i < minLen; i++) {
      const aIsLast = i === aParts.length - 1;
      const bIsLast = i === bParts.length - 1;

      // If one is a file and other is folder at this level, folder comes first
      if (aIsLast !== bIsLast) {
        return aIsLast ? 1 : -1; // folder (not last) before file (last)
      }

      // Both are same type at this level, compare names
      const cmp = aParts[i].localeCompare(bParts[i]);
      if (cmp !== 0) return cmp;
    }

    // Paths are equal up to minLen, shorter path (folder) comes first
    return aParts.length - bParts.length;
  });
}

// ============================================================================
// Types
// ============================================================================

export interface LocalPendingComment extends PendingReviewComment {
  id: string;
  // GraphQL node ID for the comment (for deletion)
  nodeId?: string;
  // Database ID (for REST API compatibility)
  databaseId?: number;
}

interface LineSegment {
  value: string;
  html: string;
  type: "insert" | "delete" | "normal";
}

export interface DiffLine {
  type: "insert" | "delete" | "normal";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: LineSegment[];
}

export interface DiffHunk {
  type: "hunk";
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffSkipBlock {
  type: "skip";
  count: number;
  content: string;
}

export interface ParsedDiff {
  hunks: (DiffHunk | DiffSkipBlock)[];
}

export interface CommentingOnLine {
  line: number;
  startLine?: number;
}

// ============================================================================
// Store State
// ============================================================================

// Pre-computed navigable item for O(1) navigation lookup
export interface NavigableItem {
  type: "line" | "skip";
  lineNum?: number;
  side?: "old" | "new";
  skipIndex?: number;
  rowIndex: number;
}

interface PRReviewState {
  // Core data (immutable after init)
  pr: PullRequest;
  files: PullRequestFile[];
  owner: string;
  repo: string;
  currentUser: string | null;

  // File navigation
  selectedFile: string | null;
  selectedFiles: Set<string>;
  showOverview: boolean;

  // Viewed files
  viewedFiles: Set<string>;
  hideViewed: boolean;

  // Diffs
  loadedDiffs: Record<string, ParsedDiff>;
  loadingFiles: Set<string>;
  // Map of "filename:skipIndex" -> expanded lines content
  expandedSkipBlocks: Record<string, DiffLine[]>;
  expandingSkipBlocks: Set<string>;
  // Pre-computed navigation arrays per file (Fix 2)
  navigableItems: Record<string, NavigableItem[]>;
  // Pre-computed comment range lookup per file (Fix 3)
  commentRangeLookup: Record<string, Set<number>>;

  // Line selection
  focusedLine: number | null;
  focusedLineSide: "old" | "new" | null; // 'old' for delete lines, 'new' for insert/context
  selectionAnchor: number | null;
  selectionAnchorSide: "old" | "new" | null;
  focusedSkipBlockIndex: number | null; // Index of focused skip block for keyboard navigation
  commentingOnLine: CommentingOnLine | null;
  gotoLineMode: boolean;
  gotoLineInput: string;
  gotoLineSide: "old" | "new"; // Which side to target in goto mode

  // Comments
  comments: ReviewComment[];
  pendingComments: LocalPendingComment[];
  focusedCommentId: number | null;
  editingCommentId: number | null;
  replyingToCommentId: number | null;

  // Pending comment focus/edit (separate from regular comments since IDs are strings)
  focusedPendingCommentId: string | null;
  editingPendingCommentId: string | null;

  // Review
  pendingReviewId: number | null;
  reviewBody: string;
  showReviewPanel: boolean;
  submittingReview: boolean;
}

// ============================================================================
// External Store
// ============================================================================

type Listener = () => void;
type Selector<T> = (state: PRReviewState) => T;

class PRReviewStore {
  private state: PRReviewState;
  private listeners = new Set<Listener>();
  private storageKey: string;

  constructor(
    initialState: Omit<
      PRReviewState,
      | "viewedFiles"
      | "hideViewed"
      | "loadedDiffs"
      | "loadingFiles"
      | "expandedSkipBlocks"
      | "expandingSkipBlocks"
      | "navigableItems"
      | "commentRangeLookup"
      | "selectedFile"
      | "showOverview"
      | "selectedFiles"
      | "focusedLine"
      | "focusedLineSide"
      | "selectionAnchor"
      | "selectionAnchorSide"
      | "focusedSkipBlockIndex"
      | "commentingOnLine"
      | "gotoLineMode"
      | "gotoLineInput"
      | "gotoLineSide"
      | "focusedCommentId"
      | "editingCommentId"
      | "replyingToCommentId"
      | "focusedPendingCommentId"
      | "editingPendingCommentId"
      | "pendingReviewId"
      | "pendingComments"
      | "reviewBody"
      | "showReviewPanel"
      | "submittingReview"
      | "currentUser"
    >
  ) {
    this.storageKey = `pr-${initialState.owner}-${initialState.repo}-${initialState.pr.number}`;

    // Load viewed files from localStorage
    let viewedFiles = new Set<string>();
    let pendingComments: LocalPendingComment[] = [];
    let reviewBody = "";

    try {
      const stored = localStorage.getItem(`${this.storageKey}-viewed`);
      if (stored) {
        viewedFiles = new Set(JSON.parse(stored));
      }
    } catch {}

    // Load pending comments from localStorage
    try {
      const stored = localStorage.getItem(`${this.storageKey}-pending`);
      if (stored) {
        pendingComments = JSON.parse(stored);
      }
    } catch {}

    // Load review body from localStorage
    try {
      const stored = localStorage.getItem(`${this.storageKey}-body`);
      if (stored) {
        reviewBody = stored;
      }
    } catch {}

    // Sort files to match file tree order (folders first, then alphabetically)
    const sortedFiles = sortFilesLikeTree(initialState.files);

    this.state = {
      ...initialState,
      files: sortedFiles,
      selectedFile: null,
      selectedFiles: new Set(),
      showOverview: true,
      viewedFiles,
      hideViewed: true,
      loadedDiffs: {},
      loadingFiles: new Set(),
      expandedSkipBlocks: {},
      expandingSkipBlocks: new Set(),
      navigableItems: {},
      commentRangeLookup: {},
      focusedLine: null,
      focusedLineSide: null,
      selectionAnchor: null,
      selectionAnchorSide: null,
      focusedSkipBlockIndex: null,
      commentingOnLine: null,
      gotoLineMode: false,
      gotoLineInput: "",
      gotoLineSide: "new",
      focusedCommentId: null,
      editingCommentId: null,
      replyingToCommentId: null,
      focusedPendingCommentId: null,
      editingPendingCommentId: null,
      pendingReviewId: null,
      pendingComments,
      reviewBody,
      showReviewPanel: false,
      submittingReview: false,
      currentUser: null,
    };
  }

  setCurrentUser = (username: string) => {
    this.set({ currentUser: username });
  };

  // ---------------------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PRReviewState => this.state;

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private set(partial: Partial<PRReviewState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // File Navigation Actions
  // ---------------------------------------------------------------------------

  selectOverview = () => {
    if (this.state.showOverview) return;
    this.set({
      showOverview: true,
      selectedFile: null,
      selectedFiles: new Set(),
      focusedLine: null,
      focusedLineSide: null,
      selectionAnchor: null,
      selectionAnchorSide: null,
      commentingOnLine: null,
      gotoLineMode: false,
      gotoLineInput: "",
      focusedCommentId: null,
      editingCommentId: null,
      replyingToCommentId: null,
      focusedPendingCommentId: null,
      editingPendingCommentId: null,
    });
  };

  selectFile = (filename: string) => {
    if (this.state.selectedFile === filename && !this.state.showOverview)
      return;
    // Track for shift+click range selection
    this.lastSelectedFile = filename;
    this.set({
      selectedFile: filename,
      selectedFiles: new Set(),
      showOverview: false,
      // Reset line selection when changing files
      focusedLine: null,
      focusedLineSide: null,
      selectionAnchor: null,
      selectionAnchorSide: null,
      commentingOnLine: null,
      gotoLineMode: false,
      gotoLineInput: "",
      focusedCommentId: null,
      editingCommentId: null,
      replyingToCommentId: null,
      focusedPendingCommentId: null,
      editingPendingCommentId: null,
    });
  };

  toggleFileSelection = (filename: string, isShiftClick: boolean) => {
    const { files, selectedFiles } = this.state;

    if (isShiftClick && this.lastSelectedFile) {
      const allFilenames = files.map((f) => f.filename);
      const lastIdx = allFilenames.indexOf(this.lastSelectedFile);
      const currentIdx = allFilenames.indexOf(filename);

      if (lastIdx !== -1 && currentIdx !== -1) {
        const start = Math.min(lastIdx, currentIdx);
        const end = Math.max(lastIdx, currentIdx);
        const rangeFiles = allFilenames.slice(start, end + 1);
        const next = new Set(selectedFiles);
        for (const f of rangeFiles) next.add(f);
        this.set({ selectedFiles: next });
      }
    } else {
      const next = new Set(selectedFiles);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      this.lastSelectedFile = filename;
      this.set({ selectedFiles: next });
    }
  };

  private lastSelectedFile: string | null = null;

  navigateToFile = (direction: "next" | "prev") => {
    const { files, selectedFile } = this.state;
    const currentIdx = selectedFile
      ? files.findIndex((f) => f.filename === selectedFile)
      : -1;

    const newIdx =
      direction === "next"
        ? Math.min(currentIdx + 1, files.length - 1)
        : Math.max(currentIdx - 1, 0);

    if (newIdx !== currentIdx && files[newIdx]) {
      this.selectFile(files[newIdx].filename);
    }
  };

  navigateToNextUnviewedFile = () => {
    const { files, selectedFile, viewedFiles } = this.state;
    const currentIdx = selectedFile
      ? files.findIndex((f) => f.filename === selectedFile)
      : -1;

    // Search forward then wrap
    for (let i = 0; i < files.length; i++) {
      const idx = (currentIdx + 1 + i) % files.length;
      if (!viewedFiles.has(files[idx].filename)) {
        this.selectFile(files[idx].filename);
        return;
      }
    }
  };

  navigateToPrevUnviewedFile = () => {
    const { files, selectedFile, viewedFiles } = this.state;
    const currentIdx = selectedFile
      ? files.findIndex((f) => f.filename === selectedFile)
      : files.length;

    // Search backward then wrap
    for (let i = 0; i < files.length; i++) {
      const idx = (currentIdx - 1 - i + files.length) % files.length;
      if (!viewedFiles.has(files[idx].filename)) {
        this.selectFile(files[idx].filename);
        return;
      }
    }
  };

  clearFileSelection = () => {
    this.set({ selectedFiles: new Set() });
  };

  // ---------------------------------------------------------------------------
  // Viewed Files Actions
  // ---------------------------------------------------------------------------

  private persistViewedFiles(viewedFiles: Set<string>) {
    try {
      localStorage.setItem(
        `${this.storageKey}-viewed`,
        JSON.stringify([...viewedFiles])
      );
    } catch {}
  }

  private persistPendingComments(pendingComments: LocalPendingComment[]) {
    try {
      localStorage.setItem(
        `${this.storageKey}-pending`,
        JSON.stringify(pendingComments)
      );
    } catch {}
  }

  private persistReviewBody(body: string) {
    try {
      if (body) {
        localStorage.setItem(`${this.storageKey}-body`, body);
      } else {
        localStorage.removeItem(`${this.storageKey}-body`);
      }
    } catch {}
  }

  private clearPendingState() {
    try {
      localStorage.removeItem(`${this.storageKey}-pending`);
      localStorage.removeItem(`${this.storageKey}-body`);
    } catch {}
  }

  toggleViewed = (filename: string) => {
    const next = new Set(this.state.viewedFiles);
    if (next.has(filename)) {
      next.delete(filename);
    } else {
      next.add(filename);
    }
    this.persistViewedFiles(next);
    this.set({ viewedFiles: next });
  };

  toggleViewedMultiple = (filenames: string[]) => {
    const next = new Set(this.state.viewedFiles);
    const allViewed = filenames.every((f) => next.has(f));

    for (const filename of filenames) {
      if (allViewed) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
    }
    this.persistViewedFiles(next);
    this.set({ viewedFiles: next, selectedFiles: new Set() });
  };

  markFolderViewed = (
    _folderPath: string,
    filenames: string[],
    markAsViewed: boolean
  ) => {
    const next = new Set(this.state.viewedFiles);
    for (const filename of filenames) {
      if (markAsViewed) {
        next.add(filename);
      } else {
        next.delete(filename);
      }
    }
    this.persistViewedFiles(next);
    this.set({ viewedFiles: next });
  };

  toggleHideViewed = () => {
    this.set({ hideViewed: !this.state.hideViewed });
  };

  // ---------------------------------------------------------------------------
  // Diff Loading Actions
  // ---------------------------------------------------------------------------

  setDiffLoading = (filename: string, loading: boolean) => {
    const next = new Set(this.state.loadingFiles);
    if (loading) {
      next.add(filename);
    } else {
      next.delete(filename);
    }
    this.set({ loadingFiles: next });
  };

  setLoadedDiff = (filename: string, diff: ParsedDiff) => {
    // Pre-compute navigable items for O(1) navigation (Fix 2)
    const navigableItems: NavigableItem[] = [];
    let rowIndex = 0;
    let skipIndex = 0;

    for (const hunk of diff.hunks) {
      if (hunk.type === "skip") {
        navigableItems.push({
          type: "skip",
          skipIndex: skipIndex++,
          rowIndex: rowIndex++,
        });
      } else if (hunk.type === "hunk") {
        for (const line of hunk.lines) {
          if (line.type === "delete" && line.oldLineNumber) {
            navigableItems.push({
              type: "line",
              lineNum: line.oldLineNumber,
              side: "old",
              rowIndex: rowIndex++,
            });
          } else if (line.newLineNumber) {
            navigableItems.push({
              type: "line",
              lineNum: line.newLineNumber,
              side: "new",
              rowIndex: rowIndex++,
            });
          }
        }
      }
    }

    this.set({
      loadedDiffs: { ...this.state.loadedDiffs, [filename]: diff },
      navigableItems: {
        ...this.state.navigableItems,
        [filename]: navigableItems,
      },
    });
  };

  // ---------------------------------------------------------------------------
  // Skip Block Expansion Actions
  // ---------------------------------------------------------------------------

  getSkipBlockKey = (filename: string, skipIndex: number): string => {
    return `${filename}:${skipIndex}`;
  };

  setSkipBlockExpanding = (key: string, expanding: boolean) => {
    const next = new Set(this.state.expandingSkipBlocks);
    if (expanding) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.set({ expandingSkipBlocks: next });
  };

  setExpandedSkipBlock = (key: string, lines: DiffLine[]) => {
    this.set({
      expandedSkipBlocks: { ...this.state.expandedSkipBlocks, [key]: lines },
    });
  };

  isSkipBlockExpanded = (filename: string, skipIndex: number): boolean => {
    const key = this.getSkipBlockKey(filename, skipIndex);
    return key in this.state.expandedSkipBlocks;
  };

  isSkipBlockExpanding = (filename: string, skipIndex: number): boolean => {
    const key = this.getSkipBlockKey(filename, skipIndex);
    return this.state.expandingSkipBlocks.has(key);
  };

  getExpandedSkipBlockLines = (
    filename: string,
    skipIndex: number
  ): DiffLine[] | null => {
    const key = this.getSkipBlockKey(filename, skipIndex);
    return this.state.expandedSkipBlocks[key] ?? null;
  };

  // ---------------------------------------------------------------------------
  // Line Selection Actions
  // ---------------------------------------------------------------------------

  setFocusedLine = (
    line: number | null,
    side: "old" | "new" | null = "new"
  ) => {
    this.set({
      focusedLine: line,
      focusedLineSide: line !== null ? side : null,
      focusedSkipBlockIndex: null, // Clear skip block focus when focusing a line
    });
  };

  setSelectionAnchor = (
    anchor: number | null,
    side: "old" | "new" | null = null
  ) => {
    this.set({
      selectionAnchor: anchor,
      selectionAnchorSide: anchor !== null ? side : null,
    });
  };

  setFocusedSkipBlock = (index: number | null) => {
    this.set({
      focusedSkipBlockIndex: index,
      focusedLine: null, // Clear line focus when focusing a skip block
      focusedLineSide: null,
      selectionAnchor: null,
      selectionAnchorSide: null,
    });
  };

  navigateLine = (
    direction: "up" | "down",
    withShift: boolean,
    jumpCount: number = 1
  ) => {
    const {
      focusedLine,
      focusedLineSide,
      selectionAnchor,
      selectionAnchorSide,
      selectedFile,
      loadedDiffs,
      expandedSkipBlocks,
      navigableItems: precomputedItems,
      comments,
      pendingComments,
      focusedCommentId,
      focusedPendingCommentId,
      focusedSkipBlockIndex,
    } = this.state;

    if (!selectedFile) return;
    const diff = loadedDiffs[selectedFile];
    if (!diff?.hunks) return;

    // Use pre-computed navigable items (Fix 2)
    // But we need to account for expanded skip blocks dynamically
    type NavLine = { type: "line"; lineNum: number; side: "old" | "new" };
    type NavSkip = { type: "skip"; skipIndex: number };
    type NavItem = NavLine | NavSkip;

    // Check if we can use pre-computed items (no expanded skip blocks)
    const hasExpandedSkipBlocks = Object.keys(expandedSkipBlocks).some((key) =>
      key.startsWith(`${selectedFile}:`)
    );

    let navigableItems: NavItem[];

    if (!hasExpandedSkipBlocks && precomputedItems[selectedFile]) {
      // Fast path: use pre-computed items
      navigableItems = precomputedItems[selectedFile].map(
        (item: NavigableItem) => {
          if (item.type === "skip") {
            return { type: "skip" as const, skipIndex: item.skipIndex! };
          }
          return {
            type: "line" as const,
            lineNum: item.lineNum!,
            side: item.side!,
          };
        }
      );
    } else {
      // Slow path: rebuild with expanded skip blocks
      navigableItems = [];
      let skipIndex = 0;

      for (const hunk of diff.hunks) {
        if (hunk.type === "skip") {
          const currentSkipIndex = skipIndex++;
          // Check if this skip block is expanded
          const key = `${selectedFile}:${currentSkipIndex}`;
          const expandedLines = expandedSkipBlocks[key];

          if (expandedLines && expandedLines.length > 0) {
            // Skip block is expanded - add its lines
            for (const line of expandedLines) {
              if (line.type === "delete" && line.oldLineNumber) {
                navigableItems.push({
                  type: "line",
                  lineNum: line.oldLineNumber,
                  side: "old",
                });
              } else if (line.newLineNumber) {
                navigableItems.push({
                  type: "line",
                  lineNum: line.newLineNumber,
                  side: "new",
                });
              }
            }
          } else {
            // Skip block is collapsed - add it as navigable
            navigableItems.push({ type: "skip", skipIndex: currentSkipIndex });
          }
        } else if (hunk.type === "hunk") {
          for (const line of hunk.lines) {
            if (line.type === "delete" && line.oldLineNumber) {
              navigableItems.push({
                type: "line",
                lineNum: line.oldLineNumber,
                side: "old",
              });
            } else if (line.newLineNumber) {
              navigableItems.push({
                type: "line",
                lineNum: line.newLineNumber,
                side: "new",
              });
            }
          }
        }
      }
    }
    if (navigableItems.length === 0) return;

    // Build line-only list for backwards compatibility with comment lookups
    const navigableLines = navigableItems.filter(
      (n): n is NavLine => n.type === "line"
    );
    const commentableLines = navigableLines.map((n) => n.lineNum);

    // Helper to get all comments for a line (sorted for thread navigation)
    const getLineComments = (line: number) => {
      const lineComments = comments.filter(
        (c) =>
          c.path === selectedFile &&
          (c.line === line || c.original_line === line)
      );
      // Sort: root comments first, then replies by ID
      return lineComments.sort((a, b) => {
        if (!a.in_reply_to_id && b.in_reply_to_id) return -1;
        if (a.in_reply_to_id && !b.in_reply_to_id) return 1;
        return a.id - b.id;
      });
    };

    // Helper to get pending comments for a line
    const getLinePendingComments = (line: number) => {
      return pendingComments.filter(
        (c) => c.path === selectedFile && c.line === line
      );
    };

    // Handle navigation when focused on a skip block
    if (focusedSkipBlockIndex !== null) {
      const currentIdx = navigableItems.findIndex(
        (n) => n.type === "skip" && n.skipIndex === focusedSkipBlockIndex
      );

      if (currentIdx !== -1) {
        let nextIdx: number;
        if (direction === "down") {
          nextIdx = Math.min(currentIdx + 1, navigableItems.length - 1);
        } else {
          nextIdx = Math.max(currentIdx - 1, 0);
        }

        const nextItem = navigableItems[nextIdx];
        if (nextItem.type === "skip") {
          this.set({ focusedSkipBlockIndex: nextItem.skipIndex });
        } else {
          this.set({
            focusedLine: nextItem.lineNum,
            focusedLineSide: nextItem.side,
            focusedSkipBlockIndex: null,
            selectionAnchor: null,
            selectionAnchorSide: null,
          });
        }
      }
      return;
    }

    // Handle navigation when focused on a pending comment
    if (focusedPendingCommentId) {
      const focusedPending = pendingComments.find(
        (c) => c.id === focusedPendingCommentId
      );
      if (!focusedPending) {
        this.set({ focusedPendingCommentId: null });
        return;
      }

      const pendingLine = focusedPending.line;
      const linePending = getLinePendingComments(pendingLine);
      const pendingIdx = linePending.findIndex(
        (c) => c.id === focusedPendingCommentId
      );

      if (direction === "down") {
        // Try to go to next pending comment on this line
        if (pendingIdx < linePending.length - 1) {
          this.set({ focusedPendingCommentId: linePending[pendingIdx + 1].id });
          return;
        }
        // No more pending comments, try regular comments on this line
        const lineComments = getLineComments(pendingLine);
        if (lineComments.length > 0) {
          this.set({
            focusedPendingCommentId: null,
            focusedCommentId: lineComments[0].id,
          });
          return;
        }
        // No regular comments, move to next line
        const lineIdx = commentableLines.indexOf(pendingLine);
        if (lineIdx < commentableLines.length - 1) {
          const nextNav = navigableLines[lineIdx + 1];
          this.set({
            focusedLine: nextNav.lineNum,
            focusedLineSide: nextNav.side,
            focusedPendingCommentId: null,
            focusedCommentId: null,
            selectionAnchor: null,
            selectionAnchorSide: null,
          });
        }
        return;
      } else {
        // Going up - try to go to previous pending comment
        if (pendingIdx > 0) {
          this.set({ focusedPendingCommentId: linePending[pendingIdx - 1].id });
          return;
        }
        // No more pending comments above, go back to line (default to 'new' side)
        this.set({
          focusedLine: pendingLine,
          focusedLineSide: "new",
          focusedPendingCommentId: null,
          selectionAnchor: null,
          selectionAnchorSide: null,
        });
        return;
      }
    }

    // Handle navigation when focused on a regular comment
    if (focusedCommentId) {
      const focusedComment = comments.find((c) => c.id === focusedCommentId);
      if (!focusedComment) {
        this.set({ focusedCommentId: null });
        return;
      }

      const commentLine = focusedComment.line ?? focusedComment.original_line;
      const lineComments = commentLine ? getLineComments(commentLine) : [];
      const commentIdx = lineComments.findIndex(
        (c) => c.id === focusedCommentId
      );

      if (direction === "down") {
        // Try to go to next comment in thread
        if (commentIdx < lineComments.length - 1) {
          this.set({ focusedCommentId: lineComments[commentIdx + 1].id });
          return;
        }
        // No more comments, move to next line
        if (commentLine) {
          const lineIdx = commentableLines.indexOf(commentLine);
          if (lineIdx < commentableLines.length - 1) {
            const nextNav = navigableLines[lineIdx + 1];
            this.set({
              focusedLine: nextNav.lineNum,
              focusedLineSide: nextNav.side,
              focusedCommentId: null,
              selectionAnchor: null,
              selectionAnchorSide: null,
            });
          }
        }
        return;
      } else {
        // Going up - try to go to previous comment in thread
        if (commentIdx > 0) {
          this.set({ focusedCommentId: lineComments[commentIdx - 1].id });
          return;
        }
        // No more regular comments above, check for pending comments
        if (commentLine) {
          const linePending = getLinePendingComments(commentLine);
          if (linePending.length > 0) {
            this.set({
              focusedCommentId: null,
              focusedPendingCommentId: linePending[linePending.length - 1].id,
            });
            return;
          }
          // No pending comments, go back to line (default to 'new' side)
          this.set({
            focusedLine: commentLine,
            focusedLineSide: "new",
            focusedCommentId: null,
            selectionAnchor: null,
            selectionAnchorSide: null,
          });
        }
        return;
      }
    }

    // Handle down navigation when on a line - check for pending comments first, then regular comments
    if (direction === "down" && focusedLine) {
      // First check pending comments
      const linePending = getLinePendingComments(focusedLine);
      if (linePending.length > 0) {
        this.set({
          focusedPendingCommentId: linePending[0].id,
          focusedLine: null,
          selectionAnchor: null,
        });
        return;
      }

      // Then check regular comments
      const lineComments = getLineComments(focusedLine);
      if (lineComments.length > 0) {
        this.set({
          focusedCommentId: lineComments[0].id,
          focusedLine: null,
          selectionAnchor: null,
        });
        return;
      }
    }

    // Normal line/skip navigation - find current position in navigableItems
    const currentIdx =
      focusedLine !== null
        ? navigableItems.findIndex(
            (n) =>
              n.type === "line" &&
              n.lineNum === focusedLine &&
              n.side === (focusedLineSide ?? "new")
          )
        : -1;

    let nextIdx: number;
    if (direction === "down") {
      nextIdx =
        currentIdx === -1
          ? 0
          : Math.min(currentIdx + jumpCount, navigableItems.length - 1);
    } else {
      nextIdx =
        currentIdx === -1
          ? navigableItems.length - 1
          : Math.max(currentIdx - jumpCount, 0);
    }

    const nextItem = navigableItems[nextIdx];

    // If next item is a skip block, focus it
    if (nextItem.type === "skip") {
      this.set({
        focusedSkipBlockIndex: nextItem.skipIndex,
        focusedLine: null,
        focusedLineSide: null,
        selectionAnchor: null,
        selectionAnchorSide: null,
        focusedCommentId: null,
        focusedPendingCommentId: null,
      });
      return;
    }

    const nextLine = nextItem.lineNum;
    const nextSide = nextItem.side;

    // Handle up navigation - check if the target line has comments to enter (from the bottom)
    if (
      direction === "up" &&
      focusedLine &&
      (nextLine !== focusedLine || nextSide !== focusedLineSide)
    ) {
      // First check regular comments on target line (enter from the bottom/last comment)
      const targetLineComments = getLineComments(nextLine);
      if (targetLineComments.length > 0) {
        this.set({
          focusedCommentId:
            targetLineComments[targetLineComments.length - 1].id,
          focusedLine: null,
          focusedLineSide: null,
          focusedSkipBlockIndex: null,
          selectionAnchor: null,
          selectionAnchorSide: null,
        });
        return;
      }

      // Then check pending comments on target line (enter from the bottom/last comment)
      const targetLinePending = getLinePendingComments(nextLine);
      if (targetLinePending.length > 0) {
        this.set({
          focusedPendingCommentId:
            targetLinePending[targetLinePending.length - 1].id,
          focusedLine: null,
          focusedLineSide: null,
          focusedSkipBlockIndex: null,
          selectionAnchor: null,
          selectionAnchorSide: null,
        });
        return;
      }
    }

    if (withShift) {
      this.set({
        focusedLine: nextLine,
        focusedLineSide: nextSide,
        selectionAnchor: selectionAnchor ?? focusedLine ?? nextLine,
        selectionAnchorSide: selectionAnchorSide ?? focusedLineSide ?? nextSide,
        focusedSkipBlockIndex: null,
        focusedCommentId: null,
        focusedPendingCommentId: null,
      });
    } else {
      this.set({
        focusedLine: nextLine,
        focusedLineSide: nextSide,
        selectionAnchor: null,
        selectionAnchorSide: null,
        focusedSkipBlockIndex: null,
        focusedCommentId: null,
        focusedPendingCommentId: null,
      });
    }
  };

  startCommenting = (line: number, startLine?: number) => {
    this.set({ commentingOnLine: { line, startLine } });
  };

  startCommentingOnFocusedLine = () => {
    const { focusedLine, selectionAnchor } = this.state;
    if (!focusedLine) return;

    const startLine = selectionAnchor
      ? Math.min(focusedLine, selectionAnchor)
      : undefined;
    const endLine = selectionAnchor
      ? Math.max(focusedLine, selectionAnchor)
      : focusedLine;

    this.set({
      commentingOnLine: {
        line: endLine,
        startLine: startLine !== endLine ? startLine : undefined,
      },
    });
  };

  cancelCommenting = () => {
    this.set({ commentingOnLine: null });
  };

  enterGotoMode = () => {
    this.set({ gotoLineMode: true, gotoLineInput: "" });
  };

  exitGotoMode = () => {
    this.set({ gotoLineMode: false, gotoLineInput: "", gotoLineSide: "new" });
  };

  toggleGotoLineSide = () => {
    this.set({
      gotoLineSide: this.state.gotoLineSide === "new" ? "old" : "new",
    });
  };

  appendGotoInput = (char: string) => {
    this.set({ gotoLineInput: this.state.gotoLineInput + char });
  };

  backspaceGotoInput = () => {
    this.set({ gotoLineInput: this.state.gotoLineInput.slice(0, -1) });
  };

  executeGotoLine = () => {
    const { gotoLineInput, gotoLineSide, selectedFile, loadedDiffs } =
      this.state;
    const targetLine = parseInt(gotoLineInput, 10);
    if (isNaN(targetLine)) {
      this.exitGotoMode();
      return;
    }

    const diff = selectedFile ? loadedDiffs[selectedFile] : null;
    if (!diff?.hunks) {
      this.exitGotoMode();
      return;
    }

    // Build navigable lines with the line number to use for focusing
    // The selection model uses: delete lines → "old" side, insert/context → "new" side
    // So when user picks "old" column on a context line, we still need to focus with "new" side
    type NavLine = {
      searchNum: number; // The number in the column the user selected
      focusNum: number; // The line number to use for focusing
      focusSide: "old" | "new"; // The side to use for focusing
    };
    const navigableLines: NavLine[] = [];

    for (const hunk of diff.hunks) {
      if (hunk.type === "hunk") {
        for (const line of hunk.lines) {
          if (gotoLineSide === "old") {
            // User wants to jump to a line number in the "old" column
            if (line.oldLineNumber !== undefined) {
              if (line.type === "delete") {
                // Delete lines: focus with old side and oldLineNumber
                navigableLines.push({
                  searchNum: line.oldLineNumber,
                  focusNum: line.oldLineNumber,
                  focusSide: "old",
                });
              } else {
                // Context lines: have oldLineNumber but are focused with new side
                navigableLines.push({
                  searchNum: line.oldLineNumber,
                  focusNum: line.newLineNumber!,
                  focusSide: "new",
                });
              }
            }
          } else {
            // User wants to jump to a line number in the "new" column
            if (line.newLineNumber !== undefined) {
              navigableLines.push({
                searchNum: line.newLineNumber,
                focusNum: line.newLineNumber,
                focusSide: line.type === "delete" ? "old" : "new",
              });
            }
          }
        }
      }
    }

    if (navigableLines.length > 0) {
      const closest = navigableLines.reduce((best, current) =>
        Math.abs(current.searchNum - targetLine) <
        Math.abs(best.searchNum - targetLine)
          ? current
          : best
      );
      this.set({
        focusedLine: closest.focusNum,
        focusedLineSide: closest.focusSide,
        selectionAnchor: null,
        selectionAnchorSide: null,
        gotoLineMode: false,
        gotoLineInput: "",
        gotoLineSide: "new", // Reset to default
      });
    } else {
      this.exitGotoMode();
    }
  };

  clearLineSelection = () => {
    this.set({
      focusedLine: null,
      focusedLineSide: null,
      selectionAnchor: null,
      selectionAnchorSide: null,
      focusedSkipBlockIndex: null,
      commentingOnLine: null,
      gotoLineMode: false,
      gotoLineInput: "",
    });
  };

  // ---------------------------------------------------------------------------
  // Comment Actions
  // ---------------------------------------------------------------------------

  // Recompute comment range lookup for O(1) line lookup (Fix 3)
  private recomputeCommentRangeLookup = () => {
    const lookup: Record<string, Set<number>> = {};
    const { comments, pendingComments } = this.state;

    // Process regular comments
    for (const comment of comments) {
      if (!comment.path) continue;
      if (!lookup[comment.path]) lookup[comment.path] = new Set();

      if (comment.start_line && comment.line) {
        for (let i = comment.start_line; i <= comment.line; i++) {
          lookup[comment.path].add(i);
        }
      }
    }

    // Process pending comments
    for (const comment of pendingComments) {
      if (!comment.path) continue;
      if (!lookup[comment.path]) lookup[comment.path] = new Set();

      if (comment.start_line && comment.line) {
        for (let i = comment.start_line; i <= comment.line; i++) {
          lookup[comment.path].add(i);
        }
      }
    }

    this.set({ commentRangeLookup: lookup });
  };

  setComments = (comments: ReviewComment[]) => {
    this.set({ comments });
    this.recomputeCommentRangeLookup();
  };

  setPr = (pr: PullRequest) => {
    this.set({ pr });
  };

  setFocusedCommentId = (id: number | null) => {
    this.set({ focusedCommentId: id });
  };

  startEditing = (commentId: number) => {
    this.set({ editingCommentId: commentId });
  };

  cancelEditing = () => {
    this.set({ editingCommentId: null });
  };

  startReplying = (commentId: number) => {
    this.set({ replyingToCommentId: commentId });
  };

  cancelReplying = () => {
    this.set({ replyingToCommentId: null });
  };

  // ---------------------------------------------------------------------------
  // Pending Comment Focus/Edit Actions
  // ---------------------------------------------------------------------------

  setFocusedPendingCommentId = (id: string | null) => {
    this.set({ focusedPendingCommentId: id, focusedCommentId: null });
  };

  startEditingPendingComment = (id: string) => {
    this.set({ editingPendingCommentId: id });
  };

  cancelEditingPendingComment = () => {
    this.set({ editingPendingCommentId: null });
  };

  updatePendingCommentBody = (id: string, body: string) => {
    const pendingComments = this.state.pendingComments.map((c) =>
      c.id === id ? { ...c, body } : c
    );
    this.persistPendingComments(pendingComments);
    this.set({ pendingComments, editingPendingCommentId: null });
  };

  addPendingComment = (comment: LocalPendingComment) => {
    const pendingComments = [...this.state.pendingComments, comment];
    this.persistPendingComments(pendingComments);
    this.set({
      pendingComments,
      commentingOnLine: null,
      focusedLine: null,
      focusedLineSide: null,
      selectionAnchor: null,
      selectionAnchorSide: null,
      focusedPendingCommentId: comment.id,
      focusedCommentId: null,
    });
    this.recomputeCommentRangeLookup();
  };

  removePendingComment = (id: string) => {
    // Find the comment to get its line before deleting
    const comment = this.state.pendingComments.find((c) => c.id === id);
    const commentLine = comment?.line;

    const pendingComments = this.state.pendingComments.filter(
      (c) => c.id !== id
    );
    this.persistPendingComments(pendingComments);
    this.set({
      pendingComments,
      focusedPendingCommentId: null,
      // Focus the line the comment was on so user can continue with keyboard
      focusedLine: commentLine ?? null,
      focusedLineSide: commentLine ? "new" : null,
    });
    this.recomputeCommentRangeLookup();
  };

  updatePendingCommentWithGitHubIds = (
    localId: string,
    reviewNodeId: string,
    commentNodeId: string,
    commentDatabaseId: number
  ) => {
    const pendingComments = this.state.pendingComments.map((c) =>
      c.id === localId
        ? { ...c, nodeId: commentNodeId, databaseId: commentDatabaseId }
        : c
    );
    // Also store the review node ID
    this.pendingReviewNodeId = reviewNodeId;
    this.persistPendingComments(pendingComments);
    this.set({ pendingComments });
  };

  // Store the pending review node ID for submission
  private pendingReviewNodeId: string | null = null;

  getPendingReviewNodeId = () => this.pendingReviewNodeId;
  setPendingReviewNodeId = (id: string | null) => {
    this.pendingReviewNodeId = id;
  };

  updateComment = (commentId: number, updatedComment: ReviewComment) => {
    this.set({
      comments: this.state.comments.map((c) =>
        c.id === commentId ? updatedComment : c
      ),
      editingCommentId: null,
    });
  };

  deleteComment = (commentId: number) => {
    // Find the comment to get its line before deleting
    const comment = this.state.comments.find((c) => c.id === commentId);
    const commentLine = comment?.line ?? comment?.original_line;

    this.set({
      comments: this.state.comments.filter((c) => c.id !== commentId),
      focusedCommentId: null,
      // Focus the line the comment was on so user can continue with keyboard
      focusedLine: commentLine ?? null,
      focusedLineSide: commentLine ? "new" : null,
    });
  };

  addReply = (reply: ReviewComment) => {
    this.set({
      comments: [...this.state.comments, reply],
      replyingToCommentId: null,
    });
  };

  // ---------------------------------------------------------------------------
  // Review Actions
  // ---------------------------------------------------------------------------

  setPendingReviewId = (id: number | null) => {
    this.set({ pendingReviewId: id });
  };

  setPendingComments = (comments: LocalPendingComment[]) => {
    this.set({ pendingComments: comments });
  };

  setReviewBody = (body: string) => {
    this.persistReviewBody(body);
    this.set({ reviewBody: body });
  };

  openReviewPanel = () => {
    this.set({ showReviewPanel: true });
  };

  closeReviewPanel = () => {
    this.set({ showReviewPanel: false });
  };

  setSubmittingReview = (submitting: boolean) => {
    this.set({ submittingReview: submitting });
  };

  clearReviewState = () => {
    this.clearPendingState();
    this.set({
      pendingComments: [],
      pendingReviewId: null,
      reviewBody: "",
      showReviewPanel: false,
      submittingReview: false,
    });
  };

  // ---------------------------------------------------------------------------
  // Clear All
  // ---------------------------------------------------------------------------

  clearAllSelections = () => {
    const { focusedCommentId, focusedPendingCommentId } = this.state;
    if (focusedCommentId) {
      this.set({ focusedCommentId: null });
    } else if (focusedPendingCommentId) {
      this.set({ focusedPendingCommentId: null });
    } else {
      this.set({
        focusedLine: null,
        focusedLineSide: null,
        selectionAnchor: null,
        selectionAnchorSide: null,
        selectedFiles: new Set(),
      });
    }
  };

  // ---------------------------------------------------------------------------
  // URL Hash Navigation
  // ---------------------------------------------------------------------------

  /**
   * Get the current navigation state as a URL hash string.
   * Format: #file=<path>&L<line> or #file=<path>&L<start>-<end> or #file=<path>&C<commentId>
   */
  getHashFromState = (): string => {
    const {
      selectedFile,
      focusedLine,
      selectionAnchor,
      focusedCommentId,
      focusedPendingCommentId,
    } = this.state;

    if (!selectedFile) return "";

    const params = new URLSearchParams();
    params.set("file", selectedFile);

    // Comment takes priority over line selection
    if (focusedCommentId) {
      params.set("comment", String(focusedCommentId));
    } else if (focusedPendingCommentId) {
      params.set("pending", focusedPendingCommentId);
    } else if (focusedLine) {
      if (selectionAnchor && selectionAnchor !== focusedLine) {
        const start = Math.min(focusedLine, selectionAnchor);
        const end = Math.max(focusedLine, selectionAnchor);
        params.set("L", `${start}-${end}`);
      } else {
        params.set("L", String(focusedLine));
      }
    }

    return params.toString();
  };

  /**
   * Navigate to a state from a URL hash string.
   * Returns true if navigation was performed.
   */
  navigateFromHash = (hash: string): boolean => {
    if (!hash) return false;

    // Remove leading # if present
    const hashStr = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!hashStr) return false;

    const params = new URLSearchParams(hashStr);
    const file = params.get("file");
    const lineParam = params.get("L");
    const commentParam = params.get("comment");
    const pendingParam = params.get("pending");

    if (!file) return false;

    // Check if file exists
    const fileExists = this.state.files.some((f) => f.filename === file);
    if (!fileExists) return false;

    // Select the file
    if (this.state.selectedFile !== file) {
      this.selectFile(file);
    }

    // Handle comment focus
    if (commentParam) {
      const commentId = parseInt(commentParam, 10);
      if (!isNaN(commentId)) {
        // We need to wait for the file's diff to load before focusing comments
        // The hash navigation hook will handle the timing
        this.set({ focusedCommentId: commentId });
        return true;
      }
    }

    // Handle pending comment focus
    if (pendingParam) {
      this.set({ focusedPendingCommentId: pendingParam });
      return true;
    }

    // Handle line focus (default to 'new' side since we don't know the diff structure yet)
    if (lineParam) {
      const rangeMatch = lineParam.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        this.set({
          focusedLine: end,
          focusedLineSide: "new",
          selectionAnchor: start,
          selectionAnchorSide: "new",
          focusedSkipBlockIndex: null,
          focusedCommentId: null,
          focusedPendingCommentId: null,
        });
      } else {
        const line = parseInt(lineParam, 10);
        if (!isNaN(line)) {
          this.set({
            focusedLine: line,
            focusedLineSide: "new",
            selectionAnchor: null,
            selectionAnchorSide: null,
            focusedSkipBlockIndex: null,
            focusedCommentId: null,
            focusedPendingCommentId: null,
          });
        }
      }
      return true;
    }

    return true;
  };
}

// ============================================================================
// Context
// ============================================================================

const PRReviewContext = createContext<PRReviewStore | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface PRReviewProviderProps {
  pr: PullRequest;
  files: PullRequestFile[];
  comments: ReviewComment[];
  owner: string;
  repo: string;
  children: ReactNode;
}

export function PRReviewProvider({
  pr,
  files,
  comments,
  owner,
  repo,
  children,
}: PRReviewProviderProps) {
  // Create store once and keep it stable
  const storeRef = useRef<PRReviewStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new PRReviewStore({ pr, files, comments, owner, repo });
  }

  // Sync comments from props (for when they're refreshed from server)
  useEffect(() => {
    storeRef.current?.setComments(comments);
  }, [comments]);

  return (
    <PRReviewContext.Provider value={storeRef.current}>
      {children}
    </PRReviewContext.Provider>
  );
}

// ============================================================================
// Base Hook
// ============================================================================

function useStore(): PRReviewStore {
  const store = useContext(PRReviewContext);
  if (!store) {
    throw new Error("useStore must be used within PRReviewProvider");
  }
  return store;
}

/**
 * Subscribe to a slice of state. Component only re-renders when the selected
 * value changes (using Object.is comparison).
 */
export function usePRReviewSelector<T>(selector: Selector<T>): T {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot())
  );
}

/**
 * Get the store directly for accessing actions or reading state imperatively.
 * The store reference is stable and never changes.
 */
export function usePRReviewStore(): PRReviewStore {
  return useStore();
}

// ============================================================================
// Derived Selectors (computed from state)
// These use useMemo to avoid recreating objects on each render
// ============================================================================

const EMPTY_COMMENTS: ReviewComment[] = [];
const EMPTY_PENDING_COMMENTS: LocalPendingComment[] = [];

/** Get comments grouped by file path */
export function useCommentsByFile(): Record<string, ReviewComment[]> {
  const comments = usePRReviewSelector((s) => s.comments);
  return useMemo(() => {
    const grouped: Record<string, ReviewComment[]> = {};
    for (const comment of comments) {
      if (!grouped[comment.path]) grouped[comment.path] = [];
      grouped[comment.path].push(comment);
    }
    return grouped;
  }, [comments]);
}

/** Get pending comments count per file */
export function usePendingCommentCountsByFile(): Record<string, number> {
  const pendingComments = usePRReviewSelector((s) => s.pendingComments);
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of pendingComments) {
      counts[c.path] = (counts[c.path] || 0) + 1;
    }
    return counts;
  }, [pendingComments]);
}

/** Get comment counts per file */
export function useCommentCountsByFile(): Record<string, number> {
  const comments = usePRReviewSelector((s) => s.comments);
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of comments) {
      counts[c.path] = (counts[c.path] || 0) + 1;
    }
    return counts;
  }, [comments]);
}

/** Get the current file object */
export function useCurrentFile(): PullRequestFile | null {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const files = usePRReviewSelector((s) => s.files);
  return useMemo(() => {
    if (!selectedFile) return null;
    return files.find((f) => f.filename === selectedFile) ?? null;
  }, [selectedFile, files]);
}

/** Get the current file's diff */
export function useCurrentDiff(): ParsedDiff | null {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const loadedDiffs = usePRReviewSelector((s) => s.loadedDiffs);
  return useMemo(() => {
    if (!selectedFile) return null;
    return loadedDiffs[selectedFile] ?? null;
  }, [selectedFile, loadedDiffs]);
}

/** Check if current file is loading */
export function useIsCurrentFileLoading(): boolean {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const loadingFiles = usePRReviewSelector((s) => s.loadingFiles);
  return useMemo(() => {
    if (!selectedFile) return false;
    return loadingFiles.has(selectedFile);
  }, [selectedFile, loadingFiles]);
}

/** Get comments for current file */
export function useCurrentFileComments(): ReviewComment[] {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const comments = usePRReviewSelector((s) => s.comments);
  return useMemo(() => {
    if (!selectedFile) return EMPTY_COMMENTS;
    return comments.filter((c) => c.path === selectedFile);
  }, [selectedFile, comments]);
}

/** Get pending comments for current file */
export function useCurrentFilePendingComments(): LocalPendingComment[] {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const pendingComments = usePRReviewSelector((s) => s.pendingComments);
  return useMemo(() => {
    if (!selectedFile) return EMPTY_PENDING_COMMENTS;
    return pendingComments.filter((c) => c.path === selectedFile);
  }, [selectedFile, pendingComments]);
}

/** Get the selection range for line highlighting */
export function useSelectionRange(): { start: number; end: number } | null {
  const focusedLine = usePRReviewSelector((s) => s.focusedLine);
  const selectionAnchor = usePRReviewSelector((s) => s.selectionAnchor);
  return useMemo(() => {
    if (!focusedLine) return null;
    if (!selectionAnchor) return { start: focusedLine, end: focusedLine };
    return {
      start: Math.min(focusedLine, selectionAnchor),
      end: Math.max(focusedLine, selectionAnchor),
    };
  }, [focusedLine, selectionAnchor]);
}

// ============================================================================
// Fine-grained Line Selectors (for DiffLine performance)
// ============================================================================

/** Check if a specific line is focused (for DiffLine component) */
export function useIsLineFocused(
  lineNumber: number,
  side: "old" | "new"
): boolean {
  return usePRReviewSelector(
    (s) => s.focusedLine === lineNumber && s.focusedLineSide === side
  );
}

/** Check if a specific line is in the selection range */
export function useIsLineInSelection(
  lineNumber: number,
  side: "old" | "new"
): boolean {
  return usePRReviewSelector((s) => {
    if (!s.focusedLine || !s.focusedLineSide) return false;
    // Must match side
    if (s.focusedLineSide !== side) return false;
    if (!s.selectionAnchor) return s.focusedLine === lineNumber;
    // For selection ranges, we currently only support same-side selection
    if (s.selectionAnchorSide !== side)
      return s.focusedLine === lineNumber && s.focusedLineSide === side;
    const start = Math.min(s.focusedLine, s.selectionAnchor);
    const end = Math.max(s.focusedLine, s.selectionAnchor);
    return lineNumber >= start && lineNumber <= end;
  });
}

/**
 * Get selection boundary info for a specific line (for drawing selection outline).
 * Uses a single selector that returns primitives to avoid re-renders of unaffected lines.
 */
export function useSelectionBoundary(
  lineNumber: number,
  side: "old" | "new"
): { isFirst: boolean; isLast: boolean; isInSelection: boolean } {
  // Use separate selectors that return booleans - only re-renders when THIS line's state changes
  const isInSelection = usePRReviewSelector((s) => {
    if (!s.focusedLine || !s.focusedLineSide) return false;
    if (s.focusedLineSide !== side) return false;
    if (!s.selectionAnchor || s.selectionAnchorSide !== side)
      return s.focusedLine === lineNumber;
    const start = Math.min(s.focusedLine, s.selectionAnchor);
    const end = Math.max(s.focusedLine, s.selectionAnchor);
    return lineNumber >= start && lineNumber <= end;
  });

  const isFirst = usePRReviewSelector((s) => {
    if (!s.focusedLine || !s.focusedLineSide) return false;
    if (s.focusedLineSide !== side) return false;
    if (!s.selectionAnchor || s.selectionAnchorSide !== side)
      return s.focusedLine === lineNumber;
    return lineNumber === Math.min(s.focusedLine, s.selectionAnchor);
  });

  const isLast = usePRReviewSelector((s) => {
    if (!s.focusedLine || !s.focusedLineSide) return false;
    if (s.focusedLineSide !== side) return false;
    if (!s.selectionAnchor || s.selectionAnchorSide !== side)
      return s.focusedLine === lineNumber;
    return lineNumber === Math.max(s.focusedLine, s.selectionAnchor);
  });

  return { isFirst, isLast, isInSelection };
}

/** Check if a specific line is being commented on */
export function useIsLineCommenting(lineNumber: number): boolean {
  return usePRReviewSelector((s) => s.commentingOnLine?.line === lineNumber);
}

/** Check if a specific line is in the commenting range */
export function useIsLineInCommentingRange(lineNumber: number): boolean {
  return usePRReviewSelector((s) => {
    if (!s.commentingOnLine) return false;
    const start = s.commentingOnLine.startLine ?? s.commentingOnLine.line;
    const end = s.commentingOnLine.line;
    return lineNumber >= start && lineNumber <= end;
  });
}

/** Check if a specific line is within a comment's range (for multi-line comments) */
export function useIsLineInCommentRange(lineNumber: number): boolean {
  // Use pre-computed lookup for O(1) check (Fix 3)
  return usePRReviewSelector((s) => {
    if (!s.selectedFile) return false;
    const lookup = s.commentRangeLookup[s.selectedFile];
    return lookup?.has(lineNumber) ?? false;
  });
}

// ============================================================================
// Optimized Selection State Hook (Fix 1)
// ============================================================================

export interface SelectionState {
  focusedLine: number | null;
  focusedLineSide: "old" | "new" | null;
  selectionAnchor: number | null;
  selectionAnchorSide: "old" | "new" | null;
  selectionStart: number | null;
  selectionEnd: number | null;
}

/**
 * Get the complete selection state computed once at the parent level.
 * This replaces per-line subscriptions with a single subscription (Fix 1).
 */
export function useSelectionState(): SelectionState {
  const focusedLine = usePRReviewSelector((s) => s.focusedLine);
  const focusedLineSide = usePRReviewSelector((s) => s.focusedLineSide);
  const selectionAnchor = usePRReviewSelector((s) => s.selectionAnchor);
  const selectionAnchorSide = usePRReviewSelector((s) => s.selectionAnchorSide);

  return useMemo(() => {
    let selectionStart: number | null = null;
    let selectionEnd: number | null = null;

    if (focusedLine !== null) {
      if (selectionAnchor !== null) {
        selectionStart = Math.min(focusedLine, selectionAnchor);
        selectionEnd = Math.max(focusedLine, selectionAnchor);
      } else {
        selectionStart = focusedLine;
        selectionEnd = focusedLine;
      }
    }

    return {
      focusedLine,
      focusedLineSide,
      selectionAnchor,
      selectionAnchorSide,
      selectionStart,
      selectionEnd,
    };
  }, [focusedLine, focusedLineSide, selectionAnchor, selectionAnchorSide]);
}

/**
 * Get commenting range computed once at parent level.
 */
export function useCommentingRange(): { start: number; end: number } | null {
  const commentingOnLine = usePRReviewSelector((s) => s.commentingOnLine);

  return useMemo(() => {
    if (!commentingOnLine) return null;
    const start = commentingOnLine.startLine ?? commentingOnLine.line;
    const end = commentingOnLine.line;
    return { start, end };
  }, [commentingOnLine]);
}

/**
 * Get pre-computed comment range lookup for current file.
 * Returns a Set for O(1) lookups.
 */
export function useCommentRangeLookup(): Set<number> | null {
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const commentRangeLookup = usePRReviewSelector((s) => s.commentRangeLookup);

  return useMemo(() => {
    if (!selectedFile) return null;
    return commentRangeLookup[selectedFile] ?? null;
  }, [selectedFile, commentRangeLookup]);
}

// ============================================================================
// Keyboard Navigation Hook
// ============================================================================

export function useKeyboardNavigation() {
  const store = useStore();

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

// ============================================================================
// URL Hash Navigation Hook
// ============================================================================

export function useHashNavigation() {
  const store = useStore();

  // Track if we're currently updating the hash to avoid circular updates
  const isUpdatingHash = useRef(false);
  // Track if we've done initial navigation from hash
  const hasInitialized = useRef(false);
  // Track last hash to avoid unnecessary updates
  const lastHashRef = useRef<string>("");

  // Handle initial navigation from hash on mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const hash = window.location.hash;
    if (hash) {
      isUpdatingHash.current = true;
      store.navigateFromHash(hash);
      // Reset after a short delay to allow state to settle
      setTimeout(() => {
        isUpdatingHash.current = false;
      }, 100);
    }
  }, [store]);

  // Subscribe to store directly to update hash WITHOUT causing React re-renders
  useEffect(() => {
    const updateHash = () => {
      if (isUpdatingHash.current) return;

      const newHash = store.getHashFromState();
      const currentHash = window.location.hash.slice(1); // Remove leading #

      // Skip if hash hasn't changed
      if (newHash === lastHashRef.current) return;
      lastHashRef.current = newHash;

      if (newHash !== currentHash) {
        // Use replaceState to avoid creating history entries for every line navigation
        // but use pushState for file changes to allow back/forward navigation
        const currentParams = new URLSearchParams(currentHash);
        const newParams = new URLSearchParams(newHash);

        if (currentParams.get("file") !== newParams.get("file")) {
          // File changed - create history entry
          window.history.pushState(
            null,
            "",
            newHash ? `#${newHash}` : window.location.pathname
          );
        } else {
          // Same file, just line/comment change - replace
          window.history.replaceState(
            null,
            "",
            newHash ? `#${newHash}` : window.location.pathname
          );
        }
      }
    };

    // Subscribe directly to store - this doesn't cause React re-renders
    return store.subscribe(updateHash);
  }, [store]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      isUpdatingHash.current = true;
      store.navigateFromHash(window.location.hash);
      setTimeout(() => {
        isUpdatingHash.current = false;
      }, 100);
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [store]);
}

// ============================================================================
// Diff Loading Hook
// ============================================================================

const diffCache = new Map<string, ParsedDiff>();
const pendingFetches = new Map<
  string,
  { promise: Promise<ParsedDiff>; controller: AbortController }
>();
const MAX_CACHE_SIZE = 100;

// Check if a diff is already cached (sync check)
function getDiffFromCache(file: PullRequestFile): ParsedDiff | null {
  if (!file.patch || !file.sha) {
    return { hunks: [] };
  }
  return diffCache.get(file.sha) ?? null;
}

// Abort all pending fetches (used when navigating rapidly)
function abortAllPendingFetches() {
  for (const [key, { controller }] of pendingFetches) {
    controller.abort();
    pendingFetches.delete(key);
  }
}

// Abort a specific pending fetch
function abortPendingFetch(cacheKey: string) {
  const pending = pendingFetches.get(cacheKey);
  if (pending) {
    pending.controller.abort();
    pendingFetches.delete(cacheKey);
  }
}

async function fetchParsedDiff(
  file: PullRequestFile,
  signal?: AbortSignal
): Promise<ParsedDiff> {
  if (!file.patch || !file.sha) {
    return { hunks: [] };
  }

  const cacheKey = file.sha;

  // Check cache first
  if (diffCache.has(cacheKey)) {
    return diffCache.get(cacheKey)!;
  }

  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // If there's already a pending fetch for this file, wait for it
  const existing = pendingFetches.get(cacheKey);
  if (existing) {
    // If caller wants to abort, wrap the promise
    if (signal) {
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort);
        existing.promise
          .then(resolve)
          .catch(reject)
          .finally(() => signal.removeEventListener("abort", onAbort));
      });
    }
    return existing.promise;
  }

  // Create new fetch with its own controller
  const controller = new AbortController();

  // Link to caller's signal
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  const fetchPromise = (async () => {
    // Use WebWorker for diff parsing (off main thread)
    const parsed = await diffService.parseDiff(
      file.patch!,
      file.filename,
      file.previous_filename
    );

    // Clean up pending entry
    pendingFetches.delete(cacheKey);

    if (!parsed.hunks) {
      return { hunks: [] };
    }

    // Add to cache
    if (diffCache.size >= MAX_CACHE_SIZE) {
      const firstKey = diffCache.keys().next().value;
      if (firstKey) diffCache.delete(firstKey);
    }
    diffCache.set(cacheKey, parsed);

    return parsed;
  })();

  pendingFetches.set(cacheKey, { promise: fetchPromise, controller });

  // Clean up on error
  fetchPromise.catch(() => {
    pendingFetches.delete(cacheKey);
  });

  return fetchPromise;
}

export function useDiffLoader() {
  const store = useStore();
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const files = usePRReviewSelector((s) => s.files);
  const loadedDiffs = usePRReviewSelector((s) => s.loadedDiffs);

  useEffect(() => {
    if (!selectedFile) return;

    const file = files.find((f) => f.filename === selectedFile);
    if (!file) return;

    const currentFile = selectedFile;

    // Check cache synchronously - instant if cached
    const cached = getDiffFromCache(file);
    if (cached) {
      if (!loadedDiffs[currentFile]) {
        store.setLoadedDiff(currentFile, cached);
      }
      return;
    }

    // Already loaded in store
    if (loadedDiffs[currentFile]) return;

    // Abort ALL pending fetches - only care about current file
    abortAllPendingFetches();

    // Start fetch immediately (no debounce - we have deduplication)
    // Show loading only if fetch takes > 50ms
    const loadingTimeoutId = setTimeout(() => {
      if (
        store.getSnapshot().selectedFile === currentFile &&
        !store.getSnapshot().loadedDiffs[currentFile]
      ) {
        store.setDiffLoading(currentFile, true);
      }
    }, 50);

    // Fetch immediately
    fetchParsedDiff(file)
      .then((diff) => {
        if (store.getSnapshot().selectedFile === currentFile) {
          store.setLoadedDiff(currentFile, diff);
          store.setDiffLoading(currentFile, false);

          // Prefetch next files aggressively (5 ahead, 2 behind)
          const currentIndex = files.findIndex(
            (f) => f.filename === currentFile
          );
          const filesToPrefetch = [
            ...files.slice(Math.max(0, currentIndex - 2), currentIndex),
            ...files.slice(currentIndex + 1, currentIndex + 6),
          ].filter(
            (f) =>
              !store.getSnapshot().loadedDiffs[f.filename] &&
              !getDiffFromCache(f)
          );

          // Prefetch all in parallel
          Promise.all(
            filesToPrefetch.map((pfile) =>
              fetchParsedDiff(pfile)
                .then((pdiff) => store.setLoadedDiff(pfile.filename, pdiff))
                .catch(() => {})
            )
          );
        }
      })
      .catch((err) => {
        if (
          err?.name !== "AbortError" &&
          store.getSnapshot().selectedFile === currentFile
        ) {
          console.error(err);
          store.setDiffLoading(currentFile, false);
        }
      });

    // Cleanup: cancel loading timeout
    return () => {
      clearTimeout(loadingTimeoutId);
      store.setDiffLoading(currentFile, false);
    };
  }, [selectedFile, files, loadedDiffs, store]);
}

// ============================================================================
// Current User Hook
// ============================================================================

export function useCurrentUserLoader() {
  const store = useStore();
  const github = useGitHubSafe();
  const currentUser = github?.getState().currentUser ?? null;

  useEffect(() => {
    if (currentUser) {
      store.setCurrentUser(currentUser);
    }
  }, [currentUser, store]);
}

// ============================================================================
// Pending Review Hook
// ============================================================================

export function usePendingReviewLoader() {
  const store = useStore();
  const github = useGitHubSafe();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);

  useEffect(() => {
    if (!github) return;

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

// ============================================================================
// API Action Hooks
// ============================================================================

export function useThreadActions() {
  const store = useStore();
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

export function useCommentActions() {
  const store = useStore();
  const github = useGitHub();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);

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

export function useReviewActions() {
  const store = useStore();
  const github = useGitHub();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);

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

      // Refresh comments
      const newComments = await github.getPRComments(owner, repo, pr.number);
      store.setComments(newComments as ReviewComment[]);

      store.clearReviewState();
    } finally {
      store.setSubmittingReview(false);
    }
  };

  return { submitReview };
}

// ============================================================================
// Skip Block Expansion Hook
// ============================================================================

export function useSkipBlockExpansion() {
  const store = useStore();
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

// ============================================================================
// File Copy Actions Hook
// ============================================================================

export function useFileCopyActions() {
  const github = useGitHub();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);
  const files = usePRReviewSelector((s) => s.files);

  const copyDiff = (filename: string) => {
    const file = files.find((f) => f.filename === filename);
    if (file?.patch) {
      navigator.clipboard.writeText(file.patch);
    }
  };

  const copyFile = async (filename: string) => {
    try {
      const content = await github.getFileContent(
        owner,
        repo,
        filename,
        pr.head.sha
      );
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error("Failed to copy file:", error);
    }
  };

  const copyMainVersion = async (filename: string) => {
    try {
      const file = files.find((f) => f.filename === filename);
      const basePath = file?.previous_filename || filename;
      const content = await github.getFileContent(
        owner,
        repo,
        basePath,
        pr.base.sha
      );
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error("Failed to copy base version:", error);
    }
  };

  return { copyDiff, copyFile, copyMainVersion };
}

// ============================================================================
// Utility
// ============================================================================

export function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
