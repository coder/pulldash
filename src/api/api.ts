import { Hono } from "hono";
import {
  getPullRequest,
  getPullRequestFiles,
  getPullRequestComments,
  createReviewComment,
  replyToComment,
  getReviews,
  createReview,
  createPendingReview,
  submitPendingReview,
  deletePendingReview,
  getReviewComments,
  updateReviewComment,
  deleteReviewComment,
  getCheckRuns,
  getCombinedStatus,
  mergePullRequest,
  getIssueComments,
  createIssueComment,
  getFileContent,
  getCurrentUser,
  // GraphQL mutations for pending reviews
  getPullRequestNodeId,
  getPendingReviewNodeId,
  addPendingReviewCommentGraphQL,
  deletePendingReviewCommentGraphQL,
  updatePendingReviewCommentGraphQL,
  submitPendingReviewGraphQL,
  // Review thread resolution
  getReviewThreads,
  resolveReviewThread,
  unresolveReviewThread,
} from "./github";
import { parseDiffWithHighlighting, highlightFileLines } from "./diff";

const api = new Hono().basePath("/api");

// Get PR details
api.get("/pr/:owner/:repo/:number", async (c) => {
  const { owner, repo, number } = c.req.param();
  try {
    const pr = await getPullRequest(owner, repo, parseInt(number, 10));
    return c.json(pr);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch PR" },
      500
    );
  }
});

// Get PR files
api.get("/pr/:owner/:repo/:number/files", async (c) => {
  const { owner, repo, number } = c.req.param();
  try {
    const files = await getPullRequestFiles(owner, repo, parseInt(number, 10));
    return c.json(files);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch files" },
      500
    );
  }
});

// Get PR comments (with thread resolution info from GraphQL)
api.get("/pr/:owner/:repo/:number/comments", async (c) => {
  const { owner, repo, number } = c.req.param();
  try {
    // Fetch both REST comments and GraphQL threads for resolution info
    const [comments, threads] = await Promise.all([
      getPullRequestComments(owner, repo, parseInt(number, 10)),
      getReviewThreads(owner, repo, parseInt(number, 10)),
    ]);

    // Create a map of comment database ID to thread info
    const commentToThread = new Map<number, { threadId: string; isResolved: boolean; resolvedBy: { login: string; avatar_url: string } | null }>();
    for (const thread of threads) {
      for (const comment of thread.comments) {
        commentToThread.set(comment.databaseId, {
          threadId: thread.id,
          isResolved: thread.isResolved,
          resolvedBy: thread.resolvedBy ? {
            login: thread.resolvedBy.login,
            avatar_url: thread.resolvedBy.avatarUrl,
          } : null,
        });
      }
    }

    // Enrich REST comments with thread info
    const enrichedComments = comments.map((comment) => {
      const threadInfo = commentToThread.get(comment.id);
      return {
        ...comment,
        pull_request_review_thread_id: threadInfo?.threadId,
        is_resolved: threadInfo?.isResolved ?? false,
        resolved_by: threadInfo?.resolvedBy ?? null,
      };
    });

    return c.json(enrichedComments);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch comments" },
      500
    );
  }
});

// Get review threads (GraphQL - includes resolution status)
api.get("/pr/:owner/:repo/:number/threads", async (c) => {
  const { owner, repo, number } = c.req.param();
  try {
    const threads = await getReviewThreads(owner, repo, parseInt(number, 10));
    return c.json(threads);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch threads" },
      500
    );
  }
});

// Resolve a review thread
api.post("/pr/:owner/:repo/:number/threads/:threadId/resolve", async (c) => {
  const { threadId } = c.req.param();
  try {
    await resolveReviewThread(threadId);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to resolve thread" },
      500
    );
  }
});

// Unresolve a review thread
api.post("/pr/:owner/:repo/:number/threads/:threadId/unresolve", async (c) => {
  const { threadId } = c.req.param();
  try {
    await unresolveReviewThread(threadId);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to unresolve thread" },
      500
    );
  }
});

// Create PR comment
api.post("/pr/:owner/:repo/:number/comments", async (c) => {
  const { owner, repo, number } = c.req.param();
  const body = await c.req.json();

  try {
    let comment;

    if (body.reply_to_id) {
      comment = await replyToComment(
        owner,
        repo,
        parseInt(number, 10),
        body.reply_to_id,
        body.body
      );
    } else {
      comment = await createReviewComment(
        owner,
        repo,
        parseInt(number, 10),
        body.body,
        body.commit_id,
        body.path,
        body.line,
        body.side || "RIGHT"
      );
    }

    return c.json(comment);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to create comment" },
      500
    );
  }
});

