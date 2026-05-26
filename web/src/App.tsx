import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  CheckCircle2,
  ChevronLeft,
  Copy,
  DoorOpen,
  Link,
  LogOut,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { createContext, FormEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t as i18nT, type Lang, type TranslationKey } from "./i18n";
import type { HubConnection } from "@microsoft/signalr";
import {
  AppSettings,
  AuthSession,
  GroupMessageDto,
  GroupStatusRequestedDto,
  GroupMemberDto,
  MyGroupDto,
  RegistrationPendingResponse,
  StatusChangedDto,
  TelegramAuthData,
  UserDto,
  UserStatus,
  acceptInvite,
  addGroupMember,
  changePassword,
  createGroup,
  createInvite,
  createTelegramLinkCode,
  deleteGroup,
  deleteGroupMessage,
  editGroupMessage,
  disconnectTelegram,
  getAppConfig,
  getCurrentUser,
  getGroupMessages,
  getMyGroups,
  getTelegramLinkStatus,
  loginWithPassword,
  loginWithTelegram,
  logout,
  registerWithPassword,
  resendVerificationEmail,
  refreshSession,
  removeGroupMember,
  requestGroupStatusUpdate,
  resolveInvite,
  sendGroupMessage,
  setPassword,
  toggleReaction,
  updateGroupMemberRole,
  updateLanguage,
  updateNotifications,
  updateProfile,
  updateStatus,
} from "./api";
import { createStatusConnection } from "./signalr";
import { loadSettings } from "./settings";

type Tab = "overview" | "groups" | "settings";

// ── status helpers ────────────────────────────────────────────────
function statusKey(s: UserStatus): "safe" | "shelter" | "help" | "unknown" {
  if (s === "Safe") return "safe";
  if (s === "InShelter") return "shelter";
  if (s === "NeedHelp") return "help";
  return "unknown";
}

function groupCallsign(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return name.substring(0, 6).toUpperCase();
  return words.map((w) => w[0]).join("").substring(0, 7).toUpperCase();
}

