import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Search,
  ExternalLink,
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
  useHashNavigation,
  useDiffLoader,
  usePendingReviewLoader,
  useCurrentUserLoader,
  useCommentActions,
  useReviewActions,
  useFileCopyActions,
  useSkipBlockExpansion,
  useThreadActions,
  useCurrentFile,
  useCurrentDiff,
  useIsCurrentFileLoading,
  useCurrentFileComments,
  useCurrentFilePendingComments,
  useCommentCountsByFile,
  usePendingCommentCountsByFile,
  useIsLineInCommentingRange,
  useIsLineInCommentRange,
  useSelectionBoundary,
  getTimeAgo,
  type LocalPendingComment,
  type ParsedDiff,
  type DiffLine,
  type DiffHunk,
  type DiffSkipBlock,
} from "../contexts/pr-review";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "../ui/dropdown-menu";
import { Keycap, KeycapGroup } from "../ui/keycap";
import { CommandPalette, useCommandPalette } from "./command-palette";

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
  const store = usePRReviewStore();
  const { open: commandPaletteOpen, setOpen: setCommandPaletteOpen } = useCommandPalette();
  
  // Expose for button click
  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), [setCommandPaletteOpen]);
  
  // Initialize hooks that load data
  useKeyboardNavigation();
  useHashNavigation();
  useDiffLoader();
  usePendingReviewLoader();
  useCurrentUserLoader();

  // Listen for delete comment events from keyboard navigation
  const { deleteComment, removePendingComment } = useCommentActions();
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

  // Listen for delete pending comment events from keyboard navigation
  useEffect(() => {
    const handler = (e: CustomEvent<{ commentId: string }>) => {
      removePendingComment(e.detail.commentId);
    };
    window.addEventListener(
      "pr-review:delete-pending-comment",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "pr-review:delete-pending-comment",
        handler as EventListener
      );
  }, [removePendingComment]);

  // Clear comment/line focus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Check if click is inside interactive elements that should NOT clear focus
      const isInteractive = 
        target.closest('[data-comment-thread]') ||
        target.closest('[data-line-gutter]') || // Only the line number gutter, not the whole line
        target.closest('button') ||
        target.closest('a') ||
        target.closest('textarea') ||
        target.closest('input') ||
        target.closest('[cmdk-root]');
      
      const state = store.getSnapshot();
      
      // Clear comment focus if clicking outside comments
      if (!isInteractive && state.focusedCommentId) {
        store.setFocusedCommentId(null);
      }
      
      // Clear line focus if clicking anywhere except line gutter and interactive elements
      if (!isInteractive && (state.focusedLine || state.selectionAnchor)) {
        store.clearLineSelection();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [store]);

  const pr = usePRReviewSelector((s) => s.pr);
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);

  return (
    <div className="flex flex-col h-screen">
      <PRHeader pr={pr} owner={owner} repo={repo} />

      <div className="flex flex-1 overflow-hidden">
        <FilePanel onOpenSearch={openCommandPalette} />
        <DiffPanel />
      </div>

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </div>
  );
}

// ============================================================================
// File Panel (Sidebar)
// ============================================================================

interface FilePanelProps {
  onOpenSearch: () => void;
}

const FilePanel = memo(function FilePanel({ onOpenSearch }: FilePanelProps) {
  const store = usePRReviewStore();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);
  const files = usePRReviewSelector((s) => s.files);
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const selectedFiles = usePRReviewSelector((s) => s.selectedFiles);
  const viewedFiles = usePRReviewSelector((s) => s.viewedFiles);
  const hideViewed = usePRReviewSelector((s) => s.hideViewed);

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
          
          {/* Search button with hide-viewed toggle */}
          <div className="mx-3 my-3 flex items-center gap-2">
            <button
              onClick={onOpenSearch}
              className="flex-1 flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-muted/50 hover:bg-muted rounded-lg border border-border transition-colors"
            >
              <Search className="w-4 h-4" />
              <span className="flex-1 text-left">Search files...</span>
              <KeycapGroup keys={["cmd", "k"]} size="xs" />
            </button>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={store.toggleHideViewed}
                    className={cn(
                      "p-2 rounded-lg border border-border transition-colors",
                      hideViewed
                        ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30"
                        : "text-muted-foreground bg-muted/50 hover:bg-muted"
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
        </aside>
  );
});

// ============================================================================
// Diff Panel (Main Content)
// ============================================================================

