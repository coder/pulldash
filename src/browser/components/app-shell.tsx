import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  X,
  Home as HomeIcon,
  GitMerge,
  GitPullRequest,
  ExternalLink,
} from "lucide-react";
import { cn } from "../cn";
import {
  useTabContext,
  useOpenPRReviewTab,
  type Tab,
  type TabStatus,
} from "../contexts/tabs";
import { Home } from "./home";
import { PRReviewContent } from "./pr-review";
import { UserMenuButton } from "./welcome-dialog";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "../ui/hover-card";

// ============================================================================
// App Shell - Tab-based Layout
// ============================================================================

export function AppShell() {
  const {
    tabs,
    activeTabId,
    activeTab,
    setActiveTab,
    closeTab,
    openTab,
    getExistingPRTab,
  } = useTabContext();
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const navigate = useNavigate();

  // URL is the source of truth - sync URL → Tab
  useEffect(() => {
    if (params.owner && params.repo && params.number) {
      const owner = params.owner;
      const repo = params.repo;
      const number = parseInt(params.number, 10);
      const expectedTabId = `pr-${owner}-${repo}-${number}`;

      // Only update if needed
      if (activeTabId === expectedTabId) return;

      // Check if tab already exists
      const existing = getExistingPRTab(owner, repo, number);
      if (existing) {
        setActiveTab(existing.id);
      } else {
        // Create new tab
        openTab({
          id: expectedTabId,
          type: "pr-review",
          label: `#${number}`,
          owner,
          repo,
          number,
        });
      }
    } else {
      // Home route - only switch if not already on home
      if (activeTabId !== "home") {
        setActiveTab("home");
      }
    }
  }, [params.owner, params.repo, params.number]);

  // Navigate when clicking on a tab
  const handleTabSelect = useCallback(
    (tab: Tab) => {
      if (tab.type === "home") {
        navigate("/");
      } else if (
        tab.type === "pr-review" &&
        tab.owner &&
        tab.repo &&
        tab.number
      ) {
        navigate(`/${tab.owner}/${tab.repo}/pull/${tab.number}`);
      }
    },
    [navigate]
  );

  // Handle keyboard shortcuts for tab switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + number to switch tabs
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (tabs[index]) {
          handleTabSelect(tabs[index]);
        }
      }
      // Cmd/Ctrl + W to close current tab
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        if (activeTabId !== "home") {
          e.preventDefault();
          closeTab(activeTabId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tabs, activeTabId, handleTabSelect, closeTab]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Native-style Tab Bar */}
      <div className="h-9 bg-[#1a1a1a] flex items-center shrink-0 border-b border-border/50 app-drag-region">
        {/* Logo with tooltip */}
        <div className="h-full flex items-center gap-1.5 px-3 shrink-0 app-no-drag">
          <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <button className="flex items-center focus:outline-none">
                <img
                  src={"/logo.svg"}
                  alt="Pulldash"
                  className="w-4 h-4 block"
                />
              </button>
            </HoverCardTrigger>
            <HoverCardContent side="bottom" align="start" className="w-64">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <img src={"/logo.svg"} alt="Pulldash" className="w-6 h-6" />
                  <div>
                    <h4 className="text-sm font-semibold">Pulldash</h4>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      v0.0.2
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  A fast, local PR review dashboard for GitHub. Review pull
                  requests with a native-like experience.
                </p>
                <a
                  href="https://github.com/coder/pulldash"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  View on GitHub
                </a>
              </div>
            </HoverCardContent>
          </HoverCard>
        </div>

        {/* Tabs */}
        <div className="h-full flex-1 flex items-center gap-0.5 overflow-x-auto hide-scrollbar app-no-drag">
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={() => handleTabSelect(tab)}
              onClose={() => closeTab(tab.id)}
            />
          ))}
        </div>

        {/* PR URL input & User menu */}
        <div className="h-full flex items-center gap-2 pr-2 sm:pr-3 app-no-drag">
          <div className="hidden sm:block">
            <PRUrlInput />
          </div>
          <UserMenuButton />
        </div>
      </div>

      {/* Content Area - Only render active tab to avoid parallel data fetching */}
      <div className="flex-1 overflow-hidden relative">
        {/* Home is always mounted (lightweight) */}
        <div
          className={cn(
            "absolute inset-0",
            activeTabId !== "home" && "invisible pointer-events-none"
          )}
        >
          <Home />
        </div>

        {/* PR Review - only render active tab */}
        {activeTab?.type === "pr-review" &&
          activeTab.owner &&
          activeTab.repo &&
          activeTab.number && (
            <div key={activeTab.id} className="absolute inset-0">
              <PRReviewContent
                owner={activeTab.owner}
                repo={activeTab.repo}
                number={activeTab.number}
                tabId={activeTab.id}
              />
            </div>
          )}
      </div>
    </div>
  );
}

