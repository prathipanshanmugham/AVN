/* AVN Solar public website */
(function () {
  const ICON = (p) => '<svg viewBox="0 0 48 48" aria-hidden="true">' + p + '</svg>';
  const IC = {
    home: ICON('<path d="M6 23 L24 8 L42 23"/><path d="M10 20 V40 H38 V20"/><path d="M20 40 V30 H28 V40"/><path d="M28 6 L36 9 L34 15 L26 12 Z"/>'),
    biz: ICON('<path d="M9 18 H39 V40 H9 Z"/><path d="M6 18 L10 8 H38 L42 18"/><path d="M14 40 V28 H22 V40"/><path d="M27 26 H34 V33 H27 Z"/>'),
    ind: ICON('<path d="M6 40 V22 L16 28 V22 L26 28 V22 L36 28 V10 H42 V40 Z"/><path d="M12 34 H16 M22 34 H26 M32 34 H36"/>'),
    farm: ICON('<path d="M24 6 C30 14 33 19 33 23 A9 9 0 0 1 15 23 C15 19 18 14 24 6 Z"/><path d="M6 42 C14 36 34 36 42 42"/><path d="M10 37 V31 M38 37 V31"/>'),
    rcc: ICON('<path d="M6 20 H42 V40 H6 Z"/><path d="M6 20 L10 14 H38 L42 20"/><path d="M12 13 L18 7 H36 L32 13" /><path d="M14 40 V30 H22 V40"/>'),
    sheet: ICON('<path d="M6 40 V22 L24 10 L42 22 V40 Z"/><path d="M12 18 L12 40 M18 14 V40 M24 10 V40 M30 14 V40 M36 18 V40"/>'),
    land: ICON('<path d="M4 40 C14 34 34 34 44 40"/><path d="M8 32 L20 26 L22 30 L10 36 Z M26 30 L38 24 L40 28 L28 34 Z"/><circle cx="36" cy="10" r="4"/>'),
    unsure: ICON('<circle cx="24" cy="24" r="17"/><path d="M19 19 A5 5 0 1 1 26 24 C24.5 25 24 26 24 28"/><path d="M24 33 V34"/>'),
  };
  const SOLUTIONS = [
    { title: 'Homes', text: 'Rooftop solar with subsidy and net-metering done for you.', icon: IC.home },
    { title: 'Business', text: 'Cut daytime tariff for shops, schools and hospitals.', icon: IC.biz },
    { title: 'Industry', text: 'Rooftop and ground-mount plants for mills and factories.', icon: IC.ind },
    { title: 'Farms', text: 'Solar pumps and off-grid power that replace diesel.', icon: IC.farm },
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
  const WIZ_TYPES = [
    { v: 'Home', t: 'My home', icon: IC.home },
    { v: 'Business', t: 'Shop / office', icon: IC.biz },
    { v: 'Industry', t: 'Factory', icon: IC.ind },
    { v: 'Farm', t: 'Farm / pump', icon: IC.farm },
  ];
  const BILLS = [
    { t: 'Under ₹1,500', v: 1000 },
    { t: '₹1,500 – 3,000', v: 2250 },
    { t: '₹3,000 – 6,000', v: 4500 },
    { t: '₹6,000 – 15,000', v: 10000 },
    { t: '₹15,000 – 50,000', v: 30000 },
    { t: 'Above ₹50,000', v: 80000 },
  ];
  const ROOFS = [
    { v: 'RCC / concrete roof', t: 'Concrete roof', icon: IC.rcc },
    { v: 'Metal sheet roof', t: 'Sheet roof', icon: IC.sheet },
    { v: 'Open land', t: 'Open land', icon: IC.land },
    { v: 'Not sure', t: 'Not sure', icon: IC.unsure },
  ];
  const HERO_WORDS = ['savings.', 'lower bills.', 'clean power.', 'real returns.'];
  const MENU = [
    { t: 'Solutions', ta: 'தீர்வுகள்', href: '#solutions' },
    { t: 'How solar works', ta: 'சோலார் எப்படி வேலை செய்கிறது', href: '#day' },
    { t: 'Savings calculator', ta: 'சேமிப்பு கணக்கீடு', href: '#calculator' },
    { t: 'Recent projects', ta: 'எங்கள் திட்டங்கள்', href: '#projects' },
    { t: 'Questions', ta: 'கேள்விகள்', href: '#faq' },
    { t: 'Free quote', ta: 'இலவச விலைப்பட்டியல்', href: '#contact' },
  ];

  const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    sget(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    sset(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  // Ad / campaign tags, kept for the visit so the CRM knows where the lead came from.
  function readUtm() {
    let utm = {};
    try { utm = JSON.parse(store.sget('avn-utm') || '{}') || {}; } catch (e) { utm = {}; }
    try {
      const p = new URLSearchParams(location.search);
      const fresh = {};
      ['source', 'medium', 'campaign', 'term', 'content'].forEach((k) => { if (p.get('utm_' + k)) fresh[k] = p.get('utm_' + k).slice(0, 120); });
      ['gclid', 'fbclid'].forEach((k) => { if (p.get(k)) fresh[k] = p.get(k).slice(0, 120); });
      if (Object.keys(fresh).length) { utm = fresh; store.sset('avn-utm', JSON.stringify(utm)); }
    } catch (e) { /* ignore */ }
    return utm;
  }

  function confetti(anchor) {
    if (reducedMotion() || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'confetti';
    box.style.left = (r.left + r.width / 2) + 'px';
    box.style.top = (r.top + Math.min(r.height / 2, 160)) + 'px';
    const colors = ['#FFC12E', '#F7931E', '#2BA6E4', '#1D50B5', '#1E8E5A', '#ffffff'];
    for (let i = 0; i < 36; i++) {
      const s = document.createElement('i');
      const a = Math.random() * Math.PI * 2;
      const d = 90 + Math.random() * 170;
      s.style.setProperty('--x', Math.round(Math.cos(a) * d) + 'px');
      s.style.setProperty('--y', Math.round(Math.sin(a) * d - 80) + 'px');
      s.style.setProperty('--r', Math.round(Math.random() * 720 - 360) + 'deg');
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = Math.round(Math.random() * 120) + 'ms';
      if (i % 3 === 0) s.style.borderRadius = '50%';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1800);
  }

  // Section headings rise word by word as they scroll in.
  if (!reducedMotion()) {
    document.querySelectorAll('h2.avn-rv-wipe').forEach((h) => {
      if (h.children.length) return;
      const words = h.textContent.trim().split(/\s+/);
      h.classList.remove('avn-rv-wipe');
      h.classList.add('avn-words');
      h.innerHTML = words.map((w, i) => '<span class="w" style="--i:' + i + '">' + w.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</span>').join(' ');
    });
  }

  document.addEventListener('alpine:init', () => {
    Alpine.data('site', () => ({
      lang: 'en', now: Date.now(), step: 0, pinned: false, faq: 0,
      calcType: 'home', units: 600, motion: !reducedMotion(),
      company: {}, calc: { yield: 4, roof: 90, tariffHome: 6, tariffBiz: 9 }, brands: { modules: [], inverters: [] },
      gallery: [], solutionPhotos: [], stats: [], banner: [], heroSlides: [], videoFastOnly: true,
      popup: { enabled: false, delay: 25, title: '' },
      videoReady: false, lightbox: null, slide: 0, bandSlide: 0, wi: 0, scrolled: false,
      steps: STEPS, faqs: FAQS, WIZ_TYPES, BILLS, ROOFS, heroWords: HERO_WORDS,
      utm: {}, sending: false, leadSent: false, dayP: 0, menu: false, top: false, hideHead: false, menuLinks: MENU,
      wiz: { step: 0, type: '', bill: '', billValue: 0, roof: '', name: '', phone: '', district: '', website: '' }, wizError: '', wizFlash: false,
      calcForm: { name: '', phone: '' }, calcError: '', calcSent: false,
      pop: { name: '', phone: '' }, popOpen: false, popSent: false, popError: '', waBubble: false,

      init() {
        this.utm = readUtm();
        this.timer = setInterval(() => {
          this.now = Date.now();
          if (!this.pinned && this.motion) this.step = (this.step + 1) % 6;
        }, 4000);
        if (this.motion) {
          setInterval(() => { this.wi = (this.wi + 1) % HERO_WORDS.length; }, 2800);
          setInterval(() => {
            if (this.heroSlides.length > 1) this.slide = (this.slide + 1) % this.heroSlides.length;
            if (this.banner.length > 1) this.bandSlide = (this.bandSlide + 1) % this.banner.length;
          }, 6000);
        }
        let lastY = window.scrollY;
        const onScroll = () => {
          const y = window.scrollY;
          this.top = y > 12;
          // Header tucks away while scrolling down, comes back on the way up.
          if (Math.abs(y - lastY) > 6) { this.hideHead = y > lastY && y > 160; lastY = y; }
          this.scrolled = y > 520;
          const max = document.documentElement.scrollHeight - window.innerHeight;
          this.dayP = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        this.$watch('menu', (v) => document.documentElement.classList.toggle('menu-open', v));
        // Arriving at the quote form from any "free quote" button gives it a little flash.
        document.addEventListener('click', (e) => {
          const a = e.target.closest && e.target.closest('a[href="#contact"]');
          if (a) { this.wizFlash = false; setTimeout(() => { this.wizFlash = true; }, 450); setTimeout(() => { this.wizFlash = false; }, 2200); }
        });
        this.fx();
        fetch('/api/public/site').then((r) => r.json()).then((d) => {
          this.company = d.company || {};
          if (d.calc) this.calc = d.calc;
          this.brands = d.brands || this.brands;
          this.gallery = d.gallery || [];
          this.solutionPhotos = d.solutions || [];
          this.stats = d.stats || [];
          this.banner = d.banner || [];
          this.popup = d.popup || this.popup;
          this.videoFastOnly = d.videoFastOnly !== false;
          this.heroSlides = this.heroHasVideo ? [] : ((d.hero && d.hero.images) || []);
          this.scheduleVideo();
          this.setupPopup();
          if (this.company.whatsapp && this.motion) {
            setTimeout(() => { if (!this.popOpen) this.waBubble = true; }, 9000);
            setTimeout(() => { this.waBubble = false; }, 21000);
          }
        }).catch(() => this.scheduleVideo());
      },

      // Scrolling the page = one solar day on a 5 kWp roof (about 20 kWh, sunrise 6 AM to sunset 6 PM).
      get dayClock() {
        const mins = Math.round((6 + this.dayP * 12) * 60);
        const h = Math.floor(mins / 60);
        const m = Math.floor((mins % 60) / 15) * 15;
        return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
      },
      get dayKwh() { return (20 * (1 - Math.cos(Math.PI * this.dayP)) / 2).toFixed(1); },

      // Playful extras: buttons lean toward the pointer, sunlight follows it across the hero,
      // and the brand ribbons speed up while you scroll. All off with reduced motion.
      fx() {
        if (!this.motion) return;
        const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
        if (fine) {
          let raf = 0;
          let last = null;
          document.addEventListener('pointermove', (e) => {
            last = e;
            if (raf) return;
            raf = requestAnimationFrame(() => {
              raf = 0;
              document.querySelectorAll('.avn-magnet').forEach((el) => {
                const r = el.getBoundingClientRect();
                const dx = last.clientX - (r.left + r.width / 2);
                const dy = last.clientY - (r.top + r.height / 2);
                const d = Math.hypot(dx, dy);
                const reach = Math.max(110, r.width);
                if (d < reach) { const k = (1 - d / reach) * 0.32; el.style.translate = (dx * k).toFixed(1) + 'px ' + (dy * k).toFixed(1) + 'px'; } else if (el.style.translate) el.style.translate = '';
              });
            });
          }, { passive: true });
          const hero = this.$refs.hero;
          if (hero) {
            hero.addEventListener('pointermove', (e) => {
              const r = hero.getBoundingClientRect();
              hero.style.setProperty('--px', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
              hero.style.setProperty('--py', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
            }, { passive: true });
          }
        }
        let lastY = window.scrollY;
        let boost = 0;
        let ticking = false;
        const ribbons = () => [...document.querySelectorAll('.avn-marquee, .avn-marquee-rev')].flatMap((el) => (el.getAnimations ? el.getAnimations() : []));
        window.addEventListener('scroll', () => {
          boost = Math.min(5, boost + Math.abs(window.scrollY - lastY) / 45);
          lastY = window.scrollY;
          if (ticking) return;
          ticking = true;
          const tick = () => {
            boost *= 0.93;
            const list = ribbons();
            list.forEach((a) => { a.playbackRate = 1 + boost; });
            if (boost > 0.03) requestAnimationFrame(tick);
            else { list.forEach((a) => { a.playbackRate = 1; }); ticking = false; }
          };
          requestAnimationFrame(tick);
        }, { passive: true });
      },

      get heroHasVideo() { return !!(this.$refs.hero && this.$refs.hero.dataset.video); },

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
      waLink(text) { return 'https://wa.me/91' + this.digits(this.company.whatsapp) + (text ? '?text=' + encodeURIComponent(text) : ''); },

      // Process arc
      pos(i) {
        const th = Math.PI - (i * Math.PI) / 5;
        return { x: (50 + 44 * Math.cos(th)).toFixed(2), y: (88 - 76 * Math.sin(th)).toFixed(2) };
      },
      get arcD() { const p = this.pos(this.step); return 'M 6 88 A 44 76 0 0 1 ' + p.x + ' ' + p.y; },

      // Solution cards tilt toward the pointer
      tilt(e) {
        if (!this.motion || e.pointerType === 'touch') return;
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', ((x - 0.5) * 12).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((0.5 - y) * 10).toFixed(2) + 'deg');
        el.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
      },
      untilt(e) { ['--rx', '--ry'].forEach((p) => e.currentTarget.style.setProperty(p, '0deg')); },

      // Calculator
      get tariff() { return this.calcType === 'home' ? this.calc.tariffHome : this.calc.tariffBiz; },
      kwpFor(units) { return Math.max(1, Math.round((units / 60 / this.calc.yield) * 2) / 2); },
      kwLabel(k) { return k % 1 ? k.toFixed(1) : String(k); },
      get kwp() { return this.kwpFor(this.units); },
      get kwpLabel() { return this.kwLabel(this.kwp); },
      get gen() { return this.kwp * this.calc.yield * 365; },
      get bill() { return this.units * 6 * this.tariff; },
      get savings() { return Math.min(this.gen, this.units * 6) * this.tariff; },
      get after() { return Math.max(0, this.bill - this.savings); },
      get afterPct() { return this.bill > 0 ? ((this.after / this.bill) * 100).toFixed(1) : 0; },
      get subsidy() { return this.kwp <= 2 ? 30000 * this.kwp : 60000 + 18000 * Math.min(1, this.kwp - 2); },
      get calcWaText() {
        return 'Hi ' + (this.company.brand || 'AVN Solar') + ', my EB bill is about ' + this.fmt(this.units) + ' units per 2 months. Your calculator suggests about ' +
          this.kwpLabel + ' kWp. Please send me a quote.';
      },

      // Quote wizard
      get wizTariff() { return this.wiz.type === 'Home' ? this.calc.tariffHome : this.calc.tariffBiz; },
      get wizUnits() { return this.wiz.billValue ? this.wiz.billValue / this.wizTariff : 0; },
      get wizKwp() { return this.wizUnits ? this.kwpFor(this.wizUnits) : 0; },
      get wizSavings() { return this.wizKwp ? Math.min(this.wizKwp * this.calc.yield * 365, this.wizUnits * 6) * this.wizTariff : 0; },
      next() { this.waBubble = false; setTimeout(() => { this.wiz.step = Math.min(3, this.wiz.step + 1); }, this.motion ? 260 : 0); },

      validate(name, phone) {
        if (!String(name || '').trim()) return 'Please enter your name';
        if (!/^[6-9]\d{9}$/.test(this.digits(phone))) return 'Please enter a valid 10-digit mobile number';
        return '';
      },
      async sendLead(payload) {
        const res = await fetch('/api/public/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ utm: this.utm, page: location.pathname }, payload)),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not send. Please call us.');
        this.leadSent = true;
        store.set('avn-popup', String(Date.now()));
      },
      async sendWizard() {
        this.wizError = this.validate(this.wiz.name, this.wiz.phone);
        if (this.wizError) return;
        this.sending = true;
        try {
          await this.sendLead({
            form: 'wizard', name: this.wiz.name, phone: this.wiz.phone, district: this.wiz.district, type: this.wiz.type || 'Home',
            bill: this.wiz.bill, roof: this.wiz.roof, kwp: this.wizKwp || '', savings: this.wizKwp ? '₹' + this.fmt(this.wizSavings) + ' / year' : '',
            units: this.wizUnits ? String(Math.round(this.wizUnits)) : '', website: this.wiz.website,
          });
          this.wiz.step = 4;
          this.$nextTick(() => confetti(this.$refs.wiz));
        } catch (e) { this.wizError = e.message; }
        this.sending = false;
      },
      async sendCalc() {
        this.calcError = this.validate(this.calcForm.name, this.calcForm.phone);
        if (this.calcError) return;
        this.sending = true;
        try {
          await this.sendLead({
            form: 'calculator', name: this.calcForm.name, phone: this.calcForm.phone, type: this.calcType === 'home' ? 'Home' : 'Business',
            units: String(this.units), kwp: this.kwp, savings: '₹' + this.fmt(this.savings) + ' / year',
          });
          this.calcSent = true;
          this.$nextTick(() => confetti(this.$refs.calcCta));
        } catch (e) { this.calcError = e.message; }
        this.sending = false;
      },

      // Offer popup: once a week per visitor, after a delay or on exit intent; never after a lead is sent.
      setupPopup() {
        if (!this.popup.enabled) return;
        const last = Number(store.get('avn-popup') || 0);
        if (Date.now() - last < 7 * 86400000) return;
        const show = () => {
          if (this.popOpen || this.leadSent || this.wiz.step > 0 || this.lightbox) return;
          this.popOpen = true;
          this.waBubble = false;
          store.set('avn-popup', String(Date.now()));
          this.$nextTick(() => { const i = this.$refs.popName; if (i) i.focus(); });
          document.removeEventListener('mouseout', exit);
        };
        const exit = (e) => { if (!e.relatedTarget && e.clientY < 10) show(); };
        setTimeout(show, Math.max(3, this.popup.delay) * 1000);
        setTimeout(() => document.addEventListener('mouseout', exit), 8000);
      },
      closePop() { this.popOpen = false; },
      async sendPop() {
        this.popError = this.validate(this.pop.name, this.pop.phone);
        if (this.popError) return;
        this.sending = true;
        try {
          await this.sendLead({ form: 'popup', name: this.pop.name, phone: this.pop.phone });
          this.popSent = true;
          this.$nextTick(() => confetti(this.$refs.pop));
          setTimeout(() => { this.popOpen = false; }, 4200);
        } catch (e) { this.popError = e.message; }
        this.sending = false;
      },
    }));
  });
})();
