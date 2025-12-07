import { useEffect, useRef } from "react";
import { usePRReviewStore } from ".";

export function useHashNavigation() {
  const store = usePRReviewStore();

  // Track if we're currently updating the hash to avoid circular updates
  const isUpdatingHash = useRef(false);
  // Track if we've done initial navigation from hash
  const hasInitialized = useRef(false);
  // Track last hash to avoid unnecessary updates
  const lastHashRef = useRef<string>("");

  // Handle initial navigation from hash on mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const hash = window.location.hash;
    if (hash) {
      isUpdatingHash.current = true;
      store.navigateFromHash(hash);
      // Reset after a short delay to allow state to settle
      setTimeout(() => {
        isUpdatingHash.current = false;
      }, 100);
    }
  }, [store]);

  // Subscribe to store directly to update hash WITHOUT causing React re-renders
  useEffect(() => {
    const updateHash = () => {
      if (isUpdatingHash.current) return;

      const newHash = store.getHashFromState();
      const currentHash = window.location.hash.slice(1); // Remove leading #

      // Skip if hash hasn't changed
      if (newHash === lastHashRef.current) return;
      lastHashRef.current = newHash;

      if (newHash !== currentHash) {
        // Use replaceState to avoid creating history entries for every line navigation
        // but use pushState for file changes to allow back/forward navigation
        const currentParams = new URLSearchParams(currentHash);
        const newParams = new URLSearchParams(newHash);

        if (currentParams.get("file") !== newParams.get("file")) {
          // File changed - create history entry
          window.history.pushState(
            null,
            "",
            newHash ? `#${newHash}` : window.location.pathname
          );
        } else {
          // Same file, just line/comment change - replace
          window.history.replaceState(
            null,
            "",
            newHash ? `#${newHash}` : window.location.pathname
          );
        }
      }
    };

    // Subscribe directly to store - this doesn't cause React re-renders
    return store.subscribe(updateHash);
  }, [store]);

  // Handle browser back/forward navigation
  // Note: We need to listen for BOTH events:
  // - popstate: fires when using back/forward after pushState calls
  // - hashchange: fires when the hash changes directly (e.g., anchor clicks)
  useEffect(() => {
    const handleNavigation = () => {
      isUpdatingHash.current = true;
      lastHashRef.current = window.location.hash.slice(1); // Update lastHash to prevent loop
      store.navigateFromHash(window.location.hash);
      setTimeout(() => {
        isUpdatingHash.current = false;
      }, 100);
    };

    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("hashchange", handleNavigation);
    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("hashchange", handleNavigation);
    };
  }, [store]);
}
