# SafePulse Web UI Plan

## Summary

Use a separate **Vite React + TypeScript SPA in `/web`**. This is the easiest frontend to create and support for the current requirements: mobile-first status controls, realtime group status updates, and simple CRUD/admin pages.

Recommended stack:

- **Vite React + TypeScript** for fast SPA development.
- **Tailwind CSS + shadcn/ui** for responsive layout, forms, dialogs, and tables.
- **TanStack Query** for API fetching, caching, loading/error states.
- **SignalR JavaScript client** for realtime status updates from the ASP.NET Core API.

Do not use Next.js for v1; SSR/server routing adds complexity without clear benefit. Do not use Blazor WASM for v1; React will be faster to iterate and easier to pair with existing JavaScript UI libraries.

## Key Changes

- Add frontend project:
  - Create `/web` with Vite React TypeScript.
  - Configure API base URL through `.env`: `VITE_API_BASE_URL=http://localhost:5002`.
  - Store temporary auth values in local storage: `X-Api-Key`, `X-User-Id`.
  - Use React Router with pages: status dashboard, groups, group details, invites, settings.

- Add missing backend support:
  - Add `PATCH /api/users/{userId}/status` for setting `Safe`, `NeedHelp`, or `InShelter`.
  - Add SignalR hub, for example `/hubs/status`.
  - When a user status changes, broadcast to all connected members of that user's groups.
  - Add a "my groups" endpoint or reuse existing group endpoints so the UI can load groups for the acting user, not only owned groups.

- First page: status dashboard:
  - Top area: three large status buttons: `Safe`, `Need Help`, `In Shelter`.
  - On phones, each button should use roughly `30vh` or a three-row layout where the status control area is the dominant first-screen interaction.
  - Below or beside buttons: scrollable group/member status list.
  - Desktop layout: status buttons in a left/top panel, group/member list in remaining space.
  - Show realtime connection state: connected, reconnecting, offline.
  - Optimistically update the current user status, then reconcile with API response.

- Other pages:
  - Groups list: create, rename, delete groups.
  - Group details: view members and statuses, remove members if owner.
  - Invites: create invite, copy Telegram/API invite links, revoke invite.
  - Settings/dev auth: edit API key and acting user id for v1.

## API And Realtime Behavior

- Every API call sends:
  - `X-Api-Key`
  - `X-User-Id` when acting as a user.

- SignalR connection:
  - Connect to `/hubs/status`.
  - Pass auth data during connection using query string or access token factory; for v1, use the same API key/user id model.
  - Client subscribes to status events shaped like:

```ts
{
  groupId: string;
  userId: string;
  userName: string;
  status: "Unknown" | "Safe" | "NeedHelp" | "InShelter";
  lastActiveAt: string;
}
```

  - On event, update TanStack Query cache for affected group member lists.

## Test Plan

- Backend:
  - Build succeeds.
  - Status update endpoint updates `Status` and `LastActiveAt`.
  - Status update broadcasts to connected SignalR clients in the same group.
  - Unauthorized API and hub connections are rejected.

- Frontend:
  - Mobile viewport: three buttons are easy to tap and dominate the screen.
  - Desktop viewport: dashboard remains readable and not oversized.
  - Status button click updates UI and persists to API.
  - Group member status changes appear without page refresh.
  - Reconnect behavior restores group status updates after network interruption.
  - Group and invite pages can create, edit, delete/revoke using current API headers.

## Assumptions

- First UI version keeps temporary auth: `X-Api-Key` + locally stored `X-User-Id`.
- UI is responsive web first, not PWA yet.
- Frontend lives in the same repo under `/web`.
- Telegram bot remains available during transition, but the first UI goal is to replace status-changing behavior.
- Sources used for framework choice:
  - Vite docs: https://vite.dev/guide/
  - SignalR JavaScript client docs: https://learn.microsoft.com/en-us/aspnet/core/signalr/javascript-client
  - TanStack Query docs: https://tanstack.com/query/v5/docs
