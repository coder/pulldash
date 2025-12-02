import { useState, useEffect, useCallback, memo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  GitMerge,
  GitPullRequest,
  Check,
  X,
  Clock,
  AlertCircle,
  ChevronDown,
  MessageSquare,
  Send,
  ExternalLink,
  FileCode,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { cn } from "../cn";
import { PRHeader } from "./pr-header";
import type {
  PullRequest,
  Review,
  CheckRun,
  CombinedStatus,
  IssueComment,
} from "@/api/types";

// ============================================================================
// Markdown Content Component
// ============================================================================

const MarkdownContent = memo(function MarkdownContent({
  content,
}: {
  content: string;
}) {
  return (
    <div
      className="prose prose-sm prose-invert max-w-none
      prose-p:my-2 prose-p:leading-relaxed
      prose-pre:bg-muted prose-pre:rounded-md prose-pre:p-3
      prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
      prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
      prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
      prose-blockquote:border-l-2 prose-blockquote:border-muted-foreground prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-muted-foreground
      prose-headings:my-3 prose-headings:font-semibold
      prose-hr:border-border prose-hr:my-4
      prose-img:rounded-md prose-img:my-2
      prose-table:text-sm prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
});

// ============================================================================
// Page Component
// ============================================================================

export function PROverviewPage() {
  const { owner, repo, number } = useParams<{
    owner: string;
    repo: string;
    number: string;
  }>();
  const navigate = useNavigate();

  const [pr, setPr] = useState<PullRequest | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [checks, setChecks] = useState<{
    checkRuns: CheckRun[];
    status: CombinedStatus;
  } | null>(null);
  const [conversation, setConversation] = useState<IssueComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo || !number) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [prRes, reviewsRes, checksRes, conversationRes] =
          await Promise.all([
            fetch(`/api/pr/${owner}/${repo}/${number}`),
            fetch(`/api/pr/${owner}/${repo}/${number}/reviews`),
            fetch(`/api/pr/${owner}/${repo}/${number}/checks`),
            fetch(`/api/pr/${owner}/${repo}/${number}/conversation`),
          ]);

        if (!prRes.ok) throw new Error("Failed to fetch PR data");

        const prData = await prRes.json();
        setPr(prData);

        if (reviewsRes.ok) setReviews(await reviewsRes.json());
        if (checksRes.ok) setChecks(await checksRes.json());
        if (conversationRes.ok) setConversation(await conversationRes.json());
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
    <PROverview
      pr={pr}
      reviews={reviews}
      checks={checks}
      conversation={conversation}
      setConversation={setConversation}
      owner={owner!}
      repo={repo!}
    />
  );
}

// ============================================================================
// Main Overview Component
// ============================================================================

interface PROverviewProps {
  pr: PullRequest;
  reviews: Review[];
  checks: { checkRuns: CheckRun[]; status: CombinedStatus } | null;
  conversation: IssueComment[];
  setConversation: React.Dispatch<React.SetStateAction<IssueComment[]>>;
  owner: string;
  repo: string;
}

