# GitHub Actions production deployment

Synapse deploys only after the `Quality Gates` workflow succeeds for a push to
`main`. Pull-request runs never deploy.

## Required GitHub Actions secrets

Create these repository or `production` environment secrets:

- `SYNAPSE_HOST`: production server hostname or IP.
- `SYNAPSE_DEPLOY_USER`: the restricted SSH deployment user.
- `SYNAPSE_SSH_PORT`: SSH port, normally `22`.
- `SYNAPSE_SSH_PRIVATE_KEY`: the complete private Ed25519 deployment key.
- `SYNAPSE_SSH_KNOWN_HOSTS`: the pinned production SSH host-key line.

Do not commit any private key or production environment value.

## Deployment flow

1. Backend and frontend quality gates complete successfully.
2. GitHub checks out the exact verified commit and builds the frontend.
3. A checksum-protected release archive is uploaded to the restricted incoming
   directory.
4. The root-owned server script validates the release id, checksum, and archive
   paths.
5. Dependencies are installed in a new release directory.
6. The candidate backend starts on the inactive port and must pass `/api/health`.
7. Hashed frontend assets are copied to the shared Nginx asset directory.
8. Nginx is tested and reloaded to point at the new release.
9. The previous PM2 process is stopped only after public API and JavaScript asset
   smoke checks pass.

Failed candidates do not replace the active Nginx configuration.

## Rollback

Use the `Roll Back Production` workflow and provide an existing release id. The
same canary health checks and Nginx validation run before traffic is switched.

## Server-owned configuration

Production values remain on the server in `/etc/synapse/production.env`, owned
by root with mode `0600`. GitHub receives only the restricted deployment SSH
key; database, Redis, JWT, and application environment secrets are never sent to
GitHub Actions.
