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

Default local URLs:

- API: `http://localhost:5002`
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
  }
}
```

Docker environment variables:

```powershell
$env:API_ADMIN_KEY = "dev-admin-key"
$env:TELEGRAM_BOT_TOKEN = "your-token"
$env:TELEGRAM_WEBHOOK_SECRET = "your-secret"
docker compose up -d --build
```

When running inside Docker, the API uses `mongodb://mongo:27017`. When running with `dotnet run` on Windows/macOS, use `mongodb://localhost:27017`.

## Authentication Headers

Most API endpoints are protected by an admin API key:

```http
X-Api-Key: dev-admin-key
```

Owner-scoped endpoints also require the acting user id:

```http
X-User-Id: admin-1
```

Telegram webhook endpoint is excluded from `X-Api-Key` auth:

```http
POST /api/telegram/webhook
```

## Common API Calls

Create a user:

```http
POST /api/users
X-Api-Key: dev-admin-key
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
X-Api-Key: dev-admin-key
```

Create a group:

```http
POST /api/groups
X-Api-Key: dev-admin-key
X-User-Id: admin-1
Content-Type: application/json

{
  "Name": "Family"
}
```

List groups owned by the acting user:

```http
GET /api/groups
X-Api-Key: dev-admin-key
X-User-Id: admin-1
```

List group members:

```http
GET /api/groups/{groupId}/users
X-Api-Key: dev-admin-key
X-User-Id: admin-1
```

Create an invite:

```http
POST /api/groups/{groupId}/invites
X-Api-Key: dev-admin-key
X-User-Id: admin-1
Content-Type: application/json

{
  "Note": "Telegram invite"
}
```

Resolve an invite:

```http
GET /api/invites/{token}
X-Api-Key: dev-admin-key
```

Accept an invite:

```http
POST /api/invites/{token}/accept
X-Api-Key: dev-admin-key
X-User-Id: user-id-to-add
```

Revoke an invite:

```http
DELETE /api/groups/{groupId}/invites/{inviteId}
X-Api-Key: dev-admin-key
X-User-Id: admin-1
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
$env:API_ADMIN_KEY = "dev-admin-key"
docker compose up -d --build api
```

Open Scalar:

```text
http://localhost:5002/scalar/v1
```

## Notes

- Users, groups, and group memberships use soft delete.
- Existing Mongo records from before soft-delete fields are treated as active.
- User list reads use the native MongoDB driver for performance.
- If `dotnet build` fails because `HeartPulse.exe` is locked, stop the running local API process and build again.
