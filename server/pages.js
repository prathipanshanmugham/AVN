/*
 * Server-rendered pieces of the public site: the FAQ, footer links and contact line on the homepage,
 * and the service pages (/rooftop-solar-for-homes, …). Rendered on the server so search engines
 * read the full text without running JavaScript.
 */
const { FAQ, STEPS, SERVICES } = require('./content');
const { esc, tel, digits, siteUrl } = require('./seo');
const blog = require('./blog');

const PLUS = '<span class="pm" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111847" stroke-width="2.4" stroke-linecap="round"><path d="M5 12 H19"/><path d="M12 5 V19"/></svg></span>';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';
const PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4 H9 L11 9 L8.5 10.5 A11 11 0 0 0 13.5 15.5 L15 13 L20 15 V19 A2 2 0 0 1 18 21 A16 16 0 0 1 3 6 A2 2 0 0 1 5 4"/></svg>';
const CHAT = '<svg class="chat-ic" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 8 A4 4 0 0 1 10 4 H22 A4 4 0 0 1 26 8 V18 A4 4 0 0 1 22 22 H14 L8 27 V22 A4 4 0 0 1 6 18 Z"/><circle cx="11.5" cy="13" r="1.8"/><circle cx="16" cy="13" r="1.8"/><circle cx="20.5" cy="13" r="1.8"/></svg>';

function faqHtml(list) {
  return list.map((f, i) => '<details class="faq-item"' + (i === 0 ? ' open' : '') + '><summary><span>' + esc(f.q) + '</span>' + PLUS +
    '</summary><p class="avn-ans">' + esc(f.a) + '</p></details>').join('\n');
}

/** Address · email · hours · GSTIN, as one line (also filled in by the page script). */
const contactLine = (s) => [s.address && s.address.replace(/\s*\r?\n\s*/g, ', '), s.email, s.hours, s.gstin ? 'GSTIN ' + s.gstin : ''].filter(Boolean).join(' · ');

function serviceLinks(current, short) {
  return SERVICES.map((x) => '<a class="avn-ul" href="/' + x.slug + '"' + (x.slug === current ? ' aria-current="page"' : '') + '>' + esc(short ? x.short : x.nav) + '</a>').join('');
}
const blogLink = (current) => '<a class="avn-ul" href="/blog"' + (current === 'blog' ? ' aria-current="page"' : '') + '>Blog</a>';

const waUrl = (s, text) => 'https://wa.me/91' + digits(s.whatsapp || s.phone) + (text ? '?text=' + encodeURIComponent(text) : '');

function footer(s, current) {
  const social = [['social_facebook', 'Facebook'], ['social_instagram', 'Instagram'], ['social_youtube', 'YouTube'], ['social_linkedin', 'LinkedIn']]
    .filter(([k]) => s[k]).map(([k, n]) => '<a class="avn-ul" href="' + esc(s[k]) + '" rel="noopener" target="_blank">' + n + '</a>').join('');
  return `<footer class="footer">
  <div class="wrap">
    <div class="top">
      <div style="display:flex;align-items:center;gap:16px"><span class="chip"><img src="/assets/logo.png" alt="${esc(s.brand_name)} logo" width="60" height="60" loading="lazy"></span><span><b style="font-family:var(--display);font-size:18px;color:#fff;display:block">${esc(s.company_name)}</b><span style="font-size:15px">Solar EPC · ${esc(String(s.service_areas || 'Tamil Nadu'))}</span></span></div>
      <nav aria-label="Services">${serviceLinks(current)}${blogLink(current)}<a class="avn-ul" href="/portal/login">Customer login</a></nav>
    </div>
    ${social ? '<nav class="social" aria-label="Social">' + social + '</nav>' : ''}
    <div class="bottom">
      <span>${esc(contactLine(s))}${tel(s.phone) ? ' · <a href="tel:' + tel(s.phone) + '">' + esc(s.phone) + '</a>' : ''}</span>
      <span style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 24px">
        <a class="staff" href="/admin/login"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11 V7.5 A4 4 0 0 1 16 7.5 V11"/></svg>Staff login</a>
        <span>© ${new Date().getFullYear()} ${esc(s.company_name)} · Website by Dotindot Creative</span>
      </span>
    </div>
  </div>
</footer>`;
}

