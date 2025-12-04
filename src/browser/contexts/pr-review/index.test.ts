import { test, expect, beforeEach } from "bun:test";
import type { PullRequest, PullRequestFile, ReviewComment } from "@/api/types";
import { PRReviewStore, sortFilesLikeTree } from "./index";

// Mock localStorage
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  key: () => null,
  length: 0,
};

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPR(overrides?: Partial<PullRequest>): PullRequest {
  return {
    number: 1,
    title: "Test PR",
    state: "open",
    html_url: "https://github.com/test/repo/pull/1",
    user: { login: "testuser", avatar_url: "https://example.com/avatar.png" },
    body: "Test body",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    head: { ref: "feature", sha: "abc123" },
    base: { ref: "main", sha: "def456" },
    merged: false,
    draft: false,
    ...overrides,
  } as PullRequest;
}

function createMockFile(filename: string): PullRequestFile {
  return {
    sha: "abc123",
    filename,
    status: "modified",
    additions: 10,
    deletions: 5,
    changes: 15,
    patch: "@@ -1,3 +1,4 @@\n line1\n+added\n line2",
  } as PullRequestFile;
}

function createMockComment(
  id: number,
  path: string,
  line: number
): ReviewComment {
  return {
    id,
    node_id: `comment_${id}`,
    path,
    line,
    body: `Comment ${id}`,
    user: { login: "reviewer", avatar_url: "https://example.com/avatar.png" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as ReviewComment;
}

function createStore(overrides?: {
  files?: PullRequestFile[];
  comments?: ReviewComment[];
}) {
  return new PRReviewStore({
    pr: createMockPR(),
    files: overrides?.files ?? [
      createMockFile("src/index.ts"),
      createMockFile("src/utils.ts"),
      createMockFile("README.md"),
    ],
    comments: overrides?.comments ?? [],
    owner: "test",
    repo: "repo",
    viewerPermission: "WRITE",
  });
}

beforeEach(() => {
  storage.clear();
});

// ============================================================================
// sortFilesLikeTree
// ============================================================================

test("sortFilesLikeTree places folders before files", () => {
  const files = [
    createMockFile("README.md"),
    createMockFile("src/index.ts"),
    createMockFile("package.json"),
  ];

  const sorted = sortFilesLikeTree(files);

  // Folders (src/) come before root-level files, then alphabetically
  expect(sorted.map((f) => f.filename)).toEqual([
    "src/index.ts",
    "package.json",
    "README.md",
  ]);
});

test("sortFilesLikeTree sorts nested folders correctly", () => {
  const files = [
    createMockFile("src/components/Button.tsx"),
    createMockFile("src/index.ts"),
    createMockFile("src/components/Dialog.tsx"),
    createMockFile("src/utils/helpers.ts"),
  ];

  const sorted = sortFilesLikeTree(files);

  // Folders first at each level, then alphabetically
  expect(sorted.map((f) => f.filename)).toEqual([
    "src/components/Button.tsx",
    "src/components/Dialog.tsx",
    "src/utils/helpers.ts",
    "src/index.ts",
  ]);
});

// ============================================================================
// File Navigation
// ============================================================================

test("selectFile updates selectedFile and clears showOverview", () => {
  const store = createStore();
  const state = () => store.getSnapshot();

  expect(state().selectedFile).toBeNull();
  expect(state().showOverview).toBe(true);

  store.selectFile("src/index.ts");

  expect(state().selectedFile).toBe("src/index.ts");
  expect(state().showOverview).toBe(false);
});

test("selectFile clears line selection state", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.setFocusedLine(10, "new");
  store.setSelectionAnchor(5, "new");

  store.selectFile("src/utils.ts");

  const state = store.getSnapshot();
  expect(state.focusedLine).toBeNull();
  expect(state.selectionAnchor).toBeNull();
});

test("selectOverview resets to overview state", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.setFocusedLine(10, "new");

  store.selectOverview();

  const state = store.getSnapshot();
  expect(state.showOverview).toBe(true);
  expect(state.selectedFile).toBeNull();
  expect(state.focusedLine).toBeNull();
});

test("navigateToFile moves between files", () => {
  const store = createStore({
    files: [
      createMockFile("a.ts"),
      createMockFile("b.ts"),
      createMockFile("c.ts"),
    ],
  });

  store.selectFile("b.ts");
  store.navigateToFile("next");
  expect(store.getSnapshot().selectedFile).toBe("c.ts");

  store.navigateToFile("prev");
  expect(store.getSnapshot().selectedFile).toBe("b.ts");

  store.navigateToFile("prev");
  expect(store.getSnapshot().selectedFile).toBe("a.ts");

  // Should not go below first file
  store.navigateToFile("prev");
  expect(store.getSnapshot().selectedFile).toBe("a.ts");
});

// ============================================================================
// Viewed Files
// ============================================================================

