/* Staff sign-in: password, "keep me signed in", and "forgot password" (emailed one-time link). */
document.addEventListener('alpine:init', () => {
  const NOTICES = {
    expired: 'That sign-in link has expired or was already used. Sign in with your password, or ask for a new link.',
    changed: 'Password changed. Sign in with your new password.',
  };
  Alpine.data('login', () => ({
    view: 'signin', username: '', password: '', email: '', show: false, remember: true, busy: false, error: '', notice: '', emailOn: true,
    init() {
      const q = new URLSearchParams(location.search);
      this.notice = NOTICES[q.get('m')] || '';
      try { this.username = localStorage.getItem('avn-last-user') || ''; } catch (e) { /* private mode */ }
      this.$nextTick(() => (this.username ? this.$refs.pw : this.$refs.user).focus());
    },
    async submit() {
      this.error = '';
      if (!this.username.trim()) { this.error = 'Enter your email or username'; return; }
      if (!this.password) { this.error = 'Enter your password'; return; }
      this.busy = true;
      try {
        const r = await AVN.post('/auth/login', { username: this.username.trim(), password: this.password, remember: this.remember });
        try { localStorage.setItem('avn-last-user', this.username.trim()); } catch (e) { /* ignore */ }
        location.href = r.user.mustChange ? '/admin/account' : '/admin';
      } catch (e) {
        this.error = e.message;
        this.busy = false;
        this.password = '';
        this.$nextTick(() => this.$refs.pw.focus());
      }
    },
    openForgot() {
      this.error = '';
      this.notice = '';
      if (!this.email && this.username.includes('@')) this.email = this.username.trim();
      this.view = 'forgot';
      this.$nextTick(() => this.$refs.email.focus());
    },
    back() { this.error = ''; this.view = 'signin'; },
    async sendLink() {
      this.error = '';
      if (!/^\S+@\S+\.\S+$/.test(this.email.trim())) { this.error = 'Enter the email on your account'; return; }
      this.busy = true;
      try {
        const r = await AVN.post('/auth/forgot', { email: this.email.trim() });
        this.emailOn = !!r.email;
        this.view = 'sent';
      } catch (e) { this.error = e.message; } finally { this.busy = false; }
    },
  }));
});
