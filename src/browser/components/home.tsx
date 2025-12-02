import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  GitPullRequest,
  Loader2,
  Star,
  X,
  Plus,
  MessageSquare,
  FileCode,
  Check,
  GitMerge,
  ExternalLink,
  CheckCircle2,
  XCircle,
  MinusCircle,
  AlertCircle,
  ChevronDown,
  Send,
  Clock,
  Eye,
  User,
  Users,
  RefreshCw,
} from "lucide-react";
import { cn } from "../cn";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../ui/pagination";
import { Markdown } from "../ui/markdown";
import { useOpenPRReviewTab } from "../contexts/tabs";
import {
  usePRList,
  usePRListActions,
  type PRSearchResult,
} from "../contexts/data-store";

// ============================================================================
// Types
// ============================================================================

interface SearchResult {
  id: number;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

// PRSearchResult is imported from data-store

interface PRDetail {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  comments: number;
  review_comments: number;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: {
    login: string;
    avatar_url: string;
  };
  labels: Array<{
    name: string;
    color: string;
  }>;
  requested_reviewers: Array<{
    login: string;
    avatar_url: string;
  }>;
}

interface Review {
  id: number;
  state: string;
  body: string | null;
  submitted_at: string | null;
  user: {
    login: string;
    avatar_url: string;
  } | null;
}

interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string | null;
}

interface CombinedStatus {
  state: string;
  statuses: Array<{
    state: string;
    context: string;
    description: string | null;
    target_url: string | null;
  }>;
}

interface IssueComment {
  id: number;
  body: string | null;
  created_at: string;
  user: {
    login: string;
    avatar_url: string;
  } | null;
}

// Filter mode type
type FilterMode = "review-requested" | "authored" | "involves" | "all";

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

// ============================================================================
// Storage Helpers
// ============================================================================

const STORAGE_KEY = "pulldash_filter_config";