function userInitials(userName: string): string {
  const parts = userName.split(/[\s_.\-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return userName.substring(0, 2).toUpperCase();
}

// ── i18n ──────────────────────────────────────────────────────────
const LanguageContext = createContext<Lang>("en");
function useT() {
  const lang = useContext(LanguageContext);
  return (key: TranslationKey) => i18nT(key, lang);
}

function statusLabel(status: UserStatus, lang: Lang): string {
  if (status === "Safe")      return i18nT("status.safe", lang);
  if (status === "InShelter") return i18nT("status.inShelter", lang);
  if (status === "NeedHelp")  return i18nT("status.needHelp", lang);
  return i18nT("status.unknown", lang);
}
function statusShort(status: UserStatus, lang: Lang): string {
  if (status === "Safe")      return i18nT("status.safe.short", lang);
  if (status === "InShelter") return i18nT("status.inShelter.short", lang);
  if (status === "NeedHelp")  return i18nT("status.needHelp.short", lang);
  return i18nT("status.unknown.short", lang);
}

async function forceUpdate() {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  window.location.reload();
}

// ── App ────────────────────────────────────────────────────────────
export default function App() {
  const queryClient = useQueryClient();
  const initialGroupId = useMemo(() => readInitialGroupId(), []);
  const [settings] = useState<AppSettings>(() => loadSettings());
  const [theme, setThemeState] = useState<"dark" | "light">(
    () => (localStorage.getItem("safepulse-theme") as "dark" | "light") ?? "dark",
  );
  const setTheme = (t: "dark" | "light") => {
    localStorage.setItem("safepulse-theme", t);
    setThemeState(t);
  };
  useEffect(() => {
    document.body.classList.toggle("sp-root--light", theme === "light");
  }, [theme]);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (initialGroupId) return "groups";
    return readInitialTab();
  });
  const [requestedGroupId, setRequestedGroupId] = useState<string | null>(initialGroupId);
  const [connectionState, setConnectionState] = useState("Disconnected");
  const [statusRequest, setStatusRequest] = useState<GroupStatusRequestedDto | null>(null);
  const [statusChangedMessage, setStatusChangedMessage] = useState<string | null>(null);
  const [recentStatusChanges, setRecentStatusChanges] = useState<StatusChangedDto[]>([]);
  const [emailVerifiedToast, setEmailVerifiedToast] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [lastChatMessage, setLastChatMessage] = useState<GroupMessageDto | null>(null);
  const statusConnectionRef = useRef<HubConnection | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("emailVerified")) {
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
      setEmailVerifiedToast(true);
    }
  }, []);

  useEffect(() => {
    const hash = tabToHash(activeTab);
    if (window.location.hash !== `#${hash}`) {
      window.history.replaceState({}, "", `#${hash}`);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!emailVerifiedToast) return;
    const t = window.setTimeout(() => setEmailVerifiedToast(false), 5000);
    return () => window.clearTimeout(t);
  }, [emailVerifiedToast]);

  useEffect(() => {
    let cancelled = false;
    refreshSession(settings)
      .then((nextSession) => { if (!cancelled) setSession(nextSession); })
      .catch(() => { if (!cancelled) setSession(null); })
      .finally(() => { if (!cancelled) setAuthChecked(true); });
    return () => { cancelled = true; };
  }, [settings]);

  useEffect(() => {
    if (!session) return;
    const expiresAt = new Date(session.AccessTokenExpiresAt).getTime();
    const delay = expiresAt - Date.now() - 60_000; // refresh 1 min before expiry
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      refreshSession(settings)
        .then((next) => { if (!cancelled) setSession(next); })
        .catch(() => { if (!cancelled) setSession(null); });
    }, Math.max(delay, 0));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session?.AccessTokenExpiresAt, settings]);

  const currentUser = useQuery({
    queryKey: ["current-user", settings, session?.AccessToken],
    queryFn: () => getCurrentUser(settings, session!.AccessToken),
    enabled: Boolean(session),
  });

  const myGroups = useQuery({
    queryKey: ["my-groups", settings, session?.AccessToken],
    queryFn: () => getMyGroups(settings, session!.AccessToken),
    enabled: Boolean(session),
  });

  const statusMutation = useMutation({
    mutationFn: (status: UserStatus) =>
      updateStatus(settings, session!.AccessToken, session!.User.Id, status),
    onSuccess: (user) => {
      setSession((existing) => existing ? { ...existing, User: user } : existing);
      setStatusChangedMessage(`Status changed to ${statusLabel(user.Status, lang)}.`);
      queryClient.setQueryData(["current-user", settings, session?.AccessToken], user);
      queryClient.setQueryData<MyGroupDto[]>(
        ["my-groups", settings, session?.AccessToken],
        (groups) =>
          groups?.map((group) => ({
            ...group,
            Members: group.Members.map((member) =>
              member.Id === user.Id
                ? { ...member, UserName: user.UserName, Status: user.Status,
                    LastActiveAt: user.LastActiveAt, LastSeenOnlineAt: user.LastSeenOnlineAt }
                : member,
            ),
          })),
      );
    },
  });

  useEffect(() => {
    if (!statusChangedMessage) return;
    const timer = window.setTimeout(() => setStatusChangedMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [statusChangedMessage]);

  const appConfigQuery = useQuery({
    queryKey: ["app-config", settings],
    queryFn: () => getAppConfig(settings),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const seenServerStartTime = useRef<number | null>(null);
  useEffect(() => {
    const serverTime = appConfigQuery.data?.ServerStartTime;
    if (!serverTime) return;
    if (seenServerStartTime.current === null) {
      seenServerStartTime.current = serverTime;
      return;
    }
    if (serverTime !== seenServerStartTime.current) {
      void forceUpdate();
    }
  }, [appConfigQuery.data?.ServerStartTime]);

  const passwordLoginMutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      loginWithPassword(settings, payload.email, payload.password),
    onSuccess: (nextSession) => {
      setSession(nextSession);
      void queryClient.invalidateQueries();
    },
  });

  const telegramLoginMutation = useMutation({
    mutationFn: (data: TelegramAuthData) => loginWithTelegram(settings, data),
    onSuccess: (nextSession) => {
      setSession(nextSession);
      void queryClient.invalidateQueries();
    },
  });

  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);

  const registerMutation = useMutation({
    mutationFn: (payload: { email: string; userName: string; password: string }) =>
      registerWithPassword(settings, payload.email, payload.userName, payload.password),
    onSuccess: (result: RegistrationPendingResponse) => {
      setPendingVerificationEmail(result.Email);
    },
  });

  const resendMutation = useMutation({
    mutationFn: (email: string) => resendVerificationEmail(settings, email),
  });


  const logoutMutation = useMutation({
    mutationFn: () => logout(settings),
    onSettled: () => {
      setShowLogoutModal(false);
      setSession(null);
      queryClient.clear();
    },
  });

  const telegramLoginMutationRef = useRef(telegramLoginMutation);
  useEffect(() => { telegramLoginMutationRef.current = telegramLoginMutation; });
  useEffect(() => {
    const tgData = readTelegramAuthFromUrl();
    if (!tgData) return;
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    telegramLoginMutationRef.current.mutate(tgData);
  }, []);

  useEffect(() => {
    if (!session) return;
    let isCancelled = false;
    let reconnectTimer: number | undefined;
    const connection = createStatusConnection(
      settings,
      session.AccessToken,
      (rawMessage) => {
        const message = normalizeStatusChanged(rawMessage);
        if (message.UserId === session.User.Id) {
          queryClient.setQueryData<UserDto>(
            ["current-user", settings, session.AccessToken],
            (existing) => existing
              ? { ...existing, Status: message.Status, LastActiveAt: message.LastActiveAt, LastSeenOnlineAt: message.LastSeenOnlineAt }
              : existing,
          );
        }
        let shouldRefetchGroups = false;
        queryClient.setQueryData<MyGroupDto[]>(
          ["my-groups", settings, session.AccessToken],
          (groups) =>
            groups?.map((group) => {
              if (!message.GroupIds.includes(group.Id)) return group;
              const hasMember = group.Members.some((m) => m.Id === message.UserId);
              if (!hasMember) shouldRefetchGroups = true;
              return {
                ...group,
                Members: group.Members.map((member) =>
                  member.Id === message.UserId
                    ? { ...member, UserName: message.UserName, Status: message.Status,
                        LastActiveAt: message.LastActiveAt, LastSeenOnlineAt: message.LastSeenOnlineAt }
                    : member,
                ),
              };
            }),
        );
        if (shouldRefetchGroups)
          void queryClient.invalidateQueries({ queryKey: ["my-groups"] });
        setRecentStatusChanges((prev) => [message, ...prev].slice(0, 14));
      },
      (rawMessage) => {
        const message = normalizeGroupStatusRequested(rawMessage);
        setStatusRequest(message);
        playStatusRequestSignal();
      },
      (msg) => setLastChatMessage(msg),
      setConnectionState,
      () => {
        if (isCancelled) return;
        reconnectTimer = window.setTimeout(() => { void start(); }, 3000);
      },
    );

    async function start() {
      if (isCancelled || connection.state !== "Disconnected") return;
      try {
        setConnectionState("Connecting");
        await connection.start();
        if (isCancelled) return;
        await connection.invoke("JoinUserGroups");
        setConnectionState("Connected");
      } catch {
        setConnectionState("Disconnected");
        if (!isCancelled)
          reconnectTimer = window.setTimeout(() => { void start(); }, 3000);
      }
    }

    void start();
    statusConnectionRef.current = connection;
    return () => {
      isCancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (statusConnectionRef.current === connection) statusConnectionRef.current = null;
      void connection.stop();
    };
  }, [queryClient, settings, session]);


  if (!authChecked) {
    return (
      <div style={{ minHeight: "100svh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="sp-mono" style={{ fontSize: 12, color: "var(--sp-fg-3)", letterSpacing: "0.1em" }}>
          CHECKING SESSION…
        </span>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginPage
        onLogin={(payload) => passwordLoginMutation.mutate(payload)}
        onRegister={(payload) => registerMutation.mutate(payload)}
        onResendVerification={(email) => resendMutation.mutate(email)}
        loginError={passwordLoginMutation.error?.message}
        registerError={registerMutation.error?.message}
        telegramLoginError={telegramLoginMutation.error?.message}
        resendSent={resendMutation.isSuccess}
        isLoading={passwordLoginMutation.isPending || registerMutation.isPending}
        isTelegramLoading={telegramLoginMutation.isPending}
        pendingVerificationEmail={pendingVerificationEmail}
        onBackToLogin={() => { setPendingVerificationEmail(null); registerMutation.reset(); resendMutation.reset(); }}
        emailVerifiedToast={emailVerifiedToast}
        emailVerifyError={new URLSearchParams(window.location.search).has("emailVerifyError")}
        botUsername={appConfigQuery.data?.TelegramBotUsername}
      />
    );
  }

  const activeStatus = currentUser.data?.Status ?? session.User.Status;
  const lang: Lang = (currentUser.data?.Language ?? session.User.Language ?? "en") as Lang;
  const connClass = connectionState === "Connected" ? "connected"
    : connectionState === "Disconnected" ? "disconnected" : "connecting";
  const connLabel = connectionState === "Connected"    ? i18nT("conn.connected", lang)
    : connectionState === "Reconnecting" ? i18nT("conn.reconnecting", lang)
    : connectionState === "Disconnected" ? i18nT("conn.disconnected", lang)
    : i18nT("conn.connecting", lang);

  return (
    <LanguageContext.Provider value={lang}>
      <DesktopLeftRail activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="sp-main">
        {/* ── Header stack: topbar + mobile tab bar (sticky together) ── */}
        <div className="sp-header-stack">
          <header className="sp-topbar">
            <div className="sp-topbar-brand">
              <span className="sp-topbar-logo">
                <span style={{ width: 8, height: 8, background: "var(--sp-safe)" }} className="sp-pulse" />
              </span>
              <div className="sp-topbar-name">
                <span className="sp-topbar-title">SafePulse</span>
                <span className="sp-topbar-sub">{session.User.UserName}</span>
              </div>
            </div>
            <div className="sp-topbar-actions">
              <span className={`sp-conn-pill sp-conn-pill--${connClass}`}>
                <span className="sp-conn-dot sp-pulse" />
                {connLabel}
              </span>
              <button className="sp-icon-btn" onClick={() => setShowLogoutModal(true)} title="Logout" type="button">
                <LogOut size={15} />
              </button>
            </div>
          </header>
          <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {/* ── Page content ── */}
        <div className="app-content">
          {activeTab === "overview" && (
            <OverviewPage
              groups={myGroups.data ?? []}
              isLoading={myGroups.isLoading}
              onRefresh={() => void myGroups.refetch()}
              activeStatus={activeStatus}
              recentStatusChanges={recentStatusChanges}
              onRequestAllStatus={() => {
                for (const g of myGroups.data ?? [])
                  void requestGroupStatusUpdate(settings, session.AccessToken, g.Id);
              }}
              onGroupClick={(groupId) => {
                setRequestedGroupId(groupId);
                setActiveTab("groups");
              }}
            />
          )}
          {activeTab === "groups" && (
            <GroupsPage
              settings={settings}
              accessToken={session.AccessToken}
              currentUserId={session.User.Id}
              initialSelectedGroupId={initialGroupId}
              openGroupId={requestedGroupId}
              lastChatMessage={lastChatMessage}
              onJoined={async () => {
                if (statusConnectionRef.current?.state === "Connected")
                  await statusConnectionRef.current.invoke("JoinUserGroups");
              }}
            />
          )}
          {activeTab === "settings" && (
            <SettingsPage
              settings={settings}
              accessToken={session.AccessToken}
              currentUser={currentUser.data ?? session.User}
              theme={theme}
              onThemeChange={setTheme}
            />
          )}
        </div>

        {/* ── Floating status cluster ── */}
        <FloatingStatusCluster
          activeStatus={activeStatus}
          isUpdating={statusMutation.isPending}
          onUpdateStatus={(status) => {
            if (status === "NeedHelp" && !window.confirm(i18nT("grp.confirmNeedHelp", lang))) return;
            statusMutation.mutate(status);
          }}
          error={statusMutation.error?.message ?? currentUser.error?.message}
        />

        {/* ── Toasts ── */}
        {statusRequest && (
          <StatusRequestToast request={statusRequest} onDismiss={() => setStatusRequest(null)} />
        )}
        {statusChangedMessage && <StatusChangedToast message={statusChangedMessage} />}
        {emailVerifiedToast && <StatusChangedToast message={i18nT("auth.emailVerified", lang)} />}

        {showLogoutModal && (
          <SpModal title={i18nT("auth.logoutTitle", lang)} onClose={() => setShowLogoutModal(false)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13, color: "var(--sp-fg-2)", margin: 0 }}>
                {i18nT("auth.logoutConfirm", lang)}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="sp-btn-danger"
                  style={{ flex: 1 }}
                  disabled={logoutMutation.isPending}
                  onClick={() => logoutMutation.mutate()}
                  type="button"
                >
                  <LogOut size={13} />{i18nT("auth.logoutConfirmBtn", lang)}
                </button>
                <button
                  className="sp-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setShowLogoutModal(false)}
                  type="button"
                >
                  {i18nT("auth.logoutCancel", lang)}
                </button>
              </div>
            </div>
          </SpModal>
        )}
      </main>
    </LanguageContext.Provider>
  );
}

// ── Telegram Login Button ─────────────────────────────────────────
function TelegramLoginButton({ botUsername }: { botUsername: string }) {
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const authUrl = `${window.location.origin}${window.location.pathname}`;
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    script.async = true;
    widgetRef.current?.appendChild(script);

    // Force the widget iframe to fill our container so it overlays the button
    const observer = new MutationObserver(() => {
      const iframe = widgetRef.current?.querySelector("iframe");
      if (iframe) {
        iframe.style.cssText = "position:absolute;inset:0;width:100%!important;height:100%!important;opacity:0;cursor:pointer;";
        observer.disconnect();
      }
    });
    if (widgetRef.current)
      observer.observe(widgetRef.current, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (widgetRef.current) widgetRef.current.innerHTML = "";
    };
  }, [botUsername]);

  return (
    <div style={{ position: "relative" }}>
      {/* Visible custom button — pointer-events off so clicks reach the iframe above */}
      <button className="sp-btn-secondary" type="button"
        style={{ width: "100%", pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-2.04 9.613c-.154.676-.555.84-1.124.523l-3.1-2.285-1.496 1.44c-.165.165-.304.304-.624.304l.222-3.156 5.74-5.183c.25-.222-.054-.345-.386-.123L7.26 14.4l-3.056-.954c-.664-.208-.677-.664.139-.983l11.933-4.602c.554-.2 1.038.135.286.387z"/>
        </svg>
        LOGIN WITH TELEGRAM
      </button>
      {/* Invisible widget iframe stretched over the button — captures clicks */}
      <div ref={widgetRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />
    </div>
  );
}

function readTelegramAuthFromUrl(): TelegramAuthData | null {
  const p = new URLSearchParams(window.location.search);
  const id = p.get("id");
  const hash = p.get("hash");
  const authDate = p.get("auth_date");
  if (!id || !hash || !authDate) return null;
  return {
    id: Number(id),
    first_name: p.get("first_name") ?? undefined,
    last_name: p.get("last_name") ?? undefined,
    username: p.get("username") ?? undefined,
    photo_url: p.get("photo_url") ?? undefined,
    auth_date: Number(authDate),
    hash,
  };
}

// ── Login page ──────────────────────────────────────────────────────
function LoginPage({
  onLogin,
  onRegister,
  onResendVerification,
  loginError,
  registerError,
  telegramLoginError,
  resendSent,
  isLoading,
  isTelegramLoading,
  pendingVerificationEmail,
  onBackToLogin,
  emailVerifiedToast,
  emailVerifyError,
  botUsername,
}: {
  onLogin: (p: { email: string; password: string }) => void;
  onRegister: (p: { email: string; userName: string; password: string }) => void;
  onResendVerification: (email: string) => void;
  loginError?: string;
  registerError?: string;
  telegramLoginError?: string;
  resendSent: boolean;
  isLoading: boolean;
  isTelegramLoading: boolean;
  pendingVerificationEmail: string | null;
  onBackToLogin: () => void;
  emailVerifiedToast: boolean;
  emailVerifyError: boolean;
  botUsername?: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function switchMode(next: "login" | "register") {
    setMode(next);
    setLocalError(null);
  }

  function submitAuth(event?: FormEvent) {
    event?.preventDefault();
    setLocalError(null);
    if (mode === "login") { onLogin({ email, password }); return; }
    if (password !== confirmPassword) {
      setLocalError("Passwords do not match.");
      return;
    }
    onRegister({ email, userName, password });
  }

  const brand = (
    <div className="sp-login-brand">
      <span className="sp-login-logo sp-brackets">
        <span style={{ width: 18, height: 18, background: "var(--sp-safe)" }} className="sp-pulse" />
      </span>
      <div className="sp-login-title">
        <h1>SafePulse</h1>
        <p>Volunteer · safety · network</p>
      </div>
    </div>
  );

  // "Check your email" screen shown after successful registration
  if (pendingVerificationEmail) {
    return (
      <div className="sp-login-wrap">
        <div className="sp-login-panel">
          {brand}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="sp-info-box">
              <p style={{ fontWeight: 600, marginBottom: 6 }}>{i18nT("auth.checkEmail", "en")}</p>
              <p style={{ opacity: 0.7, fontSize: 13 }}>
                {i18nT("auth.checkEmailDesc", "en").replace("{email}", pendingVerificationEmail)}
              </p>
            </div>
            {resendSent && <div className="sp-success-box">{i18nT("auth.resendSent", "en")}</div>}
            <button className="sp-btn-secondary" type="button"
              onClick={() => onResendVerification(pendingVerificationEmail)} disabled={isLoading}>
              {i18nT("auth.resendEmail", "en")}
            </button>
            <button className="sp-btn-ghost" type="button" onClick={onBackToLogin}>
              {i18nT("auth.backToLogin", "en")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const verifyFailed = loginError?.toLowerCase().includes("verification") || emailVerifyError;

  return (
    <div className="sp-login-wrap">
      <div className="sp-login-panel">
        {brand}

        {emailVerifiedToast && (
          <div className="sp-success-box">{i18nT("auth.emailVerified", "en")}</div>
        )}
        {emailVerifyError && (
          <div className="sp-error-box">! {i18nT("auth.emailVerifyError", "en")}</div>
        )}

        <div className="sp-auth-tabs">
          <button className={`sp-auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => switchMode("login")} type="button">Login</button>
          <button className={`sp-auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => switchMode("register")} type="button">Register</button>
        </div>

        <form style={{ display: "flex", flexDirection: "column", gap: 14 }} onSubmit={submitAuth}>
          <SpField label="EMAIL" type="email" placeholder="you@org.org" value={email}
            onChange={setEmail} icon={<MailIcon />} />
          {mode === "register" && (
            <SpField label="DISPLAY NAME" placeholder="How others see you" value={userName}
              onChange={setUserName} icon={<UserIcon />} sans />
          )}
          <SpField label="PASSWORD" type="password" placeholder="••••••••" value={password}
            onChange={setPassword} icon={<LockIcon />}
            onKeyDown={(e) => { if (e.key === "Enter") submitAuth(); }} />
          {mode === "register" && (
            <SpField label="CONFIRM PASSWORD" type="password" placeholder="••••••••" value={confirmPassword}
              onChange={setConfirmPassword} icon={<LockIcon />}
              onKeyDown={(e) => { if (e.key === "Enter") submitAuth(); }} />
          )}

          <button className="sp-btn-primary" disabled={isLoading} type="submit">
            {isLoading ? "PLEASE WAIT…" : mode === "login" ? "LOGIN" : "CREATE ACCOUNT"}
            <ChevronRight size={14} />
          </button>
        </form>

        {(localError || (mode === "login" ? loginError : registerError)) && !verifyFailed && (
          <div className="sp-error-box">! {localError ?? (mode === "login" ? loginError : registerError)}</div>
        )}

        {verifyFailed && mode === "login" && (
          <div className="sp-error-box" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span>! {i18nT("auth.verificationRequired", "en")}</span>
            <button className="sp-btn-ghost" type="button" style={{ fontSize: 11 }}
              onClick={() => { if (email) onResendVerification(email); }}>
              {i18nT("auth.resendEmail", "en")}
            </button>
            {resendSent && <span style={{ color: "var(--sp-safe)", fontSize: 11 }}>{i18nT("auth.resendSent", "en")}</span>}
          </div>
        )}

        {botUsername && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
              <div style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
              <span className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.08em" }}>
                {i18nT("auth.orDivider", "en")}
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
            </div>
            {telegramLoginError && (
              <div className="sp-error-box">! {telegramLoginError}</div>
            )}
            {isTelegramLoading ? (
              <div className="sp-mono" style={{ textAlign: "center", fontSize: 11, color: "var(--sp-fg-3)" }}>
                PLEASE WAIT…
              </div>
            ) : (
              <TelegramLoginButton botUsername={botUsername} />
            )}
          </>
        )}


      </div>
    </div>
  );
}

// ── Floating status cluster ────────────────────────────────────────
function FloatingStatusCluster({
  activeStatus,
  isUpdating,
  onUpdateStatus,
  error,
}: {
  activeStatus: UserStatus;
  isUpdating: boolean;
  onUpdateStatus: (s: UserStatus) => void;
  error?: string;
}) {
  return (
    <div className="sp-cluster-wrapper">
      {error && (
        <div className="sp-cluster-meta">
          <span className="sp-cluster-error sp-mono">{error}</span>
        </div>
      )}
      <div className={`sp-cluster${activeStatus === "Unknown" ? " sp-cluster--unknown" : ""}`}>
        <ClusterBtn status="Safe" active={activeStatus === "Safe"} disabled={isUpdating}
          onClick={() => onUpdateStatus("Safe")} />
        <span className="sp-cluster-divider" />
        <ClusterBtn status="InShelter" active={activeStatus === "InShelter"} disabled={isUpdating}
          onClick={() => onUpdateStatus("InShelter")} />
        <span className="sp-cluster-divider" />
        <ClusterBtn status="NeedHelp" active={activeStatus === "NeedHelp"} disabled={isUpdating}
          onClick={() => onUpdateStatus("NeedHelp")} sos />
      </div>
    </div>
  );
}

function ClusterBtn({
  status,
  active,
  disabled,
  onClick,
  sos,
}: {
  status: UserStatus;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  sos?: boolean;
}) {
  const key = statusKey(status);
  const Icon = status === "Safe" ? ShieldCheck : status === "InShelter" ? DoorOpen : ShieldAlert;
  const lang = useContext(LanguageContext);

  return (
    <button
      className={`sp-cluster-btn sp-cluster-btn--${key} ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
      title={statusLabel(status, lang)}
    >
      <span className={`sp-cluster-btn-icon${sos ? " sp-cluster-btn-icon--sos" : ""}`}>
        <Icon size={16} strokeWidth={1.6} />
      </span>
      <span className="sp-cluster-btn-label">{statusShort(status, lang)}</span>
      {active && <span className="sp-cluster-active-dot" />}
    </button>
  );
}

// ── Mobile tab bar ─────────────────────────────────────────────────
function MobileTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  const lang = useContext(LanguageContext);
  return (
    <nav className="sp-mobile-tabbar">
      <button className={`sp-mobile-tab ${activeTab === "overview" ? "active" : ""}`}
        onClick={() => onTabChange("overview")} type="button">
        <Activity size={14} strokeWidth={1.6} />
        <span className="sp-mobile-tab-label">{i18nT("nav.ops", lang)}</span>
      </button>
      <button className={`sp-mobile-tab ${activeTab === "groups" ? "active" : ""}`}
        onClick={() => onTabChange("groups")} type="button">
        <Users size={14} strokeWidth={1.6} />
        <span className="sp-mobile-tab-label">{i18nT("nav.groups", lang)}</span>
      </button>
      <button className={`sp-mobile-tab ${activeTab === "settings" ? "active" : ""}`}
        onClick={() => onTabChange("settings")} type="button">
        <Settings size={14} strokeWidth={1.6} />
        <span className="sp-mobile-tab-label">{i18nT("nav.settings", lang)}</span>
      </button>
    </nav>
  );
}

// ── Desktop left rail ──────────────────────────────────────────────
function DesktopLeftRail({
  activeTab,
  onTabChange,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  const lang = useContext(LanguageContext);
  const tabs = [
    { id: "overview" as Tab, icon: <Activity size={18} strokeWidth={1.6} />, label: i18nT("nav.ops", lang) },
    { id: "groups"   as Tab, icon: <Users    size={18} strokeWidth={1.6} />, label: i18nT("nav.groups", lang) },
    { id: "settings" as Tab, icon: <Settings size={18} strokeWidth={1.6} />, label: i18nT("nav.settings", lang) },
  ];
  return (
    <aside className="sp-desktop-rail">
      <div className="sp-desktop-rail-logo">
        <span className="sp-pulse" style={{ width: 10, height: 10, background: "var(--sp-safe)", display: "block" }} />
      </div>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`sp-desktop-rail-item ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onTabChange(tab.id)}
          type="button"
          title={tab.label}
        >
          {tab.icon}
          <span className="sp-desktop-rail-label">{tab.label}</span>
        </button>
      ))}
    </aside>
  );
}

// ── Overview page ──────────────────────────────────────────────────
function OverviewPage({
  groups,
  isLoading,
  onRefresh,
  activeStatus,
  recentStatusChanges,
  onRequestAllStatus,
  onGroupClick,
}: {
  groups: MyGroupDto[];
  isLoading: boolean;
  onRefresh: () => void;
  activeStatus: UserStatus;
  recentStatusChanges: StatusChangedDto[];
  onRequestAllStatus: () => void;
  onGroupClick: (groupId: string) => void;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const totals = { Unknown: 0, Safe: 0, NeedHelp: 0, InShelter: 0 } as Record<UserStatus, number>;
  const seen = new Set<string>();
  for (const group of groups) {
    for (const member of group.Members) {
      if (seen.has(member.Id)) continue;
      seen.add(member.Id);
      totals[member.Status] = (totals[member.Status] ?? 0) + 1;
    }
  }
  const total = seen.size;

  const sKey = statusKey(activeStatus);
  const StatusIcon = activeStatus === "Safe" ? ShieldCheck : activeStatus === "InShelter" ? DoorOpen : ShieldAlert;

  const lastReportBlock = (
    <div className={`sp-last-report sp-last-report--${sKey}`}>
      <span className="sp-last-report-icon">
        <StatusIcon size={18} strokeWidth={1.6} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sp-last-report-label">{statusLabel(activeStatus, lang)}</div>
        <div className="sp-last-report-sub">
          {t("ops.broadcastTo")} {groups.length} {groups.length !== 1 ? t("ops.broadcastGroups") : t("ops.broadcastGroup")}
        </div>
      </div>
    </div>
  );

  return (
    <div className="sp-ops-layout">
      {/* ── Left: main content ─────────────────────────────── */}
      <div className="sp-ops-main sp-page">
        {/* Mobile-only: last report at top */}
        <div className="sp-mobile-only">
          <div className="sp-section">
            <div className="sp-section-head">
              <span className="sp-section-head-label">
                <span className="sp-section-head-code">01</span>{t("ops.lastReport")}
              </span>
              <span className="sp-mono sp-up" style={{ fontSize: 9, color: "var(--sp-fg-3)", letterSpacing: "0.1em" }}>{t("ops.useCluster")}</span>
            </div>
            {lastReportBlock}
          </div>
        </div>

        {/* Aggregates */}
        <div className="sp-section" style={{ marginTop: 6 }}>
          <div className="sp-section-head">
            <span className="sp-section-head-label">
              <span className="sp-section-head-code">02</span>{t("ops.networkStatus")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)", fontVariantNumeric: "tabular-nums" }}>
                {total} {t("ops.people")} · {groups.length} {t("ops.groups")}
              </span>
              <button onClick={onRefresh} type="button"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--sp-fg-3)", display: "flex" }}>
                <RefreshCw size={13} />
              </button>
            </div>
          </div>
          {isLoading && (
            <p className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)", marginTop: 10 }}>{t("ops.loading")}</p>
          )}
          {!isLoading && (
            <div className="sp-stat-grid">
              <StatTile status="NeedHelp"  value={totals.NeedHelp}  total={total} label={t("grp.help")} />
              <StatTile status="Unknown"   value={totals.Unknown}   total={total} label={t("grp.unknown")} />
              <StatTile status="InShelter" value={totals.InShelter} total={total} label={t("grp.shelter")} />
              <StatTile status="Safe"      value={totals.Safe}      total={total} label={t("grp.safe")} />
            </div>
          )}
        </div>

        {/* Groups summary */}
        {!isLoading && groups.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="sp-section">
              <div className="sp-section-head">
                <span className="sp-section-head-label">
                  <span className="sp-section-head-code">03</span>{t("ops.myGroups")} · {groups.length} {t("ops.active")}
                </span>
              </div>
            </div>
            <div className="sp-group-list" style={{ marginTop: 10 }}>
              {groups.map((g) => <OverviewGroupRow key={g.Id} group={g} onClick={() => onGroupClick(g.Id)} />)}
            </div>
          </div>
        )}
        {!isLoading && groups.length === 0 && (
          <div className="sp-section" style={{ marginTop: 6 }}>
            <p className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)" }}>
              {t("ops.noGroups")}
            </p>
          </div>
        )}
      </div>

      {/* ── Right rail (desktop only) ──────────────────────── */}
      <div className="sp-ops-rail">
        {/* YOUR LAST REPORT */}
        <div>
          <div className="sp-section-head" style={{ marginBottom: 10 }}>
            <span className="sp-section-head-label">{t("ops.lastReport")}</span>
            <span className="sp-mono sp-up" style={{ fontSize: 9, color: "var(--sp-fg-3)", letterSpacing: "0.1em" }}>{t("ops.useCluster")}</span>
          </div>
          {lastReportBlock}
        </div>

        {/* Network summary KV */}
        <div className="sp-group-kv-block">
          <div className="sp-group-kv">
            <span className="sp-group-kv-k">{t("ops.visibleTo")}</span>
            <span className="sp-group-kv-v">{groups.length} {t("ops.groups.unit")}</span>
          </div>
          <div className="sp-group-kv">
            <span className="sp-group-kv-k">{t("ops.network")}</span>
            <span className="sp-group-kv-v">{total} {t("ops.people.unit")}</span>
          </div>
        </div>

        {/* Request all status */}
        <button
          className="sp-btn-action"
          style={{ border: "1px solid var(--sp-shelter-dim)", background: "var(--sp-shelter-bg)", color: "var(--sp-shelter)", flex: "none" }}
          onClick={onRequestAllStatus}
          disabled={groups.length === 0}
          type="button"
        >
          <Bell size={13} /> {t("ops.requestAll")}
        </button>

        {/* Live feed */}
        <div>
          <div className="sp-section-head" style={{ marginBottom: 12 }}>
            <span className="sp-section-head-label">{t("ops.liveFeed")}</span>
            {recentStatusChanges.length > 0 && (
              <span className="sp-mono sp-up" style={{ fontSize: 9, color: "var(--sp-fg-4)", letterSpacing: "0.08em" }}>{t("ops.stream")}</span>
            )}
          </div>
          {recentStatusChanges.length === 0 ? (
            <p className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-4)" }}>{t("ops.waiting")}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {recentStatusChanges.map((e, i) => {
                const ek = statusKey(e.Status);
                return (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span className="sp-mono sp-tab" style={{ fontSize: 10, color: "var(--sp-fg-4)", paddingTop: 2, flexShrink: 0 }}>
                      {new Date(e.LastActiveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </span>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--sp-${ek})`, marginTop: 5, flexShrink: 0 }} />
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: "var(--sp-fg)" }}>
                        {e.UserName || e.UserId} →{" "}
                        <span style={{ color: `var(--sp-${ek})`, fontWeight: 600 }}>{statusShort(e.Status, lang)}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ status, value, total, label }: { status: UserStatus; value: number; total: number; label: string }) {
  const key = statusKey(status);
  const colorVar = `var(--sp-${key})`;
  const isHelp = status === "NeedHelp";

  return (
    <div className={`sp-stat-tile ${isHelp ? "sp-stat-tile--help" : ""}`}>
      <div className="sp-stat-tile-head">
        <span className={`sp-stat-tile-dot ${isHelp ? "sp-pulse" : ""}`}
          style={{ background: colorVar }} />
        <span className="sp-stat-tile-label sp-mono sp-up" style={{ color: colorVar }}>
          {label}
        </span>
      </div>
      <div className="sp-stat-tile-value sp-mono sp-tab"
        style={{ color: status === "Unknown" ? "var(--sp-fg-2)" : colorVar }}>
        <AnimatedCounter value={value} />
      </div>
      <div className="sp-stat-tile-total sp-mono">/ {String(total).padStart(2, "0")}</div>
    </div>
  );
}

function OverviewGroupRow({ group, onClick }: { group: MyGroupDto; onClick: () => void }) {
  const t = useT();
  const bd = { Safe: 0, InShelter: 0, NeedHelp: 0, Unknown: 0 } as Record<UserStatus, number>;
  for (const m of group.Members) bd[m.Status] = (bd[m.Status] ?? 0) + 1;
  const total = group.Members.length;
  const urgent = bd.NeedHelp > 0;

  return (
    <div className={`sp-group-row ${urgent ? "sp-group-row--urgent" : ""}`}
      onClick={onClick} style={{ cursor: "pointer" }}>
      <div className="sp-group-row-top">
        <div className="sp-group-row-info">
          <span className="sp-callsign" style={urgent ? { borderColor: "var(--sp-help)", color: "var(--sp-help)" } : {}}>
            {groupCallsign(group.Name)}
          </span>
          <span className="sp-group-row-name">{group.Name}</span>
        </div>
        <div className="sp-group-row-meta">
          <span className="sp-group-row-count">{total} {t("ops.ppl")}</span>
        </div>
      </div>
      <div className="sp-group-row-breakdown">
        <div className="sp-status-bar" style={{ flex: 1 }}>
          {bd.NeedHelp  > 0 && <div className="sp-status-bar-seg sp-status-bar-seg--help"    style={{ flex: bd.NeedHelp }} />}
          {bd.Unknown   > 0 && <div className="sp-status-bar-seg sp-status-bar-seg--unknown"  style={{ flex: bd.Unknown }} />}
          {bd.InShelter > 0 && <div className="sp-status-bar-seg sp-status-bar-seg--shelter"  style={{ flex: bd.InShelter }} />}
          {bd.Safe      > 0 && <div className="sp-status-bar-seg sp-status-bar-seg--safe"     style={{ flex: bd.Safe }} />}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {bd.NeedHelp  > 0 && <span className="sp-group-row-stat sp-group-row-stat--help">{bd.NeedHelp} {t("ops.help")}</span>}
          {bd.Unknown   > 0 && <span className="sp-group-row-stat sp-group-row-stat--unknown">{bd.Unknown} {t("ops.unk")}</span>}
        </div>
      </div>
    </div>
  );
}

function AnimatedCounter({ value }: { value: number }) {
  const digits = value.toString().split("");
  return (
    <span style={{ display: "inline-flex", fontVariantNumeric: "tabular-nums" }} aria-label={value.toString()}>
      {digits.map((digit, index) => (
        <span key={`${index}-${digits.length}`}
          style={{ display: "inline-block", height: "1em", overflow: "hidden", position: "relative", width: "0.62em" }}>
          <span
            aria-hidden="true"
            key={`${index}-${digit}-${value}`}
            style={{
              display: "inline-block",
              animation: "counter-digit-drop 240ms cubic-bezier(0.2,0.8,0.2,1) both",
              animationDelay: `${index * 35}ms`,
              willChange: "transform, opacity",
            }}
          >{digit}</span>
        </span>
      ))}
    </span>
  );
}

// ── Groups page ────────────────────────────────────────────────────
function GroupsPage({
  settings,
  accessToken,
  currentUserId,
  initialSelectedGroupId,
  openGroupId,
  lastChatMessage,
  onJoined,
}: {
  settings: AppSettings;
  accessToken: string;
  currentUserId: string;
  initialSelectedGroupId: string | null;
  openGroupId: string | null;
  lastChatMessage: GroupMessageDto | null;
  onJoined: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const t = useT();
  const [groupName, setGroupName] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialSelectedGroupId);
  const [rightRailOpen, setRightRailOpen] = useState(false);

  useEffect(() => {
    if (openGroupId) setSelectedGroupId(openGroupId);
  }, [openGroupId]);
  const [latestInvite, setLatestInvite] = useState<{ apiUrl: string; telegramUrl: string } | null>(null);
  const [latestStatusRequest, setLatestStatusRequest] = useState<string | null>(null);
  const [requestCreatedMessage, setRequestCreatedMessage] = useState<string | null>(null);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setJoinModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MyGroupDto | null>(null);

  const groups = useQuery({
    queryKey: ["my-groups", settings, accessToken],
    queryFn: () => getMyGroups(settings, accessToken),
  });

  useEffect(() => {
    if (initialSelectedGroupId) setSelectedGroupId(initialSelectedGroupId);
  }, [initialSelectedGroupId]);

  const selectedGroup = useMemo(
    () => groups.data?.find((g) => g.Id === selectedGroupId) ?? groups.data?.[0],
    [groups.data, selectedGroupId],
  );

  const createGroupMutation = useMutation({
    mutationFn: () => createGroup(settings, accessToken, groupName),
    onSuccess: async (group) => {
      setGroupName("");
      setCreateModalOpen(false);
      setSelectedGroupId(group.Id);
      await queryClient.invalidateQueries({ queryKey: ["my-groups"] });
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: () => createInvite(settings, accessToken, selectedGroup!.Id, ""),
    onSuccess: (invite) => {
      setLatestInvite({ apiUrl: invite.ApiUrl, telegramUrl: invite.TelegramUrl });
    },
  });

  const requestStatusMutation = useMutation({
    mutationFn: () => requestGroupStatusUpdate(settings, accessToken, selectedGroup!.Id),
    onSuccess: (request) => {
      setLatestStatusRequest(`${request.RequestedByUserName} requested status updates at ${formatDateTime(request.CreatedAt)}`);
      setRequestCreatedMessage(`Status update requested for ${request.GroupName}.`);
    },
  });

  useEffect(() => {
    if (!requestCreatedMessage) return;
    const timer = window.setTimeout(() => setRequestCreatedMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [requestCreatedMessage]);

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeGroupMember(settings, accessToken, selectedGroup!.Id, userId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["my-groups"] }); },
  });

  const updateRoleMutation = useMutation({
    mutationFn: (payload: { userId: string; role: "Member" | "Admin" }) =>
      updateGroupMemberRole(settings, accessToken, selectedGroup!.Id, payload.userId, payload.role),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["my-groups"] }); },
  });

  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => addGroupMember(settings, accessToken, selectedGroup!.Id, userId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["my-groups"] }); },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: string) => deleteGroup(settings, accessToken, groupId),
    onSuccess: async (_, groupId) => {
      setDeleteTarget(null);
      setSelectedGroupId((current) => current === groupId ? null : current);
      await queryClient.invalidateQueries({ queryKey: ["my-groups"] });
    },
  });

  function submitGroup(event: FormEvent) {
    event.preventDefault();
    if (groupName.trim()) createGroupMutation.mutate();
  }

  return (
    <div className={`sp-groups-layout${rightRailOpen ? " sp-groups-layout--rail-open" : ""}`}>
      {/* ── Left rail: group list ──────────────────────────────────── */}
      <div className="sp-groups-rail">
        {/* Rail header */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--sp-border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--sp-surface)", flex: "0 0 auto" }}>
          <span className="sp-mono sp-up" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.12em" }}>
            {groups.data?.length ?? 0} GROUPS
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="sp-btn-icon" onClick={() => setCreateModalOpen(true)} title="Create group" type="button">
              <Plus size={14} />
            </button>
            <button className="sp-btn-icon" onClick={() => setJoinModalOpen(true)} title="Join with invite" type="button">
              <Link size={14} />
            </button>
          </div>
        </div>
        {/* Search bar */}
        <div className="sp-groups-rail-search">
          <input
            className="sp-text-input"
            style={{ flex: 1, height: 28, fontSize: 12, padding: "0 8px" }}
            placeholder={t("grp.searchGroups")}
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
          />
          {groupSearch && (
            <button className="sp-btn-icon" style={{ padding: 4 }} onClick={() => setGroupSearch("")} type="button">
              <X size={12} />
            </button>
          )}
        </div>
        {createGroupMutation.error && (
          <div className="sp-error-box" style={{ margin: "8px" }}>{createGroupMutation.error.message}</div>
        )}
        {/* Group rows */}
        <div>
          {(groups.data ?? []).filter((g) => !groupSearch.trim() || g.Name.toLowerCase().includes(groupSearch.toLowerCase())).map((group) => {
            const bd = { Safe: 0, InShelter: 0, NeedHelp: 0, Unknown: 0 } as Record<UserStatus, number>;
            for (const m of group.Members) bd[m.Status] = (bd[m.Status] ?? 0) + 1;
            const urgent = bd.NeedHelp > 0;
            const isSelected = group.Id === selectedGroup?.Id;
            return (
              <div
                key={group.Id}
                className={`sp-groups-rail-row ${isSelected ? "sp-groups-rail-row--selected" : ""} ${urgent ? "sp-groups-rail-row--urgent" : ""}`}
                onClick={() => setSelectedGroupId(group.Id)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="sp-callsign" style={urgent ? { borderColor: "var(--sp-help)", color: "var(--sp-help)" } : {}}>
                    {groupCallsign(group.Name)}
                  </span>
                  <span className="sp-mono sp-tab" style={{ fontSize: 10, color: "var(--sp-fg-3)" }}>{group.Members.length}</span>
                </div>
                <span className="sp-group-name" style={{ fontSize: 13 }}>{group.Name}</span>
                <div style={{ display: "flex", height: 3, background: "var(--sp-bg)", marginTop: 2 }}>
                  {bd.NeedHelp  > 0 && <div style={{ flex: bd.NeedHelp,  background: "var(--sp-help)" }} />}
                  {bd.Unknown   > 0 && <div style={{ flex: bd.Unknown,   background: "var(--sp-unknown)", opacity: 0.7 }} />}
                  {bd.InShelter > 0 && <div style={{ flex: bd.InShelter, background: "var(--sp-shelter)" }} />}
                  {bd.Safe      > 0 && <div style={{ flex: bd.Safe,      background: "var(--sp-safe)" }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Center: selected group ─────────────────────────────────── */}
      <div className="sp-groups-center">
        {selectedGroup ? (
          <GroupDetails
            group={selectedGroup}
            canManage={selectedGroup.OwnerId === currentUserId}
            latestInvite={latestInvite}
            latestStatusRequest={latestStatusRequest}
            members={selectedGroup.Members}
            onCreateInvite={() => createInviteMutation.mutate()}
            isCreatingInvite={createInviteMutation.isPending}
            onRequestStatus={() => requestStatusMutation.mutate()}
            requestStatusError={requestStatusMutation.error?.message}
            isRequestingStatus={requestStatusMutation.isPending}
            onRemoveMember={(userId) => removeMemberMutation.mutate(userId)}
            onUpdateRole={(userId, role) => updateRoleMutation.mutate({ userId, role })}
            onAddMember={(userId) => addMemberMutation.mutate(userId)}
            onDeleteGroup={selectedGroup.OwnerId === currentUserId ? () => setDeleteTarget(selectedGroup) : undefined}
            memberActionError={addMemberMutation.error?.message ?? removeMemberMutation.error?.message ?? updateRoleMutation.error?.message}
            settings={settings}
            accessToken={accessToken}
            currentUserId={currentUserId}
            lastChatMessage={lastChatMessage}
          />
        ) : (
          <div style={{ padding: "20px 24px" }}>
            <p className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)" }}>Select a group to view its members.</p>
          </div>
        )}
      </div>

      {/* ── Right rail (desktop only) ──────────────────────────────── */}
      <div className="sp-groups-right-rail">
        <button
          className="sp-right-rail-toggle"
          onClick={() => setRightRailOpen((v) => !v)}
          title={rightRailOpen ? "Collapse panel" : "Expand panel"}
          type="button"
        >
          {rightRailOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        {rightRailOpen && selectedGroup && (
          <div className="sp-right-rail-content">
            <GroupRightRail
              group={selectedGroup}
              canManage={selectedGroup.OwnerId === currentUserId}
              members={selectedGroup.Members}
              latestInvite={latestInvite}
              isCreatingInvite={createInviteMutation.isPending}
              createInviteError={createInviteMutation.error?.message}
              onCreateInvite={() => createInviteMutation.mutate()}
              onAddMember={(userId) => addMemberMutation.mutate(userId)}
              onDeleteGroup={selectedGroup.OwnerId === currentUserId ? () => setDeleteTarget(selectedGroup) : undefined}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {isCreateModalOpen && (
        <SpModal title="CREATE GROUP" onClose={() => setCreateModalOpen(false)}>
          <form style={{ display: "flex", flexDirection: "column", gap: 14 }} onSubmit={submitGroup}>
            <SpField label="GROUP NAME" placeholder="New group name" value={groupName} onChange={setGroupName} />
            <button className="sp-btn-primary" disabled={createGroupMutation.isPending} type="submit">
              CREATE GROUP
            </button>
          </form>
        </SpModal>
      )}
      {isJoinModalOpen && (
        <SpModal title="JOIN GROUP" onClose={() => setJoinModalOpen(false)}>
          <JoinGroupForm
            settings={settings}
            accessToken={accessToken}
            onJoined={async () => {
              await onJoined();
              await queryClient.invalidateQueries({ queryKey: ["my-groups"] });
            }}
          />
        </SpModal>
      )}
      {deleteTarget && (
        <DeleteGroupModal
          group={deleteTarget}
          error={deleteGroupMutation.error?.message}
          isDeleting={deleteGroupMutation.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteGroupMutation.mutate(deleteTarget.Id)}
        />
      )}
      {requestCreatedMessage && <StatusChangedToast message={requestCreatedMessage} />}
    </div>
  );
}

// ── Chat components ────────────────────────────────────────────────
const REACTION_EMOJIS = ["👍", "❤️", "✅", "🙏", "💪"];

function SystemMessage({ msg }: { msg: GroupMessageDto }) {
  const lang = useContext(LanguageContext);

  const ts = new Date(msg.CreatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  if (msg.EventType === "StatusRequested") {
    return (
      <div style={{ padding: "3px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
        <span className="sp-mono" style={{ fontSize: 9, color: "var(--sp-shelter)", letterSpacing: "0.06em" }}>
          <Activity size={8} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
          {msg.EventUserName} {i18nT("chat.statusRequested", lang)}
          <span style={{ marginLeft: 5, opacity: 0.6 }}>{ts}</span>
        </span>
        <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
      </div>
    );
  }

  const statusColor =
    msg.EventStatus === "Safe" ? "var(--sp-safe)"
    : msg.EventStatus === "InShelter" ? "var(--sp-shelter)"
    : msg.EventStatus === "NeedHelp" ? "var(--sp-help)"
    : "var(--sp-unknown)";
  const isNeedHelp = msg.EventStatus === "NeedHelp";

  return (
    <div style={{ padding: "2px 14px", background: isNeedHelp ? "color-mix(in srgb, var(--sp-help) 10%, transparent)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
        <span className="sp-mono" style={{ fontSize: 9, color: statusColor, letterSpacing: "0.06em" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, display: "inline-block", marginRight: 3, verticalAlign: "middle" }} />
          {msg.EventUserName} {i18nT("chat.statusChanged", lang)} {msg.EventStatus ? statusLabel(msg.EventStatus as UserStatus, lang).toUpperCase() : ""}
          {isNeedHelp && <span style={{ marginLeft: 6, letterSpacing: "0.12em" }}>· {i18nT("chat.needHelpBanner", lang)}</span>}
          <span style={{ marginLeft: 5, opacity: 0.6 }}>{ts}</span>
        </span>
        <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
      </div>
    </div>
  );
}

function UserMessage({
  msg, accent, isMine, settings, accessToken, groupId,
}: {
  msg: GroupMessageDto;
  accent: string;
  isMine: boolean;
  settings: AppSettings;
  accessToken: string;
  groupId: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.Text ?? "");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showMenu]);

  async function handleReaction(emoji: string) {
    setShowPicker(false);
    try { await toggleReaction(settings, accessToken, groupId, msg.Id, emoji); } catch { /* via SignalR */ }
  }

  async function handleDelete() {
    setShowMenu(false);
    if (!window.confirm("Delete this message?")) return;
    try { await deleteGroupMessage(settings, accessToken, groupId, msg.Id); } catch { /* via SignalR */ }
  }

  function startEdit() {
    setEditText(msg.Text ?? "");
    setEditing(true);
    setShowMenu(false);
  }

  async function saveEdit() {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === msg.Text) { setEditing(false); return; }
    try { await editGroupMessage(settings, accessToken, groupId, msg.Id, trimmed); }
    catch { /* via SignalR */ }
    setEditing(false);
  }

  function handleEditKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); }
    if (e.key === "Escape") setEditing(false);
  }

  const grouped: Record<string, number> = {};
  for (const r of msg.Reactions ?? []) grouped[r.Emoji] = (grouped[r.Emoji] ?? 0) + 1;
  const hasReactions = Object.keys(grouped).length > 0;

  return (
    <div style={{
      padding: "2px 14px 2px 16px",
      borderLeft: `2px solid ${accent}`,
      background: isMine ? "color-mix(in srgb, var(--sp-surface) 60%, transparent)" : undefined,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 1 }}>
        <span style={{ fontWeight: 700, fontSize: 11, color: "var(--sp-fg-1)" }}>{msg.AuthorName}</span>
        <span className="sp-mono" style={{ fontSize: 9, color: "var(--sp-fg-3)" }}>
          {new Date(msg.CreatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
        {msg.IsEdited && !msg.IsDeleted && (
          <span className="sp-mono" style={{ fontSize: 9, color: "var(--sp-fg-3)", fontStyle: "italic" }}>(edited)</span>
        )}
        {isMine && !msg.IsDeleted && (
          <div ref={menuRef} style={{ position: "relative", marginLeft: "auto" }}>
            <button
              className="sp-btn-icon"
              style={{ width: 18, height: 14, fontSize: 12, letterSpacing: 1, color: "var(--sp-fg-3)", opacity: 0.6, lineHeight: 1 }}
              onClick={() => setShowMenu((v) => !v)}
              type="button"
            >···</button>
            {showMenu && (
              <div style={{
                position: "absolute", top: "100%", right: 0, zIndex: 200, minWidth: 120,
                background: "var(--sp-surface)", border: "1px solid var(--sp-border)",
                borderRadius: 4, overflow: "hidden",
              }}>
                <button
                  className="sp-mono"
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", fontSize: 11,
                    background: "none", border: "none", cursor: "pointer", color: "var(--sp-fg-2)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sp-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  onClick={startEdit}
                  type="button"
                >Edit</button>
                <button
                  className="sp-mono"
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", fontSize: 11,
                    background: "none", border: "none", cursor: "pointer", color: "var(--sp-help)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sp-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  onClick={() => void handleDelete()}
                  type="button"
                >Delete</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {msg.IsDeleted ? (
        <p style={{ fontSize: 11, margin: "0 0 2px", color: "var(--sp-fg-3)", fontStyle: "italic" }}>message was deleted</p>
      ) : editing ? (
        <div style={{ marginBottom: 4 }}>
          <textarea
            className="sp-text-input"
            style={{ width: "100%", resize: "none", fontSize: 12, padding: "4px 8px", lineHeight: 1.4 }}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleEditKey}
            rows={Math.max(1, editText.split("\n").length)}
            autoFocus
          />
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button className="sp-btn-icon" style={{ fontSize: 11, padding: "2px 10px", height: 22, width: "auto" }}
              onClick={() => void saveEdit()} type="button">Save</button>
            <button className="sp-btn-icon" style={{ fontSize: 11, padding: "2px 10px", height: 22, width: "auto", color: "var(--sp-fg-3)" }}
              onClick={() => setEditing(false)} type="button">Cancel</button>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12, margin: "0 0 2px", color: "var(--sp-fg-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.4 }}>
          {msg.Text}
        </p>
      )}

      {/* Reactions */}
      {!msg.IsDeleted && (
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", position: "relative" }}>
          {Object.entries(grouped).map(([emoji, count]) => (
            <button key={emoji} className="sp-filter-chip"
              style={{ fontSize: 11, padding: "1px 5px", gap: 2, height: 18 }}
              onClick={() => void handleReaction(emoji)} type="button">
              {emoji} <span style={{ fontSize: 10 }}>{count}</span>
            </button>
          ))}
          <button className="sp-btn-icon" style={{ width: 18, height: 18, fontSize: 11, lineHeight: 1 }}
            onClick={() => setShowPicker((v) => !v)} title="React" type="button">+</button>
          {showPicker && (
            <div style={{
              position: "absolute", bottom: "100%", left: 0, zIndex: 100,
              background: "var(--sp-surface)", border: "1px solid var(--sp-border)",
              borderRadius: 4, padding: "4px 6px", display: "flex", gap: 4,
            }} onMouseLeave={() => setShowPicker(false)}>
              {REACTION_EMOJIS.map((e) => (
                <button key={e} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 17, padding: 2 }}
                  onClick={() => void handleReaction(e)} type="button">{e}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {msg.IsDeleted && hasReactions && (
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
          {Object.entries(grouped).map(([emoji, count]) => (
            <button key={emoji} className="sp-filter-chip"
              style={{ fontSize: 11, padding: "1px 5px", gap: 2, height: 18 }}
              onClick={() => void handleReaction(emoji)} type="button">
              {emoji} <span style={{ fontSize: 10 }}>{count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatPanel({
  settings, accessToken, groupId, currentUserId, members, lastChatMessage,
}: {
  settings: AppSettings;
  accessToken: string;
  groupId: string;
  currentUserId: string;
  members: GroupMemberDto[];
  lastChatMessage: GroupMessageDto | null;
}) {
  const t = useT();
  const [messages, setMessages] = useState<GroupMessageDto[]>([]);
  const [text, setText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const LIMIT = 50;

  useEffect(() => {
    setIsLoading(true);
    setMessages([]);
    getGroupMessages(settings, accessToken, groupId, undefined, LIMIT)
      .then((msgs) => { setMessages(msgs); setHasMore(msgs.length === LIMIT); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [settings, accessToken, groupId]);

  useEffect(() => {
    if (!isLoading) bottomRef.current?.scrollIntoView();
  }, [isLoading]);

  useEffect(() => {
    if (!lastChatMessage || lastChatMessage.GroupId !== groupId) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.Id === lastChatMessage.Id);
      if (idx >= 0) { const next = [...prev]; next[idx] = lastChatMessage; return next; }
      return [...prev, lastChatMessage];
    });
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [lastChatMessage, groupId]);

  async function loadMore() {
    if (!messages.length || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const older = await getGroupMessages(settings, accessToken, groupId, messages[0].Id, LIMIT);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length === LIMIT);
    } catch { /* ignore */ } finally { setIsLoadingMore(false); }
  }

  async function send(textToSend: string) {
    const trimmed = textToSend.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    setText("");
    try { await sendGroupMessage(settings, accessToken, groupId, trimmed); }
    catch { setText(trimmed); }
    finally { setIsSending(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); }
  }

  function memberAccent(userId: string | null | undefined): string {
    const s = members.find((m) => m.Id === userId)?.Status ?? "Unknown";
    return s === "Safe" ? "var(--sp-safe)" : s === "InShelter" ? "var(--sp-shelter)" : s === "NeedHelp" ? "var(--sp-help)" : "var(--sp-unknown)";
  }

  function dayLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "TODAY";
    if (d.toDateString() === yesterday.toDateString()) return "YESTERDAY";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  }

  const items: Array<{ type: "divider"; label: string } | { type: "msg"; msg: GroupMessageDto }> = [];
  let lastDay = "";
  for (const msg of messages) {
    const day = dayLabel(msg.CreatedAt);
    if (day !== lastDay) { items.push({ type: "divider", label: day }); lastDay = day; }
    items.push({ type: "msg", msg });
  }

  const quickReplies = [t("chat.quickOnMyWay"), t("chat.quickCopy"), t("chat.quickConfirm")];

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <span className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)" }}>LOADING…</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 4px" }}>
        {hasMore && (
          <div style={{ padding: "8px 14px", textAlign: "center" }}>
            <button className="sp-btn-secondary" style={{ fontSize: 11 }}
              onClick={() => void loadMore()} disabled={isLoadingMore} type="button">
              {isLoadingMore ? "…" : t("chat.loadMore")}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div style={{ padding: "40px 14px", textAlign: "center" }}>
            <span className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)" }}>No messages yet.</span>
          </div>
        )}
        {items.map((item, i) =>
          item.type === "divider" ? (
            <div key={`d${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px" }}>
              <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
              <span className="sp-mono" style={{ fontSize: 9, color: "var(--sp-fg-3)", letterSpacing: "0.1em" }}>{item.label}</span>
              <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
            </div>
          ) : item.msg.Kind === "System" ? (
            <SystemMessage key={item.msg.Id} msg={item.msg} />
          ) : (
            <UserMessage key={item.msg.Id} msg={item.msg}
              accent={memberAccent(item.msg.AuthorId)}
              isMine={item.msg.AuthorId === currentUserId}
              settings={settings} accessToken={accessToken} groupId={groupId} />
          )
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ borderTop: "1px solid var(--sp-border)", padding: "8px 14px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {quickReplies.map((qr) => (
            <button key={qr} className="sp-filter-chip" style={{ fontSize: 11 }}
              onClick={() => void send(qr)} disabled={isSending} type="button">{qr}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea
            className="sp-text-input"
            style={{ flex: 1, resize: "none", height: 36, fontSize: 13, padding: "8px 10px", lineHeight: 1.4 }}
            placeholder={t("chat.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button className="sp-btn-primary" style={{ width: "auto", height: 36, padding: "0 14px", flexShrink: 0 }}
            disabled={!text.trim() || isSending} onClick={() => void send(text)} type="button">
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Group details ──────────────────────────────────────────────────
function GroupDetails({
  group,
  canManage,
  members,
  latestInvite,
  latestStatusRequest,
  isCreatingInvite,
  onCreateInvite,
  onRequestStatus,
  requestStatusError,
  isRequestingStatus,
  onRemoveMember,
  onUpdateRole,
  onAddMember: _onAddMember,
  onDeleteGroup,
  memberActionError,
  settings,
  accessToken,
  currentUserId,
  lastChatMessage,
}: {
  group: MyGroupDto;
  canManage: boolean;
  members: GroupMemberDto[];
  latestInvite: { apiUrl: string; telegramUrl: string } | null;
  latestStatusRequest: string | null;
  isCreatingInvite: boolean;
  onCreateInvite: () => void;
  onRequestStatus: () => void;
  requestStatusError?: string;
  isRequestingStatus: boolean;
  onRemoveMember: (userId: string) => void;
  onUpdateRole: (userId: string, role: "Member" | "Admin") => void;
  onAddMember: (userId: string) => void;
  onDeleteGroup?: () => void;
  memberActionError?: string;
  settings: AppSettings;
  accessToken: string;
  currentUserId: string;
  lastChatMessage: GroupMessageDto | null;
}) {
  const t = useT();
  const [activeGroupTab, setActiveGroupTab] = useState<"chat" | "members">("chat");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "All">("All");
  const [memberSearch, setMemberSearch] = useState("");

  const bd = { Safe: 0, InShelter: 0, NeedHelp: 0, Unknown: 0 } as Record<UserStatus, number>;
  for (const m of members) bd[m.Status] = (bd[m.Status] ?? 0) + 1;

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return [...members]
      .filter((m) => statusFilter === "All" || m.Status === statusFilter)
      .filter((m) => !q || m.UserName.toLowerCase().includes(q))
      .sort((a, b) => {
        const sc = statusFilter === "All" ? 0 : statusOrder(a.Status) - statusOrder(b.Status);
        if (sc !== 0) return sc;
        return new Date(b.LastActiveAt).getTime() - new Date(a.LastActiveAt).getTime();
      });
  }, [members, statusFilter, memberSearch]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Group header */}
      <div className="sp-group-header">
        <div className="sp-group-header-top">
          <span className="sp-callsign">{groupCallsign(group.Name)}</span>
          <span className="sp-group-header-name">{group.Name}</span>
          <span className="sp-mono sp-up"
            style={{ fontSize: 9, color: canManage ? "var(--sp-safe)" : "var(--sp-fg-3)", letterSpacing: "0.1em" }}>
            {canManage ? t("grp.owner") : t("grp.member")}
          </span>
          {/* Mobile: delete icon in header */}
          {onDeleteGroup && (
            <button className="sp-btn-icon sp-mobile-only" style={{ marginLeft: "auto", color: "var(--sp-help)", borderColor: "var(--sp-help-dim)" }}
              onClick={onDeleteGroup} title="Delete group" type="button">
              <Trash2 size={14} />
            </button>
          )}
          {/* Desktop: action buttons inline in header */}
          <span className="sp-desktop-only" style={{ marginLeft: "auto", gap: 8 }}>
            <button className="sp-btn-action" disabled={isRequestingStatus} onClick={onRequestStatus} type="button">
              <Send size={13} /> {t("grp.requestStatus")}
            </button>
            {canManage && (
              <button className="sp-btn-icon" style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}
                onClick={onCreateInvite} disabled={isCreatingInvite} title="Create invite link" type="button">
                {t("grp.addMember")}
              </button>
            )}
          </span>
        </div>

        {/* Status bar */}
        <div className="sp-status-bar" style={{ height: 6, marginTop: 12 }}>
          {bd.NeedHelp  > 0 && <div className="sp-status-bar-seg sp-status-bar-seg--help"    style={{ flex: bd.NeedHelp }} />}
          {bd.Unknown   > 0 && <div className="sp-status-bar-seg sp-status-bar-seg--unknown"  style={{ flex: bd.Unknown }} />}
          {bd.InShelter > 0 && <div className="sp-status-bar-seg sp-status-bar-seg--shelter"  style={{ flex: bd.InShelter }} />}
          {bd.Safe      > 0 && <div className="sp-status-bar-seg sp-status-bar-seg--safe"     style={{ flex: bd.Safe }} />}
        </div>

        <div className="sp-group-breakdown" style={{ fontFamily: "var(--sp-mono)", fontSize: 11, marginTop: 8 }}>
          {bd.NeedHelp  > 0 && <span style={{ color: "var(--sp-help)" }}>● {bd.NeedHelp} need help</span>}
          {bd.Unknown   > 0 && <span style={{ color: "var(--sp-unknown)" }}>● {bd.Unknown} unknown</span>}
          {bd.InShelter > 0 && <span style={{ color: "var(--sp-shelter)" }}>● {bd.InShelter} in shelter</span>}
          <span style={{ color: "var(--sp-safe)" }}>● {bd.Safe} safe</span>
          <span style={{ marginLeft: "auto", color: "var(--sp-fg-3)" }}>{members.length} total</span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--sp-border)", background: "var(--sp-surface)", flexShrink: 0 }}>
        {(["chat", "members"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveGroupTab(tab)}
            className="sp-mono"
            style={{
              flex: 1, padding: "8px 0", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
              background: "none", border: "none", cursor: "pointer",
              borderBottom: activeGroupTab === tab ? "2px solid var(--sp-safe)" : "2px solid transparent",
              color: activeGroupTab === tab ? "var(--sp-safe)" : "var(--sp-fg-3)",
            }}
          >
            {tab === "chat" ? t("chat.tab") : t("chat.membersTab")}
          </button>
        ))}
      </div>

      {/* ── CHAT tab ── */}
      {activeGroupTab === "chat" && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ChatPanel
            settings={settings}
            accessToken={accessToken}
            groupId={group.Id}
            currentUserId={currentUserId}
            members={members}
            lastChatMessage={lastChatMessage}
          />
        </div>
      )}

      {/* ── MEMBERS tab ── */}
      {activeGroupTab === "members" && (
        <>
          {/* Mobile-only: action row + invite + add member */}
          <div className="sp-mobile-only">
            <div className="sp-action-row">
              <button className="sp-btn-action" disabled={isRequestingStatus} onClick={onRequestStatus} type="button">
                <Send size={13} /> {t("grp.requestStatus")}
              </button>
              {canManage && (
                <button className="sp-btn-icon" onClick={onCreateInvite} disabled={isCreatingInvite} title="Create invite" type="button">
                  <Copy size={14} />
                </button>
              )}
            </div>
            {latestStatusRequest && (
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--sp-border)" }}>
                <p className="sp-mono" style={{ fontSize: 10, color: "var(--sp-shelter)" }}>{latestStatusRequest}</p>
              </div>
            )}
            {requestStatusError && <div className="sp-error-box" style={{ margin: "8px 14px" }}>{requestStatusError}</div>}
            {memberActionError  && <div className="sp-error-box" style={{ margin: "8px 14px" }}>{memberActionError}</div>}
            {latestInvite && (
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--sp-border)", display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="sp-invite-box">
                  <div className="sp-invite-url">{latestInvite.apiUrl}</div>
                  <div className="sp-invite-actions">
                    <button className="sp-btn-icon" style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => { void navigator.clipboard.writeText(latestInvite.apiUrl); }} type="button">
                      <Copy size={13} />
                      <span className="sp-mono sp-up" style={{ fontSize: 10, letterSpacing: "0.08em", marginLeft: 6 }}>Copy</span>
                    </button>
                  </div>
                </div>
                <div className="sp-invite-box">
                  <div className="sp-invite-url">{latestInvite.telegramUrl}</div>
                  <div className="sp-invite-actions">
                    <button className="sp-btn-icon" style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => { void navigator.clipboard.writeText(latestInvite.telegramUrl); }} type="button">
                      <Copy size={13} />
                      <span className="sp-mono sp-up" style={{ fontSize: 10, letterSpacing: "0.08em", marginLeft: 6 }}>Telegram</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
            {canManage && (
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--sp-border)" }}>
                <button className="sp-btn-secondary" style={{ width: "100%", justifyContent: "center" }}
                  disabled={isCreatingInvite} onClick={onCreateInvite} type="button">
                  <Copy size={13} /> GENERATE LINKS
                </button>
              </div>
            )}
          </div>

          {/* Desktop-only: inline error messages */}
          <div className="sp-desktop-only" style={{ flexDirection: "column", gap: 0 }}>
            {latestStatusRequest && (
              <div style={{ padding: "8px 24px", borderBottom: "1px solid var(--sp-border)" }}>
                <p className="sp-mono" style={{ fontSize: 10, color: "var(--sp-shelter)" }}>{latestStatusRequest}</p>
              </div>
            )}
            {requestStatusError && <div className="sp-error-box" style={{ margin: "8px 24px" }}>{requestStatusError}</div>}
            {memberActionError  && <div className="sp-error-box" style={{ margin: "8px 24px" }}>{memberActionError}</div>}
          </div>

          {/* Filter chips */}
          <div className="sp-filter-chips">
            <FilterChip label={t("grp.all")}     count={members.length} active={statusFilter === "All"}       onClick={() => setStatusFilter("All")} />
            <FilterChip label={t("grp.help")}    count={bd.NeedHelp}    status="NeedHelp"  active={statusFilter === "NeedHelp"}  onClick={() => setStatusFilter("NeedHelp")} />
            <FilterChip label={t("grp.shelter")} count={bd.InShelter}   status="InShelter" active={statusFilter === "InShelter"} onClick={() => setStatusFilter("InShelter")} />
            <FilterChip label={t("grp.safe")}    count={bd.Safe}        status="Safe"      active={statusFilter === "Safe"}      onClick={() => setStatusFilter("Safe")} />
            <FilterChip label={t("grp.unknown")} count={bd.Unknown}     status="Unknown"   active={statusFilter === "Unknown"}   onClick={() => setStatusFilter("Unknown")} />
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
              <input
                className="sp-text-input"
                style={{ height: 28, fontSize: 11, padding: "0 8px", width: 160 }}
                placeholder={t("grp.searchMembers")}
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />
              {memberSearch && (
                <button className="sp-btn-icon" style={{ padding: 4 }} onClick={() => setMemberSearch("")} type="button">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Desktop: member table header */}
          <div className="sp-member-table-head">
            <span />
            <span>{t("grp.colName")}</span>
            <span>{t("grp.colRole")}</span>
            <span>{t("grp.colStatus")}</span>
            <span>{t("grp.colLastActive")}</span>
            <span>{t("grp.colActions")}</span>
          </div>

          {/* Member list */}
          <div>
            {filteredMembers.map((member) => (
              <MemberRow
                key={member.Id}
                member={member}
                onRemove={member.CanManage ? () => onRemoveMember(member.Id) : undefined}
                onToggleAdmin={canManage && member.Role !== "Owner"
                  ? () => onUpdateRole(member.Id, member.Role === "Admin" ? "Member" : "Admin")
                  : undefined}
              />
            ))}
            {filteredMembers.length === 0 && (
              <p className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)", padding: "12px 14px" }}>
                No users with this status.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({
  label, count, status, active, onClick,
}: {
  label: string; count: number; status?: UserStatus; active: boolean; onClick: () => void;
}) {
  const key = status ? statusKey(status) : null;
  return (
    <button
      className={`sp-filter-chip ${active ? "active" : ""} ${key ? `sp-filter-chip--${key}` : ""}`}
      onClick={onClick} type="button"
    >
      {key && !active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--sp-${key})` }} />}
      {label}
      <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

// ── Member row ─────────────────────────────────────────────────────
function MemberRow({
  member,
  onRemove,
  onToggleAdmin,
}: {
  member: GroupMemberDto;
  onRemove?: () => void;
  onToggleAdmin?: () => void;
}) {
  const t = useT();
  const key = statusKey(member.Status);
  const initials = userInitials(member.UserName || member.Id);
  const colorVar = `var(--sp-${key})`;
  const urgent = member.Status === "NeedHelp";
  const displayName = member.UserName || member.Id;
  const roleLabel = member.Role === "Owner" ? t("grp.roleOwner")
    : member.Role === "Admin" ? t("grp.roleAdmin")
    : t("grp.roleMember");

  const actions = (
    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
      {onToggleAdmin && (
        <button className="sp-btn-icon" style={{ width: 28, height: 28 }}
          onClick={onToggleAdmin} title={member.Role === "Admin" ? "Make member" : "Make admin"} type="button">
          <ShieldCheck size={13} />
        </button>
      )}
      {onRemove && (
        <button className="sp-btn-icon" style={{ width: 28, height: 28, borderColor: "var(--sp-help-dim)", color: "var(--sp-help)" }}
          onClick={onRemove} title="Remove from group" type="button">
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Card (mobile) */}
      <div className={`sp-member-row ${urgent ? "sp-member-row--urgent" : ""}`}>
        <span className="sp-avatar" style={{ width: 36, height: 36, fontSize: 12, borderRadius: 0 }}>
          {initials}
          <span className="sp-avatar-indicator" style={{ width: 10, height: 10, background: colorVar }} />
        </span>
        <div className="sp-member-info">
          <span className="sp-member-name">{displayName}</span>
          <div className="sp-member-meta">
            <span>{roleLabel}</span>
            <span>·</span>
            <span>{formatDateTime(member.LastActiveAt)}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusChip status={member.Status} />
          {actions}
        </div>
      </div>

      {/* Table row (desktop) */}
      <div className={`sp-member-table-row ${urgent ? "sp-member-table-row--urgent" : ""}`}>
        <span className="sp-avatar" style={{ width: 28, height: 28, fontSize: 10, borderRadius: 0 }}>
          {initials}
          <span className="sp-avatar-indicator" style={{ width: 8, height: 8, background: colorVar }} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{displayName}</span>
        <span className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)" }}>{roleLabel}</span>
        <StatusChip status={member.Status} />
        <span className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)" }}>{formatDateTime(member.LastActiveAt)}</span>
        {actions}
      </div>
    </>
  );
}

function StatusChip({ status }: { status: UserStatus }) {
  const lang = useContext(LanguageContext);
  const key = statusKey(status);
  return (
    <span className={`sp-status-chip sp-status-chip--${key}`}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--sp-${key})` }} />
      {statusShort(status, lang)}
    </span>
  );
}

