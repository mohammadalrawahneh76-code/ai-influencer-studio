(() => {
  const API = !'port/8000'.startsWith('__') ? 'port/8000' : (/^(localhost|127\.)/.test(location.hostname) ? 'http://localhost:8000' : '');
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileUrl = (id, dl) => `${API}/api/file/${id}${dl ? '?download=1' : ''}`;

  const state = { me: null, token: null, config: null, current: null, poll: null, viewing: null, next: null, lastSid: null, authMode: 'signup' };
  const PROTECTED = ['/create', '/app', '/billing'];

  async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      method: opts.method || 'GET',
      headers: Object.assign(opts.body ? { 'Content-Type': 'application/json' } : {}, state.token ? { Authorization: 'Bearer ' + state.token } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401 && !opts.noAuthRedirect) { state.me = null; state.token = null; syncAuthUI(); if (!['/', '/login'].includes(curPath())) { state.next = curPath(); go('/login'); } }
    if (!res.ok) throw new Error((data && data.detail) || `Request failed (${res.status})`);
    return data;
  }

  function armed(btn, label) {
    if (btn.dataset.armed) return true;
    const orig = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = label || 'Tap again to confirm';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = orig; } }, 3000);
    return false;
  }

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function syncAuthUI() {
    const inn = !!state.me;
    $$('.auth-only').forEach((el) => el.classList.toggle('hidden', !inn));
    $$('.guest-only').forEach((el) => el.classList.toggle('hidden', inn));
    const c = $('#credits');
    if (inn) c.textContent = `${state.me.credits} credits`;
  }
  async function refreshMe() {
    try { state.me = await api('/api/me', { noAuthRedirect: true }); }
    catch (_) { state.me = null; }
    syncAuthUI();
    return state.me;
  }
  function curPath() { return (location.hash.replace(/^#/, '') || '/').split('?')[0]; }
  function hashQuery() { const q = location.hash.split('?')[1] || ''; return new URLSearchParams(q); }

  /* ---------- routing ---------- */
  function go(path) { location.hash = '#' + path; }
  function route() {
    const h = curPath();
    const needsAuth = PROTECTED.includes(h) || h.startsWith('/i/');
    if (needsAuth && !state.me) {
      if (!state.booted) { state.booted = true; refreshMe().then(route); return; }
      state.next = location.hash.replace(/^#/, '');
      if (h !== '/login') { go('/login'); return; }
    }
    state.booted = true;
    closeDrawer();
    closeViewer();
    clearInterval(state.poll);
    $$('.view').forEach((v) => (v.hidden = true));
    const topbar = $('#topbar');
    let view;
    if (h === '/create') { view = '#view-create'; }
    else if (h === '/login') { view = '#view-login'; renderAuth(); }
    else if (h === '/billing') { view = '#view-billing'; loadBilling(); }
    else if (h === '/app') { view = '#view-app'; loadDashboard(); }
    else if (h.startsWith('/i/')) { view = '#view-inf'; loadInfluencer(h.slice(3)); }
    else { view = '#view-home'; }
    $(view).hidden = false;
    const isHome = view === '#view-home';
    topbar.classList.toggle('solid', !isHome || window.scrollY > 40);
    $('[data-testid="button-launch"]').classList.toggle('hidden', !isHome);
    $('#credits').classList.toggle('hidden', isHome || !state.me);
    window.scrollTo(0, 0);
    refreshMe().then(() => $('#credits').classList.toggle('hidden', isHome || !state.me));
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', () => {
    if (!$('#view-home').hidden) $('#topbar').classList.toggle('solid', window.scrollY > 40);
  }, { passive: true });

  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); return; }
    const s = e.target.closest('[data-scroll]');
    if (s) {
      e.preventDefault();
      const id = s.dataset.scroll;
      if ($('#view-home').hidden) { go('/'); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 120); }
      else { closeDrawer(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }
    }
  });

  /* ---------- drawer ---------- */
  const menuBtn = $('#menuBtn');
  function closeDrawer() { $('#drawer').classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => {
    const open = !$('#drawer').classList.contains('open');
    $('#drawer').classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) $('#topbar').classList.add('solid');
  });

  /* ---------- chips ---------- */
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chips[data-name] .chip');
    if (!chip) return;
    const group = chip.parentElement;
    const was = chip.classList.contains('on');
    $$('.chip', group).forEach((c) => c.classList.remove('on'));
    if (!was || ['gender', 'ethnicity', 'niche'].includes(group.dataset.name)) chip.classList.add('on');
  });

  /* ---------- create ---------- */
  $('#ageRange').addEventListener('input', (e) => ($('#ageOut').textContent = e.target.value));
  $('#createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.elements.name.value.trim();
    if (!name) { f.elements.name.focus(); toast('Give your influencer a name'); return; }
    const attrs = { age: f.elements.age.value, details: f.elements.details.value.trim() };
    $$('.chips[data-name]', f).forEach((g) => {
      const on = $('.chip.on', g);
      if (on) attrs[g.dataset.name] = on.dataset.v;
    });
    const niche = attrs.niche || 'Lifestyle';
    delete attrs.niche;
    const btn = $('#createBtn');
    btn.disabled = true;
    btn.textContent = 'Starting...';
    try {
      const c = await api('/api/characters', { method: 'POST', body: { name, niche, attrs } });
      f.reset();
      $('#ageOut').textContent = '24';
      go('/i/' + c.id);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate influencer · 1 credit';
    }
  });

  /* ---------- dashboard ---------- */
  async function loadDashboard() {
    const grid = $('#charGrid');
    grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const list = await api('/api/characters');
      if (!list.length) {
        grid.innerHTML = `<div class="empty"><h3>No influencers yet</h3><p>Design your first AI influencer in under a minute.</p><button class="btn btn-light" data-go="/create" data-testid="button-empty-create">Create influencer</button></div>`;
        return;
      }
      grid.innerHTML = list.map((c) => `
        <button class="char-card" data-go="/i/${c.id}" data-testid="card-influencer-${c.id}">
          ${c.portrait_status === 'done' ? `<img src="${fileUrl(c.portrait_id)}" alt="${esc(c.name)}" loading="lazy"/>` : '<div class="skeleton" style="height:100%;border-radius:0"></div>'}
          <div class="meta"><b>${esc(c.name)}</b><span>${esc(c.niche || 'Lifestyle')} · ${c.count} ${c.count === 1 ? 'post' : 'posts'}</span></div>
        </button>`).join('') +
        `<button class="char-card new" data-go="/create" data-testid="button-card-new"><span class="plus">+</span><span>New influencer</span></button>`;
    } catch (err) {
      grid.innerHTML = `<div class="empty"><h3>Could not load</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  /* ---------- influencer ---------- */
  const PRESETS = [
    ['Mirror selfie', 'taking a mirror selfie with a phone in a stylish bedroom, casual outfit, soft daylight'],
    ['Gym', 'working out in a modern gym, athletic wear, dramatic side light'],
    ['Café', 'sitting in a cozy café holding a latte, relaxed smile, warm light'],
    ['Beach', 'walking on a sunny beach at golden hour, summer outfit, ocean behind'],
    ['City night', 'on a city street at night with neon lights, trendy evening outfit'],
    ['Travel', 'posing on a scenic balcony in Santorini with white houses and blue sea'],
    ['Studio fashion', 'high fashion editorial shoot in a photo studio, designer outfit, dramatic lighting'],
    ['Cooking', 'cooking a healthy meal in a bright modern kitchen, candid moment'],
    ['Skincare', 'applying skincare in a bright bathroom, clean natural look, close-up'],
    ['Car selfie', 'taking a selfie in the driver seat of a car, sunglasses on head, daylight'],
    ['Red carpet', 'at a glamorous red carpet event, elegant evening wear, camera flashes'],
    ['Hiking', 'hiking on a mountain trail with a scenic valley view, outdoor gear'],
  ];
  $('#presets').innerHTML = PRESETS.map(([l], i) => `<button type="button" class="chip" data-p="${i}" data-testid="chip-preset-${i}">${l}</button>`).join('');
  let presetLabel = '';
  $('#presets').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $$('#presets .chip').forEach((x) => x.classList.remove('on'));
    c.classList.add('on');
    const [l, p] = PRESETS[+c.dataset.p];
    presetLabel = l;
    $('#sceneInput').value = p;
  });
  $('#sceneInput').addEventListener('input', () => { presetLabel = ''; $$('#presets .chip').forEach((x) => x.classList.remove('on')); });
  $('#aspectSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#aspectSeg button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  });

  $('#photoBtn').addEventListener('click', async () => {
    const c = state.current;
    if (!c) return;
    const scene = $('#sceneInput').value.trim();
    if (!scene) { toast('Pick a preset or describe a scene'); $('#sceneInput').focus(); return; }
    if (c.portrait_status !== 'done') { toast('Wait for the signature look to finish'); return; }
    const aspect = $('#aspectSeg .on').dataset.v;
    const btn = $('#photoBtn');
    btn.disabled = true;
    try {
      await api(`/api/characters/${c.id}/photos`, { method: 'POST', body: { scene, label: presetLabel || scene, aspect } });
      toast('Generating your photo, about 30 seconds');
      await loadInfluencer(c.id, true);
      refreshMe();
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  });

  function ratio(a) { const [w, h] = (a || '3:4').split(':'); return `${w}/${h}`; }

  function renderInfluencer(c) {
    const look = c.media.find((m) => m.id === c.portrait_id);
    const lookDone = look && look.status === 'done';
    $('#infHead').innerHTML = `
      <div class="avatar">${lookDone ? `<img src="${fileUrl(look.id)}" alt="${esc(c.name)} signature look"/>` : '<div class="skeleton" style="height:100%;border-radius:0"></div>'}</div>
      <div>
        <h1 class="h1" data-testid="text-influencer-name">${esc(c.name)}</h1>
        <p class="sub">${esc(c.niche || 'Lifestyle')} influencer · ${c.count} ${c.count === 1 ? 'post' : 'posts'}</p>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" id="regenBtn" data-testid="button-regenerate">New look · 1</button>
          <button class="btn btn-ghost btn-sm" id="delCharBtn" data-testid="button-delete-influencer">Delete</button>
        </div>
      </div>`;
    $('#composer').style.opacity = lookDone ? '1' : '0.55';
    const grid = $('#mediaGrid');
    if (!c.media.length) { grid.innerHTML = ''; return; }
    const ordered = [...c.media].sort((a, b) => (b.id === c.portrait_id) - (a.id === c.portrait_id));
    grid.innerHTML = ordered.map((m) => {
      const isLook = m.id === c.portrait_id;
      if (m.status === 'pending') {
        return `<div class="tile pending" style="aspect-ratio:${ratio(m.aspect)}" data-testid="tile-pending-${m.id}"><div class="spinner"></div><b>${m.kind === 'video' ? 'Rendering video' : isLook ? 'Creating the face' : 'Generating photo'}</b><span>${m.kind === 'video' ? '1 to 3 min' : 'about 30 sec'}</span></div>`;
      }
      if (m.status === 'failed') {
        return `<div class="tile failed" data-testid="tile-failed-${m.id}">Generation failed. Your credits were refunded. Try a different prompt.</div>`;
      }
      const tag = isLook ? '<span class="tag look">Signature look</span>' : m.kind === 'video' ? '<span class="tag">Video</span>' : '';
      const inner = m.kind === 'video'
        ? `<video src="${fileUrl(m.id)}" muted loop playsinline autoplay preload="metadata"></video>`
        : `<img src="${fileUrl(m.id)}" alt="${esc(m.label)}" loading="lazy" style="aspect-ratio:${ratio(m.aspect)}"/>`;
      return `<button class="tile" data-open="${m.id}" data-testid="tile-media-${m.id}">${tag}${inner}</button>`;
    }).join('');
  }

  async function loadInfluencer(id, quiet) {
    if (!quiet) {
      $('#infHead').innerHTML = '<div class="avatar skeleton"></div><div></div>';
      $('#mediaGrid').innerHTML = '';
    }
    try {
      const c = await api(`/api/characters/${id}`);
      state.current = c;
      renderInfluencer(c);
      schedulePoll();
    } catch (err) {
      $('#infHead').innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Not found</h3><p>${esc(err.message)}</p><button class="btn btn-light" data-go="/app">Back</button></div>`;
    }
  }

  function schedulePoll() {
    clearInterval(state.poll);
    const c = state.current;
    if (!c || !c.media.some((m) => m.status === 'pending')) return;
    state.poll = setInterval(async () => {
      if (!location.hash.startsWith('#/i/' + c.id)) { clearInterval(state.poll); return; }
      try {
        const n = await api(`/api/characters/${c.id}`);
        const before = c.media.filter((m) => m.status === 'pending').length;
        const after = n.media.filter((m) => m.status === 'pending').length;
        state.current = n;
        if (after !== before || n.media.length !== c.media.length) {
          renderInfluencer(n);
          refreshMe();
          if (after < before) toast('New content is ready');
        }
        if (!after) clearInterval(state.poll);
        else if (after !== before) schedulePoll();
      } catch (_) {}
    }, 4000);
  }

  $('#infHead').addEventListener('click', async (e) => {
    const c = state.current;
    const rb = e.target.closest('#regenBtn');
    if (rb) {
      if (!armed(rb, 'Tap to confirm')) return;
      try { await api(`/api/characters/${c.id}/regenerate`, { method: 'POST' }); await loadInfluencer(c.id, true); refreshMe(); }
      catch (err) { toast(err.message); }
    }
    const db = e.target.closest('#delCharBtn');
    if (db) {
      if (!armed(db, 'Tap to delete')) return;
      try { await api(`/api/characters/${c.id}`, { method: 'DELETE' }); toast('Influencer deleted'); go('/app'); }
      catch (err) { toast(err.message); }
    }
  });

  /* ---------- viewer ---------- */
  $('#mediaGrid').addEventListener('click', (e) => {
    const t = e.target.closest('[data-open]');
    if (t) openViewer(t.dataset.open);
  });

  function openViewer(id) {
    const c = state.current;
    const m = c.media.find((x) => x.id === id);
    if (!m) return;
    state.viewing = m;
    const isLook = m.id === c.portrait_id;
    $('#viewerMedia').innerHTML = m.kind === 'video'
      ? `<video src="${fileUrl(m.id)}" controls autoplay loop playsinline></video>`
      : `<img src="${fileUrl(m.id)}" alt="${esc(m.label)}"/>`;
    $('#viewerLabel').textContent = isLook ? 'Signature look · every new photo uses this face' : m.label;
    const acts = [
      `<a class="btn btn-light" href="${fileUrl(m.id, 1)}" target="_blank" rel="noopener" data-testid="button-download">Download</a>`,
      `<button class="btn btn-ghost" data-act="caption" data-testid="button-caption">Write caption</button>`,
    ];
    if (m.kind !== 'video') {
      acts.push(`<button class="btn btn-ghost" data-act="animate" data-testid="button-animate">Make video · 5</button>`);
      if (!isLook) acts.push(`<button class="btn btn-ghost" data-act="look" data-testid="button-set-look">Use as look</button>`);
    }
    if (!isLook) acts.push(`<button class="btn btn-ghost danger" data-act="delete" data-testid="button-delete-media">Delete</button>`);
    $('#viewerActions').innerHTML = acts.join('');
    $('#animateBox').hidden = true;
    const cap = $('#captionBox');
    if (m.caption) { cap.hidden = false; renderCaption(m.caption); } else { cap.hidden = true; }
    $('#viewer').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function renderCaption(text) {
    const cap = $('#captionBox');
    cap.hidden = false;
    cap.innerHTML = `${esc(text)}<br><button class="btn btn-ghost btn-sm" data-act="copy" data-testid="button-copy-caption">Copy caption</button>`;
  }
  function closeViewer() {
    $('#viewer').hidden = true;
    $('#viewerMedia').innerHTML = '';
    document.body.style.overflow = '';
    state.viewing = null;
  }
  $('#viewerClose').addEventListener('click', closeViewer);
  $('#viewer').addEventListener('click', (e) => { if (e.target.id === 'viewer') closeViewer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });

  $('#viewer').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const m = state.viewing;
    const c = state.current;
    const act = b.dataset.act;
    if (act === 'caption') {
      b.disabled = true; b.textContent = 'Writing...';
      try { const r = await api(`/api/media/${m.id}/caption`, { method: 'POST' }); m.caption = r.caption; renderCaption(r.caption); }
      catch (err) { toast(err.message); }
      finally { b.disabled = false; b.textContent = 'New caption'; }
    } else if (act === 'copy') {
      try { await navigator.clipboard.writeText(m.caption); toast('Caption copied'); }
      catch (_) {
        const r = document.createRange(); r.selectNodeContents($('#captionBox')); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast('Caption selected, tap Copy');
      }
    } else if (act === 'animate') {
      $('#animateBox').hidden = false; $('#motionInput').focus();
    } else if (act === 'look') {
      try { await api(`/api/characters/${c.id}/portrait/${m.id}`, { method: 'POST' }); toast('New signature look set'); closeViewer(); loadInfluencer(c.id, true); }
      catch (err) { toast(err.message); }
    } else if (act === 'delete') {
      if (!armed(b, 'Tap to delete')) return;
      try { await api(`/api/media/${m.id}`, { method: 'DELETE' }); closeViewer(); loadInfluencer(c.id, true); }
      catch (err) { toast(err.message); }
    }
  });
  $('#animateGo').addEventListener('click', async () => {
    const m = state.viewing; const c = state.current;
    const btn = $('#animateGo'); btn.disabled = true;
    try {
      await api(`/api/media/${m.id}/animate`, { method: 'POST', body: { motion: $('#motionInput').value } });
      $('#motionInput').value = '';
      toast('Rendering video, about 1 to 3 minutes');
      closeViewer(); loadInfluencer(c.id, true); refreshMe();
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  });

  /* ---------- auth ---------- */
  function renderAuth() {
    const up = state.authMode === 'signup';
    const free = state.config ? state.config.signup_credits : 20;
    $('#authEyebrow').textContent = up ? 'Welcome' : 'Welcome back';
    $('#authTitle').textContent = up ? 'Create your free account' : 'Sign in to Lumora';
    $('#authSub').textContent = up ? `Get ${free} free credits to design your first AI influencer.` : 'Pick up where you left off.';
    $('#authBtn').textContent = up ? 'Create account' : 'Sign in';
    $('#authForm').elements.password.autocomplete = up ? 'new-password' : 'current-password';
    $('#authSwitch').innerHTML = up
      ? 'Already have an account? <button type="button" class="linkish" data-auth="login" data-testid="button-to-login">Sign in</button>'
      : 'New to Lumora? <button type="button" class="linkish" data-auth="signup" data-testid="button-to-signup">Create an account</button>';
  }
  $('#authSwitch').addEventListener('click', (e) => { const b = e.target.closest('[data-auth]'); if (b) { state.authMode = b.dataset.auth; renderAuth(); } });
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.elements.email.value.trim();
    const password = f.elements.password.value;
    if (!email) { toast('Enter your email'); f.elements.email.focus(); return; }
    if (password.length < 8) { toast('Password needs at least 8 characters'); f.elements.password.focus(); return; }
    const btn = $('#authBtn'); btn.disabled = true;
    try {
      const r = await api(`/api/auth/${state.authMode === 'signup' ? 'signup' : 'login'}`, { method: 'POST', body: { email, password }, noAuthRedirect: true });
      state.token = r.token; state.me = r.me; syncAuthUI();
      f.reset();
      toast(state.authMode === 'signup' ? `Welcome to Lumora. You have ${r.me.credits} free credits` : 'Signed in');
      const next = state.next && state.next !== '/login' ? state.next : '/app';
      state.next = null; go(next);
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', noAuthRedirect: true }); } catch (_) {}
    state.me = null; state.token = null; syncAuthUI(); closeDrawer(); toast('Signed out'); go('/');
  });

  /* ---------- billing ---------- */
  const money = (c) => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
  function packsHTML(where) {
    const cfg = state.config;
    if (!cfg) return '';
    return cfg.packs.map((p) => `
      <div class="pack ${p.id === 'creator' ? 'best' : ''}" data-testid="card-pack-${p.id}">
        ${p.id === 'creator' ? '<span class="badge">Popular</span>' : ''}
        <h3>${esc(p.name)}</h3>
        <div class="price">${money(p.amount)}</div>
        <div class="per">${p.credits} credits · about ${p.credits} photos or ${Math.floor(p.credits / 5)} videos</div>
        <button class="btn ${p.id === 'creator' ? 'btn-light' : 'btn-ghost'} btn-block" data-buy="${p.id}" data-testid="button-buy-${p.id}-${where}">${cfg.payments ? 'Buy credits' : 'Coming soon'}</button>
      </div>`).join('');
  }
  async function loadConfig() {
    try { state.config = await api('/api/config', { noAuthRedirect: true }); } catch (_) { return; }
    $('#signupCredits').textContent = state.config.signup_credits;
    $('#homePacks').innerHTML = packsHTML('home');
  }
  async function loadBilling() {
    if (!state.config) await loadConfig();
    const q = hashQuery();
    const notice = $('#billNotice');
    notice.innerHTML = '';
    if (!state.config.payments) notice.innerHTML = '<div class="notice" data-testid="text-payments-off">Credit packs are coming soon. Your free credits work now.</div>';
    const sid = q.get('sid');
    if (sid) await confirmPayment(sid);
    else if (q.get('cancel')) notice.innerHTML = '<div class="notice" data-testid="text-payment-cancelled">Checkout cancelled. You were not charged.</div>';
    if (state.me) {
      $('#billCredits').textContent = state.me.credits;
      $('#billEmail').textContent = `Signed in as ${state.me.email}`;
    }
    $('#billPacks').innerHTML = packsHTML('billing');
  }
  async function confirmPayment(sid) {
    try {
      const r = await api('/api/billing/confirm?sid=' + encodeURIComponent(sid), { method: 'POST' });
      state.me = r.me; syncAuthUI();
      $('#billCredits').textContent = r.me.credits;
      $('#billNotice').innerHTML = r.status === 'paid'
        ? `<div class="notice ok" data-testid="text-payment-ok">Payment received. ${r.added} credits added to your account.</div>`
        : '<div class="notice">Payment is still processing. Check back in a minute.</div>';
      if (r.status === 'paid') state.lastSid = null;
    } catch (err) { $('#billNotice').innerHTML = `<div class="notice">${esc(err.message)}</div>`; }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    if (!state.config || !state.config.payments) { toast('Credit packs are coming soon'); return; }
    if (!state.me) { state.next = '/billing'; go('/login'); return; }
    b.disabled = true; const t = b.textContent; b.textContent = 'Opening checkout...';
    try {
      const r = await api('/api/billing/checkout', { method: 'POST', body: { pack: b.dataset.buy, return_url: location.href.split('#')[0] } });
      const m = r.url.match(/cs_[A-Za-z0-9_]+/); state.lastSid = m ? m[0] : null;
      let w = null;
      try { if (window.top === window) { location.href = r.url; return; } } catch (_) {}
      w = window.open(r.url, '_blank', 'noopener');
      if (!w) location.href = r.url;
      else toast('Finish checkout in the new tab, then come back here');
    } catch (err) { toast(err.message); }
    finally { b.disabled = false; b.textContent = t; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.lastSid && state.me) { go('/billing?sid=' + state.lastSid); }
  });

  loadConfig();
  route();
})();
