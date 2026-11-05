document.addEventListener('alpine:init', () => {
  Alpine.data('website', () => ({
    sections: [
      { id: 'hero', name: 'Hero video', desc: 'Plays behind the homepage headline. The first visible video is used.' },
      { id: 'gallery', name: 'Project gallery', desc: 'Photos and videos of finished sites.' },
      { id: 'solutions', name: 'Solution images', desc: 'Optional photos for Homes, Business, Industry, Farms (in that order).' },
      { id: 'brands', name: 'Brand ribbons', desc: 'Panel and inverter brands.' },
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
      if (id === 'brands') return this.brands.length + ' names';
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
    async addBrand(grp, ev) {
      const input = ev.target.elements.name;
      if (!input.value.trim()) return;
      try { this.brands.push(await AVN.post('/brands', { grp, name: input.value })); input.value = ''; } catch (e) { AVN.toast(e.message, true); }
    },
    async removeBrand(b) {
      try { await AVN.del('/brands/' + b.id); this.brands = this.brands.filter((x) => x.id !== b.id); } catch (e) { AVN.toast(e.message, true); }
    },
  }));
});
