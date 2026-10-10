const API = {
  token: () => localStorage.getItem('cu_token'),
  user: () => JSON.parse(localStorage.getItem('cu_user') || 'null'),
  async req(path, method = 'GET', body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(API.token() ? { Authorization: 'Bearer ' + API.token() } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && API.token()) { API.logout(false); location.href = '/login.html'; }
      const err = new Error(data.error || 'Request failed'); err.status = res.status; err.data = data; throw err;
    }
    return data;
  },
  save(d) { localStorage.setItem('cu_token', d.token); localStorage.setItem('cu_user', JSON.stringify(d.user)); },
  logout(go = true) { localStorage.removeItem('cu_token'); localStorage.removeItem('cu_user'); if (go) location.href = '/'; }
};

function toast(msg, ok = true) {
  let w = document.querySelector('.toast-wrap');
  if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
  const t = document.createElement('div');
  t.className = 'toast show align-items-center mb-2';
  t.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi ${ok ? 'bi-check-circle text-success' : 'bi-exclamation-circle text-danger'} me-2"></i>${esc(msg)}</div></div>`;
  w.appendChild(t); setTimeout(() => t.remove(), 3500);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = s => new Date(s.replace(' ', 'T'));
const fmtDate = s => dt(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = s => dt(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
const fmtRange = (a, b) => `${fmtTime(a)} - ${fmtTime(b)}`;
const catIcon = { Technical: 'bi-cpu', Cultural: 'bi-music-note-beamed', Sports: 'bi-trophy', Workshop: 'bi-laptop' };
const needLogin = () => { if (!API.token()) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); return false; } return true; };

function renderChrome() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const u = API.user();
  const links = [['index.html', 'Home'], ['events.html', 'Events'], ['about.html', 'About Us'], ['contact.html', 'Contact']];
  const right = u
    ? `<div class="d-flex align-items-center gap-3">${bellHTML()}<div class="dropdown"><a class="d-flex align-items-center gap-2 text-white dropdown-toggle" data-bs-toggle="dropdown" href="#" style="text-decoration:none">
         <i class="bi bi-person-circle fs-4"></i><span class="d-none d-md-inline small">${esc(u.name)}</span></a>
       <ul class="dropdown-menu dropdown-menu-end dropdown-menu-dark">
         ${u.role === 'admin' ? '<li><a class="dropdown-item" href="/admin.html">Admin panel</a></li>' : ''}
         <li><a class="dropdown-item" href="/profile.html">My profile</a></li>
         <li><a class="dropdown-item" href="/my-events.html">My events</a></li>
         <li><a class="dropdown-item" href="/notifications.html">Notifications</a></li>
         <li><hr class="dropdown-divider"></li>
         <li><a class="dropdown-item" href="#" onclick="API.logout();return false">Log out</a></li></ul></div></div>`
    : `<a class="btn btn-cu btn-sm px-4" href="/login.html">Login</a>`;
  const navEl = document.getElementById('nav'); if (!navEl) return;
  navEl.innerHTML = `
  <nav class="navbar navbar-expand-lg cu-nav sticky-top"><div class="container">
    <a class="navbar-brand cu-brand" href="/"><img src="/img/mark.png" alt="">CATCH <span>UP</span></a>
    <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#m" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="m">
      <ul class="navbar-nav mx-auto">${links.map(([h, t]) => `<li class="nav-item"><a class="nav-link ${page === h ? 'active' : ''}" href="/${h}">${t}</a></li>`).join('')}</ul>
      ${right}
    </div></div></nav>`;
  initBell();
  const f = document.getElementById('foot');
  if (f) f.innerHTML = `<footer class="py-4 mt-5"><div class="container d-flex flex-wrap justify-content-between gap-2 small">
    <span><i class="bi bi-star-fill text-danger me-1"></i>Smarter events. Stronger campuses.</span><span>&copy; ${new Date().getFullYear()} CATCH UP</span></div></footer>`;
}
function countUp(el, to, ms = 1400) {
  const t0 = performance.now();
  const tick = t => { const p = Math.min(1, (t - t0) / ms); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
document.addEventListener('DOMContentLoaded', renderChrome);

// ---------- AI recommendation cards ----------
const recCard = e => `<div class="col-md-6 col-lg-4"><div class="ev-card">
  <div class="ev-banner ${e.category}"><i class="bi ${catIcon[e.category]}"></i><span class="badge badge-cat">${e.category}</span>${e.match != null ? `<span class="match">${e.match}% match</span>` : ''}</div>
  <div class="p-3 d-flex flex-column flex-grow-1"><h5 class="fw-bold">${esc(e.title)}</h5>
    <ul class="why list-unstyled mb-2">${e.reasons.map(r => `<li><i class="bi bi-stars"></i>${esc(r)}</li>`).join('')}</ul>
    <div class="ev-meta vstack gap-1 mb-3"><span><i class="bi bi-calendar-event"></i>${fmtDate(e.start_at)}, ${fmtTime(e.start_at)}</span><span><i class="bi bi-people"></i>${e.seats - e.registered} of ${e.seats} spots left</span></div>
    <a href="/event.html?id=${e.id}" class="btn btn-cu mt-auto">View event</a></div></div></div>`;

// ---------- interests picker (signup and profile) ----------
async function interestPicker(el, selected = []) {
  const options = await API.req('/interest-options');
  const set = new Set(selected), all = [...new Set([...options, ...selected])];
  const chip = o => `<button type="button" class="chip chip-sm ${set.has(o) ? 'on' : ''}" data-o="${esc(o)}" aria-pressed="${set.has(o)}">${esc(o)}</button>`;
  el.innerHTML = all.map(chip).join('') + '<input class="form-control form-control-sm own" placeholder="Add your own, press Enter" maxlength="40">';
  const own = el.querySelector('.own');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    const o = b.dataset.o; set.has(o) ? set.delete(o) : set.add(o);
    b.classList.toggle('on', set.has(o)); b.setAttribute('aria-pressed', set.has(o));
  });
  own.onkeydown = e => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const v = own.value.trim(); if (!v) return;
    if (![...el.querySelectorAll('[data-o]')].some(b => b.dataset.o.toLowerCase() === v.toLowerCase())) own.insertAdjacentHTML('beforebegin', chip(v));
    const b = [...el.querySelectorAll('[data-o]')].find(b => b.dataset.o.toLowerCase() === v.toLowerCase());
    set.add(b.dataset.o); b.classList.add('on'); own.value = '';
  };
  return { get: () => [...set] };
}

