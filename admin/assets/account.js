document.addEventListener('alpine:init', () => {
  Alpine.data('account', () => ({
    current: '', next: '', repeat: '', busy: false, error: '', show: false,
    async save() {
      this.error = '';
      if (!this.current) { this.error = 'Enter your current password'; return; }
      if (this.next.length < 8) { this.error = 'The new password needs at least 8 characters'; return; }
      if (this.next !== this.repeat) { this.error = 'The two new passwords do not match'; return; }
      if (this.next === this.current) { this.error = 'Choose a new password that is different from the current one'; return; }
      this.busy = true;
      try {
        await AVN.post('/auth/password', { current: this.current, next: this.next });
        AVN.toast('Password changed');
        setTimeout(() => { location.href = '/admin'; }, 600);
      } catch (e) {
        this.error = e.message;
      }
      this.busy = false;
    },
  }));
});
