import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Loader2, MessageSquare, Reply, Send, X, ChevronsUpDown } from "lucide-react";
import { cn } from "../cn";
import { PRHeader } from "./pr-header";
import { FileTree } from "./file-tree";
import { FileHeader } from "./file-header";
import type {
  PullRequest,
  PullRequestFile,
  ReviewComment,
} from "@/api/github";

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

const diffCache = new Map<string, ParsedDiff>();

async function fetchParsedDiff(file: PullRequestFile): Promise<ParsedDiff> {
  const cacheKey = file.sha;
  if (diffCache.has(cacheKey)) {
    return diffCache.get(cacheKey)!;
  }

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
  diffCache.set(cacheKey, parsed);
  return parsed;
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
  const [commentingOnLine, setCommentingOnLine] = useState<number | null>(null);

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

  const processPrefetchQueue = useCallback(async () => {
    if (isPrefetching.current || prefetchQueue.current.length === 0) return;

    isPrefetching.current = true;

    while (prefetchQueue.current.length > 0) {
      const filename = prefetchQueue.current.shift()!;
      if (!loadedDiffs[filename] && !loadingFiles.has(filename)) {
        await loadDiff(filename);
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    isPrefetching.current = false;
  }, [loadDiff, loadedDiffs, loadingFiles]);

  useEffect(() => {
    if (!selectedFile) return;

    loadDiff(selectedFile);

    const currentIndex = files.findIndex((f) => f.filename === selectedFile);
    const filesToPrefetch = files
      .slice(currentIndex + 1, currentIndex + 4)
      .map((f) => f.filename)
      .filter((f) => !loadedDiffs[f] && !loadingFiles.has(f));

    prefetchQueue.current = [
      ...new Set([...prefetchQueue.current, ...filesToPrefetch]),
    ];
    processPrefetchQueue();
  }, [selectedFile, files, loadDiff, loadedDiffs, loadingFiles, processPrefetchQueue]);

  // Reset commenting state when file changes
  useEffect(() => {
    setCommentingOnLine(null);
  }, [selectedFile]);

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

  const handleAddComment = useCallback(
    async (line: number, body: string) => {
      if (!selectedFile) return;
      
      const response = await fetch(
        `/api/pr/${owner}/${repo}/${pr.number}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            commit_id: pr.head.sha,
            path: selectedFile,
            line,
            side: "RIGHT",
          }),
        }
      );

      if (response.ok) {
        const newComment = await response.json();
        setComments((prev) => [...prev, newComment]);
        setCommentingOnLine(null);
      }
    },
    [owner, repo, pr.number, pr.head.sha, selectedFile, setComments]
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

  return (
    <div className="flex flex-col h-screen">
      <PRHeader pr={pr} owner={owner} repo={repo} />

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 border-r border-border flex flex-col overflow-hidden shrink-0">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <button
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
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
            onSelectFile={setSelectedFile}
          />
        </aside>

        <main className="flex-1 overflow-auto">
          {currentFile ? (
            <div className="p-4">
              <div className="border border-border rounded-lg overflow-hidden">
                <FileHeader
                  file={currentFile}
                  isViewed={viewedFiles.has(currentFile.filename)}
                  onToggleViewed={() => toggleViewed(currentFile.filename)}
                />
                <div className="overflow-x-auto">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : parsedDiff ? (
                    <DiffViewer
                      diff={parsedDiff}
                      comments={fileComments}
                      commentingOnLine={commentingOnLine}
                      onLineClick={setCommentingOnLine}
                      onCancelComment={() => setCommentingOnLine(null)}
                      onSubmitComment={handleAddComment}
                      onReplyToComment={handleReplyToComment}
                    />
                  ) : !currentFile.patch ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      Binary file or no changes to display
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Select a file to view changes
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// Diff Viewer
// ============================================================================

interface DiffViewerProps {
  diff: ParsedDiff;
  comments: ReviewComment[];
  commentingOnLine: number | null;
  onLineClick: (line: number) => void;
  onCancelComment: () => void;
  onSubmitComment: (line: number, body: string) => Promise<void>;
  onReplyToComment: (commentId: number, body: string) => Promise<void>;
}

function DiffViewer({
  diff,
  comments,
  commentingOnLine,
  onLineClick,
  onCancelComment,
  onSubmitComment,
  onReplyToComment,
}: DiffViewerProps) {
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

  return (
    <table className="w-full border-collapse font-mono text-[0.8rem] [--code-added:theme(colors.green.500)] [--code-removed:theme(colors.orange.600)]">
      <tbody>
        {diff.hunks.map((hunk, hunkIndex) =>
          hunk.type === "skip" ? (
            <SkipBlockRow key={`skip-${hunkIndex}`} hunk={hunk} />
          ) : (
            <Fragment key={`hunk-${hunkIndex}`}>
              {hunk.lines.map((line, lineIndex) => {
                // Use newLineNumber for inserts/normal, oldLineNumber for deletes
                const lineNum = line.newLineNumber || line.oldLineNumber;
                const lineThreads = lineNum ? threadsByLine[lineNum] : undefined;
                const isCommenting = lineNum === commentingOnLine;

                return (
                  <Fragment key={`line-${hunkIndex}-${lineIndex}`}>
                    <DiffLineRow
                      line={line}
                      onLineClick={onLineClick}
                    />
                    
                    {/* Inline comment form */}
                    {isCommenting && lineNum && (
                      <tr>
                        <td colSpan={3} className="p-0">
                          <InlineCommentForm
                            line={lineNum}
                            onSubmit={onSubmitComment}
                            onCancel={onCancelComment}
                          />
                        </td>
                      </tr>
                    )}
                    
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
}

// ============================================================================
// Diff Line Row
// ============================================================================

interface DiffLineRowProps {
  line: DiffLine;
  onLineClick: (line: number) => void;
}

function DiffLineRow({ line, onLineClick }: DiffLineRowProps) {
  const Tag = line.type === "insert" ? "ins" : line.type === "delete" ? "del" : "span";
  // Use the appropriate line number based on type
  const displayLineNum = line.type === "delete" ? line.oldLineNumber : line.newLineNumber;
  const commentLineNum = line.newLineNumber || line.oldLineNumber;

  return (
    <tr
      className={cn(
        "whitespace-pre-wrap box-border border-none h-5 min-h-5 group",
        line.type === "insert" && "bg-[var(--code-added)]/10",
        line.type === "delete" && "bg-[var(--code-removed)]/10"
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
        onClick={() => {
          if (commentLineNum) onLineClick(commentLineNum);
        }}
      >
        {line.type === "delete" ? "–" : displayLineNum}
      </td>
      
      {/* Code column */}
      <td className="text-nowrap pr-6">
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
}

// ============================================================================
// Skip Block Row
// ============================================================================

function SkipBlockRow({ hunk }: { hunk: DiffSkipBlock }) {
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
}

// ============================================================================
// Inline Comment Form
// ============================================================================

interface InlineCommentFormProps {
  line: number;
  onSubmit: (line: number, body: string) => Promise<void>;
  onCancel: () => void;
}

function InlineCommentForm({ line, onSubmit, onCancel }: InlineCommentFormProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit(line, text.trim());
      setText("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-l-2 border-green-500 bg-green-500/5 p-4 mx-4 my-2 rounded-r-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Comment on line {line}
        </span>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave a comment..."
        className="w-full min-h-[100px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring font-sans"
        autoFocus
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
          Add comment
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Comment Thread
// ============================================================================

interface CommentThreadProps {
  comments: ReviewComment[];
  onReply: (commentId: number, body: string) => Promise<void>;
}

function CommentThread({ comments, onReply }: CommentThreadProps) {
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitReply = async () => {
    if (!replyText.trim() || !replyingTo) return;

    setSubmitting(true);
    try {
      await onReply(replyingTo, replyText.trim());
      setReplyText("");
      setReplyingTo(null);
    } finally {
      setSubmitting(false);
    }
  };

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
              onClick={() => {
                setReplyingTo(null);
                setReplyText("");
              }}
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
}

// ============================================================================
// Comment Item
// ============================================================================

interface CommentItemProps {
  comment: ReviewComment;
  isReply?: boolean;
  onReplyClick: () => void;
}

function CommentItem({ comment, isReply, onReplyClick }: CommentItemProps) {
  const timeAgo = getTimeAgo(new Date(comment.created_at));

  return (
    <div className={cn("px-4 py-3 font-sans", isReply && "pl-12 border-t border-border/30")}>
      <div className="flex items-start gap-3">
        <img
          src={comment.user.avatar_url}
          alt={comment.user.login}
          className="w-6 h-6 rounded-full shrink-0"
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
