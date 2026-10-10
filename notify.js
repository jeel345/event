// Instant updates: notifications are saved in the database (so they survive a refresh) and pushed live to any
// open browser tab of that student through Server-Sent Events.
const db = require('./db');
const clients = new Map(); // userId -> Set of open response streams

function addClient(uid, res) {
  if (!clients.has(uid)) clients.set(uid, new Set());
  clients.get(uid).add(res);
  return () => { const s = clients.get(uid); if (s) { s.delete(res); if (!s.size) clients.delete(uid); } };
}

// Never throws: a failed notification must not break registration, check-in or event editing.
async function notify(userIds, { type = 'info', title, body = '', link = null }) {
  try {
    for (const id of [...new Set((userIds || []).filter(Boolean).map(Number))]) {
      const [r] = await db.query('INSERT INTO notifications (user_id,type,title,body,link) VALUES (?,?,?,?,?)', [id, type, String(title).slice(0, 150), String(body).slice(0, 500), link]);
      const msg = JSON.stringify({ id: r.insertId, type, title, body, link, is_read: 0, created_at: new Date().toISOString() });
      for (const res of clients.get(id) || []) res.write(`data: ${msg}\n\n`);
    }
  } catch (e) { console.error('notify failed:', e.message); }
}

module.exports = { notify, addClient };
