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

  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewThreads, setReviewThreads] = useState<ReviewThread[]>([]);
  const [checks, setChecks] = useState<{
    checkRuns: CheckRun[];
    status: CombinedStatus;
  } | null>(null);
  const [checksLastUpdated, setChecksLastUpdated] = useState<Date | null>(null);
  const [refreshingChecks, setRefreshingChecks] = useState(false);
  const [conversation, setConversation] = useState<IssueComment[]>([]);
  const [commits, setCommits] = useState<PRCommit[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("conversation");

  // Merge state
  const [merging, setMerging] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | "rebase">(
    "squash"
  );
  const [showMergeOptions, setShowMergeOptions] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Comment state
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  // Action loading states
  const [closingPR, setClosingPR] = useState(false);
  const [reopeningPR, setReopeningPR] = useState(false);
  const [deletingBranch, setDeletingBranch] = useState(false);
  const [branchDeleted, setBranchDeleted] = useState(false);
  const [restoringBranch, setRestoringBranch] = useState(false);
  const [convertingToDraft, setConvertingToDraft] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [assigningSelf, setAssigningSelf] = useState(false);

  // Viewer permissions from GraphQL (more reliable than REST)
  const [viewerPermission, setViewerPermission] = useState<string | null>(null);

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
  const reviewersButtonRef = useRef<HTMLButtonElement>(null);
  const assigneesButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.title = `${pr.title} · Pull Request #${pr.number} · Pulldash`;
  }, [pr.title, pr.number]);

  // Fetch checks function (used for both initial load and refresh)
  const fetchChecks = useCallback(async () => {
    try {
      const checksData = await github
        .getPRChecks(owner, repo, pr.head.sha)
        .catch(() => ({
          checkRuns: [] as CheckRun[],
          status: {
            state: "",
            sha: "",
            total_count: 0,
            statuses: [],
            repository: {} as CombinedStatus["repository"],
            commit_url: "",
            url: "",
          } as CombinedStatus,
        }));
      setChecks(checksData);
      setChecksLastUpdated(new Date());
    } catch {
      // Ignore errors on refresh
    }
  }, [github, owner, repo, pr.head.sha]);

  // Manual refresh handler
  const handleRefreshChecks = useCallback(async () => {
    setRefreshingChecks(true);
    await fetchChecks();
    setRefreshingChecks(false);
  }, [fetchChecks]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [
          reviewsData,
          checksData,
          conversationData,
          commitsData,
          timelineData,
          reviewThreadsResult,
        ] = await Promise.all([
          github
            .getPRReviews(owner, repo, pr.number)
            .catch(() => [] as Review[]),
          github.getPRChecks(owner, repo, pr.head.sha).catch(() => ({
            checkRuns: [] as CheckRun[],
            status: {
              state: "",
              sha: "",
              total_count: 0,
              statuses: [],
              repository: {} as CombinedStatus["repository"],
              commit_url: "",
              url: "",
            } as CombinedStatus,
          })),
          github
            .getPRConversation(owner, repo, pr.number)
            .catch(() => [] as IssueComment[]),
          github
            .getPRCommits(owner, repo, pr.number)
            .catch(() => [] as PRCommit[]),
          github
            .getPRTimeline(owner, repo, pr.number)
            .catch(() => [] as TimelineEvent[]),
          github.getReviewThreads(owner, repo, pr.number).catch(() => ({
            threads: [] as ReviewThread[],
            viewerPermission: null,
          })),
        ]);

        setReviews(reviewsData);
        setChecks(checksData);
        setChecksLastUpdated(new Date());
        setConversation(conversationData);
        setCommits(commitsData);
        setTimeline(timelineData);
        setReviewThreads(reviewThreadsResult.threads);
        setViewerPermission(reviewThreadsResult.viewerPermission);

        // Check if branch was already deleted (and not restored) from timeline
        // Branch is deleted if there are more delete events than restore events
        const deleteCount = timelineData.filter(
          (event) => (event as { event?: string }).event === "head_ref_deleted"
        ).length;
        const restoreCount = timelineData.filter(
          (event) => (event as { event?: string }).event === "head_ref_restored"
        ).length;
        setBranchDeleted(deleteCount > restoreCount);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [github, owner, repo, pr.number, pr.head.sha]);

  // Auto-refresh checks every 30 seconds when PR is open
  useEffect(() => {
    if (pr.state !== "open" || pr.merged) return;

    const interval = setInterval(() => {
      fetchChecks();
    }, 30_000);

    return () => clearInterval(interval);
  }, [fetchChecks, pr.state, pr.merged]);

  const handleMerge = useCallback(async () => {
    setMerging(true);
    setMergeError(null);

    try {
      await github.mergePR(owner, repo, pr.number, {
        merge_method: mergeMethod,
      });

      // Track PR merged
      track("pr_merged", {
        pr_number: pr.number,
        owner,
        repo,
        merge_method: mergeMethod,
      });

      window.location.reload();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Failed to merge");
    } finally {
      setMerging(false);
    }
  }, [github, owner, repo, pr.number, mergeMethod, track]);

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
      setConversation((prev) => [...prev, newComment]);
      setCommentText("");
    } catch (error) {
      console.error("Failed to add comment:", error);
    } finally {
      setSubmittingComment(false);
    }
  }, [github, owner, repo, pr.number, commentText]);

  const handleUpdateBranch = useCallback(async () => {
    await github.updateBranch(owner, repo, pr.number);
  }, [github, owner, repo, pr.number]);

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
    setConvertingToDraft(true);
    try {
      await github.convertToDraft(owner, repo, pr.number);
      await refetchPR();
    } catch (error) {
      console.error("Failed to convert to draft:", error);
    } finally {
      setConvertingToDraft(false);
    }
  }, [github, owner, repo, pr.number, refetchPR]);

  const handleMarkReadyForReview = useCallback(async () => {
    setMarkingReady(true);
    try {
      await github.markReadyForReview(owner, repo, pr.number);
      await refetchPR();
    } catch (error) {
      console.error("Failed to mark ready for review:", error);
    } finally {
      setMarkingReady(false);
    }
  }, [github, owner, repo, pr.number, refetchPR]);

  const handleClosePR = useCallback(async () => {
    setClosingPR(true);
    try {
      await github.closePR(owner, repo, pr.number);
      await refetchPR();
    } catch (error) {
      console.error("Failed to close PR:", error);
    } finally {
      setClosingPR(false);
    }
  }, [github, owner, repo, pr.number, refetchPR]);

  const handleReopenPR = useCallback(async () => {
    setReopeningPR(true);
    try {
      await github.reopenPR(owner, repo, pr.number);
      await refetchPR();
    } catch (error) {
      console.error("Failed to reopen PR:", error);
    } finally {
      setReopeningPR(false);
    }
  }, [github, owner, repo, pr.number, refetchPR]);

  const handleDeleteBranch = useCallback(async () => {
    if (
      !window.confirm(
        `Are you sure you want to delete the branch "${pr.head.ref}"?`
      )
    ) {
      return;
    }

    setDeletingBranch(true);
    try {
      await github.deleteBranch(
        pr.head.repo?.owner?.login ?? owner,
        pr.head.repo?.name ?? repo,
        pr.head.ref
      );
      setBranchDeleted(true);
    } catch (error) {
      console.error("Failed to delete branch:", error);
    } finally {
      setDeletingBranch(false);
    }
  }, [github, owner, repo, pr.head.ref, pr.head.repo]);

  const handleRestoreBranch = useCallback(async () => {
    setRestoringBranch(true);
    try {
      await github.restoreBranch(
        pr.head.repo?.owner?.login ?? owner,
        pr.head.repo?.name ?? repo,
        pr.head.ref,
        pr.head.sha
      );
      setBranchDeleted(false);
    } catch (error) {
      console.error("Failed to restore branch:", error);
    } finally {
      setRestoringBranch(false);
    }
  }, [github, owner, repo, pr.head.ref, pr.head.repo, pr.head.sha]);

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

  // Calculate check status
  const checkStatus = calculateCheckStatus(checks);
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
                  onAddReaction={handleAddPRReaction}
                  onRemoveReaction={handleRemovePRReaction}
                  currentUser={currentUser}
                />

                {/* Timeline - merge comments, reviews, and events by date */}
                {(() => {
                  // Build unified timeline
                  type TimelineEntry =
                    | { type: "comment"; data: IssueComment; date: Date }
                    | { type: "review"; data: Review; date: Date }
                    | { type: "event"; data: TimelineEvent; date: Date }
                    | { type: "thread"; data: ReviewThread; date: Date };

                  const entries: TimelineEntry[] = [];

                  // Add comments
                  conversation.forEach((comment) => {
                    entries.push({
                      type: "comment",
                      data: comment,
                      date: new Date(comment.created_at),
                    });
                  });

                  // Add ALL reviews to timeline - show APPROVED/CHANGES_REQUESTED always, COMMENTED only if they have a body
                  // Note: we use `reviews` not `latestReviews` because latestReviews only keeps one review per user
                  reviews
                    .filter(
                      (r) =>
                        r.submitted_at &&
                        (r.body ||
                          r.state === "APPROVED" ||
                          r.state === "CHANGES_REQUESTED")
                    )
                    .forEach((review) => {
                      entries.push({
                        type: "review",
                        data: review,
                        date: new Date(review.submitted_at!),
                      });
                    });

                  // Add review threads (inline code comments)
                  reviewThreads.forEach((thread) => {
                    const firstComment = thread.comments.nodes[0];
                    if (firstComment) {
                      entries.push({
                        type: "thread",
                        data: thread,
                        date: new Date(firstComment.createdAt),
                      });
                    }
                  });

                  // Add timeline events (excluding those we show as comments/reviews)
                  timeline.forEach((event) => {
                    const eventType = (event as { event?: string }).event;
                    const createdAt = (event as { created_at?: string })
                      .created_at;
                    const sha = (event as { sha?: string }).sha;
                    const commitDate = (
                      event as { commit?: { author?: { date?: string } } }
                    ).commit?.author?.date;

                    // Include commits (have sha but no event field)
                    if (sha && !eventType) {
                      const date = createdAt || commitDate;
                      if (date) {
                        entries.push({
                          type: "event",
                          data: event,
                          date: new Date(date),
                        });
                      }
                    }
                    // Include other events (except comments/reviews which we handle separately)
                    // Also skip "closed" event when PR was merged (it's redundant)
                    else if (
                      eventType &&
                      createdAt &&
                      !["commented", "reviewed", "line-commented"].includes(
                        eventType
                      ) &&
                      !(eventType === "closed" && pr.merged)
                    ) {
                      entries.push({
                        type: "event",
                        data: event,
                        date: new Date(createdAt),
                      });
                    }
                  });

                  // Sort by date
                  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

                  return entries.map((entry, index) => {
                    if (entry.type === "comment") {
                      const comment = entry.data;
                      return (
                        <CommentBox
                          key={`comment-${comment.id}`}
                          user={comment.user}
                          createdAt={comment.created_at}
                          body={comment.body}
                          reactions={reactions[`comment-${comment.id}`]}
                          onAddReaction={(content) =>
                            handleAddCommentReaction(comment.id, content)
                          }
                          onRemoveReaction={(reactionId) =>
                            handleRemoveCommentReaction(comment.id, reactionId)
                          }
                          currentUser={currentUser}
                        />
                      );
                    }
                    if (entry.type === "review") {
                      return (
                        <ReviewBox
                          key={`review-${entry.data.id}`}
                          review={entry.data}
                        />
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
                    if (entry.type === "thread") {
                      return (
                        <ReviewThreadBox
                          key={`thread-${entry.data.id}`}
                          thread={entry.data}
                          owner={owner}
                          repo={repo}
                        />
                      );
                    }
                    return null;
                  });
                })()}

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
                      onSetMergeMethod={setMergeMethod}
                      onToggleMergeOptions={() =>
                        setShowMergeOptions(!showMergeOptions)
                      }
                      onUpdateBranch={handleUpdateBranch}
                      markingReady={markingReady}
                      onMarkReadyForReview={handleMarkReadyForReview}
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
                {pr.merged && (
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
                          You're all set — the{" "}
                          <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs">
                            {pr.head.label || pr.head.ref}
                          </code>{" "}
                          branch can be safely deleted.
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
                  </div>
                )}

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
                      <Clock className="w-3.5 h-3.5 text-yellow-500" />
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
              ) : latestReviews.length > 0 ? (
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
                      <ReviewStateIcon state={review.state} />
                    </div>
                  ))}
                </div>
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
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-medium">Request reviewers</p>
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
                            )
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
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-medium">Assign people</p>
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    {loadingCollaborators ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      </div>
                    ) : (
                      collaborators
                        .filter(
                          (c) => !pr.assignees?.some((a) => a.login === c.login)
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
  user,
  createdAt,
  body,
  isAuthor,
  reactions,
  onAddReaction,
  onRemoveReaction,
  currentUser,
}: {
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
    <div className="border border-border rounded-md overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 text-sm border-b border-border",
          isAuthor ? "bg-blue-500/5" : "bg-card/50"
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
      <div className="p-4">
        {body ? (
          <Markdown>{body}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No description provided.
          </p>
        )}
      </div>
      {/* Reactions */}
      {(reactions || onAddReaction) && (
        <div className="px-4 py-2 border-t border-border">
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

  const stateBg =
    {
      APPROVED: "bg-green-500/10 border-green-500/30",
      CHANGES_REQUESTED: "bg-red-500/10 border-red-500/30",
      COMMENTED: "bg-card/50",
      DISMISSED: "bg-card/50",
      PENDING: "bg-yellow-500/10 border-yellow-500/30",
    }[review.state] || "bg-card/50";

  return (
    <div className={cn("border rounded-md overflow-hidden", stateBg)}>
      <div className="flex items-center gap-2 px-4 py-2 text-sm border-b border-border">
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
        <ReviewStateIcon state={review.state} />
        <span className="text-muted-foreground">{stateText}</span>
        <span className="text-muted-foreground">
          {review.submitted_at && getTimeAgo(new Date(review.submitted_at))}
        </span>
        <span className="flex-1" />
        {review.html_url && (
          <a
            href={review.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline text-xs"
          >
            View reviewed changes
          </a>
        )}
      </div>
      {review.body && (
        <div className="p-4">
          <Markdown>{review.body}</Markdown>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Review State Icon
// ============================================================================

function ReviewStateIcon({ state }: { state: string }) {
  switch (state) {
    case "APPROVED":
      return <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />;
    case "CHANGES_REQUESTED":
      return <XCircle className="w-4 h-4 text-red-500 ml-auto" />;
    case "COMMENTED":
      return <Eye className="w-4 h-4 text-blue-500 ml-auto" />;
    case "DISMISSED":
      return <MinusCircle className="w-4 h-4 text-muted-foreground ml-auto" />;
    default:
      return <Circle className="w-4 h-4 text-muted-foreground ml-auto" />;
  }
}

// ============================================================================
// Review Thread Box Component (for inline code comments)
// ============================================================================

function ReviewThreadBox({
  thread,
  owner,
  repo,
}: {
  thread: ReviewThread;
  owner: string;
  repo: string;
}) {
  const comments = thread.comments.nodes;
  if (comments.length === 0) return null;

  const firstComment = comments[0];
  const filePath = firstComment.path;
  const diffHunk = firstComment.diffHunk;

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
        // Parse hunk header like "@@ -20,4 +20,4 @@"
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
        // Context line (starts with space or is empty)
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
        "border rounded-md overflow-hidden",
        thread.isResolved ? "border-muted opacity-60" : "border-border"
      )}
    >
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-card/50 border-b border-border text-sm">
        <a
          href={`https://github.com/${owner}/${repo}/blob/HEAD/${filePath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-muted-foreground hover:text-blue-400 hover:underline"
        >
          {filePath}
        </a>
        {thread.isResolved && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="w-3 h-3" />
            Resolved
            {thread.resolvedBy && <span> by {thread.resolvedBy.login}</span>}
          </span>
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

      {/* Comments in thread */}
      <div className="divide-y divide-border">
        {comments.map((comment) => (
          <div key={comment.id} className="p-4">
            <div className="flex items-center gap-2 mb-2 text-sm">
              {comment.author && (
                <>
                  <UserHoverCard login={comment.author.login}>
                    <img
                      src={comment.author.avatarUrl}
                      alt={comment.author.login}
                      className="w-5 h-5 rounded-full cursor-pointer"
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
            <div className="pl-7">
              <Markdown>{comment.body}</Markdown>
            </div>
          </div>
        ))}
      </div>

      {/* Reply section placeholder */}
      <div className="flex items-center gap-2 px-4 py-2 bg-card/30 border-t border-border">
        <input
          type="text"
          placeholder="Reply..."
          className="flex-1 bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground/50 outline-none cursor-not-allowed"
          disabled
        />
        {!thread.isResolved && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted cursor-not-allowed"
            disabled
          >
            Resolve conversation
          </button>
        )}
      </div>
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
}: {
  pr: {
    draft?: boolean;
    state: string;
    mergeable: boolean | null;
    requested_reviewers?: Array<{ login: string; avatar_url: string }> | null;
  };
  checkStatus: "success" | "failure" | "pending";
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
              <div className="pt-2 border-t border-border/50">
                {latestReviews.map((review) => (
                  <div key={review.id} className="flex items-center gap-2 py-2">
                    <img
                      src={review.user?.avatar_url}
                      alt={review.user?.login}
                      className="w-5 h-5 rounded-full"
                    />
                    <span className="text-sm">{review.user?.login}</span>
                    <ReviewStateIcon state={review.state} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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
          ) : (
            <Clock className="w-5 h-5 text-yellow-500 shrink-0" />
          )}
          <div className="flex-1 text-left">
            <p className="font-medium text-sm">
              {checkStatus === "success"
                ? "All checks have passed"
                : checkStatus === "failure"
                  ? "Some checks have failed"
                  : "Some checks haven't completed yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {[
                queuedChecks > 0 && `${queuedChecks} queued`,
                skippedChecks > 0 && `${skippedChecks} skipped`,
                successfulChecks > 0 && `${successfulChecks} successful`,
                failedChecks > 0 && `${failedChecks} failed`,
                inProgressChecks > 0 && `${inProgressChecks} in progress`,
              ]
                .filter(Boolean)
                .join(", ")}{" "}
              {totalChecks === 1 ? "check" : "checks"}
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
          {conflictStatus === "success" && (
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

          {/* Bypass rules checkbox */}
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

          {/* Merge button with dropdown */}
          <div className="flex items-center gap-0.5">
            {/* Main merge button */}
            <button
              onClick={onMerge}
              disabled={merging || (!canMergePR && !bypassRules)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-l-md text-sm font-medium transition-colors",
                canMergePR || bypassRules
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {merging ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : bypassRules ? (
                <>Bypass rules and merge ({mergeMethod})</>
              ) : (
                <>Merge when ready</>
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
  status: "success" | "failure" | "pending";
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  switch (status) {
    case "success":
      return <CheckCircle2 className={cn(sizeClass, "text-green-500")} />;
    case "failure":
      return <XCircle className={cn(sizeClass, "text-red-500")} />;
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

  const commented = sorted.filter((r) => r.state === "COMMENTED");
  return [...byUser.values(), ...commented];
}

interface PRData {
  draft?: boolean;
  state: string;
  mergeable: boolean | null;
}

function canMerge(
  pr: PRData,
  checkStatus: "success" | "failure" | "pending"
): boolean {
  if (pr.draft) return false;
  if (pr.state !== "open") return false;
  if (pr.mergeable === false) return false;
  return true;
}

function getMergeStatusText(
  pr: PRData,
  checkStatus: "success" | "failure" | "pending"
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
// Timeline Item Component
// ============================================================================

interface TimelineItemProps {
  event: TimelineEvent;
  pr?: PullRequest;
}

function TimelineItem({ event, pr }: TimelineItemProps) {
  // Get the event type - timeline events have an "event" field
  // Commits don't have an "event" field but have a "sha" field
  const eventType = (event as { event?: string }).event;
  const actor = (event as { actor?: { login: string; avatar_url: string } })
    .actor;
  const createdAt = (event as { created_at?: string }).created_at;

  // Check if this is a commit (commits have sha but no event field)
  const isCommit = !eventType && (event as { sha?: string }).sha;

  // Skip events we don't want to show (but allow commits)
  if (!eventType && !isCommit) return null;

  // Events to skip (they're shown elsewhere or not useful)
  const skipEvents = ["commented", "reviewed", "line-commented"];
  if (eventType && skipEvents.includes(eventType)) return null;

  const getEventInfo = (): {
    icon: React.ReactNode;
    text: React.ReactNode;
    color: string;
    avatar?: string;
  } | null => {
    // Handle commits (no event field, but has sha)
    if (isCommit) {
      const commit = event as {
        sha?: string;
        html_url?: string;
        author?: { login?: string; avatar_url?: string; name?: string };
        committer?: { login?: string; avatar_url?: string };
        commit?: {
          message?: string;
          author?: { name?: string; date?: string };
        };
      };
      const authorName =
        commit.author?.login || commit.commit?.author?.name || "Someone";
      const authorAvatar =
        commit.author?.avatar_url || commit.committer?.avatar_url;
      const message = commit.commit?.message?.split("\n")[0] || "";

      return {
        icon: <GitCommit className="w-4 h-4" />,
        text: (
          <span>
            <span className="font-medium">{authorName}</span> added a commit{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
              {commit.sha?.slice(0, 7)}
            </code>
            {message && (
              <span className="text-muted-foreground"> — {message}</span>
            )}
          </span>
        ),
        color: "text-muted-foreground",
        avatar: authorAvatar,
      };
    }

    switch (eventType) {
      case "committed": {
        const commit = event as {
          sha?: string;
          message?: string;
          author?: { name?: string; avatar_url?: string };
        };
        return {
          icon: <GitCommit className="w-4 h-4" />,
          text: (
            <span>
              <span className="font-medium">
                {commit.author?.name || "Someone"}
              </span>{" "}
              added a commit{" "}
              <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                {commit.sha?.slice(0, 7)}
              </code>
              {commit.message && (
                <span className="text-muted-foreground">
                  {" "}
                  — {commit.message.split("\n")[0]}
                </span>
              )}
            </span>
          ),
          color: "text-muted-foreground",
          avatar: commit.author?.avatar_url,
        };
      }

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

  // Get the date - for commits, use commit.author.date if created_at is not available
  const commitDate = isCommit
    ? (event as { commit?: { author?: { date?: string } } }).commit?.author
        ?.date
    : undefined;
  const displayDate = createdAt || commitDate;

  // Get avatar - prefer actor's avatar, then eventInfo.avatar
  const avatarUrl = actor?.avatar_url || eventInfo.avatar;
  const avatarAlt = actor?.login || "User";

  return (
    <div className="flex items-start gap-3 py-3">
      {/* Timeline line + icon */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "p-2 rounded-full bg-muted border border-border",
            eventInfo.color
          )}
        >
          {eventInfo.icon}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1.5">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt={avatarAlt}
              className="w-5 h-5 rounded-full"
            />
          )}
          {eventInfo.text}
          {displayDate && (
            <span className="text-muted-foreground">
              <a
                href="#"
                className="hover:text-blue-400 hover:underline"
                title={new Date(displayDate).toLocaleString()}
              >
                {getTimeAgo(new Date(displayDate))}
              </a>
            </span>
          )}
        </div>
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
