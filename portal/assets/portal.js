(function () {
  let csrf = null;
  async function api(method, url, body) {
    if (method !== 'GET' && !csrf) csrf = (await (await fetch('/api/csrf', { credentials: 'same-origin' })).json()).csrf;
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') { opts.headers['X-CSRF-Token'] = csrf; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
    const res = await fetch('/api/portal' + url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401 && url !== '/login') { location.href = '/portal/login'; throw new Error('Please sign in'); }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong');
    return data;
  }

  document.addEventListener('alpine:init', () => {
    Alpine.data('portalLogin', () => ({
      view: 'signin', login: '', password: '', show: false, remember: true, busy: false, error: '', notice: '', emailOn: false, wa: '',
      init() {
        if (new URLSearchParams(location.search).get('m') === 'expired') this.notice = 'That sign-in link has expired or was already used. Sign in with your password, or ask for a new link.';
        try { this.login = localStorage.getItem('avn-portal-login') || ''; } catch (e) { /* private mode */ }
        this.$nextTick(() => (this.login ? this.$refs.pw : this.$refs.login).focus());
      },
      get waLink() {
        return 'https://wa.me/91' + this.wa + '?text=' + encodeURIComponent('Hi AVN Solar, please send me a new sign-in link for the customer portal. My mobile / Customer ID: ' + this.login.trim());
      },
      async submit() {
        this.error = '';
        if (!this.login.trim()) { this.error = 'Enter your mobile number or Customer ID'; return; }
        if (!this.password) { this.error = 'Enter your password'; return; }
        this.busy = true;
        try {
          await api('POST', '/login', { login: this.login.trim(), password: this.password, remember: this.remember });
          try { localStorage.setItem('avn-portal-login', this.login.trim()); } catch (e) { /* ignore */ }
          location.href = '/portal';
        } catch (e) { this.error = e.message; this.busy = false; this.password = ''; }
      },
      openForgot() { this.error = ''; this.notice = ''; this.view = 'forgot'; this.$nextTick(() => this.$refs.flogin.focus()); },
      back() { this.error = ''; this.view = 'signin'; },
      async sendLink() {
        this.error = '';
        if (!this.login.trim()) { this.error = 'Enter your mobile number or Customer ID'; return; }
        this.busy = true;
        try {
          const r = await api('POST', '/forgot', { login: this.login.trim() });
          this.emailOn = !!r.email;
          this.wa = r.whatsapp || '';
          this.view = 'sent';
        } catch (e) { this.error = e.message; } finally { this.busy = false; }
      },
    }));

    Alpine.data('portalLink', () => ({
      state: 'loading', name: '', purpose: '', error: '', busy: false, remember: true,
      token: location.pathname.split('/').pop(),
      get first() { return String(this.name).split(/\s+/)[0] || 'there'; },
      async init() {
        try {
          const r = await fetch('/api/portal/link/' + encodeURIComponent(this.token), { credentials: 'same-origin' });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) { this.error = data.error || 'This sign-in link is not valid.'; this.state = 'bad'; return; }
          this.name = data.name;
          this.purpose = data.purpose;
          this.state = 'ready';
        } catch (e) { this.error = 'Could not check the link. Check your connection and try again.'; this.state = 'bad'; }
      },
      async go() {
        this.busy = true;
        this.error = '';
        try { await api('POST', '/link', { token: this.token, remember: this.remember }); location.replace('/portal'); } catch (e) { this.error = e.message; this.busy = false; }
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