const DiffPanel = memo(function DiffPanel() {
  const store = usePRReviewStore();
  const pr = usePRReviewSelector((s) => s.pr);
  const files = usePRReviewSelector((s) => s.files);
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const viewedFiles = usePRReviewSelector((s) => s.viewedFiles);
  const selectedFiles = usePRReviewSelector((s) => s.selectedFiles);

  const currentFile = useCurrentFile();
  const parsedDiff = useCurrentDiff();
  const isLoading = useIsCurrentFileLoading();
  
  // Defer the diff to allow rapid navigation without blocking
  const deferredDiff = useDeferredValue(parsedDiff);

  const currentIndex = selectedFile
    ? files.findIndex((f) => f.filename === selectedFile)
    : -1;

  return (
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* File navigation bar */}
          <div className="shrink-0 border-b border-border bg-card px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => store.navigateToPrevUnviewedFile()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
                title="Previous unreviewed file (j)"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
                <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 bg-muted/60 rounded text-[10px] font-mono text-muted-foreground">j</kbd>
              </button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {currentIndex + 1} / {files.length}
              </span>
              <button
                onClick={() => store.navigateToNextUnviewedFile()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
                title="Next unreviewed file (k)"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
                <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 bg-muted/60 rounded text-[10px] font-mono text-muted-foreground">k</kbd>
              </button>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-xs text-muted-foreground">
                <span className="text-green-500">+{pr.additions}</span>{" "}
                <span className="text-red-500">−{pr.deletions}</span>
              </span>
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
              <SubmitReviewDropdown />
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
              
              {/* Scrollable diff content - DiffViewer handles its own virtualized scroll */}
              <div className="flex-1 min-h-0 flex flex-col">
                {deferredDiff && deferredDiff.hunks.length > 0 ? (
                  <DiffViewer diff={deferredDiff} />
                ) : isLoading || (currentFile.patch && !parsedDiff) ? (
                  // Show spinner if loading OR if file has patch but diff isn't loaded yet
                  <div className="flex items-center justify-center py-12 flex-1">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="p-4 text-sm text-muted-foreground text-center flex-1 flex items-center justify-center">
                    {!currentFile.patch 
                      ? "Binary file or file too large to display"
                      : "No changes to display"}
                  </div>
                )}
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
  const focusedPendingCommentId = usePRReviewSelector((s) => s.focusedPendingCommentId);
  const commentingOnLine = usePRReviewSelector((s) => s.commentingOnLine);
  const pendingCommentsCount = usePRReviewSelector(
    (s) => s.pendingComments.length
  );

  const showEscape =
    gotoLineMode || focusedLine || focusedCommentId || focusedPendingCommentId || commentingOnLine;

  return (
    <div
      className={cn(
                "shrink-0 border-t border-border px-4 py-2.5",
                gotoLineMode && "bg-blue-500/10",
                (focusedCommentId || focusedPendingCommentId) && "bg-yellow-500/10",
                commentingOnLine && "bg-green-500/10",
        !gotoLineMode &&
          !focusedCommentId &&
          !focusedPendingCommentId &&
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
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          Type line number, then <Keycap keyName="Enter" size="xs" /> to jump
                        </span>
                      </>
                    ) : commentingOnLine ? (
                      <>
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium">
                          COMMENT
                        </span>
                        <span className="font-mono text-green-400">
                          L{commentingOnLine.startLine ? `${commentingOnLine.startLine}-` : ""}{commentingOnLine.line}
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <KeycapGroup keys={["cmd", "Enter"]} size="xs" /> submit
                        </span>
                      </>
                    ) : focusedPendingCommentId ? (
                      <>
                        <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs font-medium">
                          PENDING
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="e" size="xs" /> edit
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="d" size="xs" /> delete
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="up" size="xs" /> back to line
                        </span>
                      </>
                    ) : focusedCommentId ? (
                      <>
                        <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs font-medium">
                          COMMENT
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="r" size="xs" /> reply
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="e" size="xs" /> edit
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="d" size="xs" /> delete
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="up" size="xs" /> back to line
                        </span>
                      </>
                    ) : focusedLine ? (
                      <>
                        <span className="font-mono text-blue-400">
                          {selectionAnchor 
                            ? `L${Math.min(focusedLine, selectionAnchor)}-${Math.max(focusedLine, selectionAnchor)}`
                            : `L${focusedLine}`}
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="c" size="xs" /> comment
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="down" size="xs" /> view comments
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="Shift" size="xs" /><KeycapGroup keys={["up", "down"]} size="xs" /> select range
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <KeycapGroup keys={["cmd", "k"]} size="xs" /> search files
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <KeycapGroup keys={["up", "down"]} size="xs" /> select line
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="g" size="xs" /> goto line
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="j" size="xs" />
                          <Keycap keyName="k" size="xs" /> next/prev unreviewed
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Keycap keyName="v" size="xs" /> mark viewed
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
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Keycap keyName="Esc" size="xs" />
                        {gotoLineMode ? "cancel" : commentingOnLine ? "cancel" : "clear"}
                      </span>
                    )}
                  </div>
                </div>
    </div>
  );
});

// ============================================================================
// Markdown Content Component
// ============================================================================

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none
      prose-p:my-1 prose-p:leading-relaxed
      prose-pre:bg-muted prose-pre:rounded-md prose-pre:p-3
      prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
      prose-ul:my-1 prose-ol:my-1 prose-li:my-0
      prose-blockquote:border-l-2 prose-blockquote:border-muted-foreground prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-muted-foreground
      prose-headings:my-2 prose-headings:font-semibold
      prose-hr:border-border prose-hr:my-3
      prose-img:rounded-md prose-img:my-2
      prose-table:text-sm prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2"
    >
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline decoration-blue-400/50 hover:decoration-blue-300 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
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
// Virtual Row Types for Flattened Diff
// ============================================================================

type VirtualRowType = 
  | { type: "skip"; hunk: DiffSkipBlock; skipIndex: number; startLine: number; index: number }
  | { type: "line"; line: DiffLine; lineNum: number | undefined; index: number }
  | { type: "comment-form"; lineNum: number; startLine?: number; index: number }
  | { type: "pending-comment"; comment: LocalPendingComment; index: number }
  | { type: "comment-thread"; comments: ReviewComment[]; lineNum: number; index: number }
  | { type: "skip-spacer"; position: "before" | "after"; index: number };

// ============================================================================
// Diff Viewer (Virtualized)
// ============================================================================

interface DiffViewerProps {
  diff: ParsedDiff;
}

const DiffViewer = memo(function DiffViewer({ diff }: DiffViewerProps) {
  const hunks = diff?.hunks ?? [];
  const store = usePRReviewStore();
  const parentRef = useRef<HTMLDivElement>(null);
  
  // Get all comments and pending comments for building virtual rows
  const comments = useCurrentFileComments();
  const pendingComments = useCurrentFilePendingComments();
  const commentingOnLine = usePRReviewSelector((s) => s.commentingOnLine);
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  
  // Subscribe to expanded skip blocks directly for re-render triggering
  const expandedSkipBlocks = usePRReviewSelector((s) => s.expandedSkipBlocks);
  
  // Skip block expansion
  const { expandSkipBlock, isExpanding } = useSkipBlockExpansion();
  
  // Helper to get expanded lines for a skip block
  const getExpandedLines = useCallback((skipIndex: number): DiffLine[] | null => {
    if (!selectedFile) return null;
    const key = `${selectedFile}:${skipIndex}`;
    return expandedSkipBlocks[key] ?? null;
  }, [selectedFile, expandedSkipBlocks]);
  
  // Use refs for drag state to avoid stale closure issues in handlers
  const isDraggingRef = useRef(false);
  const dragAnchorRef = useRef<number | null>(null);
  const handledByMouseEventsRef = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);

  // Pre-compute comment lookup maps for O(1) access
  const commentsByLine = useMemo(() => {
    const map = new Map<number, ReviewComment[]>();
    for (const comment of comments) {
      const line = comment.line ?? comment.original_line;
      if (line) {
        const existing = map.get(line) || [];
        existing.push(comment);
        map.set(line, existing);
      }
    }
    return map;
  }, [comments]);

  const pendingCommentsByLine = useMemo(() => {
    const map = new Map<number, LocalPendingComment[]>();
    for (const comment of pendingComments) {
      const existing = map.get(comment.line) || [];
      existing.push(comment);
      map.set(comment.line, existing);
    }
    return map;
  }, [pendingComments]);

  // Group comments into threads (pre-computed)
  const threadsByLine = useMemo(() => {
    const result = new Map<number, ReviewComment[][]>();
    
    for (const [lineNum, lineComments] of commentsByLine) {
      const threadMap = new Map<number, ReviewComment[]>();
      
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
      
      result.set(lineNum, [...threadMap.values()]);
    }
    
    return result;
  }, [commentsByLine]);

  // Pre-compute skip block start lines by looking at adjacent hunks
  const skipBlockStartLines = useMemo(() => {
    const startLines: number[] = [];
    let expectedNextLine = 1;
    
    for (let i = 0; i < hunks.length; i++) {
      const hunk = hunks[i];
      if (hunk.type === "skip") {
        // Skip block starts at expectedNextLine
        startLines.push(expectedNextLine);
        expectedNextLine += hunk.count;
      } else {
        // Hunk - update expected next line based on where this hunk ends
        // The hunk contains lines, find the max newLineNumber
        let maxNewLine = hunk.newStart;
        for (const line of hunk.lines) {
          if (line.newLineNumber && line.newLineNumber > maxNewLine) {
            maxNewLine = line.newLineNumber;
          }
        }
        expectedNextLine = maxNewLine + 1;
      }
    }
    return startLines;
  }, [hunks]);

  // Flatten hunks into virtual rows
  const virtualRows = useMemo((): VirtualRowType[] => {
    const rows: VirtualRowType[] = [];
    let index = 0;
    let skipIndex = 0;
    
    for (const hunk of hunks) {
      if (hunk.type === "skip") {
        const currentSkipIndex = skipIndex++;
        const startLine = skipBlockStartLines[currentSkipIndex] ?? 1;
        const expandedLines = getExpandedLines(currentSkipIndex);
        
        if (expandedLines && expandedLines.length > 0) {
          // Show expanded lines instead of skip block (no spacers needed)
          for (const line of expandedLines) {
            const lineNum = line.newLineNumber || line.oldLineNumber;
            rows.push({ type: "line", line, lineNum, index: index++ });
          }
        } else {
          // Show collapsed skip block with spacers
          rows.push({ type: "skip-spacer", position: "before", index: index++ });
          rows.push({ type: "skip", hunk, skipIndex: currentSkipIndex, startLine, index: index++ });
          rows.push({ type: "skip-spacer", position: "after", index: index++ });
        }
      } else {
        for (const line of hunk.lines) {
          const lineNum = line.newLineNumber || line.oldLineNumber;
          rows.push({ type: "line", line, lineNum, index: index++ });
          
          // Add comment form if commenting on this line
          if (lineNum && commentingOnLine?.line === lineNum) {
            rows.push({ 
              type: "comment-form", 
              lineNum, 
              startLine: commentingOnLine.startLine,
              index: index++ 
            });
          }
          
          // Add pending comments for this line
          if (lineNum) {
            const linePending = pendingCommentsByLine.get(lineNum);
            if (linePending) {
              for (const pending of linePending) {
                rows.push({ type: "pending-comment", comment: pending, index: index++ });
              }
            }
            
            // Add comment threads for this line
            const threads = threadsByLine.get(lineNum);
            if (threads) {
              for (const thread of threads) {
                rows.push({ type: "comment-thread", comments: thread, lineNum, index: index++ });
              }
            }
          }
        }
      }
    }
    
    return rows;
  }, [hunks, skipBlockStartLines, commentingOnLine, pendingCommentsByLine, threadsByLine, getExpandedLines]);

  // Estimate row heights for the virtualizer
  const estimateSize = useCallback((index: number) => {
    const row = virtualRows[index];
    if (!row) return 20;
    
    switch (row.type) {
      case "skip-spacer": return 8;
      case "skip": return 40;
      case "line": return 20;
      case "comment-form": return 180;
      case "pending-comment": return 100;
      case "comment-thread": return 80 + row.comments.length * 60;
      default: return 20;
    }
  }, [virtualRows]);

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 20, // Render 20 extra rows above/below viewport
  });

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
          const startLine = Math.min(anchor, focusedLine);
          const endLine = Math.max(anchor, focusedLine);
          store.startCommenting(endLine, startLine);
        } else {
          store.startCommenting(focusedLine);
        }
      }
    }
    isDraggingRef.current = false;
    dragAnchorRef.current = null;
    setIsDraggingState(false);
  }, [store]);

  const onClickFallback = useCallback((lineNum: number) => {
    if (handledByMouseEventsRef.current) {
      handledByMouseEventsRef.current = false;
      return;
    }
    store.startCommenting(lineNum);
  }, [store]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        onDragEnd();
      }
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [onDragEnd]);

  // Handle mousemove during drag to extend selection even when not directly over line gutters
  useEffect(() => {
    if (!isDraggingState) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !parentRef.current) return;
      
      // Find the line element under the mouse by checking all rendered line elements
      const elements = parentRef.current.querySelectorAll('[data-line-gutter]');
      let closestLine: number | null = null;
      let closestDistance = Infinity;
      
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const distance = Math.abs(e.clientY - centerY);
        
        if (distance < closestDistance) {
          closestDistance = distance;
          // Get line number from the parent row's data
          const row = el.closest('[data-index]');
          if (row) {
            const index = parseInt(row.getAttribute('data-index') || '-1', 10);
            const virtualRow = virtualRows[index];
            if (virtualRow?.type === 'line' && virtualRow.lineNum) {
              closestLine = virtualRow.lineNum;
            }
          }
        }
      }
      
      if (closestLine !== null) {
        store.setFocusedLine(closestLine);
      }
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [isDraggingState, virtualRows, store]);

  const dragValue = useMemo(() => ({
    isDragging: isDraggingState,
    dragAnchor: dragAnchorRef.current,
    onDragStart,
    onDragEnter,
    onDragEnd,
    onClickFallback,
  }), [isDraggingState, onDragStart, onDragEnter, onDragEnd, onClickFallback]);

  // Scroll to focused line
  const focusedLine = usePRReviewSelector((s) => s.focusedLine);
  useEffect(() => {
    if (focusedLine && !isDraggingState) {
      const rowIndex = virtualRows.findIndex(
        (r) => r.type === "line" && r.lineNum === focusedLine
      );
      if (rowIndex !== -1) {
        virtualizer.scrollToIndex(rowIndex, { align: "center", behavior: "auto" });
      }
    }
  }, [focusedLine, isDraggingState, virtualRows, virtualizer]);

  return (
    <LineDragContext.Provider value={dragValue}>
      <div 
        ref={parentRef} 
        className="flex-1 overflow-auto themed-scrollbar"
      >
        <div className="p-4">
          <div className="border border-border rounded-lg overflow-hidden">
            <div
              className="relative w-full font-mono text-[0.8rem] [--code-added:theme(colors.green.500)] [--code-removed:theme(colors.orange.600)]"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = virtualRows[virtualRow.index];
                if (!row) return null;
                
                return (
                  <div
                    key={virtualRow.key}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                  >
                    <VirtualRowRenderer row={row} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </LineDragContext.Provider>
  );
});

