document.addEventListener('alpine:init', () => {
  Alpine.data('printQuote', () => ({
    q: null, cfg: {}, error: '', view: 'itemwise', FORMATS: QuoteCalc.FORMATS, showSummary: true,
    async init() {
      await AVN.ready;
      const id = new URLSearchParams(location.search).get('id');
      if (!id) { this.error = 'No quotation selected.'; return; }
      try {
        const [q, cfg] = await Promise.all([AVN.get('/quotes/' + encodeURIComponent(id)), AVN.get('/settings')]);
        this.cfg = cfg;
        this.q = q;
        const want = new URLSearchParams(location.search).get('format');
        this.view = QuoteCalc.FORMATS.some((f) => f[0] === want) ? want : (q.format || 'itemwise');
        const sum = new URLSearchParams(location.search).get('summary');
        this.showSummary = sum === '1' ? true : (sum === '0' ? false : this.summaryDefault());
        document.title = q.number + ' — ' + q.customerName;
        // On phones, show the A4 page scaled to fit, like a PDF preview.
        const fit = () => {
          const sheet = document.querySelector('.sheet');
          if (!sheet) return;
          // The wide page can stretch innerWidth on phones, so use the device width too.
          const vw = Math.min(window.innerWidth, screen.width || Infinity, (window.visualViewport && window.visualViewport.width) || Infinity);
          const z = (vw - 16) / 794;
          sheet.style.zoom = z < 1 ? z.toFixed(3) : '';
        };
        this.$nextTick(fit);
        window.addEventListener('resize', fit);
        if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 600);
      } catch (e) { this.error = e.message; }
    },
    get t() {
      const q = Object.assign({}, this.q, { interstate: QuoteCalc.isInterstate(this.q, this.cfg) });
      return QuoteCalc.totals(q, { goodsHsn: this.cfg.quote_hsn_system, servicesSac: this.cfg.quote_sac_install });
    },
    get taxRows() { return this.t.taxLines.flatMap((l) => QuoteCalc.split(l, this.t.interstate)); },
    setSummary() {
      const u = new URL(location.href);
      u.searchParams.set('summary', this.showSummary ? '1' : '0');
      history.replaceState(null, '', u);
    },
    /** The HSN summary lists values per code, so the grouped view (no component prices) leaves it off unless asked. */
    summaryDefault() { return this.view === 'itemwise' && this.q.taxSummary !== false; },
    setView(f) {
      this.view = f;
      this.showSummary = this.summaryDefault();
      this.setSummary();
      const u = new URL(location.href);
      u.searchParams.set('format', f);
      history.replaceState(null, '', u);
      this.$nextTick(() => window.dispatchEvent(new Event('resize')));
    },
    /** Tax cells for the HSN summary: rate + amount for CGST and SGST, or for IGST. */
    parts(h, isTotal) {
      const pct = (r) => (isTotal ? '' : (Math.round(r * 100) / 100) + '%');
      if (this.t.interstate) return [{ k: 'ir', text: pct(h.rate) }, { k: 'ia', text: this.money(h.igst) }];
      return [{ k: 'cr', text: pct(h.rate / 2) }, { k: 'ca', text: this.money(h.cgst) }, { k: 'sr', text: pct(h.rate / 2) }, { k: 'sa', text: this.money(h.sgst) }];
    },
    get terms() { return String(this.q.terms || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean); },
    money(n) { return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    num(n) { const v = Number(n) || 0; return v % 1 ? v.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : String(v); },
    d(iso) {
      if (!iso) return '';
      return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    },
  }));
});
