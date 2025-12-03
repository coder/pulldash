import { useCallback, useEffect } from "react";
import { X, Home as HomeIcon, GitMerge } from "lucide-react";
import logoUrl from "../logo.svg";
import { cn } from "../cn";
import { useTabContext, type Tab, type TabStatus } from "../contexts/tabs";
import { Home } from "./home";
import { PRReviewContent } from "./pr-review";

// ============================================================================
// App Shell - Tab-based Layout
// ============================================================================

export function AppShell() {
  const { tabs, activeTabId, activeTab, setActiveTab, closeTab } =
    useTabContext();

  // Handle keyboard shortcuts for tab switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + number to switch tabs
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (tabs[index]) {
          setActiveTab(tabs[index].id);
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
  }, [tabs, activeTabId, setActiveTab, closeTab]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Native-style Tab Bar */}
      <div className="h-9 bg-[#1a1a1a] flex items-center shrink-0 border-b border-border/50 app-drag-region">
        {/* Logo */}
        <div className="flex items-center gap-1.5 px-3 shrink-0 app-no-drag">
          <img src={logoUrl} alt="Pulldash" className="w-4 h-4" />
        </div>

        {/* Tabs */}
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto hide-scrollbar app-no-drag">
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={() => setActiveTab(tab.id)}
              onClose={() => closeTab(tab.id)}
            />
          ))}
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
    <button
      onClick={onSelect}
      onMouseDown={handleMiddleClick}
      className={cn(
        "group flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md transition-colors shrink-0 max-w-[180px]",
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
    </button>
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
