import { components } from "@octokit/openapi-types";

// REST API types - re-exported from Octokit schemas
export type PullRequest = components["schemas"]["pull-request"];
export type PullRequestFile = components["schemas"]["diff-entry"];
export type ReviewComment = components["schemas"]["pull-request-review-comment"] & {
  // Thread resolution info (enriched from GraphQL)
  pull_request_review_thread_id?: string;
  is_resolved?: boolean;
  resolved_by?: { login: string; avatar_url: string } | null;
};
export type Review = components["schemas"]["pull-request-review"];
export type CheckRun = components["schemas"]["check-run"];
export type CombinedStatus = components["schemas"]["combined-commit-status"];
export type IssueComment = components["schemas"]["issue-comment"];
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