// Parse and highlight diff (server-side with caching)
api.post("/parse-diff", async (c) => {
  const { patch, filename, previousFilename, sha } = await c.req.json();

  if (!patch || !filename) {
    return c.json({ error: "Missing patch or filename" }, 400);
  }

  try {
    // Use SHA as cache key for immutable caching
    const parsed = parseDiffWithHighlighting(patch, filename, previousFilename, sha);
    
    // Set cache headers for immutable content (SHA-based)
    if (sha) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
      c.header("ETag", `"${sha}"`);
    }
    
    return c.json(parsed);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to parse diff" },
      500
    );
  }
});

// ============================================================================
// Review APIs
// ============================================================================

// Get PR reviews
api.get("/pr/:owner/:repo/:number/reviews", async (c) => {
  const { owner, repo, number } = c.req.param();
  try {
    const reviews = await getReviews(owner, repo, parseInt(number, 10));
    return c.json(reviews);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch reviews" },
      500
    );
  }
});

// Submit a review (with all comments at once)
api.post("/pr/:owner/:repo/:number/reviews", async (c) => {
  const { owner, repo, number } = c.req.param();
  const body = await c.req.json();

  try {
    const review = await createReview(
      owner,
      repo,
      parseInt(number, 10),
      body.commit_id,
      body.event,
      body.body || "",
      body.comments || []
    );
    return c.json(review);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to submit review" },
      500
    );
  }
});

// Create a pending review (REST API - legacy)
api.post("/pr/:owner/:repo/:number/reviews/pending", async (c) => {
  const { owner, repo, number } = c.req.param();
  const body = await c.req.json();

  try {
    const review = await createPendingReview(
      owner,
      repo,
      parseInt(number, 10),
      body.commit_id
    );
    return c.json(review);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to create pending review" },
      500
    );
  }
});

// Get PR node ID (for GraphQL mutations)
api.get("/pr/:owner/:repo/:number/node-id", async (c) => {
  const { owner, repo, number } = c.req.param();

  try {
    const nodeId = await getPullRequestNodeId(owner, repo, parseInt(number, 10));
    return c.json({ nodeId });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to get PR node ID" },
      500
    );
  }
});

// Get user's pending review via GraphQL
api.get("/pr/:owner/:repo/:number/pending-review", async (c) => {
  const { owner, repo, number } = c.req.param();

  try {
    const result = await getPendingReviewNodeId(owner, repo, parseInt(number, 10));
    return c.json(result);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to get pending review" },
      500
    );
  }
});

// Add a comment to pending review via GraphQL (creates review if needed)
api.post("/pr/:owner/:repo/:number/pending-comment", async (c) => {
  const { owner, repo, number } = c.req.param();
  const body = await c.req.json();

  try {
    // Get PR node ID if not provided
    let pullRequestId = body.pull_request_id;
    if (!pullRequestId) {
      pullRequestId = await getPullRequestNodeId(owner, repo, parseInt(number, 10));
    }

    const result = await addPendingReviewCommentGraphQL(
      pullRequestId,
      body.path,
      body.line,
      body.body,
      body.start_line
    );
    return c.json(result);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to add pending comment" },
      500
    );
  }
});

// Delete a pending review comment via GraphQL
api.delete("/pr/:owner/:repo/:number/pending-comment/:commentId", async (c) => {
  const { commentId } = c.req.param();

  try {
    await deletePendingReviewCommentGraphQL(commentId);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to delete pending comment" },
      500
    );
  }
});

// Update a pending review comment via GraphQL
api.patch("/pr/:owner/:repo/:number/pending-comment/:commentId", async (c) => {
  const { commentId } = c.req.param();
  const body = await c.req.json();

  try {
    await updatePendingReviewCommentGraphQL(commentId, body.body);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to update pending comment" },
      500
    );
  }
});

// Submit pending review via GraphQL
api.post("/pr/:owner/:repo/:number/pending-review/submit", async (c) => {
  const body = await c.req.json();

  try {
    await submitPendingReviewGraphQL(body.review_id, body.event, body.body);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to submit review" },
      500
    );
  }
});