const DEFAULT_CONFIG: FilterConfig = {
  repos: [],
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

  // Group repos by mode
  const byMode = new Map<FilterMode, string[]>();
  for (const repo of config.repos) {
    const existing = byMode.get(repo.mode) || [];
    existing.push(repo.name);
    byMode.set(repo.mode, existing);
  }

  const stateFilter =
    config.state === "open"
      ? "is:open"
      : config.state === "closed"
        ? "is:closed"
        : "";
  const queries: string[] = [];

  for (const [mode, repos] of byMode) {
    const parts = ["is:pr"];
    if (stateFilter) parts.push(stateFilter);
    // Multiple repo: qualifiers act as OR
    parts.push(...repos.map((r) => `repo:${r}`));
    const modeFilter = getModeFilter(mode);
    if (modeFilter) parts.push(modeFilter);
    queries.push(parts.join(" "));
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

  // Data store
  const prList = usePRList();
  const { fetchPRList, refreshPRList } = usePRListActions();

  // Filter config
  const [config, setConfig] = useState<FilterConfig>(getFilterConfig);

  // Search for adding repos
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Direct PR URL input
  const [prUrl, setPrUrl] = useState("");
  const [prUrlError, setPrUrlError] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const perPage = 30;

  // Selected PR for split view
  const [selectedPR, setSelectedPR] = useState<{
    owner: string;
    repo: string;
    number: number;
  } | null>(null);

  // Build queries from config (one per mode group)
  const searchQueries = useMemo(() => buildSearchQueries(config), [config]);

  // Save config to localStorage whenever it changes
  useEffect(() => {
    saveFilterConfig(config);
  }, [config]);

  // Fetch PRs when queries or page changes
  useEffect(() => {
    fetchPRList(searchQueries, page, perPage);
  }, [fetchPRList, searchQueries, page, perPage]);

  // Reset page when config changes
  useEffect(() => {
    setPage(1);
  }, [config.repos, config.state]);

  // Convenience accessors
  const prs = prList.items;
  const loadingPrs = prList.loading;
  const totalCount = prList.totalCount;

  // Handle direct PR URL input
  const handlePrUrlRedirect = useCallback(
    (url: string) => {
      const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (match) {
        const [, owner, repo, number] = match;
        openPRReviewTab(owner, repo, parseInt(number, 10));
        setPrUrl("");
      } else {
        setPrUrlError("Invalid GitHub PR URL");
      }
    },
    [openPRReviewTab]
  );

  const handlePrUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prUrl.trim()) {
      handlePrUrlRedirect(prUrl.trim());
    }
  };

  // Search repositories with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
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

        const res = await fetch(
          `/api/search/repos?q=${encodeURIComponent(query)}`
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.items || []);
        }
      } catch (e) {
        console.error("Failed to search repos:", e);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

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

  const handleSelectPR = useCallback(
    (owner: string, repo: string, number: number) => {
      setSelectedPR({ owner, repo, number });
    },
    []
  );

  const handleClosePR = useCallback(() => {
    setSelectedPR(null);
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  // Track which repo dropdown is open
  const [openRepoDropdown, setOpenRepoDropdown] = useState<string | null>(null);
  const [showAddRepo, setShowAddRepo] = useState(false);

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Filter Bar */}
      <div className="border-b border-border px-4 py-2 shrink-0 flex items-center gap-3 bg-card/30">
        {/* State Toggle */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-muted/50">
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
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          {config.repos.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Add a repository to get started →
            </span>
          )}
          {config.repos.map((repo) => {
            const modeOption = MODE_OPTIONS.find((m) => m.value === repo.mode)!;
            const isOpen = openRepoDropdown === repo.name;

            return (
              <div key={repo.name} className="relative">
                <button
                  onClick={() => {
                    setOpenRepoDropdown(isOpen ? null : repo.name);
                    setShowAddRepo(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md text-xs transition-colors border",
                    isOpen
                      ? "bg-muted border-border"
                      : "bg-muted/50 border-transparent hover:bg-muted hover:border-border"
                  )}
                >
                  <modeOption.icon className="w-3 h-3 text-muted-foreground" />
                  <span className="font-mono">{repo.name}</span>
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
                </button>

                {isOpen && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-xl z-30 overflow-hidden">
                    {MODE_OPTIONS.map((option) => (
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
                )}
              </div>
            );
          })}
        </div>

        {/* Add Repo Button */}
        <div className="relative">
          <button
            onClick={() => {
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
            <div className="absolute top-full right-0 mt-1 w-72 bg-card border border-border rounded-lg shadow-xl overflow-hidden z-30">
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onBlur={(e) => {
                      // Close dropdown if not clicking inside it
                      if (!e.relatedTarget?.closest(".add-repo-dropdown")) {
                        setTimeout(() => setShowAddRepo(false), 150);
                      }
                    }}
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
                      <img
                        src={repo.owner.avatar_url}
                        alt={repo.owner.login}
                        className="w-4 h-4 rounded shrink-0"
                      />
                      <span className="font-medium text-xs truncate flex-1">
                        {repo.full_name}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Star className="w-3 h-3" />
                        {repo.stargazers_count.toLocaleString()}
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
          )}
        </div>

        {/* PR URL input */}
        <form onSubmit={handlePrUrlSubmit} className="max-w-[200px]">
          <div className="relative">
            <input
              type="text"
              value={prUrl}
              onChange={(e) => {
                setPrUrl(e.target.value);
                setPrUrlError("");
              }}
              placeholder="PR URL..."
              className="w-full h-7 pl-7 pr-3 rounded-md border border-border bg-muted/50 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent font-mono"
            />
            <GitPullRequest className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </form>

        {/* Query Preview */}
        {searchQueries.length > 0 && (
          <div
            className="text-xs text-muted-foreground font-mono truncate max-w-xs hidden lg:block"
            title={searchQueries.join("\n")}
          >
            {searchQueries.length === 1
              ? searchQueries[0]
              : `${searchQueries.length} queries`}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* PR List Panel */}
        <div
          className={cn(
            "flex-1 flex flex-col overflow-hidden",
            selectedPR && "max-w-[50%] border-r border-border"
          )}
        >
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
            {!loadingPrs && prs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <GitPullRequest className="w-12 h-12 text-muted-foreground/30 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">
                  No pull requests found
                </p>
                <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
                  {config.repos.length === 0
                    ? "Add a repository to get started, or change your filter mode"
                    : "Try adjusting your filter settings"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {prs.map((pr) => (
                  <PRListItem
                    key={pr.id}
                    pr={pr}
                    isSelected={selectedPR?.number === pr.number}
                    onSelect={handleSelectPR}
                  />
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

        {/* PR Detail Panel */}
        {selectedPR && (
          <PRDetailPanel
            owner={selectedPR.owner}
            repo={selectedPR.repo}
            number={selectedPR.number}
            onClose={handleClosePR}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PR List Item
// ============================================================================

interface PRListItemProps {
  pr: PRSearchResult;
  isSelected: boolean;
  onSelect: (owner: string, repo: string, number: number) => void;
}

function PRListItem({ pr, isSelected, onSelect }: PRListItemProps) {
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
      className={cn(
        "w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left",
        isSelected && "bg-blue-500/10"
      )}
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
          <span className="font-medium hover:text-blue-400">{pr.title}</span>
          {pr.hasNewChanges && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
              NEW
            </span>
          )}
          {pr.labels.slice(0, 3).map((label) => (
            <span
              key={label.name}
              className="px-2 py-0.5 text-[11px] font-medium rounded-full"
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
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
          {repoInfo && (
            <>
              <span className="font-mono">
                {repoInfo.owner}/{repoInfo.repo}
              </span>
              <span>•</span>
            </>
          )}
          <span>#{pr.number}</span>
          <span>•</span>
          <span>{getTimeAgo(new Date(pr.updated_at))}</span>
          {pr.user && (
            <>
              <span>•</span>
              <span>{pr.user.login}</span>
            </>
          )}
          {pr.changedFiles !== undefined && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                <FileCode className="w-3 h-3" />
                {pr.changedFiles}
              </span>
            </>
          )}
          {(pr.additions !== undefined || pr.deletions !== undefined) && (
            <>
              <span>•</span>
              <span>
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
// PR Detail Panel
// ============================================================================

interface PRDetailPanelProps {
  owner: string;
  repo: string;
  number: number;
  onClose: () => void;
}

function PRDetailPanel({ owner, repo, number, onClose }: PRDetailPanelProps) {
  const openPRReviewTab = useOpenPRReviewTab();

  const [pr, setPr] = useState<PRDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [checks, setChecks] = useState<{
    checkRuns: CheckRun[];
    status: CombinedStatus;
  } | null>(null);
  const [conversation, setConversation] = useState<IssueComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Merge state
  const [merging, setMerging] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | "rebase">(
    "squash"
  );
  const [showMergeOptions, setShowMergeOptions] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Comment state
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const handleReviewFiles = useCallback(() => {
    openPRReviewTab(owner, repo, number);
  }, [openPRReviewTab, owner, repo, number]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [prRes, reviewsRes, checksRes, conversationRes] =
          await Promise.all([
            fetch(`/api/pr/${owner}/${repo}/${number}`),
            fetch(`/api/pr/${owner}/${repo}/${number}/reviews`),
            fetch(`/api/pr/${owner}/${repo}/${number}/checks`),
            fetch(`/api/pr/${owner}/${repo}/${number}/conversation`),
          ]);

        if (!prRes.ok) throw new Error("Failed to fetch PR");
        setPr(await prRes.json());
        if (reviewsRes.ok) setReviews(await reviewsRes.json());
        if (checksRes.ok) setChecks(await checksRes.json());
        if (conversationRes.ok) setConversation(await conversationRes.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [owner, repo, number]);

  const handleMerge = useCallback(async () => {
    if (!pr) return;
    setMerging(true);
    setMergeError(null);

    try {
      const response = await fetch(
        `/api/pr/${owner}/${repo}/${pr.number}/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merge_method: mergeMethod }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to merge");
      }

      window.location.reload();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Failed to merge");
    } finally {
      setMerging(false);
    }
  }, [owner, repo, pr, mergeMethod]);

  const handleAddComment = useCallback(async () => {
    if (!commentText.trim() || !pr) return;

    setSubmittingComment(true);
    try {
      const response = await fetch(
        `/api/pr/${owner}/${repo}/${pr.number}/conversation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: commentText }),
        }
      );

      if (response.ok) {
        const newComment = await response.json();
        setConversation((prev) => [...prev, newComment]);
        setCommentText("");
      }
    } finally {
      setSubmittingComment(false);
    }
  }, [owner, repo, pr, commentText]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center max-w-[50%]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !pr) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 max-w-[50%]">
        <AlertCircle className="w-10 h-10 text-destructive mb-3" />
        <p className="text-destructive font-medium">Failed to load PR</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
        <button
          onClick={onClose}
          className="mt-4 px-4 py-2 text-sm rounded-lg bg-muted hover:bg-muted/80"
        >
          Close
        </button>
      </div>
    );
  }

  // Calculate check status
  const checkStatus = calculateCheckStatus(checks);
  const latestReviews = getLatestReviewsByUser(reviews);
  const canMergePR = canMerge(pr, checkStatus);

  const stateIcon = pr.merged ? (
    <GitMerge className="w-5 h-5 text-purple-500" />
  ) : pr.state === "open" ? (
    <GitPullRequest
      className={cn(
        "w-5 h-5",
        pr.draft ? "text-muted-foreground" : "text-green-500"
      )}
    />
  ) : (
    <GitPullRequest className="w-5 h-5 text-red-500" />
  );

  const stateLabel = pr.merged
    ? "Merged"
    : pr.draft
      ? "Draft"
      : pr.state === "open"
        ? "Open"
        : "Closed";
  const stateColor = pr.merged
    ? "bg-purple-500/20 text-purple-400"
    : pr.state === "open"
      ? pr.draft
        ? "bg-muted text-muted-foreground"
        : "bg-green-500/20 text-green-400"
      : "bg-red-500/20 text-red-400";

  return (
    <div className="flex-1 flex flex-col overflow-hidden max-w-[50%]">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {stateIcon}
              <span
                className={cn(
                  "px-2 py-0.5 text-xs font-medium rounded-full",
                  stateColor
                )}
              >
                {stateLabel}
              </span>
            </div>
            <h2 className="text-lg font-semibold mt-2">{pr.title}</h2>
            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground flex-wrap">
              <img
                src={pr.user.avatar_url}
                alt={pr.user.login}
                className="w-5 h-5 rounded-full"
              />
              <span>{pr.user.login}</span>
              <span>•</span>
              <code className="px-1.5 py-0.5 bg-muted rounded text-xs">
                {pr.head.ref}
              </code>
              <span>→</span>
              <code className="px-1.5 py-0.5 bg-muted rounded text-xs">
                {pr.base.ref}
              </code>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handleReviewFiles}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors text-sm"
          >
            <FileCode className="w-4 h-4" />
            Review Files
          </button>
          <a
            href={`https://github.com/${owner}/${repo}/pull/${number}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-sm"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-4">
          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <FileCode className="w-4 h-4" />
              {pr.changed_files} files
            </span>
            <span>
              <span className="text-green-500">+{pr.additions}</span>{" "}
              <span className="text-red-500">−{pr.deletions}</span>
            </span>
          </div>

          {/* Labels */}
          {pr.labels.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {pr.labels.map((label) => (
                <span
                  key={label.name}
                  className="px-2 py-0.5 text-xs font-medium rounded-full"
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
          )}

          {/* Description */}
          {pr.body && (
            <div className="p-4 bg-card border border-border rounded-lg">
              <Markdown>{pr.body}</Markdown>
            </div>
          )}

          {/* Merge Section */}
          {pr.state === "open" && !pr.merged && (
            <div className="p-4 bg-card border border-border rounded-lg space-y-3">
              <div className="flex items-center gap-3">
                {canMergePR ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-yellow-500" />
                )}
                <div className="flex-1">
                  <p className="font-medium text-sm">
                    {getMergeStatusText(pr, checkStatus)}
                  </p>
                  {mergeError && (
                    <p className="text-xs text-destructive mt-1">
                      {mergeError}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <button
                    onClick={() => setShowMergeOptions(!showMergeOptions)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm"
                    disabled={merging || !canMergePR}
                  >
                    <span className="flex items-center gap-2">
                      <GitMerge className="w-4 h-4" />
                      {getMergeButtonText(mergeMethod)}
                    </span>
                    <ChevronDown className="w-4 h-4" />
                  </button>

                  {showMergeOptions && (
                    <div className="absolute left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-10 overflow-hidden">
                      {(["merge", "squash", "rebase"] as const).map(
                        (method) => (
                          <button
                            key={method}
                            onClick={() => {
                              setMergeMethod(method);
                              setShowMergeOptions(false);
                            }}
                            className={cn(
                              "w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors",
                              mergeMethod === method && "bg-muted"
                            )}
                          >
                            {getMergeButtonText(method)}
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleMerge}
                  disabled={merging || !canMergePR}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm"
                >
                  {merging ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Confirm"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Merged State */}
          {pr.merged && (
            <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-purple-500" />
              <p className="text-sm font-medium text-purple-400">
                Pull request merged
              </p>
            </div>
          )}

          {/* Reviews */}
          {latestReviews.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Reviews
              </h3>
              {latestReviews.map((review) => (
                <ReviewItem key={review.id} review={review} />
              ))}
            </div>
          )}

          {/* Checks */}
          {checks &&
            (checks.checkRuns.length > 0 ||
              checks.status.statuses.length > 0) && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <CheckStatusIcon status={checkStatus} />
                  Checks
                </h3>
                <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {checks.checkRuns.map((check) => (
                    <CheckRunItem key={check.id} check={check} />
                  ))}
                  {checks.status.statuses.map((status, idx) => (
                    <StatusItem key={idx} status={status} />
                  ))}
                </div>
              </div>
            )}

          {/* Conversation */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Conversation ({conversation.length})
            </h3>

            {conversation.map((comment) => (
              <ConversationComment key={comment.id} comment={comment} />
            ))}

            {/* Add Comment */}
            <div className="space-y-2">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Leave a comment..."
                className="w-full min-h-[80px] px-3 py-2 text-sm rounded-lg border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleAddComment}
                  disabled={!commentText.trim() || submittingComment}
                  className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  Comment
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function ReviewItem({ review }: { review: Review }) {
  if (!review.user) return null;

  const getIcon = () => {
    switch (review.state) {
      case "APPROVED":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "CHANGES_REQUESTED":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "COMMENTED":
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
      default:
        return <MinusCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStateText = () => {
    switch (review.state) {
      case "APPROVED":
        return "approved";
      case "CHANGES_REQUESTED":
        return "requested changes";
      case "COMMENTED":
        return "commented";
      default:
        return "reviewed";
    }
  };

  return (
    <div className="flex items-start gap-2 p-3 bg-card border border-border rounded-lg">
      <img
        src={review.user.avatar_url}
        alt={review.user.login}
        className="w-6 h-6 rounded-full"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          {getIcon()}
          <span className="font-medium">{review.user.login}</span>
          <span className="text-muted-foreground">{getStateText()}</span>
        </div>
        {review.body && (
          <div className="mt-1 text-sm">
            <Markdown>{review.body}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckRunItem({ check }: { check: CheckRun }) {
  const getIcon = () => {
    if (check.status !== "completed") {
      return <Clock className="w-4 h-4 text-yellow-500 animate-pulse" />;
    }
    switch (check.conclusion) {
      case "success":
        return <Check className="w-4 h-4 text-green-500" />;
      case "failure":
        return <X className="w-4 h-4 text-red-500" />;
      default:
        return <MinusCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {getIcon()}
      <span className="flex-1 text-sm truncate">{check.name}</span>
      {check.html_url && (
        <a
          href={check.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

function StatusItem({
  status,
}: {
  status: {
    state: string;
    context: string;
    description: string | null;
    target_url: string | null;
  };
}) {
  const getIcon = () => {
    switch (status.state) {
      case "success":
        return <Check className="w-4 h-4 text-green-500" />;
      case "failure":
      case "error":
        return <X className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500 animate-pulse" />;
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {getIcon()}
      <span className="flex-1 text-sm truncate">{status.context}</span>
      {status.target_url && (
        <a
          href={status.target_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

function CheckStatusIcon({
  status,
}: {
  status: "success" | "failure" | "pending";
}) {
  switch (status) {
    case "success":
      return <Check className="w-4 h-4 text-green-500" />;
    case "failure":
      return <X className="w-4 h-4 text-red-500" />;
    default:
      return <Clock className="w-4 h-4 text-yellow-500" />;
  }
}

function ConversationComment({ comment }: { comment: IssueComment }) {
  if (!comment.user) return null;

  return (
    <div className="flex items-start gap-2 p-3 bg-card border border-border rounded-lg">
      <img
        src={comment.user.avatar_url}
        alt={comment.user.login}
        className="w-6 h-6 rounded-full"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{comment.user.login}</span>
          <span className="text-muted-foreground text-xs">
            {new Date(comment.created_at).toLocaleDateString()}
          </span>
        </div>
        {comment.body && (
          <div className="mt-1 text-sm">
            <Markdown>{comment.body}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateCheckStatus(
  checks: { checkRuns: CheckRun[]; status: CombinedStatus } | null
): "success" | "failure" | "pending" {
  if (!checks) return "success";

  const allChecks = [
    ...checks.checkRuns.map((c) =>
      c.status === "completed" ? c.conclusion : "pending"
    ),
    ...checks.status.statuses.map((s) => s.state),
  ];

  if (allChecks.length === 0) return "success";
  if (allChecks.some((c) => c === "failure" || c === "error")) return "failure";
  if (allChecks.some((c) => c === "pending" || c === null)) return "pending";
  return "success";
}

function getLatestReviewsByUser(reviews: Review[]): Review[] {
  const byUser = new Map<string, Review>();
  const sorted = [...reviews]
    .filter((r) => r.submitted_at && r.user)
    .sort(
      (a, b) =>
        new Date(a.submitted_at!).getTime() -
        new Date(b.submitted_at!).getTime()
    );

  for (const review of sorted) {
    if (
      review.state !== "COMMENTED" &&
      review.state !== "PENDING" &&
      review.user
    ) {
      byUser.set(review.user.login, review);
    }
  }

  const commented = sorted.filter((r) => r.state === "COMMENTED");
  return [...byUser.values(), ...commented];
}

function canMerge(
  pr: PRDetail,
  checkStatus: "success" | "failure" | "pending"
): boolean {
  if (pr.draft) return false;
  if (pr.state !== "open") return false;
  if (pr.mergeable === false) return false;
  return true;
}

function getMergeStatusText(
  pr: PRDetail,
  checkStatus: "success" | "failure" | "pending"
): string {
  if (pr.draft) return "This pull request is still a draft";
  if (pr.mergeable === false) return "This branch has conflicts";
  if (checkStatus === "failure") return "Some checks have failed";
  if (checkStatus === "pending") return "Checks are running";
  return "Ready to merge";
}

function getMergeButtonText(method: "merge" | "squash" | "rebase"): string {
  switch (method) {
    case "merge":
      return "Create merge commit";
    case "squash":
      return "Squash and merge";
    case "rebase":
      return "Rebase and merge";
  }
}
