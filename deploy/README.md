# CD Operations

## Release flow

1. Ola and Ola_bot publish GHCR images tagged with the full Git commit SHA.
2. Changes from `dev` or `ola-dev` deploy to staging.
3. `/opt/ola-staging/last-green.env` records the tested CRM and nanobot SHA pair.
4. `Promote Production` accepts only that exact pair and waits for approval from the
   GitHub `production` Environment.
5. Production deploys Box 1, then Box 2. Any failed check restores both previous images.

## GitHub configuration

Create `staging` and `production` Environments. Add required reviewers to `production`.

Repository secrets:

- `DEVELOPMENT_DATABASE`, `STAGING_DATABASE`, `PRODUCTION_DATABASE`
- `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY`, `STAGING_SSH_KNOWN_HOSTS`
- `STAGING_TAILSCALE_IP`, `STAGING_BOOTSTRAP_CRM_SHA`, `STAGING_BOOTSTRAP_NANOBOT_SHA`
- `STAGING_BACKEND_ENV_B64`, `STAGING_ROOT_ENV_B64`
- `STAGING_NANOBOT_CONFIG_B64`, `STAGING_NANOBOT_ENV_B64`
- `STAGING_TEST_EMAIL`, `STAGING_TEST_PASSWORD`, `STAGING_MCP_SERVICE_TOKEN`
- `PRODUCTION_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`
- `PRODUCTION_BOX1_HOST`, `PRODUCTION_BOX1_USER`, `PRODUCTION_BOX1_TAILSCALE_IP`
- `PRODUCTION_BOX2_HOST`, `PRODUCTION_BOX2_USER`, `PRODUCTION_BOX2_TAILSCALE_IP`
- `PRODUCTION_BACKEND_ENV_B64`, `PRODUCTION_ROOT_ENV_B64`
- `PRODUCTION_NANOBOT_CONFIG_B64`, `PRODUCTION_NANOBOT_ENV_B64`
- `PRODUCTION_TEST_EMAIL`, `PRODUCTION_TEST_PASSWORD`, `PRODUCTION_MCP_SERVICE_TOKEN`

Ola_bot also needs `OLA_DEPLOY_TOKEN`, scoped to dispatch workflows in the Ola repository.

Base64 configuration secrets are decoded only into mode-600 files. MongoDB URI values are
parsed structurally; workflows never print complete URIs or credentials.
GHCR pulls use a `read:packages`-only token stored as `GHCR_PULL_TOKEN`. It expires on
July 11, 2026 and must be rotated before that date.

## Temporary staging database policy

By leadership decision on June 11, 2026, staging temporarily uses the development database.
Set `STAGING_DATABASE` to the same URI as `DEVELOPMENT_DATABASE`. The validation script permits
only that named pair to match; production must remain different from both.

Because the database is shared, staging CD performs a connectivity check only. It must not run
`setup`, `add-admin`, seeds, migrations that rewrite data, destructive smoke tests, or cleanup
jobs. Staging smoke tests use an existing development test account and should create uniquely
prefixed disposable records where writes are unavoidable. Move staging to a dedicated database
before enabling destructive or migration testing.

## Server layout

- Box 1: production CRM frontend, backend, and MCP.
- Box 2: production nanobot API, gateway, channels, and WhatsApp bridge.
- Box 3/5: shared Gotenberg.
- Box 4: devboard only.
- Box 6: full staging stack.
- Box 7: excluded `ola.services` products.

Run `deploy/bootstrap-staging.sh` once on Box 6, then authenticate Tailscale. Add the proxied
Cloudflare record `staging.olatech.ai -> 47.254.40.1` and use Full (strict) origin TLS.
Install a Cloudflare Origin Certificate at `/etc/nginx/tls/staging.olatech.ai.pem` and its
mode-600 private key at `/etc/nginx/tls/staging.olatech.ai.key`. The deployment workflow
validates and reloads `deploy/nginx-staging.conf`.

Box 6 uses explicit Alibaba and Cloudflare DNS resolvers and does not accept Tailscale DNS.
Its Alibaba Linux repositories use `https://mirrors.aliyun.com`; the default internal
`mirrors.cloud.aliyuncs.com` endpoint is unreachable from this host.

## Cleanup

Production cleanup is deliberately two phase:

1. On the first successful promotion, obsolete services are disabled.
2. Observe for seven days and retain backups of `/root/.nanobot`, CRM upload volumes, and
   repository secret backups stored outside the checkout.
3. Remove stale units/files and prune old images only after immutable rollback has been proven.

Do not remove `/app/crm` or the old Box 2 systemd definitions before the first successful
promotion. They are the initial migration rollback path.

Run `deploy/harden-box2-bindings.sh` on Box 2 after the first successful promotion and before
pruning old services. It rebinds the nanobot services from `0.0.0.0` to the Tailscale IP and
keeps its own backup/rollback of the unit files it edits.
