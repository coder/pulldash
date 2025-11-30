import { hc } from "hono/client";
import app from "./api";

export const client = hc<typeof app>(window.location.origin);
