import React, {
  useState,
  useEffect,
  useCallback,
  memo,
  useMemo,
  useRef,
} from "react";
import {
  Loader2,
  GitPullRequest,
  GitMerge,
  ExternalLink,
  MessageSquare,
  Check,
  CheckCircle2,
  XCircle,
  MinusCircle,
  AlertCircle,
  ChevronDown,
  Clock,
  GitCommit,
  Copy,
  Settings,
  Circle,
  Eye,
  Smile,
  X,
  Plus,
  User,
  Tag,
  Milestone,
  Link,
  Trash2,
  FileEdit,
  Files,
  Lock,
  Unlock,
  GitBranch,
  UserPlus,
  UserMinus,
  RefreshCw,
} from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../cn";
import { Markdown, MarkdownEditor } from "../ui/markdown";
import { UserHoverCard, UserAvatar } from "../ui/user-hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  usePRReviewSelector,
  usePRReviewStore,
  getTimeAgo,
} from "../contexts/pr-review";
import {
  useGitHub,
  useCurrentUser,
  type Review as GitHubReview,
  type IssueComment as GitHubIssueComment,
  type CheckRun as GitHubCheckRun,
  type CombinedStatus as GitHubCombinedStatus,
  type PRCommit,
  type Reaction,
  type ReactionContent,
  type TimelineEvent,
  type ReviewThread,
  type PullRequest,
} from "../contexts/github";
import { useCanWrite } from "../contexts/auth";
import { useTelemetry } from "../contexts/telemetry";

// ============================================================================
// Types
// ============================================================================

type Review = GitHubReview;
type CheckRun = GitHubCheckRun;
type CombinedStatus = GitHubCombinedStatus;
type IssueComment = GitHubIssueComment;

type TabType = "conversation" | "commits" | "checks";

// ============================================================================
// Main Component
// ============================================================================

