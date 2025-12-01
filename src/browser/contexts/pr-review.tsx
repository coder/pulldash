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
  Review,
} from "@/api/github";

// ============================================================================
// Types
// ============================================================================

export interface LocalPendingComment extends PendingReviewComment {
  id: string;
  github_id?: number;
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

interface PRReviewState {
  // Core data (immutable after init)
  pr: PullRequest;
  files: PullRequestFile[];
  owner: string;
  repo: string;

  // File navigation
  selectedFile: string | null;
  selectedFiles: Set<string>;

  // Viewed files
  viewedFiles: Set<string>;
  hideViewed: boolean;

  // Diffs
  loadedDiffs: Record<string, ParsedDiff>;
  loadingFiles: Set<string>;

  // Line selection
  focusedLine: number | null;
  selectionAnchor: number | null;
  commentingOnLine: CommentingOnLine | null;
  gotoLineMode: boolean;
  gotoLineInput: string;

  // Comments
  comments: ReviewComment[];
  pendingComments: LocalPendingComment[];
  focusedCommentId: number | null;
  editingCommentId: number | null;
  replyingToCommentId: number | null;

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

  constructor(initialState: Omit<PRReviewState, "viewedFiles" | "hideViewed" | "loadedDiffs" | "loadingFiles" | "selectedFile" | "selectedFiles" | "focusedLine" | "selectionAnchor" | "commentingOnLine" | "gotoLineMode" | "gotoLineInput" | "focusedCommentId" | "editingCommentId" | "replyingToCommentId" | "pendingReviewId" | "pendingComments" | "reviewBody" | "showReviewPanel" | "submittingReview">) {
    this.storageKey = `viewed-${initialState.owner}-${initialState.repo}-${initialState.pr.number}`;
    
    // Load viewed files from localStorage
    let viewedFiles = new Set<string>();
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        viewedFiles = new Set(JSON.parse(stored));
      }
    } catch {}

