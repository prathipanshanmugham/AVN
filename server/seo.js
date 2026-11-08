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
function headTags(s, { path, title, description, type, graph, image, robots, extra }) {
  const url = abs(s, path);
  const img = image ? abs(s, image) : abs(s, OG_IMAGE);
  const out = [
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta name="robots" content="' + (robots || 'index, follow, max-image-preview:large') + '">',
    '<link rel="alternate" type="application/rss+xml" title="' + esc((s.brand_name || 'AVN Solar') + ' blog') + '" href="/blog/feed.xml">',
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
  ].concat(extra || []);
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

/** posts: live blog posts, newest first. */
function sitemap(s, lastmod, posts) {
  posts = posts || [];
  const day = (sql) => String(sql || '').slice(0, 10) || lastmod;
  const urls = [['/', '1.0', 'weekly', lastmod]].concat(SERVICES.map((x) => ['/' + x.slug, '0.8', 'monthly', lastmod]));
  urls.push(['/blog', '0.7', 'weekly', posts.length ? day(posts[0].updated_at) > lastmod ? day(posts[0].updated_at) : lastmod : lastmod]);
  posts.forEach((p) => urls.push(['/blog/' + p.slug, '0.6', 'monthly', day(p.updated_at)]));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(([p, pr, cf, lm]) => '  <url><loc>' + esc(abs(s, p)) + '</loc><lastmod>' + lm + '</lastmod><changefreq>' + cf + '</changefreq><priority>' + pr + '</priority></url>').join('\n') +
    '\n</urlset>\n';
}

/* ------------------------------------------------------------------ Blog */
const blog = require('./blog');
const iso = (sql) => (sql ? sql.replace(' ', 'T') + 'Z' : undefined);
const brandOf = (s) => s.brand_name || 'AVN Solar';

function blogListHead(s, { page, tag, tagName, posts }) {
  const url = siteUrl(s);
  const path = '/blog' + (tag || page > 1 ? '?' + [tag ? 'tag=' + encodeURIComponent(tag) : '', page > 1 ? 'page=' + page : ''].filter(Boolean).join('&') : '');
  const title = (tagName ? tagName + ' — ' : '') + 'Solar Blog: Guides, Subsidy & Savings' + (page > 1 ? ' (page ' + page + ')' : '') + ' | ' + brandOf(s);
  const description = 'Plain-language guides on rooftop solar in Tamil Nadu — costs, PM Surya Ghar subsidy, net metering, batteries and maintenance, from the ' + brandOf(s) + ' team.';
  const trail = [['Home', '/'], ['Blog', '/blog']].concat(tagName ? [[tagName, path]] : []);
  return {
    title,
    description,
    head: headTags(s, {
      path, title, description,
      graph: [business(s), website(s),
        { '@type': 'Blog', '@id': url + '/blog#blog', name: brandOf(s) + ' blog', url: url + '/blog', inLanguage: 'en-IN', publisher: { '@id': url + '/#business' },
          blogPost: posts.map((p) => ({ '@type': 'BlogPosting', headline: p.title.slice(0, 110), url: url + '/blog/' + p.slug, datePublished: iso(p.published_at) })) },
        breadcrumb(s, trail)],
    }),
  };
}

function postHead(s, p, preview) {
  const url = siteUrl(s) + '/blog/' + p.slug;
  const title = (p.meta_title || p.title) + ' | ' + brandOf(s);
  const description = p.meta_description || blog.summary(p, 158);
  const image = p.cover_og ? '/media/' + p.cover_og : null;
  const team = !p.author_name || /team|solar|avn/i.test(p.author_name);
  const tags = blog.tagsOf(p);
  const article = {
    '@type': 'BlogPosting', '@id': url + '#post', headline: p.title.slice(0, 110), description, url, mainEntityOfPage: url, inLanguage: 'en-IN',
    image: [abs(s, image || OG_IMAGE)], datePublished: iso(p.published_at), dateModified: iso(p.updated_at),
    author: team ? { '@type': 'Organization', name: p.author_name || brandOf(s), url: url.replace(/\/blog\/.*$/, '/') } : { '@type': 'Person', name: p.author_name },
    publisher: { '@id': siteUrl(s) + '/#business' }, wordCount: blog.plainText(p.body).split(' ').filter(Boolean).length,
  };
  if (tags.length) article.keywords = tags.join(', ');
  const extra = [];
  if (p.published_at) extra.push('<meta property="article:published_time" content="' + iso(p.published_at) + '">');
  extra.push('<meta property="article:modified_time" content="' + iso(p.updated_at) + '">');
  tags.forEach((t) => extra.push('<meta property="article:tag" content="' + esc(t) + '">'));
  return {
    title,
    description,
    head: headTags(s, {
      path: '/blog/' + p.slug, title, description, type: 'article', image, extra,
      robots: preview ? 'noindex, nofollow' : undefined,
      graph: [business(s), website(s), article, breadcrumb(s, [['Home', '/'], ['Blog', '/blog'], [p.title, '/blog/' + p.slug]])],
    }),
  };
}

/** RSS 2.0 feed of the latest posts. */
function rss(s, posts) {
  const url = siteUrl(s);
  const x = (v) => esc(v).replace(/&#39;/g, '&apos;');
  const items = posts.map((p) => '    <item>\n' +
    '      <title>' + x(p.title) + '</title>\n      <link>' + url + '/blog/' + p.slug + '</link>\n      <guid isPermaLink="true">' + url + '/blog/' + p.slug + '</guid>\n' +
    '      <pubDate>' + new Date(iso(p.published_at)).toUTCString() + '</pubDate>\n      <description>' + x(blog.summary(p, 300)) + '</description>\n' +
    blog.tagsOf(p).map((t) => '      <category>' + x(t) + '</category>\n').join('') + '    </item>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n' +
    '    <title>' + x(brandOf(s) + ' blog') + '</title>\n    <link>' + url + '/blog</link>\n    <description>' + x('Solar guides, subsidy updates and project stories from ' + brandOf(s)) + '</description>\n' +
    '    <language>en-IN</language>\n    <atom:link href="' + url + '/blog/feed.xml" rel="self" type="application/rss+xml"/>\n' + items + '\n  </channel>\n</rss>\n';
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

module.exports = { esc, siteUrl, tel, digits, homeHead, serviceHead, blogListHead, postHead, rss, sitemap, robots, manifest, getSettings };
