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
- **Quotations** — create from a lead or from scratch; component lines (modules, inverter, battery for hybrid/off-grid, structure, cables, ACDB/DCDB, earthing, installation) with HSN/SAC and GST fill in from the kWp and Settings rates, plus the scope of supply. Two print formats, switchable per quotation or on the print page: **item-wise** (every line with HSN/SAC, qty, rate, taxable value, GST) and **grouped** (one price per group, components listed under it). GST as a solar EPC contract (70% @ 5% + 30% @ 18%) or per line; place of supply decides CGST + SGST or IGST (set automatically from the customer's GSTIN); discount shared across lines; HSN/SAC-wise tax summary; amount and GST in words; PM Surya Ghar subsidy shown as information; numbering per financial year (`AVN-Q/26-27/0001`); printable A4 / Save as PDF; WhatsApp share; revisions. Marking a quote Sent or Accepted moves the lead along the pipeline. HSN/SAC codes and rates are starting points — confirm them with your CA.
- **Projects** — six stages (Survey → Design → Procurement → Installation → Approvals → Switch-on) with a checklist per stage, a Google Drive folder link, a project record (EB details, MNRE / PM Surya Ghar application and approval dates, net meter, system installed, warranty, payments), a serial number register (bulk paste or barcode scan, duplicate check across all projects, search, CSV export), documents (private, optionally shared with the client) and client service requests.
- **Calendar** — month view of site visits, installations, EB dates, deadlines and meetings, a deadlines list, and Keep-style checklists.
- **Clients** — staff create a client's portal login (Customer ID like `AVN-2026-0001` + temporary password, with a ready WhatsApp message), reset passwords, disable logins, handle service requests.
- **Website editor** — hero video or photo slideshow, project gallery, solution photos and the full-width photo band (photos are converted to WebP; videos are compressed to a muted 720p clip when ffmpeg is installed), hide/show, reorder, and brand logos for the two ribbons (drop many files at once — the file name picks the brand).
- **Settings (admin only)**
  - **Users** — create Admin or Staff accounts (only these two roles), reset passwords, disable accounts.
  - **Permissions** — choose which sections the Staff role can open: CRM, Projects, Calendar, Clients, Website editor. Admins always see everything.
  - **Company & contact**, **Website & lead capture** (WhatsApp message, offer popup, homepage numbers, calculator assumptions, "hero video only on fast connections").
  - **Search (SEO) & social** — site title and description with a live Google preview, website address, areas served, office town/PIN, Google Search Console and Bing verification codes (paste the whole tag), Google Analytics 4 ID (form leads are sent as `generate_lead` events), social links.
  - **Lead emails** — recipients and SMTP server (Gmail app password, Hostinger mail, etc.), with a "Send test email" button. The SMTP password is never sent back to the browser.
  - **Quotations & bank** — ₹ per kWp rates, GST mode, numbering, module/inverter makes, terms, bank and UPI details.

## Search engines (SEO)

- Service pages with their own text and quote form: `/rooftop-solar-for-homes`, `/commercial-industrial-solar`, `/solar-water-pumps`, `/solar-maintenance-amc` (content in `server/content.js`).
- Every public page has a canonical URL, Open Graph / Twitter share card (`public/assets/og-image.jpg`), and JSON-LD: business, website, services, breadcrumbs and FAQ. The FAQ and footer are rendered on the server.
- `/sitemap.xml`, `/robots.txt` and `/site.webmanifest` follow the website address in Settings; `www.` redirects to the main address.
- Favicons: `public/favicon.ico` and `public/icons/` are built from `public/assets/logo.png` — run `npm run icons` after changing the logo.
- After going live: verify the site in Google Search Console (paste the code in Settings → Search), submit `/sitemap.xml`, and keep the Google Business Profile address and phone the same as Settings → Company.

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
public/          Website (index.html, page.html for service pages, assets, icons, default hero video)
deploy/          VPS setup, Nginx, PM2, update script
scripts/         admin set/reset, demo data, backup, smoke test
data/, uploads/  created at runtime (database, backups, logs, media, documents) — not in git
```
