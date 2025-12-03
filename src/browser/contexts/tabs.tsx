import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

// ============================================================================
// Types
// ============================================================================

export type TabStatus = {
  // CI status
  checks: "pending" | "success" | "failure" | "none" | "action_required";
  // PR state
  state: "open" | "closed" | "merged" | "draft";
  // Mergeable
  mergeable: boolean | null;
};

export interface Tab {
  id: string;
  type: "home" | "pr-review";
  label: string;
  // For PR review tabs
  owner?: string;
  repo?: string;
  number?: number;
  // Status reported by the tab content
  status?: TabStatus;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string;
}

interface TabContextValue {
  tabs: Tab[];
  activeTabId: string;
  activeTab: Tab | undefined;
  openTab: (tab: Omit<Tab, "id"> & { id?: string }) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabStatus: (tabId: string, status: TabStatus) => void;
  getExistingPRTab: (
    owner: string,
    repo: string,
    number: number
  ) => Tab | undefined;
}

// ============================================================================
// Storage
// ============================================================================

const STORAGE_KEY = "pulldash_tabs";

const HOME_TAB: Tab = {
  id: "home",
  type: "home",
  label: "Home",
};

const DEFAULT_STATE: TabState = {
  tabs: [HOME_TAB],
  activeTabId: "home",
};

function loadTabState(): TabState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as TabState;
      // Ensure home tab always exists
      const hasHome = parsed.tabs.some((t) => t.id === "home");
      if (!hasHome) {
        parsed.tabs.unshift(HOME_TAB);
      }
      // Ensure active tab exists
      const activeExists = parsed.tabs.some((t) => t.id === parsed.activeTabId);
      if (!activeExists) {
        parsed.activeTabId = "home";
      }
      return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_STATE;
}

function saveTabState(state: TabState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ============================================================================
// Context
// ============================================================================

const TabContext = createContext<TabContextValue | null>(null);

export function useTabContext() {
  const ctx = useContext(TabContext);
  if (!ctx) {
    throw new Error("useTabContext must be used within TabProvider");
  }
  return ctx;
}

// ============================================================================
// Provider
// ============================================================================

interface TabProviderProps {
  children: ReactNode;
}

export function TabProvider({ children }: TabProviderProps) {
  const [state, setState] = useState<TabState>(loadTabState);

  // Save to localStorage whenever state changes
  useEffect(() => {
    saveTabState(state);
  }, [state]);

  const openTab = useCallback(
    (tabInput: Omit<Tab, "id"> & { id?: string }): string => {
      const id = tabInput.id || `tab-${Date.now()}`;
      const tab: Tab = { ...tabInput, id };

      setState((prev) => {
        // Check if tab already exists
        const existing = prev.tabs.find((t) => t.id === id);
        if (existing) {
          return { ...prev, activeTabId: id };
        }
        return {
          tabs: [...prev.tabs, tab],
          activeTabId: id,
        };
      });

      return id;
    },
    []
  );

  const closeTab = useCallback((tabId: string) => {
    // Can't close home tab
    if (tabId === "home") return;

    setState((prev) => {
      const tabIndex = prev.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return prev;

      const newTabs = prev.tabs.filter((t) => t.id !== tabId);
      let newActiveId = prev.activeTabId;

      // If closing active tab, switch to adjacent tab
      if (prev.activeTabId === tabId) {
        const newIndex = Math.min(tabIndex, newTabs.length - 1);
        newActiveId = newTabs[newIndex].id;
      }

      return { tabs: newTabs, activeTabId: newActiveId };
    });
  }, []);

  const setActiveTab = useCallback((tabId: string) => {
    setState((prev) => {
      if (prev.tabs.some((t) => t.id === tabId)) {
        return { ...prev, activeTabId: tabId };
      }
      return prev;
    });
  }, []);

  const updateTabStatus = useCallback((tabId: string, status: TabStatus) => {
    setState((prev) => {
      const tabIndex = prev.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return prev;

      const newTabs = [...prev.tabs];
      newTabs[tabIndex] = { ...newTabs[tabIndex], status };
      return { ...prev, tabs: newTabs };
    });
  }, []);

  const getExistingPRTab = useCallback(
    (owner: string, repo: string, number: number): Tab | undefined => {
      return state.tabs.find(
        (t) =>
          t.type === "pr-review" &&
          t.owner === owner &&
          t.repo === repo &&
          t.number === number
      );
    },
    [state.tabs]
  );

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId);

  const value: TabContextValue = {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab,
    openTab,
    closeTab,
    setActiveTab,
    updateTabStatus,
    getExistingPRTab,
  };

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

export function useOpenPRReviewTab() {
  const { openTab, getExistingPRTab, setActiveTab } = useTabContext();
  const navigate = useNavigate();

  return useCallback(
    (owner: string, repo: string, number: number) => {
      // Check if tab already exists
      const existing = getExistingPRTab(owner, repo, number);
      if (existing) {
        setActiveTab(existing.id);
        // Navigate to the PR URL
        navigate(`/${owner}/${repo}/pull/${number}`);
        return existing.id;
      }

      // Create new tab
      const id = `pr-${owner}-${repo}-${number}`;
      const tabId = openTab({
        id,
        type: "pr-review",
        label: `#${number}`,
        owner,
        repo,
        number,
      });

      // Navigate to the PR URL
      navigate(`/${owner}/${repo}/pull/${number}`);

      return tabId;
    },
    [openTab, getExistingPRTab, setActiveTab, navigate]
  );
}
