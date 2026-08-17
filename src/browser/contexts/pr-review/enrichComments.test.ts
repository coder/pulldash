import { test, expect } from "bun:test";
import type { ReviewComment } from "@/api/types";
import type { ReviewThread } from "@/browser/contexts/github";
import { enrichCommentsWithThreads } from "./enrichComments";

function createComment(id: number): ReviewComment {
  return { id, body: `comment ${id}` } as ReviewComment;
}

function createThread(
  id: string,
  commentIds: number[],
  options?: {
    isResolved?: boolean;
    resolvedBy?: { login: string; avatarUrl: string } | null;
  }
): ReviewThread {
  return {
    id,
    isResolved: options?.isResolved ?? false,
    resolvedBy: options?.resolvedBy ?? null,
    pullRequestReview: null,
    comments: {
      nodes: commentIds.map((databaseId) => ({
        id: `gql-${databaseId}`,
        databaseId,
        body: "",
        path: "file.ts",
        line: 1,
        originalLine: 1,
        startLine: null,
        diffHunk: null,
        author: null,
        createdAt: "",
        updatedAt: "",
        replyTo: null,
      })),
    },
  };
}

test("enrichCommentsWithThreads attaches resolution info to every comment in a thread", () => {
  const comments = [createComment(1), createComment(2), createComment(3)];
  const threads = [
    createThread("THREAD_A", [1, 2], {
      isResolved: true,
      resolvedBy: { login: "alice", avatarUrl: "https://a.png" },
    }),
    createThread("THREAD_B", [3]),
  ];

  const enriched = enrichCommentsWithThreads(comments, threads);

  expect(enriched[0]?.pull_request_review_thread_id).toBe("THREAD_A");
  expect(enriched[0]?.is_resolved).toBe(true);
  expect(enriched[0]?.resolved_by).toEqual({
    login: "alice",
    avatar_url: "https://a.png",
  });
  expect(enriched[1]?.is_resolved).toBe(true);
  expect(enriched[2]?.pull_request_review_thread_id).toBe("THREAD_B");
  expect(enriched[2]?.is_resolved).toBe(false);
  expect(enriched[2]?.resolved_by).toBeNull();
});

test("enrichCommentsWithThreads leaves comments without a matching thread untouched", () => {
  const comments = [createComment(1), createComment(99)];
  const threads = [createThread("THREAD_A", [1], { isResolved: true })];

  const enriched = enrichCommentsWithThreads(comments, threads);

  expect(enriched[0]?.is_resolved).toBe(true);
  expect(enriched[1]).toBe(comments[1]!);
  expect(enriched[1]?.is_resolved).toBeUndefined();
});

test("enrichCommentsWithThreads returns comments as-is when there are no threads", () => {
  const comments = [createComment(1)];
  expect(enrichCommentsWithThreads(comments, [])).toBe(comments);
});
