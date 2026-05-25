# SafePulse API

SafePulse is an ASP.NET Core API with a Telegram bot integration. It stores users, groups, group memberships, and invite links in MongoDB.

## Requirements

- .NET SDK 9
- Docker Desktop
- MongoDB, usually started through `docker compose`

## Local Setup

Start MongoDB:

```powershell
docker compose up -d mongo
```

Run the API locally:

```powershell
dotnet run --launch-profile http
```

Install and run the web UI:

```powershell
cd web
npm install
npm run dev
```

Default local URLs:

- API: `http://localhost:5002`
- Web UI: `http://localhost:5173`
- Scalar API reference: `http://localhost:5002/scalar/v1`
- OpenAPI JSON: `http://localhost:5002/openapi/v1.json`
- MongoDB: `mongodb://localhost:27017`

The app uses `appsettings.Development.json` for local development. If it is missing, copy `appsettings.Development.json.example` and add Telegram secrets if you need webhook/bot testing.

## Configuration

Local development defaults:

```json
{
  "Mongo": {
    "ConnectionString": "mongodb://localhost:27017",
    "Database": "safepulse"
  },
  "Api": {
    "AdminKey": "dev-admin-key"
  },
  "App": {
    "PublicBaseUrl": "http://localhost:5002"
  },
  "Auth": {
    "Issuer": "SafePulse",
    "Audience": "SafePulse.Web",
    "SigningKey": "dev-only-safe-pulse-signing-key-change-for-production-12345",
    "AccessTokenMinutes": 15,
    "RefreshTokenDays": 30,
    "BootstrapAdminTelegramIds": [
      "admin-1"
    ],
    "BootstrapAdminEmails": [
      "admin@example.com"
    ],
    "EnableDevLogin": true
  }
}
```

Docker environment variables:

```powershell
$env:API_ADMIN_KEY = "dev-admin-key"
$env:APP_PUBLIC_BASE_URL = "https://your-public-domain-or-ngrok-url"
$env:AUTH_SIGNING_KEY = "replace-with-a-long-random-secret"
$env:BOOTSTRAP_ADMIN_TELEGRAM_ID = "your-telegram-user-id"
$env:BOOTSTRAP_ADMIN_EMAIL = "admin@example.com"
$env:TELEGRAM_BOT_TOKEN = "your-token"
$env:TELEGRAM_WEBHOOK_SECRET = "your-secret"
docker compose up -d --build
```

When running inside Docker, the API uses `mongodb://mongo:27017`. When running with `dotnet run` on Windows/macOS, use `mongodb://localhost:27017`.

`App:PublicBaseUrl` is the externally reachable web/backend URL used in Telegram messages. Set it to the same public URL that opens the hosted web UI, for example your ngrok URL or mini-server domain. Large Telegram group updates use this value to link users directly to the group page.

## Authentication

The web UI signs in with email/password and receives an app JWT. API calls use:

```http
Authorization: Bearer {accessToken}
```

The refresh token is stored in an HttpOnly cookie named `safepulse_refresh`. The browser never needs to read it directly.

Register with email/password:

```http
POST /api/auth/register
Content-Type: application/json

{
  "Email": "admin@example.com",
  "UserName": "Admin User",
  "Password": "change-me-123"
}
```

Login with email/password:

```http
POST /api/auth/login
Content-Type: application/json

{
  "Email": "admin@example.com",
  "Password": "change-me-123"
}
```

Local development can use the development login endpoint when `Auth:EnableDevLogin` is `true`:

```http
POST /api/auth/dev
Content-Type: application/json

{
  "UserId": "admin-1",
  "UserName": "Admin User"
}
```

The response contains an access token:

```json
{
  "AccessToken": "...",
  "AccessTokenExpiresAt": "2026-05-22T12:00:00Z",
  "User": {
    "Id": "admin-1",
    "UserName": "Admin User"
  }
}
```

Refresh the session:

```http
POST /api/auth/refresh
Cookie: safepulse_refresh=...
```

Logout:

```http
POST /api/auth/logout
```

Admin endpoints require the `Admin` role claim. In development, emails listed in `Auth:BootstrapAdminEmails` receive `Admin` during register/login.