// Submit a pending review
api.post("/pr/:owner/:repo/:number/reviews/:reviewId/submit", async (c) => {
  const { owner, repo, number, reviewId } = c.req.param();
  const body = await c.req.json();

  try {
    const review = await submitPendingReview(
      owner,
      repo,
      parseInt(number, 10),
      parseInt(reviewId, 10),
      body.event,
      body.body
    );
    return c.json(review);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to submit review" },
      500
    );
  }
});

// Delete a pending review
api.delete("/pr/:owner/:repo/:number/reviews/:reviewId", async (c) => {
  const { owner, repo, number, reviewId } = c.req.param();

  try {
    await deletePendingReview(
      owner,
      repo,
      parseInt(number, 10),
      parseInt(reviewId, 10)
    );
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to delete review" },
      500
    );
  }
});

// Get comments for a specific review
api.get("/pr/:owner/:repo/:number/reviews/:reviewId/comments", async (c) => {
  const { owner, repo, number, reviewId } = c.req.param();

  try {
    const comments = await getReviewComments(
      owner,
      repo,
      parseInt(number, 10),
      parseInt(reviewId, 10)
    );
    return c.json(comments);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch review comments" },
      500
    );
  }
});

// Update a review comment
api.patch("/pr/:owner/:repo/comments/:commentId", async (c) => {
  const { owner, repo, commentId } = c.req.param();
  const body = await c.req.json();

  try {
    const comment = await updateReviewComment(
      owner,
      repo,
      parseInt(commentId, 10),
      body.body
    );
    return c.json(comment);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to update comment" },
      500
    );
  }
});

// Delete a review comment
api.delete("/pr/:owner/:repo/comments/:commentId", async (c) => {
  const { owner, repo, commentId } = c.req.param();

  try {
    await deleteReviewComment(
      owner,
      repo,
      parseInt(commentId, 10)
    );
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to delete comment" },
      500
    );
  }
});

// ============================================================================
// Checks & Status
// ============================================================================

// Get check runs
api.get("/pr/:owner/:repo/:number/checks", async (c) => {
  const { owner, repo, number } = c.req.param();
  try {
    const pr = await getPullRequest(owner, repo, parseInt(number, 10));
    const [checkRuns, status] = await Promise.all([
      getCheckRuns(owner, repo, pr.head.sha),
      getCombinedStatus(owner, repo, pr.head.sha),
    ]);
    return c.json({ checkRuns: checkRuns.check_runs, status });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch checks" },
      500
    );
  }
});

// ============================================================================
// Merge
// ============================================================================

api.post("/pr/:owner/:repo/:number/merge", async (c) => {
  const { owner, repo, number } = c.req.param();
  const body = await c.req.json();

  try {
    const result = await mergePullRequest(
      owner,
      repo,
      parseInt(number, 10),
      body.merge_method || "squash",
      body.commit_title,
      body.commit_message
    );
    return c.json(result);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to merge PR" },
      500
    );
  }
});

// ============================================================================
// Issue Comments (PR conversation)
// ============================================================================

api.get("/pr/:owner/:repo/:number/conversation", async (c) => {
  const { owner, repo, number } = c.req.param();
  try {
    const comments = await getIssueComments(owner, repo, parseInt(number, 10));
    return c.json(comments);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch conversation" },
      500
    );
  }
});

api.post("/pr/:owner/:repo/:number/conversation", async (c) => {
  const { owner, repo, number } = c.req.param();
  const body = await c.req.json();

  try {
    const comment = await createIssueComment(
      owner,
      repo,
      parseInt(number, 10),
      body.body
    );
    return c.json(comment);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to add comment" },
      500
    );
  }
});

// ============================================================================
// File Content
// ============================================================================

api.get("/file/:owner/:repo", async (c) => {
  const { owner, repo } = c.req.param();
  const path = c.req.query("path");
  const ref = c.req.query("ref");

  if (!path || !ref) {
    return c.json({ error: "Missing path or ref query parameter" }, 400);
  }

  try {
    const content = await getFileContent(owner, repo, path, ref);
    return c.text(content);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch file content" },
      500
    );
  }
});

// Highlight file lines (for skip block expansion)
api.post("/highlight-lines", async (c) => {
  try {
    const body = await c.req.json();
    const { content, filename, startLine, count } = body;

    if (!content || !filename || !startLine || !count) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const lines = highlightFileLines(content, filename, startLine, count);
    return c.json(lines);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to highlight lines" },
      500
    );
  }
});

// ============================================================================
// User
// ============================================================================

api.get("/user", async (c) => {
  try {
    const user = await getCurrentUser();
    return c.json(user);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch user" },
      500
    );
  }
});

export default api;