test("toggleViewed marks file as viewed", () => {
  const store = createStore();

  expect(store.getSnapshot().viewedFiles.has("src/index.ts")).toBe(false);

  store.toggleViewed("src/index.ts");

  expect(store.getSnapshot().viewedFiles.has("src/index.ts")).toBe(true);
});

test("toggleViewed persists to localStorage", () => {
  const store = createStore();
  store.toggleViewed("src/index.ts");

  const stored = storage.get("pr-test-repo-1-viewed");
  expect(stored).toBeDefined();
  expect(JSON.parse(stored!)).toContain("src/index.ts");
});

test("toggleViewed unmarks viewed file", () => {
  const store = createStore();
  store.toggleViewed("src/index.ts");
  store.toggleViewed("src/index.ts");

  expect(store.getSnapshot().viewedFiles.has("src/index.ts")).toBe(false);
});

test("toggleViewedMultiple marks multiple files", () => {
  const store = createStore();

  store.toggleViewedMultiple(["src/index.ts", "src/utils.ts"]);

  const { viewedFiles } = store.getSnapshot();
  expect(viewedFiles.has("src/index.ts")).toBe(true);
  expect(viewedFiles.has("src/utils.ts")).toBe(true);
});

// ============================================================================
// Line Selection
// ============================================================================

test("setFocusedLine updates line focus", () => {
  const store = createStore();
  store.selectFile("src/index.ts");

  store.setFocusedLine(42, "new");

  const state = store.getSnapshot();
  expect(state.focusedLine).toBe(42);
  expect(state.focusedLineSide).toBe("new");
});

test("setFocusedLine clears skip block focus", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.setFocusedSkipBlock(0);

  store.setFocusedLine(10, "new");

  expect(store.getSnapshot().focusedSkipBlockIndex).toBeNull();
});

test("setSelectionAnchor creates range selection", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.setFocusedLine(10, "new");
  store.setSelectionAnchor(5, "new");

  const state = store.getSnapshot();
  expect(state.focusedLine).toBe(10);
  expect(state.selectionAnchor).toBe(5);
});

test("clearLineSelection resets all line state", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.setFocusedLine(10, "new");
  store.setSelectionAnchor(5, "new");
  store.startCommenting(10, 5);

  store.clearLineSelection();

  const state = store.getSnapshot();
  expect(state.focusedLine).toBeNull();
  expect(state.selectionAnchor).toBeNull();
  expect(state.commentingOnLine).toBeNull();
});

// ============================================================================
// Commenting
// ============================================================================

test("startCommenting sets commenting state", () => {
  const store = createStore();
  store.selectFile("src/index.ts");

  store.startCommenting(42, 38);

  const state = store.getSnapshot();
  expect(state.commentingOnLine).toEqual({ line: 42, startLine: 38 });
});

test("cancelCommenting clears commenting state", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.startCommenting(42);

  store.cancelCommenting();

  expect(store.getSnapshot().commentingOnLine).toBeNull();
});

test("addPendingComment adds comment and clears selection", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.setFocusedLine(10, "new");
  store.startCommenting(10);

  store.addPendingComment({
    id: "local-1",
    path: "src/index.ts",
    line: 10,
    body: "Test comment",
    side: "RIGHT",
  });

  const state = store.getSnapshot();
  expect(state.pendingComments).toHaveLength(1);
  expect(state.pendingComments[0].body).toBe("Test comment");
  expect(state.commentingOnLine).toBeNull();
  expect(state.focusedPendingCommentId).toBe("local-1");
});

test("removePendingComment removes comment and focuses line", () => {
  const store = createStore();
  store.selectFile("src/index.ts");

  store.addPendingComment({
    id: "local-1",
    path: "src/index.ts",
    line: 10,
    body: "Test comment",
    side: "RIGHT",
  });

  store.removePendingComment("local-1");

  const state = store.getSnapshot();
  expect(state.pendingComments).toHaveLength(0);
  expect(state.focusedLine).toBe(10);
});

// ============================================================================
// Comments
// ============================================================================

test("setComments updates comments", () => {
  const store = createStore();
  const comments = [createMockComment(1, "src/index.ts", 10)];

  store.setComments(comments);

  expect(store.getSnapshot().comments).toHaveLength(1);
  expect(store.getSnapshot().comments[0].id).toBe(1);
});

test("setFocusedCommentId updates focus", () => {
  const store = createStore({
    comments: [createMockComment(1, "src/index.ts", 10)],
  });

  store.setFocusedCommentId(1);

  expect(store.getSnapshot().focusedCommentId).toBe(1);
});

test("startEditing sets editing comment id", () => {
  const store = createStore({
    comments: [createMockComment(1, "src/index.ts", 10)],
  });

  store.startEditing(1);

  expect(store.getSnapshot().editingCommentId).toBe(1);
});

test("deleteComment removes comment and focuses line", () => {
  const store = createStore({
    comments: [createMockComment(1, "src/index.ts", 10)],
  });
  store.selectFile("src/index.ts");
  store.setFocusedCommentId(1);

  store.deleteComment(1);

  const state = store.getSnapshot();
  expect(state.comments).toHaveLength(0);
  expect(state.focusedLine).toBe(10);
});

