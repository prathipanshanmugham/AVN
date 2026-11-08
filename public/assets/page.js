/* Service pages: mobile menu and the free-quote form (saved as a CRM lead, like the homepage forms). */
document.addEventListener('alpine:init', () => {
  const sget = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const sset = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  function readUtm() {
    let utm = {};
    try { utm = JSON.parse(sget('avn-utm') || '{}') || {}; } catch (e) { utm = {}; }
    try {
      const p = new URLSearchParams(location.search);
      const fresh = {};
      ['source', 'medium', 'campaign', 'term', 'content'].forEach((k) => { if (p.get('utm_' + k)) fresh[k] = p.get('utm_' + k).slice(0, 120); });
      ['gclid', 'fbclid'].forEach((k) => { if (p.get(k)) fresh[k] = p.get(k).slice(0, 120); });
      if (Object.keys(fresh).length) { utm = fresh; sset('avn-utm', JSON.stringify(utm)); }
    } catch (e) { /* ignore */ }
    return utm;
  }

  Alpine.data('page', () => ({
    menu: false, scrolled: false, sending: false, sent: false, error: '', copied: false,
    f: { name: '', phone: '', district: '', note: '', website: '' },
    init() {
      this.utm = readUtm();
      this.$watch('menu', (v) => document.documentElement.classList.toggle('menu-open', v));
      const onScroll = () => { if (this.scrolled !== window.scrollY > 8) this.scrolled = window.scrollY > 8; };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    },
    async copyLink() {
      const url = location.origin + location.pathname;
      try { await navigator.clipboard.writeText(url); } catch (e) { window.prompt('Copy this link', url); return; }
      this.copied = true;
      setTimeout(() => { this.copied = false; }, 2500);
    },
    async send() {
      const phone = String(this.f.phone).replace(/\D/g, '').slice(-10);
      if (!this.f.name.trim()) { this.error = 'Please enter your name'; return; }
      if (!/^[6-9]\d{9}$/.test(phone)) { this.error = 'Please enter a valid 10-digit mobile number'; return; }
      this.error = '';
      this.sending = true;
      try {
        const res = await fetch('/api/public/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form: 'contact', type: this.$root.dataset.type || 'Home', name: this.f.name, phone, district: this.f.district,
            note: this.f.note, website: this.f.website, utm: this.utm, page: location.pathname }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not send. Please call us.');
        this.sent = true;
        if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form: 'service_page', page_path: location.pathname });
      } catch (e) { this.error = e.message; } finally { this.sending = false; }
    },
  }));
});
