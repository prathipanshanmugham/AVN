document.addEventListener('alpine:init', () => {
  const COLORS = { 'On-grid': '#1D50B5', Hybrid: '#F7931E', 'Off-grid': '#1BAF7A' };
  const DESCRIPTIONS = {
    company: 'Health score, kW by location and system, monthly handovers, pipeline',
    installations: 'Every project handed over in the period, plus all active projects',
    sales: 'Leads received and quotations, with status and value',
    collections: 'Order value, received and balance for every project (as of today)',
  };
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  Alpine.data('dash', () => ({
    d: null, error: '', period: 'this_fy', periods: [], systems: ['On-grid', 'Hybrid', 'Off-grid'],
    anim: false, shownScore: 0, tipOn: false, tipX: 0, tipY: 0, tipTitle: '', tipLines: [],

    async init() {
      await AVN.ready;
      try { this.period = localStorage.getItem('avn-dash-period') || 'this_fy'; } catch (e) { /* ignore */ }
      await this.load();
    },
    async load() {
      try { localStorage.setItem('avn-dash-period', this.period); } catch (e) { /* ignore */ }
      try {
        this.error = '';
        const d = await AVN.get('/dashboard?period=' + encodeURIComponent(this.period));
        this.anim = false;
        this.d = d;
        this.periods = d.periods;
        this.period = d.period.key;
        this.countUp(d.health.score || 0);
        requestAnimationFrame(() => requestAnimationFrame(() => { this.anim = true; }));
      } catch (e) { this.error = e.message; }
    },
    countUp(target) {
      if (reduced()) { this.shownScore = target; return; }
      const start = performance.now();
      const dur = 1100;
      const step = (t) => {
        const k = Math.min(1, (t - start) / dur);
        this.shownScore = Math.round(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    get reportList() { return (this.d ? this.d.reports : []).map((r) => Object.assign({ desc: DESCRIPTIONS[r.key] || '' }, r)); },
    get sysTotal() { return this.d ? this.d.bySystem.reduce((a, s) => a + s.installedKw, 0) : 0; },
    get located() { return this.d ? this.d.byLocation.filter((r) => r.total > 0) : []; },
    get locMax() { return Math.max(1, ...this.located.map((r) => r.total)); },
    get monthMax() { return this.d ? Math.max(1, ...this.d.monthly.map((m) => m.kw)) : 1; },
    get stageMax() { return this.d ? Math.max(1, ...this.d.leadStages.map((s) => s.count)) : 1; },
    color(t) { return COLORS[t] || '#8A93B5'; },
    toneFor(score) {
      if (score === null) return 'none';
      if (score >= 80) return 'good';
      if (score >= 60) return 'warning';
      if (score >= 40) return 'serious';
      return 'critical';
    },
    toneIcon(tone) { return { good: '✓', warning: '!', serious: '!', critical: '✕' }[tone] || '·'; },
    kw(n) { return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('en-IN') + ' kW'; },
    kwShort(n) {
      const v = Number(n) || 0;
      if (v >= 1000) return (Math.round(v / 100) / 10) + ' MW';
      return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + ' kW';
    },
    pct(v, total, raw) {
      const p = total ? (v / total) * 100 : 0;
      return raw ? p : Math.round(p) + '%';
    },
    monthName(ym, long) {
      return new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
    },
    tip(e, title, lines) {
      this.tipTitle = title;
      this.tipLines = lines;
      const w = 240;
      this.tipX = Math.min(window.innerWidth - w - 12, e.clientX + 14);
      this.tipY = e.clientY + 16;
      this.tipOn = true;
    },
    tipOff() { this.tipOn = false; },
  }));
});
