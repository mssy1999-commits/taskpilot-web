/* eslint-disable */
/**
 * Generated `api` utility types. Convex regenerates this file on every deploy.
 */
import type * as agent from "../agent.js";
import type * as cdp from "../cdp.js";
import type * as threads from "../threads.js";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  cdp: typeof cdp;
  threads: typeof threads;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
