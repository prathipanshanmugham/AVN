(function () {
  let csrf = null;
  async function api(method, url, body) {
    if (method !== 'GET' && !csrf) csrf = (await (await fetch('/api/csrf', { credentials: 'same-origin' })).json()).csrf;
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') { opts.headers['X-CSRF-Token'] = csrf; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
    const res = await fetch('/api/portal' + url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401 && url !== '/login') { location.href = '/portal/login' + (data && data.expired ? '?m=expired' : ''); throw new Error((data && data.error) || 'Please sign in'); }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong');
    return data;
  }

  document.addEventListener('alpine:init', () => {
    /* Customer sign-in. After the first sign-in on a device, only the password is asked. Each sign-in lasts 24 hours. */
    const KEY = 'avn-portal-login';
    function remembered() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        try { const v = JSON.parse(raw); if (v && v.l) return v; } catch (e) { /* plain text from older versions */ }
        return { l: raw, n: '' };
      } catch (e) { return null; }
    }
    Alpine.data('portalLogin', () => ({
      login: '', name: '', known: false, password: '', show: false, busy: false, error: '', notice: '', help: false, wa: '',
      get first() { return String(this.name).split(/\s+/)[0] || 'there'; },
      init() {
        if (new URLSearchParams(location.search).get('m') === 'expired') this.notice = 'For safety, sign-ins last 24 hours. Please sign in again.';
        const r = remembered();
        if (r) { this.login = r.l; this.name = r.n; this.known = !!r.n; }
        this.$nextTick(() => (this.login ? this.$refs.pw : this.$refs.login).focus());
      },
      forget() {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        this.known = false; this.login = ''; this.name = ''; this.password = ''; this.error = '';
        this.$nextTick(() => this.$refs.login.focus());
      },
      get waLink() {
        return 'https://wa.me/91' + this.wa + '?text=' + encodeURIComponent('Hi AVN Solar, I forgot my customer portal password. Please send me a new one. My mobile / Customer ID: ' + this.login.trim());
      },
      async toggleHelp() {
        this.error = '';
        this.help = !this.help;
        if (this.help && !this.wa) { try { this.wa = (await api('GET', '/help')).whatsapp || ''; } catch (e) { /* the text still helps */ } }
      },
      async submit() {
        this.error = '';
        if (!this.login.trim()) { this.error = 'Enter your mobile number or Customer ID'; return; }
        if (!this.password) { this.error = 'Enter your password'; this.$refs.pw.focus(); return; }
        this.busy = true;
        try {
          const r = await api('POST', '/login', { login: this.login.trim(), password: this.password });
          try { localStorage.setItem(KEY, JSON.stringify({ l: this.login.trim(), n: r.name || '' })); } catch (e) { /* ignore */ }
          location.href = '/portal';
        } catch (e) { this.error = e.message; this.busy = false; this.password = ''; this.$nextTick(() => this.$refs.pw.focus()); }
      },
    }));

    Alpine.data('portal', () => ({
      me: null, error: '', sent: false,
      pw: { current: '', next: '', repeat: '' }, pwShow: false,
      req: { projectId: '', message: '' },
      async init() { await this.load(); },
      async load() {
        this.me = await api('GET', '/me');
        csrf = this.me.csrf;
        if (this.me.projects[0] && !this.req.projectId) this.req.projectId = this.me.projects[0].id;
      },
      async changePassword() {
        this.error = '';
        const fresh = this.me.client.needsCurrent === false;
        if (!fresh && !this.pw.current) { this.error = 'Enter the temporary password you signed in with'; return; }
        if (this.pw.next.length < 8) { this.error = 'The new password needs at least 8 characters'; return; }
        if (this.pw.next !== this.pw.repeat) { this.error = 'The two new passwords do not match'; return; }
        try { await api('POST', '/password', { current: fresh ? '' : this.pw.current, next: this.pw.next }); await this.load(); } catch (e) { this.error = e.message; }
      },
      async sendRequest() {
        try {
          await api('POST', '/requests', this.req);
          this.req.message = '';
          this.sent = true;
          await this.load();
        } catch (e) { alert(e.message); }
      },
      async logout() {
        try { await api('POST', '/logout'); } catch (e) { /* ignore */ }
        location.href = '/portal/login';
      },
    }));
  });
})();
