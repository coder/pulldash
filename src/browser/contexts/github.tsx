import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Octokit } from "@octokit/core";
import type { components } from "@octokit/openapi-types";
import { useAuth } from "./auth";

// Re-export types
export type PullRequest = components["schemas"]["pull-request"];
export type PullRequestFile = components["schemas"]["diff-entry"];
export type ReviewComment =
  components["schemas"]["pull-request-review-comment"];
export type Review = components["schemas"]["pull-request-review"];
export type CheckRun = components["schemas"]["check-run"];
export type CombinedStatus = components["schemas"]["combined-commit-status"];
export type IssueComment = components["schemas"]["issue-comment"];
export type PRCommit = components["schemas"]["commit"];
export type Collaborator = components["schemas"]["collaborator"];
export type Reaction = components["schemas"]["reaction"];
export type ReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "hooray"
  | "confused"
  | "heart"
  | "rocket"
  | "eyes";
export type TimelineEvent = components["schemas"]["timeline-issue-events"];
export type UserProfile = components["schemas"]["public-user"];

// ============================================================================
// Types
// ============================================================================

export interface PRSearchResult {
  id: number;
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  draft: boolean;
  state: string;
  repository_url: string;
  user: {
    login: string;
    avatar_url: string;
  } | null;
  labels: Array<{
    name: string;
    color: string;
  }>;
  pull_request?: {
    merged_at: string | null;
  };
  // Enrichment data
  changedFiles?: number;
  additions?: number;
  deletions?: number;
  lastCommitAt?: string | null;
  viewerLastReviewAt?: string | null;
  hasNewChanges?: boolean;
  // CI status
  ciStatus?: "pending" | "success" | "failure" | "none" | "action_required";
  ciSummary?: string; // e.g. "2/3 checks passed" or "Build failed"
  ciChecks?: Array<{
    name: string;
    state: "pending" | "success" | "failure";
  }>;
}

export interface WorkflowRunAwaitingApproval {
  id: number;
  name: string;
  html_url: string;
}

export interface CheckStatus {
  checks: "pending" | "success" | "failure" | "none" | "action_required";
  state: "open" | "closed" | "merged" | "draft";
  mergeable: boolean | null;
  workflowRunsAwaitingApproval?: WorkflowRunAwaitingApproval[];
}

export interface PREnrichment {
  changedFiles: number;
  additions: number;
  deletions: number;
  lastCommitAt: string | null;
  viewerLastReviewAt: string | null;
  hasNewChanges: boolean;
  ciStatus: "pending" | "success" | "failure" | "none" | "action_required";
  ciSummary: string;
  ciChecks: Array<{
    name: string;
    state: "pending" | "success" | "failure";
  }>;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  resolvedBy: { login: string; avatarUrl: string } | null;
  // The review this thread belongs to (from first comment)
  pullRequestReview: {
    databaseId: number;
    author: { login: string; avatarUrl: string } | null;
  } | null;
  comments: {
    nodes: Array<{
      id: string;
      databaseId: number;
      body: string;
      path: string;
      line: number | null;
      originalLine: number | null;
      startLine: number | null;
      diffHunk: string | null;
      author: { login: string; avatarUrl: string } | null;
      createdAt: string;
      updatedAt: string;
      replyTo: { databaseId: number } | null;
    }>;
  };
}

export interface PendingReview {
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
}

// ============================================================================
// Persistent Cache with Stale-While-Revalidate
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

const DEFAULT_CACHE_TTL = 30_000; // 30 seconds
const STORAGE_PREFIX = "gh_cache:";

class RequestCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private pending = new Map<string, PendingRequest<unknown>>();
  private persistKeys = new Set<string>(); // Keys that should be persisted

  constructor() {
    // Load persisted cache on startup
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          const cacheKey = key.slice(STORAGE_PREFIX.length);
          const stored = localStorage.getItem(key);
          if (stored) {
            const entry = JSON.parse(stored) as CacheEntry<unknown>;
            this.cache.set(cacheKey, entry);
            this.persistKeys.add(cacheKey);
          }
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage(key: string, entry: CacheEntry<unknown>) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
      this.persistKeys.add(key);
    } catch {
      // Ignore storage errors (quota exceeded, etc.)
    }
  }

  private removeFromStorage(key: string) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
      this.persistKeys.delete(key);
    } catch {
      // Ignore
    }
  }

  /**
   * Get cached data. Returns null if no cache or cache is stale.
   */
  get<T>(key: string, ttl = DEFAULT_CACHE_TTL): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttl) {
      this.cache.delete(key);
      this.removeFromStorage(key);
      return null;
    }
    return entry.data as T;
  }

  /**
   * Get cached data even if stale (for SWR pattern).
   * Returns { data, isStale } or null if no cache exists.
   */
  getStale<T>(
    key: string,
    freshTtl = DEFAULT_CACHE_TTL
  ): { data: T; isStale: boolean } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const isStale = Date.now() - entry.timestamp > freshTtl;
    return { data: entry.data as T, isStale };
  }

  set<T>(key: string, data: T, persist = false): void {
    const entry = { data, timestamp: Date.now() };
    this.cache.set(key, entry);
    if (persist || this.persistKeys.has(key)) {
      this.saveToStorage(key, entry);
    }
  }

  getPending<T>(key: string): Promise<T> | null {
    const pending = this.pending.get(key);
    if (!pending) return null;
    return pending.promise as Promise<T>;
  }

  setPending<T>(key: string, promise: Promise<T>): void {
    this.pending.set(key, { promise, timestamp: Date.now() });
    promise.finally(() => this.pending.delete(key));
  }

  clearPending(key: string): void {
    this.pending.delete(key);
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      // Clear all memory cache
      this.cache.clear();
      // Clear persisted cache
      for (const key of this.persistKeys) {
        this.removeFromStorage(key);
      }
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        this.removeFromStorage(key);
      }
    }
  }

  /**
   * Check if we have any cached data (fresh or stale) for a key.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }
}

// ============================================================================
// GraphQL Batcher - Combines multiple queries within a time window
// ============================================================================

interface BatchedQuery {
  query: string;
  variables: Record<string, unknown>;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

class GraphQLBatcher {
  private queue: BatchedQuery[] = [];
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private octokit: Octokit;
  private batchWindowMs: number;

  constructor(octokit: Octokit, batchWindowMs = 5) {
    this.octokit = octokit;
    this.batchWindowMs = batchWindowMs; // 5ms batch window for near-instant batching
  }

  updateOctokit(octokit: Octokit) {
    this.octokit = octokit;
  }

  async query<T>(
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        query,
        variables,
        resolve: resolve as (data: unknown) => void,
        reject,
      });
      this.scheduleBatch();
    });
  }

  private scheduleBatch() {
    if (this.timeout) return;
    this.timeout = setTimeout(() => this.flush(), this.batchWindowMs);
  }

  private async flush() {
    this.timeout = null;
    const batch = this.queue.splice(0);
    if (batch.length === 0) return;

    // Execute all queries in parallel (GitHub doesn't support query batching in a single request)
    await Promise.all(
      batch.map(async ({ query, variables, resolve, reject }) => {
        try {
          const result = await this.octokit.graphql(query, variables);
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
    );
  }
}

// ============================================================================
// State Types
// ============================================================================

interface PRListState {
  items: PRSearchResult[];
  totalCount: number;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

interface PRCheckState {
  status: CheckStatus | null;
  loading: boolean;
  lastFetchedAt: number | null;
}

export interface CurrentUserData {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  company: string | null;
  location: string | null;
}

interface GitHubState {
  ready: boolean;
  error: string | null;
  currentUser: CurrentUserData | null;
  prList: PRListState;
  prListQueries: string[];
  prListPage: number;
  prChecks: Map<string, PRCheckState>;
}

type Listener = () => void;

// ============================================================================
// GitHub Store - Combines API client + state management
// ============================================================================

function createGitHubStore() {
  let state: GitHubState = {
    ready: false,
    error: null,
    currentUser: null,
    prList: {
      items: [],
      totalCount: 0,
      loading: false,
      error: null,
      lastFetchedAt: null,
    },
    prListQueries: [],
    prListPage: 1,
    prChecks: new Map(),
  };

  const listeners = new Set<Listener>();
  const cache = new RequestCache();
  let octokit: Octokit | null = null;
  let batcher: GraphQLBatcher | null = null;
  let onUnauthorized: (() => void) | null = null;
  let onRateLimited: (() => void) | null = null;

  function setOnUnauthorized(callback: () => void) {
    onUnauthorized = callback;
  }

  function setOnRateLimited(callback: () => void) {
    onRateLimited = callback;
  }

  // Helper to wrap octokit with error hooks
  function wrapOctokitWithHooks(octokitInstance: Octokit) {
    octokitInstance.hook.wrap("request", async (request, options) => {
      try {
        return await request(options);
      } catch (error) {
        if (error && typeof error === "object" && "status" in error) {
          if (error.status === 401) {
            console.warn(
              "[GitHub] Received 401 Unauthorized - token may be revoked"
            );
            onUnauthorized?.();
          } else if (
            error.status === 403 &&
            "response" in error &&
            error.response &&
            typeof error.response === "object" &&
            "headers" in error.response
          ) {
            // Check for rate limit
            const headers = (
              error.response as { headers: Record<string, string> }
            ).headers;
            const remaining = headers["x-ratelimit-remaining"];
            if (remaining === "0") {
              console.warn("[GitHub] Rate limit exceeded");
              onRateLimited?.();
            }
          }
        }
        throw error;
      }
    });
  }

  function getState() {
    return state;
  }

  function setState(
    partial: Partial<GitHubState> | ((s: GitHubState) => Partial<GitHubState>)
  ) {
    const updates = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...updates };
    listeners.forEach((l) => l());
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  function extractUserData(
    user: components["schemas"]["private-user"]
  ): CurrentUserData {
    return {
      id: user.id,
      login: user.login,
      name: user.name ?? null,
      email: user.email ?? null,
      avatar_url: user.avatar_url,
      html_url: user.html_url,
      bio: user.bio ?? null,
      company: user.company ?? null,
      location: user.location ?? null,
    };
  }

  function initialize(token: string) {
    // Load cached user immediately for instant UI
    const cachedUser =
      cache.getStale<components["schemas"]["private-user"]>("user:current");
    if (cachedUser) {
      setState({ currentUser: extractUserData(cachedUser.data) });
    }

    octokit = new Octokit({ auth: token });
    wrapOctokitWithHooks(octokit);
    batcher = new GraphQLBatcher(octokit);

    setState({ ready: true, error: null });

    // Revalidate current user in background
    fetchCurrentUser();
  }

  function initializeAnonymous() {
    // Create an unauthenticated Octokit instance for public repo access
    // GitHub allows 60 requests/hour for unauthenticated requests
    octokit = new Octokit();
    wrapOctokitWithHooks(octokit);
    batcher = new GraphQLBatcher(octokit);

    setState({ ready: true, error: null, currentUser: null });
  }

  function reset() {
    octokit = null;
    batcher = null;
    cache.invalidate();
    setState({
      ready: false,
      error: null,
      currentUser: null,
      prList: {
        items: [],
        totalCount: 0,
        loading: false,
        error: null,
        lastFetchedAt: null,
      },
      prListQueries: [],
      prListPage: 1,
      prChecks: new Map(),
    });
  }

  // ---------------------------------------------------------------------------
  // Current User (with SWR)
  // ---------------------------------------------------------------------------

  async function fetchCurrentUser() {
    if (!octokit) return;

    const cacheKey = "user:current";
    const FRESH_TTL = 300_000; // 5 minutes

    // Check for stale data - return immediately if we have any
    const stale = cache.getStale<components["schemas"]["private-user"]>(
      cacheKey,
      FRESH_TTL
    );
    if (stale) {
      setState({ currentUser: extractUserData(stale.data) });
      // If fresh, don't revalidate
      if (!stale.isStale) return;
    }

    // Check for pending request
    const pending =
      cache.getPending<components["schemas"]["private-user"]>(cacheKey);
    if (pending) {
      const user = await pending;
      setState({ currentUser: extractUserData(user) });
      return;
    }

    // Fetch fresh data (in background if we had stale data)
    const promise = octokit.request("GET /user").then((r) => {
      cache.set(cacheKey, r.data, true); // persist to localStorage
      return r.data;
    });
    cache.setPending(cacheKey, promise);

    try {
      const user = await promise;
      setState({
        currentUser: extractUserData(
          user as components["schemas"]["private-user"]
        ),
      });
    } catch {
      // Ignore - we may have stale data to show
    }
  }

  // ---------------------------------------------------------------------------
  // PR List
  // ---------------------------------------------------------------------------

  async function fetchPRList(queries: string[], page = 1, perPage = 30) {
    if (!octokit || !batcher) return;

    if (queries.length === 0) {
      setState({
        prList: {
          items: [],
          totalCount: 0,
          loading: false,
          error: null,
          lastFetchedAt: Date.now(),
        },
        prListQueries: queries,
        prListPage: page,
      });
      return;
    }

    const cacheKey = `prlist:${queries.sort().join("|")}:${page}:${perPage}`;
    const FRESH_TTL = 30_000; // 30 seconds

    // Check for stale data - show immediately if we have any
    const stale = cache.getStale<{
      items: PRSearchResult[];
      totalCount: number;
    }>(cacheKey, FRESH_TTL);
    if (stale) {
      setState({
        prList: {
          ...stale.data,
          loading: stale.isStale,
          error: null,
          lastFetchedAt: Date.now(),
        },
        prListQueries: queries,
        prListPage: page,
      });
      // If fresh, don't revalidate
      if (!stale.isStale) return;
    } else {
      setState((s) => ({
        prList: { ...s.prList, loading: true, error: null },
        prListQueries: queries,
        prListPage: page,
      }));
    }

    try {
      // Fetch PRs with caching
      const results = await Promise.all(
        queries.map((q) => searchPRs(q, page, perPage))
      );

      // Combine and dedupe by PR id
      const seen = new Set<number>();
      const combined: PRSearchResult[] = [];
      let total = 0;

      for (const data of results) {
        total += data.total_count || 0;
        for (const pr of data.items || []) {
          if (!seen.has(pr.id)) {
            seen.add(pr.id);
            combined.push(pr as PRSearchResult);
          }
        }
      }

      // Sort by updated_at descending
      combined.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );

      // Enrich with GraphQL data
      const prIdentifiers = combined
        .map((item) => {
          const match = item.repository_url?.match(/repos\/([^/]+)\/([^/]+)/);
          if (match && item.number) {
            return { owner: match[1], repo: match[2], number: item.number };
          }
          return null;
        })
        .filter(
          (x): x is { owner: string; repo: string; number: number } =>
            x !== null
        );

      if (prIdentifiers.length > 0) {
        try {
          const enrichmentMap = await getPREnrichment(prIdentifiers);
          for (const item of combined) {
            const match = item.repository_url?.match(/repos\/([^/]+)\/([^/]+)/);
            if (match && item.number) {
              const key = `${match[1]}/${match[2]}/${item.number}`;
              const enrichment = enrichmentMap.get(key);
              if (enrichment) {
                Object.assign(item, enrichment);
              }
            }
          }
        } catch (enrichmentError) {
          console.error("PR enrichment failed:", enrichmentError);
        }
      }

      // Cache the result (persist for instant load next time)
      cache.set(cacheKey, { items: combined, totalCount: total }, true);

      setState({
        prList: {
          items: combined,
          totalCount: total,
          loading: false,
          error: null,
          lastFetchedAt: Date.now(),
        },
      });
    } catch (e) {
      setState((s) => ({
        prList: {
          ...s.prList,
          loading: false,
          error: e instanceof Error ? e.message : "Failed to fetch PRs",
        },
      }));
    }
  }

  function refreshPRList() {
    const { prListQueries, prListPage } = state;
    if (prListQueries.length > 0) {
      fetchPRList(prListQueries, prListPage);
    }
  }

  // ---------------------------------------------------------------------------
  // PR Checks
  // ---------------------------------------------------------------------------

  function getPRCheckKey(owner: string, repo: string, number: number) {
    return `${owner}/${repo}/${number}`;
  }

  async function fetchPRChecks(owner: string, repo: string, number: number) {
    if (!octokit) return;

    const key = getPRCheckKey(owner, repo, number);

    setState((s) => {
      const newChecks = new Map(s.prChecks);
      newChecks.set(key, {
        status: s.prChecks.get(key)?.status || null,
        loading: true,
        lastFetchedAt: s.prChecks.get(key)?.lastFetchedAt || null,
      });
      return { prChecks: newChecks };
    });

    try {
      const prData = await getPR(owner, repo, number);
      const [checksData, workflowRunsData] = await Promise.all([
        getPRChecksForSha(owner, repo, prData.head.sha),
        getWorkflowRunsForSha(owner, repo, prData.head.sha).catch(() => ({
          workflow_runs: [],
        })),
      ]);

      const checkRuns = checksData.checkRuns || [];
      const statuses = checksData.status?.statuses || [];

      // Check for workflow runs awaiting approval (fork PRs)
      const workflowRunsAwaitingApproval = workflowRunsData.workflow_runs
        .filter((run) => run.conclusion === "action_required")
        .map((run) => ({
          id: run.id,
          name: run.name || "Workflow",
          html_url: run.html_url,
        }));

      let checks: CheckStatus["checks"] = "none";

      // If there are workflow runs awaiting approval and no other checks, show action_required
      if (workflowRunsAwaitingApproval.length > 0) {
        // Check if there are any other actual check runs or statuses
        if (checkRuns.length === 0 && statuses.length === 0) {
          checks = "action_required";
        } else {
          // There are other checks, evaluate them first
          const allChecks = [
            ...checkRuns.map((c) =>
              c.status === "completed" ? c.conclusion : "pending"
            ),
            ...statuses.map((s) => s.state),
          ];

          if (allChecks.some((c) => c === "failure" || c === "error")) {
            checks = "failure";
          } else if (allChecks.some((c) => c === "pending" || c === null)) {
            checks = "pending";
          } else {
            // All checks passed but there are workflows awaiting approval
            checks = "action_required";
          }
        }
      } else if (checkRuns.length > 0 || statuses.length > 0) {
        const allChecks = [
          ...checkRuns.map((c) =>
            c.status === "completed" ? c.conclusion : "pending"
          ),
          ...statuses.map((s) => s.state),
        ];

        if (allChecks.some((c) => c === "failure" || c === "error")) {
          checks = "failure";
        } else if (allChecks.some((c) => c === "pending" || c === null)) {
          checks = "pending";
        } else {
          checks = "success";
        }
      }

      const prState: CheckStatus["state"] = prData.merged
        ? "merged"
        : prData.draft
          ? "draft"
          : prData.state === "open"
            ? "open"
            : "closed";

      setState((s) => {
        const newChecks = new Map(s.prChecks);
        newChecks.set(key, {
          status: {
            checks,
            state: prState,
            mergeable: prData.mergeable,
            workflowRunsAwaitingApproval:
              workflowRunsAwaitingApproval.length > 0
                ? workflowRunsAwaitingApproval
                : undefined,
          },
          loading: false,
          lastFetchedAt: Date.now(),
        });
        return { prChecks: newChecks };
      });
    } catch {
      setState((s) => {
        const newChecks = new Map(s.prChecks);
        newChecks.set(key, {
          status: s.prChecks.get(key)?.status || null,
          loading: false,
          lastFetchedAt: Date.now(),
        });
        return { prChecks: newChecks };
      });
    }
  }

  function refreshAllPRChecks() {
    for (const key of state.prChecks.keys()) {
      const [owner, repo, number] = key.split("/");
      if (owner && repo && number) {
        fetchPRChecks(owner, repo, parseInt(number, 10));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // API Methods (with caching and deduplication)
  // ---------------------------------------------------------------------------

  async function searchPRs(query: string, page = 1, perPage = 30) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `search:prs:${query}:${page}:${perPage}`;

    const cached =
      cache.get<
        Awaited<
          ReturnType<typeof octokit.request<"GET /search/issues">>
        >["data"]
      >(cacheKey);
    if (cached) return cached;

    const pending =
      cache.getPending<
        Awaited<
          ReturnType<typeof octokit.request<"GET /search/issues">>
        >["data"]
      >(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /search/issues", {
        q: query,
        sort: "updated",
        order: "desc",
        per_page: perPage,
        page,
      })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function searchRepos(query: string) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `search:repos:${query}`;

    const cached =
      cache.get<
        Awaited<
          ReturnType<typeof octokit.request<"GET /search/repositories">>
        >["data"]
      >(cacheKey);
    if (cached) return cached;

    const pending =
      cache.getPending<
        Awaited<
          ReturnType<typeof octokit.request<"GET /search/repositories">>
        >["data"]
      >(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /search/repositories", {
        q: query,
        order: "desc",
        per_page: 10,
      })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function searchUsers(query: string) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `search:users:${query}`;

    type UserSearchResult = Awaited<
      ReturnType<typeof octokit.request<"GET /search/users">>
    >["data"];

    const cached = cache.get<UserSearchResult>(cacheKey);
    if (cached) return cached;

    const pending = cache.getPending<UserSearchResult>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /search/users", {
        q: query,
        per_page: 8,
      })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function getPR(
    owner: string,
    repo: string,
    number: number
  ): Promise<PullRequest> {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `pr:${owner}/${repo}/${number}`;

    const cached = cache.get<PullRequest>(cacheKey);
    if (cached) return cached;

    const pending = cache.getPending<PullRequest>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo,
        pull_number: number,
      })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function getPRFiles(
    owner: string,
    repo: string,
    number: number
  ): Promise<PullRequestFile[]> {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `pr:${owner}/${repo}/${number}:files`;

    const cached = cache.get<PullRequestFile[]>(cacheKey);
    if (cached) return cached;

    const pending = cache.getPending<PullRequestFile[]>(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
      const files: PullRequestFile[] = [];
      let page = 1;

      while (true) {
        const { data } = await octokit!.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
          {
            owner,
            repo,
            pull_number: number,
            per_page: 100,
            page,
          }
        );
        files.push(...data);
        if (data.length < 100) break;
        page++;
      }

      cache.set(cacheKey, files);
      return files;
    })();

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function getPRComments(
    owner: string,
    repo: string,
    number: number
  ): Promise<ReviewComment[]> {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `pr:${owner}/${repo}/${number}:comments`;

    const cached = cache.get<ReviewComment[]>(cacheKey);
    if (cached) return cached;

    const pending = cache.getPending<ReviewComment[]>(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
      const comments: ReviewComment[] = [];
      let page = 1;

      while (true) {
        const { data } = await octokit!.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
          {
            owner,
            repo,
            pull_number: number,
            per_page: 100,
            page,
          }
        );
        comments.push(...data);
        if (data.length < 100) break;
        page++;
      }

      cache.set(cacheKey, comments);
      return comments;
    })();

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function createPRComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
    options?: {
      reply_to_id?: number;
      commit_id?: string;
      path?: string;
      line?: number;
      side?: "LEFT" | "RIGHT";
    }
  ): Promise<ReviewComment> {
    if (!octokit) throw new Error("Not initialized");

    let result: ReviewComment;

    if (options?.reply_to_id) {
      const { data } = await octokit.request(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
        {
          owner,
          repo,
          pull_number: number,
          comment_id: options.reply_to_id,
          body,
        }
      );
      result = data;
    } else {
      const { data } = await octokit.request(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
        {
          owner,
          repo,
          pull_number: number,
          body,
          commit_id: options?.commit_id!,
          path: options?.path!,
          line: options?.line!,
          side: options?.side ?? "RIGHT",
        }
      );
      result = data;
    }

    cache.invalidate(`pr:${owner}/${repo}/${number}:comments`);
    return result;
  }

  async function getPRReviews(
    owner: string,
    repo: string,
    number: number
  ): Promise<Review[]> {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `pr:${owner}/${repo}/${number}:reviews`;

    const cached = cache.get<Review[]>(cacheKey);
    if (cached) return cached;

    const pending = cache.getPending<Review[]>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
        owner,
        repo,
        pull_number: number,
      })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function createPRReview(
    owner: string,
    repo: string,
    number: number,
    options: {
      commit_id: string;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
      comments?: Array<{
        path: string;
        line: number;
        body: string;
        side?: "LEFT" | "RIGHT";
        start_line?: number;
      }>;
    }
  ): Promise<Review> {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner,
        repo,
        pull_number: number,
        commit_id: options.commit_id,
        event: options.event,
        body: options.body ?? "",
        comments: options.comments ?? [],
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
    return data;
  }

  async function submitPRReview(
    owner: string,
    repo: string,
    number: number,
    reviewId: number,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body?: string
  ): Promise<Review> {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events",
      {
        owner,
        repo,
        pull_number: number,
        review_id: reviewId,
        event,
        body: body ?? "",
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
    return data;
  }

  async function deletePRReview(
    owner: string,
    repo: string,
    number: number,
    reviewId: number
  ): Promise<void> {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
      {
        owner,
        repo,
        pull_number: number,
        review_id: reviewId,
      }
    );
    cache.invalidate(`pr:${owner}/${repo}/${number}`);
  }

  async function getPRChecksForSha(owner: string, repo: string, sha: string) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `checks:${owner}/${repo}/${sha}`;

    type ChecksResult = { checkRuns: CheckRun[]; status: CombinedStatus };

    const cached = cache.get<ChecksResult>(cacheKey, 15_000);
    if (cached) return cached;

    const pending = cache.getPending<ChecksResult>(cacheKey);
    if (pending) return pending;

    const promise = Promise.all([
      octokit.request("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
        owner,
        repo,
        ref: sha,
      }),
      octokit.request("GET /repos/{owner}/{repo}/commits/{ref}/status", {
        owner,
        repo,
        ref: sha,
      }),
    ]).then(([checkRunsRes, statusRes]) => {
      const result = {
        checkRuns: checkRunsRes.data.check_runs,
        status: statusRes.data,
      };
      cache.set(cacheKey, result);
      return result;
    });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function getWorkflowRunsForSha(
    owner: string,
    repo: string,
    sha: string
  ) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `workflow-runs:${owner}/${repo}/${sha}`;

    type WorkflowRunsResult = {
      workflow_runs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string;
        head_sha: string;
      }>;
    };

    const cached = cache.get<WorkflowRunsResult>(cacheKey, 15_000);
    if (cached) return cached;

    const pending = cache.getPending<WorkflowRunsResult>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /repos/{owner}/{repo}/actions/runs", {
        owner,
        repo,
        head_sha: sha,
        per_page: 50,
      })
      .then((res) => {
        const result = {
          workflow_runs: res.data.workflow_runs,
        };
        cache.set(cacheKey, result);
        return result;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function approveWorkflowRun(
    owner: string,
    repo: string,
    runId: number
  ) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request(
      "POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve",
      {
        owner,
        repo,
        run_id: runId,
      }
    );

    // Invalidate workflow runs cache for this repo
    cache.invalidate(`workflow-runs:${owner}/${repo}`);
  }

  async function mergePR(
    owner: string,
    repo: string,
    number: number,
    options?: {
      merge_method?: "merge" | "squash" | "rebase";
      commit_title?: string;
      commit_message?: string;
    }
  ) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge",
      {
        owner,
        repo,
        pull_number: number,
        merge_method: options?.merge_method ?? "squash",
        commit_title: options?.commit_title,
        commit_message: options?.commit_message,
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
    return data;
  }

  async function getPRCommits(owner: string, repo: string, number: number) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `pr:${owner}/${repo}/${number}:commits`;

    const cached = cache.get<components["schemas"]["commit"][]>(cacheKey);
    if (cached) return cached;

    const pending =
      cache.getPending<components["schemas"]["commit"][]>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /repos/{owner}/{repo}/pulls/{pull_number}/commits", {
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function requestReviewers(
    owner: string,
    repo: string,
    number: number,
    reviewers: string[]
  ) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
      {
        owner,
        repo,
        pull_number: number,
        reviewers,
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
    return data;
  }

  async function removeReviewers(
    owner: string,
    repo: string,
    number: number,
    reviewers: string[]
  ) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
      {
        owner,
        repo,
        pull_number: number,
        reviewers,
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
  }

  async function getRepoCollaborators(owner: string, repo: string) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `repo:${owner}/${repo}:collaborators`;

    const cached = cache.get<components["schemas"]["collaborator"][]>(
      cacheKey,
      300_000
    );
    if (cached) return cached;

    const pending =
      cache.getPending<components["schemas"]["collaborator"][]>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /repos/{owner}/{repo}/collaborators", {
        owner,
        repo,
        per_page: 100,
      })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function addAssignees(
    owner: string,
    repo: string,
    issueNumber: number,
    assignees: string[]
  ) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/assignees",
      {
        owner,
        repo,
        issue_number: issueNumber,
        assignees,
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${issueNumber}`);
    return data;
  }

  async function removeAssignees(
    owner: string,
    repo: string,
    issueNumber: number,
    assignees: string[]
  ) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees",
      {
        owner,
        repo,
        issue_number: issueNumber,
        assignees,
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${issueNumber}`);
  }

  async function getRepoLabels(owner: string, repo: string) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `repo:${owner}/${repo}:labels`;

    const cached = cache.get<
      Array<{ name: string; color: string; description: string | null }>
    >(cacheKey, 300_000);
    if (cached) return cached;

    const pending =
      cache.getPending<
        Array<{ name: string; color: string; description: string | null }>
      >(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
      // Manually paginate to get all labels
      const allLabels: Array<{
        name: string;
        color: string;
        description: string | null;
      }> = [];
      let page = 1;
      while (true) {
        const { data: labels } = await octokit.request(
          "GET /repos/{owner}/{repo}/labels",
          {
            owner,
            repo,
            per_page: 100,
            page,
          }
        );
        for (const l of labels) {
          allLabels.push({
            name: l.name,
            color: l.color,
            description: l.description ?? null,
          });
        }
        if (labels.length < 100) break;
        page++;
      }
      cache.set(cacheKey, allLabels);
      cache.clearPending(cacheKey);
      return allLabels;
    })();

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function addLabels(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[]
  ) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/labels",
      {
        owner,
        repo,
        issue_number: issueNumber,
        labels,
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${issueNumber}`);
    return data;
  }

  async function removeLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    labelName: string
  ) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}",
      {
        owner,
        repo,
        issue_number: issueNumber,
        name: labelName,
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${issueNumber}`);
  }

  async function convertToDraft(owner: string, repo: string, number: number) {
    if (!batcher) throw new Error("Not initialized");

    const prData = await batcher.query<{
      repository: { pullRequest: { id: string } };
    }>(
      `query ($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id } } }`,
      { owner, repo, number }
    );

    await batcher.query(
      `mutation ($input: ConvertPullRequestToDraftInput!) { convertPullRequestToDraft(input: $input) { pullRequest { id } } }`,
      { input: { pullRequestId: prData.repository.pullRequest.id } }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
  }

  async function markReadyForReview(
    owner: string,
    repo: string,
    number: number
  ) {
    if (!batcher) throw new Error("Not initialized");

    const prData = await batcher.query<{
      repository: { pullRequest: { id: string } };
    }>(
      `query ($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id } } }`,
      { owner, repo, number }
    );

    await batcher.query(
      `mutation ($input: MarkPullRequestReadyForReviewInput!) { markPullRequestReadyForReview(input: $input) { pullRequest { id } } }`,
      { input: { pullRequestId: prData.repository.pullRequest.id } }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
  }

  async function updateBranch(owner: string, repo: string, number: number) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch",
      {
        owner,
        repo,
        pull_number: number,
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
    return data;
  }

  // Reaction types: +1, -1, laugh, hooray, confused, heart, rocket, eyes
  type ReactionContent =
    | "+1"
    | "-1"
    | "laugh"
    | "hooray"
    | "confused"
    | "heart"
    | "rocket"
    | "eyes";

  async function getIssueReactions(
    owner: string,
    repo: string,
    issueNumber: number
  ) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `reactions:issue:${owner}/${repo}/${issueNumber}`;

    const cached = cache.get<components["schemas"]["reaction"][]>(
      cacheKey,
      30_000
    );
    if (cached) return cached;

    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/reactions",
      {
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      }
    );

    cache.set(cacheKey, data);
    return data;
  }

  async function addIssueReaction(
    owner: string,
    repo: string,
    issueNumber: number,
    content: ReactionContent
  ) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/reactions",
      {
        owner,
        repo,
        issue_number: issueNumber,
        content,
      }
    );

    cache.invalidate(`reactions:issue:${owner}/${repo}/${issueNumber}`);
    return data;
  }

  async function deleteIssueReaction(
    owner: string,
    repo: string,
    issueNumber: number,
    reactionId: number
  ) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}",
      {
        owner,
        repo,
        issue_number: issueNumber,
        reaction_id: reactionId,
      }
    );

    cache.invalidate(`reactions:issue:${owner}/${repo}/${issueNumber}`);
  }

  async function getCommentReactions(
    owner: string,
    repo: string,
    commentId: number
  ) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `reactions:comment:${owner}/${repo}/${commentId}`;

    const cached = cache.get<components["schemas"]["reaction"][]>(
      cacheKey,
      30_000
    );
    if (cached) return cached;

    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions",
      {
        owner,
        repo,
        comment_id: commentId,
        per_page: 100,
      }
    );

    cache.set(cacheKey, data);
    return data;
  }

  async function addCommentReaction(
    owner: string,
    repo: string,
    commentId: number,
    content: ReactionContent
  ) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions",
      {
        owner,
        repo,
        comment_id: commentId,
        content,
      }
    );

    cache.invalidate(`reactions:comment:${owner}/${repo}/${commentId}`);
    return data;
  }

  async function deleteCommentReaction(
    owner: string,
    repo: string,
    commentId: number,
    reactionId: number
  ) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}",
      {
        owner,
        repo,
        comment_id: commentId,
        reaction_id: reactionId,
      }
    );

    cache.invalidate(`reactions:comment:${owner}/${repo}/${commentId}`);
  }

  // Pull Request Review Comment Reactions (different from issue comments)
  async function getReviewCommentReactions(
    owner: string,
    repo: string,
    commentId: number
  ) {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `reactions:review-comment:${owner}/${repo}/${commentId}`;

    const cached = cache.get<components["schemas"]["reaction"][]>(
      cacheKey,
      30_000
    );
    if (cached) return cached;

    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions",
      {
        owner,
        repo,
        comment_id: commentId,
        per_page: 100,
      }
    );

    cache.set(cacheKey, data);
    return data;
  }

  async function addReviewCommentReaction(
    owner: string,
    repo: string,
    commentId: number,
    content: ReactionContent
  ) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions",
      {
        owner,
        repo,
        comment_id: commentId,
        content,
      }
    );

    cache.invalidate(`reactions:review-comment:${owner}/${repo}/${commentId}`);
    return data;
  }

  async function deleteReviewCommentReaction(
    owner: string,
    repo: string,
    commentId: number,
    reactionId: number
  ) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions/{reaction_id}",
      {
        owner,
        repo,
        comment_id: commentId,
        reaction_id: reactionId,
      }
    );

    cache.invalidate(`reactions:review-comment:${owner}/${repo}/${commentId}`);
  }

  async function closePR(owner: string, repo: string, number: number) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "PATCH /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: number,
        state: "closed",
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
    return data;
  }

  async function reopenPR(owner: string, repo: string, number: number) {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "PATCH /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: number,
        state: "open",
      }
    );

    cache.invalidate(`pr:${owner}/${repo}/${number}`);
    return data;
  }

  async function deleteBranch(owner: string, repo: string, branch: string) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request("DELETE /repos/{owner}/{repo}/git/refs/{ref}", {
      owner,
      repo,
      ref: `heads/${branch}`,
    });
  }

  async function restoreBranch(
    owner: string,
    repo: string,
    branch: string,
    sha: string
  ) {
    if (!octokit) throw new Error("Not initialized");

    await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha,
    });
  }

  async function getPRConversation(
    owner: string,
    repo: string,
    number: number
  ): Promise<IssueComment[]> {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `pr:${owner}/${repo}/${number}:conversation`;

    const cached = cache.get<IssueComment[]>(cacheKey);
    if (cached) return cached;

    const pending = cache.getPending<IssueComment[]>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner,
        repo,
        issue_number: number,
      })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function createPRConversationComment(
    owner: string,
    repo: string,
    number: number,
    body: string
  ): Promise<IssueComment> {
    if (!octokit) throw new Error("Not initialized");

    const { data } = await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner,
        repo,
        issue_number: number,
        body,
      }
    );
    cache.invalidate(`pr:${owner}/${repo}/${number}:conversation`);
    return data;
  }

  async function getPRTimeline(
    owner: string,
    repo: string,
    number: number
  ): Promise<TimelineEvent[]> {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `pr:${owner}/${repo}/${number}:timeline`;

    const cached = cache.get<TimelineEvent[]>(cacheKey);
    if (cached) return cached;

    const pending = cache.getPending<TimelineEvent[]>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /repos/{owner}/{repo}/issues/{issue_number}/timeline", {
        owner,
        repo,
        issue_number: number,
        per_page: 100,
      })
      .then((res) => {
        cache.set(cacheKey, res.data as TimelineEvent[]);
        return res.data as TimelineEvent[];
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  async function getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string> {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `file:${owner}/${repo}/${ref}/${path}`;

    const cached = cache.get<string>(cacheKey, 300_000);
    if (cached) return cached;

    const pending = cache.getPending<string>(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const response = await octokit!.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          {
            owner,
            repo,
            path,
            ref,
            headers: { Accept: "application/vnd.github.raw+json" },
          }
        );
        const content = response.data as unknown as string;
        cache.set(cacheKey, content);
        return content;
      } catch (error: unknown) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 404
        ) {
          cache.set(cacheKey, "");
          return "";
        }
        throw error;
      }
    })();

    cache.setPending(cacheKey, promise);
    return promise;
  }

  // ---------------------------------------------------------------------------
  // GraphQL Methods
  // ---------------------------------------------------------------------------

  async function graphql<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    if (!batcher) throw new Error("Not initialized");
    return batcher.query<T>(query, variables);
  }

  async function getPREnrichment(
    prs: Array<{ owner: string; repo: string; number: number }>
  ): Promise<Map<string, PREnrichment>> {
    if (!batcher || prs.length === 0) return new Map();

    const prQueries = prs
      .map(
        (pr, idx) => `
      pr${idx}: repository(owner: "${pr.owner}", name: "${pr.repo}") {
        pullRequest(number: ${pr.number}) {
          number
          changedFiles
          additions
          deletions
          commits(last: 1) {
            nodes {
              commit {
                committedDate
                statusCheckRollup {
                  state
                  contexts(first: 50) {
                    nodes {
                      __typename
                      ... on CheckRun {
                        name
                        conclusion
                        status
                      }
                      ... on StatusContext {
                        context
                        state
                      }
                    }
                  }
                }
              }
            }
          }
          viewerLatestReview {
            submittedAt
          }
        }
      }
    `
      )
      .join("\n");

    type CheckContext =
      | {
          __typename: "CheckRun";
          name: string;
          conclusion: string | null;
          status: string;
        }
      | {
          __typename: "StatusContext";
          context: string;
          state: string;
        };

    const data = await batcher.query<
      Record<
        string,
        {
          pullRequest: {
            number: number;
            changedFiles: number;
            additions: number;
            deletions: number;
            commits: {
              nodes: Array<{
                commit: {
                  committedDate: string;
                  statusCheckRollup: {
                    state:
                      | "EXPECTED"
                      | "ERROR"
                      | "FAILURE"
                      | "PENDING"
                      | "SUCCESS";
                    contexts: {
                      nodes: CheckContext[];
                    };
                  } | null;
                };
              }>;
            };
            viewerLatestReview: { submittedAt: string } | null;
          } | null;
        }
      >
    >(`query { ${prQueries} }`);

    const enrichmentMap = new Map<string, PREnrichment>();

    prs.forEach((pr, idx) => {
      const result = data[`pr${idx}`]?.pullRequest;
      if (result) {
        const lastCommit = result.commits.nodes[0]?.commit;
        const lastCommitAt = lastCommit?.committedDate || null;
        const viewerLastReviewAt =
          result.viewerLatestReview?.submittedAt || null;
        let hasNewChanges = false;
        if (viewerLastReviewAt && lastCommitAt) {
          hasNewChanges = new Date(lastCommitAt) > new Date(viewerLastReviewAt);
        }

        // Map GraphQL status to our CI status
        const statusState = lastCommit?.statusCheckRollup?.state;
        let ciStatus: PREnrichment["ciStatus"] = "none";
        if (statusState) {
          if (statusState === "SUCCESS") {
            ciStatus = "success";
          } else if (statusState === "FAILURE" || statusState === "ERROR") {
            ciStatus = "failure";
          } else if (statusState === "PENDING" || statusState === "EXPECTED") {
            ciStatus = "pending";
          }
        }

        // Parse check contexts for detailed info
        const contexts = lastCommit?.statusCheckRollup?.contexts?.nodes || [];
        const ciChecks: PREnrichment["ciChecks"] = contexts.map((ctx) => {
          if (ctx.__typename === "CheckRun") {
            let state: "pending" | "success" | "failure" = "pending";
            if (ctx.status === "COMPLETED") {
              state = ctx.conclusion === "SUCCESS" ? "success" : "failure";
            }
            return { name: ctx.name, state };
          } else {
            // StatusContext
            const state =
              ctx.state === "SUCCESS"
                ? "success"
                : ctx.state === "FAILURE" || ctx.state === "ERROR"
                  ? "failure"
                  : "pending";
            return { name: ctx.context, state };
          }
        });

        // Build summary
        let ciSummary = "";
        if (ciChecks.length > 0) {
          const passed = ciChecks.filter((c) => c.state === "success").length;
          const failed = ciChecks.filter((c) => c.state === "failure").length;
          const pending = ciChecks.filter((c) => c.state === "pending").length;

          if (failed > 0) {
            const failedCheck = ciChecks.find((c) => c.state === "failure");
            ciSummary = failedCheck ? failedCheck.name : `${failed} failed`;
          } else if (pending > 0) {
            const pendingCheck = ciChecks.find((c) => c.state === "pending");
            ciSummary = pendingCheck ? pendingCheck.name : `${pending} running`;
          } else {
            ciSummary = `${passed}/${ciChecks.length} passed`;
          }
        }

        enrichmentMap.set(`${pr.owner}/${pr.repo}/${pr.number}`, {
          changedFiles: result.changedFiles,
          additions: result.additions,
          deletions: result.deletions,
          lastCommitAt,
          viewerLastReviewAt,
          hasNewChanges,
          ciStatus,
          ciSummary,
          ciChecks,
        });
      }
    });

    return enrichmentMap;
  }

  async function getReviewThreads(
    owner: string,
    repo: string,
    number: number
  ): Promise<{
    threads: ReviewThread[];
    viewerPermission: string | null;
    viewerCanMergeAsAdmin: boolean;
  }> {
    if (!batcher) throw new Error("Not initialized");

    // Raw GraphQL response type (comments include pullRequestReview)
    interface RawReviewThread {
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
          diffHunk: string | null;
          author: { login: string; avatarUrl: string } | null;
          createdAt: string;
          updatedAt: string;
          replyTo: { databaseId: number } | null;
          pullRequestReview: {
            databaseId: number;
            author: { login: string; avatarUrl: string } | null;
          } | null;
        }>;
      };
    }

    const data = await batcher.query<{
      repository: {
        viewerPermission: string | null;
        pullRequest: {
          viewerCanMergeAsAdmin: boolean;
          reviewThreads: { nodes: RawReviewThread[] };
        };
      };
    }>(
      `
      query ($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          viewerPermission
          pullRequest(number: $number) {
            viewerCanMergeAsAdmin
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                resolvedBy { login avatarUrl }
                comments(first: 100) {
                  nodes {
                    id
                    databaseId
                    body
                    path
                    line
                    originalLine
                    startLine
                    diffHunk
                    author { login avatarUrl }
                    createdAt
                    updatedAt
                    replyTo { databaseId }
                    pullRequestReview {
                      databaseId
                      author { login avatarUrl }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
      { owner, repo, number }
    );

    // Extract pullRequestReview from first comment into thread object
    const threads = data.repository.pullRequest.reviewThreads.nodes.map(
      (thread) => {
        const firstComment = thread.comments.nodes[0];
        return {
          ...thread,
          pullRequestReview: firstComment?.pullRequestReview ?? null,
        };
      }
    );

    return {
      threads,
      viewerPermission: data.repository.viewerPermission,
      viewerCanMergeAsAdmin: data.repository.pullRequest.viewerCanMergeAsAdmin,
    };
  }

  async function resolveThread(threadId: string): Promise<void> {
    if (!batcher) throw new Error("Not initialized");
    await batcher.query(
      `mutation ($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { thread { id } } }`,
      { input: { threadId } }
    );
  }

  async function unresolveThread(threadId: string): Promise<void> {
    if (!batcher) throw new Error("Not initialized");
    await batcher.query(
      `mutation ($input: UnresolveReviewThreadInput!) { unresolveReviewThread(input: $input) { thread { id } } }`,
      { input: { threadId } }
    );
  }

  async function getPendingReview(
    owner: string,
    repo: string,
    number: number
  ): Promise<PendingReview | null> {
    if (!batcher) throw new Error("Not initialized");

    const data = await batcher.query<{
      repository: {
        pullRequest: {
          reviews: { nodes: PendingReview[] };
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
                    nodes { id databaseId body path line startLine }
                }
              }
            }
          }
        }
      }
    `,
      { owner, repo, number }
    );

    return (
      data.repository.pullRequest.reviews.nodes.find(
        (r) => r.viewerDidAuthor
      ) || null
    );
  }

  async function addPendingComment(
    owner: string,
    repo: string,
    number: number,
    options: { path: string; line: number; body: string; startLine?: number }
  ): Promise<{
    reviewId: string;
    commentId: string;
    commentDatabaseId: number;
  }> {
    if (!batcher) throw new Error("Not initialized");

    const prData = await batcher.query<{
      repository: { pullRequest: { id: string } };
    }>(
      `query ($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id } } }`,
      { owner, repo, number }
    );

    const input: Record<string, unknown> = {
      pullRequestId: prData.repository.pullRequest.id,
      path: options.path,
      line: options.line,
      body: options.body,
    };

    if (options.startLine && options.startLine !== options.line) {
      input.startLine = options.startLine;
    }

    const data = await batcher.query<{
      addPullRequestReviewComment: {
        comment: {
          id: string;
          databaseId: number;
          pullRequestReview: { id: string };
        };
      };
    }>(
      `mutation ($input: AddPullRequestReviewCommentInput!) { addPullRequestReviewComment(input: $input) { comment { id databaseId pullRequestReview { id } } } }`,
      { input }
    );

    return {
      reviewId: data.addPullRequestReviewComment.comment.pullRequestReview.id,
      commentId: data.addPullRequestReviewComment.comment.id,
      commentDatabaseId: data.addPullRequestReviewComment.comment.databaseId,
    };
  }

  async function deletePendingComment(commentId: string): Promise<void> {
    if (!batcher) throw new Error("Not initialized");
    await batcher.query(
      `mutation ($input: DeletePullRequestReviewCommentInput!) { deletePullRequestReviewComment(input: $input) { pullRequestReview { id } } }`,
      { input: { id: commentId } }
    );
  }

  async function updatePendingComment(
    commentId: string,
    body: string
  ): Promise<void> {
    if (!batcher) throw new Error("Not initialized");
    await batcher.query(
      `mutation ($input: UpdatePullRequestReviewCommentInput!) { updatePullRequestReviewComment(input: $input) { pullRequestReviewComment { id } } }`,
      { input: { pullRequestReviewCommentId: commentId, body } }
    );
  }

  async function submitPendingReview(
    reviewId: string,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body?: string
  ): Promise<void> {
    if (!batcher) throw new Error("Not initialized");
    await batcher.query(
      `mutation ($input: SubmitPullRequestReviewInput!) { submitPullRequestReview(input: $input) { pullRequestReview { id } } }`,
      { input: { pullRequestReviewId: reviewId, event, body: body ?? "" } }
    );
  }

  async function updateComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<ReviewComment> {
    if (!octokit) throw new Error("Not initialized");
    const { data } = await octokit.request(
      "PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}",
      {
        owner,
        repo,
        comment_id: commentId,
        body,
      }
    );
    return data;
  }

  async function deleteComment(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<void> {
    if (!octokit) throw new Error("Not initialized");
    await octokit.request(
      "DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}",
      {
        owner,
        repo,
        comment_id: commentId,
      }
    );
  }

  async function getUserProfile(login: string): Promise<UserProfile> {
    if (!octokit) throw new Error("Not initialized");

    const cacheKey = `user:${login}`;
    const cached = cache.get<UserProfile>(cacheKey);
    if (cached) return cached;

    const pending = cache.getPending<UserProfile>(cacheKey);
    if (pending) return pending;

    const promise = octokit
      .request("GET /users/{username}", { username: login })
      .then((res) => {
        cache.set(cacheKey, res.data);
        return res.data as UserProfile;
      });

    cache.setPending(cacheKey, promise);
    return promise;
  }

  function invalidateCache(pattern?: string) {
    cache.invalidate(pattern);
  }

  return {
    // State
    getState,
    subscribe,
    initialize,
    initializeAnonymous,
    reset,
    setOnUnauthorized,
    setOnRateLimited,
    // State actions
    fetchPRList,
    refreshPRList,
    fetchPRChecks,
    refreshAllPRChecks,
    getPRCheckKey,
    // API methods
    searchPRs,
    searchRepos,
    searchUsers,
    getPR,
    getPRFiles,
    getPRComments,
    createPRComment,
    getPRReviews,
    createPRReview,
    submitPRReview,
    deletePRReview,
    getPRChecks: getPRChecksForSha,
    getWorkflowRuns: getWorkflowRunsForSha,
    approveWorkflowRun,
    mergePR,
    getPRCommits,
    getPRConversation,
    createPRConversationComment,
    getPRTimeline,
    getFileContent,
    requestReviewers,
    removeReviewers,
    getRepoCollaborators,
    addAssignees,
    removeAssignees,
    getRepoLabels,
    addLabels,
    removeLabel,
    convertToDraft,
    markReadyForReview,
    updateBranch,
    closePR,
    reopenPR,
    deleteBranch,
    restoreBranch,
    // Reactions
    getIssueReactions,
    addIssueReaction,
    deleteIssueReaction,
    getCommentReactions,
    addCommentReaction,
    deleteCommentReaction,
    // Review comment reactions
    getReviewCommentReactions,
    addReviewCommentReaction,
    deleteReviewCommentReaction,
    // GraphQL
    graphql,
    getPREnrichment,
    getReviewThreads,
    resolveThread,
    unresolveThread,
    getPendingReview,
    addPendingComment,
    deletePendingComment,
    updatePendingComment,
    submitPendingReview,
    updateComment,
    deleteComment,
    getUserProfile,
    invalidateCache,
  };
}

// ============================================================================
// Context
// ============================================================================

export type GitHubStore = ReturnType<typeof createGitHubStore>;

const GitHubContext = createContext<GitHubStore | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function GitHubProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated, isAnonymous, logout, setRateLimited } =
    useAuth();
  const storeRef = useRef<GitHubStore | null>(null);

  if (!storeRef.current) {
    storeRef.current = createGitHubStore();
  }

  const store = storeRef.current;

  // Set up unauthorized handler to logout when token is revoked
  useEffect(() => {
    store.setOnUnauthorized(logout);
  }, [store, logout]);

  // Set up rate limit handler
  useEffect(() => {
    store.setOnRateLimited(() => setRateLimited(true));
  }, [store, setRateLimited]);

  // Initialize/reset when token or anonymous mode changes
  useEffect(() => {
    if (isAuthenticated && token) {
      store.initialize(token);
    } else if (isAnonymous) {
      // Initialize in anonymous mode (no token, limited to public repos)
      store.initializeAnonymous();
    } else {
      store.reset();
    }
  }, [store, token, isAuthenticated, isAnonymous]);

  // Auto-refresh PR list every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (store.getState().ready) {
        store.refreshPRList();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [store]);

  // Auto-refresh PR checks every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (store.getState().ready) {
        store.refreshAllPRChecks();
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [store]);

  return (
    <GitHubContext.Provider value={store}>{children}</GitHubContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

export function useGitHubStore() {
  const store = useContext(GitHubContext);
  if (!store) {
    throw new Error("useGitHubStore must be used within GitHubProvider");
  }
  return store;
}

export function useGitHubSelector<T>(selector: (state: GitHubState) => T): T {
  const store = useGitHubStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState())
  );
}

// Convenience hooks
export function useGitHubReady() {
  const ready = useGitHubSelector((s) => s.ready);
  const error = useGitHubSelector((s) => s.error);
  return { ready, error };
}

export function useCurrentUser(): CurrentUserData | null {
  return useGitHubSelector((s) => s.currentUser);
}

export function usePRList() {
  return useGitHubSelector((s) => s.prList);
}

export function usePRListActions() {
  const store = useGitHubStore();
  return {
    fetchPRList: store.fetchPRList,
    refreshPRList: store.refreshPRList,
  };
}

export function usePRChecks(owner: string, repo: string, number: number) {
  const store = useGitHubStore();
  const ready = useGitHubSelector((s) => s.ready);
  const key = store.getPRCheckKey(owner, repo, number);
  const checkState = useGitHubSelector((s) => s.prChecks.get(key));

  useEffect(() => {
    if (ready && !checkState?.lastFetchedAt) {
      store.fetchPRChecks(owner, repo, number);
    }
  }, [ready, store, owner, repo, number, checkState?.lastFetchedAt]);

  return {
    status: checkState?.status || null,
    loading: checkState?.loading || false,
    refresh: () => store.fetchPRChecks(owner, repo, number),
  };
}

export function useRefreshAll() {
  const store = useGitHubStore();
  return useCallback(() => {
    store.refreshPRList();
    store.refreshAllPRChecks();
  }, [store]);
}

/**
 * Hook that throws if GitHub is not ready.
 * Use in components that require GitHub to be available.
 */
export function useGitHub(): GitHubStore {
  const store = useGitHubStore();
  const { ready, error } = useGitHubReady();

  if (error) {
    throw new Error(error);
  }

  if (!ready) {
    throw new Error("GitHub client not ready");
  }

  return store;
}

// Legacy compatibility - type alias
export type GitHubClient = GitHubStore;
