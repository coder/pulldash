import { execSync } from "child_process";

// Get GitHub token from gh CLI
let cachedToken: string | null = null;

export function getGitHubToken(): string {
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

// ============================================================================
// GraphQL API
// ============================================================================

async function graphqlFetch<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = getGitHubToken();
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub GraphQL error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL error: ${result.errors.map((e: { message: string }) => e.message).join(", ")}`);
  }

  return result.data;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
  mergeable_state: string;
  merged: boolean;
  merge_commit_sha: string | null;
  draft: boolean;
  labels: Array<{ name: string; color: string }>;
  requested_reviewers: Array<{ login: string; avatar_url: string }>;
  assignees: Array<{ login: string; avatar_url: string }>;
}

export interface CheckRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | null;
  html_url: string;
  started_at: string;
  completed_at: string | null;
}

export interface CombinedStatus {
  state: "success" | "failure" | "pending";
  statuses: Array<{
    state: "success" | "failure" | "pending" | "error";
    context: string;
    description: string | null;
    target_url: string | null;
  }>;
}

export interface Review {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING" | "DISMISSED";
  submitted_at: string;
}

export interface PendingReviewComment {
  path: string;
  line: number;
  start_line?: number;
  body: string;
  side: "LEFT" | "RIGHT";
  start_side?: "LEFT" | "RIGHT";
}

export interface PullRequestFile {
  sha: string;
  filename: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

export interface ReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  side: "LEFT" | "RIGHT";
  start_line: number | null;
  start_side: "LEFT" | "RIGHT" | null;
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  in_reply_to_id?: number;
  diff_hunk: string;
  // Thread resolution info (populated from GraphQL)
  pull_request_review_thread_id?: string;
  is_resolved?: boolean;
  resolved_by?: { login: string; avatar_url: string } | null;
}

async function githubFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getGitHubToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function getPullRequest(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequest> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`
  );
}

export async function getPullRequestFiles(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestFile[]> {
  const files: PullRequestFile[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const pageFiles = await githubFetch<PullRequestFile[]>(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`
    );
    files.push(...pageFiles);
    if (pageFiles.length < perPage) break;
    page++;
  }

  return files;
}

export async function getPullRequestComments(
  owner: string,
  repo: string,
  number: number
): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const pageComments = await githubFetch<ReviewComment[]>(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/comments?per_page=${perPage}&page=${page}`
    );
    comments.push(...pageComments);
    if (pageComments.length < perPage) break;
    page++;
  }

  return comments;
}

export async function createReviewComment(
  owner: string,
  repo: string,
  number: number,
  body: string,
  commitId: string,
  path: string,
  line: number,
  side: "LEFT" | "RIGHT" = "RIGHT"
): Promise<ReviewComment> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/comments`,
    {
      method: "POST",
      body: JSON.stringify({
        body,
        commit_id: commitId,
        path,
        line,
        side,
      }),
    }
  );
}

export async function replyToComment(
  owner: string,
  repo: string,
  number: number,
  commentId: number,
  body: string
): Promise<ReviewComment> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/comments/${commentId}/replies`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    }
  );
}

// ============================================================================
// Review APIs
// ============================================================================

export async function getReviews(
  owner: string,
  repo: string,
  number: number
): Promise<Review[]> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`
  );
}

export async function createReview(
  owner: string,
  repo: string,
  number: number,
  commitId: string,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body: string,
  comments: PendingReviewComment[]
): Promise<Review> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`,
    {
      method: "POST",
      body: JSON.stringify({
        commit_id: commitId,
        event,
        body,
        comments,
      }),
    }
  );
}

