"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import {
  ApiError,
  cancelCodexLogin,
  getCodexLogin,
  getProviderStatus,
  listCodexModels,
  logoutCodex,
  selectCodexModel,
  startCodexLogin,
  type ApiLoginFlow,
  type ApiModels,
  type ApiProviderStatus,
} from "@/lib/api";
import { apiErrorText } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n/I18nProvider";

type ProviderState = { status: ApiProviderStatus | null; error: ApiError | null; loading: boolean };

/** Codex CLI status from the backend (install, version, sign-in, verified options). Never includes credentials. */
export function useProviderStatus() {
  const [state, setState] = useState<ProviderState>({ status: null, error: null, loading: true });

  const fetchStatus = useCallback((refresh: boolean, signal?: AbortSignal) => {
    getProviderStatus(refresh, signal)
      .then((status) => setState({ status, error: null, loading: false }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: null, error: error instanceof ApiError ? error : new ApiError(0, "unknown", String(error)), loading: false });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(false, controller.signal);
    return () => controller.abort();
  }, [fetchStatus]);

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    fetchStatus(true);
  }, [fetchStatus]);

  return { ...state, refresh };
}

export type ProviderStatusApi = ReturnType<typeof useProviderStatus>;

/** One line under the Analyze button. */
export function ProviderStatusLine({ provider }: { provider: ProviderStatusApi }) {
  const { t } = useI18n();
  const ai = t.ai;
  const { status, loading } = provider;

  if (loading && !status) {
    return <p className="text-center text-xs text-muted">{ai.providerChecking}</p>;
  }
  if (status?.available) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {ai.providerReady(status.version ?? "?")} · {status.model ?? ai.defaultModel}
      </p>
    );
  }
  return (
    <p role="alert" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-amber-200">
      <Icon name="alert" size={13} />
      {status ? `${ai.providerUnavailable} ${status.last_error ?? ""}` : ai.providerUnknown}
      <button type="button" onClick={provider.refresh} className="font-medium text-amber-100 underline-offset-2 hover:underline">
        {ai.recheck}
      </button>
    </p>
  );
}

/**
 * Settings → AI provider → Codex CLI: connection, account type, model, and the official sign-in / logout flows.
 * Sign-in runs `codex login` on this computer: OpenAI's page opens in the browser and FrameMind only waits for the
 * CLI to report success. Passwords and tokens never pass through FrameMind.
 */
