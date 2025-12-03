import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  GitPullRequest,
  Loader2,
  Star,
  X,
  Plus,
  FileCode,
  Check,
  GitMerge,
  ChevronDown,
  Eye,
  User,
  Users,
  RefreshCw,
  Github,
} from "lucide-react";
import { cn } from "../cn";
import { Skeleton } from "../ui/skeleton";
import { UserHoverCard } from "../ui/user-hover-card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../ui/pagination";
import { useOpenPRReviewTab } from "../contexts/tabs";
import {
  useGitHubStore,
  useGitHubReady,
  usePRList,
  usePRListActions,
  type PRSearchResult,
} from "../contexts/github";
import { useAuth } from "../contexts/auth";

// ============================================================================
// Types
// ============================================================================

interface SearchResult {
  id: number;
  full_name: string;
  description: string | null;
  stargazers_count?: number;
  forks_count?: number;
  updated_at?: string;
  owner: {
    login: string;
    avatar_url: string;
  } | null;
}

// Filter mode type
type FilterMode = "review-requested" | "authored" | "involves" | "all";

// Special constant for "All Repos" global filter
const ALL_REPOS_KEY = "__all_repos__";

// Repository with its filter mode
interface RepoFilter {
  name: string;
  mode: FilterMode;
}

// Filter configuration stored in localStorage
interface FilterConfig {
  repos: RepoFilter[];
  state: "open" | "closed" | "all";
}

// Check if a filter is the special "All Repos" filter
function isAllReposFilter(filter: RepoFilter): boolean {
  return filter.name === ALL_REPOS_KEY;
}

// ============================================================================
// Storage Helpers
// ============================================================================

const STORAGE_KEY = "pulldash_filter_config";

const DEFAULT_CONFIG: FilterConfig = {
  // Default to showing review requests across all repos
  repos: [{ name: ALL_REPOS_KEY, mode: "review-requested" }],
  state: "open",
};

function getFilterConfig(): FilterConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migration: convert old string[] repos to RepoFilter[]
      if (
        parsed.repos &&
        parsed.repos.length > 0 &&
        typeof parsed.repos[0] === "string"
      ) {
        parsed.repos = parsed.repos.map((name: string) => ({
          name,
          mode: parsed.mode || "review-requested",
        }));
        delete parsed.mode;
      }
      // Migration: if user has empty repos, give them the new default (All Repos)
      if (parsed.repos && parsed.repos.length === 0) {
        parsed.repos = DEFAULT_CONFIG.repos;
      }
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return DEFAULT_CONFIG;
}

