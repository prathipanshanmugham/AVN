# AVN Solar — website, staff workspace and customer portal

One Node.js app that runs three things:

| Part | URL | Who |
|---|---|---|
| Public website | `/` | Everyone — video hero, quote wizard, savings calculator, WhatsApp button |
| AVN Workspace (staff back end) | `/admin` | Admin and Staff accounts |
| Customer portal | `/portal` | Client logins created by staff |

Every website enquiry (quote wizard, offer popup, calculator, WhatsApp) lands in the CRM as a lead and, once SMTP is set up, in your inbox.

## What's inside

- **CEO Dashboard** (admins; staff only if allowed in Permissions) — company health score out of 100 from six measures (lead win rate, follow-ups on time, projects on schedule, money collected, service requests, installation growth), kW installed per location split into on-grid / hybrid / off-grid, monthly handovers, pipeline, and downloadable PDF reports (company, installations, leads & quotations, collections) for any period.
- **Website lead capture** — 4-step quote wizard with a live size/savings estimate, once-a-week offer popup (timed or on exit), "send me this estimate" on the calculator, floating WhatsApp button with a pre-filled message, mobile Call / Quote bar. Ad tags (`utm_*`, `gclid`, `fbclid`) set the lead source; repeat enquiries from the same mobile within a day update the same lead.
- **CRM** — pipeline (New lead → Site survey → Quotation sent → Negotiation → Won / Lost), follow-up dates, owners, notes, call/WhatsApp buttons, convert a won lead into a project.
- **Quotations** — create from a lead or from scratch; price line, panel count and scope of supply fill in from the kWp and Settings rates. GST as a solar EPC contract (70% @ 5% + 30% @ 18%) or per line, CGST/SGST or IGST, discount, PM Surya Ghar subsidy shown as information, amount in words, numbering per financial year (`AVN-Q/26-27/0001`), printable A4 / Save as PDF, WhatsApp share, revisions. Marking a quote Sent or Accepted moves the lead along the pipeline.
- **Projects** — six stages (Survey → Design → Procurement → Installation → Approvals → Switch-on) with a checklist per stage, a Google Drive folder link, a project record (EB details, MNRE / PM Surya Ghar application and approval dates, net meter, system installed, warranty, payments), a serial number register (bulk paste or barcode scan, duplicate check across all projects, search, CSV export), documents (private, optionally shared with the client) and client service requests.
- **Calendar** — month view of site visits, installations, EB dates, deadlines and meetings, a deadlines list, and Keep-style checklists.
- **Clients** — staff create a client's portal login (Customer ID like `AVN-2026-0001` + temporary password, with a ready WhatsApp message), reset passwords, disable logins, handle service requests.
- **Website editor** — hero video or photo slideshow, project gallery, solution photos and the full-width photo band (photos are converted to WebP; videos are compressed to a muted 720p clip when ffmpeg is installed), hide/show, reorder, and brand logos for the two ribbons (drop many files at once — the file name picks the brand).
- **Settings (admin only)**
  - **Users** — create Admin or Staff accounts (only these two roles), reset passwords, disable accounts.
  - **Permissions** — choose which sections the Staff role can open: CRM, Projects, Calendar, Clients, Website editor. Admins always see everything.
  - **Company & contact**, **Website & lead capture** (site title/description, WhatsApp message, offer popup, homepage numbers, calculator assumptions, "hero video only on fast connections").
  - **Lead emails** — recipients and SMTP server (Gmail app password, Hostinger mail, etc.), with a "Send test email" button. The SMTP password is never sent back to the browser.
  - **Quotations & bank** — ₹ per kWp rates, GST mode, numbering, module/inverter makes, terms, bank and UPI details.

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

**Domain or IP later:** `bash /var/www/avn/deploy/set-domain.sh avnsolar.in` (or the server IP for plain HTTP). It only changes AVN's own Nginx site and fetches the HTTPS certificate.

The setup script is safe on a server that already hosts other sites: it picks a free port, adds its own Nginx site, runs under its own `avn` user and PM2, and leaves the firewall alone if it isn't active.

**Updating later:** `bash /var/www/avn/deploy/update.sh`

**Set the admin's sign-in email and password:** `cd /var/www/avn && sudo -u avn npm run admin:set -- admin@yourdomain.in 'Your-Password'`

**Locked out?** On the server: `cd /var/www/avn && sudo -u avn npm run admin:reset` prints a new temporary admin password.

Database changes are applied automatically when the app starts (`PRAGMA user_version` migrations), so `update.sh` is all an upgrade needs. The nightly backup keeps the previous state.

## Folder layout

```
server/          Express app, SQLite schema, auth, API routes, dashboard metrics, PDF reports (fonts/: DM Sans, OFL licence)
admin/           Staff back end pages (Alpine.js)
portal/          Customer portal pages
public/          Website (index.html, assets, default hero video)
deploy/          VPS setup, Nginx, PM2, update script
scripts/         admin set/reset, demo data, backup, smoke test
data/, uploads/  created at runtime (database, backups, logs, media, documents) — not in git
```