export const PROverview = memo(function PROverview() {
  const github = useGitHub();
  const store = usePRReviewStore();
  const canWrite = useCanWrite();
  const { track } = useTelemetry();
  const pr = usePRReviewSelector((s) => s.pr);
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const files = usePRReviewSelector((s) => s.files);
  const currentUser = useCurrentUser()?.login ?? null;

  // Read PR data from store
  const reviews = usePRReviewSelector((s) => s.reviews);
  const reviewThreads = usePRReviewSelector((s) => s.reviewThreads);
  const checks = usePRReviewSelector((s) => s.checks);
  const checksLastUpdated = usePRReviewSelector((s) => s.checksLastUpdated);
  const loadingChecks = usePRReviewSelector((s) => s.loadingChecks);
  const workflowRunsAwaitingApproval = usePRReviewSelector(
    (s) => s.workflowRunsAwaitingApproval
  );
  const approvingWorkflows = usePRReviewSelector((s) => s.approvingWorkflows);
  const timeline = usePRReviewSelector((s) => s.timeline);
  const commits = usePRReviewSelector((s) => s.commits);
  const conversation = usePRReviewSelector((s) => s.conversation);
  const loading = usePRReviewSelector((s) => s.loading);
  const branchDeleted = usePRReviewSelector((s) => s.branchDeleted);

  // Merge state from store
  const merging = usePRReviewSelector((s) => s.merging);
  const mergeMethod = usePRReviewSelector((s) => s.mergeMethod);
  const mergeError = usePRReviewSelector((s) => s.mergeError);

  // Action loading states from store
  const closingPR = usePRReviewSelector((s) => s.closingPR);
  const reopeningPR = usePRReviewSelector((s) => s.reopeningPR);
  const deletingBranch = usePRReviewSelector((s) => s.deletingBranch);
  const restoringBranch = usePRReviewSelector((s) => s.restoringBranch);
  const convertingToDraft = usePRReviewSelector((s) => s.convertingToDraft);
  const markingReady = usePRReviewSelector((s) => s.markingReady);

  // Viewer permissions from store
  const viewerPermission = usePRReviewSelector((s) => s.viewerPermission);
  const viewerCanMergeAsAdmin = usePRReviewSelector(
    (s) => s.viewerCanMergeAsAdmin
  );

  // Local UI state (not in store)
  const [activeTab, setActiveTab] = useState<TabType>("conversation");
  const [showMergeOptions, setShowMergeOptions] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [assigningSelf, setAssigningSelf] = useState(false);
  const [refreshingChecks, setRefreshingChecks] = useState(false);

  // Repo permissions - use GraphQL viewerPermission as primary source
  const isArchived = pr.base?.repo?.archived ?? false;
  // WRITE, MAINTAIN, or ADMIN permissions allow merging
  const canPush =
    viewerPermission === "ADMIN" ||
    viewerPermission === "MAINTAIN" ||
    viewerPermission === "WRITE" ||
    pr.base?.repo?.permissions?.push === true;
  const canMergeRepo = canWrite && canPush && !isArchived;

  // Reviewers and Assignees state
  const [collaborators, setCollaborators] = useState<
    Array<{ login: string; avatar_url: string }>
  >([]);
  const [showReviewersPicker, setShowReviewersPicker] = useState(false);
  const [showAssigneesPicker, setShowAssigneesPicker] = useState(false);
  const [reviewersPickerPosition, setReviewersPickerPosition] = useState({
    top: 0,
    left: 0,
  });
  const [assigneesPickerPosition, setAssigneesPickerPosition] = useState({
    top: 0,
    left: 0,
  });
  const [loadingCollaborators, setLoadingCollaborators] = useState(false);
  const [reviewerSearchQuery, setReviewerSearchQuery] = useState("");
  const [assigneeSearchQuery, setAssigneeSearchQuery] = useState("");
  const reviewersButtonRef = useRef<HTMLButtonElement>(null);
  const assigneesButtonRef = useRef<HTMLButtonElement>(null);
  const reviewerSearchInputRef = useRef<HTMLInputElement>(null);
  const assigneeSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${pr.title} · Pull Request #${pr.number} · Pulldash`;
  }, [pr.title, pr.number]);

  // Scroll to target when overviewScrollTarget changes
  const overviewScrollTarget = usePRReviewSelector(
    (s) => s.overviewScrollTarget
  );
  useEffect(() => {
    if (!overviewScrollTarget) return;

    // Small delay to ensure the element is rendered
    const timer = setTimeout(() => {
      const element = document.getElementById(overviewScrollTarget);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        // Flash highlight effect
        element.classList.add("ring-2", "ring-blue-500/50");
        setTimeout(() => {
          element.classList.remove("ring-2", "ring-blue-500/50");
        }, 2000);
      }
      // Clear the scroll target after scrolling
      store.clearOverviewScrollTarget();
    }, 100);

    return () => clearTimeout(timer);
  }, [overviewScrollTarget, store]);

  // Manual refresh handler
  const handleRefreshChecks = useCallback(async () => {
    setRefreshingChecks(true);
    await store.refreshChecks();
    setRefreshingChecks(false);
  }, [store]);

  // Auto-refresh checks every 30 seconds when PR is open
  useEffect(() => {
    if (pr.state !== "open" || pr.merged) return;

    const interval = setInterval(() => {
      store.refreshChecks();
    }, 30_000);

    return () => clearInterval(interval);
  }, [store, pr.state, pr.merged]);

  const handleMerge = useCallback(async () => {
    const success = await store.mergePR();
    if (success) {
      // Track PR merged
      track("pr_merged", {
        pr_number: pr.number,
        owner,
        repo,
        merge_method: store.getSnapshot().mergeMethod,
      });
    }
  }, [store, track, pr.number, owner, repo]);

  const handleApproveWorkflows = useCallback(async () => {
    await store.approveWorkflows();
  }, [store]);

  const handleAddComment = useCallback(async () => {
    if (!commentText.trim()) return;

    setSubmittingComment(true);
    try {
      const newComment = await github.createPRConversationComment(
        owner,
        repo,
        pr.number,
        commentText
      );
      store.addConversationComment(newComment);
      setCommentText("");
    } catch (error) {
      console.error("Failed to add comment:", error);
    } finally {
      setSubmittingComment(false);
    }
  }, [github, owner, repo, pr.number, commentText, store]);

  const handleUpdateBranch = useCallback(async () => {
    await store.updateBranch();
  }, [store]);

  // Fetch collaborators when picker is opened
  const fetchCollaborators = useCallback(async () => {
    if (collaborators.length > 0) return;
    setLoadingCollaborators(true);
    try {
      const data = await github.getRepoCollaborators(owner, repo);
      setCollaborators(
        data.map((c) => ({
          login: c.login || "",
          avatar_url: c.avatar_url || "",
        }))
      );
    } catch (error) {
      console.error("Failed to fetch collaborators:", error);
    } finally {
      setLoadingCollaborators(false);
    }
  }, [github, owner, repo, collaborators.length]);

  const handleToggleReviewersPicker = useCallback(() => {
    if (!showReviewersPicker && reviewersButtonRef.current) {
      const rect = reviewersButtonRef.current.getBoundingClientRect();
      setReviewersPickerPosition({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 280),
      });
      fetchCollaborators();
      setReviewerSearchQuery("");
      // Focus the search input after a short delay to allow the picker to render
      setTimeout(() => reviewerSearchInputRef.current?.focus(), 50);
    }
    setShowReviewersPicker(!showReviewersPicker);
    setShowAssigneesPicker(false);
  }, [showReviewersPicker, fetchCollaborators]);

  const handleToggleAssigneesPicker = useCallback(() => {
    if (!showAssigneesPicker && assigneesButtonRef.current) {
      const rect = assigneesButtonRef.current.getBoundingClientRect();
      setAssigneesPickerPosition({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 280),
      });
      fetchCollaborators();
      setAssigneeSearchQuery("");
      // Focus the search input after a short delay to allow the picker to render
      setTimeout(() => assigneeSearchInputRef.current?.focus(), 50);
    }
    setShowAssigneesPicker(!showAssigneesPicker);
    setShowReviewersPicker(false);
  }, [showAssigneesPicker, fetchCollaborators]);

  // Helper to refetch PR and update store
  const refetchPR = useCallback(async () => {
    try {
      const updatedPR = await github.getPR(owner, repo, pr.number);
      store.setPr(updatedPR);
    } catch (error) {
      console.error("Failed to refetch PR:", error);
    }
  }, [github, owner, repo, pr.number, store]);

  const handleConvertToDraft = useCallback(async () => {
    await store.convertToDraft();
  }, [store]);

  const handleMarkReadyForReview = useCallback(async () => {
    await store.markReadyForReview();
  }, [store]);

  const handleClosePR = useCallback(async () => {
    // Post comment first if there's one typed (like GitHub does)
    if (commentText.trim()) {
      try {
        const newComment = await github.createPRConversationComment(
          owner,
          repo,
          pr.number,
          commentText
        );
        store.addConversationComment(newComment);
        setCommentText("");
      } catch (error) {
        console.error("Failed to add comment:", error);
      }
    }
    await store.closePR();
  }, [github, owner, repo, pr.number, commentText, store]);

  const handleReopenPR = useCallback(async () => {
    // Post comment first if there's one typed (like GitHub does)
    if (commentText.trim()) {
      try {
        const newComment = await github.createPRConversationComment(
          owner,
          repo,
          pr.number,
          commentText
        );
        store.addConversationComment(newComment);
        setCommentText("");
      } catch (error) {
        console.error("Failed to add comment:", error);
      }
    }
    await store.reopenPR();
  }, [github, owner, repo, pr.number, commentText, store]);

  const handleDeleteBranch = useCallback(async () => {
    if (
      !window.confirm(
        `Are you sure you want to delete the branch "${pr.head.ref}"?`
      )
    ) {
      return;
    }
    await store.deleteBranch();
  }, [store, pr.head.ref]);

  const handleRestoreBranch = useCallback(async () => {
    await store.restoreBranch();
  }, [store]);

  const handleRequestReviewer = useCallback(
    async (login: string) => {
      try {
        await github.requestReviewers(owner, repo, pr.number, [login]);
        await refetchPR();
      } catch (error) {
        console.error("Failed to request reviewer:", error);
      }
    },
    [github, owner, repo, pr.number, refetchPR]
  );

  const handleRemoveReviewer = useCallback(
    async (login: string) => {
      try {
        await github.removeReviewers(owner, repo, pr.number, [login]);
        await refetchPR();
      } catch (error) {
        console.error("Failed to remove reviewer:", error);
      }
    },
    [github, owner, repo, pr.number, refetchPR]
  );

  const handleAddAssignee = useCallback(
    async (login: string) => {
      try {
        await github.addAssignees(owner, repo, pr.number, [login]);
        await refetchPR();
      } catch (error) {
        console.error("Failed to add assignee:", error);
      }
    },
    [github, owner, repo, pr.number, refetchPR]
  );

  const handleRemoveAssignee = useCallback(
    async (login: string) => {
      try {
        await github.removeAssignees(owner, repo, pr.number, [login]);
        await refetchPR();
      } catch (error) {
        console.error("Failed to remove assignee:", error);
      }
    },
    [github, owner, repo, pr.number, refetchPR]
  );

  const handleAssignSelf = useCallback(async () => {
    if (!currentUser) return;
    setAssigningSelf(true);
    try {
      await github.addAssignees(owner, repo, pr.number, [currentUser]);
      await refetchPR();
    } catch (error) {
      console.error("Failed to assign self:", error);
    } finally {
      setAssigningSelf(false);
    }
  }, [github, owner, repo, pr.number, currentUser, refetchPR]);

  // Reaction state - keyed by "issue" for PR body or comment ID
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [loadingReactions, setLoadingReactions] = useState<Set<string>>(
    new Set()
  );

  // Fetch PR body reactions
  useEffect(() => {
    const fetchPRReactions = async () => {
      try {
        const prReactions = await github.getIssueReactions(
          owner,
          repo,
          pr.number
        );
        setReactions((prev) => ({ ...prev, issue: prReactions }));
      } catch (error) {
        console.error("Failed to fetch PR reactions:", error);
      }
    };
    fetchPRReactions();
  }, [github, owner, repo, pr.number]);

  // Fetch comment reactions when conversation loads
  useEffect(() => {
    const fetchCommentReactions = async () => {
      for (const comment of conversation) {
        try {
          const commentReactions = await github.getCommentReactions(
            owner,
            repo,
            comment.id
          );
          setReactions((prev) => ({
            ...prev,
            [`comment-${comment.id}`]: commentReactions,
          }));
        } catch (error) {
          console.error(
            `Failed to fetch reactions for comment ${comment.id}:`,
            error
          );
        }
      }
    };
    if (conversation.length > 0) {
      fetchCommentReactions();
    }
  }, [github, owner, repo, conversation]);

  const handleAddPRReaction = useCallback(
    async (content: ReactionContent) => {
      try {
        const newReaction = await github.addIssueReaction(
          owner,
          repo,
          pr.number,
          content
        );
        setReactions((prev) => ({
          ...prev,
          issue: [...(prev.issue || []), newReaction],
        }));
      } catch (error) {
        console.error("Failed to add reaction:", error);
      }
    },
    [github, owner, repo, pr.number]
  );

  const handleRemovePRReaction = useCallback(
    async (reactionId: number) => {
      try {
        await github.deleteIssueReaction(owner, repo, pr.number, reactionId);
        setReactions((prev) => ({
          ...prev,
          issue: (prev.issue || []).filter((r) => r.id !== reactionId),
        }));
      } catch (error) {
        console.error("Failed to remove reaction:", error);
      }
    },
    [github, owner, repo, pr.number]
  );

  const handleAddCommentReaction = useCallback(
    async (commentId: number, content: ReactionContent) => {
      try {
        const newReaction = await github.addCommentReaction(
          owner,
          repo,
          commentId,
          content
        );
        setReactions((prev) => ({
          ...prev,
          [`comment-${commentId}`]: [
            ...(prev[`comment-${commentId}`] || []),
            newReaction,
          ],
        }));
      } catch (error) {
        console.error("Failed to add reaction:", error);
      }
    },
    [github, owner, repo]
  );

  const handleRemoveCommentReaction = useCallback(
    async (commentId: number, reactionId: number) => {
      try {
        await github.deleteCommentReaction(owner, repo, commentId, reactionId);
        setReactions((prev) => ({
          ...prev,
          [`comment-${commentId}`]: (prev[`comment-${commentId}`] || []).filter(
            (r) => r.id !== reactionId
          ),
        }));
      } catch (error) {
        console.error("Failed to remove reaction:", error);
      }
    },
    [github, owner, repo]
  );

  // Thread actions (reply, resolve, unresolve)
  const handleReplyToThread = useCallback(
    async (threadId: string, commentId: number, body: string) => {
      try {
        await github.createPRComment(owner, repo, pr.number, body, {
          reply_to_id: commentId,
        });
        // Refresh threads to show new comment
        const result = await github.getReviewThreads(owner, repo, pr.number);
        store.setReviewThreads(result.threads);
      } catch (error) {
        console.error("Failed to reply to thread:", error);
      }
    },
    [github, owner, repo, pr.number, store]
  );

  const handleResolveThread = useCallback(
    async (threadId: string) => {
      try {
        await github.resolveThread(threadId);
        // Update local state
        store.updateReviewThread(threadId, (t) => ({ ...t, isResolved: true }));
      } catch (error) {
        console.error("Failed to resolve thread:", error);
      }
    },
    [github, store]
  );

  const handleUnresolveThread = useCallback(
    async (threadId: string) => {
      try {
        await github.unresolveThread(threadId);
        // Update local state
        store.updateReviewThread(threadId, (t) => ({
          ...t,
          isResolved: false,
        }));
      } catch (error) {
        console.error("Failed to unresolve thread:", error);
      }
    },
    [github, store]
  );

  // Calculate check status
  const checkStatus = calculateCheckStatus(
    checks,
    workflowRunsAwaitingApproval
  );
  const latestReviews = getLatestReviewsByUser(reviews);
  const canMergePR = canMerge(pr, checkStatus);

  // Tab counts
  const checksCount = checks
    ? checks.checkRuns.length + checks.status.statuses.length
    : 0;

  // Get unique participants
  const participants = useMemo(() => {
    const users = new Map<string, { login: string; avatar_url: string }>();

    // PR author
    if (pr.user) {
      users.set(pr.user.login, {
        login: pr.user.login,
        avatar_url: pr.user.avatar_url,
      });
    }

    // Reviewers
    reviews.forEach((review) => {
      if (review.user) {
        users.set(review.user.login, {
          login: review.user.login,
          avatar_url: review.user.avatar_url,
        });
      }
    });

    // Commenters
    conversation.forEach((comment) => {
      if (comment.user) {
        users.set(comment.user.login, {
          login: comment.user.login,
          avatar_url: comment.user.avatar_url,
        });
      }
    });

    return Array.from(users.values());
  }, [pr.user, reviews, conversation]);

  if (loading) {
    return <PROverviewSkeleton />;
  }

  return (
    <div className="flex-1 overflow-auto themed-scrollbar bg-background">
      {/* Tabs */}
      <div className="border-b border-border overflow-x-auto">
        <div className="max-w-[1280px] mx-auto px-2 sm:px-6">
          <div className="flex items-center gap-1 py-1">
            <TabButton
              active={activeTab === "conversation"}
              onClick={() => setActiveTab("conversation")}
              icon={<MessageSquare className="w-4 h-4" />}
              label="Conversation"
              count={conversation.length}
            />
            <TabButton
              active={activeTab === "commits"}
              onClick={() => setActiveTab("commits")}
              icon={<GitCommit className="w-4 h-4" />}
              label="Commits"
              count={commits.length}
            />
            <TabButton
              active={activeTab === "checks"}
              onClick={() => setActiveTab("checks")}
              icon={<CheckStatusIcon status={checkStatus} size="sm" />}
              label="Checks"
              count={checksCount}
            />
            <TabButton
              active={false}
              onClick={() => {
                // Navigate to the first file
                if (files.length > 0) {
                  store.selectFile(files[0].filename);
                }
              }}
              icon={<Files className="w-4 h-4" />}
              label="Files Changed"
              count={files.length}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1280px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* Left Column - Main Content */}
          <div className="flex-1 min-w-0 space-y-4 order-2 lg:order-1">
            {activeTab === "conversation" && (
              <>
                {/* PR Description */}
                <CommentBox
                  user={pr.user}
                  createdAt={pr.created_at}
                  body={pr.body}
                  isAuthor
                  reactions={reactions.issue}
                  onAddReaction={canWrite ? handleAddPRReaction : undefined}
                  onRemoveReaction={
                    canWrite ? handleRemovePRReaction : undefined
                  }
                  currentUser={currentUser}
                />

                {/* Timeline - merge comments, reviews, and events by date */}
                <div className="relative">
                  {/* Vertical timeline line - z-0 so content appears above it */}
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-muted-foreground/30 -translate-x-1/2 z-0" />

                  {(() => {
                    // Build unified timeline using GitHub's timeline order as source of truth
                    // Commits are grouped together like GitHub does
                    type CommittedEvent = Extract<
                      TimelineEvent,
                      { sha: string; author: { date: string } }
                    >;
                    type TimelineEntry =
                      | { type: "comment"; data: IssueComment }
                      | {
                          type: "review";
                          data: Review;
                          threads: ReviewThread[];
                        }
                      | { type: "event"; data: TimelineEvent }
                      | { type: "thread"; data: ReviewThread }
                      | { type: "commits"; data: CommittedEvent[] };

                    const entries: TimelineEntry[] = [];

                    // Build lookup maps for enriched data
                    const threadsByReviewId = new Map<number, ReviewThread[]>();
                    const orphanedThreads: ReviewThread[] = [];
                    reviewThreads.forEach((thread) => {
                      const reviewId = thread.pullRequestReview?.databaseId;
                      if (reviewId) {
                        const existing = threadsByReviewId.get(reviewId) || [];
                        existing.push(thread);
                        threadsByReviewId.set(reviewId, existing);
                      } else {
                        orphanedThreads.push(thread);
                      }
                    });

                    const commentsById = new Map(
                      conversation.map((c) => [c.id, c])
                    );
                    const reviewsById = new Map(reviews.map((r) => [r.id, r]));
                    const usedReviewIds = new Set<number>();

                    // Collect consecutive commits to group them
                    let pendingCommits: CommittedEvent[] = [];
                    const flushCommits = () => {
                      if (pendingCommits.length > 0) {
                        entries.push({ type: "commits", data: pendingCommits });
                        pendingCommits = [];
                      }
                    };

                    // Process timeline in GitHub's order
                    timeline.forEach((event) => {
                      // timeline-committed-event (has sha + author)
                      if ("sha" in event && "author" in event) {
                        pendingCommits.push(event);
                        return;
                      }

                      // Flush any pending commits before adding other events
                      flushCommits();

                      if (!("event" in event)) return;
                      const eventType = event.event;

                      // Skip closed event when PR was merged (redundant with merge)
                      if (eventType === "closed" && pr.merged) return;

                      // Handle "commented" - look up enriched comment data
                      if (eventType === "commented" && "id" in event) {
                        const comment = commentsById.get(
                          event.id as unknown as number
                        );
                        if (comment) {
                          entries.push({ type: "comment", data: comment });
                        }
                        return;
                      }

                      // Handle "reviewed" - look up enriched review data with threads
                      if (eventType === "reviewed" && "id" in event) {
                        const review = reviewsById.get(
                          event.id as unknown as number
                        );
                        if (review) {
                          const hasThreads =
                            (threadsByReviewId.get(review.id)?.length ?? 0) > 0;
                          // Show APPROVED/CHANGES_REQUESTED always, COMMENTED only if they have a body OR threads
                          if (
                            review.body ||
                            review.state === "APPROVED" ||
                            review.state === "CHANGES_REQUESTED" ||
                            hasThreads
                          ) {
                            entries.push({
                              type: "review",
                              data: review,
                              threads: threadsByReviewId.get(review.id) || [],
                            });
                            usedReviewIds.add(review.id);
                          }
                        }
                        return;
                      }

                      // Skip line-commented (shown inline in reviews)
                      if (eventType === "line-commented") return;

                      // All other events
                      entries.push({ type: "event", data: event });
                    });

                    // Flush any remaining commits
                    flushCommits();

                    // Add any orphaned threads that weren't part of a review
                    orphanedThreads.forEach((thread) => {
                      if (thread.comments.nodes[0]) {
                        entries.push({ type: "thread", data: thread });
                      }
                    });

                    return entries.map((entry, index) => {
                      if (entry.type === "comment") {
                        const comment = entry.data;
                        return (
                          <CommentBox
                            key={`comment-${comment.id}`}
                            id={`issuecomment-${comment.id}`}
                            user={comment.user}
                            createdAt={comment.created_at}
                            body={comment.body ?? null}
                            reactions={reactions[`comment-${comment.id}`]}
                            onAddReaction={
                              canWrite
                                ? (content) =>
                                    handleAddCommentReaction(
                                      comment.id,
                                      content
                                    )
                                : undefined
                            }
                            onRemoveReaction={
                              canWrite
                                ? (reactionId) =>
                                    handleRemoveCommentReaction(
                                      comment.id,
                                      reactionId
                                    )
                                : undefined
                            }
                            currentUser={currentUser}
                          />
                        );
                      }
                      if (entry.type === "review") {
                        return (
                          <div key={`review-${entry.data.id}`}>
                            <ReviewBox review={entry.data} />
                            {/* Render associated threads under the review */}
                            {entry.threads.map((thread) => (
                              <ReviewThreadBox
                                key={`thread-${thread.id}`}
                                thread={thread}
                                owner={owner}
                                repo={repo}
                                onReply={handleReplyToThread}
                                onResolve={handleResolveThread}
                                onUnresolve={handleUnresolveThread}
                                canWrite={canWrite}
                                currentUser={currentUser}
                              />
                            ))}
                          </div>
                        );
                      }
                      if (entry.type === "event") {
                        return (
                          <TimelineItem
                            key={`event-${index}`}
                            event={entry.data}
                            pr={pr}
                          />
                        );
                      }
                      if (entry.type === "commits") {
                        return (
                          <CommitGroup
                            key={`commits-${index}`}
                            commits={entry.data}
                            prCommits={commits}
                            owner={owner}
                            repo={repo}
                          />
                        );
                      }
                      if (entry.type === "thread") {
                        // Orphaned thread (no associated review)
                        return (
                          <ReviewThreadBox
                            key={`thread-${entry.data.id}`}
                            thread={entry.data}
                            owner={owner}
                            repo={repo}
                            onReply={handleReplyToThread}
                            onResolve={handleResolveThread}
                            onUnresolve={handleUnresolveThread}
                            canWrite={canWrite}
                            currentUser={currentUser}
                          />
                        );
                      }
                      return null;
                    });
                  })()}
                </div>

                {/* Archived repo notice */}
                {isArchived && pr.state === "open" && !pr.merged && (
                  <div className="flex items-center gap-2 py-3 px-4 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                    <Lock className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm text-yellow-200">
                      This repository has been archived. No changes can be made.
                    </span>
                  </div>
                )}

                {/* Merge Section - show to all users for open PRs */}
                {pr.state === "open" && !pr.merged && (
                  <>
                    <MergeSection
                      pr={pr}
                      checkStatus={checkStatus}
                      checks={checks}
                      canMerge={canMergePR}
                      canMergeRepo={canMergeRepo}
                      merging={merging}
                      mergeMethod={mergeMethod}
                      showMergeOptions={showMergeOptions}
                      mergeError={mergeError}
                      latestReviews={latestReviews}
                      onMerge={handleMerge}
                      onSetMergeMethod={store.setMergeMethod}
                      onToggleMergeOptions={() =>
                        setShowMergeOptions(!showMergeOptions)
                      }
                      onUpdateBranch={handleUpdateBranch}
                      markingReady={markingReady}
                      onMarkReadyForReview={handleMarkReadyForReview}
                      workflowRunsAwaitingApproval={
                        workflowRunsAwaitingApproval
                      }
                      approvingWorkflows={approvingWorkflows}
                      onApproveWorkflows={handleApproveWorkflows}
                      canBypassBranchProtections={viewerCanMergeAsAdmin}
                    />
                    {/* Still in progress - only show if NOT a draft and user can merge */}
                    {canMergeRepo && !pr.draft && (
                      <div className="flex justify-end">
                        <p className="text-sm text-muted-foreground">
                          Still in progress?{" "}
                          <button
                            onClick={handleConvertToDraft}
                            disabled={convertingToDraft}
                            className="text-blue-400 hover:underline disabled:opacity-50"
                          >
                            {convertingToDraft
                              ? "Converting..."
                              : "Convert to draft"}
                          </button>
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Successfully merged and closed - show for merged PRs */}
                {pr.merged &&
                  (() => {
                    // Check if the head branch is from a fork (different repo than base)
                    const isFromFork =
                      pr.head.repo?.full_name !== pr.base.repo?.full_name;
                    return (
                      <div className="border border-purple-500/30 rounded-md overflow-hidden bg-purple-500/10">
                        <div className="flex items-start gap-3 p-4">
                          <div className="p-2 rounded-full bg-purple-500/20 text-purple-400">
                            <GitMerge className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold">
                              Pull request successfully merged and closed
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              {isFromFork ? (
                                <>
                                  The{" "}
                                  <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs">
                                    {pr.head.label || pr.head.ref}
                                  </code>{" "}
                                  branch is in a fork and cannot be deleted from
                                  here.
                                </>
                              ) : (
                                <>
                                  You're all set — the{" "}
                                  <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs">
                                    {pr.head.label || pr.head.ref}
                                  </code>{" "}
                                  branch can be safely deleted.
                                </>
                              )}
                            </p>
                          </div>
                          {canMergeRepo && !branchDeleted && !isFromFork && (
                            <button
                              onClick={handleDeleteBranch}
                              disabled={deletingBranch}
                              className="shrink-0 px-4 py-2 border border-border text-sm font-medium rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
                            >
                              {deletingBranch ? (
                                <span className="flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Deleting...
                                </span>
                              ) : (
                                "Delete branch"
                              )}
                            </button>
                          )}
                          {branchDeleted && !isFromFork && (
                            <div className="shrink-0 flex items-center gap-3">
                              <span className="text-sm text-muted-foreground flex items-center gap-2">
                                <Check className="w-4 h-4 text-green-400" />
                                Deleted{" "}
                                <code className="px-1.5 py-0.5 bg-muted rounded text-xs">
                                  {pr.head.ref}
                                </code>
                              </span>
                              {canMergeRepo && (
                                <button
                                  onClick={handleRestoreBranch}
                                  disabled={restoringBranch}
                                  className="px-3 py-1.5 border border-border text-sm font-medium rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
                                >
                                  {restoringBranch ? (
                                    <span className="flex items-center gap-2">
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      Restoring...
                                    </span>
                                  ) : (
                                    "Restore branch"
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                {/* Closed with unmerged commits - show for closed, unmerged PRs */}
                {pr.state === "closed" && !pr.merged && (
                  <div className="border border-border rounded-md overflow-hidden">
                    <div className="flex items-start gap-3 p-4 bg-card/30">
                      <div className="p-2 rounded-full bg-purple-500/10 text-purple-400">
                        <GitBranch className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold">
                          Closed with unmerged commits
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          This pull request is closed, but the{" "}
                          <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs">
                            {pr.head.ref}
                          </code>{" "}
                          branch has unmerged commits.
                        </p>
                      </div>
                      {canMergeRepo && !branchDeleted && (
                        <button
                          onClick={handleDeleteBranch}
                          disabled={deletingBranch}
                          className="shrink-0 px-4 py-2 border border-border text-sm font-medium rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
                        >
                          {deletingBranch ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Deleting...
                            </span>
                          ) : (
                            "Delete branch"
                          )}
                        </button>
                      )}
                      {branchDeleted && (
                        <div className="shrink-0 flex items-center gap-3">
                          <span className="text-sm text-muted-foreground flex items-center gap-2">
                            <Check className="w-4 h-4 text-green-400" />
                            Deleted{" "}
                            <code className="px-1.5 py-0.5 bg-muted rounded text-xs">
                              {pr.head.ref}
                            </code>
                          </span>
                          {canMergeRepo && (
                            <button
                              onClick={handleRestoreBranch}
                              disabled={restoringBranch}
                              className="px-3 py-1.5 border border-border text-sm font-medium rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
                            >
                              {restoringBranch ? (
                                <span className="flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Restoring...
                                </span>
                              ) : (
                                "Restore branch"
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {canMergeRepo && (
                      <div className="px-4 py-3 border-t border-border bg-card/10 flex items-center justify-end">
                        <button
                          onClick={handleReopenPR}
                          disabled={reopeningPR}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                        >
                          {reopeningPR ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <GitPullRequest className="w-4 h-4" />
                          )}
                          {reopeningPR ? "Reopening..." : "Reopen pull request"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Add a comment - only show when user can write (comments allowed even without push) */}
                {canWrite ? (
                  <div className="flex gap-3">
                    {/* Avatar */}
                    {currentUser && (
                      <img
                        src={`https://github.com/${currentUser}.png`}
                        alt={currentUser}
                        className="w-10 h-10 rounded-full shrink-0"
                      />
                    )}
                    <div className="flex-1 flex flex-col gap-2">
                      <MarkdownEditor
                        value={commentText}
                        onChange={setCommentText}
                        placeholder="Add your comment here..."
                        minHeight="100px"
                      />
                      <div className="flex items-center justify-end gap-2">
                        {canMergeRepo && pr.state === "open" && !pr.merged && (
                          <button
                            onClick={handleClosePR}
                            disabled={closingPR}
                            className="flex items-center gap-2 px-3 py-1.5 border border-red-500/50 text-red-400 rounded-md hover:bg-red-500/10 transition-colors text-sm font-medium disabled:opacity-50"
                          >
                            {closingPR ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <GitPullRequest className="w-4 h-4" />
                            )}
                            {closingPR ? "Closing..." : "Close pull request"}
                          </button>
                        )}
                        <button
                          onClick={handleAddComment}
                          disabled={!commentText.trim() || submittingComment}
                          className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 text-sm font-medium"
                        >
                          {submittingComment ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : null}
                          Comment
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-3 px-4 bg-amber-500/10 border border-amber-500/20 rounded-md">
                    <MessageSquare className="w-4 h-4 text-amber-500" />
                    <span className="text-sm text-amber-200">
                      Sign in to leave comments
                    </span>
                  </div>
                )}
              </>
            )}

            {activeTab === "commits" && (
              <CommitsTab commits={commits} owner={owner} repo={repo} />
            )}

            {activeTab === "checks" && (
              <ChecksTab
                checks={checks}
                lastUpdated={checksLastUpdated}
                onRefresh={handleRefreshChecks}
                refreshing={refreshingChecks}
              />
            )}
          </div>

          {/* Right Column - Sidebar */}
          <div className="w-full lg:w-[296px] shrink-0 space-y-4 order-1 lg:order-2">
            {/* Reviewers */}
            <SidebarSection
              title="Reviewers"
              action={
                canMergeRepo && !pr.merged ? (
                  <button
                    ref={reviewersButtonRef}
                    onClick={handleToggleReviewersPicker}
                    className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
                    title="Request reviewers"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                ) : undefined
              }
            >
              {pr.requested_reviewers && pr.requested_reviewers.length > 0 ? (
                <TooltipProvider delayDuration={200}>
                  <div className="space-y-2">
                    {pr.requested_reviewers.map((reviewer) => (
                      <div
                        key={reviewer.login}
                        className="flex items-center gap-2 group"
                      >
                        <UserHoverCard login={reviewer.login}>
                          <img
                            src={reviewer.avatar_url}
                            alt={reviewer.login}
                            className="w-5 h-5 rounded-full cursor-pointer"
                          />
                        </UserHoverCard>
                        <UserHoverCard login={reviewer.login}>
                          <span className="text-sm flex-1 hover:text-blue-400 hover:underline cursor-pointer">
                            {reviewer.login}
                          </span>
                        </UserHoverCard>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-auto cursor-default">
                              <Clock className="w-3.5 h-3.5 text-yellow-500" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Awaiting review from this user
                          </TooltipContent>
                        </Tooltip>
                        {canMergeRepo && !pr.merged && (
                          <button
                            onClick={() => handleRemoveReviewer(reviewer.login)}
                            className="p-0.5 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove reviewer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </TooltipProvider>
              ) : latestReviews.length > 0 ? (
                <TooltipProvider delayDuration={200}>
                  <div className="space-y-2">
                    {latestReviews.map((review) => (
                      <div key={review.id} className="flex items-center gap-2">
                        {review.user && (
                          <UserHoverCard login={review.user.login}>
                            <img
                              src={review.user.avatar_url}
                              alt={review.user.login}
                              className="w-5 h-5 rounded-full cursor-pointer"
                            />
                          </UserHoverCard>
                        )}
                        {review.user && (
                          <UserHoverCard login={review.user.login}>
                            <span className="text-sm hover:text-blue-400 hover:underline cursor-pointer">
                              {review.user.login}
                            </span>
                          </UserHoverCard>
                        )}
                        <ReviewStateIcon state={review.state} showTooltip />
                      </div>
                    ))}
                  </div>
                </TooltipProvider>
              ) : (
                <span className="text-sm text-muted-foreground">
                  No reviews yet
                </span>
              )}
              {pr.state === "open" && !pr.merged && (
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    {latestReviews.some((r) => r.state === "APPROVED")
                      ? "This pull request has been approved."
                      : "At least 1 approving review is required to merge this pull request."}
                  </p>
                </div>
              )}
            </SidebarSection>

            {/* Reviewers Picker */}
            {showReviewersPicker && (
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={() => setShowReviewersPicker(false)}
                />
                <div
                  className="fixed w-[260px] bg-card border border-border rounded-md shadow-xl z-[101] overflow-hidden"
                  style={{
                    top: reviewersPickerPosition.top,
                    left: reviewersPickerPosition.left,
                  }}
                >
                  <div className="px-3 py-2 border-b border-border space-y-2">
                    <p className="text-sm font-medium">Request reviewers</p>
                    <input
                      ref={reviewerSearchInputRef}
                      type="text"
                      placeholder="Search users..."
                      value={reviewerSearchQuery}
                      onChange={(e) => setReviewerSearchQuery(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    {loadingCollaborators ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      </div>
                    ) : (
                      collaborators
                        .filter(
                          (c) =>
                            c.login !== pr.user?.login &&
                            !pr.requested_reviewers?.some(
                              (r) => r.login === c.login
                            ) &&
                            c.login
                              .toLowerCase()
                              .includes(reviewerSearchQuery.toLowerCase())
                        )
                        .map((collaborator) => (
                          <button
                            key={collaborator.login}
                            onClick={() => {
                              handleRequestReviewer(collaborator.login);
                              setShowReviewersPicker(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted transition-colors text-left"
                          >
                            <img
                              src={collaborator.avatar_url}
                              alt={collaborator.login}
                              className="w-5 h-5 rounded-full"
                            />
                            <span className="text-sm">
                              {collaborator.login}
                            </span>
                          </button>
                        ))
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Assignees */}
            <SidebarSection
              title="Assignees"
              action={
                canMergeRepo && !pr.merged ? (
                  <button
                    ref={assigneesButtonRef}
                    onClick={handleToggleAssigneesPicker}
                    className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
                    title="Edit assignees"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                ) : undefined
              }
            >
              {pr.assignees && pr.assignees.length > 0 ? (
                <div className="space-y-2">
                  {pr.assignees.map((assignee) => (
                    <div
                      key={assignee.login}
                      className="flex items-center gap-2 group"
                    >
                      <UserHoverCard login={assignee.login}>
                        <img
                          src={assignee.avatar_url}
                          alt={assignee.login}
                          className="w-5 h-5 rounded-full cursor-pointer"
                        />
                      </UserHoverCard>
                      <UserHoverCard login={assignee.login}>
                        <span className="text-sm flex-1 hover:text-blue-400 hover:underline cursor-pointer">
                          {assignee.login}
                        </span>
                      </UserHoverCard>
                      {canMergeRepo && !pr.merged && (
                        <button
                          onClick={() => handleRemoveAssignee(assignee.login)}
                          className="p-0.5 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove assignee"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  No one—
                  {canMergeRepo && !pr.merged ? (
                    <button
                      onClick={handleAssignSelf}
                      disabled={assigningSelf}
                      className="text-blue-400 hover:underline disabled:opacity-50"
                    >
                      {assigningSelf ? "assigning..." : "assign yourself"}
                    </button>
                  ) : null}
                </span>
              )}
            </SidebarSection>

            {/* Assignees Picker */}
            {showAssigneesPicker && (
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={() => setShowAssigneesPicker(false)}
                />
                <div
                  className="fixed w-[260px] bg-card border border-border rounded-md shadow-xl z-[101] overflow-hidden"
                  style={{
                    top: assigneesPickerPosition.top,
                    left: assigneesPickerPosition.left,
                  }}
                >
                  <div className="px-3 py-2 border-b border-border space-y-2">
                    <p className="text-sm font-medium">Assign people</p>
                    <input
                      ref={assigneeSearchInputRef}
                      type="text"
                      placeholder="Search users..."
                      value={assigneeSearchQuery}
                      onChange={(e) => setAssigneeSearchQuery(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    {loadingCollaborators ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      </div>
                    ) : (
                      collaborators
                        .filter(
                          (c) =>
                            !pr.assignees?.some((a) => a.login === c.login) &&
                            c.login
                              .toLowerCase()
                              .includes(assigneeSearchQuery.toLowerCase())
                        )
                        .map((collaborator) => (
                          <button
                            key={collaborator.login}
                            onClick={() => {
                              handleAddAssignee(collaborator.login);
                              setShowAssigneesPicker(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted transition-colors text-left"
                          >
                            <img
                              src={collaborator.avatar_url}
                              alt={collaborator.login}
                              className="w-5 h-5 rounded-full"
                            />
                            <span className="text-sm">
                              {collaborator.login}
                            </span>
                          </button>
                        ))
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Labels */}
            <LabelsSection
              pr={pr}
              owner={owner}
              repo={repo}
              onUpdate={refetchPR}
              canWrite={canMergeRepo}
            />

            {/* Participants */}
            <SidebarSection
              title={`${participants.length} participant${participants.length !== 1 ? "s" : ""}`}
            >
              <div className="flex items-center gap-1 flex-wrap">
                {participants.map((user) => (
                  <UserHoverCard key={user.login} login={user.login}>
                    <img
                      src={user.avatar_url}
                      alt={user.login}
                      className="w-6 h-6 rounded-full cursor-pointer ring-1 ring-transparent hover:ring-border transition-all"
                    />
                  </UserHoverCard>
                ))}
              </div>
            </SidebarSection>

            {/* Actions */}
            <div className="pt-2 border-t border-border space-y-2">
              <a
                href={`https://github.com/${owner}/${repo}/pull/${pr.number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-blue-400"
              >
                <ExternalLink className="w-4 h-4" />
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Tab Button Component
// ============================================================================

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  extra,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  extra?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
        active
          ? "border-orange-500 text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
      )}
    >
      {icon}
      <span className="hidden xs:inline sm:inline">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "px-1.5 py-0.5 text-xs rounded-full",
            active ? "bg-muted" : "bg-muted/50"
          )}
        >
          {count}
        </span>
      )}
      {extra}
    </button>
  );
}

// ============================================================================
// Sidebar Section Component
// ============================================================================

function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-3 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// Labels Section Component
// ============================================================================

interface LabelsSectionProps {
  pr: {
    labels: Array<{ name: string; color: string }>;
    state: string;
    merged?: boolean;
    number: number;
  };
  owner: string;
  repo: string;
  onUpdate: () => Promise<void>;
  canWrite?: boolean;
}

function LabelsSection({
  pr,
  owner,
  repo,
  onUpdate,
  canWrite = true,
}: LabelsSectionProps) {
  const github = useGitHub();
  const [showPicker, setShowPicker] = useState(false);
  const [repoLabels, setRepoLabels] = useState<
    Array<{ name: string; color: string; description?: string | null }>
  >([]);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchLabels = useCallback(async () => {
    if (repoLabels.length > 0) return;
    setLoadingLabels(true);
    try {
      const labels = await github.getRepoLabels(owner, repo);
      setRepoLabels(labels);
    } catch (error) {
      console.error("Failed to fetch labels:", error);
    } finally {
      setLoadingLabels(false);
    }
  }, [github, owner, repo, repoLabels.length]);

  const handleTogglePicker = useCallback(() => {
    if (!showPicker && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPickerPosition({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 280),
      });
      fetchLabels();
    }
    setShowPicker(!showPicker);
  }, [showPicker, fetchLabels]);

  const handleToggleLabel = useCallback(
    async (labelName: string) => {
      try {
        const hasLabel = pr.labels.some((l) => l.name === labelName);
        if (hasLabel) {
          await github.removeLabel(owner, repo, pr.number, labelName);
        } else {
          await github.addLabels(owner, repo, pr.number, [labelName]);
        }
        await onUpdate();
      } catch (error) {
        console.error("Failed to toggle label:", error);
      }
    },
    [github, owner, repo, pr.number, pr.labels, onUpdate]
  );

  const canEdit = canWrite && pr.state === "open" && !pr.merged;

  return (
    <SidebarSection
      title="Labels"
      action={
        canEdit ? (
          <button
            ref={buttonRef}
            onClick={handleTogglePicker}
            className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
            title="Edit labels"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        ) : undefined
      }
    >
      {pr.labels.length > 0 ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {pr.labels.map((label) => (
            <span
              key={label.name}
              className="px-2 py-0.5 text-xs font-medium rounded-full"
              style={{
                backgroundColor: `#${label.color}20`,
                color: `#${label.color}`,
                border: `1px solid #${label.color}40`,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">None yet</span>
      )}

      {/* Labels Picker */}
      {showPicker && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setShowPicker(false)}
          />
          <div
            className="fixed w-[260px] bg-card border border-border rounded-md shadow-xl z-[101] overflow-hidden"
            style={{ top: pickerPosition.top, left: pickerPosition.left }}
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-medium">Apply labels</p>
            </div>
            <div className="max-h-[300px] overflow-auto">
              {loadingLabels ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                </div>
              ) : (
                repoLabels.map((label) => {
                  const isApplied = pr.labels.some(
                    (l) => l.name === label.name
                  );
                  return (
                    <button
                      key={label.name}
                      onClick={() => handleToggleLabel(label.name)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted transition-colors text-left"
                    >
                      <div className="w-4 h-4 flex items-center justify-center">
                        {isApplied && (
                          <Check className="w-3.5 h-3.5 text-green-500" />
                        )}
                      </div>
                      <span
                        className="px-2 py-0.5 text-xs font-medium rounded-full"
                        style={{
                          backgroundColor: `#${label.color}20`,
                          color: `#${label.color}`,
                          border: `1px solid #${label.color}40`,
                        }}
                      >
                        {label.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </SidebarSection>
  );
}

// ============================================================================
// Comment Box Component
// ============================================================================

function CommentBox({
  id,
  user,
  createdAt,
  body,
  isAuthor,
  reactions,
  onAddReaction,
  onRemoveReaction,
  currentUser,
}: {
  id?: string;
  user: { login: string; avatar_url: string } | null;
  createdAt: string;
  body: string | null;
  isAuthor?: boolean;
  reactions?: Reaction[];
  onAddReaction?: (content: ReactionContent) => void;
  onRemoveReaction?: (reactionId: number) => void;
  currentUser?: string | null;
}) {
  if (!user) return null;

  return (
    <div
      id={id}
      className="relative z-10 border border-border rounded-md overflow-hidden bg-card"
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 text-sm border-b border-border bg-card",
          isAuthor && "bg-blue-500/10"
        )}
      >
        <UserHoverCard login={user.login}>
          <img
            src={user.avatar_url}
            alt={user.login}
            className="w-5 h-5 rounded-full cursor-pointer"
          />
        </UserHoverCard>
        <UserHoverCard login={user.login}>
          <span className="font-semibold hover:text-blue-400 hover:underline cursor-pointer">
            {user.login}
          </span>
        </UserHoverCard>
        <span className="text-muted-foreground">
          commented {getTimeAgo(new Date(createdAt))}
        </span>
        {isAuthor && (
          <span className="ml-auto px-1.5 py-0.5 text-xs border border-border rounded text-muted-foreground">
            Author
          </span>
        )}
      </div>
      {/* Body */}
      <div className="p-4 bg-card">
        {body ? (
          <Markdown
            emptyState={
              <p className="text-sm text-muted-foreground italic">
                No description provided.
              </p>
            }
          >
            {body}
          </Markdown>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No description provided.
          </p>
        )}
      </div>
      {/* Reactions */}
      {(reactions || onAddReaction) && (
        <div className="px-4 py-2 border-t border-border bg-card">
          <EmojiReactions
            reactions={reactions || []}
            onAddReaction={onAddReaction}
            onRemoveReaction={onRemoveReaction}
            currentUser={currentUser}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Review Box Component
// ============================================================================

function ReviewBox({ review }: { review: Review }) {
  if (!review.user) return null;

  const stateText =
    {
      APPROVED: "approved these changes",
      CHANGES_REQUESTED: "requested changes",
      COMMENTED: "reviewed",
      DISMISSED: "dismissed review",
      PENDING: "started a review",
    }[review.state] || "reviewed";

  // Icon color for timeline circle
  const iconColor =
    {
      APPROVED: "text-green-500",
      CHANGES_REQUESTED: "text-red-500",
      COMMENTED: "text-muted-foreground",
      DISMISSED: "text-muted-foreground",
      PENDING: "text-yellow-500",
    }[review.state] || "text-muted-foreground";

  // Border color for comment box
  const stateBorder =
    {
      APPROVED: "border-green-500/30",
      CHANGES_REQUESTED: "border-red-500/30",
      COMMENTED: "",
      DISMISSED: "",
      PENDING: "border-yellow-500/30",
    }[review.state] || "";

  // Header background for comment box
  const stateHeaderBg =
    {
      APPROVED: "bg-green-500/10",
      CHANGES_REQUESTED: "bg-red-500/10",
      COMMENTED: "",
      DISMISSED: "",
      PENDING: "bg-yellow-500/10",
    }[review.state] || "";

  return (
    <div id={`pullrequestreview-${review.id}`}>
      {/* Timeline header row - like GitHub's "Username reviewed yesterday" */}
      <div className="flex items-center gap-3 py-1.5 text-sm text-muted-foreground">
        <UserHoverCard login={review.user.login}>
          <img
            src={review.user.avatar_url}
            alt={review.user.login}
            className="w-6 h-6 rounded-full cursor-pointer"
          />
        </UserHoverCard>
        <div
          className={cn(
            "relative z-10 p-1.5 rounded-full bg-background border border-border shrink-0",
            iconColor
          )}
        >
          <ReviewStateIcon state={review.state} />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <UserHoverCard login={review.user.login}>
            <span className="font-semibold text-foreground hover:text-blue-400 hover:underline cursor-pointer">
              {review.user.login}
            </span>
          </UserHoverCard>
          <span>{stateText}</span>
          <span
            title={
              review.submitted_at
                ? new Date(review.submitted_at).toLocaleString()
                : undefined
            }
          >
            {review.submitted_at && getTimeAgo(new Date(review.submitted_at))}
          </span>
        </div>
      </div>

      {/* Comment box - shows if there's a body */}
      {review.body && (
        <div
          className={cn(
            "relative z-10 border rounded-md overflow-hidden bg-card ml-8",
            stateBorder
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm border-b border-border bg-card",
              stateHeaderBg
            )}
          >
            <UserHoverCard login={review.user.login}>
              <img
                src={review.user.avatar_url}
                alt={review.user.login}
                className="w-5 h-5 rounded-full cursor-pointer"
              />
            </UserHoverCard>
            <UserHoverCard login={review.user.login}>
              <span className="font-semibold hover:text-blue-400 hover:underline cursor-pointer">
                {review.user.login}
              </span>
            </UserHoverCard>
            <span className="text-muted-foreground">left a comment</span>
            <span className="flex-1" />
            {review.html_url && (
              <a
                href={review.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline text-xs"
              >
                View on GitHub
              </a>
            )}
          </div>
          <div className="p-4 bg-card">
            <Markdown>{review.body}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Review State Icon
// ============================================================================

function ReviewStateIcon({
  state,
  showTooltip = false,
}: {
  state: string;
  showTooltip?: boolean;
}) {
  const getIconAndTooltip = () => {
    switch (state) {
      case "APPROVED":
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
          tooltip: "Approved this pull request",
        };
      case "CHANGES_REQUESTED":
        return {
          icon: <XCircle className="w-4 h-4 text-red-500" />,
          tooltip: "Requested changes to this pull request",
        };
      case "COMMENTED":
        return {
          icon: <Eye className="w-4 h-4" />,
          tooltip: "Left review comments",
        };
      case "DISMISSED":
        return {
          icon: <MinusCircle className="w-4 h-4 text-muted-foreground" />,
          tooltip: "Review was dismissed",
        };
      default:
        return {
          icon: <Circle className="w-4 h-4 text-muted-foreground" />,
          tooltip: "Pending review",
        };
    }
  };

  const { icon, tooltip } = getIconAndTooltip();

  if (!showTooltip) {
    return icon;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="ml-auto cursor-default">{icon}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ============================================================================
// Review Thread Box Component (for inline code comments)
// ============================================================================

function ReviewThreadBox({
  thread,
  owner,
  repo,
  onReply,
  onResolve,
  onUnresolve,
  canWrite,
  currentUser,
}: {
  thread: ReviewThread;
  owner: string;
  repo: string;
  onReply?: (
    threadId: string,
    commentId: number,
    body: string
  ) => Promise<void>;
  onResolve?: (threadId: string) => Promise<void>;
  onUnresolve?: (threadId: string) => Promise<void>;
  canWrite?: boolean;
  currentUser?: string | null;
}) {
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const comments = thread.comments.nodes;
  if (comments.length === 0) return null;

  const firstComment = comments[0];
  const filePath = firstComment.path;
  const diffHunk = firstComment.diffHunk;

  // If resolved and not expanded, show collapsed view
  if (thread.isResolved && !showResolved) {
    return (
      <div className="relative z-10 ml-8 rounded-lg border border-border bg-card overflow-hidden">
        <button
          onClick={() => setShowResolved(true)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
        >
          <span className="font-mono text-muted-foreground">{filePath}</span>
          <span className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4a.5.5 0 01.5.5v3h3a.5.5 0 010 1h-3v3a.5.5 0 01-1 0v-3h-3a.5.5 0 010-1h3v-3A.5.5 0 018 4z" />
              <path
                fillRule="evenodd"
                d="M8 15A7 7 0 108 1a7 7 0 000 14zm0 1A8 8 0 108 0a8 8 0 000 16z"
              />
            </svg>
            Show resolved
          </span>
        </button>
      </div>
    );
  }

  const handleSubmitReply = async () => {
    if (!onReply || submitting || !replyText.trim()) return;
    setSubmitting(true);
    try {
      const lastComment = comments[comments.length - 1];
      await onReply(thread.id, lastComment.databaseId, replyText.trim());
      setReplyText("");
      setShowReplyBox(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmitReply();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setShowReplyBox(false);
      setReplyText("");
    }
  };

  // Parse diff hunk to get line numbers and content
  const parseDiffHunk = (hunk: string | null) => {
    if (!hunk) return [];

    const lines = hunk.split("\n");
    const result: Array<{
      type: "header" | "context" | "addition" | "deletion";
      content: string;
      oldLine?: number;
      newLine?: number;
    }> = [];

    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        result.push({ type: "header", content: line });
      } else if (line.startsWith("+")) {
        result.push({ type: "addition", content: line.slice(1), newLine });
        newLine++;
      } else if (line.startsWith("-")) {
        result.push({ type: "deletion", content: line.slice(1), oldLine });
        oldLine++;
      } else {
        const content = line.startsWith(" ") ? line.slice(1) : line;
        result.push({ type: "context", content, oldLine, newLine });
        oldLine++;
        newLine++;
      }
    }

    return result;
  };

  const diffLines = parseDiffHunk(diffHunk);

  return (
    <div
      className={cn(
        "relative z-10 border rounded-md overflow-hidden ml-8 bg-card", // Indented to show as nested under review
        thread.isResolved ? "border-muted" : "border-border"
      )}
    >
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-card border-b border-border text-sm">
        <a
          href={`https://github.com/${owner}/${repo}/blob/HEAD/${filePath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-muted-foreground hover:text-blue-400 hover:underline"
        >
          {filePath}
        </a>
        {thread.isResolved && (
          <button
            onClick={() => setShowResolved(false)}
            className="ml-auto flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Check className="w-3 h-3" />
            Resolved
            {thread.resolvedBy && <span> by {thread.resolvedBy.login}</span>}
            <span className="border-l border-border pl-2">Hide resolved</span>
          </button>
        )}
      </div>

      {/* Code context (diff hunk) */}
      {diffLines.length > 0 && (
        <div className="bg-[#0d1117] border-b border-border overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <tbody>
              {diffLines.map((line, i) => (
                <tr
                  key={i}
                  className={cn(
                    line.type === "addition" && "bg-green-500/15",
                    line.type === "deletion" && "bg-red-500/15",
                    line.type === "header" && "bg-blue-500/10 text-blue-400"
                  )}
                >
                  {line.type === "header" ? (
                    <td
                      colSpan={3}
                      className="px-2 py-0.5 text-muted-foreground"
                    >
                      {line.content}
                    </td>
                  ) : (
                    <>
                      <td className="w-10 text-right px-2 py-0.5 text-muted-foreground select-none border-r border-border/50">
                        {line.type !== "addition" ? line.oldLine : ""}
                      </td>
                      <td className="w-10 text-right px-2 py-0.5 text-muted-foreground select-none border-r border-border/50">
                        {line.type !== "deletion" ? line.newLine : ""}
                      </td>
                      <td className="px-2 py-0.5 whitespace-pre">
                        <span
                          className={cn(
                            "select-none mr-1",
                            line.type === "addition" && "text-green-400",
                            line.type === "deletion" && "text-red-400"
                          )}
                        >
                          {line.type === "addition"
                            ? "+"
                            : line.type === "deletion"
                              ? "-"
                              : " "}
                        </span>
                        {line.content}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All comments in thread (no nesting - all at same level) */}
      <div>
        {comments.map((comment, idx) => (
          <div
            key={comment.id}
            className={cn(
              "p-4",
              idx < comments.length - 1 && "border-b border-border"
            )}
          >
            <div className="flex items-center gap-2 mb-2 text-sm">
              {comment.author && (
                <>
                  <UserHoverCard login={comment.author.login}>
                    <img
                      src={comment.author.avatarUrl}
                      alt={comment.author.login}
                      className="w-6 h-6 rounded-full cursor-pointer"
                    />
                  </UserHoverCard>
                  <UserHoverCard login={comment.author.login}>
                    <span className="font-semibold hover:text-blue-400 hover:underline cursor-pointer">
                      {comment.author.login}
                    </span>
                  </UserHoverCard>
                </>
              )}
              <span className="text-muted-foreground">
                {getTimeAgo(new Date(comment.createdAt))}
              </span>
            </div>
            <div className="mt-2">
              <Markdown>{comment.body}</Markdown>
            </div>
            {/* Emoji reactions placeholder */}
            <div className="mt-3">
              <button className="inline-flex items-center justify-center w-7 h-7 text-xs rounded-full border border-border hover:border-blue-500/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                <Smile className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Reply box and actions */}
      {canWrite && (
        <div className="p-4 bg-card/30 border-t border-border">
          {showReplyBox ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                {currentUser && (
                  <img
                    src={`https://github.com/${currentUser}.png`}
                    alt={currentUser}
                    className="w-6 h-6 rounded-full shrink-0 mt-1"
                  />
                )}
                <div className="flex-1">
                  <MarkdownEditor
                    value={replyText}
                    onChange={setReplyText}
                    onKeyDown={handleKeyDown}
                    placeholder="Write a reply..."
                    minHeight="80px"
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {!thread.isResolved && (
                    <button
                      onClick={async () => {
                        if (!onResolve || resolving) return;
                        setResolving(true);
                        try {
                          await onResolve(thread.id);
                        } finally {
                          setResolving(false);
                        }
                      }}
                      disabled={resolving}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50"
                    >
                      {resolving ? "..." : "Resolve conversation"}
                    </button>
                  )}
                  {thread.isResolved && (
                    <button
                      onClick={async () => {
                        if (!onUnresolve || resolving) return;
                        setResolving(true);
                        try {
                          await onUnresolve(thread.id);
                        } finally {
                          setResolving(false);
                        }
                      }}
                      disabled={resolving}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50"
                    >
                      {resolving ? "..." : "Unresolve"}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setShowReplyBox(false);
                      setReplyText("");
                    }}
                    className="px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitReply}
                    disabled={!replyText.trim() || submitting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {submitting ? "Sending..." : "Reply"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {currentUser && (
                <img
                  src={`https://github.com/${currentUser}.png`}
                  alt={currentUser}
                  className="w-6 h-6 rounded-full shrink-0"
                />
              )}
              <button
                onClick={() => setShowReplyBox(true)}
                className="flex-1 text-left px-3 py-2 text-sm text-muted-foreground bg-background border border-border rounded-md hover:border-blue-500/50 transition-colors"
              >
                Reply...
              </button>
              {!thread.isResolved ? (
                <button
                  onClick={async () => {
                    if (!onResolve || resolving) return;
                    setResolving(true);
                    try {
                      await onResolve(thread.id);
                    } finally {
                      setResolving(false);
                    }
                  }}
                  disabled={resolving}
                  className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {resolving ? "..." : "Resolve conversation"}
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (!onUnresolve || resolving) return;
                    setResolving(true);
                    try {
                      await onUnresolve(thread.id);
                    } finally {
                      setResolving(false);
                    }
                  }}
                  disabled={resolving}
                  className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {resolving ? "..." : "Unresolve"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Merge Section Component
// ============================================================================

function MergeSection({
  pr,
  checkStatus,
  checks,
  canMerge: canMergePR,
  canMergeRepo,
  merging,
  mergeMethod,
  showMergeOptions,
  mergeError,
  latestReviews,
  onMerge,
  onSetMergeMethod,
  onToggleMergeOptions,
  onUpdateBranch,
  markingReady,
  onMarkReadyForReview,
  workflowRunsAwaitingApproval,
  approvingWorkflows,
  onApproveWorkflows,
  canBypassBranchProtections,
}: {
  pr: {
    draft?: boolean;
    state: string;
    mergeable: boolean | null;
    mergeable_state?: string;
    requested_reviewers?: Array<{ login: string; avatar_url: string }> | null;
  };
  checkStatus: "success" | "failure" | "pending" | "action_required";
  checks: { checkRuns: CheckRun[]; status: CombinedStatus } | null;
  canMerge: boolean;
  canMergeRepo: boolean;
  merging: boolean;
  mergeMethod: "merge" | "squash" | "rebase";
  showMergeOptions: boolean;
  mergeError: string | null;
  latestReviews: Review[];
  onMerge: () => void;
  onSetMergeMethod: (method: "merge" | "squash" | "rebase") => void;
  onToggleMergeOptions: () => void;
  onUpdateBranch: () => void;
  markingReady?: boolean;
  onMarkReadyForReview?: () => void;
  workflowRunsAwaitingApproval?: Array<{
    id: number;
    name: string;
    html_url: string;
  }>;
  approvingWorkflows?: boolean;
  onApproveWorkflows?: () => void;
  canBypassBranchProtections?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});
  const [bypassRules, setBypassRules] = useState(false);
  const [updatingBranch, setUpdatingBranch] = useState(false);
  const [updateBranchError, setUpdateBranchError] = useState<string | null>(
    null
  );
  const [updateBranchSuccess, setUpdateBranchSuccess] = useState(false);

  const handleUpdateBranch = useCallback(async () => {
    setUpdatingBranch(true);
    setUpdateBranchError(null);
    setUpdateBranchSuccess(false);
    try {
      await onUpdateBranch();
      setUpdateBranchSuccess(true);
      // Clear success message after 3 seconds
      setTimeout(() => setUpdateBranchSuccess(false), 3000);
    } catch (error) {
      setUpdateBranchError(
        error instanceof Error ? error.message : "Failed to update branch"
      );
    } finally {
      setUpdatingBranch(false);
    }
  }, [onUpdateBranch]);

  const mergeDescriptions: Record<"merge" | "squash" | "rebase", string> = {
    merge:
      "All commits from this branch will be added to the base branch via a merge commit.",
    squash:
      "The commits will be squashed into a single commit in the base branch.",
    rebase: "The commits will be rebased and added to the base branch.",
  };

  const handleToggleDropdown = useCallback(() => {
    if (!showMergeOptions && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
    onToggleMergeOptions();
  }, [showMergeOptions, onToggleMergeOptions]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Calculate checks info with detailed breakdown
  const totalChecks = checks
    ? checks.checkRuns.length + checks.status.statuses.length
    : 0;
  const successfulChecks = checks
    ? checks.checkRuns.filter((c) => c.conclusion === "success").length +
      checks.status.statuses.filter((s) => s.state === "success").length
    : 0;
  const failedChecks = checks
    ? checks.checkRuns.filter((c) => c.conclusion === "failure").length +
      checks.status.statuses.filter((s) => s.state === "failure").length
    : 0;
  const skippedChecks = checks
    ? checks.checkRuns.filter((c) => c.conclusion === "skipped").length
    : 0;
  const queuedChecks = checks
    ? checks.checkRuns.filter((c) => c.status === "queued").length +
      checks.status.statuses.filter((s) => s.state === "pending").length
    : 0;
  const inProgressChecks = checks
    ? checks.checkRuns.filter((c) => c.status === "in_progress").length
    : 0;
  const pendingChecks = queuedChecks + inProgressChecks;

  // Review info
  const pendingReviewers = pr.requested_reviewers?.length || 0;
  const approvalCount = latestReviews.filter(
    (r) => r.state === "APPROVED"
  ).length;
  const hasApproval = approvalCount > 0;
  const hasChangesRequested = latestReviews.some(
    (r) => r.state === "CHANGES_REQUESTED"
  );
  const changesRequestedCount = latestReviews.filter(
    (r) => r.state === "CHANGES_REQUESTED"
  ).length;

  // Status indicators
  const reviewStatus = hasChangesRequested
    ? "failure"
    : hasApproval
      ? "success"
      : pendingReviewers > 0
        ? "pending"
        : "success";
  const conflictStatus =
    pr.mergeable === false
      ? "failure"
      : pr.mergeable === null
        ? "pending"
        : "success";

  // Overall border color based on status
  const overallStatus =
    conflictStatus === "failure" ||
    checkStatus === "failure" ||
    reviewStatus === "failure"
      ? "failure"
      : conflictStatus === "pending" ||
          checkStatus === "pending" ||
          reviewStatus === "pending"
        ? "pending"
        : "success";

  return (
    <div
      className={cn(
        "border rounded-md overflow-hidden",
        overallStatus === "success"
          ? "border-green-600"
          : overallStatus === "failure"
            ? "border-red-500"
            : "border-yellow-500"
      )}
    >
      {/* Review Section */}
      <div className="border-b border-border">
        <button
          onClick={() => toggleSection("reviews")}
          className="w-full flex items-center gap-3 p-4 hover:bg-card/30 transition-colors"
        >
          {reviewStatus === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          ) : reviewStatus === "failure" ? (
            <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          ) : (
            <Clock className="w-5 h-5 text-yellow-500 shrink-0" />
          )}
          <div className="flex-1 text-left">
            <p className="font-medium text-sm">Changes reviewed</p>
            <p className="text-xs text-muted-foreground">
              {hasChangesRequested
                ? `${changesRequestedCount} reviewer${changesRequestedCount !== 1 ? "s" : ""} requested changes`
                : hasApproval
                  ? `${approvalCount} approving review${approvalCount !== 1 ? "s" : ""} by reviewer${approvalCount !== 1 ? "s" : ""} with write access.`
                  : pendingReviewers > 0
                    ? "Review has been requested on this pull request."
                    : "No reviewers have been requested."}
            </p>
          </div>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground transition-transform",
              expandedSections["reviews"] && "rotate-180"
            )}
          />
        </button>
        {expandedSections["reviews"] && (
          <div className="px-4 pb-4 pt-0 border-t border-border bg-card/20 space-y-1">
            {/* Approval count row */}
            {approvalCount > 0 && (
              <div className="flex items-center gap-2 py-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm">
                  {approvalCount} approval{approvalCount !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            {/* Pending reviews row */}
            {pendingReviewers > 0 && (
              <div className="flex items-center gap-2 py-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  {pendingReviewers} pending review
                  {pendingReviewers !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            {/* Individual reviewers */}
            {latestReviews.length > 0 && (
              <TooltipProvider delayDuration={200}>
                <div className="pt-2 border-t border-border/50">
                  {latestReviews.map((review) => (
                    <div
                      key={review.id}
                      className="flex items-center gap-2 py-2"
                    >
                      <img
                        src={review.user?.avatar_url}
                        alt={review.user?.login}
                        className="w-5 h-5 rounded-full"
                      />
                      <span className="text-sm">
                        {review.user?.login ?? ""}
                      </span>
                      <ReviewStateIcon state={review.state} showTooltip />
                    </div>
                  ))}
                </div>
              </TooltipProvider>
            )}
          </div>
        )}
      </div>

      {/* Workflow Approval Section - shows when fork PR needs workflow approval */}
      {workflowRunsAwaitingApproval &&
        workflowRunsAwaitingApproval.length > 0 && (
          <div className="border-b border-border">
            <div className="flex items-center gap-3 p-4">
              <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm">
                  {workflowRunsAwaitingApproval.length} workflow
                  {workflowRunsAwaitingApproval.length !== 1 ? "s" : ""}{" "}
                  awaiting approval
                </p>
                <p className="text-xs text-muted-foreground">
                  This workflow requires approval from a maintainer.{" "}
                  <a
                    href="https://docs.github.com/en/actions/managing-workflow-runs/approving-workflow-runs-from-public-forks"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    Learn more about approving workflows.
                  </a>
                </p>
              </div>
              {onApproveWorkflows && (
                <button
                  onClick={onApproveWorkflows}
                  disabled={approvingWorkflows}
                  className="px-3 py-1.5 text-sm font-medium border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {approvingWorkflows ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Approve workflows to run"
                  )}
                </button>
              )}
            </div>
          </div>
        )}

      {/* Checks Section */}
      <div className="border-b border-border">
        <button
          onClick={() => toggleSection("checks")}
          className="w-full flex items-center gap-3 p-4 hover:bg-card/30 transition-colors"
        >
          {checkStatus === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          ) : checkStatus === "failure" ? (
            <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          ) : checkStatus === "action_required" ? (
            <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />
          ) : (
            <Clock className="w-5 h-5 text-yellow-500 shrink-0" />
          )}
          <div className="flex-1 text-left">
            <p className="font-medium text-sm">
              {checkStatus === "success"
                ? "All checks have passed"
                : checkStatus === "failure"
                  ? "Some checks have failed"
                  : checkStatus === "action_required"
                    ? "Workflow approval required"
                    : "Some checks haven't completed yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {checkStatus === "action_required" && totalChecks === 0
                ? "Approve workflows to run checks"
                : [
                    queuedChecks > 0 && `${queuedChecks} queued`,
                    skippedChecks > 0 && `${skippedChecks} skipped`,
                    successfulChecks > 0 && `${successfulChecks} successful`,
                    failedChecks > 0 && `${failedChecks} failed`,
                    inProgressChecks > 0 && `${inProgressChecks} in progress`,
                  ]
                    .filter(Boolean)
                    .join(", ") +
                  " " +
                  (totalChecks === 1 ? "check" : "checks")}
            </p>
          </div>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground transition-transform",
              expandedSections["checks"] && "rotate-180"
            )}
          />
        </button>
        {expandedSections["checks"] && checks && (
          <div className="px-4 pb-4 pt-0 border-t border-border bg-card/20 max-h-[300px] overflow-auto">
            {checks.checkRuns.map((check) => (
              <div key={check.id} className="flex items-center gap-2 py-2">
                {check.status === "queued" ? (
                  <div className="w-4 h-4 rounded-full border-2 border-yellow-500 shrink-0" />
                ) : check.status === "in_progress" ? (
                  <Loader2 className="w-4 h-4 text-yellow-500 shrink-0 animate-spin" />
                ) : check.conclusion === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                ) : check.conclusion === "failure" ? (
                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                ) : check.conclusion === "skipped" ? (
                  <div className="w-4 h-4 rounded-full border-2 border-muted-foreground shrink-0 flex items-center justify-center">
                    <div className="w-2 h-0.5 bg-muted-foreground" />
                  </div>
                ) : (
                  <Clock className="w-4 h-4 text-yellow-500 shrink-0" />
                )}
                <span className="text-sm truncate flex-1">{check.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {check.status === "queued"
                    ? "Queued"
                    : check.status === "in_progress"
                      ? "In progress"
                      : check.conclusion === "skipped"
                        ? "Skipped"
                        : ""}
                </span>
                {check.html_url && (
                  <a
                    href={check.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline shrink-0"
                  >
                    Details
                  </a>
                )}
              </div>
            ))}
            {checks.status.statuses.map((status) => (
              <div key={status.id} className="flex items-center gap-2 py-2">
                {status.state === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                ) : status.state === "failure" || status.state === "error" ? (
                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                ) : status.state === "pending" ? (
                  <div className="w-4 h-4 rounded-full border-2 border-yellow-500 shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-yellow-500 shrink-0" />
                )}
                <span className="text-sm truncate flex-1">
                  {status.context}
                </span>
                {status.state === "pending" && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    Pending
                  </span>
                )}
                {status.target_url && (
                  <a
                    href={status.target_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline shrink-0"
                  >
                    Details
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conflicts Section */}
      <div className="border-b border-border">
        <div className="flex items-center gap-3 p-4">
          {conflictStatus === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          ) : conflictStatus === "failure" ? (
            <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          ) : (
            <Clock className="w-5 h-5 text-yellow-500 shrink-0" />
          )}
          <div className="flex-1">
            <p className="font-medium text-sm">
              {conflictStatus === "success"
                ? "No conflicts with base branch"
                : conflictStatus === "failure"
                  ? "This branch has conflicts"
                  : "Checking for conflicts..."}
            </p>
            <p className="text-xs text-muted-foreground">
              {updateBranchSuccess ? (
                <span className="text-green-500">
                  Branch updated successfully!
                </span>
              ) : updateBranchError ? (
                <span className="text-red-500">{updateBranchError}</span>
              ) : conflictStatus === "success" ? (
                "Merging can be performed automatically."
              ) : conflictStatus === "failure" ? (
                "Conflicts must be resolved before merging."
              ) : (
                "Checking if this branch can be merged..."
              )}
            </p>
          </div>
          {/* Only show Update branch when the branch is behind the base */}
          {conflictStatus === "success" && pr.mergeable_state === "behind" && (
            <button
              onClick={handleUpdateBranch}
              disabled={updatingBranch}
              className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-md hover:bg-muted transition-colors text-sm font-medium disabled:opacity-50"
            >
              {updatingBranch ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Update branch
                  <ChevronDown className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Draft section - show when PR is a draft */}
      {pr.draft && (
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-full bg-muted text-muted-foreground">
              <GitPullRequest className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">
                This pull request is still a work in progress
              </p>
              <p className="text-xs text-muted-foreground">
                Draft pull requests cannot be merged.
              </p>
            </div>
            {canMergeRepo && onMarkReadyForReview && (
              <button
                onClick={onMarkReadyForReview}
                disabled={markingReady}
                className="px-3 py-1.5 border border-border rounded-md hover:bg-muted transition-colors text-sm font-medium disabled:opacity-50"
              >
                {markingReady ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Ready for review"
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Merge controls - only show when user can merge and PR is not a draft */}
      {canMergeRepo && !pr.draft && (
        <div className="p-4 space-y-3">
          {mergeError && (
            <p className="text-sm text-destructive">{mergeError}</p>
          )}

          {/* Bypass rules checkbox - only show when:
              1. User can bypass branch protections (viewerCanMergeAsAdmin)
              2. AND there are actually unmet requirements (something to bypass) */}
          {canBypassBranchProtections && overallStatus !== "success" && (
            <label className="flex items-start gap-2 cursor-pointer group">
              <Checkbox
                checked={bypassRules}
                onCheckedChange={(checked) => setBypassRules(checked === true)}
                className="mt-0.5"
              />
              <span className="text-sm text-yellow-500 group-hover:text-yellow-400">
                Merge without waiting for requirements to be met (bypass rules)
              </span>
            </label>
          )}

          {/* Merge button with dropdown */}
          <div className="flex items-center gap-0.5">
            {/* Main merge button */}
            <button
              onClick={onMerge}
              disabled={merging || (!canMergePR && !bypassRules)}
              className={cn(
                "flex items-center justify-center gap-2 px-4 py-2 rounded-l-md text-sm font-medium transition-colors",
                canMergePR || bypassRules
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {merging ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>{getMergeButtonText(mergeMethod)}</>
              )}
            </button>

            {/* Dropdown button */}
            <button
              ref={buttonRef}
              onClick={handleToggleDropdown}
              disabled={merging}
              className={cn(
                "px-2 py-2 rounded-r-md text-sm font-medium transition-colors border-l border-green-700",
                canMergePR || bypassRules
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              <ChevronDown
                className={cn(
                  "w-4 h-4 transition-transform",
                  showMergeOptions && "rotate-180"
                )}
              />
            </button>

            {/* Dropdown menu */}
            {showMergeOptions && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={onToggleMergeOptions}
                />
                {/* Menu */}
                <div
                  className="fixed bg-card border border-border rounded-md shadow-xl z-[101] overflow-hidden"
                  style={{
                    top: dropdownPosition.top,
                    left: dropdownPosition.left,
                    width: Math.max(dropdownPosition.width, 280),
                  }}
                >
                  {(["squash", "merge", "rebase"] as const).map((method) => (
                    <button
                      key={method}
                      onClick={() => {
                        onSetMergeMethod(method);
                        onToggleMergeOptions();
                      }}
                      className={cn(
                        "w-full px-4 py-3 text-left hover:bg-muted transition-colors",
                        mergeMethod === method && "bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {mergeMethod === method ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <div className="w-4 h-4" />
                        )}
                        <span className="font-medium text-sm">
                          {getMergeButtonText(method)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground ml-6 mt-0.5">
                        {mergeDescriptions[method]}
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Merge queue info */}
          <p className="text-xs text-muted-foreground">
            This repository uses the{" "}
            <a
              href="https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              merge queue
            </a>{" "}
            for all merges into the main branch.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Commits Tab Component
// ============================================================================

function CommitsTab({
  commits,
  owner,
  repo,
}: {
  commits: PRCommit[];
  owner: string;
  repo: string;
}) {
  return (
    <div className="border border-border rounded-md overflow-hidden divide-y divide-border">
      {commits.map((commit) => (
        <div
          key={commit.sha}
          className="flex items-center gap-3 p-3 hover:bg-card/30"
        >
          <img
            src={commit.author?.avatar_url || commit.committer?.avatar_url}
            alt={commit.commit.author?.name}
            className="w-6 h-6 rounded-full"
          />
          <div className="flex-1 min-w-0">
            <a
              href={`https://github.com/${owner}/${repo}/commit/${commit.sha}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium truncate block hover:text-blue-400"
            >
              {commit.commit.message.split("\n")[0]}
            </a>
            <p className="text-xs text-muted-foreground">
              {commit.commit.author?.name} committed{" "}
              {commit.commit.author?.date &&
                getTimeAgo(new Date(commit.commit.author.date))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-500" />
            <a
              href={`https://github.com/${owner}/${repo}/commit/${commit.sha}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-muted-foreground hover:text-blue-400"
            >
              {commit.sha.slice(0, 7)}
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(commit.sha)}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
              title="Copy commit SHA"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Checks Tab Component
// ============================================================================

function ChecksTab({
  checks,
  lastUpdated,
  onRefresh,
  refreshing,
}: {
  checks: { checkRuns: CheckRun[]; status: CombinedStatus } | null;
  lastUpdated: Date | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (
    !checks ||
    (checks.checkRuns.length === 0 && checks.status.statuses.length === 0)
  ) {
    return (
      <div className="border border-border rounded-md p-8 text-center">
        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <p className="text-muted-foreground">
          No checks configured for this repository
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with refresh */}
      <div className="flex items-center justify-end gap-2">
        {lastUpdated && (
          <span className="text-[10px] text-muted-foreground">
            Updated {getTimeAgo(lastUpdated)}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className={cn(
            "p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground",
            refreshing && "opacity-50"
          )}
          title="Refresh checks (auto-refreshes every 30s)"
        >
          <RefreshCw
            className={cn("w-3.5 h-3.5", refreshing && "animate-spin")}
          />
        </button>
      </div>

      {/* Checks list */}
      <div className="border border-border rounded-md overflow-hidden divide-y divide-border">
        {checks.checkRuns.map((check) => (
          <CheckRunItem key={check.id} check={check} />
        ))}
        {checks.status.statuses.map((status, idx) => (
          <StatusItem key={idx} status={status} />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function CheckRunItem({ check }: { check: CheckRun }) {
  const getIcon = () => {
    if (check.status !== "completed") {
      return <Clock className="w-4 h-4 text-yellow-500 animate-pulse" />;
    }
    switch (check.conclusion) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failure":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <MinusCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 hover:bg-card/30">
      {getIcon()}
      <span className="flex-1 text-sm">{check.name}</span>
      {check.html_url && (
        <a
          href={check.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-400 hover:underline"
        >
          Details
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
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failure":
      case "error":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500 animate-pulse" />;
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 hover:bg-card/30">
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
          className="text-sm text-blue-400 hover:underline"
        >
          Details
        </a>
      )}
    </div>
  );
}

function CheckStatusIcon({
  status,
  size = "md",
}: {
  status: "success" | "failure" | "pending" | "action_required";
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  switch (status) {
    case "success":
      return <CheckCircle2 className={cn(sizeClass, "text-green-500")} />;
    case "failure":
      return <XCircle className={cn(sizeClass, "text-red-500")} />;
    case "action_required":
      return <AlertCircle className={cn(sizeClass, "text-orange-500")} />;
    default:
      return <Clock className={cn(sizeClass, "text-yellow-500")} />;
  }
}

// ============================================================================
// Emoji Reactions Component
// ============================================================================

const REACTION_EMOJIS: Record<ReactionContent, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

const REACTION_ORDER: ReactionContent[] = [
  "+1",
  "-1",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
];

function EmojiReactions({
  reactions,
  onAddReaction,
  onRemoveReaction,
  currentUser,
}: {
  reactions: Reaction[];
  onAddReaction?: (content: ReactionContent) => void;
  onRemoveReaction?: (reactionId: number) => void;
  currentUser?: string | null;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });

  // Group reactions by content
  const groupedReactions = useMemo(() => {
    const groups: Record<
      string,
      { count: number; users: string[]; userReactionId?: number }
    > = {};

    for (const reaction of reactions) {
      const content = reaction.content as ReactionContent;
      if (!groups[content]) {
        groups[content] = { count: 0, users: [] };
      }
      groups[content].count++;
      if (reaction.user?.login) {
        groups[content].users.push(reaction.user.login);
        if (reaction.user.login === currentUser) {
          groups[content].userReactionId = reaction.id;
        }
      }
    }

    return groups;
  }, [reactions, currentUser]);

  const handleReactionClick = useCallback(
    (content: ReactionContent) => {
      const group = groupedReactions[content];
      if (group?.userReactionId && onRemoveReaction) {
        // User already reacted, remove it
        onRemoveReaction(group.userReactionId);
      } else if (onAddReaction) {
        // Add new reaction
        onAddReaction(content);
      }
      setShowPicker(false);
    },
    [groupedReactions, onAddReaction, onRemoveReaction]
  );

  const handleTogglePicker = useCallback(() => {
    if (!showPicker && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPickerPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setShowPicker(!showPicker);
  }, [showPicker]);

  // Sort reactions to show in consistent order
  const sortedReactions = useMemo(() => {
    return REACTION_ORDER.filter(
      (content) => groupedReactions[content]?.count > 0
    );
  }, [groupedReactions]);

  // Format users list for tooltip (like GitHub: "user1, user2, and 3 others reacted with 👍")
  const formatUsersTooltip = (users: string[], emoji: string) => {
    if (users.length === 0) return "";
    if (users.length === 1) return `${users[0]} reacted with ${emoji}`;
    if (users.length === 2)
      return `${users[0]} and ${users[1]} reacted with ${emoji}`;
    if (users.length === 3)
      return `${users[0]}, ${users[1]}, and ${users[2]} reacted with ${emoji}`;
    return `${users[0]}, ${users[1]}, and ${users.length - 2} others reacted with ${emoji}`;
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Add reaction button - on the left like GitHub */}
      {onAddReaction && (
        <>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={buttonRef}
                  onClick={handleTogglePicker}
                  className="inline-flex items-center justify-center w-7 h-7 text-xs rounded-full border border-border hover:border-blue-500/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Smile className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add reaction</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Emoji picker dropdown - using fixed positioning to escape overflow */}
          {showPicker && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-[100]"
                onClick={() => setShowPicker(false)}
              />
              {/* Picker */}
              <div
                className="fixed p-2 bg-card border border-border rounded-lg shadow-xl z-[101] flex gap-1"
                style={{ top: pickerPosition.top, left: pickerPosition.left }}
              >
                {REACTION_ORDER.map((content) => (
                  <button
                    key={content}
                    onClick={() => handleReactionClick(content)}
                    className={cn(
                      "w-8 h-8 flex items-center justify-center text-lg rounded hover:bg-muted transition-colors",
                      groupedReactions[content]?.userReactionId &&
                        "bg-blue-500/20"
                    )}
                    title={content}
                  >
                    {REACTION_EMOJIS[content]}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Existing reactions - after the add button */}
      <TooltipProvider delayDuration={200}>
        {sortedReactions.map((content) => {
          const group = groupedReactions[content];
          const isUserReaction = !!group.userReactionId;

          return (
            <Tooltip key={content}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleReactionClick(content)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors",
                    isUserReaction
                      ? "bg-blue-500/20 border-blue-500/50 text-blue-400"
                      : "bg-muted/50 border-border hover:border-blue-500/50"
                  )}
                >
                  <span>{REACTION_EMOJIS[content]}</span>
                  <span>{group.count}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {formatUsersTooltip(group.users, REACTION_EMOJIS[content])}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateCheckStatus(
  checks: { checkRuns: CheckRun[]; status: CombinedStatus } | null,
  workflowRunsAwaitingApproval?: Array<{ id: number }>
): "success" | "failure" | "pending" | "action_required" {
  // If there are workflow runs awaiting approval
  if (workflowRunsAwaitingApproval && workflowRunsAwaitingApproval.length > 0) {
    // If no checks data, show action_required
    if (!checks) return "action_required";

    const allChecks = [
      ...checks.checkRuns.map((c) =>
        c.status === "completed" ? c.conclusion : "pending"
      ),
      ...checks.status.statuses.map((s) => s.state),
    ];

    // If no checks at all, show action_required
    if (allChecks.length === 0) return "action_required";

    // If there are checks, evaluate them first
    if (allChecks.some((c) => c === "failure" || c === "error"))
      return "failure";
    if (allChecks.some((c) => c === "pending" || c === null)) return "pending";

    // All checks passed but workflows still need approval
    return "action_required";
  }

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
  const sorted = [...reviews]
    .filter((r) => r.submitted_at && r.user)
    .sort(
      (a, b) =>
        new Date(a.submitted_at!).getTime() -
        new Date(b.submitted_at!).getTime()
    );

  // Only include actual reviews (APPROVED or CHANGES_REQUESTED)
  // COMMENTED is not a review decision - it's just leaving comments
  for (const review of sorted) {
    if (
      (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED") &&
      review.user
    ) {
      byUser.set(review.user.login, review);
    }
  }

  return [...byUser.values()];
}

interface PRData {
  draft?: boolean;
  state: string;
  mergeable: boolean | null;
}

function canMerge(
  pr: PRData,
  checkStatus: "success" | "failure" | "pending" | "action_required"
): boolean {
  if (pr.draft) return false;
  if (pr.state !== "open") return false;
  if (pr.mergeable === false) return false;
  return true;
}

function getMergeStatusText(
  pr: PRData,
  checkStatus: "success" | "failure" | "pending" | "action_required"
): string {
  if (pr.draft) return "This pull request is still a draft";
  if (pr.mergeable === false)
    return "This branch has conflicts that must be resolved";
  if (checkStatus === "failure") return "Some checks have failed";
  if (checkStatus === "pending") return "Some checks haven't completed yet";
  return "This branch has no conflicts with the base branch";
}

function getMergeButtonText(method: "merge" | "squash" | "rebase"): string {
  switch (method) {
    case "merge":
      return "Create a merge commit";
    case "squash":
      return "Squash and merge";
    case "rebase":
      return "Rebase and merge";
  }
}

// ============================================================================
// Commit Group Component - Compact commit display
// ============================================================================

type CommittedEvent = Extract<
  TimelineEvent,
  { sha: string; author: { date: string } }
>;

interface CommitGroupProps {
  commits: CommittedEvent[];
  prCommits: PRCommit[];
  owner: string;
  repo: string;
}

function CommitGroup({ commits, prCommits, owner, repo }: CommitGroupProps) {
  if (commits.length === 0) return null;

  // Create a map from SHA to PRCommit for looking up GitHub usernames
  const prCommitMap = new Map(prCommits.map((c) => [c.sha, c]));

  // Get author display name - prefer GitHub login over git commit name
  const getAuthorName = (commit: CommittedEvent): string => {
    const prCommit = prCommitMap.get(commit.sha);
    return prCommit?.author?.login || commit.author.name || "Someone";
  };

  const lastCommit = commits[commits.length - 1];
  const authorName = getAuthorName(commits[0]);

  return (
    <div>
      {/* Only show header if more than 1 commit */}
      {commits.length > 1 && (
        <div className="flex items-center gap-3 py-1.5 text-sm text-muted-foreground">
          <div className="relative z-10 p-1.5 rounded-full bg-background border border-border shrink-0">
            <GitCommit className="w-4 h-4" />
          </div>
          <span>
            <span className="font-medium text-foreground">{authorName}</span>{" "}
            added {commits.length} commits{" "}
            {getTimeAgo(new Date(lastCommit.author.date))}
          </span>
        </div>
      )}

      {/* Individual commits */}
      {commits.map((commit) => (
        <div
          key={commit.sha}
          className="flex items-center gap-3 py-1.5 text-sm text-muted-foreground"
        >
          <div className="relative z-10 p-1.5 rounded-full bg-background border border-border shrink-0">
            <GitCommit className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {getAuthorName(commit)}
            </span>
            <a
              href={commit.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-0 truncate hover:text-blue-400"
              title={commit.message}
            >
              {commit.message.split("\n")[0]}
            </a>
            <a
              href={commit.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs hover:text-blue-400 shrink-0"
            >
              {commit.sha.slice(0, 7)}
            </a>
            <span className="shrink-0">
              {getTimeAgo(new Date(commit.author.date))}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Timeline Item Component - Compact event display
// ============================================================================

interface TimelineItemProps {
  event: TimelineEvent;
  pr?: PullRequest;
}

function TimelineItem({ event, pr }: TimelineItemProps) {
  // Commits are handled by CommitGroup
  if ("sha" in event && "author" in event) return null;

  // Skip events that shouldn't be shown
  if (!("event" in event) || !event.event) return null;
  const skipEvents = ["commented", "reviewed", "line-commented"];
  if (skipEvents.includes(event.event)) return null;

  // Extract actor (not all event types have actor)
  const actor =
    "actor" in event
      ? (event.actor as { login: string; avatar_url: string })
      : undefined;
  const eventType = event.event;

  const getEventInfo = (): {
    icon: React.ReactNode;
    text: React.ReactNode;
    color: string;
  } | null => {
    switch (eventType) {
      case "review_requested": {
        const requested = event as { requested_reviewer?: { login: string } };
        return {
          icon: <Eye className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> requested a
              review from{" "}
              <span className="font-medium">
                {requested.requested_reviewer?.login}
              </span>
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "review_request_removed": {
        const removed = event as { requested_reviewer?: { login: string } };
        return {
          icon: <Eye className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> removed the
              request for review from{" "}
              <span className="font-medium">
                {removed.requested_reviewer?.login}
              </span>
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "assigned": {
        const assigned = event as { assignee?: { login: string } };
        const isSelf = actor?.login === assigned.assignee?.login;
        return {
          icon: <UserPlus className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span>
              {isSelf ? (
                " self-assigned this"
              ) : (
                <>
                  {" "}
                  assigned{" "}
                  <span className="font-medium">
                    {assigned.assignee?.login}
                  </span>
                </>
              )}
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "unassigned": {
        const unassigned = event as { assignee?: { login: string } };
        const isSelf = actor?.login === unassigned.assignee?.login;
        return {
          icon: <UserMinus className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span>
              {isSelf ? (
                " removed their assignment"
              ) : (
                <>
                  {" "}
                  unassigned{" "}
                  <span className="font-medium">
                    {unassigned.assignee?.login}
                  </span>
                </>
              )}
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "labeled": {
        const labeled = event as { label?: { name: string; color: string } };
        return {
          icon: <Tag className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> added the{" "}
              <span
                className="px-2 py-0.5 text-xs font-medium rounded-full"
                style={{
                  backgroundColor: `#${labeled.label?.color}20`,
                  color: `#${labeled.label?.color}`,
                  border: `1px solid #${labeled.label?.color}40`,
                }}
              >
                {labeled.label?.name}
              </span>{" "}
              label
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "unlabeled": {
        const unlabeled = event as { label?: { name: string; color: string } };
        return {
          icon: <Tag className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> removed the{" "}
              <span
                className="px-2 py-0.5 text-xs font-medium rounded-full"
                style={{
                  backgroundColor: `#${unlabeled.label?.color}20`,
                  color: `#${unlabeled.label?.color}`,
                  border: `1px solid #${unlabeled.label?.color}40`,
                }}
              >
                {unlabeled.label?.name}
              </span>{" "}
              label
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "milestoned": {
        const milestoned = event as { milestone?: { title: string } };
        return {
          icon: <Milestone className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> added this to
              the{" "}
              <span className="font-medium">{milestoned.milestone?.title}</span>{" "}
              milestone
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "demilestoned": {
        const demilestoned = event as { milestone?: { title: string } };
        return {
          icon: <Milestone className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> removed this
              from the{" "}
              <span className="font-medium">
                {demilestoned.milestone?.title}
              </span>{" "}
              milestone
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "renamed": {
        const renamed = event as { rename?: { from: string; to: string } };
        return {
          icon: <FileEdit className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> changed the
              title from{" "}
              <del className="text-muted-foreground">
                {renamed.rename?.from}
              </del>{" "}
              to <span className="font-medium">{renamed.rename?.to}</span>
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "locked": {
        return {
          icon: <Lock className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> locked this
              conversation
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "unlocked": {
        return {
          icon: <Unlock className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> unlocked this
              conversation
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "head_ref_deleted": {
        return {
          icon: <GitBranch className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> deleted the
              head branch
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "head_ref_restored": {
        return {
          icon: <GitBranch className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> restored the
              head branch
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "head_ref_force_pushed": {
        // Timeline API only provides commit_id (the "to" SHA), no "before" SHA
        const forcePush = event as { commit_id?: string };
        const commitUrl =
          forcePush.commit_id && pr
            ? `https://github.com/${pr.base?.repo?.owner?.login || pr.user?.login}/${pr.base?.repo?.name || pr.head?.repo?.name}/commit/${forcePush.commit_id}`
            : undefined;
        return {
          icon: <GitBranch className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> force-pushed
              the{" "}
              <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs">
                {pr?.head?.ref || "branch"}
              </code>{" "}
              branch
              {forcePush.commit_id && (
                <>
                  {" "}
                  to{" "}
                  {commitUrl ? (
                    <a
                      href={commitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono hover:text-blue-400 hover:underline"
                    >
                      {forcePush.commit_id.slice(0, 7)}
                    </a>
                  ) : (
                    <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                      {forcePush.commit_id.slice(0, 7)}
                    </code>
                  )}
                </>
              )}
            </span>
          ),
          color: "text-amber-400",
        };
      }

      case "merged": {
        const merged = event as { commit_id?: string };
        return {
          icon: <GitMerge className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> merged commit{" "}
              <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                {merged.commit_id?.slice(0, 7) ||
                  pr?.merge_commit_sha?.slice(0, 7)}
              </code>{" "}
              into{" "}
              <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs">
                {pr?.base?.ref || "main"}
              </code>
            </span>
          ),
          color: "text-purple-400",
        };
      }

      case "closed": {
        return {
          icon: <GitPullRequest className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> closed this
              pull request
            </span>
          ),
          color: "text-red-400",
        };
      }

      case "reopened": {
        return {
          icon: <GitPullRequest className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> reopened this
              pull request
            </span>
          ),
          color: "text-green-400",
        };
      }

      case "ready_for_review": {
        return {
          icon: <GitPullRequest className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> marked this
              pull request as ready for review
            </span>
          ),
          color: "text-green-400",
        };
      }

      case "convert_to_draft": {
        return {
          icon: <GitPullRequest className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> converted this
              pull request to draft
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "cross-referenced": {
        const crossRef = event as {
          source?: {
            issue?: {
              number: number;
              title: string;
              repository?: { full_name: string };
            };
          };
        };
        return {
          icon: <Link className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> mentioned this
              in{" "}
              <span className="font-medium">
                {crossRef.source?.issue?.repository?.full_name}#
                {crossRef.source?.issue?.number}
              </span>
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      case "comment_deleted": {
        return {
          icon: <X className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">{actor?.login}</span> deleted a
              comment
            </span>
          ),
          color: "text-muted-foreground",
        };
      }

      default:
        return null;
    }
  };

  const eventInfo = getEventInfo();
  if (!eventInfo) return null;

  const displayDate = "created_at" in event ? event.created_at : undefined;

  return (
    <div className="flex items-center gap-3 py-1.5 text-sm text-muted-foreground">
      <div
        className={cn(
          "relative z-10 p-1.5 rounded-full bg-background border border-border shrink-0",
          eventInfo.color
        )}
      >
        {eventInfo.icon}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        {eventInfo.text}
        {displayDate && (
          <span title={new Date(displayDate).toLocaleString()}>
            {getTimeAgo(new Date(displayDate))}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Skeleton Components
// ============================================================================

function PROverviewSkeleton() {
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
            <CommentBoxSkeleton isLarge />

            {/* Timeline items skeleton */}
            {Array.from({ length: 3 }).map((_, i) => (
              <CommentBoxSkeleton key={i} />
            ))}

            {/* Merge section skeleton */}
            <div className="border border-border rounded-md overflow-hidden">
              {Array.from({ length: 3 }).map((_, i) => (
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
              <div className="p-4 space-y-3">
                <Skeleton className="h-10 w-full" />
              </div>
            </div>

            {/* Add comment skeleton */}
            <div className="flex gap-3">
              <Skeleton className="w-10 h-10 rounded-full shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-32 w-full rounded-md" />
                <div className="flex justify-end">
                  <Skeleton className="h-8 w-24" />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Sidebar skeleton */}
          <div className="w-[296px] shrink-0 space-y-4">
            <SidebarSectionSkeleton title="Reviewers" itemCount={2} />
            <SidebarSectionSkeleton title="Assignees" itemCount={1} />
            <SidebarSectionSkeleton title="Labels" itemCount={3} hasLabels />
            <SidebarSectionSkeleton
              title="Participants"
              itemCount={4}
              hasAvatars
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CommentBoxSkeleton({ isLarge }: { isLarge?: boolean }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50">
        <Skeleton className="w-5 h-5 rounded-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
      {/* Body */}
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[90%]" />
        {isLarge && (
          <>
            <Skeleton className="h-4 w-[75%]" />
            <Skeleton className="h-4 w-[85%]" />
            <Skeleton className="h-4 w-[60%]" />
          </>
        )}
      </div>
      {/* Reactions */}
      <div className="px-4 py-2 border-t border-border flex gap-2">
        <Skeleton className="h-6 w-10 rounded-full" />
        <Skeleton className="h-6 w-10 rounded-full" />
      </div>
    </div>
  );
}

function SidebarSectionSkeleton({
  title,
  itemCount = 2,
  hasLabels,
  hasAvatars,
}: {
  title: string;
  itemCount?: number;
  hasLabels?: boolean;
  hasAvatars?: boolean;
}) {
  return (
    <div className="pb-3 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {title}
        </span>
        <Skeleton className="w-4 h-4" />
      </div>
      {hasLabels ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {Array.from({ length: itemCount }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-16 rounded-full" />
          ))}
        </div>
      ) : hasAvatars ? (
        <div className="flex items-center gap-1">
          {Array.from({ length: itemCount }).map((_, i) => (
            <Skeleton key={i} className="w-6 h-6 rounded-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from({ length: itemCount }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="w-5 h-5 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
