/* Opening a one-time sign-in link: shows who it is for; Continue uses it and goes to "choose your password". */
document.addEventListener('alpine:init', () => {
  Alpine.data('signinLink', () => ({
    state: 'loading', name: '', purpose: '', error: '', busy: false, remember: true,
    token: location.pathname.split('/').pop(),
    get first() { return String(this.name).split(/\s+/)[0] || 'there'; },
    async init() {
      try {
        const r = await fetch('/api/auth/link/' + encodeURIComponent(this.token), { credentials: 'same-origin' });
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
      try {
        await AVN.post('/auth/link', { token: this.token, remember: this.remember });
        location.replace('/admin/account');
      } catch (e) { this.error = e.message; this.busy = false; }
    },
  }));
});
