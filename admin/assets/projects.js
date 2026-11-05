document.addEventListener('alpine:init', () => {
  Alpine.data('projects', () => ({
    stages: [], projects: [], team: [], clients: [], tab: 'active', q: '',
    tabs: [['active', 'Active'], ['done', 'Completed'], ['all', 'All']],
    projectTypes: ['Home rooftop', 'Commercial rooftop', 'Industrial rooftop', 'Ground-mount', 'Solar pump', 'Off-grid / hybrid', 'Care & AMC'],
    cur: null, view: null, newTask: '', docTitle: '', docVisible: true, uploading: false,
    formOpen: false, form: {}, error: '',

    async init() {
      await AVN.ready;
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
    },
    get list() {
      const q = this.q.trim().toLowerCase();
      return this.projects.filter((p) => (this.tab === 'all' || (this.tab === 'active' ? p.stage < 6 : p.stage >= 6)) &&
        (!q || (p.name + ' ' + p.place + ' ' + p.clientName).toLowerCase().includes(q)));
    },
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
    async select(id) {
      this.cur = await AVN.get('/projects/' + id);
      this.view = null;
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
        await this.load();
        AVN.toast('Project deleted');
      } catch (e) { AVN.toast(e.message, true); }
    },
    openForm(p) {
      this.error = '';
      this.form = p ? { id: p.id, name: p.name, place: p.place, kwp: p.kwp, type: p.type || 'Home rooftop', value: p.value ?? '', pmId: p.pmId || '', targetDate: p.targetDate, clientId: p.clientId || '' }
        : { name: '', place: '', kwp: '', type: 'Home rooftop', value: '', pmId: '', targetDate: '', clientId: '' };
      this.formOpen = true;
    },
    async saveForm() {
      this.error = '';
      const body = Object.assign({}, this.form, { pmId: this.form.pmId || null, clientId: this.form.clientId || null });
      try {
        const saved = this.form.id ? await AVN.patch('/projects/' + this.form.id, body) : await AVN.post('/projects', body);
        this.formOpen = false;
        await this.load();
        await this.select(saved.id);
        AVN.toast('Project saved');
      } catch (e) { this.error = e.message; }
    },
  }));
});
