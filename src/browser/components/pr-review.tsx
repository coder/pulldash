import { useState, useMemo, useCallback, useEffect, useRef, Fragment, memo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ChevronLeft, Loader2, MessageSquare, Reply, Send, X, ChevronsUpDown, Check, XCircle, MessageCircle, Eye, Trash2, GitPullRequest, FileCode } from "lucide-react";
import { cn } from "../cn";
import { PRHeader } from "./pr-header";
import { FileTree } from "./file-tree";
import { FileHeader } from "./file-header";
import type {
  PullRequest,
  PullRequestFile,
  ReviewComment,
  PendingReviewComment,
} from "@/api/github";

// ============================================================================
// Types for pending review
// ============================================================================

interface LocalPendingComment extends PendingReviewComment {
  id: string; // local ID for tracking
}

// ============================================================================
// Types for parsed diff
// ============================================================================

interface LineSegment {
  value: string;
  html: string;
  type: "insert" | "delete" | "normal";
}

interface DiffLine {
  type: "insert" | "delete" | "normal";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: LineSegment[];
}

interface DiffHunk {
  type: "hunk";
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

interface DiffSkipBlock {
  type: "skip";
  count: number;
  content: string;
}

interface ParsedDiff {
  hunks: (DiffHunk | DiffSkipBlock)[];
}

// ============================================================================
// Diff Cache
// ============================================================================

// ============================================================================
// Diff Cache with LRU-like behavior
// ============================================================================

const diffCache = new Map<string, ParsedDiff>();
const MAX_CACHE_SIZE = 100;
const pendingFetches = new Map<string, Promise<ParsedDiff>>();

async function fetchParsedDiff(file: PullRequestFile): Promise<ParsedDiff> {
  // If file has no patch (binary, too large, etc.), return empty hunks
  if (!file.patch) {
    return { hunks: [] };
  }

  const cacheKey = file.sha;
  
  // Check cache first
  if (diffCache.has(cacheKey)) {
    return diffCache.get(cacheKey)!;
  }
  
  // Check if already fetching
  if (pendingFetches.has(cacheKey)) {
    return pendingFetches.get(cacheKey)!;
  }

  // Create fetch promise
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
    
    // Check for error response or missing hunks
    if (parsed.error || !parsed.hunks) {
      pendingFetches.delete(cacheKey);
      return { hunks: [] };
    }
    
    // Manage cache size
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

// Batch prefetch multiple files in parallel
async function batchPrefetchDiffs(files: PullRequestFile[], maxConcurrent = 3): Promise<void> {
  const uncached = files.filter(f => !diffCache.has(f.sha) && !pendingFetches.has(f.sha));
  
  for (let i = 0; i < uncached.length; i += maxConcurrent) {
    const batch = uncached.slice(i, i + maxConcurrent);
    await Promise.all(batch.map(f => fetchParsedDiff(f).catch(() => null)));
  }
}

// ============================================================================
// Page Component
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
    <PRReview
      pr={pr}
      files={files}
      comments={comments}
      setComments={setComments}
      owner={owner!}
      repo={repo!}
    />
  );
}

// ============================================================================
// Main Review Component
// ============================================================================

interface PRReviewProps {
  pr: PullRequest;
  files: PullRequestFile[];
  comments: ReviewComment[];
  setComments: React.Dispatch<React.SetStateAction<ReviewComment[]>>;
  owner: string;
  repo: string;
}

