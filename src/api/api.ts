import { Hono } from "hono";
import { Octokit } from "@octokit/core";
import { execSync } from "child_process";
import { parseDiffWithHighlighting, highlightFileLines } from "./diff";

// ============================================================================
// GitHub Token & Octokit Setup
// ============================================================================

let cachedToken: string | null = null;

function getGitHubToken(): string {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = execSync("gh auth token", { encoding: "utf-8" }).trim();
    return cachedToken;
  } catch {
    throw new Error(
      "Failed to get GitHub token. Make sure gh CLI is authenticated: gh auth login"
    );
  }
}

const octokit = new Octokit({ auth: getGitHubToken() });

// ============================================================================
// GraphQL Helper
// ============================================================================

async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const response = await octokit.graphql<T>(query, variables);
  return response;
}

// ============================================================================
// API Routes (Chained for Type Inference)
// ============================================================================

const api = new Hono()
  .basePath("/api")

  // -------------------------------------------------------------------------
  // User
  // -------------------------------------------------------------------------
  .get("/user", async (c) => {
    const { data } = await octokit.request("GET /user");
    return c.json(data);
  })

  // -------------------------------------------------------------------------
  // Pull Request
  // -------------------------------------------------------------------------
  .get("/pr/:owner/:repo/:number", async (c) => {
    const { owner, repo, number } = c.req.param();
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
      }
    );
    return c.json(data);
  })

  .get("/pr/:owner/:repo/:number/files", async (c) => {
    const { owner, repo, number } = c.req.param();
    const pullNumber = parseInt(number, 10);

    // Paginate to get all files
    const files: Awaited<
      ReturnType<
        typeof octokit.request<"GET /repos/{owner}/{repo}/pulls/{pull_number}/files">
      >
    >["data"] = [];
    let page = 1;

    while (true) {
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
        {
          owner,
          repo,
          pull_number: pullNumber,
          per_page: 100,
          page,
        }
      );
      files.push(...data);
      if (data.length < 100) break;
      page++;
    }

    return c.json(files);
  })

  .get("/pr/:owner/:repo/:number/comments", async (c) => {
    const { owner, repo, number } = c.req.param();
    const pullNumber = parseInt(number, 10);

    // Paginate to get all comments
    const comments: Awaited<
      ReturnType<
        typeof octokit.request<"GET /repos/{owner}/{repo}/pulls/{pull_number}/comments">
      >
    >["data"] = [];
    let page = 1;

    while (true) {
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
        {
          owner,
          repo,
          pull_number: pullNumber,
          per_page: 100,
          page,
        }
      );
      comments.push(...data);
      if (data.length < 100) break;
      page++;
    }

    // Get thread resolution info from GraphQL
    const threadsData = await graphql<{
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: Array<{
              id: string;
              isResolved: boolean;
              resolvedBy: { login: string; avatarUrl: string } | null;
              comments: {
                nodes: Array<{ databaseId: number }>;
              };
            }>;
          };
        };
      };
    }>(
      `
        query ($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  resolvedBy {
                    login
                    avatarUrl
                  }
                  comments(first: 100) {
                    nodes {
                      databaseId
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { owner, repo, number: pullNumber }
    );

    // Map comment ID to thread info
    const commentToThread = new Map<
      number,
      {
        threadId: string;
        isResolved: boolean;
        resolvedBy: { login: string; avatar_url: string } | null;
      }
    >();

    for (const thread of threadsData.repository.pullRequest.reviewThreads
      .nodes) {
      for (const comment of thread.comments.nodes) {
        commentToThread.set(comment.databaseId, {
          threadId: thread.id,
          isResolved: thread.isResolved,
          resolvedBy: thread.resolvedBy
            ? {
                login: thread.resolvedBy.login,
                avatar_url: thread.resolvedBy.avatarUrl,
              }
            : null,
        });
      }
    }

    // Enrich comments with thread info
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
  })

  .post("/pr/:owner/:repo/:number/comments", async (c) => {
    const { owner, repo, number } = c.req.param();
    const pullNumber = parseInt(number, 10);
    const body = await c.req.json<{
      body: string;
      reply_to_id?: number;
      commit_id?: string;
      path?: string;
      line?: number;
      side?: "LEFT" | "RIGHT";
    }>();

    if (body.reply_to_id) {
      const { data } = await octokit.request(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
        {
          owner,
          repo,
          pull_number: pullNumber,
          comment_id: body.reply_to_id,
          body: body.body,
        }
      );
      return c.json(data);
    }

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      {
        owner,
        repo,
        pull_number: pullNumber,
        body: body.body,
        commit_id: body.commit_id!,
        path: body.path!,
        line: body.line!,
        side: body.side ?? "RIGHT",
      }
    );
    return c.json(data);
  })

  // -------------------------------------------------------------------------
  // Review Threads
  // -------------------------------------------------------------------------
  .get("/pr/:owner/:repo/:number/threads", async (c) => {
    const { owner, repo, number } = c.req.param();
    const pullNumber = parseInt(number, 10);

    const data = await graphql<{
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: Array<{
              id: string;
              isResolved: boolean;
              resolvedBy: { login: string; avatarUrl: string } | null;
              comments: {
                nodes: Array<{
                  id: string;
                  databaseId: number;
                  body: string;
                  path: string;
                  line: number | null;
                  originalLine: number | null;
                  startLine: number | null;
                  author: { login: string; avatarUrl: string } | null;
                  createdAt: string;
                  updatedAt: string;
                  replyTo: { databaseId: number } | null;
                }>;
              };
            }>;
          };
        };
      };
    }>(
      `
        query ($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  resolvedBy {
                    login
                    avatarUrl
                  }
                  comments(first: 100) {
                    nodes {
                      id
                      databaseId
                      body
                      path
                      line
                      originalLine
                      startLine
                      author {
                        login
                        avatarUrl
                      }
                      createdAt
                      updatedAt
                      replyTo {
                        databaseId
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { owner, repo, number: pullNumber }
    );

    const threads = data.repository.pullRequest.reviewThreads.nodes.map(
      (thread) => ({
        id: thread.id,
        isResolved: thread.isResolved,
        resolvedBy: thread.resolvedBy,
        comments: thread.comments.nodes,
      })
    );

    return c.json(threads);
  })

  .post("/pr/:owner/:repo/:number/threads/:threadId/resolve", async (c) => {
    const { threadId } = c.req.param();

    await graphql(
      `
        mutation ($input: ResolveReviewThreadInput!) {
          resolveReviewThread(input: $input) {
            thread {
              id
              isResolved
            }
          }
        }
      `,
      { input: { threadId } }
    );

    return c.json({ success: true });
  })

  .post("/pr/:owner/:repo/:number/threads/:threadId/unresolve", async (c) => {
    const { threadId } = c.req.param();

    await graphql(
      `
        mutation ($input: UnresolveReviewThreadInput!) {
          unresolveReviewThread(input: $input) {
            thread {
              id
              isResolved
            }
          }
        }
      `,
      { input: { threadId } }
    );

    return c.json({ success: true });
  })

  // -------------------------------------------------------------------------
  // Reviews
  // -------------------------------------------------------------------------
  .get("/pr/:owner/:repo/:number/reviews", async (c) => {
    const { owner, repo, number } = c.req.param();
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
      }
    );
    return c.json(data);
  })

  .post("/pr/:owner/:repo/:number/reviews", async (c) => {
    const { owner, repo, number } = c.req.param();
    const body = await c.req.json<{
      commit_id: string;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
      comments?: Array<{
        path: string;
        line: number;
        body: string;
        side?: "LEFT" | "RIGHT";
        start_line?: number;
        start_side?: "LEFT" | "RIGHT";
      }>;
    }>();

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
        commit_id: body.commit_id,
        event: body.event,
        body: body.body ?? "",
        comments: body.comments ?? [],
      }
    );
    return c.json(data);
  })

  .post("/pr/:owner/:repo/:number/reviews/pending", async (c) => {
    const { owner, repo, number } = c.req.param();
    const body = await c.req.json<{ commit_id: string }>();

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
        commit_id: body.commit_id,
      }
    );
    return c.json(data);
  })

  .post("/pr/:owner/:repo/:number/reviews/:reviewId/submit", async (c) => {
    const { owner, repo, number, reviewId } = c.req.param();
    const body = await c.req.json<{
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    }>();

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
        review_id: parseInt(reviewId, 10),
        event: body.event,
        body: body.body ?? "",
      }
    );
    return c.json(data);
  })

  .delete("/pr/:owner/:repo/:number/reviews/:reviewId", async (c) => {
    const { owner, repo, number, reviewId } = c.req.param();

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
        review_id: parseInt(reviewId, 10),
      }
    );
    return c.json({ success: true });
  })

  .get("/pr/:owner/:repo/:number/reviews/:reviewId/comments", async (c) => {
    const { owner, repo, number, reviewId } = c.req.param();

    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
        review_id: parseInt(reviewId, 10),
      }
    );
    return c.json(data);
  })

  // -------------------------------------------------------------------------
  // GraphQL Pending Review APIs
  // -------------------------------------------------------------------------
  .get("/pr/:owner/:repo/:number/node-id", async (c) => {
    const { owner, repo, number } = c.req.param();

    const data = await graphql<{
      repository: { pullRequest: { id: string } };
    }>(
      `
        query ($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              id
            }
          }
        }
      `,
      { owner, repo, number: parseInt(number, 10) }
    );

    return c.json({ nodeId: data.repository.pullRequest.id });
  })

  .get("/pr/:owner/:repo/:number/pending-review", async (c) => {
    const { owner, repo, number } = c.req.param();

    const data = await graphql<{
      repository: {
        pullRequest: {
          reviews: {
            nodes: Array<{
              id: string;
              databaseId: number;
              viewerDidAuthor: boolean;
              comments: {
                nodes: Array<{
                  id: string;
                  databaseId: number;
                  body: string;
                  path: string;
                  line: number;
                  startLine: number | null;
                }>;
              };
            }>;
          };
        };
      };
    }>(
      `
        query ($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              reviews(first: 10, states: [PENDING]) {
                nodes {
                  id
                  databaseId
                  viewerDidAuthor
                  comments(first: 100) {
                    nodes {
                      id
                      databaseId
                      body
                      path
                      line
                      startLine
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { owner, repo, number: parseInt(number, 10) }
    );

    const pendingReview = data.repository.pullRequest.reviews.nodes.find(
      (r) => r.viewerDidAuthor
    );

    if (!pendingReview) {
      return c.json(null);
    }

    return c.json({
      reviewId: pendingReview.id,
      comments: pendingReview.comments.nodes.map((c) => ({
        id: c.id,
        databaseId: c.databaseId,
        body: c.body,
        path: c.path,
        line: c.line,
        startLine: c.startLine,
      })),
    });
  })

  .post("/pr/:owner/:repo/:number/pending-comment", async (c) => {
    const { owner, repo, number } = c.req.param();
    const body = await c.req.json<{
      pull_request_id?: string;
      path: string;
      line: number;
      body: string;
      start_line?: number;
    }>();

    // Get PR node ID if not provided
    let pullRequestId = body.pull_request_id;
    if (!pullRequestId) {
      const prData = await graphql<{
        repository: { pullRequest: { id: string } };
      }>(
        `
          query ($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              pullRequest(number: $number) {
                id
              }
            }
          }
        `,
        { owner, repo, number: parseInt(number, 10) }
      );
      pullRequestId = prData.repository.pullRequest.id;
    }

    const input: Record<string, unknown> = {
      pullRequestId,
      path: body.path,
      line: body.line,
      body: body.body,
    };

    if (body.start_line && body.start_line !== body.line) {
      input.startLine = body.start_line;
    }

    const data = await graphql<{
      addPullRequestReviewComment: {
        comment: {
          id: string;
          databaseId: number;
          pullRequestReview: { id: string };
        };
      };
    }>(
      `
        mutation ($input: AddPullRequestReviewCommentInput!) {
          addPullRequestReviewComment(input: $input) {
            comment {
              id
              databaseId
              pullRequestReview {
                id
              }
            }
          }
        }
      `,
      { input }
    );

    return c.json({
      reviewId: data.addPullRequestReviewComment.comment.pullRequestReview.id,
      commentId: data.addPullRequestReviewComment.comment.id,
      commentDatabaseId: data.addPullRequestReviewComment.comment.databaseId,
    });
  })

  .delete("/pr/:owner/:repo/:number/pending-comment/:commentId", async (c) => {
    const { commentId } = c.req.param();

    await graphql(
      `
        mutation ($input: DeletePullRequestReviewCommentInput!) {
          deletePullRequestReviewComment(input: $input) {
            pullRequestReview {
              id
            }
          }
        }
      `,
      { input: { id: commentId } }
    );

    return c.json({ success: true });
  })

  .patch("/pr/:owner/:repo/:number/pending-comment/:commentId", async (c) => {
    const { commentId } = c.req.param();
    const body = await c.req.json<{ body: string }>();

    await graphql(
      `
        mutation ($input: UpdatePullRequestReviewCommentInput!) {
          updatePullRequestReviewComment(input: $input) {
            pullRequestReviewComment {
              id
              body
            }
          }
        }
      `,
      { input: { pullRequestReviewCommentId: commentId, body: body.body } }
    );

    return c.json({ success: true });
  })

  .post("/pr/:owner/:repo/:number/pending-review/submit", async (c) => {
    const body = await c.req.json<{
      review_id: string;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    }>();

    await graphql(
      `
        mutation ($input: SubmitPullRequestReviewInput!) {
          submitPullRequestReview(input: $input) {
            pullRequestReview {
              id
              state
            }
          }
        }
      `,
      {
        input: {
          pullRequestReviewId: body.review_id,
          event: body.event,
          body: body.body ?? "",
        },
      }
    );

    return c.json({ success: true });
  })

  // -------------------------------------------------------------------------
  // Review Comments
  // -------------------------------------------------------------------------
  .patch("/pr/:owner/:repo/comments/:commentId", async (c) => {
    const { owner, repo, commentId } = c.req.param();
    const body = await c.req.json<{ body: string }>();

    const { data } = await octokit.request(
      "PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}",
      {
        owner,
        repo,
        comment_id: parseInt(commentId, 10),
        body: body.body,
      }
    );
    return c.json(data);
  })

  .delete("/pr/:owner/:repo/comments/:commentId", async (c) => {
    const { owner, repo, commentId } = c.req.param();

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}",
      {
        owner,
        repo,
        comment_id: parseInt(commentId, 10),
      }
    );
    return c.json({ success: true });
  })

  // -------------------------------------------------------------------------
  // Checks & Status
  // -------------------------------------------------------------------------
  .get("/pr/:owner/:repo/:number/checks", async (c) => {
    const { owner, repo, number } = c.req.param();

    const { data: pr } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
      }
    );

    const [checkRunsResponse, statusResponse] = await Promise.all([
      octokit.request("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
        owner,
        repo,
        ref: pr.head.sha,
      }),
      octokit.request("GET /repos/{owner}/{repo}/commits/{ref}/status", {
        owner,
        repo,
        ref: pr.head.sha,
      }),
    ]);

    return c.json({
      checkRuns: checkRunsResponse.data.check_runs,
      status: statusResponse.data,
    });
  })

  // -------------------------------------------------------------------------
  // Merge
  // -------------------------------------------------------------------------
  .post("/pr/:owner/:repo/:number/merge", async (c) => {
    const { owner, repo, number } = c.req.param();
    const body = await c.req.json<{
      merge_method?: "merge" | "squash" | "rebase";
      commit_title?: string;
      commit_message?: string;
    }>();

    const { data } = await octokit.request(
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge",
      {
        owner,
        repo,
        pull_number: parseInt(number, 10),
        merge_method: body.merge_method ?? "squash",
        commit_title: body.commit_title,
        commit_message: body.commit_message,
      }
    );
    return c.json(data);
  })

  // -------------------------------------------------------------------------
  // Issue Comments (PR conversation)
  // -------------------------------------------------------------------------
  .get("/pr/:owner/:repo/:number/conversation", async (c) => {
    const { owner, repo, number } = c.req.param();

    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner,
        repo,
        issue_number: parseInt(number, 10),
      }
    );
    return c.json(data);
  })

  .post("/pr/:owner/:repo/:number/conversation", async (c) => {
    const { owner, repo, number } = c.req.param();
    const body = await c.req.json<{ body: string }>();

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner,
        repo,
        issue_number: parseInt(number, 10),
        body: body.body,
      }
    );
    return c.json(data);
  })

  // -------------------------------------------------------------------------
  // File Content
  // -------------------------------------------------------------------------
  .get("/file/:owner/:repo", async (c) => {
    const { owner, repo } = c.req.param();
    const path = c.req.query("path");
    const ref = c.req.query("ref");

    if (!path || !ref) {
      return c.json({ error: "Missing path or ref query parameter" }, 400);
    }

    try {
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner,
          repo,
          path,
          ref,
          headers: {
            Accept: "application/vnd.github.raw+json",
          },
        }
      );
      return c.text(response.data as unknown as string);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404
      ) {
        return c.text("");
      }
      throw error;
    }
  })

  // -------------------------------------------------------------------------
  // Diff Parsing
  // -------------------------------------------------------------------------
  .post("/parse-diff", async (c) => {
    const body = await c.req.json<{
      patch: string;
      filename: string;
      previousFilename?: string;
      sha?: string;
    }>();

    if (!body.patch || !body.filename) {
      return c.json({ error: "Missing patch or filename" }, 400);
    }

    const parsed = parseDiffWithHighlighting(
      body.patch,
      body.filename,
      body.previousFilename,
      body.sha
    );

    if (body.sha) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
      c.header("ETag", `"${body.sha}"`);
    }

    return c.json(parsed);
  })

  .post("/highlight-lines", async (c) => {
    const body = await c.req.json<{
      content: string;
      filename: string;
      startLine: number;
      count: number;
    }>();

    if (!body.content || !body.filename || !body.startLine || !body.count) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const lines = highlightFileLines(
      body.content,
      body.filename,
      body.startLine,
      body.count
    );
    return c.json(lines);
  });

export default api;
export type AppType = typeof api;
