document.addEventListener('alpine:init', () => {
  const PRESETS = [
    { label: 'Elevated structure', desc: 'Elevated mounting structure (extra height)', hsn: '7308', qty: 1, unit: 'Lot', rate: 0, gst: 18 },
    { label: 'Battery', desc: 'Solar battery bank', hsn: '8507', qty: 1, unit: 'Set', rate: 0, gst: 18 },
    { label: 'Net-meter fee', desc: 'EB net-meter and registration charges (at actuals)', hsn: '9987', qty: 1, unit: 'Lot', rate: 0, gst: 18 },
    { label: 'AMC', desc: 'Annual maintenance contract — panel cleaning and periodic checks', hsn: '9987', qty: 1, unit: 'Year', rate: 0, gst: 18 },
  ];

  Alpine.data('quotes', () => ({
    quotes: [], statuses: ['Draft', 'Sent', 'Accepted', 'Rejected'], q: '', status: 'All', loaded: false,
    segments: ['Home', 'Business', 'Industry', 'Farm'], systems: ['On-grid', 'Hybrid', 'Off-grid'], GST_RATES: QuoteCalc.GST_RATES,
    presets: PRESETS, cfg: {}, isAdmin: false,
    cur: null, dirty: false, saving: false, creating: false, form: {}, error: '',

    async init() {
      await AVN.ready;
      this.isAdmin = Alpine.store('app').user.role === 'admin';
      const [list, cfg] = await Promise.all([AVN.get('/quotes'), AVN.get('/settings')]);
      this.quotes = list.quotes;
      this.statuses = list.statuses;
      this.cfg = cfg;
      this.loaded = true;
      const id = new URLSearchParams(location.search).get('id');
      if (id) await this.select(Number(id));
      else if (this.quotes[0]) await this.select(this.quotes[0].id);
      window.addEventListener('beforeunload', (e) => { if (this.dirty) { e.preventDefault(); e.returnValue = ''; } });
    },
    get hasRates() { return ['rate_ongrid', 'rate_hybrid', 'rate_offgrid'].some((k) => Number(this.cfg[k]) > 0); },
    get list() {
      const q = this.q.trim().toLowerCase();
      return this.quotes.filter((x) => (this.status === 'All' || this.statusLabel(x) === this.status || x.status === this.status) &&
        (!q || (x.customerName + ' ' + x.number + ' ' + x.place + ' ' + x.customerPhone).toLowerCase().includes(q)));
    },
    isExpired(x) { return x.status !== 'Accepted' && x.status !== 'Rejected' && x.validUntil && AVN.daysFromToday(x.validUntil) < 0; },
    statusLabel(x) { return this.isExpired(x) ? 'Expired' : x.status; },
    badge(x) {
      const s = this.statusLabel(x);
      return { Accepted: 'green', Sent: 'amber', Rejected: 'red', Expired: 'red' }[s] || '';
    },
    get expired() { return this.cur && this.isExpired(this.cur); },
    get t() { return this.cur ? QuoteCalc.totals(this.cur) : {}; },
    get taxRows() {
      if (!this.cur) return [];
      return this.t.taxLines.flatMap((l) => QuoteCalc.split(l, this.cur.interstate));
    },
    get waNumber() { return this.cur ? String(this.cur.customerPhone || '').replace(/\D/g, '').slice(-10) : ''; },
    get waShare() {
      const c = this.cur;
      if (!c) return '#';
      const t = this.t;
      const brand = this.cfg.brand_name || 'AVN Solar';
      const lines = [
        'Dear ' + c.customerName + ',',
        'Thank you for choosing ' + brand + '. Here is our quotation ' + c.number + ' for a ' + c.kwp + ' kWp ' + c.systemType.toLowerCase() + ' solar system:',
        'Total: ' + QuoteCalc.inr(t.total) + ' (including GST)',
      ];
      if (t.subsidy) lines.push('Expected PM Surya Ghar subsidy: ' + QuoteCalc.inr(t.subsidy) + ' → effective cost ' + QuoteCalc.inr(t.effective));
      if (c.validUntil) lines.push('Valid till ' + AVN.date(c.validUntil) + '.');
      lines.push('We are sharing the detailed PDF here. Happy to answer any questions.');
      lines.push('— ' + brand + (this.cfg.phone ? ', ' + this.cfg.phone : ''));
      return 'https://wa.me/91' + this.waNumber + '?text=' + encodeURIComponent(lines.join('\n'));
    },

    async select(id) {
      if (this.dirty && this.cur && this.cur.id !== id && !confirm('Discard unsaved changes to ' + this.cur.number + '?')) return;
      try {
        this.cur = await AVN.get('/quotes/' + id);
        this.dirty = false;
        history.replaceState(null, '', '/admin/quotes?id=' + id);
      } catch (e) { AVN.toast(e.message, true); }
    },
    body() {
      const c = this.cur;
      return {
        customerName: c.customerName, customerPhone: c.customerPhone, customerEmail: c.customerEmail, customerAddress: c.customerAddress,
        customerGstin: c.customerGstin, place: c.place, segment: c.segment, systemType: c.systemType, kwp: c.kwp, date: c.date,
        validUntil: c.validUntil, items: c.items, bom: c.bom, taxMode: c.taxMode, interstate: c.interstate, discount: c.discount,
        subsidy: c.subsidy, notes: c.notes, terms: c.terms, status: c.status,
      };
    },
    async save() {
      if (!this.cur) return false;
      this.saving = true;
      try {
        this.cur = await AVN.patch('/quotes/' + this.cur.id, this.body());
        this.dirty = false;
        this.replaceInList(this.cur);
        AVN.toast('Quotation saved');
        return true;
      } catch (e) { AVN.toast(e.message, true); return false; } finally { this.saving = false; }
    },
    async printClick(ev) {
      if (!this.dirty) return;
      ev.preventDefault();
      const win = window.open('about:blank', '_blank');
      if (await this.save()) { if (win) win.location = '/admin/quote-print?id=' + this.cur.id; } else if (win) win.close();
    },
    replaceInList(full) {
      const i = this.quotes.findIndex((x) => x.id === full.id);
      if (i >= 0) this.quotes.splice(i, 1, full); else this.quotes.unshift(full);
    },
    addLine(p) {
      this.cur.items.push(Object.assign({ desc: '', hsn: '', qty: 1, unit: 'Nos', rate: 0, gst: 18 }, p ? { desc: p.desc, hsn: p.hsn, qty: p.qty, unit: p.unit, rate: p.rate, gst: p.gst } : {}));
      this.dirty = true;
    },
    async refill() {
      if (!confirm('Replace the price lines and scope of supply with fresh ones for ' + this.cur.kwp + ' kWp ' + this.cur.systemType + '?')) return;
      if (this.dirty && !(await this.save())) return;
      try { this.cur = await AVN.post('/quotes/' + this.cur.id + '/refill'); this.replaceInList(this.cur); AVN.toast('Lines refilled from rates'); } catch (e) { AVN.toast(e.message, true); }
    },
    async duplicate() {
      if (this.dirty && !(await this.save())) return;
      try {
        const copy = await AVN.post('/quotes/' + this.cur.id + '/duplicate');
        this.quotes.unshift(copy);
        await this.select(copy.id);
        AVN.toast('Revised copy ' + copy.number + ' created');
      } catch (e) { AVN.toast(e.message, true); }
    },
    async remove() {
      if (!confirm('Delete quotation ' + this.cur.number + '? This cannot be undone.')) return;
      try {
        await AVN.del('/quotes/' + this.cur.id);
        this.quotes = this.quotes.filter((x) => x.id !== this.cur.id);
        this.cur = null;
        this.dirty = false;
        history.replaceState(null, '', '/admin/quotes');
        AVN.toast('Quotation deleted');
      } catch (e) { AVN.toast(e.message, true); }
    },
    openNew() {
      this.error = '';
      this.form = { customerName: '', customerPhone: '', place: '', kwp: '', systemType: 'On-grid', segment: 'Home' };
      this.creating = true;
    },
    async create() {
      this.error = '';
      try {
        const qte = await AVN.post('/quotes', this.form);
        this.creating = false;
        this.quotes.unshift(qte);
        this.dirty = false;
        await this.select(qte.id);
        AVN.toast('Quotation ' + qte.number + ' created');
      } catch (e) { this.error = e.message; }
    },
  }));
});
