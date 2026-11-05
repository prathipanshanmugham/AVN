/* AVN Solar public website */
(function () {
  const ICON = (p) => '<svg viewBox="0 0 48 48" aria-hidden="true">' + p + '</svg>';
  const SOLUTIONS = [
    { title: 'Homes', text: 'Rooftop solar with subsidy and net-metering done for you.', icon: ICON('<path d="M6 23 L24 8 L42 23"/><path d="M10 20 V40 H38 V20"/><path d="M20 40 V30 H28 V40"/><path d="M28 6 L36 9 L34 15 L26 12 Z"/>') },
    { title: 'Business', text: 'Cut daytime tariff for shops, schools and hospitals.', icon: ICON('<path d="M9 18 H39 V40 H9 Z"/><path d="M6 18 L10 8 H38 L42 18"/><path d="M14 40 V28 H22 V40"/><path d="M27 26 H34 V33 H27 Z"/>') },
    { title: 'Industry', text: 'Rooftop and ground-mount plants for mills and factories.', icon: ICON('<path d="M6 40 V22 L16 28 V22 L26 28 V22 L36 28 V10 H42 V40 Z"/><path d="M12 34 H16 M22 34 H26 M32 34 H36"/>') },
    { title: 'Farms', text: 'Solar pumps and off-grid power that replace diesel.', icon: ICON('<path d="M24 6 C30 14 33 19 33 23 A9 9 0 0 1 15 23 C15 19 18 14 24 6 Z"/><path d="M6 42 C14 36 34 36 42 42"/><path d="M10 37 V31 M38 37 V31"/>') },
  ];
  const STEPS = [
    { t: 'Site survey', d: 'Roof measurement, shadow analysis and a look at your EB bills.' },
    { t: 'Design', d: 'Panel layout, inverter sizing and a structure built for local wind loads.' },
    { t: 'Procurement', d: 'Modules, inverters and cables from vetted brands, checked before dispatch.' },
    { t: 'Installation', d: 'Mounting, wiring, earthing and lightning protection by trained crews.' },
    { t: 'Approvals', d: 'EB net-metering, inspection and subsidy filing — tracked to closure.' },
    { t: 'Switch-on', d: 'Commissioning, handover and your customer portal login.' },
  ];
  const FAQS = [
    { q: 'How much roof space do I need?', a: 'About 80–100 sq ft of shade-free roof per kWp. A 3 kWp home system needs roughly 300 sq ft.' },
    { q: 'Will solar work during a power cut?', a: 'On-grid systems switch off when the grid fails, to keep EB line workers safe. For backup, we design a hybrid system with batteries.' },
    { q: 'How does the subsidy reach me?', a: 'For eligible homes, the PM Surya Ghar central subsidy — up to ₹78,000 — is paid to your bank account after installation, inspection and net-metering.' },
    { q: 'What maintenance does solar need?', a: 'Regular panel cleaning plus periodic inverter, wiring and earthing checks. Our care plans cover all of it.' },
  ];

  const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  document.addEventListener('alpine:init', () => {
    Alpine.data('site', () => ({
      lang: 'en', now: Date.now(), step: 0, pinned: false, faq: 0,
      calcType: 'home', units: 600, motion: !reducedMotion(),
      company: {}, calc: { yield: 4, roof: 90, tariffHome: 6, tariffBiz: 9 }, brands: { modules: [], inverters: [] },
      gallery: [], solutionPhotos: [], stats: [], videoFastOnly: true,
      videoReady: false, lightbox: null,
      form: { name: '', phone: '', district: '', type: 'Home', website: '', units: '' }, sending: false, sent: false, formError: '',
      steps: STEPS, faqs: FAQS,

      init() {
        this.timer = setInterval(() => {
          this.now = Date.now();
          if (!this.pinned && this.motion) this.step = (this.step + 1) % 6;
        }, 4000);
        fetch('/api/public/site').then((r) => r.json()).then((d) => {
          this.company = d.company || {};
          if (d.calc) this.calc = d.calc;
          this.brands = d.brands || this.brands;
          this.gallery = d.gallery || [];
          this.solutionPhotos = d.solutions || [];
          this.stats = d.stats || [];
          this.videoFastOnly = d.videoFastOnly !== false;
          this.scheduleVideo();
        }).catch(() => this.scheduleVideo());
      },

      // Hero video: start only after the page has loaded; never on data-saver / 2G / reduced motion.
      scheduleVideo() {
        const start = () => setTimeout(() => this.startVideo(), 400);
        if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
      },
      startVideo() {
        const src = this.$refs.hero && this.$refs.hero.dataset.video;
        const v = this.$refs.video;
        if (!src || !v || !this.motion) return;
        try {
          const c = navigator.connection;
          if (this.videoFastOnly && c && (c.saveData || /2g$/.test(c.effectiveType || ''))) return;
        } catch (e) { /* ignore */ }
        v.muted = true;
        v.src = src;
        const play = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
        play();
        if ('IntersectionObserver' in window) {
          new IntersectionObserver((entries) => entries.forEach((en) => (en.isIntersecting ? play() : v.pause()))).observe(v);
        }
      },

      // Live sun estimate for Tamil Nadu (IST)
      get sun() {
        const d = new Date(this.now);
        const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000);
        const hr = ist.getHours() + ist.getMinutes() / 60;
        const isDay = hr > 6.2 && hr < 17.9;
        const f = isDay ? (hr - 6.2) / (17.9 - 6.2) : 0;
        const kw = isDay ? 5 * 0.78 * Math.pow(Math.sin(Math.PI * f), 1.3) : 0;
        const h = ist.getHours();
        return { isDay, kw: kw.toFixed(1), clock: ((h % 12) || 12) + ':' + String(ist.getMinutes()).padStart(2, '0') + (h < 12 ? ' AM' : ' PM') };
      },

      get solutions() { return SOLUTIONS.map((s, i) => Object.assign({ photo: this.solutionPhotos[i] || null }, s)); },
      loop(arr) { return (arr || []).concat(arr || []); },
      digits(s) { return String(s || '').replace(/\D/g, '').slice(-10); },
      fmt(n) { return Math.round(n).toLocaleString('en-IN'); },

      // Process arc
      pos(i) {
        const th = Math.PI - (i * Math.PI) / 5;
        return { x: (50 + 44 * Math.cos(th)).toFixed(2), y: (88 - 76 * Math.sin(th)).toFixed(2) };
      },
      get arcD() { const p = this.pos(this.step); return 'M 6 88 A 44 76 0 0 1 ' + p.x + ' ' + p.y; },

      // Calculator
      get tariff() { return this.calcType === 'home' ? this.calc.tariffHome : this.calc.tariffBiz; },
      get kwp() { return Math.max(1, Math.round((this.units / 60 / this.calc.yield) * 2) / 2); },
      get kwpLabel() { return this.kwp % 1 ? this.kwp.toFixed(1) : String(this.kwp); },
      get gen() { return this.kwp * this.calc.yield * 365; },
      get bill() { return this.units * 6 * this.tariff; },
      get savings() { return Math.min(this.gen, this.units * 6) * this.tariff; },
      get after() { return Math.max(0, this.bill - this.savings); },
      get afterPct() { return this.bill > 0 ? ((this.after / this.bill) * 100).toFixed(1) : 0; },
      get subsidy() { return this.kwp <= 2 ? 30000 * this.kwp : 60000 + 18000 * Math.min(1, this.kwp - 2); },

      async submitLead() {
        this.formError = '';
        if (!this.form.name.trim()) { this.formError = 'Please enter your name'; return; }
        if (!/^[6-9]\d{9}$/.test(this.digits(this.form.phone))) { this.formError = 'Please enter a valid 10-digit mobile number'; return; }
        this.sending = true;
        try {
          const res = await fetch('/api/public/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.form) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Could not send. Please call us.');
          this.sent = true;
        } catch (e) { this.formError = e.message; }
        this.sending = false;
      },
    }));
  });
})();
