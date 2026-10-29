// Clear All Data: backend first, then this browser. Success is reported only after the backend verified the deletion.

import { ApiError, clearAllData, listSessions, type ApiDataReset } from "./api";
import { clearBrowserData } from "./browser-data";

export type ClearOutcome =
  /** Backend and browser data deleted, and the backend lists no sessions any more. */
  | { kind: "success"; result: ApiDataReset }
  /** Backend unreachable: only browser data was cleared. */
  | { kind: "offline" }
  /** The backend answered but data is still there. Browser data is left as it was. */
  | { kind: "unverified" }
  /** The backend refused or failed (nothing reported as deleted). Browser data is left as it was. */
  | { kind: "error"; error: ApiError };

export async function clearEverything(): Promise<ClearOutcome> {
  let result: ApiDataReset;
  try {
    result = await clearAllData();
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(0, "unknown", String(error));
    if (apiError.isNetwork) {
      clearBrowserData();
      return { kind: "offline" };
    }
    return { kind: "error", error: apiError };
  }
  try {
    if (!result.verified || (await listSessions()).length > 0) return { kind: "unverified" };
  } catch {
    return { kind: "unverified" };
  }
  clearBrowserData();
  return { kind: "success", result };
}
