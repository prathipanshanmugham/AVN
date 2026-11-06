/*
 * Search engine and social tags: canonical URLs, Open Graph / Twitter cards, site verification,
 * Google Analytics 4, JSON-LD (business, website, services, FAQ, breadcrumbs), sitemap and robots.
 */
const { getSettings } = require('./db');
const QuoteCalc = require('../admin/assets/quote-calc');
const { FAQ, SERVICES } = require('./content');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OG_IMAGE = '/assets/og-image.jpg';

function siteUrl(s) {
  try { return new URL(s.site_url || 'https://avnsolar.in').origin; } catch (e) { return 'https://avnsolar.in'; }
}
const abs = (s, path) => siteUrl(s) + path;
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const tel = (v) => (digits(v).length === 10 ? '+91' + digits(v) : '');
const areas = (s) => String(s.service_areas || 'Tamil Nadu').split(',').map((x) => x.trim()).filter(Boolean);
const socials = (s) => ['social_facebook', 'social_instagram', 'social_youtube', 'social_linkedin'].map((k) => s[k]).filter(Boolean);

/** <script type="application/ld+json"> — a data block, so the CSP does not apply; "<" is escaped. */
const ld = (obj) => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';

function business(s) {
  const url = siteUrl(s);
  const lines = String(s.address || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const node = {
    '@type': 'HomeAndConstructionBusiness',
    '@id': url + '/#business',
    name: s.company_name || 'AVN Solar Solutions',
    alternateName: s.brand_name || 'AVN Solar',
    description: s.site_description,
    url: url + '/',
    logo: url + '/icons/icon-512.png',
    image: url + OG_IMAGE,
    areaServed: areas(s).map((name) => ({ '@type': 'AdministrativeArea', name })),
    knowsAbout: ['Rooftop solar', 'Solar EPC', 'PM Surya Ghar subsidy', 'Net metering', 'Solar water pumps', 'Solar maintenance'],
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Solar services',
      itemListElement: SERVICES.map((x) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: x.service, url: url + '/' + x.slug } })),
    },
  };
  if (tel(s.phone)) node.telephone = tel(s.phone);
  if (s.email) node.email = s.email;
  if (s.gstin) node.taxID = s.gstin;
  if (lines.length || s.addr_city) {
    node.address = { '@type': 'PostalAddress', streetAddress: lines.join(', ') || undefined, addressLocality: s.addr_city || undefined,
      postalCode: s.addr_pincode || undefined, addressRegion: QuoteCalc.stateName(QuoteCalc.companyState(s)), addressCountry: 'IN' };
  }
  if (socials(s).length) node.sameAs = socials(s);
  return node;
}

function website(s) {
  const url = siteUrl(s);
  return { '@type': 'WebSite', '@id': url + '/#website', url: url + '/', name: s.brand_name || 'AVN Solar', inLanguage: 'en-IN', publisher: { '@id': url + '/#business' } };
}

const faqPage = (list) => ({
  '@type': 'FAQPage',
  mainEntity: list.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

const breadcrumb = (s, trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(s, path) })),
});

/** Everything that goes in <head> after <title> and the description. */
function headTags(s, { path, title, description, type, graph }) {
  const url = abs(s, path);
  const img = abs(s, OG_IMAGE);
  const out = [
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta property="og:type" content="' + (type || 'website') + '">',
    '<meta property="og:site_name" content="' + esc(s.brand_name || 'AVN Solar') + '">',
    '<meta property="og:locale" content="en_IN">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(description) + '">',
    '<meta property="og:image" content="' + esc(img) + '">',
    '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="' + esc((s.brand_name || 'AVN Solar') + ' — rooftop solar in Tamil Nadu') + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + esc(title) + '">',
    '<meta name="twitter:description" content="' + esc(description) + '">',
    '<meta name="twitter:image" content="' + esc(img) + '">',
    '<meta name="geo.region" content="IN-TN">',
  ];
  if (s.google_verification) out.push('<meta name="google-site-verification" content="' + esc(s.google_verification) + '">');
  if (s.bing_verification) out.push('<meta name="msvalidate.01" content="' + esc(s.bing_verification) + '">');
  if (/^G-[A-Z0-9]{4,16}$/i.test(s.ga_id || '')) {
    out.push('<script async src="https://www.googletagmanager.com/gtag/js?id=' + esc(s.ga_id) + '"></script>');
    out.push('<script src="/assets/ga.js" data-ga="' + esc(s.ga_id) + '"></script>');
  }
  out.push(ld({ '@context': 'https://schema.org', '@graph': graph }));
  return out.join('\n');
}

function homeHead(s) {
  return headTags(s, { path: '/', title: s.site_title, description: s.site_description, graph: [business(s), website(s), faqPage(FAQ)] });
}

function serviceHead(s, svc) {
  const url = siteUrl(s);
  const faq = svc.faq.map((i) => FAQ[i]);
  return headTags(s, {
    path: '/' + svc.slug,
    title: svc.title + ' | ' + (s.brand_name || 'AVN Solar'),
    description: svc.description,
    graph: [
      business(s),
      website(s),
      { '@type': 'Service', '@id': url + '/' + svc.slug + '#service', name: svc.service, serviceType: svc.nav, description: svc.description,
        provider: { '@id': url + '/#business' }, areaServed: areas(s).map((name) => ({ '@type': 'AdministrativeArea', name })), url: url + '/' + svc.slug },
      breadcrumb(s, [['Home', '/'], [svc.nav, '/' + svc.slug]]),
      faqPage(faq),
    ],
  });
}

function sitemap(s, lastmod) {
  const urls = [['/', '1.0', 'weekly']].concat(SERVICES.map((x) => ['/' + x.slug, '0.8', 'monthly']));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(([p, pr, cf]) => '  <url><loc>' + esc(abs(s, p)) + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>' + cf + '</changefreq><priority>' + pr + '</priority></url>').join('\n') +
    '\n</urlset>\n';
}

function robots(s) {
  return ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /portal', 'Disallow: /api', 'Disallow: /files', '', 'Sitemap: ' + abs(s, '/sitemap.xml'), ''].join('\n');
}

function manifest(s) {
  return {
    name: s.company_name || 'AVN Solar Solutions',
    short_name: s.brand_name || 'AVN Solar',
    description: s.site_description,
    start_url: '/',
    scope: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#0E1542',
    lang: 'en-IN',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

module.exports = { esc, siteUrl, tel, digits, homeHead, serviceHead, sitemap, robots, manifest, getSettings };
