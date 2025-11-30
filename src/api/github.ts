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

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
  draft: boolean;
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