// ============================================================================
// Review Panel
// ============================================================================

test("openReviewPanel shows panel", () => {
  const store = createStore();

  store.openReviewPanel();

  expect(store.getSnapshot().showReviewPanel).toBe(true);
});

test("setReviewBody updates body and persists", () => {
  const store = createStore();

  store.setReviewBody("LGTM!");

  expect(store.getSnapshot().reviewBody).toBe("LGTM!");
  expect(storage.get("pr-test-repo-1-body")).toBe("LGTM!");
});

test("clearReviewState resets all review state", () => {
  const store = createStore();
  store.setReviewBody("Test");
  store.openReviewPanel();
  store.addPendingComment({
    id: "local-1",
    path: "src/index.ts",
    line: 10,
    body: "Comment",
    side: "RIGHT",
  });

  store.clearReviewState();

  const state = store.getSnapshot();
  expect(state.pendingComments).toHaveLength(0);
  expect(state.reviewBody).toBe("");
  expect(state.showReviewPanel).toBe(false);
});

// ============================================================================
// Subscriptions
// ============================================================================

test("subscribe notifies listeners on state change", () => {
  const store = createStore();
  let callCount = 0;

  const unsubscribe = store.subscribe(() => {
    callCount++;
  });

  store.selectFile("src/index.ts");
  expect(callCount).toBe(1);

  store.setFocusedLine(10, "new");
  expect(callCount).toBe(2);

  unsubscribe();
  store.setFocusedLine(20, "new");
  expect(callCount).toBe(2); // No more calls after unsubscribe
});

// ============================================================================
// Diff View Mode
// ============================================================================

test("setDiffViewMode updates mode and persists globally", () => {
  const store = createStore();

  store.setDiffViewMode("split");

  expect(store.getSnapshot().diffViewMode).toBe("split");
  expect(storage.get("pulldash_diff_view_mode")).toBe("split");
});

test("toggleDiffViewMode toggles between unified and split", () => {
  const store = createStore();
  expect(store.getSnapshot().diffViewMode).toBe("unified");

  store.toggleDiffViewMode();
  expect(store.getSnapshot().diffViewMode).toBe("split");

  store.toggleDiffViewMode();
  expect(store.getSnapshot().diffViewMode).toBe("unified");
});

// ============================================================================
// Goto Line Mode
// ============================================================================

test("enterGotoMode enables goto mode", () => {
  const store = createStore();

  store.enterGotoMode();

  const state = store.getSnapshot();
  expect(state.gotoLineMode).toBe(true);
  expect(state.gotoLineInput).toBe("");
});

test("appendGotoInput builds input string", () => {
  const store = createStore();
  store.enterGotoMode();

  store.appendGotoInput("4");
  store.appendGotoInput("2");

  expect(store.getSnapshot().gotoLineInput).toBe("42");
});

test("backspaceGotoInput removes last character", () => {
  const store = createStore();
  store.enterGotoMode();
  store.appendGotoInput("4");
  store.appendGotoInput("2");

  store.backspaceGotoInput();

  expect(store.getSnapshot().gotoLineInput).toBe("4");
});

test("exitGotoMode clears goto state", () => {
  const store = createStore();
  store.enterGotoMode();
  store.appendGotoInput("42");

  store.exitGotoMode();

  const state = store.getSnapshot();
  expect(state.gotoLineMode).toBe(false);
  expect(state.gotoLineInput).toBe("");
});

// ============================================================================
// Hash Navigation
// ============================================================================

test("getHashFromState returns file hash", () => {
  const store = createStore();
  store.selectFile("src/index.ts");

  const hash = store.getHashFromState();

  expect(hash).toBe("file=src%2Findex.ts");
});

test("getHashFromState includes line selection", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.setFocusedLine(42, "new");

  const hash = store.getHashFromState();

  expect(hash).toContain("file=src%2Findex.ts");
  expect(hash).toContain("L=42");
});

test("getHashFromState includes line range", () => {
  const store = createStore();
  store.selectFile("src/index.ts");
  store.setFocusedLine(10, "new");
  store.setSelectionAnchor(5, "new");

  const hash = store.getHashFromState();

  expect(hash).toContain("L=5-10");
});

test("navigateFromHash selects file", () => {
  const store = createStore();

  const result = store.navigateFromHash("file=src%2Findex.ts");

  expect(result).toBe(true);
  expect(store.getSnapshot().selectedFile).toBe("src/index.ts");
});

test("navigateFromHash focuses line", () => {
  const store = createStore();

  store.navigateFromHash("file=src%2Findex.ts&L=42");

  const state = store.getSnapshot();
  expect(state.selectedFile).toBe("src/index.ts");
  expect(state.focusedLine).toBe(42);
});

test("navigateFromHash returns false for invalid file", () => {
  const store = createStore();

  const result = store.navigateFromHash("file=nonexistent.ts");

  expect(result).toBe(false);
});
