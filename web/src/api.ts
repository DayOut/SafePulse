export type UserStatus = "Unknown" | "Safe" | "NeedHelp" | "InShelter";

export type AppSettings = {
  apiBaseUrl: string;
  devUserId: string;
  devUserName: string;
  overviewBlockSize: "small" | "medium" | "large";
};

export type AppConfig = {
  TelegramBotUsername: string;
  TelegramBotId: string | null;
  EnableDevLogin: boolean;
  ServerStartTime: number;
};

export type AuthSession = {
  AccessToken: string;
  AccessTokenExpiresAt: string;
  User: UserDto;
};

export type RegistrationPendingResponse = {
  Email: string;
  RequiresEmailVerification: true;
};

export type UserDto = {
  Id: string;
  UserName: string;
  Email?: string | null;
  ChatId: number | null;
  TelegramUserId: string | null;
  Language: string;
  Status: UserStatus;
  LastActiveAt: string;
  LastSeenOnlineAt: string;
  CreatedAt: string;
  UpdatedAt: string;
};

export type GroupMemberDto = {
  Id: string;
  UserName: string;
  Status: UserStatus;
  Role: string;
  CanManage: boolean;
  LastActiveAt: string;
  LastSeenOnlineAt: string;
};

export type MyGroupDto = {
  Id: string;
  Name: string;
  OwnerId: string;
  TelegramInviteLink?: string | null;
  Members: GroupMemberDto[];
};

export type GroupDto = {
  Id: string;
  Name: string;
  OwnerId: string;
  CreatedAt: string;
  UpdatedAt: string;
};

export type InviteDto = {
  Id: string;
  Token: string;
  GroupId: string;
  CreatedByUserId: string;
  Note: string | null;
  CreatedAt: string;
  RevokedAt: string | null;
  TelegramUrl: string;
  ApiUrl: string;
};

export type InvitePreviewDto = {
  Token: string;
  GroupId: string;
  GroupName: string;
  IsRevoked: boolean;
};

export type StatusChangedDto = {
  UserId: string;
  UserName: string;
  Status: UserStatus;
  LastActiveAt: string;
  LastSeenOnlineAt: string;
  GroupIds: string[];
};

export type TelegramLinkCodeDto = {
  Id: string;
  Code: string;
  ExpiresAt: string;
};

export type TelegramLinkStatusDto = {
  Id: string;
  IsConsumed: boolean;
  IsExpired: boolean;
  ExpiresAt: string;
};

export type GroupStatusRequestedDto = {
  Id: string;
  GroupId: string;
  GroupName: string;
  RequestedByUserId: string;
  RequestedByUserName: string;
  CreatedAt: string;
};

async function request<T>(
  settings: AppSettings,
  path: string,
  accessToken: string | null,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (accessToken)
    headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${settings.apiBaseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(`Request timed out while calling ${settings.apiBaseUrl}`);

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  if (response.status === 204)
    return undefined as T;

  return response.json() as Promise<T>;
}

export function registerWithPassword(settings: AppSettings, email: string, userName: string, password: string) {
  return request<RegistrationPendingResponse>(settings, "/api/auth/register", null, {
    method: "POST",
    body: JSON.stringify({
      Email: email,
      UserName: userName,
      Password: password,
    }),
  });
}

export function resendVerificationEmail(settings: AppSettings, email: string) {
  return request<void>(settings, "/api/auth/email-verification/resend", null, {
    method: "POST",
    body: JSON.stringify({ Email: email }),
  });
}

export function loginWithPassword(settings: AppSettings, email: string, password: string) {
  return request<AuthSession>(settings, "/api/auth/login", null, {
    method: "POST",
    body: JSON.stringify({
      Email: email,
      Password: password,
    }),
  });
}

export type TelegramAuthData = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export function loginWithTelegram(settings: AppSettings, data: TelegramAuthData) {
  return request<AuthSession>(settings, "/api/auth/telegram", null, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function devLogin(settings: AppSettings) {
  return request<AuthSession>(settings, "/api/auth/dev", null, {
    method: "POST",
    body: JSON.stringify({
      UserId: settings.devUserId,
      UserName: settings.devUserName,
    }),
  });
}

export function refreshSession(settings: AppSettings) {
  return request<AuthSession>(settings, "/api/auth/refresh", null, {
    method: "POST",
  });
}

export function logout(settings: AppSettings) {
  return request<void>(settings, "/api/auth/logout", null, {
    method: "POST",
  });
}

export function getAppConfig(settings: AppSettings) {
  return request<AppConfig>(settings, "/api/config", null);
}

export function getCurrentUser(settings: AppSettings, accessToken: string) {
  return request<UserDto>(settings, "/api/auth/me", accessToken);
}

export function createTelegramLinkCode(settings: AppSettings, accessToken: string) {
  return request<TelegramLinkCodeDto>(settings, "/api/auth/telegram-link-codes", accessToken, {
    method: "POST",
  });
}

export function getTelegramLinkStatus(settings: AppSettings, accessToken: string, codeId: string) {
  return request<TelegramLinkStatusDto>(settings, `/api/auth/telegram-link-codes/${encodeURIComponent(codeId)}`, accessToken);
}

export function disconnectTelegram(settings: AppSettings, accessToken: string) {
  return request<UserDto>(settings, "/api/auth/telegram-link", accessToken, {
    method: "DELETE",
  });
}

export function setPassword(settings: AppSettings, accessToken: string, email: string, password: string) {
  return request<RegistrationPendingResponse>(settings, "/api/auth/set-password", accessToken, {
    method: "POST",
    body: JSON.stringify({ Email: email, Password: password }),
  });
}

export function changePassword(settings: AppSettings, accessToken: string, currentPassword: string, newPassword: string) {
  return request<void>(settings, "/api/auth/change-password", accessToken, {
    method: "POST",
    body: JSON.stringify({ CurrentPassword: currentPassword, NewPassword: newPassword }),
  });
}

export function updateProfile(settings: AppSettings, accessToken: string, userName: string) {
  return request<UserDto>(settings, "/api/auth/me", accessToken, {
    method: "PATCH",
    body: JSON.stringify({ UserName: userName }),
  });
}

export function updateLanguage(settings: AppSettings, accessToken: string, language: string) {
  return request<UserDto>(settings, "/api/auth/me/language", accessToken, {
    method: "PATCH",
    body: JSON.stringify({ Language: language }),
  });
}

export function updateStatus(settings: AppSettings, accessToken: string, userId: string, status: UserStatus) {
  return request<UserDto>(settings, `/api/users/${encodeURIComponent(userId)}/status`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ Status: status }),
  });
}