// ---------- instant updates: notification bell + live stream ----------
const NOTE_ICON = { registration: 'bi-ticket-perforated', checkin: 'bi-qr-code-scan', new_event: 'bi-stars', event_update: 'bi-pencil-square', announcement: 'bi-megaphone', cancellation: 'bi-x-circle' };
const ago = s => {
  const m = Math.max(0, Math.round((Date.now() - new Date(String(s).replace(' ', 'T'))) / 60000));
  if (m < 1) return 'Just now'; if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); return h < 24 ? h + ' hr ago' : fmtDate(s);
};
const noteHTML = n => `<a class="note ${+n.is_read ? '' : 'unread'}" href="${esc(n.link || '#')}" data-id="${n.id}"><i class="bi ${NOTE_ICON[n.type] || 'bi-bell'}"></i>
  <div><div class="nt">${esc(n.title)}</div>${n.body ? `<div class="nb">${esc(n.body)}</div>` : ''}<div class="nw">${ago(n.created_at)}</div></div></a>`;
const bellHTML = () => `<div class="dropdown" id="bellwrap"><button class="bell" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-label="Notifications"><i class="bi bi-bell fs-5"></i><span class="bdot d-none" id="bdot"></span></button>
  <div class="dropdown-menu dropdown-menu-end note-menu"><div class="note-head"><b>Notifications</b><a href="#" id="markall">Mark all read</a></div>
  <div id="notes"></div><a class="note-foot" href="/notifications.html">See all notifications</a></div></div>`;
let unreadCount = 0;
function setUnread(n) {
  unreadCount = Math.max(0, n); const d = document.getElementById('bdot'); if (!d) return;
  d.textContent = unreadCount > 9 ? '9+' : unreadCount; d.classList.toggle('d-none', !unreadCount);
}
async function refreshNotes() {
  const box = document.getElementById('notes'); if (!box) return;
  const r = await API.req('/notifications?limit=8');
  box.innerHTML = r.items.length ? r.items.map(noteHTML).join('') : '<div class="empty">Nothing yet. Updates about your events will show up here.</div>';
  setUnread(r.unread);
}
async function initBell() {
  if (!API.token() || !document.getElementById('bellwrap')) return;
  refreshNotes().catch(() => {});
  document.getElementById('markall').onclick = async e => {
    e.preventDefault(); await API.req('/notifications/read', 'POST', {}).catch(() => {});
    document.querySelectorAll('#notes .note').forEach(n => n.classList.remove('unread')); setUnread(0);
  };
  document.getElementById('notes').addEventListener('click', e => {
    const a = e.target.closest('.note'); if (!a || !a.classList.contains('unread')) return;
    fetch('/api/notifications/read', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API.token() }, body: JSON.stringify({ id: +a.dataset.id }) });
  });
  startLive();
}
function startLive() {
  if (!API.token() || window._cuStream || !window.EventSource) return;
  const es = window._cuStream = new EventSource('/api/notifications/stream?token=' + encodeURIComponent(API.token()));
  es.onmessage = e => {
    const n = JSON.parse(e.data), box = document.getElementById('notes');
    if (box) { const em = box.querySelector('.empty'); if (em) em.remove(); box.insertAdjacentHTML('afterbegin', noteHTML(n)); }
    setUnread(unreadCount + 1); toast(n.title + (n.body ? '. ' + n.body : ''));
    document.dispatchEvent(new CustomEvent('cu:notify', { detail: n }));
  };
}