function PROverview({
  pr,
  reviews,
  checks,
  conversation,
  setConversation,
  owner,
  repo,
}: PROverviewProps) {
  const navigate = useNavigate();
  const [merging, setMerging] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | "rebase">(
    "squash"
  );
  const [showMergeOptions, setShowMergeOptions] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const handleMerge = useCallback(async () => {
    setMerging(true);
    setMergeError(null);

    try {
      const response = await fetch(
        `/api/pr/${owner}/${repo}/${pr.number}/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merge_method: mergeMethod }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to merge");
      }

      // Refresh the page to show updated state
      window.location.reload();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Failed to merge");
    } finally {
      setMerging(false);
    }
  }, [owner, repo, pr.number, mergeMethod]);

  const handleAddComment = useCallback(async () => {
    if (!commentText.trim()) return;

    setSubmittingComment(true);
    try {
      const response = await fetch(
        `/api/pr/${owner}/${repo}/${pr.number}/conversation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: commentText }),
        }
      );

      if (response.ok) {
        const newComment = await response.json();
        setConversation((prev) => [...prev, newComment]);
        setCommentText("");
      }
    } finally {
      setSubmittingComment(false);
    }
  }, [owner, repo, pr.number, commentText, setConversation]);

  // Calculate overall check status
  const checkStatus = calculateCheckStatus(checks);

  // Get latest reviews by user
  const latestReviews = getLatestReviewsByUser(reviews);

  return (
    <div className="flex flex-col h-screen">
      <PRHeader pr={pr} owner={owner} repo={repo} showTabs />

      <div className="flex-1 overflow-auto themed-scrollbar">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Navigation tabs */}
          <div className="flex items-center gap-4 border-b border-border pb-4">
            <Link
              to={`/${owner}/${repo}/pull/${pr.number}`}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-sm font-medium"
            >
              <GitPullRequest className="w-4 h-4" />
              Overview
            </Link>
            <Link
              to={`/${owner}/${repo}/pull/${pr.number}/files`}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground text-sm transition-colors"
            >
              <FileCode className="w-4 h-4" />
              Files changed
            </Link>
          </div>

          {/* PR Title & Status */}
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h1 className="text-2xl font-semibold">{pr.title}</h1>
                <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                  <StatusBadge pr={pr} />
                  <span>
                    <span className="font-medium text-foreground">
                      {pr.user.login}
                    </span>{" "}
                    wants to merge{" "}
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      {pr.head.ref}
                    </span>{" "}
                    into{" "}
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      {pr.base.ref}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* PR Description */}
            {pr.body && (
              <div className="p-4 bg-card border border-border rounded-lg">
                <MarkdownContent content={pr.body} />
              </div>
            )}
          </div>

          {/* Reviews Section */}
          {latestReviews.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Reviews
              </h2>
              <div className="space-y-2">
                {latestReviews.map((review) => (
                  <ReviewItem key={review.id} review={review} />
                ))}
              </div>
            </div>
          )}

          {/* Checks Section */}
          {checks &&
            (checks.checkRuns.length > 0 ||
              checks.status.statuses.length > 0) && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <CheckStatusIcon status={checkStatus} />
                  Checks
                </h2>
                <div className="border border-border rounded-lg divide-y divide-border">
                  {checks.checkRuns.map((check) => (
                    <CheckRunItem key={check.id} check={check} />
                  ))}
                  {checks.status.statuses.map((status, idx) => (
                    <StatusItem key={idx} status={status} />
                  ))}
                </div>
              </div>
            )}

          {/* Merge Section */}
          {pr.state === "open" && !pr.merged && (
            <div className="p-4 bg-card border border-border rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MergeStatusIcon pr={pr} checkStatus={checkStatus} />
                  <div>
                    <p className="font-medium">
                      {getMergeStatusText(pr, checkStatus)}
                    </p>
                    {mergeError && (
                      <p className="text-sm text-destructive mt-1">
                        {mergeError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button
                      onClick={() => setShowMergeOptions(!showMergeOptions)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-l-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                      disabled={merging || !canMerge(pr, checkStatus)}
                    >
                      <GitMerge className="w-4 h-4" />
                      {getMergeButtonText(mergeMethod)}
                    </button>
                    <button
                      onClick={() => setShowMergeOptions(!showMergeOptions)}
                      className="px-2 py-2 bg-green-600 text-white rounded-r-lg border-l border-green-700 hover:bg-green-700 transition-colors disabled:opacity-50"
                      disabled={merging || !canMerge(pr, checkStatus)}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>

                    {showMergeOptions && (
                      <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-xl z-10">
                        <button
                          onClick={() => {
                            setMergeMethod("merge");
                            setShowMergeOptions(false);
                          }}
                          className={cn(
                            "w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors rounded-t-lg",
                            mergeMethod === "merge" && "bg-muted"
                          )}
                        >
                          Create merge commit
                        </button>
                        <button
                          onClick={() => {
                            setMergeMethod("squash");
                            setShowMergeOptions(false);
                          }}
                          className={cn(
                            "w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors",
                            mergeMethod === "squash" && "bg-muted"
                          )}
                        >
                          Squash and merge
                        </button>
                        <button
                          onClick={() => {
                            setMergeMethod("rebase");
                            setShowMergeOptions(false);
                          }}
                          className={cn(
                            "w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors rounded-b-lg",
                            mergeMethod === "rebase" && "bg-muted"
                          )}
                        >
                          Rebase and merge
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleMerge}
                    disabled={merging || !canMerge(pr, checkStatus)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {merging ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Confirm"
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Merged State */}
          {pr.merged && (
            <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg flex items-center gap-3">
              <GitMerge className="w-5 h-5 text-purple-500" />
              <p className="font-medium text-purple-400">
                Pull request successfully merged and closed
              </p>
            </div>
          )}

          {/* Conversation Section */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Conversation ({conversation.length})
            </h2>

            {conversation.length > 0 && (
              <div className="space-y-3">
                {conversation.map((comment) => (
                  <ConversationComment key={comment.id} comment={comment} />
                ))}
              </div>
            )}

            {/* Add Comment */}
            <div className="mt-4">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Leave a comment..."
                className="w-full min-h-[100px] px-4 py-3 text-sm rounded-lg border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleAddComment}
                  disabled={!commentText.trim() || submittingComment}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  Comment
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function StatusBadge({ pr }: { pr: PullRequest }) {
  if (pr.merged) {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full text-xs font-medium">
        <GitMerge className="w-3 h-3" />
        Merged
      </span>
    );
  }
  if (pr.draft) {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground rounded-full text-xs font-medium">
        <GitPullRequest className="w-3 h-3" />
        Draft
      </span>
    );
  }
  if (pr.state === "open") {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">
        <GitPullRequest className="w-3 h-3" />
        Open
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full text-xs font-medium">
      <GitPullRequest className="w-3 h-3" />
      Closed
    </span>
  );
}

function ReviewItem({ review }: { review: Review }) {
  const getIcon = () => {
    switch (review.state) {
      case "APPROVED":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "CHANGES_REQUESTED":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "COMMENTED":
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
      default:
        return <MinusCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStateText = () => {
    switch (review.state) {
      case "APPROVED":
        return "approved these changes";
      case "CHANGES_REQUESTED":
        return "requested changes";
      case "COMMENTED":
        return "left a comment";
      case "DISMISSED":
        return "review was dismissed";
      default:
        return "reviewed";
    }
  };

  if (!review.user) return null;

  return (
    <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
      <img
        src={review.user.avatar_url}
        alt={review.user.login}
        className="w-8 h-8 rounded-full"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          {getIcon()}
          <span className="font-medium">{review.user.login}</span>
          <span className="text-muted-foreground">{getStateText()}</span>
        </div>
        {review.body && (
          <div className="mt-1 text-sm text-foreground/80">
            <MarkdownContent content={review.body} />
          </div>
        )}
      </div>
    </div>
  );
}

function CheckRunItem({ check }: { check: CheckRun }) {
  const getIcon = () => {
    if (check.status !== "completed") {
      return <Clock className="w-4 h-4 text-yellow-500 animate-pulse" />;
    }
    switch (check.conclusion) {
      case "success":
        return <Check className="w-4 h-4 text-green-500" />;
      case "failure":
        return <X className="w-4 h-4 text-red-500" />;
      case "neutral":
      case "skipped":
        return <MinusCircle className="w-4 h-4 text-muted-foreground" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {getIcon()}
      <span className="flex-1 text-sm">{check.name}</span>
      {check.html_url && (
        <a
          href={check.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

function StatusItem({
  status,
}: {
  status: {
    state: string;
    context: string;
    description: string | null;
    target_url: string | null;
  };
}) {
  const getIcon = () => {
    switch (status.state) {
      case "success":
        return <Check className="w-4 h-4 text-green-500" />;
      case "failure":
      case "error":
        return <X className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500 animate-pulse" />;
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {getIcon()}
      <div className="flex-1 min-w-0">
        <span className="text-sm">{status.context}</span>
        {status.description && (
          <p className="text-xs text-muted-foreground truncate">
            {status.description}
          </p>
        )}
      </div>
      {status.target_url && (
        <a
          href={status.target_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

function CheckStatusIcon({
  status,
}: {
  status: "success" | "failure" | "pending";
}) {
  switch (status) {
    case "success":
      return <Check className="w-4 h-4 text-green-500" />;
    case "failure":
      return <X className="w-4 h-4 text-red-500" />;
    default:
      return <Clock className="w-4 h-4 text-yellow-500" />;
  }
}

function MergeStatusIcon({
  pr,
  checkStatus,
}: {
  pr: PullRequest;
  checkStatus: "success" | "failure" | "pending";
}) {
  if (!canMerge(pr, checkStatus)) {
    return <AlertCircle className="w-5 h-5 text-yellow-500" />;
  }
  return <CheckCircle2 className="w-5 h-5 text-green-500" />;
}

function ConversationComment({ comment }: { comment: IssueComment }) {
  if (!comment.user) return null;

  return (
    <div className="flex items-start gap-3 p-4 bg-card border border-border rounded-lg">
      <img
        src={comment.user.avatar_url}
        alt={comment.user.login}
        className="w-8 h-8 rounded-full"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{comment.user.login}</span>
          <span className="text-muted-foreground text-xs">
            {new Date(comment.created_at).toLocaleDateString()}
          </span>
        </div>
        {comment.body && (
          <div className="mt-2 text-sm text-foreground/90">
            <MarkdownContent content={comment.body} />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function calculateCheckStatus(
  checks: { checkRuns: CheckRun[]; status: CombinedStatus } | null
): "success" | "failure" | "pending" {
  if (!checks) return "success";

  const allChecks = [
    ...checks.checkRuns.map((c) =>
      c.status === "completed" ? c.conclusion : "pending"
    ),
    ...checks.status.statuses.map((s) => s.state),
  ];

  if (allChecks.length === 0) return "success";
  if (allChecks.some((c) => c === "failure" || c === "error")) return "failure";
  if (allChecks.some((c) => c === "pending" || c === null)) return "pending";
  return "success";
}

function getLatestReviewsByUser(reviews: Review[]): Review[] {
  const byUser = new Map<string, Review>();

  // Sort by date ascending so latest overwrites earlier
  const sorted = [...reviews]
    .filter((r) => r.submitted_at && r.user)
    .sort(
      (a, b) =>
        new Date(a.submitted_at!).getTime() -
        new Date(b.submitted_at!).getTime()
    );

  for (const review of sorted) {
    if (
      review.state !== "COMMENTED" &&
      review.state !== "PENDING" &&
      review.user
    ) {
      byUser.set(review.user.login, review);
    }
  }

  // Include all COMMENTED reviews
  const commented = sorted.filter((r) => r.state === "COMMENTED");

  return [...byUser.values(), ...commented];
}

function canMerge(
  pr: PullRequest,
  checkStatus: "success" | "failure" | "pending"
): boolean {
  if (pr.draft) return false;
  if (pr.state !== "open") return false;
  if (pr.mergeable === false) return false;
  // Allow merge even with pending/failed checks (user can decide)
  return true;
}

function getMergeStatusText(
  pr: PullRequest,
  checkStatus: "success" | "failure" | "pending"
): string {
  if (pr.draft) return "This pull request is still a draft";
  if (pr.mergeable === false)
    return "This branch has conflicts that must be resolved";
  if (checkStatus === "failure") return "Some checks have failed";
  if (checkStatus === "pending") return "Some checks are still running";
  return "This pull request is ready to merge";
}

function getMergeButtonText(method: "merge" | "squash" | "rebase"): string {
  switch (method) {
    case "merge":
      return "Merge";
    case "squash":
      return "Squash";
    case "rebase":
      return "Rebase";
  }
}
