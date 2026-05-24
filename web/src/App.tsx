import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  CheckCircle2,
  Copy,
  DoorOpen,
  Link,
  LogOut,
  Plus,
  RefreshCw,
  Save,
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
  GroupStatusRequestedDto,
  GroupMemberDto,
  MyGroupDto,
  StatusChangedDto,
  UserDto,
  UserStatus,
  acceptInvite,
  addGroupMember,
  createGroup,
  createInvite,
  createTelegramLinkCode,
  deleteGroup,
  disconnectTelegram,
  getAppConfig,
  getCurrentUser,
  getMyGroups,
  getTelegramLinkStatus,
  loginWithPassword,
  logout,
  registerWithPassword,
  refreshSession,
  removeGroupMember,
  requestGroupStatusUpdate,
  resolveInvite,
  updateGroupMemberRole,
  updateLanguage,
  updateStatus,
} from "./api";
import { createStatusConnection } from "./signalr";
import { loadSettings, saveSettings } from "./settings";

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

// ── App ────────────────────────────────────────────────────────────
export default function App() {
  const queryClient = useQueryClient();
  const initialGroupId = useMemo(() => readInitialGroupId(), []);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [draftSettings, setDraftSettings] = useState<AppSettings>(() => loadSettings());
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
  const [activeTab, setActiveTab] = useState<Tab>(initialGroupId ? "groups" : "overview");
  const [requestedGroupId, setRequestedGroupId] = useState<string | null>(initialGroupId);
  const [connectionState, setConnectionState] = useState("Disconnected");
  const [statusRequest, setStatusRequest] = useState<GroupStatusRequestedDto | null>(null);
  const [statusChangedMessage, setStatusChangedMessage] = useState<string | null>(null);
  const [recentStatusChanges, setRecentStatusChanges] = useState<StatusChangedDto[]>([]);
  const statusConnectionRef = useRef<HubConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    refreshSession(settings)
      .then((nextSession) => { if (!cancelled) setSession(nextSession); })
      .catch(() => { if (!cancelled) setSession(null); })
      .finally(() => { if (!cancelled) setAuthChecked(true); });
    return () => { cancelled = true; };
  }, [settings]);

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

  const passwordLoginMutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      loginWithPassword(settings, payload.email, payload.password),
    onSuccess: (nextSession) => {
      setSession(nextSession);
      void queryClient.invalidateQueries();
    },
  });

  const registerMutation = useMutation({
    mutationFn: (payload: { email: string; userName: string; password: string }) =>
      registerWithPassword(settings, payload.email, payload.userName, payload.password),
    onSuccess: (nextSession) => {
      setSession(nextSession);
      void queryClient.invalidateQueries();
    },
  });


  const logoutMutation = useMutation({
    mutationFn: () => logout(settings),
    onSettled: () => {
      setSession(null);
      queryClient.clear();
    },
  });

  useEffect(() => {
    if (!session) return;
    let isCancelled = false;
    let reconnectTimer: number | undefined;
    const connection = createStatusConnection(
      settings,
      session.AccessToken,
      (rawMessage) => {
        const message = normalizeStatusChanged(rawMessage);
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

  function persistSettings(event: FormEvent) {
    event.preventDefault();
    const normalized = {
      apiBaseUrl: draftSettings.apiBaseUrl.replace(/\/$/, ""),
      devUserId: draftSettings.devUserId.trim(),
      devUserName: draftSettings.devUserName.trim(),
      overviewBlockSize: draftSettings.overviewBlockSize,
    };
    saveSettings(normalized);
    setSettings(normalized);
    setSession(null);
    void queryClient.invalidateQueries();
  }

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
        draftSettings={draftSettings}
        setDraftSettings={setDraftSettings}
        onSubmitSettings={persistSettings}
        onLogin={(payload) => passwordLoginMutation.mutate(payload)}
        onRegister={(payload) => registerMutation.mutate(payload)}
        error={passwordLoginMutation.error?.message ?? registerMutation.error?.message}
        isLoading={passwordLoginMutation.isPending || registerMutation.isPending}
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
              <button className="sp-icon-btn" onClick={() => logoutMutation.mutate()} title="Logout" type="button">
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
              onJoined={async () => {
                if (statusConnectionRef.current?.state === "Connected")
                  await statusConnectionRef.current.invoke("JoinUserGroups");
              }}
            />
          )}
          {activeTab === "settings" && (
            <SettingsPage
              draftSettings={draftSettings}
              setDraftSettings={setDraftSettings}
              settings={settings}
              accessToken={session.AccessToken}
              currentUser={currentUser.data ?? session.User}
              onSubmit={persistSettings}
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
      </main>
    </LanguageContext.Provider>
  );
}

// ── Login page ──────────────────────────────────────────────────────
function LoginPage({
  draftSettings,
  setDraftSettings,
  onSubmitSettings,
  onLogin,
  onRegister,
  error,
  isLoading,
}: {
  draftSettings: AppSettings;
  setDraftSettings: (s: AppSettings) => void;
  onSubmitSettings: (e: FormEvent) => void;
  onLogin: (p: { email: string; password: string }) => void;
  onRegister: (p: { email: string; userName: string; password: string }) => void;
  error?: string;
  isLoading: boolean;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  function submitAuth(event: FormEvent) {
    event.preventDefault();
    if (mode === "login") { onLogin({ email, password }); return; }
    onRegister({ email, userName, password });
  }

  return (
    <div className="sp-login-wrap">
      <div className="sp-login-panel">
        {/* Brand */}
        <div className="sp-login-brand">
          <span className="sp-login-logo sp-brackets">
            <span style={{ width: 18, height: 18, background: "var(--sp-safe)" }} className="sp-pulse" />
          </span>
          <div className="sp-login-title">
            <h1>SafePulse</h1>
            <p>Volunteer · safety · network</p>
          </div>
        </div>

        {/* Auth form */}
        <div className="sp-auth-tabs">
          <button className={`sp-auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => setMode("login")} type="button">Login</button>
          <button className={`sp-auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => setMode("register")} type="button">Register</button>
        </div>

        <form style={{ display: "flex", flexDirection: "column", gap: 14 }} onSubmit={submitAuth}>
          <SpField label="EMAIL" type="email" placeholder="you@org.org" value={email}
            onChange={setEmail} icon={<MailIcon />} />
          {mode === "register" && (
            <SpField label="DISPLAY NAME" placeholder="How others see you" value={userName}
              onChange={setUserName} icon={<UserIcon />} sans />
          )}
          <SpField label="PASSWORD" type="password" placeholder="••••••••" value={password}
            onChange={setPassword} icon={<LockIcon />} />
          {mode === "register" && (
            <SpField label="CONFIRM PASSWORD" type="password" placeholder="••••••••" value=""
              onChange={() => {}} icon={<LockIcon />} />
          )}

          <button className="sp-btn-primary" disabled={isLoading} type="submit">
            {isLoading ? "PLEASE WAIT…" : mode === "login" ? "LOGIN" : "CREATE ACCOUNT"}
            <ChevronRight size={14} />
          </button>
        </form>

        {error && <div className="sp-error-box">! {error}</div>}


        {/* API settings */}
        <div>
          <button
            type="button"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            onClick={() => setShowSettings((s) => !s)}
          >
            <span className="sp-mono sp-up" style={{ fontSize: 9, color: "var(--sp-fg-4)", letterSpacing: "0.14em" }}>
              {showSettings ? "▾" : "▸"} API SETTINGS
            </span>
          </button>
          {showSettings && (
            <form style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}
              onSubmit={onSubmitSettings}>
              <SpField label="API URL" placeholder="Same origin" value={draftSettings.apiBaseUrl}
                onChange={(v) => setDraftSettings({ ...draftSettings, apiBaseUrl: v })} />
              <SpField label="DEV USER ID" value={draftSettings.devUserId}
                onChange={(v) => setDraftSettings({ ...draftSettings, devUserId: v })} />
              <SpField label="DEV USER NAME" value={draftSettings.devUserName}
                onChange={(v) => setDraftSettings({ ...draftSettings, devUserName: v })} />
              <button className="sp-field-save-btn" type="submit">
                <Save size={13} /> SAVE SETTINGS
              </button>
            </form>
          )}
        </div>

        {/* Endpoint footer */}
        <div className="sp-login-footer">
          <span className="sp-mono sp-up" style={{ fontSize: 9, color: "var(--sp-fg-3)", letterSpacing: "0.12em" }}>
            ENDPOINT
          </span>
          <span className="sp-mono" style={{ fontSize: 10, color: "var(--sp-fg-2)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--sp-safe)" }} className="sp-pulse" />
            {draftSettings.apiBaseUrl || "same-origin"} · v1
          </span>
        </div>
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
  onJoined,
}: {
  settings: AppSettings;
  accessToken: string;
  currentUserId: string;
  initialSelectedGroupId: string | null;
  openGroupId: string | null;
  onJoined: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const t = useT();
  const [groupName, setGroupName] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialSelectedGroupId);

  useEffect(() => {
    if (openGroupId) setSelectedGroupId(openGroupId);
  }, [openGroupId]);
  const [inviteNote, setInviteNote] = useState("");
  const [latestInvite, setLatestInvite] = useState<string | null>(null);
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
    mutationFn: () => createInvite(settings, accessToken, selectedGroup!.Id, inviteNote),
    onSuccess: (invite) => {
      setInviteNote("");
      setLatestInvite(invite.ApiUrl);
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
    <div className="sp-groups-layout">
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
                <span style={{ fontSize: 13, fontWeight: 600 }}>{group.Name}</span>
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
            inviteNote={inviteNote}
            latestInvite={latestInvite}
            latestStatusRequest={latestStatusRequest}
            members={selectedGroup.Members}
            onInviteNoteChange={setInviteNote}
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
          />
        ) : (
          <div style={{ padding: "20px 24px" }}>
            <p className="sp-mono" style={{ fontSize: 11, color: "var(--sp-fg-3)" }}>Select a group to view its members.</p>
          </div>
        )}
      </div>

      {/* ── Right rail (desktop only) ──────────────────────────────── */}
      <div className="sp-groups-right-rail">
        {selectedGroup && (
          <GroupRightRail
            group={selectedGroup}
            canManage={selectedGroup.OwnerId === currentUserId}
            members={selectedGroup.Members}
            inviteNote={inviteNote}
            latestInvite={latestInvite}
            isCreatingInvite={createInviteMutation.isPending}
            createInviteError={createInviteMutation.error?.message}
            onInviteNoteChange={setInviteNote}
            onCreateInvite={() => createInviteMutation.mutate()}
            onAddMember={(userId) => addMemberMutation.mutate(userId)}
            onDeleteGroup={selectedGroup.OwnerId === currentUserId ? () => setDeleteTarget(selectedGroup) : undefined}
          />
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

// ── Group details ──────────────────────────────────────────────────
function GroupDetails({
  group,
  canManage,
  members,
  inviteNote,
  latestInvite,
  latestStatusRequest,
  isCreatingInvite,
  onInviteNoteChange,
  onCreateInvite,
  onRequestStatus,
  requestStatusError,
  isRequestingStatus,
  onRemoveMember,
  onUpdateRole,
  onAddMember: _onAddMember,
  onDeleteGroup,
  memberActionError,
}: {
  group: MyGroupDto;
  canManage: boolean;
  members: GroupMemberDto[];
  inviteNote: string;
  latestInvite: string | null;
  latestStatusRequest: string | null;
  isCreatingInvite: boolean;
  onInviteNoteChange: (v: string) => void;
  onCreateInvite: () => void;
  onRequestStatus: () => void;
  requestStatusError?: string;
  isRequestingStatus: boolean;
  onRemoveMember: (userId: string) => void;
  onUpdateRole: (userId: string, role: "Member" | "Admin") => void;
  onAddMember: (userId: string) => void;
  onDeleteGroup?: () => void;
  memberActionError?: string;
}) {
  const t = useT();
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
    <div>
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
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--sp-border)" }}>
            <div className="sp-invite-box">
              <div className="sp-invite-url">{latestInvite}</div>
              <div className="sp-invite-actions">
                <button className="sp-btn-icon" style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => { void navigator.clipboard.writeText(latestInvite); }} type="button">
                  <Copy size={13} />
                  <span className="sp-mono sp-up" style={{ fontSize: 10, letterSpacing: "0.08em", marginLeft: 6 }}>Copy</span>
                </button>
              </div>
            </div>
          </div>
        )}
        {canManage && (
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--sp-border)" }}>
            <div className="sp-input-row">
              <input className="sp-text-input" placeholder="Invite note"
                value={inviteNote} onChange={(e) => onInviteNoteChange(e.target.value)} />
              <button className="sp-btn-icon" disabled={isCreatingInvite} onClick={onCreateInvite} title="Create invite" type="button">
                <Copy size={14} />
              </button>
            </div>
            {/*<div className="sp-input-row" style={{ marginTop: 8 }}>*/}
            {/*  <input className="sp-text-input" placeholder="User ID to add"*/}
            {/*    value={memberId} onChange={(e) => setMemberId(e.target.value)} />*/}
            {/*  <button className="sp-btn-icon" disabled={!memberId.trim()}*/}
            {/*    onClick={() => { onAddMember(memberId.trim()); setMemberId(""); }} title="Add user" type="button">*/}
            {/*    <Plus size={14} />*/}
            {/*  </button>*/}
            {/*</div>*/}
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
        {/* Search input */}
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
  group, canManage, members, inviteNote, latestInvite, isCreatingInvite, createInviteError,
  onInviteNoteChange, onCreateInvite, onAddMember, onDeleteGroup,
}: {
  group: MyGroupDto;
  canManage: boolean;
  members: GroupMemberDto[];
  inviteNote: string;
  latestInvite: string | null;
  isCreatingInvite: boolean;
  createInviteError?: string;
  onInviteNoteChange: (v: string) => void;
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
                {latestInvite}
              </div>
              <button
                className="sp-btn-secondary"
                style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
                onClick={() => { void navigator.clipboard.writeText(latestInvite); }}
                type="button"
              >
                <Copy size={12} /> {t("rail.copyLink")}
              </button>
            </div>
          )}
          {canManage && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="sp-input-row">
                <input className="sp-text-input" placeholder={t("rail.inviteNotePlaceholder")}
                  value={inviteNote} onChange={(e) => onInviteNoteChange(e.target.value)} />
                <button className="sp-btn-icon" disabled={isCreatingInvite} onClick={onCreateInvite} title="Create invite" type="button">
                  <Copy size={14} />
                </button>
              </div>
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

// ── Settings page ──────────────────────────────────────────────────
function SettingsPage({
  draftSettings,
  setDraftSettings,
  settings,
  accessToken,
  currentUser,
  onSubmit,
  theme,
  onThemeChange,
}: {
  draftSettings: AppSettings;
  setDraftSettings: (s: AppSettings) => void;
  settings: AppSettings;
  accessToken: string;
  currentUser: UserDto;
  onSubmit: (e: FormEvent) => void;
  theme: "dark" | "light";
  onThemeChange: (t: "dark" | "light") => void;
}) {
  const queryClient = useQueryClient();
  const t = useT();
  const lang = useContext(LanguageContext);
  const [activeSection, setActiveSection] = useState("profile");
  const sk = statusKey(currentUser.Status);

  const setLanguage = useMutation({
    mutationFn: (lang: string) => updateLanguage(settings, accessToken, lang),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["current-user"] }),
  });

  const navItems = [
    { id: "profile",      label: t("set.profile"),      icon: <ShieldCheck size={15} /> },
    { id: "connectivity", label: t("set.connectivity"), icon: <RefreshCw size={15} /> },
    { id: "telegram",     label: t("set.telegram"),     icon: <Bell size={15} /> },
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
        <div className="sp-settings-section">
          <div className="sp-settings-section-head">
            <div className="sp-section-head">
              <span className="sp-section-head-label">
                <span className="sp-section-head-code">00</span>{t("set.sectionProfile")}
              </span>
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--sp-border)", padding: "12px 16px", background: "var(--sp-surface)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div className="sp-mono sp-up" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.12em", marginBottom: 8 }}>
                {t("set.interfaceLang")}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["en", "uk"] as const).map((lang) => {
                  const active = (currentUser.Language || "en") === lang;
                  return (
                    <button
                      key={lang}
                      type="button"
                      className="sp-filter-chip"
                      disabled={setLanguage.isPending}
                      style={active ? { background: "var(--sp-fg)", borderColor: "var(--sp-fg)", color: "var(--sp-bg)" } : {}}
                      onClick={() => { if (!active) setLanguage.mutate(lang); }}
                    >
                      {lang === "en" ? t("set.langEn") : t("set.langUk")}
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
        </div>

        {/* Connectivity */}
        <div className="sp-settings-section">
          <div className="sp-settings-section-head">
            <div className="sp-section-head">
              <span className="sp-section-head-label">
                <span className="sp-section-head-code">01</span>{t("set.sectionConn")}
              </span>
            </div>
          </div>
          <form className="sp-settings-form" onSubmit={onSubmit}
            style={{ borderTop: "1px solid var(--sp-border)", background: "var(--sp-surface)" }}>
            <SpField label={t("set.apiUrl")} placeholder="Same origin"
              value={draftSettings.apiBaseUrl}
              onChange={(v) => setDraftSettings({ ...draftSettings, apiBaseUrl: v })} />
            <SpField label={t("set.devUserId")} value={draftSettings.devUserId}
              onChange={(v) => setDraftSettings({ ...draftSettings, devUserId: v })} />
            <SpField label={t("set.devUserName")} value={draftSettings.devUserName}
              onChange={(v) => setDraftSettings({ ...draftSettings, devUserName: v })} />
            <div>
              <div className="sp-mono sp-up" style={{ fontSize: 10, color: "var(--sp-fg-3)", letterSpacing: "0.12em", marginBottom: 8 }}>
                {t("set.blockSize")}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["small", "medium", "large"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    className="sp-filter-chip"
                    style={draftSettings.overviewBlockSize === size
                      ? { background: "var(--sp-fg)", borderColor: "var(--sp-fg)", color: "var(--sp-bg)" }
                      : {}}
                    onClick={() => setDraftSettings({ ...draftSettings, overviewBlockSize: size })}
                  >
                    {size === "small" ? t("set.blockSmall") : size === "medium" ? t("set.blockMedium") : t("set.blockLarge")}
                  </button>
                ))}
              </div>
            </div>
            <button className="sp-field-save-btn" type="submit">
              <Save size={13} /> {t("set.save")}
            </button>
          </form>
        </div>

        {/* Telegram */}
        <TelegramLinkPanel settings={settings} accessToken={accessToken} currentUser={currentUser} />

        {/* Appearance */}
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

        {(createCode.error || linkStatus.error || disconnect.error) && (
          <div className="sp-error-box">
            {createCode.error?.message ?? linkStatus.error?.message ?? disconnect.error?.message}
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
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: "6px 0 4px" }}>{preview.data.GroupName}</h3>
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
          Joined {acceptedGroupName}.
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
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  icon?: ReactNode;
  onChange: (v: string) => void;
  sans?: boolean;
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
  return new Date(value).toLocaleString();
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