Telegram webhook endpoint remains anonymous because Telegram calls it directly:

```http
POST /api/telegram/webhook
```

Telegram bot commands and webhook remain separate from web login for the MVP.

## Common API Calls

Create a user:

```http
POST /api/users
Authorization: Bearer {adminAccessToken}
Content-Type: application/json

{
  "Id": "admin-1",
  "UserName": "Admin User",
  "Status": "Unknown"
}
```

List users:

```http
GET /api/users
Authorization: Bearer {adminAccessToken}
```

Change your current status from the web UI:

```http
PATCH /api/users/{userId}/status
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "Status": "Safe"
}
```

Allowed statuses are `Safe`, `InShelter`, `NeedHelp`, and `Unknown`.

List groups where the acting user is a member:

```http
GET /api/me/groups
Authorization: Bearer {accessToken}
```

Create a group:

```http
POST /api/groups
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "Name": "Family"
}
```

List groups owned by the acting user:

```http
GET /api/groups
Authorization: Bearer {accessToken}
```

List group members:

```http
GET /api/groups/{groupId}/users
Authorization: Bearer {accessToken}
```

Create an invite:

```http
POST /api/groups/{groupId}/invites
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "Note": "Telegram invite"
}
```

Resolve an invite:

```http
GET /api/invites/{token}
```

Accept an invite:

```http
POST /api/invites/{token}/accept
Authorization: Bearer {accessToken}
```

Revoke an invite:

```http
DELETE /api/groups/{groupId}/invites/{inviteId}
Authorization: Bearer {accessToken}
```

## Telegram Invite Links

Group invites use opaque tokens:

```text
https://t.me/safe_pulse_test_bot?start=join_{token}
```

The Telegram `/start join_{token}` flow joins the Telegram user to the target group if the invite is valid and not revoked.

The older `/start join_{groupId}` style is still accepted as a fallback for compatibility.

## Useful Commands

Build:

```powershell
dotnet build --no-restore
```

Start MongoDB only:

```powershell
docker compose up -d mongo
```

Start API and MongoDB through Docker:

```powershell
$env:AUTH_SIGNING_KEY = "replace-with-a-long-random-secret"
$env:APP_PUBLIC_BASE_URL = "https://your-public-domain-or-ngrok-url"
$env:BOOTSTRAP_ADMIN_TELEGRAM_ID = "your-telegram-user-id"
$env:BOOTSTRAP_ADMIN_EMAIL = "admin@example.com"
docker compose up -d --build api
```

Open Scalar:

```text
http://localhost:5002/scalar/v1
```

Build the web UI:

```powershell
cd web
npm run build
```

The production web build is written to backend `wwwroot/`. After building the web UI, start the backend and open the backend URL directly:

```powershell
cd ..
dotnet run --launch-profile http
```

```text
http://localhost:5002
```

For ngrok, expose the backend port only:

```powershell
ngrok http 5002
```

Then set `App:PublicBaseUrl` or `APP_PUBLIC_BASE_URL` to the HTTPS forwarding URL printed by ngrok, without a trailing slash:

```powershell
$env:APP_PUBLIC_BASE_URL = "https://abc123.ngrok-free.app"
```

## Web UI

The first web UI lives in `web/` and is a Vite React app. For production/local Docker-style hosting, run `npm run build` and ASP.NET Core serves the generated files from `wwwroot/`.

- The fixed bottom status footer has three large buttons: `Safe`, `In shelter`, and `Need help`.
- On phones the status footer uses roughly 20% of the screen height for fast tapping.
- Overview shows group/member status blocks and unique-user status totals.
- Live status changes arrive through SignalR at `/hubs/status`.
- Groups page can create owned groups, view members, and create invite links.
- Settings page stores API URL and development-login defaults. Keep API URL empty when frontend and backend are served from the same host.

## Notes

- Users, groups, and group memberships use soft delete.
- Existing Mongo records from before soft-delete fields are treated as active.
- User list reads use the native MongoDB driver for performance.
- If `dotnet build` fails because `HeartPulse.exe` is locked, stop the running local API process and build again.
