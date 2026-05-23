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
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { HubConnection } from "@microsoft/signalr";
import {
  AppSettings,
  AuthSession,
  GroupStatusRequestedDto,
  GroupMemberDto,
  MyGroupDto,
  UserDto,
  UserStatus,
  acceptInvite,
  addGroupMember,
  createGroup,
  createInvite,
  createTelegramLinkCode,
  deleteGroup,
  disconnectTelegram,
  devLogin,
  getCurrentUser,
  getMyGroups,
  getTelegramLinkStatus,
  loginWithPassword,
  logout,
  refreshSession,
  registerWithPassword,
  removeGroupMember,
  requestGroupStatusUpdate,
  resolveInvite,
  updateGroupMemberRole,
  updateStatus,
} from "./api";
import { createStatusConnection } from "./signalr";
import { loadSettings, saveSettings } from "./settings";

type Tab = "overview" | "groups" | "settings";

const statuses: Array<{
  value: UserStatus;
  label: string;
  tone: string;
  icon: typeof CheckCircle2;
}> = [
  { value: "Safe", label: "Safe", tone: "safe", icon: CheckCircle2 },
  { value: "InShelter", label: "In shelter", tone: "shelter", icon: DoorOpen },
  { value: "NeedHelp", label: "Need help", tone: "danger", icon: ShieldAlert },
];

