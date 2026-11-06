document.addEventListener('alpine:init', () => {
  Alpine.data('website', () => ({
    sections: [
      { id: 'hero', name: 'Hero — video & photos', desc: 'Behind the homepage headline. A visible video plays; with no visible video, the photos crossfade as a slideshow.' },
      { id: 'gallery', name: 'Project gallery', desc: 'Photos and videos of finished sites.' },
      { id: 'solutions', name: 'Solution images', desc: 'Optional photos for Homes, Business, Industry, Farms (in that order).' },
      { id: 'banner', name: 'Photo band', desc: 'Wide photos for the full-width “Your roof could be next” band. Several photos crossfade.' },
      { id: 'brands', name: 'Brand logos', desc: 'Panel and inverter logos in the two ribbons.' },
    ],
    brandGroups: [{ id: 'modules', name: 'Panel brands' }, { id: 'inverters', name: 'Inverter brands' }],
    sec: 'hero', items: [], brands: [], ffmpeg: false, selId: null, hot: false, uploading: false, poll: null,

    async init() {
      await AVN.ready;
      await Promise.all([this.load(), this.loadBrands()]);
    },
    async load() {
      const r = await AVN.get('/media');
      this.items = r.items;
      this.ffmpeg = r.ffmpeg;
      clearTimeout(this.poll);
      if (this.items.some((m) => m.status === 'processing')) this.poll = setTimeout(() => this.load(), 5000);
    },
    async loadBrands() { this.brands = await AVN.get('/brands'); },
    count(id) {
      if (id === 'brands') return this.brands.filter((b) => b.logo).length + ' / ' + this.brands.length + ' logos';
      return this.items.filter((m) => m.section === id).length + ' files';
    },
    get sectionItems() { return this.items.filter((m) => m.section === this.sec); },
    get cur() {
      const list = this.sectionItems;
      return list.find((m) => m.id === this.selId) || list[0] || null;
    },
    async upload(files) {
      if (!files || !files.length) return;
      this.uploading = true;
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('section', this.sec);
        try {
          const m = await AVN.post('/media', fd);
          this.selId = m.id;
          AVN.toast(m.status === 'processing' ? 'Video uploaded — compressing in the background' : 'Photo uploaded');
        } catch (e) { AVN.toast(f.name + ': ' + e.message, true); }
      }
      this.uploading = false;
      await this.load();
    },
    async save(patch) {
      const c = this.cur;
      if (!c) return;
      try {
        const m = await AVN.patch('/media/' + c.id, patch);
        Object.assign(c, m);
        if (patch.section) { this.sec = patch.section; this.selId = c.id; }
        AVN.toast('Saved');
      } catch (e) { AVN.toast(e.message, true); }
    },
    async move(dir) {
      try { await AVN.post('/media/' + this.cur.id + '/move', { dir }); await this.load(); } catch (e) { AVN.toast(e.message, true); }
    },
    async remove() {
      if (!confirm('Delete "' + this.cur.title + '" from the website?')) return;
      try { await AVN.del('/media/' + this.cur.id); this.selId = null; await this.load(); AVN.toast('Deleted'); } catch (e) { AVN.toast(e.message, true); }
    },
    get mediaSections() { return this.sections.filter((s) => s.id !== 'brands'); },
    brandsIn(grp) { return this.brands.filter((b) => b.grp === grp); },
    async addBrand(grp, ev) {
      const input = ev.target.elements.name;
      if (!input.value.trim()) return;
      try { this.brands.push(await AVN.post('/brands', { grp, name: input.value })); input.value = ''; } catch (e) { AVN.toast(e.message, true); }
    },
    async removeBrand(b) {
      if (!confirm('Remove ' + b.name + ' from the ribbon?')) return;
      try { await AVN.del('/brands/' + b.id); this.brands = this.brands.filter((x) => x.id !== b.id); } catch (e) { AVN.toast(e.message, true); }
    },
    async renameBrand(b, name) {
      if (!name.trim() || name === b.name) return;
      try { Object.assign(b, await AVN.patch('/brands/' + b.id, { name })); AVN.toast('Renamed'); } catch (e) { AVN.toast(e.message, true); }
    },
    async moveBrand(b, dir) {
      try { await AVN.post('/brands/' + b.id + '/move', { dir }); await this.loadBrands(); } catch (e) { AVN.toast(e.message, true); }
    },
    async uploadLogo(b, file) {
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      b.busy = true;
      try { Object.assign(b, await AVN.post('/brands/' + b.id + '/logo', fd)); AVN.toast(b.name + ' logo saved'); } catch (e) { AVN.toast(e.message, true); }
      b.busy = false;
    },
    async removeLogo(b) {
      try { Object.assign(b, await AVN.del('/brands/' + b.id + '/logo')); } catch (e) { AVN.toast(e.message, true); }
    },
    // Several files at once: the file name picks the brand ("waaree.png" → Waaree), new names are added.
    async bulkLogos(grp, files) {
      if (!files || !files.length) return;
      this.uploading = true;
      let added = 0;
      let updated = 0;
      for (const f of files) {
        const fd = new FormData();
        fd.append('grp', grp);
        fd.append('file', f);
        try { const r = await AVN.post('/brands/logo-file', fd); if (r.created) added++; else updated++; } catch (e) { AVN.toast(f.name + ': ' + e.message, true); }
      }
      this.uploading = false;
      await this.loadBrands();
      AVN.toast([updated ? updated + ' logo(s) updated' : '', added ? added + ' brand(s) added' : ''].filter(Boolean).join(', ') || 'No logos saved');
    },
  }));
});
