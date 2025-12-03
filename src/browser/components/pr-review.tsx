import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  BookOpen,
} from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { PROverview } from "./pr-overview";
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
import type { PullRequest, PullRequestFile, ReviewComment } from "@/api/types";
import {
  useGitHub,
  useGitHubStore,
  useGitHubReady,
  useGitHubSelector,
  usePRChecks,
} from "../contexts/github";
import { useCanWrite, useAuth } from "../contexts/auth";
import { useTelemetry } from "../contexts/telemetry";
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
  useCommentingRange,
  useCommentRangeLookup,
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
} from "../ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Keycap, KeycapGroup } from "../ui/keycap";
import { Markdown, MarkdownEditor } from "../ui/markdown";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { useTabContext, type TabStatus } from "../contexts/tabs";

// ============================================================================
// Hook to sync PR check status with tab
// ============================================================================

function useSyncTabStatus(
  tabId: string | undefined,
  owner: string,
  repo: string,
  number: number,
  prData: {
    merged: boolean;
    draft?: boolean;
    state: string;
    mergeable: boolean | null;
  } | null
) {
  const { status: checkStatus } = usePRChecks(owner, repo, number);

  // Get tab context for status updates
  let updateTabStatus: ((tabId: string, status: TabStatus) => void) | undefined;
  try {
    const tabContext = useTabContext();
    updateTabStatus = tabContext.updateTabStatus;
  } catch {
    // Not in tab context, ignore
  }

  // Sync to tab whenever status changes
  useEffect(() => {
    if (!tabId || !updateTabStatus || !prData) return;

    const state: TabStatus["state"] = prData.merged
      ? "merged"
      : prData.draft
        ? "draft"
        : prData.state === "open"
          ? "open"
          : "closed";

    updateTabStatus(tabId, {
      checks: checkStatus?.checks || "pending",
      state,
      mergeable: prData.mergeable,
    });
  }, [tabId, updateTabStatus, prData, checkStatus]);
}

// ============================================================================
// Page Component (Data Fetching) - Used for direct URL access
// ============================================================================

export function PRReviewPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();

  if (!owner || !repo || !number) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-destructive">Invalid PR URL</p>
      </div>
    );
  }

  return (
    <PRReviewContent owner={owner} repo={repo} number={parseInt(number, 10)} />
  );
}

// ============================================================================
// Content Component (Used by tabs and direct URL)
// ============================================================================

interface PRReviewContentProps {
  owner: string;
  repo: string;
  number: number;
  tabId?: string;
}

export function PRReviewContent({
  owner,
  repo,
  number,
  tabId,
}: PRReviewContentProps) {
  const { ready: githubReady, error: githubError } = useGitHubReady();
  const github = useGitHubStore();
  const { track } = useTelemetry();
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [files, setFiles] = useState<PullRequestFile[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [viewerPermission, setViewerPermission] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync check status with tab (uses data store for auto-refresh)
  useSyncTabStatus(tabId, owner, repo, number, pr);

  useEffect(() => {
    if (!githubReady) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [prData, filesData, commentsData, reviewThreadsResult] =
          await Promise.all([
            github.getPR(owner, repo, number),
            github.getPRFiles(owner, repo, number),
            github.getPRComments(owner, repo, number),
            github.getReviewThreads(owner, repo, number).catch(() => ({
              threads: [],
              viewerPermission: null,
            })),
          ]);

        setPr(prData);
        setFiles(filesData);
        setComments(commentsData as ReviewComment[]);
        setViewerPermission(reviewThreadsResult.viewerPermission);

        // Track PR viewed
        track("pr_viewed", {
          pr_number: number,
          owner,
          repo,
          file_count: filesData.length,
          additions: prData.additions,
          deletions: prData.deletions,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [github, owner, repo, number, track]);

  // Show loading while GitHub client initializes
  if (!githubReady) {
    if (githubError) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4">
            <p className="text-destructive font-medium">
              Failed to connect to GitHub
            </p>
            <p className="text-sm text-muted-foreground">{githubError}</p>
          </div>
        </div>
      );
    }
    return <PRReviewSkeleton />;
  }

  if (loading) {
    return <PRReviewSkeleton />;
  }

  if (error || !pr) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <p className="text-destructive font-medium">Failed to load PR</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <PRReviewProvider
      pr={pr}
      files={files}
      comments={comments}
      owner={owner}
      repo={repo}
      viewerPermission={viewerPermission}
    >
      <PRReviewLayout />
    </PRReviewProvider>
  );
}

// ============================================================================
// Main Review Component (Layout)
// ============================================================================

function PRReviewLayout() {
  const store = usePRReviewStore();
  const { track } = useTelemetry();
  const { open: commandPaletteOpen, setOpen: setCommandPaletteOpen } =
    useCommandPalette();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Expose for button click
  const openCommandPalette = useCallback(
    () => setCommandPaletteOpen(true),
    [setCommandPaletteOpen]
  );

  // Close mobile sidebar when a file is selected
  const handleMobileFileSelect = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

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
        target.closest("[data-comment-thread]") ||
        target.closest("[data-line-gutter]") || // Only the line number gutter, not the whole line
        target.closest("button") ||
        target.closest("a") ||
        target.closest("textarea") ||
        target.closest("input") ||
        target.closest("[cmdk-root]");

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
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);

  // Track file views (only once per file per session)
  const trackedFilesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (selectedFile && !trackedFilesRef.current.has(selectedFile)) {
      trackedFilesRef.current.add(selectedFile);
      track("file_viewed", {
        pr_number: pr.number,
        owner,
        repo,
        file_path: selectedFile,
      });
    }
  }, [selectedFile, pr.number, owner, repo, track]);

  return (
    <div className="flex flex-col h-full">
      <PRHeader
        pr={pr}
        owner={owner}
        repo={repo}
        onToggleSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
      />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Mobile sidebar overlay */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
        <FilePanel
          onOpenSearch={openCommandPalette}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
          onFileSelect={handleMobileFileSelect}
        />
        <DiffPanel />
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
    </div>
  );
}

// ============================================================================
// File Panel (Sidebar)
// ============================================================================

interface FilePanelProps {
  onOpenSearch: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onFileSelect?: () => void;
}

