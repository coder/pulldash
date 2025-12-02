import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

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
}

export interface CheckStatus {
  checks: "pending" | "success" | "failure" | "none";
  state: "open" | "closed" | "merged" | "draft";
  mergeable: boolean | null;
}

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

interface DataStoreState {
  // PR listing
  prList: PRListState;
  prListQueries: string[];
  prListPage: number;

  // PR checks by key (owner/repo/number)
  prChecks: Map<string, PRCheckState>;

  // Current user
  currentUser: string | null;
}

// ============================================================================
// Store Implementation
// ============================================================================

type Listener = () => void;

function createDataStore() {
  let state: DataStoreState = {
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
    currentUser: null,
  };

  const listeners = new Set<Listener>();

  function getState() {
    return state;
  }

  function setState(
    partial:
      | Partial<DataStoreState>
      | ((s: DataStoreState) => Partial<DataStoreState>)
  ) {
    const updates = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...updates };
    listeners.forEach((l) => l());
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // PR List Actions
  // -------------------------------------------------------------------------

  async function fetchPRList(
    queries: string[],
    page: number = 1,
    perPage: number = 30
  ) {
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

    setState((s) => ({
      prList: { ...s.prList, loading: true, error: null },
      prListQueries: queries,
      prListPage: page,
    }));

    try {
      const results = await Promise.all(
        queries.map((q) =>
          fetch(
            `/api/search/prs?q=${encodeURIComponent(q)}&page=${page}&per_page=${perPage}&enrich=true`
          ).then((res) => (res.ok ? res.json() : { items: [], total_count: 0 }))
        )
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
            combined.push(pr);
          }
        }
      }

      // Sort by updated_at descending
      combined.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );

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

  // -------------------------------------------------------------------------
  // PR Checks Actions
  // -------------------------------------------------------------------------

  function getPRCheckKey(owner: string, repo: string, number: number) {
    return `${owner}/${repo}/${number}`;
  }

  async function fetchPRChecks(owner: string, repo: string, number: number) {
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
      const [prRes, checksRes] = await Promise.all([
        fetch(`/api/pr/${owner}/${repo}/${number}`),
        fetch(`/api/pr/${owner}/${repo}/${number}/checks`),
      ]);

      if (!prRes.ok) throw new Error("Failed to fetch PR");

      const prData = await prRes.json();
      const checksData = checksRes.ok
        ? await checksRes.json()
        : { checkRuns: [], status: { statuses: [] } };

      // Calculate check status
      const checkRuns = checksData.checkRuns || [];
      const statuses = checksData.status?.statuses || [];

      let checks: CheckStatus["checks"] = "none";
      if (checkRuns.length > 0 || statuses.length > 0) {
        const allChecks = [
          ...checkRuns.map((c: any) =>
            c.status === "completed" ? c.conclusion : "pending"
          ),
          ...statuses.map((s: any) => s.state),
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
          },
          loading: false,
          lastFetchedAt: Date.now(),
        });
        return { prChecks: newChecks };
      });
    } catch (e) {
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

  function refreshPRChecks(owner: string, repo: string, number: number) {
    fetchPRChecks(owner, repo, number);
  }

  function refreshAllPRChecks() {
    for (const key of state.prChecks.keys()) {
      const [owner, repo, number] = key.split("/");
      if (owner && repo && number) {
        fetchPRChecks(owner, repo, parseInt(number, 10));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Current User
  // -------------------------------------------------------------------------

  async function fetchCurrentUser() {
    try {
      const res = await fetch("/api/user");
      if (res.ok) {
        const data = await res.json();
        setState({ currentUser: data.login });
      }
    } catch {
      // Ignore
    }
  }

  return {
    getState,
    subscribe,
    // Actions
    fetchPRList,
    refreshPRList,
    fetchPRChecks,
    refreshPRChecks,
    refreshAllPRChecks,
    fetchCurrentUser,
    // Helpers
    getPRCheckKey,
  };
}

// ============================================================================
// Context
// ============================================================================

type DataStore = ReturnType<typeof createDataStore>;

const DataStoreContext = createContext<DataStore | null>(null);

export function DataStoreProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<DataStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createDataStore();
  }

  const store = storeRef.current;

  // Fetch current user on mount
  useEffect(() => {
    store.fetchCurrentUser();
  }, [store]);

  // Auto-refresh PR list every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      store.refreshPRList();
    }, 60_000);
    return () => clearInterval(interval);
  }, [store]);

  // Auto-refresh PR checks every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      store.refreshAllPRChecks();
    }, 30_000);
    return () => clearInterval(interval);
  }, [store]);

  return (
    <DataStoreContext.Provider value={store}>
      {children}
    </DataStoreContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

export function useDataStore() {
  const store = useContext(DataStoreContext);
  if (!store) {
    throw new Error("useDataStore must be used within DataStoreProvider");
  }
  return store;
}

export function useDataStoreSelector<T>(
  selector: (state: DataStoreState) => T
): T {
  const store = useDataStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState())
  );
}

// Convenience hooks
export function usePRList() {
  return useDataStoreSelector((s) => s.prList);
}

export function usePRListActions() {
  const store = useDataStore();
  return {
    fetchPRList: store.fetchPRList,
    refreshPRList: store.refreshPRList,
  };
}

export function usePRChecks(owner: string, repo: string, number: number) {
  const store = useDataStore();
  const key = store.getPRCheckKey(owner, repo, number);

  const checkState = useDataStoreSelector((s) => s.prChecks.get(key));

  // Auto-fetch on mount if not loaded
  useEffect(() => {
    if (!checkState?.lastFetchedAt) {
      store.fetchPRChecks(owner, repo, number);
    }
  }, [store, owner, repo, number, checkState?.lastFetchedAt]);

  return {
    status: checkState?.status || null,
    loading: checkState?.loading || false,
    refresh: () => store.refreshPRChecks(owner, repo, number),
  };
}

export function useCurrentUser() {
  return useDataStoreSelector((s) => s.currentUser);
}

export function useRefreshAll() {
  const store = useDataStore();
  return useCallback(() => {
    store.refreshPRList();
    store.refreshAllPRChecks();
  }, [store]);
}
