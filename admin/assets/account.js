document.addEventListener('alpine:init', () => {
  Alpine.data('account', () => ({
    current: '', next: '', repeat: '', busy: false, error: '',
    async save() {
      this.error = '';
      if (this.next !== this.repeat) { this.error = 'The new passwords do not match'; return; }
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
