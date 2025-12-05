import { components } from "@octokit/openapi-types";

// REST API types - re-exported from Octokit schemas
// Extended types include body_html from GitHub's HTML media type (application/vnd.github.html+json)
export type PullRequest = components["schemas"]["pull-request"] & {
  body_html?: string;
};
export type PullRequestFile = components["schemas"]["diff-entry"];
export type ReviewComment =
  components["schemas"]["pull-request-review-comment"] & {
    // Thread resolution info (enriched from GraphQL)
    pull_request_review_thread_id?: string;
    is_resolved?: boolean;
    resolved_by?: { login: string; avatar_url: string } | null;
    /** Pre-rendered HTML with signed attachment URLs from GitHub's API */
    body_html?: string;
  };
export type Review = components["schemas"]["pull-request-review"] & {
  body_html?: string;
};
export type CheckRun = components["schemas"]["check-run"];
export type CombinedStatus = components["schemas"]["combined-commit-status"];
export type IssueComment = components["schemas"]["issue-comment"] & {
  body_html?: string;
};
export type GitHubUser = components["schemas"]["public-user"];

// GraphQL-only types (not in REST API schemas)
export interface PendingReviewComment {
  path: string;
  line: number;
  start_line?: number;
  body: string;
  side: "LEFT" | "RIGHT";
  start_side?: "LEFT" | "RIGHT";
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  resolvedBy: { login: string; avatarUrl: string } | null;
  comments: Array<{
    id: string;
    databaseId: number;
    body: string;
    /** Pre-rendered HTML with signed attachment URLs from GitHub's GraphQL API */
    bodyHTML?: string;
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
