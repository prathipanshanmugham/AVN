document.addEventListener('alpine:init', () => {
  Alpine.data('login', () => ({
    username: '', password: '', show: false, busy: false, error: '',
    async submit() {
      this.error = '';
      this.busy = true;
      try {
        const r = await AVN.post('/auth/login', { username: this.username, password: this.password });
        location.href = r.user.mustChange ? '/admin/account' : '/admin';
      } catch (e) {
        this.error = e.message;
        this.busy = false;
      }
    },
  }));
});