function sectionHtml(sec) {
  const parts = ['<h2 class="h3x">' + esc(sec.h2) + '</h2>'];
  (sec.p || []).forEach((p) => parts.push('<p>' + esc(p) + '</p>'));
  if (sec.list) parts.push('<ul class="ticks">' + sec.list.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>');
  if (sec.table) {
    parts.push('<div class="ptable"><table><thead><tr>' + sec.table.head.map((h) => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      sec.table.rows.map((r) => '<tr>' + r.map((c, i) => (i ? '<td>' : '<th scope="row">') + esc(c) + (i ? '</td>' : '</th>')).join('') + '</tr>').join('') + '</tbody></table></div>');
  }
  if (sec.note) parts.push('<p class="pnote">' + esc(sec.note) + '</p>');
  return '<section class="pblock">' + parts.join('\n') + '</section>';
}

/** Free-quote form (saved as a CRM lead by page.js). */
function quoteAside(title, text) {
  return `<aside class="pside" aria-label="Free quote">
        <form id="quote" class="pform" @submit.prevent="send()" novalidate>
          <template x-if="!sent">
            <div class="stack-sm">
              <span class="eyebrow">Free · No obligation</span>
              <h2>${esc(title || 'Get a free quote')}</h2>
              <p>${esc(text || 'An engineer checks your site, usage and subsidy eligibility, then sends a clear quotation.')}</p>
              <div class="form-error" x-show="error" x-text="error" role="alert"></div>
              <label>Your name<input x-model="f.name" autocomplete="name" required></label>
              <label>Mobile number<input x-model="f.phone" type="tel" inputmode="numeric" autocomplete="tel-national" required></label>
              <label>Town / district<input x-model="f.district" autocomplete="address-level2"></label>
              <label>Anything we should know? <small>optional</small><textarea x-model="f.note" rows="3"></textarea></label>
              <label class="hp" aria-hidden="true">Website<input x-model="f.website" tabindex="-1" autocomplete="off"></label>
              <button class="btn btn-accent avn-shine" type="submit" :disabled="sending" x-text="sending ? 'Sending…' : 'Request my free quote'">Request my free quote</button>
            </div>
          </template>
          <template x-if="sent">
            <div class="stack-sm" style="align-items:center;text-align:center;padding:16px 0">
              <span class="tick big"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
              <h2>Thank you!</h2>
              <p>We will call you shortly. Keep your last EB bill handy.</p>
            </div>
          </template>
        </form>
      </aside>`;
}

/** Header, menu, footer and contact buttons around a page's <main>. */
function chrome(s, current, main) {
  const brand = esc(s.brand_name || 'AVN Solar');
  const phone = tel(s.phone);
  const wa = digits(s.whatsapp || s.phone).length === 10;
  const menu = [['/', 'Home']].concat(SERVICES.map((x) => ['/' + x.slug, x.nav]), [['/blog', 'Blog']]);
  return `<header class="header" :class="scrolled && 'scrolled'">
  <div class="progress" aria-hidden="true"><div class="avn-progress"></div></div>
  <div class="wrap">
    <a class="logo" href="/"><img src="/assets/logo.png" alt="${brand} logo" width="64" height="64"><b>${brand}</b></a>
    <nav class="nav" aria-label="Main">${serviceLinks(current, true)}${blogLink(current)}</nav>
    <div class="header-actions">
      <a class="btn btn-accent btn-sm" href="#quote"><span class="cta-long">Get free quote</span><span class="cta-short">Free quote</span></a>
      <button type="button" class="menu-btn" @click="menu = true" aria-label="Open menu" :aria-expanded="menu.toString()" aria-controls="msheet"><span></span><span></span><span></span></button>
    </div>
  </div>
</header>

<div class="msheet" id="msheet" x-show="menu" x-cloak x-transition.opacity.duration.250ms @keydown.escape.window="menu = false" role="dialog" aria-modal="true" aria-label="Menu">
  <div class="msheet-panel" @click.outside="menu = false">
    <div class="msheet-top">
      <a class="logo" href="/"><img src="/assets/logo.png" alt="${brand} logo" width="52" height="52"><b>${brand}</b></a>
      <button type="button" class="msheet-x" @click="menu = false" aria-label="Close menu">✕</button>
    </div>
    <nav class="msheet-nav" aria-label="Menu">
      ${menu.map(([href, label], i) => '<a href="' + href + '" style="--d:' + (i * 45) + 'ms"><span>' + esc(label) + '</span>' + ARROW + '</a>').join('\n      ')}
    </nav>
    <div class="msheet-actions">
      <a class="btn btn-accent" href="#quote" @click="menu = false">Get my free quote</a>
      ${phone ? '<a class="btn btn-dark" href="tel:' + phone + '">' + PHONE + 'Call us</a>' : ''}
      ${wa ? '<a class="btn btn-wa" href="' + esc(waUrl(s, s.whatsapp_message)) + '" target="_blank" rel="noopener">WhatsApp</a>' : ''}
      <a class="btn btn-line" href="/portal/login">Customer login</a>
    </div>
  </div>
</div>

<main>
${main}
</main>

${footer(s, current)}

${wa ? '<a class="wa-float up" href="' + esc(waUrl(s, s.whatsapp_message)) + '" target="_blank" rel="noopener" aria-label="Chat with ' + brand + ' on WhatsApp">' + CHAT + '<span class="wa-label">WhatsApp</span></a>' : ''}
<nav class="mbar show" aria-label="Quick contact">
  ${phone ? '<a class="mb-call" href="tel:' + phone + '">' + PHONE + 'Call</a>' : ''}
  <a class="mb-quote" href="#quote">Get free quote</a>
</nav>`;
}

/** Body of a service page (between <body> and the scripts). */
function serviceBody(s, svc) {
  const brand = esc(s.brand_name || 'AVN Solar');
  const phone = tel(s.phone);
  const wa = digits(s.whatsapp || s.phone).length === 10;
  const others = SERVICES.filter((x) => x.slug !== svc.slug);
  const steps = STEPS.map(([t, d], i) => '<li><i>' + (i + 1) + '</i><div><b>' + esc(t) + '</b><span>' + esc(d) + '</span></div></li>').join('');
  return chrome(s, svc.slug, `  <section class="phero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><span aria-current="page">${esc(svc.nav)}</span></nav>
      <span class="eyebrow">${esc(svc.eyebrow)}</span>
      <h1>${esc(svc.h1)}</h1>
      <p class="pintro">${esc(svc.intro)}</p>
      <div class="pctas">
        <a class="btn btn-accent avn-shine" href="#quote">Get a free site survey</a>
        ${phone ? '<a class="btn btn-outline-light" href="tel:' + phone + '">' + PHONE + 'Call ' + esc(s.phone) + '</a>' : ''}
        ${wa ? '<a class="btn btn-wa" href="' + esc(waUrl(s, s.whatsapp_message)) + '" target="_blank" rel="noopener">' + CHAT + 'WhatsApp</a>' : ''}
      </div>
    </div>
  </section>

  <div class="section white pbody">
    <div class="wrap pgrid">
      <article class="pcontent">
        ${svc.sections.map(sectionHtml).join('\n        ')}
        <section class="pblock">
          <h2 class="h3x">How we work</h2>
          <ol class="psteps">${steps}</ol>
        </section>
      </article>
      ${quoteAside()}
    </div>
  </div>

  <section class="section pfaq">
    <div class="faq">
      <h2 class="h2" style="text-align:center;font-size:clamp(28px,3.4vw,42px)">Questions we hear often</h2>
      <div class="faq-list">${faqHtml(svc.faq.map((i) => FAQ[i]))}</div>
    </div>
  </section>

  <section class="section white prelated" aria-label="Other services">
    <div class="wrap">
      <h2 class="h2" style="font-size:clamp(26px,3vw,38px)">More from ${brand}</h2>
      <div class="prel">${others.map((x) => '<a href="/' + x.slug + '"><span class="eyebrow">' + esc(x.eyebrow) + '</span><b>' + esc(x.h1) + '</b><span class="go">Learn more →</span></a>').join('')}</div>
    </div>
  </section>`);
}

/* ------------------------------------------------------------------ Blog */

const isoOf = (sql) => (sql ? sql.replace(' ', 'T') + 'Z' : null);
const dateLabel = (sql) => (sql ? new Date(isoOf(sql)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

function blogCard(p, level) {
  const img = p.cover_name
    ? '<img src="/media/' + esc(p.cover_name) + '" alt="' + esc(p.cover_alt || '') + '" loading="lazy" decoding="async" width="800" height="450">'
    : '<span class="bph" aria-hidden="true"><img src="/assets/logo.png" alt="" width="72" height="72" loading="lazy"></span>';
  const tag = blog.tagsOf(p)[0];
  const h = level || 'h3';
  return `<article class="bcard">
  <a class="bimg" href="/blog/${esc(p.slug)}" tabindex="-1" aria-hidden="true">${img}</a>
  <div class="bcopy">
    <span class="bmeta">${tag ? '<span class="btag">' + esc(tag) + '</span>' : ''}<time datetime="${isoOf(p.published_at)}">${dateLabel(p.published_at)}</time> · ${blog.readingMinutes(p.body)} min read</span>
    <${h}><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></${h}>
    <p>${esc(blog.summary(p, 150))}</p>
  </div>
</article>`;
}

/** "From the blog" on the homepage — nothing until the first post is live. */
function latestPostsHtml(posts) {
  if (!posts.length) return '';
  return `<section class="section bhome" id="blog" aria-labelledby="blog-h">
  <div class="wrap">
    <div class="bhome-head">
      <div><span class="eyebrow">From the blog</span><h2 class="h2" id="blog-h">Solar, explained simply.</h2></div>
      <a class="btn btn-line" href="/blog">All articles →</a>
    </div>
    <div class="bgrid">${posts.map((p) => blogCard(p)).join('\n')}</div>
  </div>
</section>`;
}

function blogListBody(s, { posts, page, pages, tag, tags }) {
  const qs = (n) => '/blog' + (tag || n > 1 ? '?' + [tag ? 'tag=' + encodeURIComponent(tag) : '', n > 1 ? 'page=' + n : ''].filter(Boolean).join('&') : '');
  const chips = tags.length ? '<nav class="btags" aria-label="Topics"><a href="/blog"' + (!tag ? ' aria-current="page"' : '') + '>All</a>' +
    tags.map((t) => '<a href="/blog?tag=' + encodeURIComponent(t.slug) + '"' + (tag === t.slug ? ' aria-current="page"' : '') + '>' + esc(t.name) + '</a>').join('') + '</nav>' : '';
  const grid = posts.length ? '<div class="bgrid">' + posts.map((p) => blogCard(p, 'h2')).join('\n') + '</div>'
    : '<div class="bempty"><b>' + (tag ? 'No articles on this topic yet.' : 'Our first articles are on the way.') + '</b><p>Meanwhile, ask us anything about solar for your home, business or farm — we reply the same day.</p><a class="btn btn-accent" href="#quote">Ask an engineer</a></div>';
  const pager = pages > 1 ? '<nav class="bpager" aria-label="Pages">' + (page > 1 ? '<a class="btn btn-line" rel="prev" href="' + qs(page - 1) + '">← Newer</a>' : '<span></span>') +
    '<span>Page ' + page + ' of ' + pages + '</span>' + (page < pages ? '<a class="btn btn-line" rel="next" href="' + qs(page + 1) + '">Older →</a>' : '<span></span>') + '</nav>' : '';
  const tagName = tag ? (tags.find((t) => t.slug === tag) || {}).name : '';
  return chrome(s, 'blog', `  <section class="phero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span>${tag ? '<a href="/blog">Blog</a><span aria-hidden="true">›</span><span aria-current="page">' + esc(tagName || tag) + '</span>' : '<span aria-current="page">Blog</span>'}</nav>
      <span class="eyebrow">Blog</span>
      <h1>${tagName ? esc(tagName) : 'Solar guides, subsidy updates and project stories'}</h1>
      <p class="pintro">Plain-language answers about rooftop solar in Tamil Nadu — costs, the PM Surya Ghar subsidy, net metering, batteries and keeping panels at their best.</p>
    </div>
  </section>

  <section class="section white blist">
    <div class="wrap">
      ${chips}
      ${grid}
      ${pager}
    </div>
  </section>

  <div class="section pbody bcta">
    <div class="wrap pgrid">
      <div class="pcontent">
        <section class="pblock">
          <span class="eyebrow">Talk to an engineer</span>
          <h2 class="h3x">Have a question the articles don’t answer?</h2>
          <p>Tell us about your roof, your EB bill or your farm. An AVN engineer calls you back, checks your subsidy eligibility and gives you a straight answer — no obligation.</p>
          <ul class="ticks"><li>Free site survey</li><li>PM Surya Ghar paperwork handled</li><li>Tamil and English support</li></ul>
        </section>
      </div>
      ${quoteAside('Ask us anything')}
    </div>
  </div>`);
}

function postBody(s, p, related, preview) {
  const tags = blog.tagsOf(p);
  const url = siteUrl(s) + '/blog/' + p.slug;
  const share = 'https://wa.me/?text=' + encodeURIComponent(p.title + ' — ' + url);
  const cover = p.cover_name ? '<figure class="pcover"><img src="/media/' + esc(p.cover_name) + '" alt="' + esc(p.cover_alt || '') + '" width="1600" height="900" fetchpriority="high"></figure>' : '';
  return (preview ? '<div class="bpreview" role="status"><b>Preview</b> — ' + (blog.state(p) === 'Scheduled' ? 'scheduled for ' + dateLabel(p.published_at) + '. ' : 'this post is a draft. ') + 'Only signed-in staff can see this page.</div>\n' : '') +
  chrome(s, 'blog', `  <section class="phero bhero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><a href="/blog">Blog</a><span aria-hidden="true">›</span><span aria-current="page">${esc(p.title.length > 48 ? p.title.slice(0, 46) + '…' : p.title)}</span></nav>
      ${tags.length ? '<span class="eyebrow">' + tags.map(esc).join(' · ') + '</span>' : '<span class="eyebrow">Blog</span>'}
      <h1>${esc(p.title)}</h1>
      <p class="bbyline"><time datetime="${isoOf(p.published_at) || ''}">${dateLabel(p.published_at) || 'Not published yet'}</time> · ${blog.readingMinutes(p.body)} min read${p.author_name ? ' · ' + esc(p.author_name) : ''}</p>
    </div>
  </section>

  <div class="section white pbody">
    <div class="wrap pgrid">
      <article class="pcontent post">
        ${cover}
        <div class="prose">${blog.render(p.body)}</div>
        <div class="bshare">
          <span>Found this useful? Share it:</span>
          <a class="btn btn-wa btn-sm" href="${esc(share)}" target="_blank" rel="noopener">${CHAT}WhatsApp</a>
          <button type="button" class="btn btn-line btn-sm" @click="copyLink()" x-text="copied ? 'Link copied ✓' : 'Copy link'">Copy link</button>
        </div>
      </article>
      ${quoteAside('Want this for your roof?', 'Get a free site survey and a clear quotation, with the PM Surya Ghar subsidy worked out for you.')}
    </div>
  </div>

  ${related.length ? `<section class="section prelated bmore" aria-labelledby="more-h">
    <div class="wrap">
      <div class="bhome-head"><h2 class="h2" id="more-h" style="font-size:clamp(26px,3vw,38px)">Keep reading</h2><a class="btn btn-line" href="/blog">All articles →</a></div>
      <div class="bgrid">${related.map((r) => blogCard(r)).join('\n')}</div>
    </div>
  </section>` : ''}`);
}

module.exports = { faqHtml, footer, contactLine, serviceLinks, serviceBody, blogListBody, postBody, latestPostsHtml, SERVICES, FAQ };
