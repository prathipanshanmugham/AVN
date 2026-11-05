document.addEventListener('alpine:init', () => {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  Alpine.data('calendar', () => ({
    types: [
      { id: 'visit', name: 'Site visit' }, { id: 'install', name: 'Installation' }, { id: 'eb', name: 'EB / approvals' },
      { id: 'deadline', name: 'Deadline' }, { id: 'meeting', name: 'Meeting' },
    ],
    colors: ['yellow', 'blue', 'green', 'pink', 'white'],
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    year: new Date().getFullYear(), month: new Date().getMonth(), today: AVN.today(), selected: AVN.today(),
    events: [], deadlines: [], notes: [], noteTitle: '',
    ev: { title: '', type: 'visit', time: '', who: '' },

    async init() {
      await AVN.ready;
      await Promise.all([this.loadEvents(), this.loadDeadlines(), this.loadNotes()]);
    },
    get monthLabel() { return MONTHS[this.month] + ' ' + this.year; },
    get range() {
      const first = new Date(this.year, this.month, 1);
      const start = new Date(first);
      start.setDate(1 - ((first.getDay() + 6) % 7));
      const days = Math.ceil((((first.getDay() + 6) % 7) + new Date(this.year, this.month + 1, 0).getDate()) / 7) * 7;
      const end = new Date(start);
      end.setDate(start.getDate() + days - 1);
      return { start, days, from: iso(start), to: iso(end) };
    },
    get cells() {
      const { start, days } = this.range;
      const out = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = iso(d);
        const events = this.events.filter((e) => e.date === key);
        out.push({ iso: key, day: d.getDate(), inMonth: d.getMonth() === this.month, events,
          label: d.getDate() + ' ' + MONTHS[d.getMonth()] + (events.length ? ', ' + events.length + ' event(s)' : '') });
      }
      return out;
    },
    get dayEvents() { return this.events.filter((e) => e.date === this.selected); },
    get selectedLabel() {
      const d = new Date(this.selected + 'T00:00:00');
      return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    },
    typeName(id) { const t = this.types.find((x) => x.id === id); return t ? t.name : id; },
    async loadEvents() { this.events = await AVN.get('/events?from=' + this.range.from + '&to=' + this.range.to); },
    async loadDeadlines() { this.deadlines = await AVN.get('/deadlines'); },
    async loadNotes() { this.notes = await AVN.get('/checklists'); },
    shift(n) {
      const d = new Date(this.year, this.month + n, 1);
      this.year = d.getFullYear(); this.month = d.getMonth();
      this.selected = iso(d);
      this.loadEvents();
    },
    goToday() {
      const d = new Date();
      this.year = d.getFullYear(); this.month = d.getMonth(); this.selected = AVN.today();
      this.loadEvents();
    },
    pick(c) {
      this.selected = c.iso;
      if (!c.inMonth) { const d = new Date(c.iso + 'T00:00:00'); this.year = d.getFullYear(); this.month = d.getMonth(); this.loadEvents(); }
    },
    deadlineLabel(d) {
      const n = AVN.daysFromToday(d.date);
      if (n < 0) return 'Overdue';
      if (n === 0) return 'Today';
      return 'In ' + n + ' day' + (n > 1 ? 's' : '');
    },
    deadlineClass(d) {
      const n = AVN.daysFromToday(d.date);
      return n < 0 ? 'red' : (n <= 2 ? 'amber' : 'dark');
    },
    async addEvent() {
      try {
        const e = await AVN.post('/events', Object.assign({}, this.ev, { date: this.selected }));
        this.events.push(e);
        this.ev = { title: '', type: this.ev.type, time: '', who: '' };
        if (e.type === 'deadline') this.loadDeadlines();
        AVN.toast('Event added');
      } catch (err) { AVN.toast(err.message, true); }
    },
    async toggleEvent(e) {
      try { const r = await AVN.patch('/events/' + e.id, { done: !e.done }); e.done = r.done; if (e.type === 'deadline') this.loadDeadlines(); } catch (err) { AVN.toast(err.message, true); }
    },
    async removeEvent(e) {
      if (!confirm('Delete "' + e.title + '"?')) return;
      try { await AVN.del('/events/' + e.id); this.events = this.events.filter((x) => x.id !== e.id); this.loadDeadlines(); } catch (err) { AVN.toast(err.message, true); }
    },
    async addNote() {
      if (!this.noteTitle.trim()) return;
      try { this.notes.unshift(await AVN.post('/checklists', { title: this.noteTitle })); this.noteTitle = ''; } catch (err) { AVN.toast(err.message, true); }
    },
    async setNote(n, patch) {
      try { Object.assign(n, await AVN.patch('/checklists/' + n.id, patch)); } catch (err) { AVN.toast(err.message, true); }
    },
    async removeNote(n) {
      if (!confirm('Delete the checklist "' + n.title + '"?')) return;
      try { await AVN.del('/checklists/' + n.id); this.notes = this.notes.filter((x) => x.id !== n.id); } catch (err) { AVN.toast(err.message, true); }
    },
    async addItem(n, ev) {
      const input = ev.target.elements.label;
      if (!input.value.trim()) return;
      try { n.items.push(await AVN.post('/checklists/' + n.id + '/items', { label: input.value })); input.value = ''; } catch (err) { AVN.toast(err.message, true); }
    },
    async toggleItem(it) {
      try { const r = await AVN.patch('/checklist-items/' + it.id, { done: !it.done }); it.done = r.done; } catch (err) { AVN.toast(err.message, true); }
    },
    async removeItem(n, it) {
      try { await AVN.del('/checklist-items/' + it.id); n.items = n.items.filter((x) => x.id !== it.id); } catch (err) { AVN.toast(err.message, true); }
    },
  }));
});