// ── Group right rail (desktop only) ───────────────────────────────
function GroupRightRail({
  group, canManage, members, latestInvite, isCreatingInvite, createInviteError,
  onCreateInvite, onAddMember, onDeleteGroup,
}: {
  group: MyGroupDto;
  canManage: boolean;
  members: GroupMemberDto[];
  latestInvite: { apiUrl: string; telegramUrl: string } | null;
  isCreatingInvite: boolean;
  createInviteError?: string;
  onCreateInvite: () => void;
  onAddMember: (userId: string) => void;
  onDeleteGroup?: () => void;
}) {
  const t = useT();
  const [memberId, setMemberId] = useState("");
  const admins = members.filter((m) => m.Role === "Admin" || m.Role === "Owner");

  return (
    <>
      {/* GROUP INFO */}
      <div>
        <div className="sp-section-head" style={{ marginBottom: 10 }}>
          <span className="sp-section-head-label">{t("rail.groupInfo")}</span>
          <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
        </div>
        <div className="sp-group-kv-block">
          <div className="sp-group-kv">
            <span className="sp-group-kv-k">{t("rail.code")}</span>
            <span className="sp-group-kv-v">{groupCallsign(group.Name)}</span>
          </div>
          <div className="sp-group-kv">
            <span className="sp-group-kv-k">{t("rail.members")}</span>
            <span className="sp-group-kv-v">{members.length}</span>
          </div>
          <div className="sp-group-kv">
            <span className="sp-group-kv-k">{t("rail.admins")}</span>
            <span className="sp-group-kv-v">{admins.length}</span>
          </div>
          <div className="sp-group-kv">
            <span className="sp-group-kv-k">{t("rail.role")}</span>
            <span className="sp-group-kv-v" style={{ color: canManage ? "var(--sp-safe)" : "var(--sp-fg-2)" }}>
              {canManage ? t("rail.roleOwner") : t("rail.roleMember")}
            </span>
          </div>
        </div>
      </div>

      {/* INVITE LINK */}
      <div>
        <div className="sp-section-head" style={{ marginBottom: 10 }}>
          <span className="sp-section-head-label">{t("rail.inviteLink")}</span>
          <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {latestInvite && (
            <div className="sp-group-kv-block" style={{ gap: 8 }}>
              <div className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-2)", wordBreak: "break-all", padding: "8px 10px", background: "var(--sp-bg)", border: "1px solid var(--sp-border)" }}>
                {latestInvite.apiUrl}
              </div>
              <button
                className="sp-btn-secondary"
                style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
                onClick={() => { void navigator.clipboard.writeText(latestInvite.apiUrl); }}
                type="button"
              >
                <Copy size={12} /> {t("rail.copyLink")}
              </button>
              <div className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-2)", wordBreak: "break-all", padding: "8px 10px", background: "var(--sp-bg)", border: "1px solid var(--sp-border)", marginTop: 4 }}>
                {latestInvite.telegramUrl}
              </div>
              <button
                className="sp-btn-secondary"
                style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
                onClick={() => { void navigator.clipboard.writeText(latestInvite.telegramUrl); }}
                type="button"
              >
                <Copy size={12} /> {t("rail.telegramLink")}
              </button>
            </div>
          )}
          {canManage && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="sp-btn-secondary" style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
                disabled={isCreatingInvite} onClick={onCreateInvite} type="button">
                <Copy size={13} /> {t("rail.generateLinks")}
              </button>
              {createInviteError && <div className="sp-error-box">{createInviteError}</div>}
            </div>
          )}
        </div>
      </div>

      {/* ADMINS */}
      {admins.length > 0 && (
        <div>
          <div className="sp-section-head" style={{ marginBottom: 10 }}>
            <span className="sp-section-head-label">{t("rail.admins")}</span>
            <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {admins.map((m) => {
              const sk = statusKey(m.Status);
              const initials = userInitials(m.UserName || m.Id);
              return (
                <div key={m.Id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="sp-avatar" style={{ width: 28, height: 28, fontSize: 10, borderRadius: 0, flexShrink: 0 }}>
                    {initials}
                    <span className="sp-avatar-indicator" style={{ width: 8, height: 8, background: `var(--sp-${sk})` }} />
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{m.UserName || m.Id}</span>
                    <span className="sp-mono sp-up" style={{ fontSize: 9, color: m.Role === "Owner" ? "var(--sp-safe)" : "var(--sp-fg-3)", letterSpacing: "0.1em" }}>
                      {m.Role}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ADD MEMBER */}
      {canManage && (
        <div>
          <div className="sp-section-head" style={{ marginBottom: 10 }}>
            <span className="sp-section-head-label">{t("rail.addMember")}</span>
            <span style={{ flex: 1, height: 1, background: "var(--sp-border)" }} />
          </div>
          <div className="sp-input-row">
            <input className="sp-text-input" placeholder={t("rail.userIdPlaceholder")}
              value={memberId} onChange={(e) => setMemberId(e.target.value)} />
            <button className="sp-btn-icon" disabled={!memberId.trim()}
              onClick={() => { onAddMember(memberId.trim()); setMemberId(""); }} title="Add user" type="button">
              <Plus size={14} />
            </button>
          </div>
        </div>
      )}

      {/* DANGER ZONE */}
      {onDeleteGroup && (
        <div style={{ marginTop: "auto", padding: 12, border: "1px solid var(--sp-help-dim)", background: "var(--sp-help-bg)" }}>
          <div className="sp-section-head" style={{ marginBottom: 8 }}>
            <span className="sp-section-head-label" style={{ color: "var(--sp-help)" }}>{t("rail.dangerZone")}</span>
          </div>
          <button className="sp-btn-danger" style={{ width: "100%" }} onClick={onDeleteGroup} type="button">
            {t("rail.deleteGroup")}
          </button>
        </div>
      )}
    </>
  );
}

// ── Profile section ────────────────────────────────────────────────
function ProfileSection({
  currentUser, t, updateProfileMutation,
}: {
  currentUser: UserDto;
  t: (k: TranslationKey) => string;
  updateProfileMutation: ReturnType<typeof useMutation<UserDto, Error, string>>;
}) {
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");

  function startEdit() {
    setUsernameDraft(currentUser.UserName);
    setEditingUsername(true);
    updateProfileMutation.reset();
  }

  function cancelEdit() {
    setEditingUsername(false);
  }

  function saveUsername(e: FormEvent) {
    e.preventDefault();
    const trimmed = usernameDraft.trim();
    if (!trimmed || trimmed === currentUser.UserName) { cancelEdit(); return; }
    updateProfileMutation.mutate(trimmed, { onSuccess: () => setEditingUsername(false) });
  }

  const row = (label: string, value: ReactNode) => (
    <div className="sp-group-kv" style={{ padding: "9px 0", borderBottom: "1px solid var(--sp-border)" }}>
      <span className="sp-mono sp-up" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.1em", minWidth: 120 }}>{label}</span>
      <span className="sp-mono" style={{ fontSize: 12, color: "var(--sp-fg-2)", wordBreak: "break-all" }}>{value}</span>
    </div>
  );

  return (
    <>
      {/* Identity */}
      <div className="sp-settings-section">
        <div className="sp-settings-section-head">
          <div className="sp-section-head">
            <span className="sp-section-head-label">
              <span className="sp-section-head-code">00</span>{t("set.sectionProfile")}
            </span>
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--sp-border)", padding: "0 16px 4px", background: "var(--sp-surface)" }}>
          {/* Username row — editable */}
          <div className="sp-group-kv" style={{ padding: "9px 0", borderBottom: "1px solid var(--sp-border)", alignItems: "flex-start", gap: 8 }}>
            <span className="sp-mono sp-up" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.1em", minWidth: 120, paddingTop: 2 }}>
              {t("pro.username")}
            </span>
            {editingUsername ? (
              <form onSubmit={saveUsername} style={{ display: "flex", gap: 6, flex: 1, alignItems: "center" }}>
                <input
                  className="sp-text-input"
                  style={{ flex: 1 }}
                  value={usernameDraft}
                  onChange={(e) => setUsernameDraft(e.target.value)}
                  autoFocus
                  disabled={updateProfileMutation.isPending}
                />
                <button className="sp-btn-icon" type="submit" disabled={updateProfileMutation.isPending} title={t("pro.save")}>
                  <CheckCircle2 size={14} />
                </button>
                <button className="sp-btn-icon" type="button" onClick={cancelEdit} title={t("pro.cancel")}>
                  <X size={14} />
                </button>
              </form>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <span className="sp-mono" style={{ fontSize: 12, color: "var(--sp-fg)", fontWeight: 600 }}>{currentUser.UserName}</span>
                <button className="sp-btn-icon" type="button" onClick={startEdit} style={{ padding: "2px 6px" }} title={t("pro.edit")}>
                  <Link size={12} />
                </button>
                {updateProfileMutation.isSuccess && (
                  <span className="sp-mono" style={{ fontSize: 10, color: "var(--sp-safe)" }}>✓ {t("pro.saved")}</span>
                )}
              </div>
            )}
          </div>
          {updateProfileMutation.isError && (
            <div className="sp-error-box" style={{ marginTop: 6 }}>{updateProfileMutation.error.message}</div>
          )}
          {currentUser.Email && row(t("pro.email"), currentUser.Email)}
          {row(t("pro.id"), currentUser.Id)}
        </div>
      </div>

      {/* Status & activity */}
      <div className="sp-settings-section">
        <div className="sp-settings-section-head">
          <div className="sp-section-head">
            <span className="sp-section-head-label">
              <span className="sp-section-head-code">01</span>ACTIVITY
            </span>
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--sp-border)", padding: "0 16px 4px", background: "var(--sp-surface)" }}>
          {row(t("pro.status"), <StatusChip status={currentUser.Status} />)}
          {row(t("pro.memberSince"), formatDateTime(currentUser.CreatedAt))}
          {row(t("pro.lastActive"), formatDateTime(currentUser.LastActiveAt))}
          {row(t("pro.lastOnline"), formatDateTime(currentUser.LastSeenOnlineAt))}
        </div>
      </div>
    </>
  );
}

function PasswordSection({
  settings,
  accessToken,
  currentUser,
}: {
  settings: AppSettings;
  accessToken: string;
  currentUser: UserDto;
}) {
  const t = useT();
  const hasEmail = Boolean(currentUser.Email);

  const [setForm, setSetForm] = useState({ email: "", password: "", confirm: "" });
  const [setMismatch, setSetMismatch] = useState(false);

  const [changeForm, setChangeForm] = useState({ current: "", newPwd: "", confirm: "" });
  const [changeMismatch, setChangeMismatch] = useState(false);

  const resendMutation = useMutation({
    mutationFn: (email: string) => resendVerificationEmail(settings, email),
  });

  const setPasswordMutation = useMutation({
    mutationFn: () => setPassword(settings, accessToken, setForm.email, setForm.password),
    onSuccess: () => setSetForm({ email: "", password: "", confirm: "" }),
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => changePassword(settings, accessToken, changeForm.current, changeForm.newPwd),
    onSuccess: () => setChangeForm({ current: "", newPwd: "", confirm: "" }),
  });

  function handleSetPassword(e: FormEvent) {
    e.preventDefault();
    if (setForm.password !== setForm.confirm) { setSetMismatch(true); return; }
    setSetMismatch(false);
    setPasswordMutation.mutate();
  }

  function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (changeForm.newPwd !== changeForm.confirm) { setChangeMismatch(true); return; }
    setChangeMismatch(false);
    changePasswordMutation.mutate();
  }

  return (
    <div className="sp-settings-section">
      <div className="sp-settings-section-head">
        <div className="sp-section-head">
          <span className="sp-section-head-label">
            <span className="sp-section-head-code">02</span>{t("pro.sectionSecurity")}
          </span>
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--sp-border)", padding: "12px 16px", background: "var(--sp-surface)" }}>
        <div className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.1em", marginBottom: 10 }}>
          {hasEmail ? t("pro.changePasswordDesc") : t("pro.addEmailPasswordDesc")}
        </div>
        {!hasEmail ? (
          setPasswordMutation.isSuccess ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="sp-mono" style={{ fontSize: 11, color: "var(--sp-safe)", lineHeight: 1.5 }}>
                ✓ {t("pro.verifyEmailSent").replace("{email}", setPasswordMutation.data?.Email ?? "")}
              </div>
              <button
                className="sp-btn-secondary" type="button"
                disabled={resendMutation.isPending}
                onClick={() => resendMutation.mutate(setPasswordMutation.data?.Email ?? "")}
              >
                {t("pro.resendVerification")}
              </button>
              {resendMutation.isSuccess && (
                <div className="sp-mono" style={{ fontSize: 10, color: "var(--sp-safe)" }}>✓ {t("auth.resendSent")}</div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSetPassword} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="sp-text-input" type="email"
                placeholder={t("pro.emailPlaceholder")}
                value={setForm.email}
                onChange={(e) => setSetForm((f) => ({ ...f, email: e.target.value }))}
                required disabled={setPasswordMutation.isPending}
              />
              <input
                className="sp-text-input" type="password"
                placeholder={t("pro.passwordPlaceholder")}
                value={setForm.password}
                onChange={(e) => setSetForm((f) => ({ ...f, password: e.target.value }))}
                required disabled={setPasswordMutation.isPending}
              />
              <input
                className="sp-text-input" type="password"
                placeholder={t("pro.confirmPasswordPlaceholder")}
                value={setForm.confirm}
                onChange={(e) => setSetForm((f) => ({ ...f, confirm: e.target.value }))}
                required disabled={setPasswordMutation.isPending}
              />
              {setMismatch && <div className="sp-error-box">{t("pro.passwordMismatch")}</div>}
              {setPasswordMutation.isError && (
                <div className="sp-error-box">{setPasswordMutation.error.message}</div>
              )}
              <button className="sp-btn-action" type="submit" disabled={setPasswordMutation.isPending}>
                {t("pro.setPasswordBtn")}
              </button>
            </form>
          )
        ) : (
          <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              className="sp-text-input" type="password"
              placeholder={t("pro.currentPasswordPlaceholder")}
              value={changeForm.current}
              onChange={(e) => setChangeForm((f) => ({ ...f, current: e.target.value }))}
              required disabled={changePasswordMutation.isPending}
            />
            <input
              className="sp-text-input" type="password"
              placeholder={t("pro.newPasswordPlaceholder")}
              value={changeForm.newPwd}
              onChange={(e) => setChangeForm((f) => ({ ...f, newPwd: e.target.value }))}
              required disabled={changePasswordMutation.isPending}
            />
            <input
              className="sp-text-input" type="password"
              placeholder={t("pro.confirmPasswordPlaceholder")}
              value={changeForm.confirm}
              onChange={(e) => setChangeForm((f) => ({ ...f, confirm: e.target.value }))}
              required disabled={changePasswordMutation.isPending}
            />
            {changeMismatch && <div className="sp-error-box">{t("pro.passwordMismatch")}</div>}
            {changePasswordMutation.isError && (
              <div className="sp-error-box">{changePasswordMutation.error.message}</div>
            )}
            {changePasswordMutation.isSuccess && (
              <div className="sp-mono" style={{ fontSize: 11, color: "var(--sp-safe)" }}>✓ {t("pro.passwordChanged")}</div>
            )}
            <button className="sp-btn-action" type="submit" disabled={changePasswordMutation.isPending}>
              {t("pro.changePasswordBtn")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Settings page ──────────────────────────────────────────────────
function SettingsPage({
  settings,
  accessToken,
  currentUser,
  theme,
  onThemeChange,
}: {
  settings: AppSettings;
  accessToken: string;
  currentUser: UserDto;
  theme: "dark" | "light";
  onThemeChange: (t: "dark" | "light") => void;
}) {
  const queryClient = useQueryClient();
  const t = useT();
  const lang = useContext(LanguageContext);
  const [activeSection, setActiveSection] = useState(() => {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("settings/")) {
      const sub = hash.slice("settings/".length);
      if (sub === "integrations" || sub === "appearance") return sub;
    }
    return "profile";
  });

  useEffect(() => {
    const next = `#settings/${activeSection}`;
    if (window.location.hash !== next) {
      window.history.replaceState({}, "", next);
    }
  }, [activeSection]);
  const sk = statusKey(currentUser.Status);

  const setLanguage = useMutation({
    mutationFn: (lang: string) => updateLanguage(settings, accessToken, lang),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["current-user"] }),
  });

  const updateProfileMutation = useMutation({
    mutationFn: (userName: string) => updateProfile(settings, accessToken, userName),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["current-user"] }),
  });

  const navItems = [
    { id: "profile",      label: t("set.profile"),      icon: <ShieldCheck size={15} /> },
    { id: "integrations", label: t("set.integrations"), icon: <Bell size={15} /> },
    { id: "appearance",   label: t("set.appearance"),   icon: <Sun size={15} /> },
  ];

  return (
    <div className="sp-settings-layout">
      {/* ── Left nav (desktop only) ─────────────────────────── */}
      <div className="sp-settings-nav">
        {/* Profile card in nav */}
        <div style={{ padding: "16px 16px 14px", borderBottom: "1px solid var(--sp-border)", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="sp-avatar" style={{ width: 36, height: 36, fontSize: 12, borderRadius: 0, flexShrink: 0 }}>
              {userInitials(currentUser.UserName || "")}
              <span className="sp-avatar-indicator" style={{ width: 9, height: 9, background: `var(--sp-${sk})` }} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {currentUser.UserName}
              </div>
              <span className={`sp-status-chip sp-status-chip--${sk}`} style={{ fontSize: 9 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: `var(--sp-${sk})` }} />
                {statusShort(currentUser.Status, lang)}
              </span>
            </div>
          </div>
        </div>

        {navItems.map((item) => (
          <div
            key={item.id}
            className={`sp-settings-nav-item ${activeSection === item.id ? "sp-settings-nav-item--active" : ""}`}
            onClick={() => setActiveSection(item.id)}
          >
            <span style={{ color: activeSection === item.id ? "var(--sp-fg)" : "var(--sp-fg-3)" }}>{item.icon}</span>
            {item.label}
          </div>
        ))}
      </div>

      {/* ── Right: settings content ──────────────────────────── */}
      <div className="sp-settings-content">
        {/* Profile card (mobile) */}
        <div className="sp-profile-card sp-mobile-only" style={{ borderTop: "1px solid var(--sp-border)" }}>
          <span className="sp-avatar" style={{ width: 48, height: 48, fontSize: 16, borderRadius: 0 }}>
            {userInitials(currentUser.UserName || "")}
            <span className="sp-avatar-indicator"
              style={{ width: 12, height: 12, background: `var(--sp-${sk})` }} />
          </span>
          <div className="sp-profile-info">
            <span className="sp-profile-name">{currentUser.UserName}</span>
            <span className="sp-profile-email">{currentUser.Id}</span>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <StatusChip status={currentUser.Status} />
            </div>
          </div>
        </div>

        {/* Mobile: horizontal tab bar */}
        <div className="sp-settings-mobile-tabs sp-mobile-only">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sp-settings-mobile-tab ${activeSection === item.id ? "sp-settings-mobile-tab--active" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Desktop: section title */}
        <div className="sp-desktop-only" style={{ padding: "20px 24px 0", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {navItems.find((n) => n.id === activeSection)?.label ?? "Settings"}
          </div>
          <div className="sp-mono sp-up" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.12em", marginTop: 4 }}>
            {currentUser.UserName} · {currentUser.Id}
          </div>
        </div>

        {/* Profile */}
        {activeSection === "profile" && (
          <>
            <ProfileSection
              currentUser={currentUser}
              t={t}
              updateProfileMutation={updateProfileMutation}
            />
            <PasswordSection settings={settings} accessToken={accessToken} currentUser={currentUser} />
          </>
        )}

        {/* Integrations */}
        {activeSection === "integrations" && (
          <TelegramLinkPanel settings={settings} accessToken={accessToken} currentUser={currentUser} />
        )}

        {/* Appearance */}
        {activeSection === "appearance" && (
          <>
            <div className="sp-settings-section">
              <div className="sp-settings-section-head">
                <div className="sp-section-head">
                  <span className="sp-section-head-label">
                    <span className="sp-section-head-code">03</span>{t("set.sectionAppearance")}
                  </span>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--sp-border)", padding: "12px 16px", background: "var(--sp-surface)" }}>
                <div className="sp-mono sp-up" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.12em", marginBottom: 8 }}>
                  {t("set.theme")}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["dark", "light"] as const).map((th) => (
                    <button
                      key={th}
                      type="button"
                      className="sp-filter-chip"
                      style={theme === th
                        ? { background: "var(--sp-fg)", borderColor: "var(--sp-fg)", color: "var(--sp-bg)" }
                        : {}}
                      onClick={() => onThemeChange(th)}
                    >
                      {th === "dark" ? t("set.themeDark") : t("set.themeLight")}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="sp-settings-section">
              <div className="sp-settings-section-head">
                <div className="sp-section-head">
                  <span className="sp-section-head-label">
                    <span className="sp-section-head-code">04</span>{t("set.interfaceLang")}
                  </span>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--sp-border)", padding: "12px 16px", background: "var(--sp-surface)" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["en", "uk"] as const).map((l) => {
                    const active = (currentUser.Language || "en") === l;
                    return (
                      <button
                        key={l}
                        type="button"
                        className="sp-filter-chip"
                        disabled={setLanguage.isPending}
                        style={active ? { background: "var(--sp-fg)", borderColor: "var(--sp-fg)", color: "var(--sp-bg)" } : {}}
                        onClick={() => { if (!active) setLanguage.mutate(l); }}
                      >
                        {l === "en" ? t("set.langEn") : t("set.langUk")}
                      </button>
                    );
                  })}
                </div>
                {setLanguage.isError && (
                  <div className="sp-mono" style={{ fontSize: 10, color: "var(--sp-help)", marginTop: 6 }}>
                    {setLanguage.error instanceof Error ? setLanguage.error.message : "Failed to update language"}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TelegramLinkPanel({
  settings,
  accessToken,
  currentUser,
}: {
  settings: AppSettings;
  accessToken: string;
  currentUser: UserDto;
}) {
  const queryClient = useQueryClient();
  const t = useT();
  const [codeId, setCodeId] = useState<string | null>(null);

  const appConfig = useQuery({
    queryKey: ["app-config", settings],
    queryFn: () => getAppConfig(settings),
    staleTime: Infinity,
  });
  const botUsername = appConfig.data?.TelegramBotUsername;

  const createCode = useMutation({
    mutationFn: () => createTelegramLinkCode(settings, accessToken),
    onSuccess: (code) => setCodeId(code.Id),
  });

  const updateNotificationsMutation = useMutation({
    mutationFn: (whenOnline: boolean) => updateNotifications(settings, accessToken, whenOnline),
    onSuccess: (user) => {
      void queryClient.setQueryData(["current-user", settings, accessToken], user);
    },
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectTelegram(settings, accessToken),
    onSuccess: () => {
      setCodeId(null);
      void queryClient.invalidateQueries({ queryKey: ["current-user"] });
    },
  });

  const linkStatus = useQuery({
    queryKey: ["telegram-link-status", settings, accessToken, codeId],
    queryFn: () => getTelegramLinkStatus(settings, accessToken, codeId!),
    enabled: Boolean(codeId),
    refetchInterval: (query) => query.state.data?.IsConsumed ? false : 2500,
  });

  useEffect(() => {
    if (!linkStatus.data?.IsConsumed) return;
    void queryClient.invalidateQueries({ queryKey: ["current-user"] });
  }, [linkStatus.data?.IsConsumed, queryClient]);

  return (
    <div className="sp-settings-section">
      <div className="sp-settings-section-head">
        <div className="sp-section-head">
          <span className="sp-section-head-label">
            <span className="sp-section-head-code">02</span>{t("set.sectionTelegram")}
          </span>
          <span className="sp-mono" style={{ fontSize: 10, color: currentUser.ChatId ? "var(--sp-shelter)" : "var(--sp-fg-3)" }}>
            {currentUser.ChatId ? t("set.linked") : t("set.notLinked")}
          </span>
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--sp-border)", padding: "12px 16px", background: "var(--sp-surface)", display: "flex", flexDirection: "column", gap: 10 }}>
        {currentUser.ChatId ? (
          <div style={{ padding: 12, border: "1px solid var(--sp-shelter-dim)", background: "var(--sp-shelter-bg)", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 32, height: 32, border: "1px solid var(--sp-shelter)", color: "var(--sp-shelter)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>T</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("set.telegramLinked")}</div>
              <div className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)" }}>{t("set.chatId")}: {currentUser.ChatId}</div>
            </div>
            <button className="sp-btn-danger" disabled={disconnect.isPending}
              onClick={() => { if (window.confirm(t("set.disconnect") + "?")) disconnect.mutate(); }} type="button">
              {t("set.unlink")}
            </button>
          </div>
        ) : (
          <button className="sp-btn-action" disabled={createCode.isPending} onClick={() => createCode.mutate()} type="button">
            <TelegramIcon /> {t("set.connectTelegram")}
          </button>
        )}

        {createCode.data && (
          <div style={{ padding: 12, border: "1px solid var(--sp-border)", background: "var(--sp-bg)" }}>
            <p className="sp-mono sp-up" style={{ fontSize: 9, color: "var(--sp-fg-3)", letterSpacing: "0.12em" }}>{t("set.sendCode")}</p>
            {botUsername ? (
              <a
                href={`https://t.me/${botUsername}?start=link_${createCode.data.Code}`}
                target="_blank"
                rel="noreferrer"
                className="sp-mono"
                style={{ fontSize: 15, color: "var(--sp-shelter)", marginTop: 6, display: "block", wordBreak: "break-all" }}
              >
                t.me/{botUsername}?start=link_{createCode.data.Code}
              </a>
            ) : (
              <p className="sp-mono" style={{ fontSize: 18, color: "var(--sp-fg)", marginTop: 6 }}>/link {createCode.data.Code}</p>
            )}
            <p className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)", marginTop: 4 }}>
              Expires: {formatDateTime(createCode.data.ExpiresAt)}
            </p>
            {linkStatus.data?.IsConsumed && (
              <p className="sp-mono" style={{ fontSize: 11, color: "var(--sp-safe)", marginTop: 6 }}>● {t("set.linkedSuccess")}</p>
            )}
            {linkStatus.data?.IsExpired && !linkStatus.data.IsConsumed && (
              <p className="sp-mono" style={{ fontSize: 11, color: "var(--sp-help)", marginTop: 6 }}>● {t("set.expiredDesc")}</p>
            )}
          </div>
        )}

        {currentUser.ChatId && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={currentUser.TelegramNotificationsWhenOnline}
              disabled={updateNotificationsMutation.isPending}
              onChange={(e) => updateNotificationsMutation.mutate(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("set.telegramNotifyWhenOnline")}</div>
              <div className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)", marginTop: 2 }}>{t("set.telegramNotifyWhenOnlineDesc")}</div>
            </div>
          </label>
        )}

        {(createCode.error || linkStatus.error || disconnect.error || updateNotificationsMutation.error) && (
          <div className="sp-error-box">
            {createCode.error?.message ?? linkStatus.error?.message ?? disconnect.error?.message ?? updateNotificationsMutation.error?.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Join group form ────────────────────────────────────────────────
function JoinGroupForm({
  settings,
  accessToken,
  onJoined,
}: {
  settings: AppSettings;
  accessToken: string;
  onJoined: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [rawInvite, setRawInvite] = useState("");
  const [token, setToken] = useState("");
  const [acceptedGroupName, setAcceptedGroupName] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ["invite-preview", settings, token],
    queryFn: () => resolveInvite(settings, token),
    enabled: Boolean(token),
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvite(settings, accessToken, token),
    onSuccess: async () => {
      setAcceptedGroupName(preview.data?.GroupName ?? null);
      await queryClient.invalidateQueries({ queryKey: ["my-groups"] });
      await onJoined();
    },
  });

  function submitPreview(event: FormEvent) {
    event.preventDefault();
    setAcceptedGroupName(null);
    setToken(parseInviteToken(rawInvite));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={submitPreview}>
        <input className="sp-text-input" value={rawInvite}
          onChange={(e) => setRawInvite(e.target.value)}
          placeholder="Paste invite token or URL" />
        <button className="sp-btn-primary" type="submit">PREVIEW</button>
      </form>
      {token && <p className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)", wordBreak: "break-all" }}>Token: {token}</p>}
      {preview.isFetching && <p className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)" }}>Checking invite…</p>}
      {preview.error && <div className="sp-error-box">{preview.error.message}</div>}
      {preview.data && (
        <div style={{ padding: 14, border: "1px solid var(--sp-border)", background: "var(--sp-surface)" }}>
          <p className="sp-mono sp-up" style={{ fontSize: 9, color: "var(--sp-fg-3)", letterSpacing: "0.12em" }}>GROUP</p>
          <h3 className="sp-group-name" style={{ fontSize: 18, fontWeight: 700, margin: "6px 0 4px" }}>{preview.data.GroupName}</h3>
          <p className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)", wordBreak: "break-all" }}>{preview.data.GroupId}</p>
          {preview.data.IsRevoked ? (
            <div className="sp-error-box" style={{ marginTop: 10 }}>This invite was revoked.</div>
          ) : (
            <button className="sp-btn-primary" disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()} style={{ marginTop: 12 }} type="button">
              JOIN GROUP
            </button>
          )}
        </div>
      )}
      {acceptMutation.error && <div className="sp-error-box">{acceptMutation.error.message}</div>}
      {acceptedGroupName && (
        <div style={{ padding: "10px 12px", border: "1px solid var(--sp-safe-dim)", background: "var(--sp-safe-bg)", color: "var(--sp-safe)", fontSize: 12 }}>
          Joined <span className="sp-group-name">{acceptedGroupName}</span>.
        </div>
      )}
    </div>
  );
}

// ── Delete group modal ─────────────────────────────────────────────
function DeleteGroupModal({
  group,
  isDeleting,
  error,
  onClose,
  onConfirm,
}: {
  group: MyGroupDto;
  isDeleting: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const canDelete = confirmation === group.Name;

  return (
    <SpModal title="DELETE GROUP" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ fontSize: 13, color: "var(--sp-fg-2)" }}>
          This will delete the group, remove active memberships, and revoke active invites.
        </p>
        <SpField
          label={`TYPE "${group.Name}" TO CONFIRM`}
          value={confirmation}
          onChange={setConfirmation}
        />
        {error && <div className="sp-error-box">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="sp-btn-secondary" onClick={onClose} style={{ width: "auto", padding: "10px 16px" }} type="button">
            CANCEL
          </button>
          <button className="sp-btn-danger sp-btn-danger--filled"
            disabled={!canDelete || isDeleting} onClick={onConfirm} type="button"
            style={{ padding: "10px 16px" }}>
            {isDeleting ? "DELETING…" : "DELETE GROUP"}
          </button>
        </div>
      </div>
    </SpModal>
  );
}

// ── Modal ──────────────────────────────────────────────────────────
function SpModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="sp-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="sp-modal" aria-modal="true" role="dialog" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="sp-modal-header">
          <span className="sp-modal-title sp-mono sp-up" style={{ letterSpacing: "0.1em" }}>{title}</span>
          <button className="sp-btn-icon" onClick={onClose} title="Close" type="button">
            <X size={14} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

// ── Toasts ─────────────────────────────────────────────────────────
function StatusChangedToast({ message }: { message: string }) {
  return (
    <div className="sp-toast sp-toast--success">
      <CheckCircle2 size={18} style={{ color: "var(--sp-safe)", flexShrink: 0 }} />
      <p className="sp-mono" style={{ fontSize: 12, color: "var(--sp-fg)" }}>{message}</p>
    </div>
  );
}

function StatusRequestToast({ request, onDismiss }: { request: GroupStatusRequestedDto; onDismiss: () => void }) {
  return (
    <div className="sp-toast sp-toast--warning">
      <Bell size={18} style={{ color: "oklch(0.82 0.18 85)", flexShrink: 0 }} />
      <div className="sp-toast-content">
        <p className="sp-mono sp-up" style={{ fontSize: 11, fontWeight: 700, color: "var(--sp-shelter)", letterSpacing: "0.08em" }}>
          STATUS CHECK REQUESTED
        </p>
        <p className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-3)", marginTop: 2 }}>
          {request.GroupName} · {request.RequestedByUserName}
        </p>
      </div>
      <button className="sp-btn-icon" onClick={onDismiss} style={{ width: 28, height: 28 }} title="Dismiss" type="button">
        <X size={13} />
      </button>
    </div>
  );
}

// ── Shared form field ──────────────────────────────────────────────
function SpField({
  label,
  value,
  placeholder,
  type = "text",
  icon,
  onChange,
  sans,
  onKeyDown,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  icon?: ReactNode;
  onChange: (v: string) => void;
  sans?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <div className="sp-field-wrap">
      <span className="sp-field-label">{label}</span>
      <div className={`sp-field-input-row ${sans ? "sp-field-sans" : ""}`}>
        {icon}
        <input
          className="sp-field-input"
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}

// ── Inline SVG icons for login ─────────────────────────────────────
function MailIcon() {
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>;
}
function LockIcon() {
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
}
function UserIcon() {
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>;
}
function TelegramIcon() {
  return <span style={{ width: 14, height: 14, background: "var(--sp-shelter)", color: "#000", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>T</span>;
}
function ChevronRight({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>;
}

// ── Utilities ──────────────────────────────────────────────────────
function statusOrder(status: UserStatus) {
  switch (status) {
    case "NeedHelp":  return 0;
    case "InShelter": return 1;
    case "Safe":      return 2;
    case "Unknown":   return 3;
  }
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function normalizeStatusChanged(message: StatusChangedDto | Record<string, unknown>): StatusChangedDto {
  const raw = message as Record<string, unknown>;
  return {
    UserId: (raw.UserId ?? raw.userId) as string,
    UserName: (raw.UserName ?? raw.userName) as string,
    Status: (raw.Status ?? raw.status) as UserStatus,
    LastActiveAt: (raw.LastActiveAt ?? raw.lastActiveAt) as string,
    LastSeenOnlineAt: (raw.LastSeenOnlineAt ?? raw.lastSeenOnlineAt) as string,
    GroupIds: (raw.GroupIds ?? raw.groupIds ?? []) as string[],
  };
}

function normalizeGroupStatusRequested(message: GroupStatusRequestedDto | Record<string, unknown>): GroupStatusRequestedDto {
  const raw = message as Record<string, unknown>;
  return {
    Id: (raw.Id ?? raw.id) as string,
    GroupId: (raw.GroupId ?? raw.groupId) as string,
    GroupName: (raw.GroupName ?? raw.groupName) as string,
    RequestedByUserId: (raw.RequestedByUserId ?? raw.requestedByUserId) as string,
    RequestedByUserName: (raw.RequestedByUserName ?? raw.requestedByUserName) as string,
    CreatedAt: (raw.CreatedAt ?? raw.createdAt) as string,
  };
}

function playStatusRequestSignal() {
  if ("vibrate" in navigator) navigator.vibrate?.(180);
  try {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  } catch {}
}

function readInitialGroupId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("groupId");
}

function readInitialTab(): Tab {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.slice(1);
  if (hash === "groups") return "groups";
  if (hash === "settings" || hash.startsWith("settings/")) return "settings";
  return "overview";
}

function tabToHash(tab: Tab): string {
  if (tab === "groups") return "groups";
  if (tab === "settings") return "settings";
  return "ops";
}

function parseInviteToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const joinPrefix = "join_";
  const joinIndex = trimmed.indexOf(joinPrefix);
  if (joinIndex >= 0) return trimmed.slice(joinIndex + joinPrefix.length).split(/[/?#&\s]/)[0];
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  } catch {}
  return trimmed.split(/[/?#&\s]/)[0];
}