function saveFilterConfig(config: FilterConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ============================================================================
// Query Builder
// ============================================================================

function getModeFilter(mode: FilterMode): string {
  switch (mode) {
    case "review-requested":
      return "review-requested:@me";
    case "authored":
      return "author:@me";
    case "involves":
      return "involves:@me";
    default:
      return "";
  }
}

// Build queries grouped by mode (GitHub doesn't support per-repo qualifiers with OR)
// Multiple repo: qualifiers act as OR, but user filters apply to all repos
function buildSearchQueries(config: FilterConfig): string[] {
  if (config.repos.length === 0) {
    return [];
  }

  const stateFilter =
    config.state === "open"
      ? "is:open"
      : config.state === "closed"
        ? "is:closed"
        : "";

  const queries: string[] = [];

  // Separate "All Repos" filters from specific repo filters
  const allReposFilters = config.repos.filter(isAllReposFilter);
  const specificRepos = config.repos.filter((r) => !isAllReposFilter(r));

  // Handle "All Repos" global filters (one query per mode)
  for (const filter of allReposFilters) {
    const parts = ["is:pr", "archived:false"];
    if (stateFilter) parts.push(stateFilter);
    const modeFilter = getModeFilter(filter.mode);
    if (modeFilter) parts.push(modeFilter);
    // Note: "all" mode on All Repos would be too broad, so we skip it
    if (filter.mode !== "all") {
      queries.push(parts.join(" "));
    }
  }

  // Group specific repos by mode
  if (specificRepos.length > 0) {
    const byMode = new Map<FilterMode, string[]>();
    for (const repo of specificRepos) {
      const existing = byMode.get(repo.mode) || [];
      existing.push(repo.name);
      byMode.set(repo.mode, existing);
    }

    for (const [mode, repos] of byMode) {
      const parts = ["is:pr", "archived:false"];
      if (stateFilter) parts.push(stateFilter);
      // Multiple repo: qualifiers act as OR
      parts.push(...repos.map((r) => `repo:${r}`));
      const modeFilter = getModeFilter(mode);
      if (modeFilter) parts.push(modeFilter);
      queries.push(parts.join(" "));
    }
  }

  return queries;
}

// ============================================================================
// Helpers
// ============================================================================

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function extractRepoFromUrl(
  url: string
): { owner: string; repo: string } | null {
  const match = url.match(/repos\/([^/]+)\/([^/]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

// ============================================================================
// Mode Options
// ============================================================================

const MODE_OPTIONS = [
  {
    value: "review-requested",
    label: "Review Requests",
    icon: Eye,
    description: "PRs where you're requested as reviewer",
  },
  {
    value: "authored",
    label: "My PRs",
    icon: User,
    description: "PRs you authored",
  },
  {
    value: "involves",
    label: "Involves Me",
    icon: Users,
    description: "PRs that mention or involve you",
  },
  {
    value: "all",
    label: "All PRs",
    icon: GitPullRequest,
    description: "All PRs in selected repos",
  },
] as const;

const STATE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const;

// ============================================================================
// Main Component
// ============================================================================

export function Home() {
  const openPRReviewTab = useOpenPRReviewTab();
  const { ready: githubReady, error: githubError } = useGitHubReady();
  const github = useGitHubStore();
  const { isAuthenticated, isAnonymous, setShowWelcomeDialog } = useAuth();

  // Data store
  const prList = usePRList();
  const { fetchPRList, refreshPRList } = usePRListActions();

  // Filter config
  const [config, setConfig] = useState<FilterConfig>(getFilterConfig);

  // Search for adding repos
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const perPage = 30;

  // Build queries from config (one per mode group)
  const searchQueries = useMemo(() => buildSearchQueries(config), [config]);

  // Save config to localStorage whenever it changes
  useEffect(() => {
    saveFilterConfig(config);
  }, [config]);

  // Fetch PRs when queries or page changes (or when GitHub becomes ready)
  // Skip if anonymous and queries use @me (requires authentication)
  const queriesRequireAuth = searchQueries.some((q) => q.includes("@me"));
  useEffect(() => {
    if (githubReady && !(isAnonymous && queriesRequireAuth)) {
      fetchPRList(searchQueries, page, perPage);
    }
  }, [fetchPRList, searchQueries, page, perPage, githubReady, isAnonymous, queriesRequireAuth]);

  // Reset page when config changes
  useEffect(() => {
    setPage(1);
  }, [config.repos, config.state]);

  // Convenience accessors
  const prs = prList.items;
  const loadingPrs = prList.loading;
  const totalCount = prList.totalCount;

  // Search repositories with debounce
  useEffect(() => {
    if (!github || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        let query = searchQuery.trim();
        const slashMatch = query.match(/^([^/\s]+)\/([^/\s]+)$/);
        if (slashMatch) {
          const [, org, name] = slashMatch;
          query = `org:${org} ${name}`;
        }

        const data = await github.searchRepos(query);
        setSearchResults(data.items || []);
      } catch (e) {
        console.error("Failed to search repos:", e);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [github, searchQuery]);

  const handleAddRepo = useCallback((fullName: string) => {
    setConfig((prev) => {
      if (prev.repos.some((r) => r.name === fullName)) return prev;
      return {
        ...prev,
        repos: [...prev.repos, { name: fullName, mode: "review-requested" }],
      };
    });
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  const handleRemoveRepo = useCallback((repoName: string) => {
    setConfig((prev) => ({
      ...prev,
      repos: prev.repos.filter((r) => r.name !== repoName),
    }));
  }, []);

  const handleRepoModeChange = useCallback(
    (repoName: string, mode: FilterMode) => {
      setConfig((prev) => ({
        ...prev,
        repos: prev.repos.map((r) =>
          r.name === repoName ? { ...r, mode } : r
        ),
      }));
    },
    []
  );

  const handleStateChange = useCallback((state: FilterConfig["state"]) => {
    setConfig((prev) => ({ ...prev, state }));
  }, []);

  const handleOpenPR = useCallback(
    (owner: string, repo: string, number: number) => {
      openPRReviewTab(owner, repo, number);
    },
    [openPRReviewTab]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  // Track which repo dropdown is open
  const [openRepoDropdown, setOpenRepoDropdown] = useState<string | null>(null);
  const [repoDropdownPosition, setRepoDropdownPosition] = useState({ top: 0, left: 0 });
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [addRepoButtonRef, setAddRepoButtonRef] = useState<HTMLButtonElement | null>(null);
  const [addRepoDropdownPosition, setAddRepoDropdownPosition] = useState({ top: 0, right: 0 });

  // Show loading/error state while GitHub client initializes
  if (!githubReady) {
    if (githubError) {
      return (
        <div className="h-full bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <p className="text-destructive font-medium">
              Failed to connect to GitHub
            </p>
            <p className="text-sm text-muted-foreground">{githubError}</p>
          </div>
        </div>
      );
    }
    return <HomeLoadingSkeleton />;
  }

  // Check if user needs to auth to see PRs (anonymous + queries that require @me)
  const needsAuth = isAnonymous && !isAuthenticated && queriesRequireAuth;

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Filter Bar */}
      <div className="border-b border-border px-2 sm:px-4 py-2 shrink-0 bg-card/30">
        {/* Mobile: horizontal scroll, Desktop: wrap */}
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto hide-scrollbar">
          {/* State Toggle */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-muted/50 shrink-0">
            {STATE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => handleStateChange(option.value)}
                className={cn(
                  "px-2 py-1 text-xs font-medium rounded transition-colors",
                  config.state === option.value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Repo Chips with Mode Dropdowns */}
          <div className="flex items-center gap-1.5 shrink-0">
            {config.repos.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Add a filter to get started →
              </span>
            )}
            {config.repos.map((repo) => {
              const isAllRepos = isAllReposFilter(repo);
              const modeOption = MODE_OPTIONS.find(
                (m) => m.value === repo.mode
              )!;
              const isOpen = openRepoDropdown === repo.name;
              // For "All Repos", exclude the "All PRs" mode since it would be too broad
              const availableModes = isAllRepos
                ? MODE_OPTIONS.filter((m) => m.value !== "all")
                : MODE_OPTIONS;

              return (
                <div key={repo.name} className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if (!isOpen) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setRepoDropdownPosition({
                          top: rect.bottom + 4,
                          left: rect.left,
                        });
                      }
                      setOpenRepoDropdown(isOpen ? null : repo.name);
                      setShowAddRepo(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setRepoDropdownPosition({
                          top: rect.bottom + 4,
                          left: rect.left,
                        });
                        setOpenRepoDropdown(isOpen ? null : repo.name);
                        setShowAddRepo(false);
                      }
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md text-xs transition-colors border cursor-pointer",
                      isOpen
                        ? "bg-muted border-border"
                        : isAllRepos
                          ? "bg-primary/10 border-primary/30 hover:bg-primary/20 hover:border-primary/50"
                          : "bg-muted/50 border-transparent hover:bg-muted hover:border-border"
                    )}
                  >
                    <modeOption.icon
                      className={cn(
                        "w-3 h-3",
                        isAllRepos ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    <span className={isAllRepos ? "font-medium" : "font-mono"}>
                      {isAllRepos ? "All Repos" : repo.name}
                    </span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveRepo(repo.name);
                      }}
                      className="p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  {isOpen && (
                    <>
                      {/* Backdrop to close dropdown when clicking outside */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOpenRepoDropdown(null)}
                      />
                      <div
                        className="fixed w-56 bg-card border border-border rounded-lg shadow-xl z-50 max-w-[calc(100vw-1rem)] sm:max-w-none"
                        style={{
                          top: repoDropdownPosition.top,
                          left: repoDropdownPosition.left,
                        }}
                      >
                        {availableModes.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => {
                              handleRepoModeChange(repo.name, option.value);
                              setOpenRepoDropdown(null);
                            }}
                            className={cn(
                              "w-full flex items-start gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left",
                              repo.mode === option.value && "bg-muted/50"
                            )}
                          >
                            <option.icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-xs">
                                {option.label}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {option.description}
                              </div>
                            </div>
                            {repo.mode === option.value && (
                              <Check className="w-3.5 h-3.5 text-primary mt-0.5" />
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Query Preview & Add Repo - pushed to right */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Query Preview */}
            {searchQueries.length > 0 && (
              <div
                className="text-xs text-muted-foreground font-mono truncate max-w-xs hidden lg:block shrink-0"
                title={searchQueries.join("\n")}
              >
                {searchQueries.length === 1
                  ? searchQueries[0]
                  : `${searchQueries.length} queries`}
              </div>
            )}

            {/* Add Repo Button */}
            <div className="relative shrink-0">
              <button
                ref={setAddRepoButtonRef}
                onClick={() => {
                  if (!showAddRepo && addRepoButtonRef) {
                    const rect = addRepoButtonRef.getBoundingClientRect();
                    setAddRepoDropdownPosition({
                      top: rect.bottom + 4,
                      right: window.innerWidth - rect.right,
                    });
                  }
                  setShowAddRepo(!showAddRepo);
                  setOpenRepoDropdown(null);
                }}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors text-xs",
                  showAddRepo
                    ? "bg-muted border-border text-foreground"
                    : "border-dashed border-border hover:bg-muted/50 hover:border-solid text-muted-foreground hover:text-foreground"
                )}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Repo</span>
              </button>

              {/* Search Dropdown */}
              {showAddRepo && (
                <>
                  {/* Backdrop to close dropdown when clicking outside */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => {
                      setShowAddRepo(false);
                      setSearchQuery("");
                    }}
                  />
                  <div
                    className="fixed w-72 max-w-[calc(100vw-1rem)] bg-card border border-border rounded-lg shadow-xl z-50"
                    style={{
                      top: addRepoDropdownPosition.top,
                      right: addRepoDropdownPosition.right,
                    }}
                  >
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search repositories..."
                          className="w-full h-7 pl-7 pr-3 rounded-md border border-border bg-muted/50 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                          autoFocus
                        />
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        {searching && (
                          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    <div className="add-repo-dropdown max-h-64 overflow-auto">
                    {/* All Repos option - always shown at top when not already added */}
                    {!config.repos.some(isAllReposFilter) && !searchQuery && (
                      <button
                        onMouseDown={() => {
                          handleAddRepo(ALL_REPOS_KEY);
                          setShowAddRepo(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-primary/10 transition-colors text-left border-b border-border bg-primary/5"
                      >
                        <div className="w-4 h-4 rounded bg-primary/20 flex items-center justify-center shrink-0">
                          <Users className="w-3 h-3 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-xs">All Repos</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">
                            PRs across all repositories
                          </span>
                        </div>
                      </button>
                    )}
                    {searchResults.length > 0 ? (
                      searchResults.map((repo) => (
                        <button
                          key={repo.id}
                          onMouseDown={() => {
                            handleAddRepo(repo.full_name);
                            setShowAddRepo(false);
                            setSearchQuery("");
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left border-b border-border/50 last:border-b-0"
                        >
                          {repo.owner && (
                            <img
                              src={repo.owner.avatar_url}
                              alt={repo.owner.login}
                              className="w-4 h-4 rounded shrink-0"
                            />
                          )}
                          <span className="font-medium text-xs truncate flex-1">
                            {repo.full_name}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Star className="w-3 h-3" />
                            {(repo.stargazers_count ?? 0).toLocaleString()}
                          </span>
                        </button>
                      ))
                    ) : searchQuery ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                        {searching ? "Searching..." : "No repositories found"}
                      </div>
                    ) : (
                      <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                        Type to search for repositories
                      </div>
                    )}
                  </div>
                </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* PR List Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Results Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <span className="text-xs text-muted-foreground">
              {loadingPrs ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading...
                </span>
              ) : (
                <span>
                  <span className="font-medium text-foreground">
                    {totalCount.toLocaleString()}
                  </span>{" "}
                  pull requests
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {prList.lastFetchedAt && (
                <span className="text-[10px] text-muted-foreground">
                  Updated {getTimeAgo(new Date(prList.lastFetchedAt))}
                </span>
              )}
              <button
                onClick={refreshPRList}
                disabled={loadingPrs}
                className={cn(
                  "p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground",
                  loadingPrs && "opacity-50"
                )}
                title="Refresh (auto-refreshes every 60s)"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", loadingPrs && "animate-spin")}
                />
              </button>
            </div>
          </div>

          {/* PR List */}
          <div className="flex-1 overflow-auto">
            {/* Show auth prompt for anonymous users */}
            {needsAuth ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <GitPullRequest className="w-12 h-12 text-muted-foreground/30 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">
                  Sign in to view your PRs
                </p>
                <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
                  Authenticate with GitHub to see your review requests, authored
                  PRs, and more
                </p>
                <button
                  onClick={() => setShowWelcomeDialog(true)}
                  className="flex items-center gap-2 px-4 py-2 mt-4 rounded-lg bg-foreground text-background font-medium text-sm hover:bg-foreground/90 transition-colors"
                >
                  <Github className="w-4 h-4" />
                  Sign in with GitHub
                </button>
              </div>
            ) : loadingPrs ||
              (config.repos.length > 0 && prs.length === 0 && !prList.error) ? (
              <PRListSkeleton count={8} />
            ) : prs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <GitPullRequest className="w-12 h-12 text-muted-foreground/30 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">
                  No pull requests found
                </p>
                <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
                  {config.repos.length === 0
                    ? "Add a filter to get started"
                    : config.repos.some(isAllReposFilter)
                      ? "No PRs match your current filters"
                      : "Try adjusting your filter settings"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {prs.map((pr) => (
                  <PRListItem key={pr.id} pr={pr} onSelect={handleOpenPR} />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-border px-4 py-3 shrink-0">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className={cn(
                        "cursor-pointer",
                        page === 1 && "pointer-events-none opacity-50"
                      )}
                    />
                  </PaginationItem>

                  {totalPages <= 7 ? (
                    Array.from({ length: totalPages }, (_, i) => (
                      <PaginationItem key={i + 1}>
                        <PaginationLink
                          onClick={() => setPage(i + 1)}
                          isActive={page === i + 1}
                          className="cursor-pointer"
                        >
                          {i + 1}
                        </PaginationLink>
                      </PaginationItem>
                    ))
                  ) : (
                    <>
                      {[1, 2, 3].map((n) => (
                        <PaginationItem key={n}>
                          <PaginationLink
                            onClick={() => setPage(n)}
                            isActive={page === n}
                            className="cursor-pointer"
                          >
                            {n}
                          </PaginationLink>
                        </PaginationItem>
                      ))}
                      {page > 4 && (
                        <PaginationItem>
                          <span className="px-2">...</span>
                        </PaginationItem>
                      )}
                      {page > 3 && page < totalPages - 2 && (
                        <PaginationItem>
                          <PaginationLink isActive className="cursor-pointer">
                            {page}
                          </PaginationLink>
                        </PaginationItem>
                      )}
                      {page < totalPages - 3 && (
                        <PaginationItem>
                          <span className="px-2">...</span>
                        </PaginationItem>
                      )}
                      {[totalPages - 2, totalPages - 1, totalPages]
                        .filter((n) => n > 3)
                        .map((n) => (
                          <PaginationItem key={n}>
                            <PaginationLink
                              onClick={() => setPage(n)}
                              isActive={page === n}
                              className="cursor-pointer"
                            >
                              {n}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                    </>
                  )}

                  <PaginationItem>
                    <PaginationNext
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      className={cn(
                        "cursor-pointer",
                        page === totalPages && "pointer-events-none opacity-50"
                      )}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PR List Item
// ============================================================================

interface PRListItemProps {
  pr: PRSearchResult;
  onSelect: (owner: string, repo: string, number: number) => void;
}

function PRListItem({ pr, onSelect }: PRListItemProps) {
  const repoInfo = extractRepoFromUrl(pr.repository_url);
  const isMerged = pr.pull_request?.merged_at != null;
  const isClosed = pr.state === "closed" && !isMerged;

  const handleClick = () => {
    if (repoInfo) {
      onSelect(repoInfo.owner, repoInfo.repo, pr.number);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-start gap-2 sm:gap-3 px-2 sm:px-4 py-3 hover:bg-muted/50 transition-colors text-left"
    >
      {/* PR Icon */}
      {isMerged ? (
        <GitMerge className="w-4 h-4 mt-0.5 shrink-0 text-purple-500" />
      ) : isClosed ? (
        <GitPullRequest className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
      ) : (
        <GitPullRequest
          className={cn(
            "w-4 h-4 mt-0.5 shrink-0",
            pr.draft ? "text-muted-foreground" : "text-green-500"
          )}
        />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium hover:text-blue-400 break-words">
            {pr.title}
          </span>
          {pr.hasNewChanges && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 shrink-0">
              NEW
            </span>
          )}
          {/* Labels - hide on mobile to save space */}
          {pr.labels.slice(0, 3).map((label) => (
            <span
              key={label.name}
              className="px-2 py-0.5 text-[11px] font-medium rounded-full hidden sm:inline-block"
              style={{
                backgroundColor: `#${label.color}20`,
                color: `#${label.color}`,
                border: `1px solid #${label.color}40`,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
          {repoInfo && (
            <>
              <span className="font-mono truncate max-w-[120px] sm:max-w-none">
                {repoInfo.owner}/{repoInfo.repo}
              </span>
              <span>•</span>
            </>
          )}
          <span>#{pr.number}</span>
          <span className="hidden xs:inline">•</span>
          <span className="hidden xs:inline">
            {getTimeAgo(new Date(pr.updated_at))}
          </span>
          {pr.user && (
            <>
              <span className="hidden sm:inline">•</span>
              <UserHoverCard login={pr.user.login}>
                <span className="hover:text-blue-400 hover:underline cursor-pointer hidden sm:inline">
                  {pr.user.login}
                </span>
              </UserHoverCard>
            </>
          )}
          {pr.changedFiles !== undefined && (
            <>
              <span className="hidden sm:inline">•</span>
              <span className="hidden sm:flex items-center gap-1">
                <FileCode className="w-3 h-3" />
                {pr.changedFiles}
              </span>
            </>
          )}
          {(pr.additions !== undefined || pr.deletions !== undefined) && (
            <>
              <span className="hidden sm:inline">•</span>
              <span className="hidden sm:inline">
                <span className="text-green-500">+{pr.additions || 0}</span>{" "}
                <span className="text-red-500">−{pr.deletions || 0}</span>
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// Skeleton Components
// ============================================================================

function HomeLoadingSkeleton() {
  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Filter Bar Skeleton */}
      <div className="border-b border-border px-4 py-2 shrink-0 flex items-center gap-3 bg-card/30">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-6 w-48" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-[200px]" />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Results Header Skeleton */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>

          {/* PR List Skeleton */}
          <PRListSkeleton count={8} />
        </div>
      </div>
    </div>
  );
}

function PRListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <PRListItemSkeleton key={i} />
      ))}
    </div>
  );
}

function PRListItemSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {/* PR Icon */}
      <Skeleton className="w-4 h-4 mt-0.5 rounded-full shrink-0" />

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-[60%]" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}
