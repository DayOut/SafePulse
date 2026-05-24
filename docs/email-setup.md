# Email Verification Setup

## What needs to be configured

Two settings are required for email verification to work:

1. **SMTP credentials** — to send emails
2. **Public base URL** — so the verification link in the email points to the right domain

---

## Local development (`appsettings.Development.json`)

```json
"Smtp": {
  "Host": "smtp.gmail.com",
  "Port": 587,
  "Username": "you@gmail.com",
  "Password": "xxxx xxxx xxxx xxxx",
  "FromEmail": "you@gmail.com",
  "FromName": "SafePulse",
  "UseStartTls": true
},
"App": {
  "PublicBaseUrl": "http://localhost:5002"
}
```

**Gmail App Password**: go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), generate an App Password (requires 2FA enabled), use the 16-character code as `Password`. Your regular Gmail password will not work.

---

## Production (VM `.env`)

Add these variables to `/home/voblaco/SafePulse/.env`:

```env
Smtp__Host=smtp.gmail.com
Smtp__Port=587
Smtp__Username=you@gmail.com
Smtp__Password=xxxx xxxx xxxx xxxx
Smtp__FromEmail=you@gmail.com
Smtp__FromName=SafePulse
Smtp__UseStartTls=true
App__PublicBaseUrl=https://safepulse.voblaco.com
```

Check if `PublicBaseUrl` is already set:

```bash
grep App__PublicBaseUrl ~/SafePulse/.env
```

After editing `.env`, restart the API container:

```bash
cd ~/SafePulse
docker-compose up -d --no-deps --force-recreate api
```
