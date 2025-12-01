import { Hono } from "hono";
import {
  getPullRequest,
  getPullRequestFiles,
  getPullRequestComments,
  createReviewComment,
  replyToComment,
  getReviews,
  createReview,
  getCheckRuns,
  getCombinedStatus,
  mergePullRequest,
  getIssueComments,
  createIssueComment,
} from "./github";
import { parseDiffWithHighlighting } from "./diff";

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

// Get PR comments
api.get("/pr/:owner/:repo/:number/comments", async (c) => {
  const { owner, repo, number } = c.req.param();
  try {
    const comments = await getPullRequestComments(
      owner,
      repo,
      parseInt(number, 10)
    );
    return c.json(comments);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to fetch comments" },
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

// Submit a review
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

export default api;
