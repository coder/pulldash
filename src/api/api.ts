import { Hono } from "hono";
import {
  getPullRequest,
  getPullRequestFiles,
  getPullRequestComments,
  createReviewComment,
  replyToComment,
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
    return c.json(parsed);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to parse diff" },
      500
    );
  }
});

export default api;
