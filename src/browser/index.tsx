import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Home } from "./components/home";
import { PRReviewPage } from "./components/pr-review";
import "./index.css";

createRoot(document.getElementById("app")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/:owner/:repo/pull/:number" element={<PRReviewPage />} />
    </Routes>
  </BrowserRouter>
);
