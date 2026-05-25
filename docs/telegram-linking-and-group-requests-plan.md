# Telegram Linking, Group Status Requests, Group Management, and Overview Settings

## Summary

Implement four connected features:

- Link an authenticated web account to Telegram using a bot link code.
- Merge Telegram-created account data into the current web account, keeping the web account ID.
- Add group-wide "request status update" with web + Telegram notifications and a 1-per-minute per-group rate limit.
- Improve group management and overview personalization: owner/admin add-remove users, and local overview block-size setting.

## Key Changes

### Telegram Account Linking And Merge

- Add a Telegram link-code flow:
  - Authenticated web user clicks `Connect Telegram` in Settings.
  - Backend creates a short one-time code with 10-minute expiry.
  - UI shows code and bot instruction: send `/link CODE` to Telegram bot.
  - Telegram bot handler validates the code and links the Telegram sender to the web account.
- Add a persistent link-code collection, for example `telegramLinkCodes`:
  - `Id`, `CodeHash`, `UserId`, `CreatedAt`, `ExpiresAt`, `ConsumedAt`.
  - Code is stored hashed, never plain text.
- Extend `AppUser`:
  - Add `TelegramUserId` string nullable.
  - Keep existing `ChatId` nullable.
- Merge policy:
  - Web user ID survives.
  - Copy Telegram `ChatId` and `TelegramUserId` to web user.
  - Move Telegram user group memberships to web user.
  - Transfer Telegram-owned groups by replacing `Group.OwnerId` with web user ID.
  - Transfer created invites from Telegram user ID to web user ID.
  - Deduplicate memberships when both accounts are already in the same group.
  - Preserve web email/password and web username.
  - Use freshest `LastActiveAt` status data between both accounts.
  - Use newest `LastSeenOnlineAt`.
  - Union roles.
  - Soft-delete the old Telegram-only user after merge.
- Add API endpoints:
  - `POST /api/auth/telegram-link-codes`
  - `GET /api/auth/telegram-link-status/{codeId}`
  - Telegram bot command `/link CODE`.

### Group Status Update Request

- Add `GroupStatusRequest` model/collection:
  - `Id`, `GroupId`, `RequestedByUserId`, `RequestedByUserName`, `CreatedAt`.
- Add endpoint:
  - `POST /api/groups/{groupId}/status-requests`
- Permissions:
  - Any active member of the group can request a status update for that group.
- Rate limit:
  - One request per group per 60 seconds.
  - If exceeded, return `429 Too Many Requests` with retry-after seconds in response body.
- Notifications:
  - SignalR event: `groupStatusRequested`.
  - Telegram message to linked group members with `ChatId`.
  - Web UI shows a non-blocking banner/toast and plays a short notification sound if browser permits audio.
  - Requester also sees confirmation in web UI.
- Notification text should include:
  - Group name.
  - Requester display name.
  - Time of request.
  - Prompt to update status using web footer buttons or Telegram keyboard.

### Group User Management

- Add group membership role support:
  - Extend `GroupUser` with `Role`, values `Member` and `Admin`.
  - Group owner remains `Group.OwnerId`; owner is always treated as highest permission even if no `GroupUser.Role`.
- Permissions:
  - Owner and admins can add/remove normal members.
  - Owner can promote/demote admins.
  - Admins cannot remove owner, promote admins, demote admins, rename group, delete group, or transfer ownership.
- API changes:
  - Update member DTO to include `Role` and `CanManage`.
  - Add/update endpoints for member role changes.
  - Existing add/remove endpoints should enforce owner/admin permissions.
- UI changes in Groups tab:
  - Show member role next to user.
  - Owner sees promote/demote controls.
  - Owner/admin sees remove-user controls.
  - Add-user flow should accept user ID or invite-based flow; invite remains the preferred path for normal users.

### Overview Block Size Setting

- Add localStorage setting to existing web settings:
  - `overviewBlockSize: "small" | "medium" | "large"`.
  - Default: `medium`.
- Settings page:
  - Add segmented control: Small / Medium / Large.
- Overview page:
  - Apply CSS class based on `overviewBlockSize`.
  - Suggested tile sizes:
    - Small: 8px
    - Medium: 12px
    - Large: 16px
  - Preserve existing group wrapping behavior and hover title with username/status.

## Test Plan

- Telegram linking:
  - Create web user, create link code, send `/link CODE` from Telegram, verify `ChatId` and `TelegramUserId` appear on web user.
  - Link when Telegram user already has groups; verify memberships move to web user and old Telegram user is soft-deleted.
  - Link when both users are in same group; verify only one membership remains.
  - Expired/used/wrong code returns clear Telegram error.
- Status request:
  - Any group member can request status update.
  - Non-member receives `403`.
  - Second request inside 60 seconds returns `429`.
  - Web clients receive `groupStatusRequested` banner.
  - Linked Telegram users receive bot message.
- Group management:
  - Owner can promote/demote admins.
  - Admin can add/remove normal members.
  - Admin cannot remove owner or change roles.
  - Normal member cannot add/remove users.
- Overview setting:
  - Small/Medium/Large persists after refresh.
  - Overview tile size changes without affecting status data or realtime updates.
- Regression:
  - Existing login/register/refresh still work.
  - Existing status update flow still broadcasts `statusChanged`.
  - Existing Telegram `/safe`, `/help`, `/shelter`, `/start join_...` still work.

## Assumptions

- Telegram linking uses bot link code, not Telegram Login Widget.
- Web account identity survives all merges.
- Notifications for status requests go to both web and Telegram.
- Group status request limit is exactly 1 request per 60 seconds per group.
- Group management is owner + group admins.
- Overview block size is a simple Small/Medium/Large local setting.
