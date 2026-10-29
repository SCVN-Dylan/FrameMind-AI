// A one-shot notice carried across a client-side navigation (e.g. Settings → Dashboard after Clear All Data).

export type Flash = { tone: "ok" | "warn"; text: string };

let pending: Flash | null = null;

export function setFlash(flash: Flash) {
  pending = flash;
}

export function peekFlash(): Flash | null {
  return pending;
}

export function clearFlash() {
  pending = null;
}
