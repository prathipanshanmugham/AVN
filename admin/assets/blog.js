/* Blog editor: Markdown articles with cover photo, topics, Google fields, drafts / scheduling / publishing. */
document.addEventListener('alpine:init', () => {
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  const plain = (md) => String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ').replace(/\s+/g, ' ').trim();
  // <input type="datetime-local"> works in local time; the server stores UTC.
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  Alpine.data('blog', () => ({
    posts: [], q: '', filter: 'All', loaded: false, cur: null, saved: {}, detailOpen: false, dirty: false, saving: false, creating: false,
    tab: 'write', previewHtml: '', uploading: false, imgUploading: false, hot: false, when: '', slugTouched: false, host: location.host,

    async init() {
      await AVN.ready;
      this.posts = await AVN.get('/blog');
      this.loaded = true;
      const id = Number(new URLSearchParams(location.search).get('id'));
      if (id) { await this.select(id); this.detailOpen = true; } else if (this.posts[0]) await this.select(this.posts[0].id);
      window.addEventListener('beforeunload', (e) => { if (this.dirty) { e.preventDefault(); e.returnValue = ''; } });
    },
    get list() {
      const q = this.q.trim().toLowerCase();
      return this.posts.filter((x) => (this.filter === 'All' || x.state === this.filter) && (!q || (x.title + ' ' + x.tags).toLowerCase().includes(q)));
    },
    get allTags() {
      const seen = new Set();
      this.posts.forEach((p) => String(p.tags || '').split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => seen.add(t)));
      return [...seen];
    },
    get plain() { return this.cur ? plain(this.cur.body) : ''; },
    get words() { return this.plain ? this.plain.split(' ').length : 0; },
    get minutes() { return Math.max(1, Math.round(this.words / 200)); },
    get stateLine() {
      const c = this.cur;
      if (!c) return '';
      if (c.state === 'Published') return 'Live since ' + fmt(c.publishedAt);
      if (c.state === 'Scheduled') return 'Goes live ' + fmt(c.publishedAt);
      return 'Only staff can see it';
    },
    day(iso) { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); },
    badge(state) { return { Published: 'green', Scheduled: 'amber', Draft: '' }[state] || ''; },

    async open(id) {
      if (this.dirty && this.cur && this.cur.id !== id && !confirm('Leave this post without saving?')) return;
      await this.select(id);
      this.detailOpen = true;
      window.scrollTo({ top: 0 });
    },
    back() { this.detailOpen = false; },
    async select(id) {
      try { this.load(await AVN.get('/blog/' + id)); } catch (e) { AVN.toast(e.message, true); }
    },
    load(p) {
      this.cur = Object.assign({}, p);
      this.saved = p;
      this.dirty = false;
      this.tab = 'write';
      this.when = p.state === 'Scheduled' ? toLocalInput(p.publishedAt) : '';
      this.slugTouched = !!p.publishedAt || p.slug !== slugify(p.title);
      history.replaceState(null, '', '?id=' + p.id);
    },
    upsert(p) {
      const i = this.posts.findIndex((x) => x.id === p.id);
      const row = { id: p.id, slug: p.slug, title: p.title, state: p.state, status: p.status, publishedAt: p.publishedAt, updatedAt: p.updatedAt, cover: p.cover, tags: p.tags };
      if (i >= 0) this.posts.splice(i, 1, row); else this.posts.unshift(row);
    },
    titleChanged() {
      // While a post has never gone live, its web address follows the title.
      if (!this.slugTouched) this.cur.slug = slugify(this.cur.title);
    },

    async create() {
      if (this.dirty && !confirm('Leave this post without saving?')) return;
      this.creating = true;
      try {
        const p = await AVN.post('/blog', { title: 'New post' });
        this.upsert(p);
        this.load(p);
        this.detailOpen = true;
        this.$nextTick(() => { const t = document.querySelector('.post-title'); if (t) { t.focus(); t.select(); } });
      } catch (e) { AVN.toast(e.message, true); } finally { this.creating = false; }
    },
    fields() {
      const c = this.cur;
      return { title: c.title, slug: c.slug, excerpt: c.excerpt, body: c.body, coverAlt: c.coverAlt, tags: c.tags,
        metaTitle: c.metaTitle, metaDescription: c.metaDescription, authorName: c.authorName };
    },
    async save(extra, message) {
      if (!this.cur || this.saving) return;
      this.saving = true;
      try {
        const p = await AVN.patch('/blog/' + this.cur.id, Object.assign(this.fields(), extra || {}));
        this.upsert(p);
        this.load(p);
        AVN.toast(message || 'Saved');
      } catch (e) { AVN.toast(e.message, true); } finally { this.saving = false; }
    },
    publish() { return this.save({ status: 'published', publishedAt: new Date().toISOString() }, 'Published — it is live on the blog'); },
    schedule() {
      const d = new Date(this.when);
      if (Number.isNaN(d.getTime())) return AVN.toast('Pick a date and time', true);
      if (d <= new Date()) return AVN.toast('Pick a time in the future, or use Publish now', true);
      return this.save({ status: 'published', publishedAt: d.toISOString() }, 'Scheduled for ' + fmt(d));
    },
    unpublish() { return this.save({ status: 'draft', publishedAt: null }, 'Moved back to drafts'); },
    async remove() {
      if (!confirm('Delete “' + this.cur.title + '”? This cannot be undone.')) return;
      try {
        await AVN.del('/blog/' + this.cur.id);
        this.posts = this.posts.filter((x) => x.id !== this.cur.id);
        this.dirty = false;
        this.cur = null;
        this.detailOpen = false;
        history.replaceState(null, '', location.pathname);
        AVN.toast('Post deleted');
      } catch (e) { AVN.toast(e.message, true); }
    },

    fileFrom(e) {
      const files = (e.dataTransfer && e.dataTransfer.files) || (e.target && e.target.files);
      const f = files && files[0];
      if (e.target && e.target.value !== undefined) e.target.value = '';
      return f;
    },
    async uploadCover(e) {
      const f = this.fileFrom(e);
      if (!f) return;
      if (this.dirty) await this.save();
      const fd = new FormData();
      fd.append('file', f);
      this.uploading = true;
      try {
        const p = await AVN.post('/blog/' + this.cur.id + '/cover', fd);
        this.upsert(p);
        this.cur.cover = p.cover;
        this.saved = Object.assign({}, this.saved, { cover: p.cover });
        AVN.toast('Cover photo added');
      } catch (err) { AVN.toast(err.message, true); } finally { this.uploading = false; }
    },
    async removeCover() {
      if (!confirm('Remove the cover photo?')) return;
      try {
        const p = await AVN.del('/blog/' + this.cur.id + '/cover');
        this.upsert(p);
        this.cur.cover = null;
      } catch (e) { AVN.toast(e.message, true); }
    },

    // ----- Markdown helpers (act on the selection in the article box)
    edit(fn) {
      const ta = this.$refs.body;
      const v = this.cur.body || '';
      const a = ta.selectionStart;
      const b = ta.selectionEnd;
      const r = fn(v, a, b);
      this.cur.body = r.text;
      this.dirty = true;
      this.$nextTick(() => { ta.focus(); ta.setSelectionRange(r.start, r.end); });
    },
    wrap(before, after, placeholder) {
      this.edit((v, a, b) => {
        const sel = v.slice(a, b) || placeholder;
        return { text: v.slice(0, a) + before + sel + after + v.slice(b), start: a + before.length, end: a + before.length + sel.length };
      });
    },
    line(prefix) {
      this.edit((v, a, b) => {
        const start = v.lastIndexOf('\n', a - 1) + 1;
        const end = v.indexOf('\n', b) === -1 ? v.length : v.indexOf('\n', b);
        const lines = v.slice(start, end).split('\n').map((l, i) => {
          const clean = l.replace(/^(#{1,6} |[-*] |\d+\. |> )/, '');
          return (prefix === '1. ' ? (i + 1) + '. ' : prefix) + clean;
        }).join('\n');
        const gapBefore = start > 0 && v[start - 2] !== '\n' && /^#/.test(prefix) ? '\n' : '';
        return { text: v.slice(0, start) + gapBefore + lines + v.slice(end), start: start + gapBefore.length + prefix.length, end: start + gapBefore.length + lines.length };
      });
    },
    link() {
      const url = prompt('Link to (a web address, or a page like /rooftop-solar-for-homes):', 'https://');
      if (!url || url === 'https://') return;
      this.wrap('[', '](' + url.trim() + ')', 'link text');
    },
    async insertImage(e) {
      const f = this.fileFrom(e);
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      this.imgUploading = true;
      try {
        const r = await AVN.post('/blog/images', fd);
        const alt = (prompt('Describe the photo (for Google and screen readers):', '') || '').replace(/[[\]]/g, '');
        this.edit((v, a) => {
          const md = '\n\n![' + alt + '](' + r.url + ')\n\n';
          return { text: v.slice(0, a) + md + v.slice(a), start: a + md.length, end: a + md.length };
        });
      } catch (err) { AVN.toast(err.message, true); } finally { this.imgUploading = false; }
    },
    async showPreview() {
      this.tab = 'preview';
      try { this.previewHtml = (await AVN.post('/blog/preview', { body: this.cur.body })).html || '<p class="muted">Nothing written yet.</p>'; } catch (e) { AVN.toast(e.message, true); }
    },
  }));
});
