import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { GitHubProvider } from "./contexts/github";
import { TabProvider } from "./contexts/tabs";
import { CommandPaletteProvider } from "./components/command-palette";
import { AppShell } from "./components/app-shell";
import { PRReviewPage } from "./components/pr-review";
import "./index.css";

createRoot(document.getElementById("app")!).render(
  <GitHubProvider>
    <TabProvider>
      <CommandPaletteProvider>
        <BrowserRouter>
          <Routes>
            {/* Main app shell with tabs */}
            <Route path="/" element={<AppShell />} />
            {/* Direct URL access to PR review (opens without tabs) */}
            <Route
              path="/:owner/:repo/pull/:number/files"
              element={<PRReviewPage />}
            />
          </Routes>
        </BrowserRouter>
      </CommandPaletteProvider>
    </TabProvider>
  </GitHubProvider>
);
