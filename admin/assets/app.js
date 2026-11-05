/* Shared code for the AVN staff back end. Loaded before the page script and Alpine. */
(function () {
  const ICONS = {
    crm: '<path d="M3 5 H21 L14 13 V19 L10 21 V13 Z"/>',
    projects: '<path d="M4 6 H20 L22 16 H2 Z"/><path d="M9 6 L8 16 M15 6 L16 16 M3 11 H21"/><path d="M12 16 V20 M8 20 H16"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10 H21 M8 3 V7 M16 3 V7"/>',
    clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20 C2.5 16.4 5.4 14 9 14 C12.6 14 15.5 16.4 15.5 20"/><path d="M16 4.5 A3.5 3.5 0 0 1 16 11.5 M18 14.5 C20.2 15.2 21.5 17.2 21.5 20"/>',
    website: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15 L8 10 L13 15 L16 12 L21 17"/><circle cx="16" cy="8.5" r="1.5"/>',
    settings: '<path d="M4 6 H13 M17 6 H20 M4 12 H7 M11 12 H20 M4 18 H15 M19 18 H20"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21 C4 16.6 7.6 14 12 14 C16.4 14 20 16.6 20 21"/>',
  };
  const NAV = [
    { key: 'crm', label: 'CRM', perm: 'crm' },
    { key: 'projects', label: 'Projects', perm: 'projects' },
    { key: 'calendar', label: 'Calendar', perm: 'calendar' },
    { key: 'clients', label: 'Clients', perm: 'clients' },
    { key: 'website', label: 'Website', perm: 'website' },
    { key: 'settings', label: 'Settings', perm: null },
  ];
  const page = location.pathname.split('/')[2] || '';

  // Sidebar + toasts (static markup, processed by Alpine).
  const side = document.getElementById('side');
  if (side) {
    side.className = 'side';
    side.setAttribute('x-data', '');
    side.innerHTML =
      '<a class="brand" href="/admin"><span class="brand-logo"><img src="/assets/logo.png" alt=""></span><span><b>AVN Workspace</b><small>Solar EPC ERP</small></span></a>' +
      '<nav class="nav" aria-label="Workspace">' +
      NAV.map((n) => '<a href="/admin/' + n.key + '" class="' + (n.key === page ? 'on' : '') + '"' + (n.key === page ? ' aria-current="page"' : '') +
        (n.perm ? ' x-show="$store.app.perms.' + n.perm + '" x-cloak' : '') +
        '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n.key] + '</svg>' + n.label + '</a>').join('') +
      '</nav>' +
      '<div class="me"><span class="avatar" x-text="$store.app.initials"></span><span><b x-text="$store.app.user.name"></b>' +
      '<span class="small" style="color:#A9B2D6" x-text="$store.app.user.role === \'admin\' ? \'Admin\' : \'Staff\'"></span> · <button type="button" @click="AVN.logout()">Sign out</button></span></div>';
    const toasts = document.createElement('div');
    toasts.className = 'toasts';
    toasts.setAttribute('x-data', '');
    toasts.setAttribute('aria-live', 'polite');
    toasts.innerHTML = '<template x-for="t in $store.app.toasts" :key="t.id"><div class="toast" :class="t.err && \'err\'" x-text="t.msg" x-transition></div></template>';
    document.body.appendChild(toasts);
  }

  let csrf = null;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  async function api(method, url, body) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (method !== 'GET') {
      if (!csrf) csrf = (await (await fetch('/api/csrf', { credentials: 'same-origin' })).json()).csrf;
      opts.headers['X-CSRF-Token'] = csrf;
    }
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch('/api' + url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401 && !url.startsWith('/auth/login')) { location.href = '/admin/login'; throw new Error('Please sign in'); }
    if (res.status === 403 && data && data.mustChange && page !== 'account') { location.href = '/admin/account'; throw new Error(data.error); }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong');
    return data;
  }

  const AVN = {
    api,
    get: (u) => api('GET', u),
    post: (u, b) => api('POST', u, b === undefined ? {} : b),
    patch: (u, b) => api('PATCH', u, b),
    put: (u, b) => api('PUT', u, b),
    del: (u) => api('DELETE', u),
    ready,
    setCsrf(t) { csrf = t; },
    toast(msg, err) {
      const s = window.Alpine && Alpine.store('app');
      if (!s) return;
      const id = Date.now() + Math.random();
      s.toasts.push({ id, msg, err: !!err });
      setTimeout(() => { s.toasts = s.toasts.filter((t) => t.id !== id); }, err ? 6000 : 3000);
    },
    async logout() {
      try { await api('POST', '/auth/logout'); } catch (e) { /* ignore */ }
      location.href = '/admin/login';
    },
    money(l) {
      if (l === null || l === undefined || l === '') return '—';
      const n = Number(l);
      return n >= 100 ? '₹' + (n / 100).toFixed(2) + ' Cr' : '₹' + (Math.round(n * 10) / 10) + ' L';
    },
    date(iso) {
      if (!iso) return '';
      const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso.replace(' ', 'T') + 'Z');
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    },
    when(iso) {
      if (!iso) return '';
      const d = new Date(iso.replace(' ', 'T') + 'Z');
      return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    },
    today() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    daysFromToday(iso) {
      if (!iso) return null;
      const a = new Date(iso + 'T00:00:00');
      const b = new Date(AVN.today() + 'T00:00:00');
      return Math.round((a - b) / 86400000);
    },
    bytes(n) {
      if (!n) return '';
      return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    },
    copy(text) {
      navigator.clipboard && navigator.clipboard.writeText(text).then(() => AVN.toast('Copied'));
    },
  };
  window.AVN = AVN;

  document.addEventListener('alpine:init', () => {
    Alpine.store('app', {
      user: { name: '', role: '' }, perms: {}, toasts: [], initials: '',
    });
    if (page === 'login') { readyResolve(null); return; }
    api('GET', '/auth/me').then((me) => {
      csrf = me.csrf;
      const s = Alpine.store('app');
      s.user = me.user;
      s.perms = me.permissions;
      s.initials = me.user.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
      readyResolve(me);
    }).catch(() => {});
  });
})();