// Create a pending review (without submitting)
export async function createPendingReview(
  owner: string,
  repo: string,
  number: number,
  commitId: string
): Promise<Review> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`,
    {
      method: "POST",
      body: JSON.stringify({
        commit_id: commitId,
      }),
    }
  );
}

// Add a comment to a pending review
// Note: GitHub's REST API doesn't support adding individual comments to existing pending reviews.
// Comments must be submitted together when creating/submitting a review.
// This function creates a draft single-comment review that shows as "Pending"
export async function addPendingReviewComment(
  owner: string,
  repo: string,
  number: number,
  commitId: string,
  path: string,
  line: number,
  body: string,
  side: "LEFT" | "RIGHT" = "RIGHT",
  startLine?: number
): Promise<{ review: Review; comment: ReviewComment }> {
  // Create a new pending review with this single comment
  const comments: PendingReviewComment[] = [{
    path,
    line,
    body,
    side,
    start_line: startLine,
  }];
  
  // Create the review (it will be in PENDING state by default when no event is specified)
  const review = await githubFetch<Review>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`,
    {
      method: "POST",
      body: JSON.stringify({
        commit_id: commitId,
        comments,
      }),
    }
  );
  
  // Fetch the comments for this review to get the comment details
  const reviewComments = await getReviewComments(owner, repo, number, review.id);
  const comment = reviewComments[0];
  
  return { review, comment };
}

// Submit a pending review
export async function submitPendingReview(
  owner: string,
  repo: string,
  number: number,
  reviewId: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body?: string
): Promise<Review> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews/${reviewId}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        event,
        body: body || "",
      }),
    }
  );
}

// Delete a pending review
export async function deletePendingReview(
  owner: string,
  repo: string,
  number: number,
  reviewId: number
): Promise<void> {
  await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews/${reviewId}`,
    {
      method: "DELETE",
    }
  );
}

// Get comments for a specific review
export async function getReviewComments(
  owner: string,
  repo: string,
  number: number,
  reviewId: number
): Promise<ReviewComment[]> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews/${reviewId}/comments`
  );
}

// Update a review comment
export async function updateReviewComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string
): Promise<ReviewComment> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/comments/${commentId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }
  );
}

// Delete a review comment
export async function deleteReviewComment(
  owner: string,
  repo: string,
  commentId: number
): Promise<void> {
  await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/comments/${commentId}`,
    {
      method: "DELETE",
    }
  );
}

// ============================================================================
// Check Runs & Status
// ============================================================================

export async function getCheckRuns(
  owner: string,
  repo: string,
  ref: string
): Promise<{ check_runs: CheckRun[] }> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`
  );
}

export async function getCombinedStatus(
  owner: string,
  repo: string,
  ref: string
): Promise<CombinedStatus> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/status`
  );
}

// ============================================================================
// Merge Operations
// ============================================================================

export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  mergeMethod: "merge" | "squash" | "rebase" = "squash",
  commitTitle?: string,
  commitMessage?: string
): Promise<{ sha: string; merged: boolean; message: string }> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        merge_method: mergeMethod,
        commit_title: commitTitle,
        commit_message: commitMessage,
      }),
    }
  );
}

// ============================================================================
// Issue Comments (for PR body/conversation)
// ============================================================================

export interface IssueComment {
  id: number;
  body: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
}

export async function getIssueComments(
  owner: string,
  repo: string,
  number: number
): Promise<IssueComment[]> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`
  );
}

export async function createIssueComment(
  owner: string,
  repo: string,
  number: number,
  body: string
): Promise<IssueComment> {
  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    }
  );
}

// ============================================================================
// GraphQL Mutations for Pending Reviews
// ============================================================================

// Get the node ID of a pull request (needed for GraphQL mutations)
export async function getPullRequestNodeId(
  owner: string,
  repo: string,
  number: number
): Promise<string> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          id
        }
      }
    }
  `;

  const data = await graphqlFetch<{
    repository: { pullRequest: { id: string } };
  }>(query, { owner, repo, number });

  return data.repository.pullRequest.id;
}

// Get user's pending review for a PR
export async function getPendingReviewNodeId(
  owner: string,
  repo: string,
  number: number
): Promise<{ reviewId: string; comments: Array<{ id: string; databaseId: number; body: string; path: string; line: number; startLine: number | null }> } | null> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
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
  `;

  const data = await graphqlFetch<{
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
  }>(query, { owner, repo, number });

  // Find the user's pending review
  const pendingReview = data.repository.pullRequest.reviews.nodes.find(
    (r) => r.viewerDidAuthor
  );

  if (!pendingReview) return null;

  return {
    reviewId: pendingReview.id,
    comments: pendingReview.comments.nodes.map((c) => ({
      id: c.id,
      databaseId: c.databaseId,
      body: c.body,
      path: c.path,
      line: c.line,
      startLine: c.startLine,
    })),
  };
}

