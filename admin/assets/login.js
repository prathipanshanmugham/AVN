/* Staff sign-in: username + password. After the first sign-in on a device, only the password is asked. Each sign-in lasts 24 hours. */
document.addEventListener('alpine:init', () => {
  const NOTICES = {
    expired: 'For safety, sign-ins last 24 hours. Please sign in again.',
    changed: 'Password changed. Sign in with your new password.',
  };
  const KEY = 'avn-last-user';
  /** Remembered on this device: { u: username, n: name }. Older versions stored just the text typed. */
  function remembered() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      try { const v = JSON.parse(raw); if (v && v.u) return v; } catch (e) { /* plain text */ }
      return { u: raw, n: '' };
    } catch (e) { return null; }
  }
  Alpine.data('login', () => ({
    username: '', name: '', known: false, password: '', show: false, busy: false, error: '', notice: '', help: false,
    get first() { return (this.name || this.username).split(' ')[0]; },
    init() {
      this.notice = NOTICES[new URLSearchParams(location.search).get('m')] || '';
      const r = remembered();
      if (r) { this.username = r.u; this.name = r.n; this.known = !!r.n; }
      this.$nextTick(() => (this.username ? this.$refs.pw : this.$refs.user).focus());
    },
    forget() {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      this.known = false; this.username = ''; this.name = ''; this.password = ''; this.error = '';
      this.$nextTick(() => this.$refs.user.focus());
    },
    async submit() {
      this.error = '';
      if (!this.username.trim()) { this.error = 'Enter your username'; return; }
      if (!this.password) { this.error = 'Enter your password'; this.$refs.pw.focus(); return; }
      this.busy = true;
      try {
        const r = await AVN.post('/auth/login', { username: this.username.trim(), password: this.password });
        try { localStorage.setItem(KEY, JSON.stringify({ u: r.user.username, n: r.user.name })); } catch (e) { /* ignore */ }
        location.href = r.user.mustChange ? '/admin/account' : '/admin';
      } catch (e) {
        this.error = e.message;
        this.busy = false;
        this.password = '';
        this.$nextTick(() => this.$refs.pw.focus());
      }
    },
  }));
});
