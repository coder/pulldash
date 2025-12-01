import React, { memo, useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Loader2,
  MessageSquare,
  Reply,
  Send,
  X,
  ChevronsUpDown,
  Check,
  XCircle,
  MessageCircle,
  Eye,
  EyeOff,
  Trash2,
  GitPullRequest,
  FileCode,
  Pencil,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { cn } from "../cn";
import { PRHeader } from "./pr-header";
import { FileTree } from "./file-tree";
import { FileHeader } from "./file-header";
import type { PullRequest, PullRequestFile, ReviewComment } from "@/api/github";
import {
  PRReviewProvider,
  usePRReviewSelector,
  usePRReviewStore,
  useKeyboardNavigation,
  useDiffLoader,
  usePendingReviewLoader,
  useCommentActions,
  useReviewActions,
  useFileCopyActions,
  useCurrentFile,
  useCurrentDiff,
  useIsCurrentFileLoading,
  useCurrentFileComments,
  useCurrentFilePendingComments,
  useCommentCountsByFile,
  usePendingCommentCountsByFile,
  useIsLineFocused,
  useIsLineInSelection,
  useIsLineCommenting,
  useIsLineInCommentingRange,
  useSelectionRange,
  getTimeAgo,
  type LocalPendingComment,
  type ParsedDiff,
  type DiffLine,
  type DiffHunk,
  type DiffSkipBlock,
} from "../contexts/pr-review";

// ============================================================================
// Page Component (Data Fetching)
// ============================================================================

export function PRReviewPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const navigate = useNavigate();

  const [pr, setPr] = useState<PullRequest | null>(null);
  const [files, setFiles] = useState<PullRequestFile[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo || !number) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [prRes, filesRes, commentsRes] = await Promise.all([
          fetch(`/api/pr/${owner}/${repo}/${number}`),
          fetch(`/api/pr/${owner}/${repo}/${number}/files`),
          fetch(`/api/pr/${owner}/${repo}/${number}/comments`),
        ]);

        if (!prRes.ok || !filesRes.ok || !commentsRes.ok) {
          throw new Error("Failed to fetch PR data");
        }

        const [prData, filesData, commentsData] = await Promise.all([
          prRes.json(),
          filesRes.json(),
          commentsRes.json(),
        ]);

        setPr(prData);
        setFiles(filesData);
        setComments(commentsData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [owner, repo, number]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading PR...</p>
        </div>
      </div>
    );
  }

  if (error || !pr) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <p className="text-destructive font-medium">Failed to load PR</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 text-sm rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <PRReviewProvider
      pr={pr}
      files={files}
      comments={comments}
      owner={owner!}
      repo={repo!}
    >
      <PRReviewContent />
    </PRReviewProvider>
  );
}

// ============================================================================
// Main Review Component (Layout)
// ============================================================================

function PRReviewContent() {
  // Initialize hooks that load data
  useKeyboardNavigation();
  useDiffLoader();
  usePendingReviewLoader();

  // Listen for delete comment events from keyboard navigation
  const { deleteComment } = useCommentActions();
  useEffect(() => {
    const handler = (e: CustomEvent<{ commentId: number }>) => {
      deleteComment(e.detail.commentId);
    };
    window.addEventListener(
      "pr-review:delete-comment",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "pr-review:delete-comment",
        handler as EventListener
      );
  }, [deleteComment]);

  const pr = usePRReviewSelector((s) => s.pr);
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const showReviewPanel = usePRReviewSelector((s) => s.showReviewPanel);

  return (
    <div className="flex flex-col h-screen">
      <PRHeader pr={pr} owner={owner} repo={repo} />

      <div className="flex flex-1 overflow-hidden">
        <FilePanel />
        <DiffPanel />
      </div>

      {showReviewPanel && <ReviewPanel />}
    </div>
  );
}

// ============================================================================
// File Panel (Sidebar)
// ============================================================================