// ============================================================================
// Tab Item
// ============================================================================

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function TabItem({ tab, isActive, onSelect, onClose }: TabItemProps) {
  const isHome = tab.type === "home";

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 && !isHome) {
        e.preventDefault();
        onClose();
      }
    },
    [isHome, onClose]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onMouseDown={handleMiddleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md transition-colors shrink-0 max-w-[180px] cursor-pointer",
        isActive
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
      )}
    >
      {isHome ? (
        <HomeIcon className="w-3 h-3 shrink-0" />
      ) : tab.status?.state === "merged" ? (
        <GitMerge className="w-3 h-3 shrink-0 text-purple-500" />
      ) : (
        <TabStatusIndicator status={tab.status} />
      )}

      <span className="truncate">{isHome ? "Home" : tab.label}</span>

      {/* Repo name for PR tabs */}
      {tab.type === "pr-review" && tab.repo && (
        <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
          {tab.repo}
        </span>
      )}

      {/* Close button */}
      {!isHome && (
        <button
          onClick={handleClose}
          className={cn(
            "p-0.5 rounded hover:bg-white/10 transition-opacity shrink-0",
            isActive
              ? "opacity-60 hover:opacity-100"
              : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
          )}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Status Indicator
// ============================================================================

function TabStatusIndicator({ status }: { status?: TabStatus }) {
  if (!status) {
    // Loading state - show pulsing dot
    return (
      <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-pulse shrink-0" />
    );
  }

  // Determine the color based on state and checks
  let colorClass = "bg-muted-foreground/50"; // default/unknown
  let title = "Unknown";

  if (status.state === "closed") {
    colorClass = "bg-red-500";
    title = "Closed";
  } else if (status.state === "draft") {
    colorClass = "bg-muted-foreground";
    title = "Draft";
  } else if (status.state === "open") {
    // Open PR - color based on checks and mergeability
    if (status.mergeable === false) {
      colorClass = "bg-red-500";
      title = "Has conflicts";
    } else if (status.checks === "failure") {
      colorClass = "bg-red-500";
      title = "Checks failing";
    } else if (status.checks === "pending") {
      colorClass = "bg-yellow-500";
      title = "Checks running";
    } else if (status.checks === "success" || status.checks === "none") {
      colorClass = "bg-green-500";
      title = status.mergeable ? "Ready to merge" : "Checks passed";
    }
  }

  return (
    <span
      className={cn("w-2 h-2 rounded-full shrink-0", colorClass)}
      title={title}
    />
  );
}

// ============================================================================
// PR URL Input
// ============================================================================

function PRUrlInput() {
  const openPRReviewTab = useOpenPRReviewTab();
  const [prUrl, setPrUrl] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const url = prUrl.trim();
      if (!url) return;

      const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (match) {
        const [, owner, repo, number] = match;
        openPRReviewTab(owner, repo, parseInt(number, 10));
        setPrUrl("");
      }
    },
    [prUrl, openPRReviewTab]
  );

  return (
    <form onSubmit={handleSubmit} className="max-w-[180px]">
      <div className="relative">
        <input
          type="text"
          value={prUrl}
          onChange={(e) => setPrUrl(e.target.value)}
          placeholder="PR URL..."
          className="w-full h-6 pl-6 pr-2 rounded-md border border-border/50 bg-white/5 text-[11px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent font-mono"
        />
        <GitPullRequest className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
      </div>
    </form>
  );
}
