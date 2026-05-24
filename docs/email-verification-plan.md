# Email Verification During Registration

## Summary

Add email verification for password registration. New users cannot log in until their email is verified. Registration sends an SMTP email with a verification link valid for 7 days. Clicking the link verifies the account, sets the refresh cookie, redirects to the web UI, and the frontend auto-loads the session through the existing refresh flow.

## Key Changes

- Add nullable verification fields to `AppUser`: `EmailVerifiedAt` and optionally `EmailVerificationLastSentAt`; keep nullable to avoid Mongo EF missing-field errors for existing users.
- Add `EmailVerificationToken` model/collection with `UserId`, `NormalizedEmail`, `TokenHash`, `CreatedAt`, `ExpiresAt`, `ConsumedAt`.
- Add indexes:
  - unique `TokenHash`
  - `UserId`
  - `NormalizedEmail`
  - `ExpiresAt`
- Add SMTP config/options:
  - `Smtp__Host`, `Port`, `Username`, `Password`, `FromEmail`, `FromName`, `UseStartTls`
  - `EmailVerification__TokenDays=7`
  - `EmailVerification__ResendCooldownSeconds=60`
- Add `IEmailSender` and SMTP implementation using `MailKit` or `System.Net.Mail`; prefer `MailKit` if adding a package is acceptable, otherwise use built-in `SmtpClient`.
- Add `IEmailVerificationService`:
  - create secure random token
  - store only SHA-256 hash
  - send verification email with link
  - verify token once
  - resend with rate limit

## API/UI Behavior

- Change `POST /api/auth/register`:
  - creates user with `EmailVerifiedAt = null`
  - sends verification email
  - does not issue JWT or refresh cookie
  - returns `202 Accepted` with `{ Email, RequiresEmailVerification: true }`
  - if the same unverified email registers again, resend only if cooldown allows and still return verification-pending response
  - verified duplicate email still returns conflict
- Change `POST /api/auth/login`:
  - if password is valid but `EmailVerifiedAt` is null, return `403` with message `Email verification required`
- Add `GET /api/auth/verify-email?token=...`:
  - validates token, marks token consumed, sets `EmailVerifiedAt`
  - issues refresh cookie
  - redirects to `/?emailVerified=1`
- Add `POST /api/auth/email-verification/resend`:
  - body `{ Email }`
  - always returns `202 Accepted` to reduce account enumeration
  - applies 60-second resend cooldown per email/user
- Frontend register flow:
  - after successful register, show `Check your email to verify your account`
  - do not treat register response as an authenticated session
  - on `?emailVerified=1`, show success toast and call existing refresh flow
  - show clear login error if backend returns `403 Email verification required`

## Test Plan

- Register new email: user is created, no auth session returned, verification email is sent.
- Login before verification: correct password returns `403`; wrong password still returns unauthorized.
- Verify valid token: account becomes verified, token consumed, refresh cookie set, frontend enters app.
- Verify same token twice: second attempt fails safely.
- Expired token after 7 days: verification fails and UI instructs resend.
- Resend email: allowed after cooldown, blocked/rate-limited before cooldown.
- Existing Telegram/dev users continue to work; only password login requires verified email.
- Existing password users with `EmailVerifiedAt = null` should either be treated as unverified or migrated manually; default plan treats them as unverified for security.

## Assumptions

- SMTP is the first delivery method.
- Verification links are valid for 7 days.
- Resend is allowed but rate-limited.
- Auto-login after verification uses refresh cookie and redirect, not an access token in the URL.
- No real SMTP credentials are committed; all secrets stay in `.env` or deployment environment variables.