const FilePanel = memo(function FilePanel() {
  const store = usePRReviewStore();
  const pr = usePRReviewSelector((s) => s.pr);
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const files = usePRReviewSelector((s) => s.files);
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const selectedFiles = usePRReviewSelector((s) => s.selectedFiles);
  const viewedFiles = usePRReviewSelector((s) => s.viewedFiles);
  const hideViewed = usePRReviewSelector((s) => s.hideViewed);
  const pendingCommentsCount = usePRReviewSelector(
    (s) => s.pendingComments.length
  );

  const commentCounts = useCommentCountsByFile();
  const pendingCommentCounts = usePendingCommentCountsByFile();
  const { copyDiff, copyFile, copyMainVersion } = useFileCopyActions();

  return (
        <aside className="w-72 border-r border-border flex flex-col overflow-hidden shrink-0">
          {/* Navigation tabs */}
          <div className="flex border-b border-border">
            <Link
              to={`/${owner}/${repo}/pull/${pr.number}`}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <GitPullRequest className="w-4 h-4" />
              Overview
            </Link>
            <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 border-primary bg-muted/30">
              <FileCode className="w-4 h-4" />
              Files
            </div>
          </div>
          
          <div className="p-3 border-b border-border flex items-center gap-2">
        <span className="text-sm font-medium">{files.length} files changed</span>
            <span className="text-xs text-muted-foreground ml-auto">
              <span className="text-green-500">+{pr.additions}</span>{" "}
              <span className="text-red-500">−{pr.deletions}</span>
            </span>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                onClick={store.toggleHideViewed}
                    className={cn(
                      "p-1.5 rounded transition-colors",
                      hideViewed
                        ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {hideViewed ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {hideViewed ? "Show viewed files" : "Hide viewed files"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <FileTree
            files={files}
            selectedFile={selectedFile}
            selectedFiles={selectedFiles}
            viewedFiles={viewedFiles}
            hideViewed={hideViewed}
        commentCounts={commentCounts}
        pendingCommentCounts={pendingCommentCounts}
        onSelectFile={store.selectFile}
        onToggleFileSelection={store.toggleFileSelection}
        onToggleViewed={store.toggleViewed}
        onToggleViewedMultiple={store.toggleViewedMultiple}
        onMarkFolderViewed={store.markFolderViewed}
        onCopyDiff={copyDiff}
        onCopyFile={copyFile}
        onCopyMainVersion={copyMainVersion}
      />

      {pendingCommentsCount > 0 && (
            <div className="p-3 border-t border-border">
              <button
            onClick={store.openReviewPanel}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Eye className="w-4 h-4" />
            Review ({pendingCommentsCount} pending)
              </button>
            </div>
          )}
        </aside>
  );
});

// ============================================================================
// Diff Panel (Main Content)
// ============================================================================

const DiffPanel = memo(function DiffPanel() {
  const store = usePRReviewStore();
  const files = usePRReviewSelector((s) => s.files);
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const viewedFiles = usePRReviewSelector((s) => s.viewedFiles);
  const selectedFiles = usePRReviewSelector((s) => s.selectedFiles);
  const pendingCommentsCount = usePRReviewSelector(
    (s) => s.pendingComments.length
  );

  const currentFile = useCurrentFile();
  const parsedDiff = useCurrentDiff();
  const isLoading = useIsCurrentFileLoading();

  const currentIndex = selectedFile
    ? files.findIndex((f) => f.filename === selectedFile)
    : -1;

  return (
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* File navigation bar */}
          <div className="shrink-0 border-b border-border bg-card px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
            onClick={() => store.navigateToFile("prev")}
            disabled={currentIndex <= 0}
                className="px-2 py-1 text-sm rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <span className="text-sm text-muted-foreground">
            File {currentIndex + 1} of {files.length}
              </span>
              <button
            onClick={() => store.navigateToFile("next")}
            disabled={currentIndex >= files.length - 1}
                className="px-2 py-1 text-sm rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
            <span className="text-green-500 font-medium">
              {viewedFiles.size}
            </span>
            <span className="text-muted-foreground">
              {" "}
              / {files.length} reviewed
            </span>
              </span>
              {files.length - viewedFiles.size > 0 && (
                <span className="text-yellow-500">
                  {files.length - viewedFiles.size} remaining
                </span>
              )}
              {selectedFiles.size > 0 && (
            <span className="text-blue-400">{selectedFiles.size} selected</span>
              )}
            </div>
          </div>

          {currentFile ? (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Sticky file header */}
              <div className="shrink-0 border-b border-border bg-muted/50 backdrop-blur-sm z-20">
                <div className="px-4 py-2">
                  <FileHeader
                    file={currentFile}
                    isViewed={viewedFiles.has(currentFile.filename)}
                onToggleViewed={() => store.toggleViewed(currentFile.filename)}
                  />
                </div>
              </div>
              
              {/* Scrollable diff content */}
              <div className="flex-1 overflow-auto themed-scrollbar">
                <div className="p-4">
                  <div className="border border-border rounded-lg overflow-hidden">
                    {isLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                ) : parsedDiff && parsedDiff.hunks.length > 0 ? (
                  <DiffViewer diff={parsedDiff} />
                    ) : (
                      <div className="p-4 text-sm text-muted-foreground text-center">
                        {!currentFile.patch 
                          ? "Binary file or file too large to display"
                          : "No changes to display"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
          <KeybindsBar />
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-center flex-1 text-muted-foreground">
            Select a file to view changes
          </div>
          <KeybindsBar />
        </div>
      )}
    </main>
  );
});

// ============================================================================
// Keybinds Bar
// ============================================================================

const KeybindsBar = memo(function KeybindsBar() {
  const gotoLineMode = usePRReviewSelector((s) => s.gotoLineMode);
  const gotoLineInput = usePRReviewSelector((s) => s.gotoLineInput);
  const focusedLine = usePRReviewSelector((s) => s.focusedLine);
  const selectionAnchor = usePRReviewSelector((s) => s.selectionAnchor);
  const focusedCommentId = usePRReviewSelector((s) => s.focusedCommentId);
  const commentingOnLine = usePRReviewSelector((s) => s.commentingOnLine);
  const pendingCommentsCount = usePRReviewSelector(
    (s) => s.pendingComments.length
  );

  const showEscape =
    gotoLineMode || focusedLine || focusedCommentId || commentingOnLine;

  return (
    <div
      className={cn(
                "shrink-0 border-t border-border px-4 py-2.5",
                gotoLineMode && "bg-blue-500/10",
                focusedCommentId && "bg-yellow-500/10",
                commentingOnLine && "bg-green-500/10",
        !gotoLineMode &&
          !focusedCommentId &&
          !commentingOnLine &&
          "bg-muted/30"
      )}
    >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4">
                    {gotoLineMode ? (
                      <>
                        <span className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">
                  GOTO
                </span>
                          <span className="font-mono text-blue-400">
                            {gotoLineInput || "..."}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                Type line number, then{" "}
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  Enter
                </kbd>{" "}
                to jump
                        </span>
                      </>
                    ) : commentingOnLine ? (
                      <>
              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium">
                COMMENT
              </span>
                        <span className="font-mono text-green-400">
                L
                {commentingOnLine.startLine
                  ? `${commentingOnLine.startLine}-`
                  : ""}
                {commentingOnLine.line}
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  ⌘Enter
                </kbd>{" "}
                submit
                        </span>
                      </>
                    ) : focusedCommentId ? (
                      <>
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs font-medium">
                COMMENT
              </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  r
                </kbd>{" "}
                reply
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  e
                </kbd>{" "}
                edit
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  d
                </kbd>{" "}
                delete
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  ↑
                </kbd>{" "}
                back to line
                        </span>
                      </>
                    ) : focusedLine ? (
                      <>
                        <span className="font-mono text-blue-400">
                          {selectionAnchor 
                            ? `L${Math.min(focusedLine, selectionAnchor)}-${Math.max(focusedLine, selectionAnchor)}`
                  : `L${focusedLine}`}
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  c
                </kbd>{" "}
                comment
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  ↓
                </kbd>{" "}
                view comments
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  Shift+↑↓
                </kbd>{" "}
                select range
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  ↑↓
                </kbd>{" "}
                select line
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  g
                </kbd>{" "}
                goto line
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  j
                </kbd>
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono ml-0.5">
                  k
                </kbd>{" "}
                next/prev unreviewed
                        </span>
                        <span className="text-muted-foreground">
                <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                  v
                </kbd>{" "}
                mark viewed
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
          {pendingCommentsCount > 0 && (
                      <span className="text-yellow-400 text-xs">
              {pendingCommentsCount} pending comment
              {pendingCommentsCount !== 1 ? "s" : ""}
                      </span>
                    )}
          {showEscape && (
                      <span className="text-muted-foreground">
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                Esc
              </kbd>{" "}
              {gotoLineMode ? "cancel" : commentingOnLine ? "cancel" : "clear"}
                      </span>
                    )}
                  </div>
                </div>
    </div>
  );
});

// ============================================================================
// Line Number Drag Selection Context
// ============================================================================

interface LineDragContextValue {
  isDragging: boolean;
  dragAnchor: number | null;
  onDragStart: (lineNum: number) => void;
  onDragEnter: (lineNum: number) => void;
  onDragEnd: () => void;
  onClickFallback: (lineNum: number) => void;
}

const LineDragContext = React.createContext<LineDragContextValue | null>(null);

function useLineDrag() {
  const ctx = React.useContext(LineDragContext);
  if (!ctx) throw new Error("useLineDrag must be used within LineDragProvider");
  return ctx;
}

// ============================================================================
// Diff Viewer
// ============================================================================

interface DiffViewerProps {
  diff: ParsedDiff;
}

const DiffViewer = memo(function DiffViewer({ diff }: DiffViewerProps) {
  const hunks = diff?.hunks ?? [];
  const store = usePRReviewStore();
  
  // Use refs for drag state to avoid stale closure issues in handlers
  const isDraggingRef = useRef(false);
  const dragAnchorRef = useRef<number | null>(null);
  const handledByMouseEventsRef = useRef(false);
  // State to track dragging for context consumers (so they can react to drag state changes)
  const [isDraggingState, setIsDraggingState] = useState(false);

  const onDragStart = useCallback((lineNum: number) => {
    isDraggingRef.current = true;
    dragAnchorRef.current = lineNum;
    store.setFocusedLine(lineNum);
    store.setSelectionAnchor(lineNum);
    setIsDraggingState(true);
  }, [store]);

  const onDragEnter = useCallback((lineNum: number) => {
    if (isDraggingRef.current && dragAnchorRef.current !== null) {
      store.setFocusedLine(lineNum);
    }
  }, [store]);

  const onDragEnd = useCallback(() => {
    if (isDraggingRef.current && dragAnchorRef.current !== null) {
      handledByMouseEventsRef.current = true;
      const state = store.getSnapshot();
      const focusedLine = state.focusedLine;
      const anchor = state.selectionAnchor;

      if (focusedLine !== null) {
        if (anchor !== null && anchor !== focusedLine) {
          // Multi-line selection - start commenting with range
          const startLine = Math.min(anchor, focusedLine);
          const endLine = Math.max(anchor, focusedLine);
          store.startCommenting(endLine, startLine);
        } else {
          // Single line click - start commenting
          store.startCommenting(focusedLine);
        }
      }
    }
    isDraggingRef.current = false;
    dragAnchorRef.current = null;
    setIsDraggingState(false);
  }, [store]);

  // Fallback for clicks when mousedown/mouseup didn't fire
  const onClickFallback = useCallback((lineNum: number) => {
    if (handledByMouseEventsRef.current) {
      // Reset for next interaction - was already handled by mousedown/mouseup
      handledByMouseEventsRef.current = false;
      return;
    }
    // Mouse events didn't fire, handle the click directly
    store.startCommenting(lineNum);
  }, [store]);

  // Handle mouse up anywhere on the document
  useEffect(() => {
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        onDragEnd();
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [onDragEnd]);

  const dragValue = useMemo(() => ({
    isDragging: isDraggingState,
    dragAnchor: dragAnchorRef.current,
    onDragStart,
    onDragEnter,
    onDragEnd,
    onClickFallback,
  }), [isDraggingState, onDragStart, onDragEnter, onDragEnd, onClickFallback]);

  return (
    <LineDragContext.Provider value={dragValue}>
      <table className="w-full border-collapse font-mono text-[0.8rem] [--code-added:theme(colors.green.500)] [--code-removed:theme(colors.orange.600)]">
        <tbody>
          {hunks.map((hunk, hunkIndex) =>
            hunk.type === "skip" ? (
              <SkipBlockRow key={`skip-${hunkIndex}`} hunk={hunk} />
            ) : (
              <HunkLines key={`hunk-${hunkIndex}`} hunk={hunk} />
            )
          )}
        </tbody>
      </table>
    </LineDragContext.Provider>
  );
});

// ============================================================================
// Hunk Lines (renders all lines in a hunk)
// ============================================================================

interface HunkLinesProps {
  hunk: DiffHunk;
}

const HunkLines = memo(function HunkLines({ hunk }: HunkLinesProps) {
  return (
    <>
      {hunk.lines.map((line, lineIndex) => {
        const lineNum = line.newLineNumber || line.oldLineNumber;
        return (
          <DiffLineWithComments
            key={`line-${lineIndex}`}
            line={line}
            lineNum={lineNum}
          />
        );
      })}
    </>
  );
});

// ============================================================================
// Diff Line With Comments (handles line + its comments)
// ============================================================================

interface DiffLineWithCommentsProps {
  line: DiffLine;
  lineNum: number | undefined;
}

const DiffLineWithComments = memo(function DiffLineWithComments({
  line,
  lineNum,
}: DiffLineWithCommentsProps) {
  const comments = useCurrentFileComments();
  const pendingComments = useCurrentFilePendingComments();
  const commentingOnLine = usePRReviewSelector((s) => s.commentingOnLine);
  const editingCommentId = usePRReviewSelector((s) => s.editingCommentId);
  const replyingToCommentId = usePRReviewSelector((s) => s.replyingToCommentId);
  const focusedCommentId = usePRReviewSelector((s) => s.focusedCommentId);

  // Get comments for this line
  const lineComments = useMemo(() => {
    if (!lineNum) return [];
    return comments.filter(
      (c) => c.line === lineNum || c.original_line === lineNum
    );
  }, [comments, lineNum]);

  // Group into threads
  const threads = useMemo(() => {
    const threadMap: Map<number, ReviewComment[]> = new Map();

    for (const comment of lineComments) {
      if (!comment.in_reply_to_id) {
        threadMap.set(comment.id, [comment]);
      }
    }

    for (const comment of lineComments) {
      if (comment.in_reply_to_id) {
        const thread = threadMap.get(comment.in_reply_to_id);
        if (thread) {
          thread.push(comment);
        }
      }
    }

    return [...threadMap.values()];
  }, [lineComments]);

  // Get pending comments for this line
  const linePendingComments = useMemo(() => {
    if (!lineNum) return [];
    return pendingComments.filter((c) => c.line === lineNum);
  }, [pendingComments, lineNum]);

                const isCommenting = lineNum === commentingOnLine?.line;

                return (
    <Fragment>
      <DiffLineRow line={line} lineNum={lineNum} />

                    {isCommenting && lineNum && (
                      <tr>
                        <td colSpan={3} className="p-0">
                          <InlineCommentForm
                            line={lineNum}
                            startLine={commentingOnLine?.startLine}
                          />
                        </td>
                      </tr>
                    )}
                    
      {linePendingComments.map((pending) => (
                      <tr key={pending.id}>
                        <td colSpan={3} className="p-0">
            <PendingCommentItem comment={pending} />
                        </td>
                      </tr>
                    ))}
                    
      {threads.map((thread, threadIdx) => (
                      <tr key={`thread-${lineNum}-${threadIdx}`}>
                        <td colSpan={3} className="p-0">
                          <CommentThread
                            comments={thread}
                            focusedCommentId={focusedCommentId}
                            editingCommentId={editingCommentId}
                            replyingToCommentId={replyingToCommentId}
                          />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
  );
});

// ============================================================================
// Diff Line Row
// ============================================================================

interface DiffLineRowProps {
  line: DiffLine;
  lineNum: number | undefined;
}

const DiffLineRow = memo(function DiffLineRow({
  line,
  lineNum,
}: DiffLineRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const { isDragging, onDragStart, onDragEnter, onDragEnd, onClickFallback } = useLineDrag();

  // Fine-grained subscriptions - only re-render when THIS line's state changes
  const isFocused = useIsLineFocused(lineNum ?? -1);
  const isInSelection = useIsLineInSelection(lineNum ?? -1);
  const isInCommentingRange = useIsLineInCommentingRange(lineNum ?? -1);

  // Check if this line has comment range highlighting
  const comments = useCurrentFileComments();
  const pendingComments = useCurrentFilePendingComments();

  const hasCommentRange = useMemo(() => {
    if (!lineNum) return false;
    for (const comment of comments) {
      if (
        comment.start_line &&
        comment.line &&
        lineNum >= comment.start_line &&
        lineNum <= comment.line
      ) {
        return true;
      }
    }
    for (const comment of pendingComments) {
      if (
        comment.start_line &&
        lineNum >= comment.start_line &&
        lineNum <= comment.line
      ) {
        return true;
      }
    }
    return false;
  }, [lineNum, comments, pendingComments]);

  const Tag =
    line.type === "insert" ? "ins" : line.type === "delete" ? "del" : "span";
  const displayLineNum =
    line.type === "delete" ? line.oldLineNumber : line.newLineNumber;

  // Scroll focused line into view (but not while dragging to avoid janky scrolling)
  useEffect(() => {
    if (isFocused && rowRef.current && !isDragging) {
      rowRef.current.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [isFocused, isDragging]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (lineNum) {
      e.preventDefault(); // Prevent text selection
      onDragStart(lineNum);
    }
  }, [lineNum, onDragStart]);

  const handleMouseUp = useCallback(() => {
    // onDragEnd checks the ref internally
    onDragEnd();
  }, [onDragEnd]);

  const handleMouseEnter = useCallback(() => {
    if (lineNum) {
      // onDragEnter checks the ref internally
      onDragEnter(lineNum);
    }
  }, [lineNum, onDragEnter]);

  // Fallback for clicks that don't trigger mousedown/mouseup (e.g., keyboard, touch, automation)
  const handleClick = useCallback(() => {
    if (lineNum) {
      onClickFallback(lineNum);
    }
  }, [lineNum, onClickFallback]);

  return (
    <tr
      ref={rowRef}
      className={cn(
        "whitespace-pre-wrap box-border border-none h-5 min-h-5 group",
        line.type === "insert" && "bg-[var(--code-added)]/10",
        line.type === "delete" && "bg-[var(--code-removed)]/10",
        hasCommentRange && "bg-yellow-500/5",
        (isInSelection || isInCommentingRange) && "!bg-blue-500/20",
        isFocused && "ring-2 ring-blue-500 ring-inset"
      )}
    >
      <td
        className={cn(
          "border-transparent w-1 border-l-[3px]",
          line.type === "insert" && "!border-[var(--code-added)]/60",
          line.type === "delete" && "!border-[var(--code-removed)]/80"
        )}
      />
      <td
        className="tabular-nums text-center opacity-50 px-2 text-xs select-none w-12 cursor-pointer hover:bg-blue-500/20 align-top pt-0.5"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseEnter={handleMouseEnter}
        onClick={handleClick}
      >
        {line.type === "delete" ? "–" : displayLineNum}
      </td>
      <td className="whitespace-pre-wrap break-words pr-6">
        <Tag className="no-underline">
          {line.content.map((seg, i) => (
            <span
              key={i}
              className={cn(
                seg.type === "insert" && "bg-[var(--code-added)]/20",
                seg.type === "delete" && "bg-[var(--code-removed)]/20"
              )}
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          ))}
        </Tag>
      </td>
    </tr>
  );
});

// ============================================================================
// Skip Block Row
// ============================================================================

interface SkipBlockRowProps {
  hunk: DiffSkipBlock;
}

const SkipBlockRow = memo(function SkipBlockRow({ hunk }: SkipBlockRowProps) {
  return (
    <>
      <tr className="h-2" />
      <tr className="h-10 font-mono bg-muted text-muted-foreground">
        <td />
        <td className="opacity-50 select-none text-center">
          <ChevronsUpDown className="w-4 h-4 mx-auto" />
        </td>
        <td>
          <span className="pl-2 italic opacity-50">
            {hunk.content || `${hunk.count} lines hidden`}
          </span>
        </td>
      </tr>
      <tr className="h-2" />
    </>
  );
});

// ============================================================================
// Inline Comment Form
// ============================================================================

interface InlineCommentFormProps {
  line: number;
  startLine?: number;
}

const InlineCommentForm = memo(function InlineCommentForm({
  line,
  startLine,
}: InlineCommentFormProps) {
  const store = usePRReviewStore();
  const { addPendingComment } = useCommentActions();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;

    setSubmitting(true);
    try {
      await addPendingComment(line, text.trim(), startLine);
      setText("");
    } finally {
      setSubmitting(false);
    }
  }, [text, line, startLine, addPendingComment]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
        store.cancelCommenting();
    }
    },
    [handleSubmit, store]
  );

  const lineLabel = startLine ? `lines ${startLine}-${line}` : `line ${line}`;

  return (
    <div className="border-l-2 border-green-500 bg-green-500/5 p-4 mx-4 my-2 rounded-r-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Comment on {lineLabel}
          <span className="text-xs opacity-60">(⌘+Enter to submit)</span>
        </span>
        <button
          onClick={store.cancelCommenting}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Leave a comment... (will be added to your pending review)"
        className="w-full min-h-[100px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring font-sans"
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={store.cancelCommenting}
          className="px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          Add to review
        </button>
      </div>
    </div>
  );
});

// ============================================================================
// Comment Thread
// ============================================================================

interface CommentThreadProps {
  comments: ReviewComment[];
  focusedCommentId: number | null;
  editingCommentId: number | null;
  replyingToCommentId: number | null;
}

const CommentThread = memo(function CommentThread({ 
  comments, 
  focusedCommentId,
  editingCommentId,
  replyingToCommentId,
}: CommentThreadProps) {
  const store = usePRReviewStore();
  const { replyToComment, updateComment, deleteComment } = useCommentActions();
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  
  const replyingTo = comments.find((c) => c.id === replyingToCommentId)?.id ?? null;

  const handleSubmitReply = useCallback(async () => {
    if (!replyText.trim() || !replyingTo) return;

    setSubmitting(true);
    try {
      await replyToComment(replyingTo, replyText.trim());
      setReplyText("");
    } finally {
      setSubmitting(false);
    }
  }, [replyText, replyingTo, replyToComment]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmitReply();
    }
    if (e.key === "Escape") {
      e.preventDefault();
        store.cancelReplying();
      setReplyText("");
    }
    },
    [handleSubmitReply, store]
  );

  const handleCancel = useCallback(() => {
    store.cancelReplying();
    setReplyText("");
  }, [store]);

  return (
    <div className="border-l-2 border-blue-500/50 bg-card/80 mx-4 my-2 rounded-r-lg">
      {comments.map((comment, idx) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          isReply={idx > 0}
          isFocused={focusedCommentId === comment.id}
          isEditing={editingCommentId === comment.id}
          onUpdate={updateComment}
          onDelete={deleteComment}
        />
      ))}

      {replyingTo && (
        <div className="px-4 py-3 border-t border-border/50">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a reply... (⌘+Enter to submit)"
            className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring font-sans"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitReply}
              disabled={!replyText.trim() || submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Comment Item
// ============================================================================

interface CommentItemProps {
  comment: ReviewComment;
  isReply?: boolean;
  isFocused?: boolean;
  isEditing?: boolean;
  onUpdate: (commentId: number, body: string) => Promise<void>;
  onDelete: (commentId: number) => Promise<void>;
}

const CommentItem = memo(function CommentItem({ 
  comment, 
  isReply, 
  isFocused,
  isEditing,
  onUpdate,
  onDelete,
}: CommentItemProps) {
  const store = usePRReviewStore();
  const timeAgo = useMemo(
    () => getTimeAgo(new Date(comment.created_at)),
    [comment.created_at]
  );
  const [editText, setEditText] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const commentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditText(comment.body);
    }
  }, [isEditing, comment.body]);

  useEffect(() => {
    if (isFocused && commentRef.current) {
      commentRef.current.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [isFocused]);

  const handleSave = useCallback(async () => {
    if (!editText.trim() || editText === comment.body) {
      store.cancelEditing();
      return;
    }
    setSaving(true);
    try {
      await onUpdate(comment.id, editText.trim());
    } finally {
      setSaving(false);
    }
  }, [editText, comment.id, comment.body, onUpdate, store]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
        store.cancelEditing();
    }
    },
    [handleSave, store]
  );

  return (
    <div 
      ref={commentRef}
      className={cn(
        "px-4 py-3 font-sans", 
        isReply && "pl-12 border-t border-border/30",
        isFocused && "ring-2 ring-blue-500 ring-inset bg-blue-500/5"
      )}
    >
      <div className="flex items-start gap-3">
        <img
          src={comment.user.avatar_url}
          alt={comment.user.login}
          className="w-6 h-6 rounded-full shrink-0"
          loading="lazy"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{comment.user.login}</span>
            <span className="text-muted-foreground text-xs">{timeAgo}</span>
          </div>
          
          {isEditing ? (
            <div className="mt-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={store.cancelEditing}
                  className="px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!editText.trim() || saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-1 text-sm text-foreground/90 whitespace-pre-wrap">
                {comment.body}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={() => store.startReplying(comment.id)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Reply className="w-3 h-3" />
                  Reply
                </button>
                <button
                  onClick={() => store.startEditing(comment.id)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => onDelete(comment.id)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Pending Comment Item
// ============================================================================

interface PendingCommentItemProps {
  comment: LocalPendingComment;
}

const PendingCommentItem = memo(function PendingCommentItem({
  comment,
}: PendingCommentItemProps) {
  const { removePendingComment } = useCommentActions();

  const lineLabel = comment.start_line 
    ? `Lines ${comment.start_line}-${comment.line}` 
    : `Line ${comment.line}`;
    
  return (
    <div className="border-l-2 border-yellow-500 bg-yellow-500/10 mx-4 my-2 rounded-r-lg">
      <div className="px-4 py-3 font-sans">
        <div className="flex items-start gap-3">
          <MessageCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-yellow-500 font-medium text-xs">
                  Pending comment
                </span>
                <span className="text-muted-foreground text-xs font-mono">
                  {lineLabel}
                </span>
              </div>
              <button
                onClick={() => removePendingComment(comment.id)}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-1 text-sm text-foreground/90 whitespace-pre-wrap">
              {comment.body}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Review Panel Modal
// ============================================================================

const ReviewPanel = memo(function ReviewPanel() {
  const store = usePRReviewStore();
  const { submitReview } = useReviewActions();
  const { removePendingComment } = useCommentActions();

  const pendingComments = usePRReviewSelector((s) => s.pendingComments);
  const reviewBody = usePRReviewSelector((s) => s.reviewBody);
  const submitting = usePRReviewSelector((s) => s.submittingReview);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Finish your review</h2>
          <button
            onClick={store.closeReviewPanel}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {pendingComments.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                {pendingComments.length} pending comment
                {pendingComments.length !== 1 ? "s" : ""}
              </h3>
              <div className="space-y-2 max-h-40 overflow-auto">
                {pendingComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {comment.path}:{comment.line}
                      </div>
                      <div className="mt-1 text-foreground/90 line-clamp-2">
                        {comment.body}
                      </div>
                    </div>
                    <button
                      onClick={() => removePendingComment(comment.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium mb-2">
              Leave a comment (optional)
            </label>
            <textarea
              value={reviewBody}
              onChange={(e) => store.setReviewBody(e.target.value)}
              placeholder="Write your review summary..."
              className="w-full min-h-[120px] px-4 py-3 text-sm rounded-lg border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <button
            onClick={store.closeReviewPanel}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => submitReview("COMMENT")}
            disabled={submitting || pendingComments.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          >
            <MessageSquare className="w-4 h-4" />
            Comment
          </button>
          <button
            onClick={() => submitReview("REQUEST_CHANGES")}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            <XCircle className="w-4 h-4" />
            Request changes
          </button>
          <button
            onClick={() => submitReview("APPROVE")}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
});