export function ProviderStatusDetails() {
  const { t } = useI18n();
  const ai = t.ai;
  const provider = useProviderStatus();
  const { status, refresh: refreshProvider } = provider;
  const [models, setModels] = useState<ApiModels | null>(null);
  const [login, setLogin] = useState<ApiLoginFlow | null>(null);
  const [busy, setBusy] = useState<"login" | "logout" | "model" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const connected = status?.authenticated === true;
  const loginRunning = login?.state === "running";

  const loadModels = useCallback((refresh: boolean) => {
    listCodexModels(refresh)
      .then(setModels)
      .catch(() => setModels(null));
  }, []);

  // Models depend on the signed-in account: reload when the connection changes.
  useEffect(() => {
    if (connected) loadModels(false);
  }, [connected, loadModels]);

  // Follow a sign-in flow until the CLI reports the result.
  useEffect(() => {
    if (!loginRunning) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await getCodexLogin();
        if (cancelled || next.state === "running") {
          if (!cancelled) setLogin(next);
          return;
        }
        setLogin(next);
        refreshProvider();
        if (next.state === "succeeded") {
          setNotice({ tone: "ok", text: ai.loginSucceeded });
          loadModels(true);
        } else if (next.state === "failed") {
          setNotice({ tone: "error", text: `${ai.loginFailed} ${next.error ?? ""}` });
        }
      } catch {
        // Backend restarting: keep polling.
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loginRunning, refreshProvider, ai, loadModels]);

  const showError = (error: unknown) =>
    setNotice({ tone: "error", text: error instanceof ApiError ? apiErrorText(t, error) : String(error) });

  async function startLogin() {
    setBusy("login");
    setNotice(null);
    try {
      setLogin(await startCodexLogin());
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function cancelLogin() {
    try {
      setLogin(await cancelCodexLogin());
      setNotice({ tone: "ok", text: ai.loginCancelled });
    } catch (error) {
      showError(error);
    }
  }

  async function logout() {
    if (!window.confirm(ai.logoutConfirm)) return;
    setBusy("logout");
    setNotice(null);
    try {
      await logoutCodex();
      setModels(null);
      setLogin(null);
      setNotice({ tone: "ok", text: ai.logoutDone });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
      provider.refresh();
    }
  }

  async function chooseModel(value: string) {
    setBusy("model");
    setNotice(null);
    try {
      setModels(await selectCodexModel(value || null));
      setNotice({ tone: "ok", text: ai.modelSaved });
      provider.refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  function refreshAll() {
    setNotice(null);
    provider.refresh();
    if (connected) loadModels(true);
  }

  const connection = !status ? ai.unknownConnection : connected ? ai.connected : status.authenticated === false ? ai.notConnected : ai.unknownConnection;
  const selected = models?.selected ?? status?.model ?? "";

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="rounded-xl border border-border/70 bg-background/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon name="sparkles" size={15} className="text-primary-soft" /> {ai.codexTitle}
        </h3>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-xs">
          <dt className="text-muted">{ai.connection}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Badge
              className={
                connected
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  : "border-rose-400/30 bg-rose-400/10 text-rose-200"
              }
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
              {connection}
            </Badge>
            <span className="text-muted">{status?.installed ? ai.installed(status.version ?? "?") : status ? ai.notInstalled : ""}</span>
          </dd>

          <dt className="text-muted">{ai.account}</dt>
          <dd className="text-foreground">
            {connected && status?.auth_mode ? (ai.authModes[status.auth_mode] ?? status.auth_mode) : "—"}
            {connected && <p className="mt-0.5 text-[11px] text-muted">{ai.accountNote}</p>}
          </dd>

          <dt className="text-muted">
            <label htmlFor="codex-model">{ai.model}</label>
          </dt>
          <dd className="flex flex-col gap-1">
            <select
              id="codex-model"
              value={selected}
              disabled={!connected || busy !== null || !models}
              onChange={(event) => void chooseModel(event.target.value)}
              className="h-9 w-full max-w-sm rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-primary-soft focus:outline-none disabled:opacity-50"
            >
              <option value="">{ai.modelDefault}</option>
              {models?.models.map((model) => (
                <option key={model.slug} value={model.slug} disabled={!model.supports_images} title={model.description}>
                  {model.display_name}
                  {model.supports_images ? "" : ` (${ai.noImages})`}
                </option>
              ))}
              {selected && models && !models.models.some((m) => m.slug === selected) && <option value={selected}>{selected}</option>}
            </select>
            <span className="text-[11px] text-muted">{!connected ? ai.modelNeedsLogin : models ? ai.modelSource[models.source] : ai.providerChecking}</span>
            {models?.selected_unavailable && models.selected && (
              <span role="alert" className="text-[11px] text-amber-200">
                {ai.modelUnavailable(models.selected)}
              </span>
            )}
          </dd>
        </dl>

        {loginRunning && (
          <div role="status" className="mt-4 flex flex-col gap-2 rounded-xl border border-primary-soft/30 bg-primary/10 p-3 text-xs">
            <p className="flex items-center gap-2 text-foreground">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />
              {ai.loginWaiting}
            </p>
            {login?.login_url && (
              <p className="text-muted">
                <a href={login.login_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-soft underline-offset-2 hover:underline">
                  {ai.loginOpen}
                </a>{" "}
                · {ai.loginOpenHint}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!connected && status?.installed && !loginRunning && (
            <Button size="sm" variant="primary" onClick={() => void startLogin()} disabled={busy !== null}>
              {busy === "login" ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="link" size={14} />}
              {busy === "login" ? ai.loginStarting : ai.login}
            </Button>
          )}
          {loginRunning && (
            <Button size="sm" variant="secondary" onClick={() => void cancelLogin()}>
              <Icon name="x" size={14} /> {ai.loginCancel}
            </Button>
          )}
          {connected && (
            <Button size="sm" variant="secondary" onClick={() => void logout()} disabled={busy !== null}>
              {busy === "logout" ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" /> : <Icon name="arrowLeft" size={14} />}
              {busy === "logout" ? ai.loggingOut : ai.logout}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={refreshAll} disabled={provider.loading || busy !== null}>
            <Icon name="restart" size={14} /> {ai.refreshConnection}
          </Button>
        </div>

        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"} className={`mt-3 text-xs ${notice.tone === "error" ? "text-rose-200" : "text-emerald-300"}`}>
            {notice.text}
          </p>
        )}
        {status && !status.installed && <p className="mt-3 font-mono text-xs text-amber-200">{ai.installHint}</p>}
        {status && !status.available && status.last_error && !loginRunning && <p className="mt-2 text-xs text-amber-200">{status.last_error}</p>}

        {!connected && (
          <details className="mt-4 text-xs text-muted">
            <summary className="cursor-pointer text-foreground/80">{ai.terminalTitle}</summary>
            <p className="mt-2">{ai.terminalText}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              <li>
                <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-foreground">codex login</code> — {ai.terminalBrowser}
              </li>
              <li>
                <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-foreground">codex login --device-auth</code> — {ai.terminalDevice}
              </li>
            </ul>
          </details>
        )}
      </div>

      {status && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{ai.capabilities}</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(status.capabilities) as (keyof ApiProviderStatus["capabilities"])[]).map((key) => (
              <Badge
                key={key}
                className={
                  status.capabilities[key]
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-rose-400/30 bg-rose-400/10 text-rose-200"
                }
              >
                <Icon name={status.capabilities[key] ? "check" : "x"} size={12} /> {ai.capability[key]}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted">{ai.usageNote}</p>
    </div>
  );
}