// ============================================================================
// Virtual Row Renderer
// ============================================================================

const VirtualRowRenderer = memo(function VirtualRowRenderer({ row }: { row: VirtualRowType }) {
  const editingCommentId = usePRReviewSelector((s) => s.editingCommentId);
  const replyingToCommentId = usePRReviewSelector((s) => s.replyingToCommentId);
  const focusedCommentId = usePRReviewSelector((s) => s.focusedCommentId);
  const focusedPendingCommentId = usePRReviewSelector((s) => s.focusedPendingCommentId);
  const editingPendingCommentId = usePRReviewSelector((s) => s.editingPendingCommentId);
  const { expandSkipBlock, isExpanding } = useSkipBlockExpansion();

  switch (row.type) {
    case "skip-spacer":
      return <div className="h-2" />;
    case "skip":
      return (
        <SkipBlockRow 
          hunk={row.hunk} 
          isExpanding={isExpanding(row.skipIndex)}
          onExpand={() => expandSkipBlock(row.skipIndex, row.startLine, row.hunk.count)} 
        />
      );
    case "line":
      return <DiffLineRow line={row.line} lineNum={row.lineNum} />;
    case "comment-form":
      return <InlineCommentForm line={row.lineNum} startLine={row.startLine} />;
    case "pending-comment":
      return (
        <PendingCommentItem
          comment={row.comment}
          isFocused={focusedPendingCommentId === row.comment.id}
          isEditing={editingPendingCommentId === row.comment.id}
        />
      );
    case "comment-thread":
      return (
        <CommentThread
          comments={row.comments}
          focusedCommentId={focusedCommentId}
          editingCommentId={editingCommentId}
          replyingToCommentId={replyingToCommentId}
        />
      );
    default:
      return null;
  }
});


