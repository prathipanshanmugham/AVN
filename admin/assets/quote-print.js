document.addEventListener('alpine:init', () => {
  Alpine.data('printQuote', () => ({
    q: null, cfg: {}, error: '',
    async init() {
      await AVN.ready;
      const id = new URLSearchParams(location.search).get('id');
      if (!id) { this.error = 'No quotation selected.'; return; }
      try {
        const [q, cfg] = await Promise.all([AVN.get('/quotes/' + encodeURIComponent(id)), AVN.get('/settings')]);
        this.cfg = cfg;
        this.q = q;
        document.title = q.number + ' — ' + q.customerName;
        if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 600);
      } catch (e) { this.error = e.message; }
    },
    get t() { return QuoteCalc.totals(this.q); },
    get taxRows() { return this.t.taxLines.flatMap((l) => QuoteCalc.split(l, this.q.interstate)); },
    get terms() { return String(this.q.terms || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean); },
    money(n) { return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    num(n) { const v = Number(n) || 0; return v % 1 ? v.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : String(v); },
    d(iso) {
      if (!iso) return '';
      return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    },
  }));
});