export function getMyGroups(settings: AppSettings, accessToken: string) {
  return request<MyGroupDto[]>(settings, "/api/me/groups", accessToken);
}

export function getOwnedGroups(settings: AppSettings, accessToken: string) {
  return request<GroupDto[]>(settings, "/api/groups", accessToken);
}

export function createGroup(settings: AppSettings, accessToken: string, name: string) {
  return request<GroupDto>(settings, "/api/groups", accessToken, {
    method: "POST",
    body: JSON.stringify({ Name: name }),
  });
}

export function deleteGroup(settings: AppSettings, accessToken: string, groupId: string) {
  return request<void>(settings, `/api/groups/${encodeURIComponent(groupId)}`, accessToken, {
    method: "DELETE",
  });
}

export function updateGroup(
  settings: AppSettings,
  accessToken: string,
  groupId: string,
  patch: { TelegramInviteLink?: string | null },
) {
  return request<GroupDto>(settings, `/api/groups/${encodeURIComponent(groupId)}`, accessToken, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function getGroupMembers(settings: AppSettings, accessToken: string, groupId: string) {
  return request<GroupMemberDto[]>(settings, `/api/groups/${encodeURIComponent(groupId)}/users`, accessToken);
}

export function addGroupMember(settings: AppSettings, accessToken: string, groupId: string, userId: string) {
  return request<void>(settings, `/api/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`, accessToken, {
    method: "POST",
  });
}

export function removeGroupMember(settings: AppSettings, accessToken: string, groupId: string, userId: string) {
  return request<void>(settings, `/api/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`, accessToken, {
    method: "DELETE",
  });
}

export function updateGroupMemberRole(settings: AppSettings, accessToken: string, groupId: string, userId: string, role: "Member" | "Admin") {
  return request<void>(settings, `/api/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}/role`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ Role: role }),
  });
}

export function requestGroupStatusUpdate(settings: AppSettings, accessToken: string, groupId: string) {
  return request<GroupStatusRequestedDto>(settings, `/api/groups/${encodeURIComponent(groupId)}/status-requests`, accessToken, {
    method: "POST",
  });
}

export function createInvite(settings: AppSettings, accessToken: string, groupId: string, note: string) {
  return request<InviteDto>(settings, `/api/groups/${encodeURIComponent(groupId)}/invites`, accessToken, {
    method: "POST",
    body: JSON.stringify({ Note: note || null }),
  });
}

export function resolveInvite(settings: AppSettings, token: string) {
  return request<InvitePreviewDto>(settings, `/api/invites/${encodeURIComponent(token)}`, null);
}

export function acceptInvite(settings: AppSettings, accessToken: string, token: string) {
  return request<void>(settings, `/api/invites/${encodeURIComponent(token)}/accept`, accessToken, {
    method: "POST",
  });
}
