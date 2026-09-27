# Deployment profiles

The fork publishes the secure-payload image as:

```text
ghcr.io/vasilevich/hemmelig-secure:v7
```

The `v7` branch is the deployment branch.

## First deployment

Copy the matching compose file and create a local secret-only `.env`:

```bash
install -d -m 700 /opt/hemmelig
cp deploy/amypay/docker-compose.yml /opt/hemmelig/docker-compose.yml
cd /opt/hemmelig
umask 077
printf 'BETTER_AUTH_SECRET=%s\nHEMMELIG_ANALYTICS_HMAC_SECRET=%s\n' \
  "$(openssl rand -base64 48 | tr -d '\n')" \
  "$(openssl rand -base64 48 | tr -d '\n')" > .env
chmod 600 .env docker-compose.yml
docker compose pull
docker compose up -d
```

Use `deploy/affipay/docker-compose.yml` for the second instance.

## Updating

After a new verified commit is merged into `v7` and its GitHub Actions image finishes:

```bash
cd /opt/hemmelig
docker compose pull
docker compose up -d
docker compose ps
```

Repeat in `/opt/hemmelig-affipay`.

Verify `/api/health/ready`, the public homepage, `/api/docs`, a normal secret, a redirect secret, and a mini-site.

## Existing AmyPay/Affipay installation

The current live servers historically used the upstream `hemmeligapp/hemmelig:v7.4.8` image plus a bind-mounted patched `index.html` for Telegram branding.

When switching to this fork:

- replace the image with `ghcr.io/vasilevich/hemmelig-secure:v7`
- use the supplied environment-driven metadata
- remove the old `./index.html:/app/dist/index.html:ro` bind mount
- the old host-side patched `index.html` can then be removed after verification
- keep the existing database and upload volumes if preserving accounts/settings is desired

Current verified targets:

- AmyPay: `/opt/hemmelig`, `192.168.100.10:50971`, `secret.amypay.io`
- Affipay: `/opt/hemmelig-affipay`, `192.168.100.10:50972`, `secret.affipay.co`

The user later referred to `secret.affipay.io`. That hostname was **not** the currently verified live hostname at the time of this implementation. If moving to `.io`, update DNS/reverse proxy and the three public URL variables in the Affipay compose file together before cutover.

## GHCR visibility

GitHub Container Registry may initially create the package with repository/account visibility defaults. If an unauthenticated `docker compose pull` receives 401/403, make the `hemmelig-secure` package public or log the server into GHCR with a read token.
