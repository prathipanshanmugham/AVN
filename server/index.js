const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const { db, MODULES } = require('./db');
const { sessionMiddleware, currentUser, currentClient, can } = require('./auth');
const { HttpError } = require('./util');
const { DOCS_DIR } = require('./uploads');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      // Google Analytics 4 (only loaded when a GA ID is set in Settings)
      'script-src': ["'self'", "'unsafe-eval'", 'https://www.googletagmanager.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://*.google-analytics.com', 'https://*.googletagmanager.com'],
      'media-src': ["'self'", 'blob:'],
      'connect-src': ["'self'", 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': config.httpsOnly ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());

// www.avnsolar.in → avnsolar.in (one address for search engines), using the website address in Settings.
app.use((req, res, next) => {
  const host = String(req.hostname || '');
  if (!host.startsWith('www.')) return next();
  try {
    const site = new URL(require('./db').getSettings().site_url);
    if (host === 'www.' + site.hostname) return res.redirect(301, site.origin + req.originalUrl);
  } catch (e) { /* no valid address set: serve as is */ }
  next();
});
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

const PUBLIC = path.join(config.root, 'public');
const ADMIN = path.join(config.root, 'admin');
const PORTAL = path.join(config.root, 'portal');

/*
 * Cache busting: every page links its scripts and styles as file.js?v=<hash of all asset files>,
 * so after an update browsers fetch the new files instead of using week-old cached copies.
 */
function assetVersion() {
  const hash = crypto.createHash('sha1');
  [path.join(PUBLIC, 'assets'), path.join(ADMIN, 'assets'), path.join(PORTAL, 'assets')].forEach((dir) => {
    fs.readdirSync(dir).filter((f) => /\.(js|css)$/.test(f)).sort().forEach((f) => hash.update(f).update(fs.readFileSync(path.join(dir, f))));
  });
  return hash.digest('hex').slice(0, 10);
}
const ASSET_V = assetVersion();
const versioned = (html) => html.replace(/((?:src|href)="\/(?:admin\/assets|portal\/assets|assets)\/[^"?#]+\.(?:js|css))"/g, '$1?v=' + ASSET_V + '"');
const pageCache = {};
function sendPage(res, file, status = 200) {
  let html = config.isProd ? pageCache[file] : null;
  if (!html) {
    html = versioned(fs.readFileSync(file, 'utf8'));
    if (config.isProd) pageCache[file] = html;
  }
  res.status(status).type('html').send(html);
}

// Static files
app.use('/assets', express.static(path.join(PUBLIC, 'assets'), { maxAge: config.isProd ? '7d' : 0 }));
app.use('/media', express.static(path.join(config.uploadDir, 'media'), { maxAge: '30d', immutable: true, fallthrough: false }));
app.get('/vendor/alpine.js', (req, res) => {
  res.set('Cache-Control', 'public, max-age=604800');
  res.sendFile(path.join(config.root, 'node_modules', 'alpinejs', 'dist', 'cdn.min.js'));
});
app.use('/admin/assets', express.static(path.join(ADMIN, 'assets'), { maxAge: config.isProd ? '1d' : 0 }));
app.use('/portal/assets', express.static(path.join(PORTAL, 'assets'), { maxAge: config.isProd ? '1d' : 0 }));
app.use('/icons', express.static(path.join(PUBLIC, 'icons'), { maxAge: config.isProd ? '30d' : 0 }));
app.get('/favicon.ico', (req, res) => {
  res.set('Cache-Control', 'public, max-age=2592000');
  res.sendFile(path.join(PUBLIC, 'favicon.ico'));
});

// Addresses from the old WordPress site, still in Google: send them to the matching part of the new site
// (301), and tell search engines the WordPress filler pages are gone for good (410).
const OLD_PAGES = { about: '/#why', services: '/#solutions', contact: '/#contact', project: '/#projects', projects: '/#projects' };
app.get(/^\/(about|services|contact|projects?)\/?$/, (req, res) => res.redirect(301, OLD_PAGES[req.params[0]]));
app.get(/^\/(sitemap_index|page-sitemap|post-sitemap|category-sitemap|author-sitemap)\.xml$/, (req, res) => res.redirect(301, '/sitemap.xml'));
app.get(/^\/(sample-page|hello-world|feed|comments\/feed|author\/[^/]+|category\/[^/]+)\/?$/, (req, res) => {
  res.status(410);
  sendPage(res, path.join(PUBLIC, '404.html'), 410);
});

// Search engines: robots, sitemap, web app manifest (all follow the website address in Settings)
const seo = require('./seo');
const pages = require('./pages');
const DEPLOYED = new Date().toISOString().slice(0, 10);
app.get('/robots.txt', (req, res) => res.type('text').send(seo.robots(seo.getSettings())));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(seo.sitemap(seo.getSettings(), DEPLOYED)));
app.get('/site.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify(seo.manifest(seo.getSettings()))));

// API
app.use('/api', sessionMiddleware);
app.use('/api', require('./routes/public'));
app.use('/api', require('./routes/staff'));
app.use('/api', require('./routes/crm'));
app.use('/api', require('./routes/projects'));
app.use('/api', require('./routes/calendar'));
app.use('/api', require('./routes/website'));
app.use('/api', require('./routes/clients'));
app.use('/api', require('./routes/quotes'));
app.use('/api', require('./routes/dashboard'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Private project documents: staff with Projects access, or the client who owns the project (if shared).
app.get('/files/docs/:id', sessionMiddleware, (req, res) => {
  const d = db.prepare('SELECT d.*, p.client_id FROM project_docs d JOIN projects p ON p.id = d.project_id WHERE d.id = ?').get(req.params.id);
  if (!d) return res.status(404).send('Not found');
  const user = currentUser(req);
  const client = currentClient(req);
  const staffOk = user && !user.must_change && can(user, 'projects');
  const clientOk = client && !client.must_change && d.client_visible && d.client_id === client.id;
  if (!staffOk && !clientOk) return res.status(403).send('You do not have access to this file');
  res.set('X-Content-Type-Options', 'nosniff');
  res.download(path.join(DOCS_DIR, d.stored_name), d.file_name);
});

// Public website (title, description and search tags come from Settings)
let indexTemplate = null;
let pageTemplate = null;
const esc = seo.esc;
app.get(['/', '/index.html'], (req, res) => {
  if (!indexTemplate || !config.isProd) indexTemplate = versioned(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'));
  const s = seo.getSettings();
  const hero = db.prepare("SELECT * FROM media WHERE section = 'hero' AND visible = 1 AND status = 'ready' ORDER BY kind = 'video' DESC, position, id").all();
  const video = hero.find((m) => m.kind === 'video');
  const image = hero.find((m) => m.kind === 'image');
  const poster = video && video.poster_name ? '/media/' + video.poster_name : (image ? '/media/' + image.stored_name : '/assets/hero-poster.webp');
  const parts = {
    __SITE_TITLE__: esc(s.site_title), __SITE_DESCRIPTION__: esc(s.site_description), __SEO_HEAD__: seo.homeHead(s),
    __FAQ_HTML__: pages.faqHtml(pages.FAQ), __FOOTER__: pages.footer(s, ''),
    __HERO_POSTER__: esc(poster), __HERO_VIDEO__: esc(video ? '/media/' + video.stored_name : ''),
  };
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(indexTemplate.replace(/__[A-Z_]+__/g, (k) => (k in parts ? parts[k] : k)));
});

// Service pages: /rooftop-solar-for-homes, /commercial-industrial-solar, /solar-water-pumps, /solar-maintenance-amc
pages.SERVICES.forEach((svc) => {
  app.get('/' + svc.slug, (req, res) => {
    if (!pageTemplate || !config.isProd) pageTemplate = versioned(fs.readFileSync(path.join(PUBLIC, 'page.html'), 'utf8'));
    const s = seo.getSettings();
    const parts = {
      __TITLE__: esc(svc.title + ' | ' + (s.brand_name || 'AVN Solar')), __DESCRIPTION__: esc(svc.description), __TYPE__: esc(svc.type),
      __SEO_HEAD__: seo.serviceHead(s, svc), __BODY__: pages.serviceBody(s, svc),
    };
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(pageTemplate.replace(/__[A-Z_]+__/g, (k) => (k in parts ? parts[k] : k)));
  });
});

// Staff back end pages
const ADMIN_PAGES = {
  dashboard: 'dashboard', crm: 'crm', quotes: 'quotes', 'quote-print': 'quotes', projects: 'projects', calendar: 'calendar', website: 'website', clients: 'clients',
  settings: null, account: null,
};
function firstAllowedPage(user) {
  if (user.must_change) return '/admin/account';
  const m = MODULES.find((x) => can(user, x));
  return m ? '/admin/' + m : '/admin/account';
}
app.get('/admin/login', sessionMiddleware, (req, res) => {
  const u = currentUser(req);
  if (u) return res.redirect(firstAllowedPage(u));
  sendPage(res, path.join(ADMIN, 'login.html'));
});
app.get(['/admin', '/admin/'], sessionMiddleware, (req, res) => {
  const u = currentUser(req);
  res.redirect(u ? firstAllowedPage(u) : '/admin/login');
});
app.get('/admin/:page', sessionMiddleware, (req, res, next) => {
  const page = req.params.page;
  if (!(page in ADMIN_PAGES)) return next();
  const u = currentUser(req);
  if (!u) return res.redirect('/admin/login');
  if (u.must_change && page !== 'account') return res.redirect('/admin/account');
  const mod = ADMIN_PAGES[page];
  if (mod && !can(u, mod)) return res.redirect(firstAllowedPage(u));
  res.set('Cache-Control', 'no-store');
  sendPage(res, path.join(ADMIN, page + '.html'));
});

// Client portal pages
app.get('/portal/login', sessionMiddleware, (req, res) => {
  if (currentClient(req)) return res.redirect('/portal');
  sendPage(res, path.join(PORTAL, 'login.html'));
});
app.get(['/portal', '/portal/'], sessionMiddleware, (req, res) => {
  if (!currentClient(req)) return res.redirect('/portal/login');
  res.set('Cache-Control', 'no-store');
  sendPage(res, path.join(PORTAL, 'index.html'));
});

app.use((req, res) => sendPage(res, path.join(PUBLIC, '404.html'), 404));

// Errors
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong';
  if (err.code === 'LIMIT_FILE_SIZE') { status = 400; message = 'That file is too large'; }
  if (status >= 500) { console.error(err); message = 'Something went wrong. Please try again.'; }
  if (req.path.startsWith('/api')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log(`AVN running on http://${config.host}:${config.port} (${config.env})`);
  });
}

module.exports = app;