// ============================================================================
// Diff Line Row (Virtualized - div-based)
// ============================================================================

interface DiffLineRowProps {
  line: DiffLine;
  lineNum: number | undefined;
}

const DiffLineRow = memo(function DiffLineRow({
  line,
  lineNum,
}: DiffLineRowProps) {
  const { onDragStart, onDragEnter, onDragEnd, onClickFallback } = useLineDrag();

  // Fine-grained subscriptions - only re-render when THIS line's state changes
  const { isFirst, isLast, isInSelection } = useSelectionBoundary(lineNum ?? -1);
  const isInCommentingRange = useIsLineInCommentingRange(lineNum ?? -1);

  // Check if this line has comment range highlighting using optimized selector
  const hasCommentRange = useIsLineInCommentRange(lineNum ?? -1);

  const Tag =
    line.type === "insert" ? "ins" : line.type === "delete" ? "del" : "span";
  const displayLineNum =
    line.type === "delete" ? line.oldLineNumber : line.newLineNumber;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (lineNum) {
      e.preventDefault();
      onDragStart(lineNum);
    }
  }, [lineNum, onDragStart]);

  const handleMouseUp = useCallback(() => {
    onDragEnd();
  }, [onDragEnd]);

  const handleMouseEnter = useCallback(() => {
    if (lineNum) {
      onDragEnter(lineNum);
    }
  }, [lineNum, onDragEnter]);

  const handleClick = useCallback(() => {
    if (lineNum) {
      onClickFallback(lineNum);
    }
  }, [lineNum, onClickFallback]);

  // Build selection shadow - use inset box-shadow to avoid layout shift
  const getSelectionShadow = () => {
    if (!isInSelection) return undefined;
    
    // Build shadow parts: left, right, top (if first), bottom (if last)
    const shadows = [
      "inset 2px 0 0 rgb(59,130,246)",   // left
      "inset -2px 0 0 rgb(59,130,246)",  // right
    ];
    if (isFirst) shadows.push("inset 0 2px 0 rgb(59,130,246)");  // top
    if (isLast) shadows.push("inset 0 -2px 0 rgb(59,130,246)");  // bottom
    
    return shadows.join(", ");
  };

  return (
    <div
      className={cn(
        "flex h-5 min-h-5 whitespace-pre-wrap box-border group contain-layout",
        line.type === "insert" && "bg-[var(--code-added)]/10",
        line.type === "delete" && "bg-[var(--code-removed)]/10",
        hasCommentRange && "bg-yellow-500/5",
        (isInSelection || isInCommentingRange) && "!bg-blue-500/20"
      )}
      style={{ boxShadow: getSelectionShadow() }}
    >
      {/* Left border indicator */}
      <div
        className={cn(
          "w-1 shrink-0 border-l-[3px] border-transparent",
          line.type === "insert" && "!border-[var(--code-added)]/60",
          line.type === "delete" && "!border-[var(--code-removed)]/80"
        )}
      />
      {/* Line number gutter - clicking here starts selection */}
      <div
        data-line-gutter
        className="w-12 shrink-0 tabular-nums text-center opacity-50 px-2 text-xs select-none cursor-pointer hover:bg-blue-500/20 pt-0.5"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseEnter={handleMouseEnter}
        onClick={handleClick}
      >
        {displayLineNum}
      </div>
      {/* Code content */}
      <div className="flex-1 whitespace-pre-wrap break-words pr-6 overflow-hidden">
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
      </div>
    </div>
  );
});