function PRReview({
  pr,
  files,
  comments,
  setComments,
  owner,
  repo,
}: PRReviewProps) {
  const navigate = useNavigate();

  const [selectedFile, setSelectedFile] = useState<string | null>(
    files[0]?.filename || null
  );
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());
  const [loadedDiffs, setLoadedDiffs] = useState<Record<string, ParsedDiff>>({});
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  const [commentingOnLine, setCommentingOnLine] = useState<{line: number; startLine?: number} | null>(null);
  
  // Line navigation state (always active, vim-like)
  const [focusedLine, setFocusedLine] = useState<number | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [gotoLineMode, setGotoLineMode] = useState(false);
  const [gotoLineInput, setGotoLineInput] = useState("");
  
  // Pending review state
  const [pendingComments, setPendingComments] = useState<LocalPendingComment[]>([]);
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [reviewBody, setReviewBody] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const prefetchQueue = useRef<string[]>([]);
  const isPrefetching = useRef(false);

  // Group comments by file path
  const commentsByFile = useMemo(() => {
    const grouped: Record<string, ReviewComment[]> = {};
    for (const comment of comments) {
      if (!grouped[comment.path]) {
        grouped[comment.path] = [];
      }
      grouped[comment.path].push(comment);
    }
    return grouped;
  }, [comments]);

  // Load viewed files from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`viewed-${owner}-${repo}-${pr.number}`);
    if (stored) {
      setViewedFiles(new Set(JSON.parse(stored)));
    }
  }, [owner, repo, pr.number]);

  const loadDiff = useCallback(
    async (filename: string) => {
      const file = files.find((f) => f.filename === filename);
      if (!file || loadedDiffs[filename] || loadingFiles.has(filename)) return;

      setLoadingFiles((prev) => new Set(prev).add(filename));

      try {
        const parsed = await fetchParsedDiff(file);
        setLoadedDiffs((prev) => ({ ...prev, [filename]: parsed }));
      } catch (error) {
        console.error("Failed to load diff:", error);
      } finally {
        setLoadingFiles((prev) => {
          const next = new Set(prev);
          next.delete(filename);
          return next;
        });
      }
    },
    [files, loadedDiffs, loadingFiles]
  );

  // Improved prefetch with batching
  const processPrefetchQueue = useCallback(async () => {
    if (isPrefetching.current || prefetchQueue.current.length === 0) return;

    isPrefetching.current = true;

    const filesToFetch = prefetchQueue.current
      .filter(filename => !loadedDiffs[filename] && !loadingFiles.has(filename))
      .slice(0, 5); // Limit batch size
    
    prefetchQueue.current = prefetchQueue.current.filter(f => !filesToFetch.includes(f));
    
    const fileObjects = filesToFetch
      .map(filename => files.find(f => f.filename === filename))
      .filter((f): f is PullRequestFile => f !== undefined);
    
    if (fileObjects.length > 0) {
      await batchPrefetchDiffs(fileObjects, 3);
      
      // Update loaded diffs state
      for (const file of fileObjects) {
        if (diffCache.has(file.sha)) {
          setLoadedDiffs(prev => ({ ...prev, [file.filename]: diffCache.get(file.sha)! }));
        }
      }
    }

    isPrefetching.current = false;
    
    // Process remaining queue
    if (prefetchQueue.current.length > 0) {
      requestAnimationFrame(() => processPrefetchQueue());
    }
  }, [files, loadedDiffs, loadingFiles]);

  useEffect(() => {
    if (!selectedFile) return;

    loadDiff(selectedFile);

    const currentIndex = files.findIndex((f) => f.filename === selectedFile);
    
    // Prefetch next 5 files (increased from 4)
    const filesToPrefetch = files
      .slice(currentIndex + 1, currentIndex + 6)
      .map((f) => f.filename)
      .filter((f) => !loadedDiffs[f] && !loadingFiles.has(f));

    prefetchQueue.current = [
      ...new Set([...prefetchQueue.current, ...filesToPrefetch]),
    ];
    
    // Use requestIdleCallback for prefetching to not block main thread
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => processPrefetchQueue(), { timeout: 1000 });
    } else {
      setTimeout(processPrefetchQueue, 100);
    }
  }, [selectedFile, files, loadDiff, loadedDiffs, loadingFiles, processPrefetchQueue]);

  // Reset commenting state when file changes
  useEffect(() => {
    setCommentingOnLine(null);
    setFocusedLine(null);
    setSelectionAnchor(null);
    setGotoLineMode(false);
    setGotoLineInput("");
  }, [selectedFile]);

  // Get all commentable line numbers from the current diff
  const commentableLines = useMemo(() => {
    const parsedDiff = selectedFile ? loadedDiffs[selectedFile] : null;
    if (!parsedDiff?.hunks) return [];
    
    const lines: number[] = [];
    for (const hunk of parsedDiff.hunks) {
      if (hunk.type === "hunk") {
        for (const line of hunk.lines) {
          const lineNum = line.newLineNumber || line.oldLineNumber;
          if (lineNum) lines.push(lineNum);
        }
      }
    }
    return lines;
  }, [selectedFile, loadedDiffs]);

  const toggleViewed = useCallback(
    (filename: string) => {
      setViewedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(filename)) {
          next.delete(filename);
        } else {
          next.add(filename);
        }
        localStorage.setItem(
          `viewed-${owner}-${repo}-${pr.number}`,
          JSON.stringify([...next])
        );
        return next;
      });
    },
    [owner, repo, pr.number]
  );

  // Keyboard navigation for files and lines
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Handle goto line mode (g + numbers)
      if (gotoLineMode) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          setGotoLineInput(prev => prev + e.key);
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          setGotoLineInput(prev => prev.slice(0, -1));
          return;
        }
        if (e.key === "Enter" && gotoLineInput) {
          e.preventDefault();
          const targetLine = parseInt(gotoLineInput, 10);
          // Find the closest commentable line to the target
          if (commentableLines.length > 0) {
            const closestLine = commentableLines.reduce((closest, line) => {
              return Math.abs(line - targetLine) < Math.abs(closest - targetLine) ? line : closest;
            }, commentableLines[0]);
            setFocusedLine(closestLine);
            setSelectionAnchor(null);
          }
          setGotoLineMode(false);
          setGotoLineInput("");
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setGotoLineMode(false);
          setGotoLineInput("");
          return;
        }
        return; // Ignore other keys in goto mode
      }

      // Arrow keys for line navigation (always active)
      if (e.key === "ArrowDown" && commentableLines.length > 0) {
        e.preventDefault();
        const currentIdx = focusedLine ? commentableLines.indexOf(focusedLine) : -1;
        const nextIdx = Math.min(currentIdx + 1, commentableLines.length - 1);
        const nextLine = commentableLines[nextIdx];
        setFocusedLine(nextLine);
        if (!e.shiftKey) {
          setSelectionAnchor(null);
        } else if (selectionAnchor === null && focusedLine) {
          setSelectionAnchor(focusedLine);
        }
        return;
      }
      
      if (e.key === "ArrowUp" && commentableLines.length > 0) {
        e.preventDefault();
        const currentIdx = focusedLine ? commentableLines.indexOf(focusedLine) : commentableLines.length;
        const prevIdx = Math.max(currentIdx - 1, 0);
        const prevLine = commentableLines[prevIdx];
        setFocusedLine(prevLine);
        if (!e.shiftKey) {
          setSelectionAnchor(null);
        } else if (selectionAnchor === null && focusedLine) {
          setSelectionAnchor(focusedLine);
        }
        return;
      }

      // Find next/previous unviewed file
      const findNextUnviewed = (direction: 1 | -1): string | null => {
        const currentIndex = selectedFile
          ? files.findIndex((f) => f.filename === selectedFile)
          : -1;
        
        const startIndex = direction === 1 ? currentIndex + 1 : currentIndex - 1;
        const length = files.length;
        
        // Search in the given direction, wrapping around
        for (let i = 0; i < length; i++) {
          const index = direction === 1
            ? (startIndex + i) % length
            : (startIndex - i + length) % length;
          
          if (index >= 0 && index < length && !viewedFiles.has(files[index].filename)) {
            return files[index].filename;
          }
        }
        return null;
      };

      switch (e.key.toLowerCase()) {
        case "k": {
          // Next unviewed file
          e.preventDefault();
          const next = findNextUnviewed(1);
          if (next) setSelectedFile(next);
          break;
        }
        case "j": {
          // Previous unviewed file
          e.preventDefault();
          const prev = findNextUnviewed(-1);
          if (prev) setSelectedFile(prev);
          break;
        }
        case "v": {
          // Toggle viewed for current file
          if (selectedFile) {
            toggleViewed(selectedFile);
          }
          break;
        }
        case "g": {
          // Enter goto line mode
          e.preventDefault();
          setGotoLineMode(true);
          setGotoLineInput("");
          break;
        }
        case "c": {
          // Leave comment on current selection
          e.preventDefault();
          if (focusedLine) {
            const startLine = selectionAnchor 
              ? Math.min(focusedLine, selectionAnchor) 
              : undefined;
            const endLine = selectionAnchor 
              ? Math.max(focusedLine, selectionAnchor) 
              : focusedLine;
            setCommentingOnLine({ line: endLine, startLine: startLine !== endLine ? startLine : undefined });
          } else if (commentableLines.length > 0) {
            // If no line focused, focus first line
            setFocusedLine(commentableLines[0]);
          }
          break;
        }
        case "escape": {
          // Clear selection
          e.preventDefault();
          setFocusedLine(null);
          setSelectionAnchor(null);
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [files, selectedFile, viewedFiles, toggleViewed, commentableLines, focusedLine, selectionAnchor, gotoLineMode, gotoLineInput]);

  // Add comment to pending review
  const handleAddPendingComment = useCallback(
    async (line: number, body: string, startLine?: number) => {
      if (!selectedFile) return;
      
      const newPendingComment: LocalPendingComment = {
        id: `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        path: selectedFile,
        line,
        start_line: startLine,
        body,
        side: "RIGHT",
      };
      
      setPendingComments((prev) => [...prev, newPendingComment]);
      setCommentingOnLine(null);
      setFocusedLine(null);
      setSelectionAnchor(null);
    },
    [selectedFile]
  );

  // Remove a pending comment
  const handleRemovePendingComment = useCallback((id: string) => {
    setPendingComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Submit the review with all pending comments
  const handleSubmitReview = useCallback(
    async (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") => {
      setSubmittingReview(true);
      
      try {
        const response = await fetch(
          `/api/pr/${owner}/${repo}/${pr.number}/reviews`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              commit_id: pr.head.sha,
              event,
              body: reviewBody,
              comments: pendingComments.map(({ path, line, body, side }) => ({
                path,
                line,
                body,
                side,
              })),
            }),
          }
        );

        if (response.ok) {
          // Refresh comments after successful review submission
          const commentsRes = await fetch(`/api/pr/${owner}/${repo}/${pr.number}/comments`);
          if (commentsRes.ok) {
            const newComments = await commentsRes.json();
            setComments(newComments);
          }
          
          // Clear pending state
          setPendingComments([]);
          setReviewBody("");
          setShowReviewPanel(false);
        }
      } finally {
        setSubmittingReview(false);
      }
    },
    [owner, repo, pr.number, pr.head.sha, reviewBody, pendingComments, setComments]
  );

  const handleReplyToComment = useCallback(
    async (commentId: number, body: string) => {
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
        setComments((prev) => [...prev, newComment]);
      }
    },
    [owner, repo, pr.number, setComments]
  );

  const currentFile = files.find((f) => f.filename === selectedFile);
  const isLoading = selectedFile ? loadingFiles.has(selectedFile) : false;
  const parsedDiff = selectedFile ? loadedDiffs[selectedFile] : null;
  const fileComments = selectedFile ? commentsByFile[selectedFile] || [] : [];
  const filePendingComments = selectedFile 
    ? pendingComments.filter((c) => c.path === selectedFile)
    : [];

  // Calculate pending comments count per file
  const pendingCommentsByFile = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const comment of pendingComments) {
      counts[comment.path] = (counts[comment.path] || 0) + 1;
    }
    return counts;
  }, [pendingComments]);

  return (
    <div className="flex flex-col h-screen">
      <PRHeader pr={pr} owner={owner} repo={repo} />

      <div className="flex flex-1 overflow-hidden">
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
            <span className="text-sm font-medium">
              {files.length} files changed
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              <span className="text-green-500">+{pr.additions}</span>{" "}
              <span className="text-red-500">−{pr.deletions}</span>
            </span>
          </div>
          <FileTree
            files={files}
            selectedFile={selectedFile}
            viewedFiles={viewedFiles}
            commentCounts={Object.fromEntries(
              Object.entries(commentsByFile).map(([path, c]) => [path, c.length])
            )}
            pendingCommentCounts={pendingCommentsByFile}
            onSelectFile={setSelectedFile}
          />
          
          {/* Review Panel Toggle */}
          {pendingComments.length > 0 && (
            <div className="p-3 border-t border-border">
              <button
                onClick={() => setShowReviewPanel(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Eye className="w-4 h-4" />
                Review ({pendingComments.length} pending)
              </button>
            </div>
          )}
        </aside>

        <main className="flex-1 overflow-hidden flex flex-col">
          {/* File navigation bar */}
          <div className="shrink-0 border-b border-border bg-card px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const currentIdx = files.findIndex(f => f.filename === selectedFile);
                  if (currentIdx > 0) setSelectedFile(files[currentIdx - 1].filename);
                }}
                disabled={!selectedFile || files.findIndex(f => f.filename === selectedFile) === 0}
                className="px-2 py-1 text-sm rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <span className="text-sm text-muted-foreground">
                File {selectedFile ? files.findIndex(f => f.filename === selectedFile) + 1 : 0} of {files.length}
              </span>
              <button
                onClick={() => {
                  const currentIdx = files.findIndex(f => f.filename === selectedFile);
                  if (currentIdx < files.length - 1) setSelectedFile(files[currentIdx + 1].filename);
                }}
                disabled={!selectedFile || files.findIndex(f => f.filename === selectedFile) === files.length - 1}
                className="px-2 py-1 text-sm rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                <span className="text-green-500 font-medium">{viewedFiles.size}</span>
                <span className="text-muted-foreground"> / {files.length} reviewed</span>
              </span>
              {files.length - viewedFiles.size > 0 && (
                <span className="text-yellow-500">
                  {files.length - viewedFiles.size} remaining
                </span>
              )}
            </div>
          </div>

          {currentFile ? (
            <div className="flex flex-col h-full">
              {/* Sticky file header */}
              <div className="shrink-0 border-b border-border bg-muted/50 backdrop-blur-sm z-20">
                <div className="px-4 py-2">
                  <FileHeader
                    file={currentFile}
                    isViewed={viewedFiles.has(currentFile.filename)}
                    onToggleViewed={() => toggleViewed(currentFile.filename)}
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
                    ) : parsedDiff && parsedDiff.hunks && parsedDiff.hunks.length > 0 ? (
                      <DiffViewer
                        diff={parsedDiff}
                        comments={fileComments}
                        pendingComments={filePendingComments}
                        commentingOnLine={commentingOnLine}
                        focusedLine={focusedLine}
                        selectionAnchor={selectionAnchor}
                        onLineClick={(line) => setCommentingOnLine({ line })}
                        onCancelComment={() => setCommentingOnLine(null)}
                        onSubmitComment={handleAddPendingComment}
                        onReplyToComment={handleReplyToComment}
                        onRemovePendingComment={handleRemovePendingComment}
                      />
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
              
              {/* Keybinds bar - always visible */}
              <div className={cn(
                "shrink-0 border-t border-border px-4 py-2",
                gotoLineMode ? "bg-blue-500/10" : "bg-muted/30"
              )}>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4">
                    {gotoLineMode ? (
                      <>
                        <span className="font-medium text-blue-400">Go to line</span>
                        <span className="font-mono bg-muted px-2 py-0.5 rounded min-w-[3ch] inline-block">
                          {gotoLineInput || "_"}
                        </span>
                        <span className="text-muted-foreground">Enter to jump</span>
                      </>
                    ) : focusedLine ? (
                      <>
                        <span className="font-mono text-blue-400">
                          {selectionAnchor 
                            ? `L${Math.min(focusedLine, selectionAnchor)}-${Math.max(focusedLine, selectionAnchor)}`
                            : `L${focusedLine}`
                          }
                        </span>
                        <span className="text-muted-foreground">
                          <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">c</kbd>
                          {" "}comment
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">↑↓</kbd>
                        {" "}select line
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">g</kbd>
                      {" "}goto
                    </span>
                    <span className="text-muted-foreground">
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">j</kbd>
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono ml-0.5">k</kbd>
                      {" "}files
                    </span>
                    <span className="text-muted-foreground">
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">v</kbd>
                      {" "}viewed
                    </span>
                  </div>
                  {(gotoLineMode || focusedLine) && (
                    <span className="text-muted-foreground">
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Esc</kbd>
                      {" "}{gotoLineMode ? "cancel" : "clear"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-center flex-1 text-muted-foreground">
                Select a file to view changes
              </div>
              {/* Keybinds bar */}
              <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-2">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">j</kbd>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono ml-0.5">k</kbd>
                    {" "}navigate files
                  </span>
                  <span>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">v</kbd>
                    {" "}mark viewed
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      
      {/* Review Panel Modal */}
      {showReviewPanel && (
        <ReviewPanel
          pendingComments={pendingComments}
          reviewBody={reviewBody}
          setReviewBody={setReviewBody}
          submitting={submittingReview}
          onSubmit={handleSubmitReview}
          onClose={() => setShowReviewPanel(false)}
          onRemovePendingComment={handleRemovePendingComment}
        />
      )}
    </div>
  );
}

// ============================================================================
// Diff Viewer
// ============================================================================

interface DiffViewerProps {
  diff: ParsedDiff;
  comments: ReviewComment[];
  pendingComments: LocalPendingComment[];
  commentingOnLine: {line: number; startLine?: number} | null;
  focusedLine: number | null;
  selectionAnchor: number | null;
  onLineClick: (line: number) => void;
  onCancelComment: () => void;
  onSubmitComment: (line: number, body: string, startLine?: number) => Promise<void>;
  onReplyToComment: (commentId: number, body: string) => Promise<void>;
  onRemovePendingComment: (id: string) => void;
}

const DiffViewer = memo(function DiffViewer({
  diff,
  comments,
  pendingComments,
  commentingOnLine,
  focusedLine,
  selectionAnchor,
  onLineClick,
  onCancelComment,
  onSubmitComment,
  onReplyToComment,
  onRemovePendingComment,
}: DiffViewerProps) {
  // Safety check for invalid diff
  const hunks = diff?.hunks ?? [];
  
  // Calculate selection range (always active when there's a focused line)
  const selectionRange = useMemo(() => {
    if (!focusedLine) return null;
    if (!selectionAnchor) return { start: focusedLine, end: focusedLine };
    return {
      start: Math.min(focusedLine, selectionAnchor),
      end: Math.max(focusedLine, selectionAnchor),
    };
  }, [focusedLine, selectionAnchor]);

  // Group comments into threads by line
  const threadsByLine = useMemo(() => {
    const byLine: Record<number, ReviewComment[][]> = {};
    const threadMap: Map<number, ReviewComment[]> = new Map();

    for (const comment of comments) {
      if (!comment.in_reply_to_id) {
        threadMap.set(comment.id, [comment]);
      }
    }

    for (const comment of comments) {
      if (comment.in_reply_to_id) {
        const thread = threadMap.get(comment.in_reply_to_id);
        if (thread) {
          thread.push(comment);
        }
      }
    }

    for (const [, thread] of threadMap) {
      const rootComment = thread[0];
      const line = rootComment.line || rootComment.original_line;
      if (line) {
        if (!byLine[line]) byLine[line] = [];
        byLine[line].push(thread);
      }
    }

    return byLine;
  }, [comments]);

  // Group pending comments by line
  const pendingByLine = useMemo(() => {
    const byLine: Record<number, LocalPendingComment[]> = {};
    for (const comment of pendingComments) {
      if (!byLine[comment.line]) byLine[comment.line] = [];
      byLine[comment.line].push(comment);
    }
    return byLine;
  }, [pendingComments]);

  // Track which lines are in comment ranges (for highlighting)
  const linesInCommentRange = useMemo(() => {
    const lines = new Set<number>();
    // Add lines from existing comments with start_line
    for (const comment of comments) {
      if (comment.start_line && comment.line) {
        for (let i = comment.start_line; i <= comment.line; i++) {
          lines.add(i);
        }
      }
    }
    // Add lines from pending comments with start_line
    for (const comment of pendingComments) {
      if (comment.start_line) {
        for (let i = comment.start_line; i <= comment.line; i++) {
          lines.add(i);
        }
      }
    }
    return lines;
  }, [comments, pendingComments]);

  return (
    <table className="w-full border-collapse font-mono text-[0.8rem] [--code-added:theme(colors.green.500)] [--code-removed:theme(colors.orange.600)]">
      <tbody>
        {hunks.map((hunk, hunkIndex) =>
          hunk.type === "skip" ? (
            <SkipBlockRow key={`skip-${hunkIndex}`} hunk={hunk} />
          ) : (
            <Fragment key={`hunk-${hunkIndex}`}>
              {hunk.lines.map((line, lineIndex) => {
                // Use newLineNumber for inserts/normal, oldLineNumber for deletes
                const lineNum = line.newLineNumber || line.oldLineNumber;
                const lineThreads = lineNum ? threadsByLine[lineNum] : undefined;
                const linePending = lineNum ? pendingByLine[lineNum] : undefined;
                const isCommenting = lineNum === commentingOnLine?.line;
                const isInCommentRange = !!(commentingOnLine && lineNum !== undefined &&
                  lineNum >= (commentingOnLine.startLine ?? commentingOnLine.line) && 
                  lineNum <= commentingOnLine.line);

                const isFocused = lineNum === focusedLine;
                const isInSelection = !!(selectionRange && lineNum !== undefined &&
                  lineNum >= selectionRange.start && lineNum <= selectionRange.end);
                const hasCommentRange = lineNum !== undefined && linesInCommentRange.has(lineNum);

                return (
                  <Fragment key={`line-${hunkIndex}-${lineIndex}`}>
                    <DiffLineRow
                      line={line}
                      isFocused={isFocused}
                      isInSelection={isInSelection || isInCommentRange}
                      hasCommentRange={hasCommentRange}
                      onLineClick={onLineClick}
                    />
                    
                    {/* Inline comment form */}
                    {isCommenting && lineNum && (
                      <tr>
                        <td colSpan={3} className="p-0">
                          <InlineCommentForm
                            line={lineNum}
                            startLine={commentingOnLine?.startLine}
                            onSubmit={onSubmitComment}
                            onCancel={onCancelComment}
                          />
                        </td>
                      </tr>
                    )}
                    
                    {/* Pending comments */}
                    {linePending?.map((pending) => (
                      <tr key={pending.id}>
                        <td colSpan={3} className="p-0">
                          <PendingCommentItem
                            comment={pending}
                            onRemove={() => onRemovePendingComment(pending.id)}
                          />
                        </td>
                      </tr>
                    ))}
                    
                    {/* Existing comment threads */}
                    {lineThreads?.map((thread, threadIdx) => (
                      <tr key={`thread-${lineNum}-${threadIdx}`}>
                        <td colSpan={3} className="p-0">
                          <CommentThread
                            comments={thread}
                            onReply={onReplyToComment}
                          />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </Fragment>
          )
        )}
      </tbody>
    </table>
  );
});

// ============================================================================
// Diff Line Row (Memoized for performance)
// ============================================================================

interface DiffLineRowProps {
  line: DiffLine;
  isFocused?: boolean;
  isInSelection?: boolean;
  hasCommentRange?: boolean;
  onLineClick: (line: number) => void;
}

const DiffLineRow = memo(function DiffLineRow({ line, isFocused, isInSelection, hasCommentRange, onLineClick }: DiffLineRowProps) {
  const Tag = line.type === "insert" ? "ins" : line.type === "delete" ? "del" : "span";
  // Use the appropriate line number based on type
  const displayLineNum = line.type === "delete" ? line.oldLineNumber : line.newLineNumber;
  const commentLineNum = line.newLineNumber || line.oldLineNumber;
  const rowRef = useRef<HTMLTableRowElement>(null);

  const handleClick = useCallback(() => {
    if (commentLineNum) onLineClick(commentLineNum);
  }, [commentLineNum, onLineClick]);

  // Scroll focused line into view
  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isFocused]);

  return (
    <tr
      ref={rowRef}
      className={cn(
        "whitespace-pre-wrap box-border border-none h-5 min-h-5 group",
        line.type === "insert" && "bg-[var(--code-added)]/10",
        line.type === "delete" && "bg-[var(--code-removed)]/10",
        hasCommentRange && "bg-yellow-500/5",
        isInSelection && "!bg-blue-500/20",
        isFocused && "ring-2 ring-blue-500 ring-inset"
      )}
    >
      {/* Marker column */}
      <td
        className={cn(
          "border-transparent w-1 border-l-[3px]",
          line.type === "insert" && "!border-[var(--code-added)]/60",
          line.type === "delete" && "!border-[var(--code-removed)]/80"
        )}
      />
      
      {/* Line number column */}
      <td
        className="tabular-nums text-center opacity-50 px-2 text-xs select-none w-12 cursor-pointer hover:bg-blue-500/20"
        onClick={handleClick}
      >
        {line.type === "delete" ? "–" : displayLineNum}
      </td>
      
      {/* Code column */}
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
// Skip Block Row (Memoized)
// ============================================================================

const SkipBlockRow = memo(function SkipBlockRow({ hunk }: { hunk: DiffSkipBlock }) {
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
// Inline Comment Form (Memoized)
// ============================================================================

interface InlineCommentFormProps {
  line: number;
  startLine?: number;
  onSubmit: (line: number, body: string, startLine?: number) => Promise<void>;
  onCancel: () => void;
}

const InlineCommentForm = memo(function InlineCommentForm({ line, startLine, onSubmit, onCancel }: InlineCommentFormProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit(line, text.trim(), startLine);
      setText("");
    } finally {
      setSubmitting(false);
    }
  }, [text, line, startLine, onSubmit]);

  // Handle Cmd/Ctrl+Enter to submit
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }, [handleSubmit, onCancel]);

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
          onClick={onCancel}
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
          onClick={onCancel}
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
// Comment Thread (Memoized)
// ============================================================================

interface CommentThreadProps {
  comments: ReviewComment[];
  onReply: (commentId: number, body: string) => Promise<void>;
}

const CommentThread = memo(function CommentThread({ comments, onReply }: CommentThreadProps) {
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitReply = useCallback(async () => {
    if (!replyText.trim() || !replyingTo) return;

    setSubmitting(true);
    try {
      await onReply(replyingTo, replyText.trim());
      setReplyText("");
      setReplyingTo(null);
    } finally {
      setSubmitting(false);
    }
  }, [replyText, replyingTo, onReply]);

  const handleCancel = useCallback(() => {
    setReplyingTo(null);
    setReplyText("");
  }, []);

  return (
    <div className="border-l-2 border-blue-500/50 bg-card/80 mx-4 my-2 rounded-r-lg">
      {comments.map((comment, idx) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          isReply={idx > 0}
          onReplyClick={() => setReplyingTo(comment.id)}
        />
      ))}

      {replyingTo && (
        <div className="px-4 py-3 border-t border-border/50">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply..."
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
// Comment Item (Memoized)
// ============================================================================

interface CommentItemProps {
  comment: ReviewComment;
  isReply?: boolean;
  onReplyClick: () => void;
}

const CommentItem = memo(function CommentItem({ comment, isReply, onReplyClick }: CommentItemProps) {
  const timeAgo = useMemo(() => getTimeAgo(new Date(comment.created_at)), [comment.created_at]);

  return (
    <div className={cn("px-4 py-3 font-sans", isReply && "pl-12 border-t border-border/30")}>
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
          <div className="mt-1 text-sm text-foreground/90 whitespace-pre-wrap">
            {comment.body}
          </div>
          <button
            onClick={onReplyClick}
            className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Reply className="w-3 h-3" />
            Reply
          </button>
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
  onRemove: () => void;
}

function PendingCommentItem({ comment, onRemove }: PendingCommentItemProps) {
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
                <span className="text-yellow-500 font-medium text-xs">Pending comment</span>
                <span className="text-muted-foreground text-xs font-mono">{lineLabel}</span>
              </div>
              <button
                onClick={onRemove}
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
}

// ============================================================================
// Review Panel Modal
// ============================================================================

interface ReviewPanelProps {
  pendingComments: LocalPendingComment[];
  reviewBody: string;
  setReviewBody: (body: string) => void;
  submitting: boolean;
  onSubmit: (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") => Promise<void>;
  onClose: () => void;
  onRemovePendingComment: (id: string) => void;
}

function ReviewPanel({
  pendingComments,
  reviewBody,
  setReviewBody,
  submitting,
  onSubmit,
  onClose,
  onRemovePendingComment,
}: ReviewPanelProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Finish your review</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Pending comments summary */}
          {pendingComments.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                {pendingComments.length} pending comment{pendingComments.length !== 1 ? "s" : ""}
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
                      onClick={() => onRemovePendingComment(comment.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Review body */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Leave a comment (optional)
            </label>
            <textarea
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              placeholder="Write your review summary..."
              className="w-full min-h-[120px] px-4 py-3 text-sm rounded-lg border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit("COMMENT")}
            disabled={submitting || pendingComments.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          >
            <MessageSquare className="w-4 h-4" />
            Comment
          </button>
          <button
            onClick={() => onSubmit("REQUEST_CHANGES")}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            <XCircle className="w-4 h-4" />
            Request changes
          </button>
          <button
            onClick={() => onSubmit("APPROVE")}
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
}

// ============================================================================
// Helpers
// ============================================================================

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