// Add a comment to a pending review (creates the review if it doesn't exist)
export async function addPendingReviewCommentGraphQL(
  pullRequestId: string,
  path: string,
  line: number,
  body: string,
  startLine?: number
): Promise<{ reviewId: string; commentId: string; commentDatabaseId: number }> {
  const query = `
    mutation($input: AddPullRequestReviewCommentInput!) {
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
  `;

  const input: Record<string, unknown> = {
    pullRequestId,
    path,
    line,
    body,
  };

  // For multi-line comments
  if (startLine && startLine !== line) {
    input.startLine = startLine;
  }

  const data = await graphqlFetch<{
    addPullRequestReviewComment: {
      comment: {
        id: string;
        databaseId: number;
        pullRequestReview: { id: string };
      };
    };
  }>(query, { input });

  return {
    reviewId: data.addPullRequestReviewComment.comment.pullRequestReview.id,
    commentId: data.addPullRequestReviewComment.comment.id,
    commentDatabaseId: data.addPullRequestReviewComment.comment.databaseId,
  };
}

// Delete a pending review comment
export async function deletePendingReviewCommentGraphQL(
  commentId: string
): Promise<void> {
  const query = `
    mutation($input: DeletePullRequestReviewCommentInput!) {
      deletePullRequestReviewComment(input: $input) {
        pullRequestReview {
          id
        }
      }
    }
  `;

  await graphqlFetch(query, { input: { id: commentId } });
}

// Update a pending review comment body
export async function updatePendingReviewCommentGraphQL(
  commentId: string,
  body: string
): Promise<void> {
  const query = `
    mutation($input: UpdatePullRequestReviewCommentInput!) {
      updatePullRequestReviewComment(input: $input) {
        pullRequestReviewComment {
          id
          body
        }
      }
    }
  `;

  await graphqlFetch(query, { input: { pullRequestReviewCommentId: commentId, body } });
}

// Submit a pending review
export async function submitPendingReviewGraphQL(
  reviewId: string,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body?: string
): Promise<void> {
  const query = `
    mutation($input: SubmitPullRequestReviewInput!) {
      submitPullRequestReview(input: $input) {
        pullRequestReview {
          id
          state
        }
      }
    }
  `;

  await graphqlFetch(query, {
    input: {
      pullRequestReviewId: reviewId,
      event,
      body: body || "",
    },
  });
}

// ============================================================================
// Review Thread Resolution (GraphQL)
// ============================================================================

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  resolvedBy: { login: string; avatarUrl: string } | null;
  comments: Array<{
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
}

// Get all review threads for a PR (includes resolution status)
export async function getReviewThreads(
  owner: string,
  repo: string,
  number: number
): Promise<ReviewThread[]> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
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
  `;

  const data = await graphqlFetch<{
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
  }>(query, { owner, repo, number });

  return data.repository.pullRequest.reviewThreads.nodes.map((thread) => ({
    id: thread.id,
    isResolved: thread.isResolved,
    resolvedBy: thread.resolvedBy,
    comments: thread.comments.nodes,
  }));
}

// Resolve a review thread
export async function resolveReviewThread(threadId: string): Promise<void> {
  const query = `
    mutation($input: ResolveReviewThreadInput!) {
      resolveReviewThread(input: $input) {
        thread {
          id
          isResolved
        }
      }
    }
  `;

  await graphqlFetch(query, { input: { threadId } });
}

// Unresolve a review thread
export async function unresolveReviewThread(threadId: string): Promise<void> {
  const query = `
    mutation($input: UnresolveReviewThreadInput!) {
      unresolveReviewThread(input: $input) {
        thread {
          id
          isResolved
        }
      }
    }
  `;

  await graphqlFetch(query, { input: { threadId } });
}

// ============================================================================
// Current User API
// ============================================================================

export interface GitHubUser {
  login: string;
  avatar_url: string;
  id: number;
  name: string | null;
}

export async function getCurrentUser(): Promise<GitHubUser> {
  return githubFetch("https://api.github.com/user");
}

// ============================================================================
// File Content APIs
// ============================================================================

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  const token = getGitHubToken();
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      return ""; // File doesn't exist at this ref
    }
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${error}`);
  }

  return response.text();
}

