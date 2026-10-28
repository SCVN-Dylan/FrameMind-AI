// Turns backend errors into text in the current language. Unknown codes fall back to the server's message.

import type { ApiError } from "./api";
import type { Dictionary } from "./i18n/dictionaries";

export function apiErrorText(t: Dictionary, error: ApiError): string {
  const known = t.apiErrors as Record<string, string>;
  return known[error.code] ?? error.message;
}
