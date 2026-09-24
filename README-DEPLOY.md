# Chatto Bot Deployment Guide

## 1) FTP auto deploy

This repository includes GitHub Actions workflow at:

- .github/workflows/deploy-ftp.yml

### Required GitHub secrets

Set these in GitHub repository settings:

- FTP_HOST
- FTP_USERNAME
- FTP_PASSWORD

### Trigger

- Push to main branch
- Or manual run via GitHub Actions UI

## 2) Host-side restart script

Use:

- deploy-host.sh

Set the target app path before running:

```bash
chmod +x deploy-host.sh
APP_DIR=/home/youruser/chatto-bot ./deploy-host.sh
```

If PM2 is installed, the script restarts the app automatically.

## 3) Important host requirements

Your host must support:

- Node.js 22+
- npm install
- port binding for the app
- PM2 or equivalent restart mechanism

## 4) Runtime command

For direct start:

```bash
PORT=3000 NODE_ENV=production npm run start
```

## 5) Notes

This app is a Node/TypeScript project and is not a pure static site. FTP upload alone is not enough; the host must also be able to run Node and restart the process.
