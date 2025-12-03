import { Hono } from "hono";
import api from "./api/api";

const app = new Hono();

// API routes
app.route("/", api);

// Static files and SPA fallback handled by Vercel via public/ directory and rewrites
// This file is the API entry point for Vercel's backend detection

export default app;
