// FrameMind data kept in this browser (localStorage / sessionStorage). The app uses no IndexedDB and no cookies.

const PREFIX = "framemind";
/** Preferences that survive Clear All Data: the interface language. */
export const KEPT_KEYS: readonly string[] = ["framemind-language"];

function frameMindKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(PREFIX) && !KEPT_KEYS.includes(key)) keys.push(key);
  }
  return keys;
}

/** Removes FrameMind keys only (never other sites' or apps' data on this origin). Returns how many were removed. */
export function clearBrowserData(): number {
  let removed = 0;
  for (const getStorage of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const storage = getStorage();
      for (const key of frameMindKeys(storage)) {
        storage.removeItem(key);
        removed++;
      }
    } catch {
      // Storage blocked (private mode): nothing stored there to clear.
    }
  }
  return removed;
}
