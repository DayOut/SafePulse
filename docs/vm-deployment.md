# SafePulse VM Deployment

These instructions deploy SafePulse to the VM with Docker and the helper PowerShell script.

## Current VM

- Host: `192.168.50.xx`
- User: `username`
- Project directory: `/home/username/SafePulse`
- App port: `8080`
- Local URL: `http://192.168.50.xx:8080/`
- Public URL: `https://url.com/`
- Docker image repository: `username/safe-pulse`

Do not store real VM passwords, Docker tokens, Telegram tokens, or signing keys in this file.

## One-command deploy

Run from the project root on Windows:

```powershell
.\scripts\deploy-vm.ps1 -Tag 0.3.0 -VmPassword "<VM_PASSWORD>"
```

Bump the tag each time you deploy (`0.3.0`, `0.4.0`, etc.).

The script:

1. Builds the frontend into `wwwroot`.
2. Builds Docker image `username/safe-pulse:<tag>`.
3. Tags the same image as `username/safe-pulse:latest`.
4. Streams the image to the VM using `docker save | ssh docker load`.
5. Updates VM `docker-compose.yml` to use the selected image tag.
6. Recreates only the API container.
7. Verifies `http://192.168.50.xx:8080/`.

## Deploy and push to Docker Hub

Use this when you also want the image available in Docker Hub:

```powershell
.\scripts\deploy-vm.ps1 -Tag 0.1.1 -Push -VmPassword "<VM_PASSWORD>"
```

`-Push` pushes:

- `username/safe-pulse:<tag>`
- `username/safe-pulse:latest`

The VM still receives the image over SSH, so Docker Hub login is not required on the VM.

## Useful script options

Skip frontend build when `wwwroot` is already current:

```powershell
.\scripts\deploy-vm.ps1 -Tag 0.1.1 -SkipFrontendBuild -VmPassword "<VM_PASSWORD>"
```

Skip Docker build when the local image already exists:

```powershell
.\scripts\deploy-vm.ps1 -Tag 0.1.1 -SkipDockerBuild -VmPassword "<VM_PASSWORD>"
```

Use a different VM host:

```powershell
.\scripts\deploy-vm.ps1 -VmHost "192.168.50.xx" -VmUser "username" -Tag 0.1.1 -VmPassword "<VM_PASSWORD>"
```

If SSH key auth is configured, omit `-VmPassword`:

```powershell
.\scripts\deploy-vm.ps1 -Tag 0.1.1
```

## Manual VM checks

Connect to the VM:

```powershell
ssh username@192.168.50.xx
```

Check containers:

```bash
cd ~/SafePulse
docker-compose ps
docker inspect safepulse-api --format 'Image={{.Config.Image}} Status={{.State.Status}} Started={{.State.StartedAt}}'
docker-compose logs --tail=80 api
```

Check HTTP:

```bash
curl -I http://localhost:8080/
```

## Manual deploy on VM

If the image already exists on the VM:

```bash
cd ~/SafePulse
docker-compose up -d --no-deps --force-recreate api
docker-compose logs --tail=80 api
```

If Docker Hub access is configured on the VM:

```bash
cd ~/SafePulse
docker-compose pull api
docker-compose up -d --no-deps --force-recreate api
```

## Cloudflare tunnel

Cloudflare tunnel service:

```bash
systemctl status safepulse-cloudflared
journalctl -u safepulse-cloudflared --no-pager -n 80
```

The app uses `App__PublicBaseUrl` from `.env`.

On the VM:

```bash
cd ~/SafePulse
grep APP_PUBLIC_BASE_URL .env
```

After changing `.env`, restart the API:

```bash
cd ~/SafePulse
docker-compose up -d --no-deps --force-recreate api
```

## Editing the .env file on VM

SSH in and edit directly:

```powershell
ssh username@192.168.50.xx
```

```bash
nano /home/username/SafePulse/.env
```

Save: `Ctrl+O` → Enter. Exit: `Ctrl+X`.

Then restart the API to apply changes:

```bash
cd /home/username/SafePulse && docker-compose up -d --no-deps --force-recreate api
```

## Important files on VM

- `/home/username/SafePulse/docker-compose.yml`
- `/home/username/SafePulse/.env`
- `/home/username/.safepulse.env.backup`

Keep `.env` private. It contains production secrets.
