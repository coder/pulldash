import {
  createContext,
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
  MentionSuggestionsProvider,
  type MentionUser,
} from "@/browser/ui/markdown";

// ============================================================================
// File Sorting (match file tree order)
// ============================================================================

/**
 * Sort files to match the file tree display order:
 * - Files are grouped by directory
 * - At each level, folders come before files
 * - Items are sorted alphabetically within each group
 */
export function sortFilesLikeTree<T extends { filename: string }>(
  files: T[]
): T[] {
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

export type DiffViewMode = "unified" | "split";

interface PRReviewState {
  // Core data (immutable after init)
  pr: PullRequest;
  files: PullRequestFile[];
  owner: string;
  repo: string;
  currentUser: string | null;
  // Viewer permissions (from GraphQL) - affects what actions are available
  // ADMIN, MAINTAIN, WRITE can approve/request_changes
  // TRIAGE, READ can only comment
  viewerPermission: string | null;

  // Diff view mode (unified or split) - global user preference
  diffViewMode: DiffViewMode;

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

// Global storage key for diff view mode (user preference, not per-PR)
const DIFF_VIEW_MODE_KEY = "pulldash_diff_view_mode";

function getStoredDiffViewMode(): DiffViewMode {
  try {
    const stored = localStorage.getItem(DIFF_VIEW_MODE_KEY);
    if (stored === "split" || stored === "unified") {
      return stored;
    }
  } catch {}
  return "unified"; // Default to unified view
}

function setStoredDiffViewMode(mode: DiffViewMode): void {
  try {
    localStorage.setItem(DIFF_VIEW_MODE_KEY, mode);
  } catch {}
}

export class PRReviewStore {
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
      | "diffViewMode"
    >
  ) {
    this.storageKey = `pr-${initialState.owner}-${initialState.repo}-${initialState.pr.number}`;

    // Load viewed files from localStorage
    let viewedFiles = new Set<string>();
    let pendingComments: LocalPendingComment[] = [];
    let reviewBody = "";
    const diffViewMode = getStoredDiffViewMode();

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
      diffViewMode,
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

  setViewerPermission = (permission: string | null) => {
    this.set({ viewerPermission: permission });
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
  // Diff View Mode Actions
  // ---------------------------------------------------------------------------

  setDiffViewMode = (mode: DiffViewMode) => {
    if (this.state.diffViewMode === mode) return;
    setStoredDiffViewMode(mode);
    this.set({ diffViewMode: mode });
  };

  toggleDiffViewMode = () => {
    const newMode = this.state.diffViewMode === "unified" ? "split" : "unified";
    this.setDiffViewMode(newMode);
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

  // Switch between left (old) and right (new) sides in split view
  navigateSide = (direction: "left" | "right") => {
    const {
      focusedLine,
      focusedLineSide,
      selectedFile,
      loadedDiffs,
      diffViewMode,
      expandedSkipBlocks,
    } = this.state;

    // Only works in split view when a line is focused
    if (diffViewMode !== "split") return;
    if (focusedLine === null || focusedLineSide === null) return;

    const targetSide = direction === "left" ? "old" : "new";
    if (focusedLineSide === targetSide) return; // Already on target side

    const diff = selectedFile ? loadedDiffs[selectedFile] : null;
    if (!diff?.hunks) return;

    // Helper to check if a line matches and handle switching
    const trySwitch = (line: DiffLine): boolean => {
      // Check if this is the line we're currently focused on
      const matchesOld =
        focusedLineSide === "old" && line.oldLineNumber === focusedLine;
      const matchesNew =
        focusedLineSide === "new" && line.newLineNumber === focusedLine;

      if (!matchesOld && !matchesNew) return false;

      // Only context/merged lines (type "normal") can be on both sides
      // Delete lines only exist on old side, insert lines only on new side
      if (line.type !== "normal") return true; // Found but can't switch

      // Get the line number for the target side
      const targetLineNum =
        targetSide === "old" ? line.oldLineNumber : line.newLineNumber;
      if (targetLineNum !== undefined) {
        this.setFocusedLine(targetLineNum, targetSide);
        this.setSelectionAnchor(null, null);
      }
      return true;
    };

    // Search in regular hunks
    for (const hunk of diff.hunks) {
      if (hunk.type !== "hunk") continue;
      for (const line of hunk.lines) {
        if (trySwitch(line)) return;
      }
    }

    // Also search in expanded skip blocks
    if (selectedFile) {
      for (const key of Object.keys(expandedSkipBlocks)) {
        if (!key.startsWith(`${selectedFile}:`)) continue;
        const expandedLines = expandedSkipBlocks[key];
        if (expandedLines) {
          for (const line of expandedLines) {
            if (trySwitch(line)) return;
          }
        }
      }
    }
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
    const {
      gotoLineInput,
      gotoLineSide,
      selectedFile,
      loadedDiffs,
      diffViewMode,
    } = this.state;
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
    // In unified view: delete lines → "old" side, insert/context → "new" side
    // In split view: respect the user's column choice since both sides are visible
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
            // User wants to jump to a line number in the "old" column (left side in split)
            if (line.oldLineNumber !== undefined) {
              if (line.type === "delete") {
                // Delete lines: focus with old side and oldLineNumber
                navigableLines.push({
                  searchNum: line.oldLineNumber,
                  focusNum: line.oldLineNumber,
                  focusSide: "old",
                });
              } else if (diffViewMode === "split") {
                // Split view: context lines can be focused on either side
                // User chose "old" so focus on the left side with oldLineNumber
                navigableLines.push({
                  searchNum: line.oldLineNumber,
                  focusNum: line.oldLineNumber,
                  focusSide: "old",
                });
              } else {
                // Unified view: context lines are focused with new side
                navigableLines.push({
                  searchNum: line.oldLineNumber,
                  focusNum: line.newLineNumber!,
                  focusSide: "new",
                });
              }
            }
          } else {
            // User wants to jump to a line number in the "new" column (right side in split)
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
  viewerPermission: string | null;
  children: ReactNode;
}

export function PRReviewProvider({
  pr,
  files,
  comments,
  owner,
  repo,
  viewerPermission,
  children,
}: PRReviewProviderProps) {
  // Create store once and keep it stable
  const storeRef = useRef<PRReviewStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new PRReviewStore({
      pr,
      files,
      comments,
      owner,
      repo,
      viewerPermission,
    });
  }

  // Sync comments from props (for when they're refreshed from server)
  useEffect(() => {
    storeRef.current?.setComments(comments);
  }, [comments]);

  // Sync viewerPermission from props
  useEffect(() => {
    storeRef.current?.setViewerPermission(viewerPermission);
  }, [viewerPermission]);

  // Extract relevant users for @mention suggestions
  // Priority: PR participants (author, reviewers, assignees, commenters)
  const suggestedUsers = useMemo(() => {
    const seen = new Set<string>();
    const users: MentionUser[] = [];

    const addUser = (
      login: string | undefined,
      avatar_url: string | undefined
    ) => {
      if (!login || seen.has(login.toLowerCase())) return;
      seen.add(login.toLowerCase());
      users.push({
        login,
        avatar_url: avatar_url || `https://github.com/${login}.png`,
      });
    };

    // PR author first
    if (pr.user) {
      addUser(pr.user.login, pr.user.avatar_url);
    }

    // Assignees
    for (const assignee of pr.assignees || []) {
      addUser(assignee.login, assignee.avatar_url);
    }

    // Requested reviewers (can be users or teams)
    for (const reviewer of pr.requested_reviewers || []) {
      if ("login" in reviewer) {
        addUser(reviewer.login, reviewer.avatar_url);
      }
    }

    // Commenters (from review comments)
    for (const comment of comments) {
      if (comment.user) {
        addUser(comment.user.login, comment.user.avatar_url);
      }
    }

    return users;
  }, [pr, comments]);

  return (
    <PRReviewContext.Provider value={storeRef.current}>
      <MentionSuggestionsProvider
        suggestedUsers={suggestedUsers}
        owner={owner}
        repo={repo}
      >
        {children}
      </MentionSuggestionsProvider>
    </PRReviewContext.Provider>
  );
}

// ============================================================================
// Base Hooks
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

export { useCommentsByFile } from "./useCommentsByFile";
export { usePendingCommentCountsByFile } from "./usePendingCommentCountsByFile";
export { useCommentCountsByFile } from "./useCommentCountsByFile";
export { useCurrentFile } from "./useCurrentFile";
export { useCurrentDiff } from "./useCurrentDiff";
export { useIsCurrentFileLoading } from "./useIsCurrentFileLoading";
export { useCurrentFileComments } from "./useCurrentFileComments";
export { useCurrentFilePendingComments } from "./useCurrentFilePendingComments";
export { useSelectionRange } from "./useSelectionRange";
export { useIsLineFocused } from "./useIsLineFocused";
export { useIsLineInSelection } from "./useIsLineInSelection";
export { useSelectionBoundary } from "./useSelectionBoundary";
export { useIsLineCommenting } from "./useIsLineCommenting";
export { useIsLineInCommentingRange } from "./useIsLineInCommentingRange";
export { useIsLineInCommentRange } from "./useIsLineInCommentRange";
export { useSelectionState, type SelectionState } from "./useSelectionState";
export { useCommentingRange } from "./useCommentingRange";
export { useCommentRangeLookup } from "./useCommentRangeLookup";
export { useKeyboardNavigation } from "./useKeyboardNavigation";
export { useHashNavigation } from "./useHashNavigation";
export { useDiffLoader } from "./useDiffLoader";
export { useCurrentUserLoader } from "./useCurrentUserLoader";
export { usePendingReviewLoader } from "./usePendingReviewLoader";
export { useThreadActions } from "./useThreadActions";
export { useCommentActions } from "./useCommentActions";
export { useReviewActions } from "./useReviewActions";
export { useSkipBlockExpansion } from "./useSkipBlockExpansion";
export { useFileCopyActions } from "./useFileCopyActions";
