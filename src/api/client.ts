import { hc } from "hono/client";
import type { AppType } from "./api";

export const createApiClient = (baseUrl: string = window.location.origin) => {
  return hc<AppType>(baseUrl);
};

export type ApiClient = ReturnType<typeof createApiClient>;