    this.state = {
      ...initialState,
      selectedFile: initialState.files[0]?.filename || null,
      selectedFiles: new Set(),
      viewedFiles,
      hideViewed: false,
      loadedDiffs: {},
      loadingFiles: new Set(),
      focusedLine: null,
      selectionAnchor: null,
      commentingOnLine: null,
      gotoLineMode: false,
      gotoLineInput: "",
      focusedCommentId: null,
      editingCommentId: null,
      replyingToCommentId: null,
      pendingReviewId: null,
      pendingComments: [],
      reviewBody: "",
      showReviewPanel: false,
      submittingReview: false,
    };
  }

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

  selectFile = (filename: string) => {
    if (this.state.selectedFile === filename) return;
    this.set({
      selectedFile: filename,
      selectedFiles: new Set(),
      // Reset line selection when changing files
      focusedLine: null,
      selectionAnchor: null,
      commentingOnLine: null,
      gotoLineMode: false,
      gotoLineInput: "",
      focusedCommentId: null,
      editingCommentId: null,
      replyingToCommentId: null,
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
    
    const newIdx = direction === "next"
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
      localStorage.setItem(this.storageKey, JSON.stringify([...viewedFiles]));
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

  markFolderViewed = (_folderPath: string, filenames: string[], markAsViewed: boolean) => {
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
    this.set({
      loadedDiffs: { ...this.state.loadedDiffs, [filename]: diff },
    });
  };

  // ---------------------------------------------------------------------------
  // Line Selection Actions
  // ---------------------------------------------------------------------------

  setFocusedLine = (line: number | null) => {
    this.set({ focusedLine: line });
  };

  setSelectionAnchor = (anchor: number | null) => {
    this.set({ selectionAnchor: anchor });
  };

  navigateLine = (direction: "up" | "down", withShift: boolean) => {
    const { focusedLine, selectionAnchor, selectedFile, loadedDiffs, comments, pendingComments, focusedCommentId } = this.state;
    
    const diff = selectedFile ? loadedDiffs[selectedFile] : null;
    if (!diff?.hunks) return;

    // Get commentable lines
    const commentableLines: number[] = [];
    for (const hunk of diff.hunks) {
      if (hunk.type === "hunk") {
        for (const line of hunk.lines) {
          const lineNum = line.newLineNumber || line.oldLineNumber;
          if (lineNum) commentableLines.push(lineNum);
        }
      }
    }
    if (commentableLines.length === 0) return;

    // Handle down navigation when on a line with comments
    if (direction === "down" && focusedLine && !focusedCommentId) {
      const lineComments = comments.filter(
        (c) => c.path === selectedFile && (c.line === focusedLine || c.original_line === focusedLine)
      );
      const linePendingComments = pendingComments.filter(
        (c) => c.path === selectedFile && c.line === focusedLine
      );

      if (lineComments.length > 0 || linePendingComments.length > 0) {
        if (lineComments.length > 0) {
          this.set({ focusedCommentId: lineComments[0].id });
          return;
        } else {
          this.set({ commentingOnLine: { line: focusedLine } });
          return;
        }
      }
    }

    // Handle up navigation when focused on a comment
    if (direction === "up" && focusedCommentId) {
      this.set({ focusedCommentId: null });
      return;
    }

    // Clear comment focus when moving lines
    const currentIdx = focusedLine ? commentableLines.indexOf(focusedLine) : -1;
    
    let nextIdx: number;
    if (direction === "down") {
      nextIdx = currentIdx === -1 ? 0 : Math.min(currentIdx + 1, commentableLines.length - 1);
    } else {
      nextIdx = currentIdx === -1 ? commentableLines.length - 1 : Math.max(currentIdx - 1, 0);
    }

    const nextLine = commentableLines[nextIdx];
    
    if (withShift) {
      this.set({
        focusedLine: nextLine,
        selectionAnchor: selectionAnchor ?? focusedLine ?? nextLine,
        focusedCommentId: null,
      });
    } else {
      this.set({
        focusedLine: nextLine,
        selectionAnchor: null,
        focusedCommentId: null,
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
    this.set({ gotoLineMode: false, gotoLineInput: "" });
  };

  appendGotoInput = (char: string) => {
    this.set({ gotoLineInput: this.state.gotoLineInput + char });
  };

  backspaceGotoInput = () => {
    this.set({ gotoLineInput: this.state.gotoLineInput.slice(0, -1) });
  };

  executeGotoLine = () => {
    const { gotoLineInput, selectedFile, loadedDiffs } = this.state;
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

    // Get commentable lines and find closest
    const commentableLines: number[] = [];
    for (const hunk of diff.hunks) {
      if (hunk.type === "hunk") {
        for (const line of hunk.lines) {
          const lineNum = line.newLineNumber || line.oldLineNumber;
          if (lineNum) commentableLines.push(lineNum);
        }
      }
    }

    if (commentableLines.length > 0) {
      const closestLine = commentableLines.reduce((closest, line) =>
        Math.abs(line - targetLine) < Math.abs(closest - targetLine)
          ? line
          : closest
      );
      this.set({
        focusedLine: closestLine,
        selectionAnchor: null,
        gotoLineMode: false,
        gotoLineInput: "",
      });
    } else {
      this.exitGotoMode();
    }
  };

  clearLineSelection = () => {
    this.set({
      focusedLine: null,
      selectionAnchor: null,
      commentingOnLine: null,
      gotoLineMode: false,
      gotoLineInput: "",
    });
  };

  // ---------------------------------------------------------------------------
  // Comment Actions
  // ---------------------------------------------------------------------------

  setComments = (comments: ReviewComment[]) => {
    this.set({ comments });
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

  addPendingComment = (comment: LocalPendingComment) => {
    this.set({
      pendingComments: [...this.state.pendingComments, comment],
      commentingOnLine: null,
      focusedLine: null,
      selectionAnchor: null,
    });
  };

  removePendingComment = (id: string) => {
    this.set({
      pendingComments: this.state.pendingComments.filter((c) => c.id !== id),
    });
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
    this.set({
      comments: this.state.comments.filter((c) => c.id !== commentId),
      focusedCommentId: null,
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
    const { focusedCommentId } = this.state;
    if (focusedCommentId) {
      this.set({ focusedCommentId: null });
    } else {
      this.set({
        focusedLine: null,
        selectionAnchor: null,
        selectedFiles: new Set(),
      });
    }
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
export function useIsLineFocused(lineNumber: number): boolean {
  return usePRReviewSelector((s) => s.focusedLine === lineNumber);
}

/** Check if a specific line is in the selection range */
export function useIsLineInSelection(lineNumber: number): boolean {
  return usePRReviewSelector((s) => {
    if (!s.focusedLine) return false;
    if (!s.selectionAnchor) return s.focusedLine === lineNumber;
    const start = Math.min(s.focusedLine, s.selectionAnchor);
    const end = Math.max(s.focusedLine, s.selectionAnchor);
    return lineNumber >= start && lineNumber <= end;
  });
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

      // Arrow navigation
      if (e.key === "ArrowDown") {
        e.preventDefault();
        store.navigateLine("down", e.shiftKey);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        store.navigateLine("up", e.shiftKey);
        return;
      }

      // Shortcuts
      switch (e.key.toLowerCase()) {
        case "k":
          e.preventDefault();
          store.navigateToNextUnviewedFile();
          break;
        case "j":
          e.preventDefault();
          store.navigateToPrevUnviewedFile();
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
        case "c":
          e.preventDefault();
          store.startCommentingOnFocusedLine();
          break;
        case "e":
          if (state.focusedCommentId) {
            e.preventDefault();
            store.startEditing(state.focusedCommentId);
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
            e.preventDefault();
            if (window.confirm("Are you sure you want to delete this comment?")) {
              // Trigger delete via API - component handles this
              const event = new CustomEvent("pr-review:delete-comment", {
                detail: { commentId: state.focusedCommentId },
              });
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
// Diff Loading Hook
// ============================================================================

const diffCache = new Map<string, ParsedDiff>();
const pendingFetches = new Map<string, Promise<ParsedDiff>>();
const MAX_CACHE_SIZE = 100;

async function fetchParsedDiff(file: PullRequestFile): Promise<ParsedDiff> {
  if (!file.patch) {
    return { hunks: [] };
  }

  const cacheKey = file.sha;

  if (diffCache.has(cacheKey)) {
    return diffCache.get(cacheKey)!;
  }

  if (pendingFetches.has(cacheKey)) {
    return pendingFetches.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    const response = await fetch("/api/parse-diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patch: file.patch,
        filename: file.filename,
        previousFilename: file.previous_filename,
        sha: file.sha,
      }),
    });

    const parsed = await response.json();

    if (parsed.error || !parsed.hunks) {
      pendingFetches.delete(cacheKey);
      return { hunks: [] };
    }

    if (diffCache.size >= MAX_CACHE_SIZE) {
      const firstKey = diffCache.keys().next().value;
      if (firstKey) diffCache.delete(firstKey);
    }

    diffCache.set(cacheKey, parsed);
    pendingFetches.delete(cacheKey);

    return parsed;
  })();

  pendingFetches.set(cacheKey, fetchPromise);
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
    if (!file || loadedDiffs[selectedFile]) return;

    store.setDiffLoading(selectedFile, true);

    fetchParsedDiff(file)
      .then((diff) => {
        store.setLoadedDiff(selectedFile, diff);
      })
      .catch(console.error)
      .finally(() => {
        store.setDiffLoading(selectedFile, false);
      });
  }, [selectedFile, files, loadedDiffs, store]);

  // Prefetch next files
  useEffect(() => {
    if (!selectedFile) return;

    const currentIndex = files.findIndex((f) => f.filename === selectedFile);
    const filesToPrefetch = files
      .slice(currentIndex + 1, currentIndex + 6)
      .filter((f) => !loadedDiffs[f.filename] && !pendingFetches.has(f.sha));

    for (const file of filesToPrefetch) {
      fetchParsedDiff(file)
        .then((diff) => {
          store.setLoadedDiff(file.filename, diff);
        })
        .catch(() => {});
    }
  }, [selectedFile, files, loadedDiffs, store]);
}

// ============================================================================
// Pending Review Hook
// ============================================================================

export function usePendingReviewLoader() {
  const store = useStore();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);

  useEffect(() => {
    const fetchPendingReview = async () => {
      try {
        const reviewsRes = await fetch(
          `/api/pr/${owner}/${repo}/${pr.number}/reviews`
        );
        if (!reviewsRes.ok) return;

        const reviews: Review[] = await reviewsRes.json();
        const pendingReview = reviews.find((r) => r.state === "PENDING");

        if (pendingReview) {
          store.setPendingReviewId(pendingReview.id);

          const commentsRes = await fetch(
            `/api/pr/${owner}/${repo}/${pr.number}/reviews/${pendingReview.id}/comments`
          );
          if (commentsRes.ok) {
            const pendingReviewComments: ReviewComment[] =
              await commentsRes.json();
            const localComments: LocalPendingComment[] =
              pendingReviewComments.map((c) => ({
                id: `github-${c.id}`,
                github_id: c.id,
                path: c.path,
                line: c.line || 0,
                start_line: c.start_line || undefined,
                body: c.body,
                side: c.side,
              }));
            store.setPendingComments(localComments);
          }
        }
      } catch (error) {
        console.error("Failed to fetch pending reviews:", error);
      }
    };

    fetchPendingReview();
  }, [owner, repo, pr.number, store]);
}

// ============================================================================
// API Action Hooks
// ============================================================================

export function useCommentActions() {
  const store = useStore();
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

    const newComment: LocalPendingComment = {
      id: `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      path: state.selectedFile,
      line,
      start_line: startLine,
      body,
      side: "RIGHT",
    };

    store.addPendingComment(newComment);
  };

  const removePendingComment = async (id: string) => {
    const state = store.getSnapshot();
    const comment = state.pendingComments.find((c) => c.id === id);

    if (comment?.github_id) {
      try {
        await fetch(`/api/pr/${owner}/${repo}/comments/${comment.github_id}`, {
          method: "DELETE",
        });
      } catch (error) {
        console.error("Failed to delete comment:", error);
      }
    }

    store.removePendingComment(id);
  };

  const updateComment = async (commentId: number, newBody: string) => {
    try {
      const response = await fetch(
        `/api/pr/${owner}/${repo}/comments/${commentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: newBody }),
        }
      );

      if (response.ok) {
        const updatedComment = await response.json();
        store.updateComment(commentId, updatedComment);
      }
    } catch (error) {
      console.error("Failed to update comment:", error);
    }
  };

  const deleteComment = async (commentId: number) => {
    try {
      const response = await fetch(
        `/api/pr/${owner}/${repo}/comments/${commentId}`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        store.deleteComment(commentId);
      }
    } catch (error) {
      console.error("Failed to delete comment:", error);
    }
  };

  const replyToComment = async (commentId: number, body: string) => {
    try {
      const response = await fetch(
        `/api/pr/${owner}/${repo}/${pr.number}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply_to_id: commentId, body }),
        }
      );

      if (response.ok) {
        const newComment = await response.json();
        store.addReply(newComment);
      }
    } catch (error) {
      console.error("Failed to reply to comment:", error);
    }
  };

  return {
    addPendingComment,
    removePendingComment,
    updateComment,
    deleteComment,
    replyToComment,
  };
}

export function useReviewActions() {
  const store = useStore();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);

  const submitReview = async (
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  ) => {
    const state = store.getSnapshot();
    store.setSubmittingReview(true);

    try {
      let response;

      if (state.pendingReviewId) {
        response = await fetch(
          `/api/pr/${owner}/${repo}/${pr.number}/reviews/${state.pendingReviewId}/submit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event,
              body: state.reviewBody,
            }),
          }
        );
      } else {
        response = await fetch(`/api/pr/${owner}/${repo}/${pr.number}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commit_id: pr.head.sha,
            event,
            body: state.reviewBody,
            comments: state.pendingComments
              .filter((c) => !c.github_id)
              .map(({ path, line, body, side, start_line }) => ({
                path,
                line,
                body,
                side,
                start_line,
              })),
          }),
        });
      }

      if (response.ok) {
        // Refresh comments
        const commentsRes = await fetch(
          `/api/pr/${owner}/${repo}/${pr.number}/comments`
        );
        if (commentsRes.ok) {
          const newComments = await commentsRes.json();
          store.setComments(newComments);
        }

        store.clearReviewState();
      }
    } finally {
      store.setSubmittingReview(false);
    }
  };

  return { submitReview };
}

// ============================================================================
// File Copy Actions Hook
// ============================================================================

export function useFileCopyActions() {
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
      const response = await fetch(
        `/api/file/${owner}/${repo}?path=${encodeURIComponent(filename)}&ref=${pr.head.sha}`
      );
      if (response.ok) {
        const content = await response.text();
        await navigator.clipboard.writeText(content);
      }
    } catch (error) {
      console.error("Failed to copy file:", error);
    }
  };

  const copyMainVersion = async (filename: string) => {
    try {
      const file = files.find((f) => f.filename === filename);
      const basePath = file?.previous_filename || filename;

      const response = await fetch(
        `/api/file/${owner}/${repo}?path=${encodeURIComponent(basePath)}&ref=${pr.base.sha}`
      );
      if (response.ok) {
        const content = await response.text();
        await navigator.clipboard.writeText(content);
      }
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

