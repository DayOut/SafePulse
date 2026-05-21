# SafePulse API Completion Plan

## Summary

Build a web-UI-ready API around the existing Telegram bot domain: users, groups, group memberships, and invite links. Use a pragmatic v1 security model: `X-Api-Key` protects API endpoints, and owner-scoped endpoints also require `X-User-Id` to identify the acting user until real web auth exists.

## Key Changes

- Add API key auth:
  - Configure `Api:AdminKey` in app settings / environment.
  - Require `X-Api-Key` for all non-Telegram API endpoints.
  - Require `X-User-Id` for owner-scoped group operations.
  - Keep `api/telegram/webhook` separate from admin/web API auth.

- Add soft-delete support:
  - Add `IsDeleted`, `CreatedAt`, and `UpdatedAt` to `AppUser`, `Group`, and `GroupUser`.
  - Delete endpoints mark records deleted instead of removing them.
  - Normal list/get/join operations ignore deleted records.

- Add opaque group invites:
  - Add `GroupInvite` model with `Id`, `Token`, `GroupId`, `CreatedByUserId`, `CreatedAt`, `RevokedAt`, optional `Note`.
  - Token is random and non-enumerable.
  - Reusable until revoked; no expiry in v1.
  - Telegram invite format becomes `https://t.me/{bot}?start=join_{token}`.
  - API/web invite format becomes `/api/invites/{token}` for resolving and `/api/invites/{token}/accept` for joining.
  - Preserve backward compatibility by accepting old `join_{groupId}` Telegram payloads only if no invite token matches.

- Complete CRUD endpoints:
  - Users:
    - `POST /api/users`
    - `GET /api/users`
    - `GET /api/users/{id}`
    - `PATCH /api/users/{id}`
    - `DELETE /api/users/{id}`
    - All protected by `X-Api-Key`; list is admin-only.
  - Groups:
    - `POST /api/groups`
    - `GET /api/groups`
    - `GET /api/groups/{id}`
    - `PATCH /api/groups/{id}`
    - `DELETE /api/groups/{id}`
    - Owner-scoped with `X-User-Id`; admin key still required.
  - Group members:
    - `GET /api/groups/{id}/users`
    - `POST /api/groups/{id}/users/{userId}`
    - `DELETE /api/groups/{id}/users/{userId}`
    - Only group owner can manage membership.
  - Invites:
    - `POST /api/groups/{id}/invites`
    - `GET /api/groups/{id}/invites`
    - `DELETE /api/groups/{id}/invites/{inviteId}`
    - `GET /api/invites/{token}`
    - `POST /api/invites/{token}/accept`

## Implementation Notes

- Move current controller stubs into real DTO-based controllers; do not expose Mongo entity classes directly.
- Extend `IUserService` and `IGroupService` instead of putting query logic directly in controllers.
- Fix current join logic while implementing invites: existing `JoinGroupCommandHandler` has inverted group-exists behavior.
- Add Mongo indexes:
  - unique non-deleted user `ChatId` where applicable
  - unique group name among non-deleted groups
  - unique `GroupInvite.Token`
  - unique active membership pair `UserId + GroupId`
- Keep Scalar enabled so all new endpoints appear at `http://localhost:5002/scalar/v1`.

## Test Plan

- Build: `dotnet build --no-restore`.
- API auth tests:
  - Missing `X-Api-Key` returns `401`.
  - Invalid `X-Api-Key` returns `401`.
  - Missing `X-User-Id` on owner-scoped endpoint returns `401` or `403`.
- Users:
  - Admin can create, list, get, patch, and soft-delete users.
  - Deleted users disappear from normal list/get behavior.
- Groups:
  - Owner can create, update, delete, and list their groups.
  - Non-owner cannot mutate another owner’s group.
  - Group users endpoint returns users with latest status and activity time.
- Invites:
  - Owner can create reusable invite token.
  - Telegram `/start join_{token}` joins the user to the group.
  - API invite resolve returns group preview data.
  - API invite accept adds the acting user to the group once.
  - Revoked invite cannot be accepted.
- Regression:
  - Existing Telegram `/create`, `/start`, `/safe`, `/help`, `/shelter` flows still work.

## Assumptions

- v1 does not implement JWT/login yet.
- `X-Api-Key` is acceptable for early protected API access.
- `X-User-Id` is trusted only because the API key protects the caller.
- Deletes are soft deletes.
- Invite tokens are reusable and revocable, with no expiration by default.
