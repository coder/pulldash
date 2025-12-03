import { Hono } from "hono";
import api from "./api/api";

const app = new Hono();

// API routes
app.route("/", api);

export default app;

