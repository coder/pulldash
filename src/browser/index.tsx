import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Home } from "./components/home";
import { PRReviewPage } from "./components/pr-review";
import { PROverviewPage } from "./components/pr-overview";
import "./index.css";

createRoot(document.getElementById("app")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/:owner/:repo/pull/:number" element={<PROverviewPage />} />
      <Route path="/:owner/:repo/pull/:number/files" element={<PRReviewPage />} />
    </Routes>
  </BrowserRouter>
);