const FilePanel = memo(function FilePanel({
  onOpenSearch,
  mobileOpen,
  onMobileClose,
  onFileSelect,
}: FilePanelProps) {
  const store = usePRReviewStore();
  const files = usePRReviewSelector((s) => s.files);
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const selectedFiles = usePRReviewSelector((s) => s.selectedFiles);
  const viewedFiles = usePRReviewSelector((s) => s.viewedFiles);
  const hideViewed = usePRReviewSelector((s) => s.hideViewed);
  const showOverview = usePRReviewSelector((s) => s.showOverview);

  const commentCounts = useCommentCountsByFile();
  const pendingCommentCounts = usePendingCommentCountsByFile();
  const { copyDiff, copyFile, copyMainVersion } = useFileCopyActions();

  // Wrap file selection to close mobile sidebar
  const handleSelectFile = useCallback(
    (filename: string) => {
      store.selectFile(filename);
      onFileSelect?.();
    },
    [store, onFileSelect]
  );

  const handleSelectOverview = useCallback(() => {
    store.selectOverview();
    onFileSelect?.();
  }, [store, onFileSelect]);

  return (
    <aside
      className={cn(
        "w-64 border-r border-border flex flex-col overflow-hidden shrink-0 bg-background",
        // Mobile: absolute positioned drawer
        "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out md:relative md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Search button with hide-viewed toggle */}
      <div className="mx-2 my-2 flex items-center gap-1.5">
        <button
          onClick={onOpenSearch}
          className="flex-1 flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground bg-muted/50 hover:bg-muted rounded-md border border-border transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">Search...</span>
          <KeycapGroup keys={["cmd", "k"]} size="xs" />
        </button>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={store.toggleHideViewed}
                className={cn(
                  "p-1.5 rounded-md border border-border transition-colors",
                  hideViewed
                    ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30"
                    : "text-muted-foreground bg-muted/50 hover:bg-muted"
                )}
              >
                {hideViewed ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {hideViewed ? "Show viewed files" : "Hide viewed files"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Mobile close button */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-border md:hidden">
        <span className="text-sm font-medium">Files</span>
        <button
          onClick={onMobileClose}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Overview button */}
      <button
        onClick={handleSelectOverview}
        className={cn(
          "mx-2 mb-1 flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors",
          showOverview
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        )}
      >
        <BookOpen className="w-4 h-4" />
        <span className="font-medium flex-1">Overview</span>
        <kbd className="px-1.5 py-0.5 bg-muted/60 rounded text-[10px] font-mono text-muted-foreground hidden sm:inline-block">
          o
        </kbd>
      </button>

      <div className="border-t border-border/50 mt-1" />

      <FileTree
        files={files}
        selectedFile={selectedFile}
        selectedFiles={selectedFiles}
        viewedFiles={viewedFiles}
        hideViewed={hideViewed}
        commentCounts={commentCounts}
        pendingCommentCounts={pendingCommentCounts}
        onSelectFile={handleSelectFile}
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
// Read-Only Banner
// ============================================================================

const ReadOnlyBanner = memo(function ReadOnlyBanner() {
  const canWrite = useCanWrite();
  const { startDeviceAuth } = useAuth();

  if (canWrite) return null;

  return (
    <div className="shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        <Eye className="w-4 h-4 text-amber-500" />
        <span className="text-amber-200">
          <span className="font-medium">Read-only mode</span>
          <span className="text-amber-200/70 ml-1.5">
            – Sign in to comment and submit reviews
          </span>
        </span>
      </div>
      <button
        onClick={startDeviceAuth}
        className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition-colors"
      >
        Sign in with GitHub
      </button>
    </div>
  );
});

// ============================================================================
// Diff Panel (Main Content)
// ============================================================================

const DiffPanel = memo(function DiffPanel() {
  const store = usePRReviewStore();
  const canWrite = useCanWrite();
  const pr = usePRReviewSelector((s) => s.pr);
  const files = usePRReviewSelector((s) => s.files);
  const selectedFile = usePRReviewSelector((s) => s.selectedFile);
  const viewedFiles = usePRReviewSelector((s) => s.viewedFiles);
  const selectedFiles = usePRReviewSelector((s) => s.selectedFiles);
  const showOverview = usePRReviewSelector((s) => s.showOverview);

  const currentFile = useCurrentFile();
  const parsedDiff = useCurrentDiff();
  const isLoading = useIsCurrentFileLoading();

  const currentIndex = selectedFile
    ? files.findIndex((f) => f.filename === selectedFile)
    : -1;

  // Show overview panel
  if (showOverview) {
    return (
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Header bar matching the file view */}
        <div className="shrink-0 border-b border-border bg-card/30 px-2 sm:px-3 py-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">Overview</span>
          </div>
          <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
            {viewedFiles.size > 0 && (
              <span className="text-muted-foreground hidden sm:inline">
                <span className="text-green-500 font-medium">
                  {viewedFiles.size}
                </span>
                <span className="text-muted-foreground">
                  {" / "}
                  {files.length} files reviewed
                </span>
              </span>
            )}
            {canWrite && <SubmitReviewDropdown />}
          </div>
        </div>
        <ReadOnlyBanner />
        <PROverview />
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-hidden flex flex-col">
      {/* File navigation bar */}
      <div className="shrink-0 border-b border-border bg-card/30 px-2 sm:px-3 py-1.5 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => store.navigateToPrevUnviewedFile()}
            className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1 text-xs rounded-md hover:bg-muted transition-colors"
            title="Previous unreviewed file (k)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Prev</span>
            <kbd className="hidden sm:inline-block ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono text-muted-foreground">
              k
            </kbd>
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentIndex + 1}/{files.length}
          </span>
          <button
            onClick={() => store.navigateToNextUnviewedFile()}
            className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1 text-xs rounded-md hover:bg-muted transition-colors"
            title="Next unreviewed file (j)"
          >
            <span className="hidden xs:inline">Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <kbd className="hidden sm:inline-block ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono text-muted-foreground">
              j
            </kbd>
          </button>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 text-xs">
          {viewedFiles.size > 0 && (
            <span className="text-muted-foreground hidden sm:inline">
              <span className="text-green-500 font-medium">
                {viewedFiles.size}
              </span>
              <span className="text-muted-foreground">
                {" / "}
                {files.length} files reviewed
              </span>
            </span>
          )}
          {files.length - viewedFiles.size > 0 && (
            <span className="text-yellow-500 hidden md:inline">
              {files.length - viewedFiles.size} left
            </span>
          )}
          {selectedFiles.size > 0 && (
            <span className="text-blue-400 hidden md:inline">
              {selectedFiles.size} selected
            </span>
          )}
          {canWrite && <SubmitReviewDropdown />}
        </div>
      </div>

      <ReadOnlyBanner />

      {currentFile ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Sticky file header */}
          <div className="shrink-0 border-b border-border bg-muted/50 backdrop-blur-sm z-20">
            <div className="px-3 py-1.5">
              <FileHeader
                file={currentFile}
                isViewed={viewedFiles.has(currentFile.filename)}
                onToggleViewed={() => store.toggleViewed(currentFile.filename)}
              />
            </div>
          </div>

          {/* Scrollable diff content - DiffViewer handles its own virtualized scroll */}
          <div className="flex-1 min-h-0 flex flex-col">
            {parsedDiff && parsedDiff.hunks.length > 0 ? (
              <DiffViewer diff={parsedDiff} />
            ) : isLoading || (currentFile.patch && !parsedDiff) ? (
              // Show skeleton if loading OR if file has patch but diff isn't ready yet
              <DiffSkeleton />
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
  const gotoLineSide = usePRReviewSelector((s) => s.gotoLineSide);
  const focusedLine = usePRReviewSelector((s) => s.focusedLine);
  const selectionAnchor = usePRReviewSelector((s) => s.selectionAnchor);
  const focusedCommentId = usePRReviewSelector((s) => s.focusedCommentId);
  const focusedPendingCommentId = usePRReviewSelector(
    (s) => s.focusedPendingCommentId
  );
  const focusedSkipBlockIndex = usePRReviewSelector(
    (s) => s.focusedSkipBlockIndex
  );
  const commentingOnLine = usePRReviewSelector((s) => s.commentingOnLine);
  const pendingCommentsCount = usePRReviewSelector(
    (s) => s.pendingComments.length
  );

  const showEscape =
    gotoLineMode ||
    focusedLine ||
    focusedCommentId ||
    focusedPendingCommentId ||
    focusedSkipBlockIndex !== null ||
    commentingOnLine;

  return (
    <div
      className={cn(
        "shrink-0 border-t border-border px-3 py-2 min-h-[36px]",
        gotoLineMode && "bg-blue-500/10",
        (focusedCommentId || focusedPendingCommentId) && "bg-yellow-500/10",
        commentingOnLine && "bg-green-500/10",
        focusedSkipBlockIndex !== null && "bg-blue-500/10",
        !gotoLineMode &&
          !focusedCommentId &&
          !focusedPendingCommentId &&
          !commentingOnLine &&
          focusedSkipBlockIndex === null &&
          "bg-card/50"
      )}
    >
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          {gotoLineMode ? (
            <>
              <span className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">
                  GOTO
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-xs font-medium",
                    gotoLineSide === "new"
                      ? "bg-green-500/20 text-green-400"
                      : "bg-orange-500/20 text-orange-400"
                  )}
                >
                  {gotoLineSide === "new" ? "new" : "old"}
                </span>
                <span className="font-mono text-blue-400">
                  {gotoLineInput || "..."}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Keycap keyName="Tab" size="xs" /> toggle side
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Keycap keyName="Enter" size="xs" /> jump
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
          ) : focusedSkipBlockIndex !== null ? (
            <>
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">
                EXPAND
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Keycap keyName="Enter" size="xs" /> expand hidden lines
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <KeycapGroup keys={["up", "down"]} size="xs" /> navigate
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
                <Keycap keyName="Shift" size="xs" />
                <KeycapGroup keys={["up", "down"]} size="xs" /> select range
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
                <Keycap keyName="k" size="xs" /> next/prev file
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
// Line Number Drag Selection Context
// ============================================================================

interface LineDragContextValue {
  isDragging: boolean;
  dragAnchor: number | null;
  onDragStart: (
    lineNum: number,
    side: "old" | "new",
    shiftKey?: boolean
  ) => void;
  onDragEnter: (lineNum: number, side: "old" | "new") => void;
  onDragEnd: () => void;
  onClickFallback: (lineNum: number, side: "old" | "new") => void;
  commentingRange: { start: number; end: number } | null;
  commentRangeLookup: Set<number> | null;
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
  | {
      type: "skip";
      hunk: DiffSkipBlock;
      skipIndex: number;
      startLine: number;
      index: number;
    }
  | { type: "line"; line: DiffLine; lineNum: number | undefined; index: number }
  | { type: "comment-form"; lineNum: number; startLine?: number; index: number }
  | { type: "pending-comment"; comment: LocalPendingComment; index: number }
  | {
      type: "comment-thread";
      comments: ReviewComment[];
      lineNum: number;
      index: number;
    }
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

  // Note: selectionState removed from context - rows subscribe directly to avoid re-renders
  const commentingRange = useCommentingRange();
  const commentRangeLookup = useCommentRangeLookup();

  // Subscribe to expanded skip blocks directly for re-render triggering
  const expandedSkipBlocks = usePRReviewSelector((s) => s.expandedSkipBlocks);

  // Skip block expansion
  const { expandSkipBlock, isExpanding } = useSkipBlockExpansion();

  // Selectors lifted to parent level - only subscriptions here instead of per-row
  const focusedSkipBlockIndex = usePRReviewSelector(
    (s) => s.focusedSkipBlockIndex
  );
  const focusedCommentId = usePRReviewSelector((s) => s.focusedCommentId);
  const focusedPendingCommentId = usePRReviewSelector(
    (s) => s.focusedPendingCommentId
  );
  const editingCommentId = usePRReviewSelector((s) => s.editingCommentId);
  const editingPendingCommentId = usePRReviewSelector(
    (s) => s.editingPendingCommentId
  );
  const replyingToCommentId = usePRReviewSelector((s) => s.replyingToCommentId);

  // Helper to get expanded lines for a skip block
  const getExpandedLines = useCallback(
    (skipIndex: number): DiffLine[] | null => {
      if (!selectedFile) return null;
      const key = `${selectedFile}:${skipIndex}`;
      return expandedSkipBlocks[key] ?? null;
    },
    [selectedFile, expandedSkipBlocks]
  );

  // Use refs for drag state to avoid stale closure issues in handlers
  const isDraggingRef = useRef(false);
  const dragAnchorRef = useRef<number | null>(null);
  const dragSideRef = useRef<"old" | "new" | null>(null);
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

  // Fix 5: Separate static rows (diff structure + comments) from dynamic overlays (comment form)
  // Static rows only change when diff or comments change
  const staticRows = useMemo((): VirtualRowType[] => {
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
          rows.push({
            type: "skip-spacer",
            position: "before",
            index: index++,
          });
          rows.push({
            type: "skip",
            hunk,
            skipIndex: currentSkipIndex,
            startLine,
            index: index++,
          });
          rows.push({ type: "skip-spacer", position: "after", index: index++ });
        }
      } else {
        for (const line of hunk.lines) {
          const lineNum = line.newLineNumber || line.oldLineNumber;
          rows.push({ type: "line", line, lineNum, index: index++ });

          // Add pending comments for this line
          if (lineNum) {
            const linePending = pendingCommentsByLine.get(lineNum);
            if (linePending) {
              for (const pending of linePending) {
                rows.push({
                  type: "pending-comment",
                  comment: pending,
                  index: index++,
                });
              }
            }

            // Add comment threads for this line
            const threads = threadsByLine.get(lineNum);
            if (threads) {
              for (const thread of threads) {
                rows.push({
                  type: "comment-thread",
                  comments: thread,
                  lineNum,
                  index: index++,
                });
              }
            }
          }
        }
      }
    }

    return rows;
  }, [
    hunks,
    skipBlockStartLines,
    pendingCommentsByLine,
    threadsByLine,
    getExpandedLines,
  ]);

  // Dynamic: Insert comment form into the correct position (only changes when commentingOnLine changes)
  const virtualRows = useMemo((): VirtualRowType[] => {
    if (!commentingOnLine) return staticRows;

    // Find where to insert the comment form
    const targetLine = commentingOnLine.line;
    const insertIndex = staticRows.findIndex((row, idx) => {
      if (row.type === "line" && row.lineNum === targetLine) {
        // Insert after this line (before any pending comments or threads on this line)
        return true;
      }
      return false;
    });

    if (insertIndex === -1) return staticRows;

    // Create new array with comment form inserted
    const result: VirtualRowType[] = [];
    let newIndex = 0;

    for (let i = 0; i < staticRows.length; i++) {
      const row = staticRows[i];
      result.push({ ...row, index: newIndex++ });

      // Insert comment form after the target line
      if (i === insertIndex) {
        result.push({
          type: "comment-form",
          lineNum: targetLine,
          startLine: commentingOnLine.startLine,
          index: newIndex++,
        });
      }
    }

    return result;
  }, [staticRows, commentingOnLine]);

  // Create O(1) lookup map for line numbers -> row indices
  const lineNumToRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    virtualRows.forEach((row, index) => {
      if (row.type === "line" && row.lineNum) {
        map.set(row.lineNum, index);
      }
    });
    return map;
  }, [virtualRows]);

  // Estimate row heights for the virtualizer
  const estimateSize = useCallback(
    (index: number) => {
      const row = virtualRows[index];
      if (!row) return 20;

      switch (row.type) {
        case "skip-spacer":
          return 8;
        case "skip":
          return 40;
        case "line":
          return 20;
        case "comment-form":
          return 180;
        case "pending-comment":
          return 100;
        case "comment-thread":
          return 80 + row.comments.length * 60;
        default:
          return 20;
      }
    },
    [virtualRows]
  );

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    // High overscan for smooth navigation - rows pre-rendered above/below viewport
    overscan: 100,
    // Add padding at the end so we can scroll the last line to center
    paddingEnd: 300,
  });

  const onDragStart = useCallback(
    (lineNum: number, side: "old" | "new", shiftKey?: boolean) => {
      const state = store.getSnapshot();

      // Shift+click: extend selection from current focus to clicked line
      if (
        shiftKey &&
        state.focusedLine !== null &&
        state.focusedLineSide === side
      ) {
        // Keep the anchor at the original focused line, move focus to clicked line
        if (state.selectionAnchor === null) {
          // No existing anchor - use current focused line as anchor
          store.setSelectionAnchor(state.focusedLine, side);
        }
        store.setFocusedLine(lineNum, side);
        // Don't start drag mode for shift+click
        return;
      }

      // Normal click: start new selection
      isDraggingRef.current = true;
      dragAnchorRef.current = lineNum;
      dragSideRef.current = side;
      store.setFocusedLine(lineNum, side);
      store.setSelectionAnchor(lineNum, side);
      setIsDraggingState(true);
    },
    [store]
  );

  const onDragEnter = useCallback(
    (lineNum: number, side: "old" | "new") => {
      if (
        isDraggingRef.current &&
        dragAnchorRef.current !== null &&
        dragSideRef.current === side
      ) {
        // Only extend selection within the same side (old or new)
        store.setFocusedLine(lineNum, side);
      }
    },
    [store]
  );

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
    dragSideRef.current = null;
    setIsDraggingState(false);
  }, [store]);

  const onClickFallback = useCallback(
    (lineNum: number, side: "old" | "new") => {
      if (handledByMouseEventsRef.current) {
        handledByMouseEventsRef.current = false;
        return;
      }
      store.startCommenting(lineNum);
    },
    [store]
  );

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        onDragEnd();
      }
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [onDragEnd]);

  // Handle keyboard event to expand focused skip block
  useEffect(() => {
    const handleExpandSkipBlock = (e: CustomEvent<{ skipIndex: number }>) => {
      const { skipIndex } = e.detail;
      const startLine = skipBlockStartLines[skipIndex] ?? 1;
      // Find the skip block to get its count
      let count = 0;
      let currentSkipIndex = 0;
      for (const hunk of hunks) {
        if (hunk.type === "skip") {
          if (currentSkipIndex === skipIndex) {
            count = hunk.count;
            break;
          }
          currentSkipIndex++;
        }
      }
      if (count > 0) {
        expandSkipBlock(skipIndex, startLine, count);
      }
    };

    window.addEventListener(
      "pr-review:expand-skip-block",
      handleExpandSkipBlock as EventListener
    );
    return () =>
      window.removeEventListener(
        "pr-review:expand-skip-block",
        handleExpandSkipBlock as EventListener
      );
  }, [hunks, skipBlockStartLines, expandSkipBlock]);

  // Handle mousemove during drag to extend selection even when not directly over line gutters
  useEffect(() => {
    if (!isDraggingState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !parentRef.current || !dragSideRef.current)
        return;

      const dragSide = dragSideRef.current;

      // Find the line element under the mouse by checking all rendered line elements
      const elements = parentRef.current.querySelectorAll("[data-line-gutter]");
      let closestLine: number | null = null;
      let closestDistance = Infinity;

      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const distance = Math.abs(e.clientY - centerY);

        if (distance < closestDistance) {
          // Get line number and side from the parent row's data
          const row = el.closest("[data-index]");
          if (row) {
            const index = parseInt(row.getAttribute("data-index") || "-1", 10);
            const virtualRow = virtualRows[index];
            if (virtualRow?.type === "line" && virtualRow.lineNum) {
              // Only consider lines on the same side as the drag
              const rowSide = virtualRow.line.type === "delete" ? "old" : "new";
              if (rowSide === dragSide) {
                closestDistance = distance;
                closestLine = virtualRow.lineNum;
              }
            }
          }
        }
      }

      if (closestLine !== null) {
        store.setFocusedLine(closestLine, dragSide);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [isDraggingState, virtualRows, store]);

  const dragValue = useMemo(
    () => ({
      isDragging: isDraggingState,
      dragAnchor: dragAnchorRef.current,
      onDragStart,
      onDragEnter,
      onDragEnd,
      onClickFallback,
      commentingRange,
      commentRangeLookup,
    }),
    [
      isDraggingState,
      onDragStart,
      onDragEnter,
      onDragEnd,
      onClickFallback,
      commentingRange,
      commentRangeLookup,
    ]
  );

  // Selection state for CSS-based highlighting (no per-row subscriptions)
  const focusedLine = usePRReviewSelector((s) => s.focusedLine);
  const focusedLineSide = usePRReviewSelector((s) => s.focusedLineSide);
  const selectionAnchor = usePRReviewSelector((s) => s.selectionAnchor);
  const selectionAnchorSide = usePRReviewSelector((s) => s.selectionAnchorSide);

  // Combined scroll + selection effect using RAF to prevent jitter
  const containerRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const container = containerRef.current;

      // 1. Update selection highlighting
      if (container) {
        // Clear previous selection
        const prevSelected = container.querySelectorAll("[data-selected]");
        prevSelected.forEach((el) => {
          el.removeAttribute("data-selected");
          el.removeAttribute("data-sel-first");
          el.removeAttribute("data-sel-last");
        });

        if (focusedLine && focusedLineSide) {
          // Compute selection range
          let selStart = focusedLine;
          let selEnd = focusedLine;
          if (
            selectionAnchor !== null &&
            selectionAnchorSide === focusedLineSide
          ) {
            selStart = Math.min(focusedLine, selectionAnchor);
            selEnd = Math.max(focusedLine, selectionAnchor);
          }

          // Mark selected rows
          for (let lineNum = selStart; lineNum <= selEnd; lineNum++) {
            const row = container.querySelector(
              `[data-line-num="${lineNum}"][data-line-side="${focusedLineSide}"]`
            );
            if (row) {
              row.setAttribute("data-selected", "true");
              if (lineNum === selStart)
                row.setAttribute("data-sel-first", "true");
              if (lineNum === selEnd) row.setAttribute("data-sel-last", "true");
            }
          }
        }
      }

      // 2. Scroll to focused line (after selection update)
      if (focusedLine && !isDraggingState) {
        const rowIndex = lineNumToRowIndex.get(focusedLine);
        if (rowIndex !== undefined) {
          // Use "auto" alignment - only scrolls if needed, keeps row visible
          virtualizer.scrollToIndex(rowIndex, {
            align: "auto",
          });
        }
      }
    });

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [
    focusedLine,
    focusedLineSide,
    selectionAnchor,
    selectionAnchorSide,
    isDraggingState,
    lineNumToRowIndex,
    virtualizer,
  ]);

  return (
    <LineDragContext.Provider value={dragValue}>
      <div ref={parentRef} className="flex-1 overflow-auto themed-scrollbar">
        <div className="p-4">
          <div className="border border-border rounded-lg overflow-hidden">
            <div
              ref={containerRef}
              className="relative w-full font-mono text-[0.8rem] [--code-added:theme(colors.green.500)] [--code-removed:theme(colors.orange.600)] diff-line-container"
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
                    <VirtualRowRenderer
                      row={row}
                      focusedSkipBlockIndex={focusedSkipBlockIndex}
                      focusedCommentId={focusedCommentId}
                      focusedPendingCommentId={focusedPendingCommentId}
                      editingCommentId={editingCommentId}
                      editingPendingCommentId={editingPendingCommentId}
                      replyingToCommentId={replyingToCommentId}
                      expandSkipBlock={expandSkipBlock}
                      isExpanding={isExpanding}
                    />
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

interface VirtualRowRendererProps {
  row: VirtualRowType;
  // Props passed from parent to avoid per-row selectors
  focusedSkipBlockIndex: number | null;
  focusedCommentId: number | null;
  focusedPendingCommentId: string | null;
  editingCommentId: number | null;
  editingPendingCommentId: string | null;
  replyingToCommentId: number | null;
  expandSkipBlock: (
    skipIndex: number,
    startLine: number,
    count: number
  ) => void;
  isExpanding: (skipIndex: number) => boolean;
}

const VirtualRowRenderer = memo(function VirtualRowRenderer({
  row,
  focusedSkipBlockIndex,
  focusedCommentId,
  focusedPendingCommentId,
  editingCommentId,
  editingPendingCommentId,
  replyingToCommentId,
  expandSkipBlock,
  isExpanding,
}: VirtualRowRendererProps) {
  switch (row.type) {
    case "skip-spacer":
      return <div className="h-2" />;
    case "skip":
      return (
        <SkipBlockRow
          hunk={row.hunk}
          isFocused={focusedSkipBlockIndex === row.skipIndex}
          isExpanding={isExpanding(row.skipIndex)}
          onExpand={() =>
            expandSkipBlock(row.skipIndex, row.startLine, row.hunk.count)
          }
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
  const store = usePRReviewStore();
  const {
    onDragStart,
    onDragEnter,
    onDragEnd,
    onClickFallback,
    commentingRange,
    commentRangeLookup,
  } = useLineDrag();

  // Determine which side this line is on: 'old' for deletes, 'new' for insert/context
  const lineSide: "old" | "new" = line.type === "delete" ? "old" : "new";

  // Selection highlighting is handled via CSS data attributes (no per-row subscription needed)

  // Compute commenting range state from lifted parent state (Fix 1)
  const isInCommentingRange = useMemo(() => {
    if (lineNum === undefined || !commentingRange) return false;
    return lineNum >= commentingRange.start && lineNum <= commentingRange.end;
  }, [lineNum, commentingRange]);

  // O(1) lookup for comment range using pre-computed Set (Fix 3)
  const hasCommentRange = useMemo(() => {
    if (lineNum === undefined || !commentRangeLookup) return false;
    return commentRangeLookup.has(lineNum);
  }, [lineNum, commentRangeLookup]);

  const Tag =
    line.type === "insert" ? "ins" : line.type === "delete" ? "del" : "span";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (lineNum) {
        e.preventDefault();
        onDragStart(lineNum, lineSide, e.shiftKey);
      }
    },
    [lineNum, lineSide, onDragStart]
  );

  const handleMouseUp = useCallback(() => {
    onDragEnd();
  }, [onDragEnd]);

  const handleMouseEnter = useCallback(() => {
    if (lineNum) {
      onDragEnter(lineNum, lineSide);
    }
  }, [lineNum, lineSide, onDragEnter]);

  const handleClick = useCallback(() => {
    if (lineNum) {
      onClickFallback(lineNum, lineSide);
    }
  }, [lineNum, lineSide, onClickFallback]);

  // Handle mousedown on content to catch shift+click before browser text selection
  const handleContentMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!lineNum) return;

      const state = store.getSnapshot();

      // Shift+click: extend selection from current focus to clicked line
      if (e.shiftKey && state.focusedLine !== null) {
        e.preventDefault(); // Prevent browser text selection
        if (state.selectionAnchor === null) {
          store.setSelectionAnchor(
            state.focusedLine,
            state.focusedLineSide ?? lineSide
          );
        }
        store.setFocusedLine(lineNum, lineSide);
        return;
      }
    },
    [lineNum, lineSide, store]
  );

  // Click on code content to focus line (but not if user is selecting text)
  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      if (!lineNum) return;

      // Shift+click is handled in mousedown
      if (e.shiftKey) return;

      // Check if user has made a text selection
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        return; // Don't focus if user is selecting text
      }

      // Normal click: focus the line (clear any selection)
      store.setFocusedLine(lineNum, lineSide);
      store.setSelectionAnchor(null, null);
    },
    [lineNum, lineSide, store]
  );

  // Styles for non-selection highlighting (selection is handled via CSS data attributes)
  const styles = useMemo(() => {
    let bgColor: string | undefined;

    // Selection highlighting is now CSS-based via data-selected attribute
    if (isInCommentingRange) {
      bgColor = "#19273e"; // opaque blue for commenting range
    } else if (line.type === "insert") {
      bgColor = "#122218"; // opaque green
    } else if (line.type === "delete") {
      bgColor = "#261710"; // opaque orange
    } else if (hasCommentRange) {
      bgColor = "#1b1810"; // opaque yellow
    }

    const result: React.CSSProperties = {};

    if (bgColor) {
      result.background = `linear-gradient(${bgColor}, ${bgColor})`;
      result.backgroundSize = "100% calc(100% + 2px)";
      result.backgroundRepeat = "no-repeat";
    }

    return result;
  }, [isInCommentingRange, line.type, hasCommentRange]);

  return (
    <div
      className="flex h-5 min-h-5 whitespace-pre-wrap box-border group contain-layout diff-line-row"
      style={styles}
      data-line-num={lineNum}
      data-line-side={lineSide}
    >
      {/* Left border indicator */}
      <div
        className={cn(
          "w-1 shrink-0 border-l-[3px] border-transparent",
          line.type === "insert" && "!border-[var(--code-added)]/60",
          line.type === "delete" && "!border-[var(--code-removed)]/80"
        )}
      />
      {/* Old line number (shown for delete and normal lines) */}
      <div
        data-line-gutter
        className={cn(
          "w-10 shrink-0 tabular-nums text-right opacity-50 pr-2 text-xs select-none pt-0.5",
          line.type !== "insert" && "cursor-pointer hover:bg-blue-500/20"
        )}
        onMouseDown={line.type !== "insert" ? handleMouseDown : undefined}
        onMouseUp={line.type !== "insert" ? handleMouseUp : undefined}
        onMouseEnter={line.type !== "insert" ? handleMouseEnter : undefined}
        onClick={line.type !== "insert" ? handleClick : undefined}
      >
        {line.type !== "insert" ? line.oldLineNumber : ""}
      </div>
      {/* New line number (shown for insert and normal lines) */}
      <div
        data-line-gutter
        className={cn(
          "w-10 shrink-0 tabular-nums text-right opacity-50 pr-2 text-xs select-none pt-0.5 border-r border-border/30",
          line.type !== "delete" && "cursor-pointer hover:bg-blue-500/20"
        )}
        onMouseDown={line.type !== "delete" ? handleMouseDown : undefined}
        onMouseUp={line.type !== "delete" ? handleMouseUp : undefined}
        onMouseEnter={line.type !== "delete" ? handleMouseEnter : undefined}
        onClick={line.type !== "delete" ? handleClick : undefined}
      >
        {line.type !== "delete" ? line.newLineNumber : ""}
      </div>
      {/* Code content - click to focus line (unless selecting text) */}
      <div
        className="flex-1 whitespace-pre-wrap break-words pr-6 overflow-hidden pl-2 cursor-text"
        onMouseDown={handleContentMouseDown}
        onClick={handleContentClick}
      >
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
  isFocused?: boolean;
  isExpanding?: boolean;
  onExpand?: () => void;
}