// ============================================================================
// Skip Block Row (Virtualized - div-based)
// ============================================================================

interface SkipBlockRowProps {
  hunk: DiffSkipBlock;
  isExpanding?: boolean;
  onExpand?: () => void;
}

const SkipBlockRow = memo(function SkipBlockRow({ hunk, isExpanding, onExpand }: SkipBlockRowProps) {
  const handleClick = useCallback(() => {
    if (onExpand && !isExpanding) {
      onExpand();
    }
  }, [onExpand, isExpanding]);

  return (
    <div 
      onClick={handleClick}
      className={cn(
        "flex items-center h-10 font-mono bg-muted text-muted-foreground transition-colors group",
        isExpanding ? "opacity-60" : "hover:bg-muted/80 cursor-pointer"
      )}
    >
      <div className="w-1 shrink-0" />
      <div className="w-12 shrink-0 opacity-50 select-none text-center group-hover:opacity-70">
        {isExpanding ? (
          <Loader2 className="w-4 h-4 mx-auto animate-spin" />
        ) : (
          <ChevronsUpDown className="w-4 h-4 mx-auto" />
        )}
      </div>
      <div className="flex-1">
        <span className="pl-2 italic opacity-50 group-hover:opacity-70">
          {hunk.content || `${hunk.count} lines hidden`}
        </span>
        {!isExpanding && (
          <span className="ml-2 text-xs opacity-0 group-hover:opacity-50 transition-opacity">
            Click to expand
          </span>
        )}
        {isExpanding && (
          <span className="ml-2 text-xs opacity-50">
            Loading...
          </span>
        )}
      </div>
    </div>
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
  const { resolveThread, unresolveThread } = useThreadActions();
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [resolving, setResolving] = useState(false);
  
  const replyingTo = comments.find((c) => c.id === replyingToCommentId)?.id ?? null;
  
  // Get resolution info from first comment (all comments in thread share same resolution status)
  const firstComment = comments[0];
  const isResolved = firstComment?.is_resolved ?? false;
  const threadId = firstComment?.pull_request_review_thread_id;

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

  const handleResolve = useCallback(async () => {
    if (!threadId) return;
    setResolving(true);
    try {
      await resolveThread(threadId);
      // Auto-collapse when resolved
      setIsCollapsed(true);
    } finally {
      setResolving(false);
    }
  }, [threadId, resolveThread]);

  const handleUnresolve = useCallback(async () => {
    if (!threadId) return;
    setResolving(true);
    try {
      await unresolveThread(threadId);
      setIsCollapsed(false);
    } finally {
      setResolving(false);
    }
  }, [threadId, unresolveThread]);

  // Auto-collapse resolved threads
  useEffect(() => {
    if (isResolved) {
      setIsCollapsed(true);
    }
  }, [isResolved]);

  return (
    <div 
      data-comment-thread 
      className={cn(
        "mx-4 my-2 rounded-r-lg border-l-2",
        isResolved 
          ? "border-green-500/50 bg-green-500/5" 
          : "border-blue-500/50 bg-card/80"
      )}
    >
      {/* Thread header with resolve/unresolve */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/30">
        <div className="flex items-center gap-2">
          {isResolved ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : (
            <Circle className="w-4 h-4 text-muted-foreground" />
          )}
          <span className={cn(
            "text-xs font-medium",
            isResolved ? "text-green-500" : "text-muted-foreground"
          )}>
            {isResolved ? "Resolved" : `${comments.length} comment${comments.length !== 1 ? "s" : ""}`}
          </span>
          {isResolved && isCollapsed && (
            <span className="text-xs text-muted-foreground">
              by {firstComment.user.login}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {threadId && (
            <button
              onClick={isResolved ? handleUnresolve : handleResolve}
              disabled={resolving}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
                isResolved 
                  ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                  : "text-green-500 hover:bg-green-500/10"
              )}
            >
              {resolving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isResolved ? (
                <>
                  <Circle className="w-3 h-3" />
                  Unresolve
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  Resolve
                </>
              )}
            </button>
          )}
          {isResolved && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
            >
              {isCollapsed ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Comment content (collapsible for resolved) */}
      {!isCollapsed && (
        <>
          {comments.map((comment, idx) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              isReply={idx > 0}
              isFocused={focusedCommentId === comment.id}
              isEditing={editingCommentId === comment.id}
              isResolved={isResolved}
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
        </>
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
  isResolved?: boolean;
  onUpdate: (commentId: number, body: string) => Promise<void>;
  onDelete: (commentId: number) => Promise<void>;
}

const CommentItem = memo(function CommentItem({ 
  comment, 
  isReply, 
  isFocused,
  isEditing,
  isResolved,
  onUpdate,
  onDelete,
}: CommentItemProps) {
  const store = usePRReviewStore();
  const currentUser = usePRReviewSelector((s) => s.currentUser);
  const isOwnComment = currentUser === comment.user.login;
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

  // Handle click to focus this comment for keyboard navigation
  const handleClick = useCallback(() => {
    if (!isEditing) {
      store.setFocusedCommentId(comment.id);
    }
  }, [store, comment.id, isEditing]);

  return (
    <div 
      ref={commentRef}
      onClick={handleClick}
      className={cn(
        "px-4 py-3 font-sans hover:bg-muted/30 transition-colors", 
        isReply && "pl-12 border-t border-border/30",
        isFocused && "ring-2 ring-blue-500 ring-inset bg-blue-500/5",
        isResolved && "opacity-75"
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
              <div className="mt-1 text-sm text-foreground/90">
                <MarkdownContent content={comment.body} />
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={() => store.startReplying(comment.id)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Reply (r)"
                >
                  <Reply className="w-3 h-3" />
                  Reply
                  {isFocused && <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">r</kbd>}
                </button>
                {isOwnComment && (
                  <>
                    <button
                      onClick={() => store.startEditing(comment.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit (e)"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                      {isFocused && <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">e</kbd>}
                    </button>
                    <button
                      onClick={() => onDelete(comment.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete (d)"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                      {isFocused && <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">d</kbd>}
                    </button>
                  </>
                )}
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
  isFocused?: boolean;
  isEditing?: boolean;
}

const PendingCommentItem = memo(function PendingCommentItem({
  comment,
  isFocused,
  isEditing,
}: PendingCommentItemProps) {
  const store = usePRReviewStore();
  const { removePendingComment, updatePendingComment } = useCommentActions();
  const currentUser = usePRReviewSelector((s) => s.currentUser);
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
      store.cancelEditingPendingComment();
      return;
    }
    setSaving(true);
    try {
      await updatePendingComment(comment.id, editText.trim());
    } finally {
      setSaving(false);
    }
  }, [editText, comment.id, comment.body, updatePendingComment, store]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        store.cancelEditingPendingComment();
      }
    },
    [handleSave, store]
  );

  // Handle click to focus this comment for keyboard navigation
  const handleClick = useCallback(() => {
    if (!isEditing) {
      store.setFocusedPendingCommentId(comment.id);
    }
  }, [store, comment.id, isEditing]);
  
  return (
    <div 
      ref={commentRef}
      data-comment-thread
      className={cn(
        "border-l-2 border-yellow-500 bg-card/80 mx-4 my-2 rounded-r-lg",
        isFocused && "ring-2 ring-blue-500 ring-inset"
      )}
    >
      <div 
        onClick={handleClick}
        className={cn(
          "px-4 py-3 font-sans hover:bg-muted/30 transition-colors",
          isFocused && "bg-blue-500/5"
        )}
      >
        <div className="flex items-start gap-3">
          <img
            src={`https://github.com/${currentUser || 'ghost'}.png`}
            alt={currentUser || 'You'}
            className="w-6 h-6 rounded-full shrink-0"
            loading="lazy"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{currentUser || 'You'}</span>
                <span className="text-muted-foreground text-xs">just now</span>
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/20 text-yellow-500 rounded">
                  Pending
                </span>
              </div>
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
                    onClick={store.cancelEditingPendingComment}
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
                <div className="mt-1 text-sm text-foreground/90">
                  <MarkdownContent content={comment.body} />
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => store.startEditingPendingComment(comment.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit (e)"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                    {isFocused && <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">e</kbd>}
                  </button>
                  <button
                    onClick={() => removePendingComment(comment.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete (d)"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                    {isFocused && <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">d</kbd>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Submit Review Dropdown (GitHub-style)
// ============================================================================

const SubmitReviewDropdown = memo(function SubmitReviewDropdown() {
  const store = usePRReviewStore();
  const { submitReview } = useReviewActions();
  const { removePendingComment } = useCommentActions();

  const pendingComments = usePRReviewSelector((s) => s.pendingComments);
  const reviewBody = usePRReviewSelector((s) => s.reviewBody);
  const submitting = usePRReviewSelector((s) => s.submittingReview);
  const pr = usePRReviewSelector((s) => s.pr);
  const currentUser = usePRReviewSelector((s) => s.currentUser);

  const [reviewType, setReviewType] = useState<"COMMENT" | "APPROVE" | "REQUEST_CHANGES">("COMMENT");
  const [isOpen, setIsOpen] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  // Check if current user is the PR author (can't approve/request changes on own PR)
  const isAuthor = currentUser !== null && pr.user.login === currentUser;

  // Group pending comments by file
  const commentsByFile = useMemo(() => {
    const grouped = new Map<string, LocalPendingComment[]>();
    for (const comment of pendingComments) {
      const existing = grouped.get(comment.path) || [];
      existing.push(comment);
      grouped.set(comment.path, existing);
    }
    return grouped;
  }, [pendingComments]);

  const handleSubmit = useCallback(async () => {
    await submitReview(reviewType);
    setIsOpen(false);
  }, [submitReview, reviewType]);

  const handleJumpToComment = useCallback((comment: LocalPendingComment) => {
    store.selectFile(comment.path);
    // Small delay to let the file load, then focus the pending comment
    setTimeout(() => {
      store.setFocusedPendingCommentId(comment.id);
    }, 100);
    setIsOpen(false);
  }, [store]);

  const pendingCount = pendingComments.length;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors">
          <span>Submit review</span>
          {pendingCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-green-500/50 rounded">
              {pendingCount}
            </span>
          )}
          <ChevronsUpDown className="w-4 h-4 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[450px]">
        <DropdownMenuLabel className="font-semibold">Finish your review</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {/* Review body textarea */}
        <div className="p-3">
          <textarea
            value={reviewBody}
            onChange={(e) => store.setReviewBody(e.target.value)}
            placeholder="Leave a comment"
            className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring font-sans"
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Pending comments by file */}
        {pendingCount > 0 && (
          <div className="px-3 pb-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span className="font-medium">{pendingCount} pending comment{pendingCount !== 1 ? "s" : ""}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  pendingComments.forEach((c) => removePendingComment(c.id));
                }}
                className="text-destructive hover:underline"
              >
                Clear all
              </button>
            </div>
            
            {/* File list with comments */}
            <div className="max-h-[200px] overflow-y-auto space-y-1 themed-scrollbar">
              {Array.from(commentsByFile.entries()).map(([filePath, comments]) => {
                const fileName = filePath.split('/').pop() || filePath;
                const isExpanded = expandedFile === filePath;
                
                return (
                  <div key={filePath} className="rounded-md border border-border/50 overflow-hidden">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedFile(isExpanded ? null : filePath);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 shrink-0" />
                      )}
                      <FileCode className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="font-mono truncate flex-1 text-left">{fileName}</span>
                      <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-500 rounded text-[10px]">
                        {comments.length}
                      </span>
                    </button>
                    
                    {isExpanded && (
                      <div className="border-t border-border/50 bg-muted/30">
                        {comments.map((comment) => (
                          <button
                            key={comment.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleJumpToComment(comment);
                            }}
                            className="w-full flex items-start gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition-colors text-left border-b border-border/30 last:border-b-0"
                          >
                            <span className="font-mono text-muted-foreground shrink-0">
                              L{comment.start_line ? `${comment.start_line}-` : ''}{comment.line}
                            </span>
                            <span className="text-foreground/80 line-clamp-2 flex-1">
                              {comment.body}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DropdownMenuSeparator />

        {/* Review type radio options */}
        <DropdownMenuRadioGroup value={reviewType} onValueChange={(v) => setReviewType(v as typeof reviewType)}>
          <DropdownMenuRadioItem value="COMMENT" className="cursor-pointer">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Comment</span>
              <span className="text-xs text-muted-foreground">
                Submit general feedback without explicit approval.
              </span>
            </div>
          </DropdownMenuRadioItem>

          {!isAuthor && (
            <>
              <DropdownMenuRadioItem value="APPROVE" className="cursor-pointer">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-green-500">Approve</span>
                  <span className="text-xs text-muted-foreground">
                    Submit feedback and approve merging these changes.
                  </span>
                </div>
              </DropdownMenuRadioItem>

              <DropdownMenuRadioItem value="REQUEST_CHANGES" className="cursor-pointer">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-orange-500">Request changes</span>
                  <span className="text-xs text-muted-foreground">
                    Submit feedback suggesting changes.
                  </span>
                </div>
              </DropdownMenuRadioItem>
            </>
          )}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        {/* Submit buttons */}
        <div className="p-3 flex justify-end gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
            className="px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSubmit();
            }}
            disabled={submitting || (pendingCount === 0 && !reviewBody.trim())}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-50",
              reviewType === "APPROVE" && "bg-green-600 text-white hover:bg-green-700",
              reviewType === "REQUEST_CHANGES" && "bg-orange-600 text-white hover:bg-orange-700",
              reviewType === "COMMENT" && "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : reviewType === "APPROVE" ? (
              <Check className="w-4 h-4" />
            ) : reviewType === "REQUEST_CHANGES" ? (
              <XCircle className="w-4 h-4" />
            ) : (
              <MessageSquare className="w-4 h-4" />
            )}
            Submit review
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
