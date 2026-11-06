document.addEventListener('alpine:init', () => {
  Alpine.data('projects', () => ({
    stages: [], projects: [], team: [], clients: [], tab: 'active', q: '',
    tabs: [['active', 'Active'], ['done', 'Completed'], ['all', 'All']],
    projectTypes: ['Home rooftop', 'Commercial rooftop', 'Industrial rooftop', 'Ground-mount', 'Solar pump', 'Off-grid / hybrid', 'Care & AMC'],
    cur: null, view: null, newTask: '', docTitle: '', docVisible: true, uploading: false,
    formOpen: false, form: {}, error: '',
    detailOpen: false, fields: [], assetKinds: [], systemTypes: ['On-grid', 'Hybrid', 'Off-grid'], group: 'site', det: {}, detDirty: false, savingDet: false,
    af: { kind: 'Module', make: '', model: '', serials: '' }, addingAssets: false, allAssets: false, serialHits: [], searchTimer: null,

    async init() {
      await AVN.ready;
      this.$watch('q', (v) => {
        clearTimeout(this.searchTimer);
        const term = v.trim();
        if (term.length < 4) { this.serialHits = []; return; }
        this.searchTimer = setTimeout(async () => {
          try { this.serialHits = await AVN.get('/assets/search?q=' + encodeURIComponent(term)); } catch (e) { this.serialHits = []; }
        }, 300);
      });
      window.addEventListener('beforeunload', (e) => { if (this.detDirty) { e.preventDefault(); e.returnValue = ''; } });
      await this.load();
      this.team = await AVN.get('/team');
      if (Alpine.store('app').perms.clients) this.clients = await AVN.get('/clients');
      const first = this.list[0];
      if (first) this.select(first.id);
    },
    async load() {
      const r = await AVN.get('/projects');
      this.stages = r.stages;
      this.projects = r.projects;
      this.assetKinds = r.assetKinds || [];
      if (r.systemTypes) this.systemTypes = r.systemTypes;
      this.fields = (r.fields || []).map((g) => ({
        id: g.id, name: g.name,
        fields: g.fields.map(([key, label, type, options]) => ({ key, label, type: type || 'text', options: options || [] })),
      }));
    },
    // Project record
    get groupFields() { const g = this.fields.find((x) => x.id === this.group); return g ? g.fields : []; },
    filled(g) { return g.fields.filter((f) => this.det[f.key]).length; },
    get filledTotal() { return this.fields.reduce((a, g) => a + this.filled(g), 0); },
    get fieldTotal() { return this.fields.reduce((a, g) => a + g.fields.length, 0); },
    switchGroup(id) {
      if (this.detDirty && !confirm('You have unsaved changes in this section. Switch anyway?')) return;
      if (this.detDirty) { this.det = Object.assign({}, this.cur.project.details); this.detDirty = false; }
      this.group = id;
    },
    async saveDetails() {
      const body = {};
      this.groupFields.forEach((f) => { body[f.key] = this.det[f.key] == null ? '' : String(this.det[f.key]); });
      this.savingDet = true;
      try {
        const r = await AVN.put('/projects/' + this.cur.project.id + '/details', body);
        this.cur.project.details = r.details;
        this.det = Object.assign({}, r.details);
        this.detDirty = false;
        AVN.toast('Details saved');
      } catch (e) { AVN.toast(e.message, true); }
      this.savingDet = false;
    },
    // Serial numbers
    get serialList() { return [...new Set(String(this.af.serials || '').split(/[\r\n,;\t]+/).map((x) => x.trim().replace(/\s+/g, '')).filter(Boolean))]; },
    get serialCount() { return this.serialList.length; },
    get shownAssets() { return this.allAssets ? this.cur.assets : this.cur.assets.slice(0, 12); },
    get assetSummary() {
      const c = {};
      (this.cur ? this.cur.assets : []).forEach((a) => { c[a.kind] = (c[a.kind] || 0) + 1; });
      return Object.entries(c);
    },
    prefillMake() {
      const d = (this.cur && this.cur.project.details) || {};
      const map = { Module: ['module_make', 'module_model'], Inverter: ['inverter_make', 'inverter_model'] }[this.af.kind];
      this.af.make = map ? d[map[0]] || '' : '';
      this.af.model = map ? d[map[1]] || '' : '';
    },
    async addAssets() {
      if (!this.serialCount) return;
      this.addingAssets = true;
      try {
        const r = await AVN.post('/projects/' + this.cur.project.id + '/assets', { kind: this.af.kind, make: this.af.make, model: this.af.model, serials: this.serialList });
        this.af.serials = '';
        this.cur = await AVN.get('/projects/' + this.cur.project.id);
        if (r.skipped.length) {
          const where = r.skipped.slice(0, 3).map((x) => x.serial + (x.projectId === this.cur.project.id ? ' (already here)' : ' (on ' + x.projectName + ')')).join(', ');
          AVN.toast('Added ' + r.added + '. Skipped ' + r.skipped.length + ' already recorded: ' + where + (r.skipped.length > 3 ? '…' : ''), true);
        } else AVN.toast('Added ' + r.added + ' serial number' + (r.added === 1 ? '' : 's'));
      } catch (e) { AVN.toast(e.message, true); }
      this.addingAssets = false;
    },
    async removeAsset(a) {
      if (!confirm('Remove serial ' + a.serial + '?')) return;
      try { await AVN.del('/assets/' + a.id); this.cur.assets = this.cur.assets.filter((x) => x.id !== a.id); } catch (e) { AVN.toast(e.message, true); }
    },
    get list() {
      const q = this.q.trim().toLowerCase();
      return this.projects.filter((p) => (this.tab === 'all' || (this.tab === 'active' ? p.stage < 6 : p.stage >= 6)) &&
        (!q || (p.name + ' ' + p.place + ' ' + p.clientName).toLowerCase().includes(q)));
    },
    sizeText(p) { return p.capacityKw ? (Math.round(p.capacityKw * 100) / 100) + ' kWp' : (p.kwp || ''); },
    stageName(s) { return s >= 6 ? 'Handed over' : this.stages[s]; },
    pct(p) { return Math.round(Math.min(p.stage, 6) / 6 * 100); },
    late(p) { return p.stage < 6 && p.targetDate && AVN.daysFromToday(p.targetDate) < 0; },
    dueText(p) {
      if (p.stage >= 6) return 'Done';
      if (!p.targetDate) return '';
      return (this.late(p) ? 'Late · ' : 'Due ') + AVN.date(p.targetDate);
    },
    get viewStage() {
      if (!this.cur) return 0;
      if (this.view !== null) return this.view;
      return Math.min(this.cur.project.stage, 5);
    },
    get stageTasks() { return this.cur ? this.cur.tasks.filter((t) => t.stage === this.viewStage) : []; },
    get stageDone() { return this.stageTasks.filter((t) => t.done).length; },
    // Phones show the list first; tapping a project opens its detail with a back button.
    async open(id) {
      await this.select(id);
      this.detailOpen = true;
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    async select(id) {
      if (this.detDirty && this.cur && this.cur.project.id !== id && !confirm('Discard unsaved project details?')) return;
      this.cur = await AVN.get('/projects/' + id);
      this.view = null;
      this.det = Object.assign({}, this.cur.project.details);
      this.detDirty = false;
      this.allAssets = false;
      this.af = { kind: 'Module', make: '', model: '', serials: '' };
      this.prefillMake();
    },
    async refresh() {
      await this.load();
      if (this.cur) this.cur = await AVN.get('/projects/' + this.cur.project.id);
    },
    async toggle(t) {
      try {
        const r = await AVN.patch('/tasks/' + t.id, { done: !t.done });
        t.done = r.done;
      } catch (e) { AVN.toast(e.message, true); }
    },
    async addTask() {
      if (!this.newTask.trim()) return;
      try {
        const t = await AVN.post('/projects/' + this.cur.project.id + '/tasks', { stage: this.viewStage, label: this.newTask });
        this.cur.tasks.push(t);
        this.newTask = '';
      } catch (e) { AVN.toast(e.message, true); }
    },
    async advance() {
      const open = this.stageTasks.filter((t) => !t.done).length;
      if (open && !confirm(open + ' task(s) in this stage are not ticked. Complete the stage anyway?')) return;
      try {
        await AVN.patch('/projects/' + this.cur.project.id, { stage: this.cur.project.stage + 1 });
        await this.refresh();
        this.view = null;
        AVN.toast('Stage completed');
      } catch (e) { AVN.toast(e.message, true); }
    },
    async upload(ev) {
      const fd = new FormData(ev.target);
      fd.set('clientVisible', this.docVisible ? '1' : '0');
      this.uploading = true;
      try {
        await AVN.post('/projects/' + this.cur.project.id + '/docs', fd);
        ev.target.reset();
        this.docTitle = '';
        await this.refresh();
        AVN.toast('Document uploaded');
      } catch (e) { AVN.toast(e.message, true); }
      this.uploading = false;
    },
    async toggleDoc(d) {
      try { await AVN.patch('/docs/' + d.id, { clientVisible: !d.clientVisible }); d.clientVisible = !d.clientVisible; } catch (e) { AVN.toast(e.message, true); }
    },
    async removeDoc(d) {
      if (!confirm('Delete "' + d.title + '"?')) return;
      try { await AVN.del('/docs/' + d.id); this.cur.docs = this.cur.docs.filter((x) => x.id !== d.id); } catch (e) { AVN.toast(e.message, true); }
    },
    async remove() {
      if (!confirm('Delete this project, its checklist and documents? This cannot be undone.')) return;
      try {
        await AVN.del('/projects/' + this.cur.project.id);
        this.cur = null;
        this.detailOpen = false;
        await this.load();
        AVN.toast('Project deleted');
      } catch (e) { AVN.toast(e.message, true); }
    },
    openForm(p, focusDrive) {
      this.error = '';
      this.form = p ? { id: p.id, name: p.name, place: p.place, kwp: p.kwp, type: p.type || 'Home rooftop', value: p.value ?? '', pmId: p.pmId || '', targetDate: p.targetDate, clientId: p.clientId || '', driveLink: p.driveLink || '',
        capacityKw: p.capacityKw ?? '', systemType: p.systemType || 'On-grid', stage: p.stage, completedAt: p.completedAt || '' }
        : { name: '', place: '', kwp: '', type: 'Home rooftop', value: '', pmId: '', targetDate: '', clientId: '', driveLink: '', capacityKw: '', systemType: 'On-grid', stage: 0, completedAt: '' };
      this.formOpen = true;
      if (focusDrive) this.$nextTick(() => this.$refs.drive && this.$refs.drive.focus());
    },
    async saveForm() {
      this.error = '';
      const body = Object.assign({}, this.form, { pmId: this.form.pmId || null, clientId: this.form.clientId || null, capacityKw: this.form.capacityKw === '' ? null : this.form.capacityKw });
      delete body.stage;
      if (!body.completedAt) delete body.completedAt;
      try {
        const saved = this.form.id ? await AVN.patch('/projects/' + this.form.id, body) : await AVN.post('/projects', body);
        this.formOpen = false;
        await this.load();
        await this.open(saved.id);
        AVN.toast('Project saved');
      } catch (e) { this.error = e.message; }
    },
  }));
});