const SkipBlockRow = memo(function SkipBlockRow({
  hunk,
  isFocused,
  isExpanding,
  onExpand,
}: SkipBlockRowProps) {
  const skipBlockRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(() => {
    if (onExpand && !isExpanding) {
      onExpand();
    }
  }, [onExpand, isExpanding]);

  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && skipBlockRef.current) {
      skipBlockRef.current.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
    }
  }, [isFocused]);

  return (
    <div
      ref={skipBlockRef}
      onClick={handleClick}
      className={cn(
        "flex items-center h-10 font-mono bg-muted text-muted-foreground transition-colors group",
        isExpanding ? "opacity-60" : "hover:bg-muted/80 cursor-pointer",
        isFocused && "ring-2 ring-blue-500 ring-inset bg-blue-500/10"
      )}
    >
      <div className="w-1 shrink-0" />
      {/* Two line number columns to match diff lines */}
      <div
        className={cn(
          "w-10 shrink-0 opacity-50 select-none flex items-center justify-center group-hover:opacity-70",
          isFocused && "opacity-70"
        )}
      >
        {isExpanding ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ChevronsUpDown className="w-4 h-4" />
        )}
      </div>
      <div className="w-10 shrink-0 border-r border-border/30" />
      <div className="flex-1">
        <span
          className={cn(
            "pl-2 italic opacity-50 group-hover:opacity-70",
            isFocused && "opacity-70"
          )}
        >
          {hunk.content || `${hunk.count} lines hidden`}
        </span>
        {!isExpanding && !isFocused && (
          <span className="ml-2 text-xs opacity-0 group-hover:opacity-50 transition-opacity">
            Click to expand
          </span>
        )}
        {!isExpanding && isFocused && (
          <span className="ml-2 text-xs text-blue-400 opacity-70">
            Press Enter to expand
          </span>
        )}
        {isExpanding && (
          <span className="ml-2 text-xs opacity-50">Loading...</span>
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
  const canWrite = useCanWrite();
  const { startDeviceAuth } = useAuth();
  const { addPendingComment } = useCommentActions();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  // Show sign-in prompt for read-only users
  if (!canWrite) {
    return (
      <div className="border-l-2 border-amber-500 bg-amber-500/5 p-4 mx-4 my-2 rounded-r-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <MessageSquare className="w-4 h-4 text-amber-500" />
            <span className="text-muted-foreground">
              Comment on {lineLabel}
            </span>
          </div>
          <button
            onClick={store.cancelCommenting}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Sign in to leave comments
          </span>
          <button
            onClick={startDeviceAuth}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign in with GitHub
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-l-2 border-green-500 bg-green-500/5 p-4 mx-4 my-2 rounded-r-lg">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Comment on {lineLabel}
        </span>
        <button
          onClick={store.cancelCommenting}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <MarkdownEditor
        value={text}
        onChange={setText}
        onKeyDown={handleKeyDown}
        placeholder="Leave a comment... (will be added to your pending review)"
        minHeight="80px"
        autoFocus
      />
      <div className="flex justify-end gap-2 mt-3">
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
  const canWrite = useCanWrite();
  const { replyToComment, updateComment, deleteComment } = useCommentActions();
  const { resolveThread, unresolveThread } = useThreadActions();
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [resolving, setResolving] = useState(false);

  const replyingTo =
    comments.find((c) => c.id === replyingToCommentId)?.id ?? null;

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
          <span
            className={cn(
              "text-xs font-medium",
              isResolved ? "text-green-500" : "text-muted-foreground"
            )}
          >
            {isResolved
              ? "Resolved"
              : `${comments.length} comment${comments.length !== 1 ? "s" : ""}`}
          </span>
          {isResolved && isCollapsed && (
            <span className="text-xs text-muted-foreground">
              by {firstComment.user.login}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canWrite && threadId && (
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

          {canWrite && replyingTo && (
            <div className="px-4 py-3 border-t border-border/50">
              <MarkdownEditor
                value={replyText}
                onChange={setReplyText}
                onKeyDown={handleKeyDown}
                placeholder="Write a reply..."
                minHeight="60px"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-3">
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
      commentRef.current.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
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
              <MarkdownEditor
                value={editText}
                onChange={setEditText}
                onKeyDown={handleKeyDown}
                placeholder="Edit your comment..."
                minHeight="60px"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-3">
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
                <Markdown>{comment.body}</Markdown>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={() => store.startReplying(comment.id)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Reply (r)"
                >
                  <Reply className="w-3 h-3" />
                  Reply
                  {isFocused && (
                    <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                      r
                    </kbd>
                  )}
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
                      {isFocused && (
                        <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                          e
                        </kbd>
                      )}
                    </button>
                    <button
                      onClick={() => onDelete(comment.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete (d)"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                      {isFocused && (
                        <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                          d
                        </kbd>
                      )}
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
      commentRef.current.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
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
            src={`https://github.com/${currentUser || "ghost"}.png`}
            alt={currentUser || "You"}
            className="w-6 h-6 rounded-full shrink-0"
            loading="lazy"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{currentUser || "You"}</span>
                <span className="text-muted-foreground text-xs">just now</span>
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/20 text-yellow-500 rounded">
                  Pending
                </span>
              </div>
            </div>

            {isEditing ? (
              <div className="mt-2">
                <MarkdownEditor
                  value={editText}
                  onChange={setEditText}
                  onKeyDown={handleKeyDown}
                  placeholder="Edit your comment..."
                  minHeight="60px"
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-3">
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
                  <Markdown>{comment.body}</Markdown>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => store.startEditingPendingComment(comment.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit (e)"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                    {isFocused && (
                      <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                        e
                      </kbd>
                    )}
                  </button>
                  <button
                    onClick={() => removePendingComment(comment.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete (d)"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                    {isFocused && (
                      <kbd className="ml-0.5 px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                        d
                      </kbd>
                    )}
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
  const viewerPermission = usePRReviewSelector((s) => s.viewerPermission);

  const [reviewType, setReviewType] = useState<
    "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
  >("COMMENT");
  const [isOpen, setIsOpen] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  // Check if current user is the PR author (can't approve/request changes on own PR)
  const isAuthor = currentUser !== null && pr.user.login === currentUser;

  // Check if viewer has write access (ADMIN, MAINTAIN, or WRITE can approve/request_changes)
  // TRIAGE and READ permissions are limited to commenting only
  const canApproveOrRequestChanges =
    viewerPermission === "ADMIN" ||
    viewerPermission === "MAINTAIN" ||
    viewerPermission === "WRITE";

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

  const handleJumpToComment = useCallback(
    (comment: LocalPendingComment) => {
      store.selectFile(comment.path);
      // Small delay to let the file load, then focus the pending comment
      setTimeout(() => {
        store.setFocusedPendingCommentId(comment.id);
      }, 100);
      setIsOpen(false);
    },
    [store]
  );

  const pendingCount = pendingComments.length;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors">
          <span>Submit review</span>
          {pendingCount > 0 && (
            <span className="px-1 py-0.5 text-[10px] bg-green-500/50 rounded">
              {pendingCount}
            </span>
          )}
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[450px]">
        <DropdownMenuLabel className="font-semibold">
          Finish your review
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Review body */}
        <div className="p-3" onClick={(e) => e.stopPropagation()}>
          <MarkdownEditor
            value={reviewBody}
            onChange={(v) => store.setReviewBody(v)}
            placeholder="Leave a comment"
            minHeight="80px"
          />
        </div>

        {/* Pending comments by file */}
        {pendingCount > 0 && (
          <div className="px-3 pb-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span className="font-medium">
                {pendingCount} pending comment{pendingCount !== 1 ? "s" : ""}
              </span>
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
              {Array.from(commentsByFile.entries()).map(
                ([filePath, comments]) => {
                  const fileName = filePath.split("/").pop() || filePath;
                  const isExpanded = expandedFile === filePath;

                  return (
                    <div
                      key={filePath}
                      className="rounded-md border border-border/50 overflow-hidden"
                    >
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
                        <span className="font-mono truncate flex-1 text-left">
                          {fileName}
                        </span>
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
                                L
                                {comment.start_line
                                  ? `${comment.start_line}-`
                                  : ""}
                                {comment.line}
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
                }
              )}
            </div>
          </div>
        )}

        <DropdownMenuSeparator />

        {/* Review type radio options */}
        <div className="px-3 py-2">
          <RadioGroup
            value={reviewType}
            onValueChange={(v) => setReviewType(v as typeof reviewType)}
            className="gap-2"
          >
            <label className="flex items-start gap-3 cursor-pointer group">
              <RadioGroupItem value="COMMENT" className="mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-sm">Comment</span>
                <span className="text-xs text-muted-foreground">
                  Submit general feedback without explicit approval.
                </span>
              </div>
            </label>

            {!isAuthor && canApproveOrRequestChanges && (
              <>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <RadioGroupItem value="APPROVE" className="mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm text-green-400">
                      Approve
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Submit feedback and approve merging these changes.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <RadioGroupItem value="REQUEST_CHANGES" className="mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm text-amber-400">
                      Request changes
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Submit feedback suggesting changes.
                    </span>
                  </div>
                </label>
              </>
            )}

            {/* Show explanation when user cannot approve */}
            {!isAuthor && !canApproveOrRequestChanges && viewerPermission && (
              <div className="flex items-start gap-2 px-1 py-2 text-xs text-muted-foreground bg-muted/30 rounded-md">
                <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  You can only comment on this PR. The{" "}
                  <span className="font-medium">
                    {pr.base.repo.owner.login}
                  </span>{" "}
                  organization has OAuth app restrictions enabled.{" "}
                  <a
                    href="https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Learn more
                  </a>
                </span>
              </div>
            )}
          </RadioGroup>
        </div>

        <DropdownMenuSeparator />

        {/* Submit buttons */}
        <div className="p-2 flex justify-end gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
            className="px-2 py-1 text-xs rounded-md hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSubmit();
            }}
            disabled={
              submitting ||
              (reviewType === "COMMENT" &&
                pendingCount === 0 &&
                !reviewBody.trim())
            }
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-50",
              reviewType === "APPROVE" &&
                "bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30",
              reviewType === "REQUEST_CHANGES" &&
                "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30",
              reviewType === "COMMENT" &&
                "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : reviewType === "APPROVE" ? (
              <Check className="w-3.5 h-3.5" />
            ) : reviewType === "REQUEST_CHANGES" ? (
              <XCircle className="w-3.5 h-3.5" />
            ) : (
              <MessageSquare className="w-3.5 h-3.5" />
            )}
            Submit review
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

// ============================================================================
// Skeleton Components
// ============================================================================

function PRReviewSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Header skeleton - single row matching PRHeader */}
      <div className="shrink-0 border-b border-border bg-card/30 px-2 sm:px-4 py-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-4 w-24 hidden sm:block" />
          <Skeleton className="h-5 flex-1 max-w-md" />
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-4 w-16 hidden sm:block" />
          <Skeleton className="h-4 w-4" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* File panel skeleton */}
        <aside className="w-64 border-r border-border flex flex-col overflow-hidden shrink-0">
          <div className="mx-2 my-2 flex items-center gap-1.5">
            <Skeleton className="flex-1 h-8" />
            <Skeleton className="w-8 h-8" />
          </div>
          <Skeleton className="mx-2 mb-1 h-8" />
          <div className="border-t border-border/50 mt-1" />
          <div className="flex-1 p-2 space-y-1">
            {[70, 55, 80, 45, 65, 90, 50, 75, 60, 85, 40, 70].map(
              (width, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1">
                  <Skeleton className="w-4 h-4" />
                  <Skeleton className="h-4" style={{ width: `${width}%` }} />
                </div>
              )
            )}
          </div>
        </aside>

        {/* Overview panel skeleton - shown by default since showOverview is true initially */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* Header bar matching the overview view */}
          <div className="shrink-0 border-b border-border bg-card/30 px-2 sm:px-3 py-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-muted-foreground">
                Overview
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-24 hidden sm:block" />
              <Skeleton className="h-8 w-28" />
            </div>
          </div>
          <OverviewPanelSkeleton />
        </main>
      </div>
    </div>
  );
}

function OverviewPanelSkeleton() {
  return (
    <div className="flex-1 overflow-auto bg-background">
      {/* Tabs skeleton */}
      <div className="border-b border-border">
        <div className="max-w-[1280px] mx-auto px-6">
          <div className="flex items-center gap-4 py-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </div>

      {/* Main Content skeleton */}
      <div className="max-w-[1280px] mx-auto px-6 py-6">
        <div className="flex gap-6">
          {/* Left Column */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* PR Description skeleton */}
            <div className="border border-border rounded-md overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50">
                <Skeleton className="w-5 h-5 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="p-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[90%]" />
                <Skeleton className="h-4 w-[75%]" />
                <Skeleton className="h-4 w-[85%]" />
                <Skeleton className="h-4 w-[60%]" />
              </div>
            </div>

            {/* Timeline items skeleton */}
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="border border-border rounded-md overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50">
                  <Skeleton className="w-5 h-5 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-[90%]" />
                </div>
              </div>
            ))}

            {/* Merge section skeleton */}
            <div className="border border-border rounded-md overflow-hidden">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-4 border-b border-border last:border-b-0"
                >
                  <Skeleton className="w-5 h-5 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                </div>
              ))}
              <div className="p-4">
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </div>

          {/* Right Column - Sidebar skeleton */}
          <div className="w-[296px] shrink-0 space-y-4 hidden lg:block">
            {/* Reviewers */}
            <div className="pb-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Reviewers
                </span>
                <Skeleton className="w-4 h-4" />
              </div>
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="w-5 h-5 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            </div>

            {/* Labels */}
            <div className="pb-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Labels
                </span>
                <Skeleton className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-5 w-16 rounded-full" />
                ))}
              </div>
            </div>

            {/* Participants */}
            <div className="pb-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Participants
                </span>
              </div>
              <div className="flex items-center gap-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="w-6 h-6 rounded-full" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Deterministic widths for skeleton lines to avoid re-render flicker