export default function App() {
  const queryClient = useQueryClient();
  const initialGroupId = useMemo(() => readInitialGroupId(), []);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [draftSettings, setDraftSettings] = useState<AppSettings>(() => loadSettings());
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(initialGroupId ? "groups" : "overview");
  const [connectionState, setConnectionState] = useState("Disconnected");
  const [statusRequest, setStatusRequest] = useState<GroupStatusRequestedDto | null>(null);
  const [statusChangedMessage, setStatusChangedMessage] = useState<string | null>(null);
  const statusConnectionRef = useRef<HubConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    refreshSession(settings)
      .then((nextSession) => {
        if (!cancelled)
          setSession(nextSession);
      })
      .catch(() => {
        if (!cancelled)
          setSession(null);
      })
      .finally(() => {
        if (!cancelled)
          setAuthChecked(true);
      });

    return () => {
      cancelled = true;
    };
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
    mutationFn: (status: UserStatus) => updateStatus(settings, session!.AccessToken, session!.User.Id, status),
    onSuccess: (user) => {
      setSession((existing) => existing ? { ...existing, User: user } : existing);
      setStatusChangedMessage(`Status changed to ${formatStatusLabel(user.Status)}.`);
      queryClient.setQueryData(["current-user", settings, session?.AccessToken], user);
      queryClient.setQueryData<MyGroupDto[]>(["my-groups", settings, session?.AccessToken], (groups) =>
        groups?.map((group) => ({
          ...group,
          Members: group.Members.map((member) =>
            member.Id === user.Id
              ? {
                  ...member,
                  UserName: user.UserName,
                  Status: user.Status,
                  LastActiveAt: user.LastActiveAt,
                  LastSeenOnlineAt: user.LastSeenOnlineAt,
                }
              : member,
          ),
        })),
      );
    },
  });

  useEffect(() => {
    if (!statusChangedMessage)
      return;

    const timer = window.setTimeout(() => setStatusChangedMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [statusChangedMessage]);

  const passwordLoginMutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) => loginWithPassword(settings, payload.email, payload.password),
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

  const devLoginMutation = useMutation({
    mutationFn: () => devLogin(settings),
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
    if (!session)
      return;

    let isCancelled = false;
    let reconnectTimer: number | undefined;
    const connection = createStatusConnection(
      settings,
      session.AccessToken,
      (message) => {
        let shouldRefetchGroups = false;
        queryClient.setQueryData<MyGroupDto[]>(["my-groups", settings, session.AccessToken], (groups) =>
          groups?.map((group) => {
            if (!message.GroupIds.includes(group.Id))
              return group;

            var hasMember = group.Members.some((member) => member.Id === message.UserId);
            if (!hasMember)
              shouldRefetchGroups = true;

            return {
                  ...group,
                  Members: group.Members.map((member) =>
                    member.Id === message.UserId
                      ? {
                          ...member,
                          UserName: message.UserName,
                          Status: message.Status,
                          LastActiveAt: message.LastActiveAt,
                          LastSeenOnlineAt: message.LastSeenOnlineAt,
                        }
                      : member,
                  ),
                };
          }),
        );
        if (shouldRefetchGroups)
          void queryClient.invalidateQueries({ queryKey: ["my-groups"] });
      },
      (message) => {
        setStatusRequest(message);
        playStatusRequestSignal();
      },
      setConnectionState,
      () => {
        if (isCancelled)
          return;

        reconnectTimer = window.setTimeout(() => {
          void start();
        }, 3000);
      },
    );

    async function start() {
      if (isCancelled || connection.state !== "Disconnected")
        return;

      try {
        setConnectionState("Connecting");
        await connection.start();
        if (isCancelled)
          return;

        await connection.invoke("JoinUserGroups");
        setConnectionState("Connected");
      } catch {
        setConnectionState("Disconnected");
        if (!isCancelled) {
          reconnectTimer = window.setTimeout(() => {
            void start();
          }, 3000);
        }
      }
    }

    void start();
    statusConnectionRef.current = connection;

    return () => {
      isCancelled = true;
      if (reconnectTimer)
        window.clearTimeout(reconnectTimer);
      if (statusConnectionRef.current === connection)
        statusConnectionRef.current = null;
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
    return <Shell><p className="text-sm text-neutral-400">Checking session...</p></Shell>;
  }

  if (!session) {
    return (
      <Shell>
        <LoginPage
          draftSettings={draftSettings}
          setDraftSettings={setDraftSettings}
          onSubmitSettings={persistSettings}
          onLogin={(payload) => passwordLoginMutation.mutate(payload)}
          onRegister={(payload) => registerMutation.mutate(payload)}
          onDevLogin={() => devLoginMutation.mutate()}
          error={passwordLoginMutation.error?.message ?? registerMutation.error?.message ?? devLoginMutation.error?.message}
          isLoading={passwordLoginMutation.isPending || registerMutation.isPending || devLoginMutation.isPending}
        />
      </Shell>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-xl font-semibold tracking-normal">SafePulse</h1>
            <p className="text-sm text-neutral-400">{session.User.UserName}</p>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex rounded-md border border-neutral-800 bg-neutral-900 p-1">
              <TabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")} label="Overview" />
              <TabButton active={activeTab === "groups"} onClick={() => setActiveTab("groups")} label="Groups" />
              <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")} label="Settings" />
            </nav>
            <button className="icon-button" onClick={() => logoutMutation.mutate()} title="Logout" type="button">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="app-content mx-auto grid max-w-7xl gap-4 px-4 py-4">
        {activeTab === "overview" && (
          <OverviewPage
            groups={myGroups.data ?? []}
            isLoading={myGroups.isLoading}
            onRefresh={() => void myGroups.refetch()}
            blockSize={settings.overviewBlockSize}
          />
        )}

        {activeTab === "groups" && (
          <GroupsPage
            settings={settings}
            accessToken={session.AccessToken}
            currentUserId={session.User.Id}
            initialSelectedGroupId={initialGroupId}
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
          />
        )}
      </div>

      <StatusFooter
        activeStatus={currentUser.data?.Status ?? session.User.Status}
        isUpdating={statusMutation.isPending}
        onUpdateStatus={(status) => {
          if (status === "NeedHelp" && !window.confirm("Confirm that you need help?"))
            return;

          statusMutation.mutate(status);
        }}
        error={statusMutation.error?.message ?? currentUser.error?.message}
        connectionState={connectionState}
      />
      {statusRequest && <StatusRequestToast request={statusRequest} onDismiss={() => setStatusRequest(null)} />}
      {statusChangedMessage && <StatusChangedToast message={statusChangedMessage} />}
    </main>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-6 text-neutral-100">
      <div className="mx-auto max-w-xl">{children}</div>
    </main>
  );
}

function LoginPage({
  draftSettings,
  setDraftSettings,
  onSubmitSettings,
  onLogin,
  onRegister,
  onDevLogin,
  error,
  isLoading,
}: {
  draftSettings: AppSettings;
  setDraftSettings: (settings: AppSettings) => void;
  onSubmitSettings: (event: FormEvent) => void;
  onLogin: (payload: { email: string; password: string }) => void;
  onRegister: (payload: { email: string; userName: string; password: string }) => void;
  onDevLogin: () => void;
  error?: string;
  isLoading: boolean;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");

  function submitAuth(event: FormEvent) {
    event.preventDefault();
    if (mode === "login") {
      onLogin({ email, password });
      return;
    }

    onRegister({ email, userName, password });
  }

  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
      <h1 className="text-2xl font-semibold">SafePulse</h1>
      <p className="mt-1 text-sm text-neutral-400">Sign in with email and password to use the web MVP.</p>
      <div className="mt-5 flex rounded-md border border-neutral-800 bg-neutral-950 p-1">
        <button className={`tab-button flex-1 ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")} type="button">
          Login
        </button>
        <button className={`tab-button flex-1 ${mode === "register" ? "active" : ""}`} onClick={() => setMode("register")} type="button">
          Register
        </button>
      </div>
      <form className="mt-4 grid gap-3" onSubmit={submitAuth}>
        <label className="label">
          Email
          <input className="field" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>
        {mode === "register" && (
          <label className="label">
            Display name
            <input className="field" onChange={(event) => setUserName(event.target.value)} value={userName} />
          </label>
        )}
        <label className="label">
          Password
          <input className="field" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        <button className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950" disabled={isLoading} type="submit">
          {isLoading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>
      </form>
      <button className="mt-4 rounded-md border border-neutral-700 px-3 py-2 text-sm" disabled={isLoading} onClick={onDevLogin} type="button">
        Development login
      </button>
      {error && <p className="mt-3 rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-100">{error}</p>}

      <form className="mt-6 grid gap-3 border-t border-neutral-800 pt-4" onSubmit={onSubmitSettings}>
        <SettingsFields draftSettings={draftSettings} setDraftSettings={setDraftSettings} />
        <button className="inline-flex w-fit items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950" type="submit">
          <Save className="h-4 w-4" />
          Save settings
        </button>
      </form>
    </section>
  );
}

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
    <div>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submitPreview}>
        <input
          className="field"
          onChange={(event) => setRawInvite(event.target.value)}
          placeholder="Paste invite token or invite URL"
          value={rawInvite}
        />
        <button className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950" type="submit">
          Preview
        </button>
      </form>
      {token && <p className="mt-2 break-all text-xs text-neutral-500">Token: {token}</p>}
      {preview.isFetching && <p className="mt-4 text-sm text-neutral-400">Checking invite...</p>}
      {preview.error && <p className="mt-4 rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-100">{preview.error.message}</p>}
      {preview.data && (
        <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-sm text-neutral-400">Group</p>
          <h3 className="mt-1 text-xl font-semibold">{preview.data.GroupName}</h3>
          <p className="mt-1 break-all text-xs text-neutral-500">{preview.data.GroupId}</p>
          {preview.data.IsRevoked ? (
            <p className="mt-4 rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-100">This invite was revoked.</p>
          ) : (
            <button
              className="mt-4 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950"
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
              type="button"
            >
              Join group
            </button>
          )}
        </div>
      )}
      {acceptMutation.error && <p className="mt-4 rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-100">{acceptMutation.error.message}</p>}
      {acceptedGroupName && <p className="mt-4 rounded-md border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">Joined {acceptedGroupName}. Open Overview to see it in your groups.</p>}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel" aria-modal="true" role="dialog" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function parseInviteToken(value: string) {
  var trimmed = value.trim();
  if (!trimmed)
    return "";

  var joinPrefix = "join_";
  var joinIndex = trimmed.indexOf(joinPrefix);
  if (joinIndex >= 0)
    return trimmed.slice(joinIndex + joinPrefix.length).split(/[/?#&\s]/)[0];

  try {
    var url = new URL(trimmed);
    var parts = url.pathname.split('/').filter(Boolean);
    if (parts.length > 0)
      return parts[parts.length - 1];
  } catch {
  }

  return trimmed.split(/[/?#&\s]/)[0];
}

function StatusFooter({
  activeStatus,
  isUpdating,
  onUpdateStatus,
  error,
  connectionState,
}: {
  activeStatus: UserStatus;
  isUpdating: boolean;
  onUpdateStatus: (status: UserStatus) => void;
  error?: string;
  connectionState: string;
}) {
  const connectionTone = connectionState.toLowerCase();
  return (
    <footer className="status-footer">
      <div className="status-footer-meta">
        <span className={`connection-state ${connectionTone}`}>{connectionState}</span>
        {error && <span className="status-footer-error">{error}</span>}
      </div>
      <div className="status-grid">
        {statuses.map((status) => {
          const Icon = status.icon;
          const isActive = activeStatus === status.value;
          return (
            <button
              className={`status-button ${status.tone} ${isActive ? "is-active" : ""}`}
              disabled={isUpdating}
              key={status.value}
              onClick={() => onUpdateStatus(status.value)}
              type="button"
            >
              <Icon className="h-8 w-8 shrink-0" />
              <span>{status.label}</span>
            </button>
          );
        })}
      </div>
    </footer>
  );
}

function OverviewPage({
  groups,
  isLoading,
  onRefresh,
  blockSize,
}: {
  groups: MyGroupDto[];
  isLoading: boolean;
  onRefresh: () => void;
  blockSize: AppSettings["overviewBlockSize"];
}) {
  var totals = { Unknown: 0, Safe: 0, NeedHelp: 0, InShelter: 0 } as Record<UserStatus, number>;
  var countedUserIds = new Set<string>();
  for (var group of groups) {
    for (var member of group.Members) {
      if (countedUserIds.has(member.Id))
        continue;

      countedUserIds.add(member.Id);
      totals[member.Status] = (totals[member.Status] ?? 0) + 1;
    }
  }

  return (
    <section className="min-w-0 lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <OverviewLegend label="Safe" status="Safe" value={totals.Safe} />
          <OverviewLegend label="Shelter" status="InShelter" value={totals.InShelter} />
          <OverviewLegend label="Help" status="NeedHelp" value={totals.NeedHelp} />
          <OverviewLegend label="Unknown" status="Unknown" value={totals.Unknown} />
        </div>
        <button className="icon-button" onClick={onRefresh} title="Refresh overview" type="button">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      {isLoading && <p className="text-sm text-neutral-400">Loading overview...</p>}
      {!isLoading && groups.length === 0 && <p className="text-sm text-neutral-400">No groups for this user yet.</p>}
      <div className={`overview-groups overview-size-${blockSize}`}>
        {groups.map((group) => (
          <section className="overview-group" key={group.Id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="truncate text-sm font-semibold">{group.Name}</h2>
              <span className="text-xs text-neutral-500">{group.Members.length}</span>
            </div>
            <div className="status-tile-grid">
              {group.Members.map((member) => (
                <span
                  aria-label={`${member.UserName || member.Id}: ${member.Status}`}
                  className={`status-tile ${member.Status.toLowerCase()}`}
                  key={member.Id}
                  title={`${member.UserName || member.Id} - ${member.Status}`}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function OverviewLegend({ label, status, value }: { label: string; status: UserStatus; value: number }) {
  return (
    <span className="overview-legend">
      <span className={`status-tile ${status.toLowerCase()}`} />
      {label}: {value}
    </span>
  );
}

function GroupsPage({
  settings,
  accessToken,
  currentUserId,
  initialSelectedGroupId,
  onJoined,
}: {
  settings: AppSettings;
  accessToken: string;
  currentUserId: string;
  initialSelectedGroupId: string | null;
  onJoined: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [groupName, setGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialSelectedGroupId);
  const [inviteNote, setInviteNote] = useState("");
  const [latestInvite, setLatestInvite] = useState<string | null>(null);
  const [latestStatusRequest, setLatestStatusRequest] = useState<string | null>(null);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setJoinModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MyGroupDto | null>(null);

  const groups = useQuery({
    queryKey: ["my-groups", settings, accessToken],
    queryFn: () => getMyGroups(settings, accessToken),
  });

  useEffect(() => {
    if (initialSelectedGroupId)
      setSelectedGroupId(initialSelectedGroupId);
  }, [initialSelectedGroupId]);

  const selectedGroup = useMemo(
    () => groups.data?.find((group) => group.Id === selectedGroupId) ?? groups.data?.[0],
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
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeGroupMember(settings, accessToken, selectedGroup!.Id, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-groups"] });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: (payload: { userId: string; role: "Member" | "Admin" }) =>
      updateGroupMemberRole(settings, accessToken, selectedGroup!.Id, payload.userId, payload.role),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-groups"] });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => addGroupMember(settings, accessToken, selectedGroup!.Id, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-groups"] });
    },
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
    if (groupName.trim())
      createGroupMutation.mutate();
  }

  return (
    <section className="grid min-w-0 gap-4 lg:col-span-2 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-300">Groups</h2>
          <div className="flex gap-2">
            <button className="icon-button strong" onClick={() => setCreateModalOpen(true)} title="Create group" type="button">
            <Plus className="h-4 w-4" />
            </button>
            <button className="icon-button" onClick={() => setJoinModalOpen(true)} title="Join group by invite" type="button">
              <Link className="h-4 w-4" />
            </button>
          </div>
        </div>
        {createGroupMutation.error && <p className="mt-2 text-sm text-red-300">{createGroupMutation.error.message}</p>}
        <div className="group-button-list mt-4">
          {(groups.data ?? []).map((group) => (
            <button
              className={`list-button ${group.Id === selectedGroup?.Id ? "selected" : ""}`}
              key={group.Id}
              onClick={() => setSelectedGroupId(group.Id)}
              type="button"
            >
              <span className="block truncate">{group.Name}</span>
              {group.OwnerId !== currentUserId && <span className="mt-1 block text-xs text-neutral-500">Joined group</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
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
          <p className="text-sm text-neutral-400">Create or select a group.</p>
        )}
      </div>

      {isCreateModalOpen && (
        <Modal title="Create group" onClose={() => setCreateModalOpen(false)}>
          <form className="grid gap-3" onSubmit={submitGroup}>
            <label className="label">
              Group name
              <input className="field" autoFocus onChange={(event) => setGroupName(event.target.value)} placeholder="New group name" value={groupName} />
            </label>
            <button className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950" disabled={createGroupMutation.isPending} type="submit">
              Create group
            </button>
          </form>
        </Modal>
      )}

      {isJoinModalOpen && (
        <Modal title="Join group" onClose={() => setJoinModalOpen(false)}>
          <JoinGroupForm
            settings={settings}
            accessToken={accessToken}
            onJoined={async () => {
              await onJoined();
              await queryClient.invalidateQueries({ queryKey: ["my-groups"] });
            }}
          />
        </Modal>
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
    </section>
  );
}

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
  onAddMember,
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
  onInviteNoteChange: (value: string) => void;
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
  const [statusFilter, setStatusFilter] = useState<UserStatus | "All">("All");
  const [memberId, setMemberId] = useState("");
  const filteredMembers = useMemo(() => {
    return [...members]
      .filter((member) => statusFilter === "All" || member.Status === statusFilter)
      .sort((left, right) => {
        const statusCompare = statusFilter === "All" ? 0 : statusOrder(left.Status) - statusOrder(right.Status);
        if (statusCompare !== 0)
          return statusCompare;

        return new Date(right.LastActiveAt).getTime() - new Date(left.LastActiveAt).getTime();
      });
  }, [members, statusFilter]);

  return (
    <div>
      <div className="group-detail-header mb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{group.Name}</h2>
            {onDeleteGroup && (
              <button className="icon-button compact danger" onClick={onDeleteGroup} title="Delete group" type="button">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="text-sm text-neutral-400">Owner: {group.OwnerId}</p>
        </div>
        <div className="group-actions">
          <button className="group-action-request" disabled={isRequestingStatus} onClick={onRequestStatus} title="Request status update" type="button">
            <Send className="h-4 w-4" />
            <span>Request status updates</span>
          </button>
          {canManage ? (
            <>
              <div className="group-action-row">
                <input className="field" onChange={(event) => setMemberId(event.target.value)} placeholder="User id" value={memberId} />
                <button
                  className="icon-button"
                  disabled={!memberId.trim()}
                  onClick={() => {
                    onAddMember(memberId.trim());
                    setMemberId("");
                  }}
                  title="Add user"
                  type="button"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="group-action-row">
                <input className="field" onChange={(event) => onInviteNoteChange(event.target.value)} placeholder="Invite note" value={inviteNote} />
                <button className="icon-button strong" disabled={isCreatingInvite} onClick={onCreateInvite} title="Create invite" type="button">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <span className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400">Member</span>
          )}
        </div>
      </div>
      {latestInvite && <p className="mb-4 break-all rounded-md border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm">{latestInvite}</p>}
      {latestStatusRequest && <p className="mb-4 rounded-md border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">{latestStatusRequest}</p>}
      {requestStatusError && <p className="mb-4 rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-100">{requestStatusError}</p>}
      {memberActionError && <p className="mb-4 rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-100">{memberActionError}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        <StatusFilterButton active={statusFilter === "All"} label="All" onClick={() => setStatusFilter("All")} />
        <StatusFilterButton active={statusFilter === "NeedHelp"} label="Help" status="NeedHelp" onClick={() => setStatusFilter("NeedHelp")} />
        <StatusFilterButton active={statusFilter === "InShelter"} label="Shelter" status="InShelter" onClick={() => setStatusFilter("InShelter")} />
        <StatusFilterButton active={statusFilter === "Safe"} label="Safe" status="Safe" onClick={() => setStatusFilter("Safe")} />
        <StatusFilterButton active={statusFilter === "Unknown"} label="Unknown" status="Unknown" onClick={() => setStatusFilter("Unknown")} />
      </div>
      <div className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
        {filteredMembers.map((member) => (
          <MemberRow
            member={member}
            key={member.Id}
            onRemove={member.CanManage ? () => onRemoveMember(member.Id) : undefined}
            onToggleAdmin={canManage && member.Role !== "Owner" ? () => onUpdateRole(member.Id, member.Role === "Admin" ? "Member" : "Admin") : undefined}
          />
        ))}
        {filteredMembers.length === 0 && <p className="px-3 py-4 text-sm text-neutral-400">No users with this status.</p>}
      </div>
    </div>
  );
}

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
    <Modal title="Delete group" onClose={onClose}>
      <div className="grid gap-4">
        <p className="text-sm text-neutral-300">
          This will delete the group, remove active memberships, and revoke active invites.
        </p>
        <label className="label">
          Type <span className="font-mono text-neutral-100">{group.Name}</span> to confirm
          <input className="field" autoFocus onChange={(event) => setConfirmation(event.target.value)} value={confirmation} />
        </label>
        {error && <p className="rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-100">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className="rounded-md border border-neutral-700 px-3 py-2 text-sm" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canDelete || isDeleting}
            onClick={onConfirm}
            type="button"
          >
            {isDeleting ? "Deleting..." : "Delete group"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function statusOrder(status: UserStatus) {
  switch (status) {
    case "NeedHelp":
      return 0;
    case "InShelter":
      return 1;
    case "Safe":
      return 2;
    case "Unknown":
      return 3;
  }
}

function StatusFilterButton({
  active,
  label,
  status,
  onClick,
}: {
  active: boolean;
  label: string;
  status?: UserStatus;
  onClick: () => void;
}) {
  return (
    <button className={`status-filter-button ${active ? "active" : ""} ${status ? status.toLowerCase() : ""}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function SettingsPage({
  draftSettings,
  setDraftSettings,
  settings,
  accessToken,
  currentUser,
  onSubmit,
}: {
  draftSettings: AppSettings;
  setDraftSettings: (settings: AppSettings) => void;
  settings: AppSettings;
  accessToken: string;
  currentUser: UserDto;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <section className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900 p-4 lg:col-span-2">
      <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
        <SettingsFields draftSettings={draftSettings} setDraftSettings={setDraftSettings} />
        <button className="mt-1 inline-flex w-fit items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950" type="submit">
          <Save className="h-4 w-4" />
          Save
        </button>
      </form>
      <TelegramLinkPanel settings={settings} accessToken={accessToken} currentUser={currentUser} />
    </section>
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
  const [codeId, setCodeId] = useState<string | null>(null);

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
    if (!linkStatus.data?.IsConsumed)
      return;

    void queryClient.invalidateQueries({ queryKey: ["current-user"] });
  }, [linkStatus.data?.IsConsumed, queryClient]);

  return (
    <section className="mt-6 max-w-xl border-t border-neutral-800 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-300">Telegram</h2>
          <p className="text-xs text-neutral-500">{currentUser.ChatId ? "Connected" : "Not connected"}</p>
        </div>
        <button className="rounded-md border border-neutral-700 px-3 py-2 text-sm" disabled={createCode.isPending} onClick={() => createCode.mutate()} type="button">
          Create link code
        </button>
      </div>
      {currentUser.ChatId && (
        <button
          className="mb-3 rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disconnect.isPending}
          onClick={() => {
            if (window.confirm("Disconnect Telegram from this web account?"))
              disconnect.mutate();
          }}
          type="button"
        >
          {disconnect.isPending ? "Disconnecting..." : "Disconnect Telegram"}
        </button>
      )}
      {createCode.data && (
        <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
          <p className="text-xs text-neutral-500">Send this command to the bot</p>
          <p className="mt-1 font-mono text-lg">/link {createCode.data.Code}</p>
          <p className="mt-2 text-xs text-neutral-500">Expires: {formatDateTime(createCode.data.ExpiresAt)}</p>
          {linkStatus.data?.IsConsumed && <p className="mt-2 text-sm text-emerald-300">Telegram account connected.</p>}
          {linkStatus.data?.IsExpired && !linkStatus.data.IsConsumed && <p className="mt-2 text-sm text-red-300">This code expired. Create a new one.</p>}
        </div>
      )}
      {(createCode.error || linkStatus.error || disconnect.error) && (
        <p className="mt-3 rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-100">
          {createCode.error?.message ?? linkStatus.error?.message ?? disconnect.error?.message}
        </p>
      )}
    </section>
  );
}

function SettingsFields({
  draftSettings,
  setDraftSettings,
}: {
  draftSettings: AppSettings;
  setDraftSettings: (settings: AppSettings) => void;
}) {
  return (
    <>
      <label className="label">
        API URL
        <input
          className="field"
          onChange={(event) => setDraftSettings({ ...draftSettings, apiBaseUrl: event.target.value })}
          placeholder="Same origin"
          value={draftSettings.apiBaseUrl}
        />
      </label>
      <label className="label">
        Development user id
        <input className="field" onChange={(event) => setDraftSettings({ ...draftSettings, devUserId: event.target.value })} value={draftSettings.devUserId} />
      </label>
      <label className="label">
        Development user name
        <input className="field" onChange={(event) => setDraftSettings({ ...draftSettings, devUserName: event.target.value })} value={draftSettings.devUserName} />
      </label>
      <div className="label">
        Overview block size
        <div className="segmented-control">
          {(["small", "medium", "large"] as const).map((size) => (
            <button
              className={`tab-button ${draftSettings.overviewBlockSize === size ? "active" : ""}`}
              key={size}
              onClick={() => setDraftSettings({ ...draftSettings, overviewBlockSize: size })}
              type="button"
            >
              {size}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function MemberRow({
  member,
  onRemove,
  onToggleAdmin,
}: {
  member: GroupMemberDto;
  onRemove?: () => void;
  onToggleAdmin?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{member.UserName || member.Id}</p>
        <p className="text-xs text-neutral-500">Role: {member.Role || "Member"}</p>
        <p className="text-xs text-neutral-500">Status changed: {formatDateTime(member.LastActiveAt)}</p>
        <p className="text-xs text-neutral-500">Last seen online: {formatDateTime(member.LastSeenOnlineAt)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <StatusBadge status={member.Status} />
        {onToggleAdmin && (
          <button className="icon-button compact" onClick={onToggleAdmin} title={member.Role === "Admin" ? "Make member" : "Make admin"} type="button">
            <ShieldCheck className="h-4 w-4" />
          </button>
        )}
        {onRemove && (
          <button className="icon-button compact danger" onClick={onRemove} title="Remove from group" type="button">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <span className={`status-badge ${status.toLowerCase()}`}>
      <Activity className="h-3 w-3" />
      {status}
    </span>
  );
}

function formatStatusLabel(status: UserStatus) {
  return statuses.find((item) => item.value === status)?.label ?? status;
}

function StatusChangedToast({ message }: { message: string }) {
  return (
    <section className="status-request-toast success">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
      <p className="text-sm font-semibold text-emerald-100">{message}</p>
    </section>
  );
}

function StatusRequestToast({ request, onDismiss }: { request: GroupStatusRequestedDto; onDismiss: () => void }) {
  return (
    <section className="status-request-toast">
      <Bell className="h-5 w-5 shrink-0 text-yellow-300" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{request.GroupName}</p>
        <p className="text-xs text-neutral-300">{request.RequestedByUserName} requested status updates</p>
      </div>
      <button className="icon-button compact" onClick={onDismiss} title="Dismiss" type="button">
        <X className="h-4 w-4" />
      </button>
    </section>
  );
}

function playStatusRequestSignal() {
  if ("vibrate" in navigator)
    navigator.vibrate?.(180);

  try {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor)
      return;

    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  } catch {
  }
}

function readInitialGroupId() {
  if (typeof window === "undefined")
    return null;

  return new URLSearchParams(window.location.search).get("groupId");
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`tab-button ${active ? "active" : ""}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}
