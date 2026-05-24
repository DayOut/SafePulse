# Small Backend Layer Refactor: User Status Flow

## Summary

Refactor the first high-risk area only: all user status changes. The goal is one DB write path, no status mutation in controllers/hosted services/notifiers, and async
notifications through a background queue.

Default direction:

- Use Mongo Driver repositories, not EF, for the refactored path.
- Add focused repositories only for the status flow.
- Keep UserService responsible for user CRUD/state persistence.
- Add a background user event queue so HTTP/Telegram commands return after DB write, while SignalR/Telegram notifications happen asynchronously.

## Key Changes

### Data Access Layer

- Add focused repository interfaces:
    - IUserRepository: get user, update status, touch online, set language/notifications.
    - IGroupMembershipRepository: get group IDs for user, get members for group.
    - IGroupStatusRequestRepository: create status request, read latest/rate-limit data.
- Implement these with Mongo Driver collections in a Repositories/Mongo layer.
- Stop injecting IMongoDatabase directly into controllers/status services for refactored flows.
- Keep existing EF/Mongo mixed code outside the status path for now; migrate later in smaller commits.

### Status Change Flow

- Add UserStatusService as the only application service used by web, Telegram, fake simulator, and group status-request reset logic to change user statuses.
- UserStatusService.ChangeStatusAsync(userId, status, source, ct):
    - Calls IUserRepository.UpdateStatusAsync.
    - Publishes a UserStatusChangedEvent to the background queue.
    - Returns the updated user immediately.
- Remove or deprecate IUserService.UpdateStatusAsync(AppUser user, ...) so tracked/untracked EF objects cannot silently fail.
- Controllers and command handlers must not build StatusChangedDto directly.

### Background Events And Notifications

- Add an in-process queue:
    - IUserEventQueue.EnqueueAsync(UserChangedEvent event, ct)
    - UserEventWorker : BackgroundService
- Add focused event handlers:
    - SignalRUserNotifier: sends statusChanged to all user groups.
    - TelegramUserNotifier: updates Telegram group status messages.
- HTTP/API status updates return after DB write and event enqueue.
- Telegram commands return after DB write and event enqueue.
- Notification failures are logged but do not fail the original request.

### Group Status Requests

- POST /api/groups/{id}/status-requests keeps current fast-response behavior.
- Background side effect should call UserStatusService.ChangeStatusAsync(..., UserStatus.Unknown, source: StatusRequestReset) for each safe member.
- No direct status writes inside GroupsController.

- Replace direct _users.FindOneAndUpdateAsync(... Status ...) with UserStatusService.ChangeStatusAsync.
- Keep seeding fake users/groups in the simulator for now, but isolate future cleanup behind repositories later.

- Add event model:
    - UserStatusChangedEvent
    - Web
    - Telegram
    - StatusRequestReset
    - FakeSimulator
- Add repository interfaces under a clear namespace like HeartPulse.Repositories.Interfaces.
- Register repositories, UserStatusService, queue, worker, and notifiers in DI.

## Test Plan

- Build: dotnet build.
- Web status change:
    - User changes status from UI.
    - API returns quickly after DB write.
    - Second browser receives SignalR update without reload.
- Telegram status change:
    - /safe, /help, /shelter, and keyboard buttons update DB.
    - Web UI receives realtime update.
    - Telegram status message updates asynchronously.
- Group status request:
    - Request returns quickly.
    - Safe members become Unknown through UserStatusService.
    - Web receives one statusChanged per changed user.
- Fake simulator:
    - Fake user changes still appear in web realtime.
- Regression:
    - No controller/service outside repositories directly calls GetCollection<AppUser>("users") to change Status.

## Assumptions

- First refactor intentionally targets status flow only; full repository migration for auth, invites, Telegram linking, and group CRUD comes later.
- The background queue is in-process only. If the app restarts, queued notifications may be lost, but DB status changes are already saved.
- No Mongo schema migration is required.
- Existing API contracts stay the same.