const SKELETON_LINE_WIDTHS = [
  65, 45, 80, 30, 55, 70, 40, 85, 50, 60, 75, 35, 90, 45, 55, 70, 25, 80, 60,
  50,
];

function DiffSkeleton() {
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="font-mono text-[0.8rem]">
          {/* Hunk header skeleton */}
          <div className="bg-muted/50 px-4 py-2 border-b border-border">
            <Skeleton className="h-4 w-48" />
          </div>

          {/* Diff lines skeleton */}
          {SKELETON_LINE_WIDTHS.map((width, i) => (
            <DiffLineSkeleton
              key={i}
              type={i % 7 === 3 ? "add" : i % 7 === 5 ? "remove" : "normal"}
              width={width}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffLineSkeleton({
  type = "normal",
  width,
}: {
  type?: "add" | "remove" | "normal";
  width: number;
}) {
  const bgClass =
    type === "add"
      ? "bg-green-500/5"
      : type === "remove"
        ? "bg-orange-500/5"
        : "";

  return (
    <div className={cn("flex h-5 min-h-5", bgClass)}>
      <div className="w-1 shrink-0" />
      <div className="w-10 shrink-0 flex items-center justify-end pr-2">
        <Skeleton className="h-3 w-6" />
      </div>
      <div className="w-10 shrink-0 border-r border-border/30 flex items-center justify-end pr-2">
        <Skeleton className="h-3 w-6" />
      </div>
      <div className="flex-1 pl-2 flex items-center">
        <Skeleton className="h-3" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
