# AVN Solar — website, staff workspace and customer portal

One Node.js app that runs three things:

| Part | URL | Who |
|---|---|---|
| Public website | `/` | Everyone — video hero, savings calculator, enquiry form |
| AVN Workspace (staff back end) | `/admin` | Admin and Staff accounts |
| Customer portal | `/portal` | Client logins created by staff |

Website enquiries land straight in the CRM as new leads.

## What's inside

- **CRM** — pipeline (New lead → Site survey → Quotation sent → Negotiation → Won / Lost), follow-up dates, owners, notes, call/WhatsApp buttons, convert a won lead into a project.
- **Projects** — six stages (Survey → Design → Procurement → Installation → Approvals → Switch-on) with a checklist per stage, documents (private, optionally shared with the client), client service requests.
- **Calendar** — month view of site visits, installations, EB dates, deadlines and meetings, a deadlines list, and Keep-style checklists.
- **Clients** — staff create a client's portal login (Customer ID like `AVN-2026-0001` + temporary password, with a ready WhatsApp message), reset passwords, disable logins, handle service requests.
- **Website editor** — upload/replace the hero video, project gallery and solution photos (photos are converted to WebP; videos are compressed to a muted 720p clip when ffmpeg is installed), hide/show, reorder, edit the brand ribbons.
- **Settings (admin only)**
  - **Users** — create Admin or Staff accounts (only these two roles), reset passwords, disable accounts.
  - **Permissions** — choose which sections the Staff role can open: CRM, Projects, Calendar, Clients, Website editor. Admins always see everything.
  - **Company & contact**, **Website & calculator** (site title/description, homepage numbers, calculator assumptions, "hero video only on fast connections").

## Security

- Passwords hashed with bcrypt; every new staff or client account gets a temporary password and must set its own on first sign-in.
- Sessions stored server-side (SQLite), `HttpOnly` + `SameSite` cookies, `Secure` when `HTTPS_ONLY=1`.
- CSRF token required on every change request; sign-in rate limiting; Helmet security headers and CSP.
- Project documents are served only to staff with Projects access or to the client who owns the project.
- No Google sign-in — username/email + password only.

## Run locally

```bash
npm install
cp .env.example .env        # set ADMIN_PASSWORD; SESSION_SECRET can stay empty in development
NODE_ENV=development npm start
# optional sample data
npm run seed:demo
npm test                    # end-to-end API checks on a throwaway database
```

Open http://127.0.0.1:3000 (website), `/admin` (staff), `/portal` (customers).

## Deploy on the Hostinger VPS

1. Point `yourdomain` and `www.yourdomain` (A records) to the VPS IP in Hostinger DNS.
2. SSH in as root and run:

```bash
curl -fsSL https://raw.githubusercontent.com/prathipanshanmugham/avn/main/deploy/setup-vps.sh -o setup-vps.sh
DOMAIN=yourdomain.in ADMIN_PASSWORD='the-admin-password' \
REPO=https://<github-user>:<token>@github.com/prathipanshanmugham/avn.git bash setup-vps.sh
```

(The repo is private, so either use a GitHub personal access token in `REPO` as above, or add a deploy key to the server and use the `git@github.com:` URL. If `curl` can't fetch the private raw file, copy `deploy/setup-vps.sh` to the server with `scp`.)

The script installs Node 22, Nginx, ffmpeg and PM2, clones the repo to `/var/www/avn`, writes `.env` with a random `SESSION_SECRET`, starts the app, sets up Nginx + a free Let's Encrypt certificate, the firewall and a daily 2:30 AM backup (`data/backups`, kept 14 days).

**Updating later:** `bash /var/www/avn/deploy/update.sh`

**Locked out?** On the server: `cd /var/www/avn && sudo -u avn npm run admin:reset` prints a new temporary admin password.

## Folder layout

```
server/          Express app, SQLite schema, auth, API routes
admin/           Staff back end pages (Alpine.js)
portal/          Customer portal pages
public/          Website (index.html, assets, default hero video)
deploy/          VPS setup, Nginx, PM2, update script
scripts/         admin reset, demo data, backup, smoke test
data/, uploads/  created at runtime (database, backups, logs, media, documents) — not in git
```
