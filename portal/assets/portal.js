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
      login: '', password: '', busy: false, error: '',
      async submit() {
        this.error = '';
        this.busy = true;
        try { await api('POST', '/login', { login: this.login, password: this.password }); location.href = '/portal'; } catch (e) { this.error = e.message; this.busy = false; }
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
        if (!this.pw.current) { this.error = 'Enter the temporary password you signed in with'; return; }
        if (this.pw.next.length < 8) { this.error = 'The new password needs at least 8 characters'; return; }
        if (this.pw.next !== this.pw.repeat) { this.error = 'The two new passwords do not match'; return; }
        try { await api('POST', '/password', { current: this.pw.current, next: this.pw.next }); await this.load(); } catch (e) { this.error = e.message; }
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
