require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');
const { recommend, interestScore, cleanInterests, splitList, INTEREST_OPTIONS } = require('./recommend');
const { draftEvent } = require('./ai');
const { notify, addClient } = require('./notify');

const app = express();
const SECRET = process.env.JWT_SECRET || 'dev_secret';
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
class HttpError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; } }
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...e.extra });
  console.error(e); res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
const withTx = async fn => {
  const c = await db.getConnection();
  try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
};
const sign = u => jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(t, SECRET); next(); } catch { res.status(401).json({ error: 'Please log in to continue.' }); }
};
const optAuth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(t, SECRET); } catch { req.user = null; }
  next();
};
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });
const pub = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, college: u.college, course: u.course, role: u.role, interests: splitList(u.interests) });
const newPass = () => 'CU-' + crypto.randomBytes(6).toString('hex').toUpperCase();
const validEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
const stripLive = 'CASE WHEN e.end_at < NOW() THEN "Past" WHEN e.start_at <= NOW() THEN "Active" ELSE "Upcoming" END';
const regCount = 'SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id';

// Lock the event row so two people can never take the last seat at the same moment.
async function lockEvent(c, id) {
  const [[e]] = await c.query('SELECT *, (end_at < NOW()) AS is_past FROM events WHERE id=? FOR UPDATE', [id]);
  if (!e) throw new HttpError(404, 'Event not found.');
  return e;
}
async function assertSeats(c, e, need) {
  if (+e.is_past) throw new HttpError(400, 'This event has already ended.');
  const [[{ n }]] = await c.query('SELECT COUNT(*) n FROM registrations WHERE event_id=?', [e.id]);
  if (n + need > e.seats) throw new HttpError(400, n >= e.seats ? 'This event is full.' : `Only ${e.seats - n} seat(s) left, but you need ${need}.`);
}
async function assertNew(c, eventId, people) {
  for (const p of people) {
    const [d] = await c.query('SELECT id FROM registrations WHERE event_id=? AND (attendee_email=? OR user_id=?)', [eventId, p.email, p.user_id || 0]);
    if (d.length) throw new HttpError(409, `${p.email} is already registered for this event.`);
  }
}

// ---------- auth ----------
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { name, email, password, phone, college, course, interests } = req.body;
  if (!name || !validEmail(email) || !password || password.length < 6) throw new HttpError(400, 'Name, a valid email and a password of 6+ characters are required.');
  const [ex] = await db.query('SELECT id FROM users WHERE email=?', [email]);
  if (ex.length) throw new HttpError(409, 'An account with this email already exists.');
  const hash = await bcrypt.hash(password, 10);
  const [r] = await db.query('INSERT INTO users (name,email,password,phone,college,course,interests) VALUES (?,?,?,?,?,?,?)', [name, email, hash, phone || null, college || null, course || null, cleanInterests(interests).join(',')]);
  const [[u]] = await db.query('SELECT * FROM users WHERE id=?', [r.insertId]);
  res.json({ token: sign(u), user: pub(u) });
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const [[u]] = await db.query('SELECT * FROM users WHERE email=?', [email || '']);
  if (!u || !(await bcrypt.compare(password || '', u.password))) throw new HttpError(401, 'Email or password is incorrect.');
  res.json({ token: sign(u), user: pub(u) });
}));
app.get('/api/me', auth, wrap(async (req, res) => {
  const [[u]] = await db.query('SELECT * FROM users WHERE id=?', [req.user.id]);
  res.json(pub(u));
}));
app.put('/api/me', auth, wrap(async (req, res) => {
  const { name, phone, college, course } = req.body;
  const interests = req.body.interests === undefined ? null : cleanInterests(req.body.interests).join(',');
  await db.query('UPDATE users SET name=?, phone=?, college=?, course=?, interests=COALESCE(?, interests) WHERE id=?', [name, phone, college, course, interests, req.user.id]);
  const [[u]] = await db.query('SELECT * FROM users WHERE id=?', [req.user.id]);
  res.json(pub(u));
}));

// ---------- public ----------
app.get('/api/events', wrap(async (req, res) => {
  const { category, q } = req.query;
  let sql = `SELECT e.*, ${stripLive} AS status, (${regCount}) AS registered FROM events e WHERE e.end_at >= NOW()`;
  const p = [];
  if (category && category !== 'All') { sql += ' AND e.category=?'; p.push(category); }
  if (q) { sql += ' AND e.title LIKE ?'; p.push(`%${q}%`); }
  const [rows] = await db.query(sql + ' ORDER BY e.start_at', p);
  res.json(rows);
}));
app.get('/api/events/:id', wrap(async (req, res) => {
  const [[e]] = await db.query(`SELECT e.*, ${stripLive} AS status, (${regCount}) AS registered FROM events e WHERE e.id=?`, [req.params.id]);
  if (!e) throw new HttpError(404, 'Event not found.');
  res.json(e);
}));
app.get('/api/stats', wrap(async (req, res) => {
  const [[a]] = await db.query('SELECT COUNT(*) events FROM events');
  const [[b]] = await db.query('SELECT COUNT(*) students FROM users WHERE role="student"');
  const [[c]] = await db.query('SELECT COUNT(DISTINCT college) colleges FROM users WHERE college IS NOT NULL');
  res.json({ ...a, ...b, ...c });
}));
app.post('/api/contact', wrap(async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) throw new HttpError(400, 'Please fill in every field.');
  await db.query('INSERT INTO messages (name,email,message) VALUES (?,?,?)', [name, email, message]);
  res.json({ ok: true });
}));
// Shareable pass page (no login): lets a team member open their own QR from a link.
app.get('/api/pass/:code', wrap(async (req, res) => {
  const [[r]] = await db.query(`SELECT r.pass_code, r.attendee_name name, r.status, r.checked_in_at, e.title, e.venue, e.start_at, e.end_at, t.name team_name
    FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN teams t ON t.id=r.team_id WHERE r.pass_code=?`, [String(req.params.code).toUpperCase()]);
  if (!r) throw new HttpError(404, 'Pass not found.');
  res.json(r);
}));

// ---------- AI recommendations ----------
app.get('/api/interest-options', (req, res) => res.json(INTEREST_OPTIONS));

// Personalised when the student is logged in (interests + past activity + similar students), otherwise "popular on campus".
app.get('/api/recommendations', optAuth, wrap(async (req, res) => {
  const limit = Math.min(12, Math.max(1, +req.query.limit || 6));
  const [events] = await db.query(`SELECT e.*, ${stripLive} AS status, (${regCount}) AS registered FROM events e WHERE e.end_at >= NOW()`);
  let interests = [], history = [], co = {}, joined = new Set();
  if (req.user) {
    const [[u]] = await db.query('SELECT interests FROM users WHERE id=?', [req.user.id]);
    interests = splitList(u && u.interests);
    [history] = await db.query(`SELECT r.event_id, r.status, e.category, e.tags, e.title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.user_id=?`, [req.user.id]);
    joined = new Set(history.map(h => h.event_id));
    const [peers] = await db.query(`SELECT p2.event_id, COUNT(DISTINCT p2.user_id) c FROM registrations mine
      JOIN registrations p1 ON p1.event_id=mine.event_id AND p1.user_id IS NOT NULL AND p1.user_id<>mine.user_id
      JOIN registrations p2 ON p2.user_id=p1.user_id WHERE mine.user_id=? GROUP BY p2.event_id`, [req.user.id]);
    for (const p of peers) co[p.event_id] = +p.c;
  }
  const items = recommend({ interests, history, coCounts: co, events, joined }).slice(0, limit);
  res.json({ personalized: !!(interests.length || history.length), has_interests: interests.length > 0, items });
}));

// ---------- instant updates ----------
// EventSource cannot send headers, so the stream takes the login token as a query parameter.
app.get('/api/notifications/stream', (req, res) => {
  let u; try { u = jwt.verify(String(req.query.token || ''), SECRET); } catch { return res.status(401).end(); }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); res.write('retry: 4000\n\n');
  const drop = addClient(u.id, res);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(beat); drop(); });
});
app.get('/api/notifications', auth, wrap(async (req, res) => {
  const limit = Math.min(100, +req.query.limit || 30);
  const [items] = await db.query('SELECT id,type,title,body,link,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?', [req.user.id, limit]);
  const [[{ unread }]] = await db.query('SELECT COUNT(*) unread FROM notifications WHERE user_id=? AND is_read=0', [req.user.id]);
  res.json({ unread, items });
}));
app.post('/api/notifications/read', auth, wrap(async (req, res) => {
  if (req.body.id) await db.query('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', [req.body.id, req.user.id]);
  else await db.query('UPDATE notifications SET is_read=1 WHERE user_id=?', [req.user.id]);
  res.json({ ok: true });
}));

// ---------- registration ----------
app.post('/api/events/:id/register', auth, wrap(async (req, res) => {
  const out = await withTx(async c => {
    const e = await lockEvent(c, req.params.id);
    if (e.type === 'group') throw new HttpError(400, 'This is a team event. Register with your team.');
    await assertSeats(c, e, 1);
    const [[u]] = await c.query('SELECT * FROM users WHERE id=?', [req.user.id]);
    await assertNew(c, e.id, [{ email: u.email.toLowerCase(), user_id: u.id }]);
    const pass = newPass();
    await c.query('INSERT INTO registrations (user_id,event_id,pass_code,attendee_name,attendee_email) VALUES (?,?,?,?,?)', [u.id, e.id, pass, u.name, u.email.toLowerCase()]);
    return { pass_code: pass, title: e.title, event_id: e.id };
  });
  notify([req.user.id], { type: 'registration', title: 'You are registered', body: `Your pass for ${out.title} is ready. Show the QR code at the entrance.`, link: '/my-events.html' });
  res.json({ ok: true, pass_code: out.pass_code });
}));

// Group registration: the logged-in student is the team leader and adds the other members.
app.post('/api/events/:id/register-team', auth, wrap(async (req, res) => {
  const teamName = String(req.body.team_name || '').trim();
  const others = Array.isArray(req.body.members) ? req.body.members : [];
  if (!teamName) throw new HttpError(400, 'Give your team a name.');
  const out = await withTx(async c => {
    const e = await lockEvent(c, req.params.id);
    if (e.type !== 'group') throw new HttpError(400, 'This is an individual event.');
    const [[lead]] = await c.query('SELECT * FROM users WHERE id=?', [req.user.id]);
    const people = [{ name: lead.name, email: lead.email.toLowerCase(), user_id: lead.id, leader: true }];
    for (const m of others) {
      const name = String(m.name || '').trim(), email = String(m.email || '').trim().toLowerCase();
      if (!name || !validEmail(email)) throw new HttpError(400, 'Every member needs a name and a valid email.');
      const [[acct]] = await c.query('SELECT id FROM users WHERE email=?', [email]);
      people.push({ name, email, user_id: acct ? acct.id : null });
    }
    if (new Set(people.map(p => p.email)).size !== people.length) throw new HttpError(400, 'Each member needs a different email.');
    if (people.length < e.min_team || people.length > e.max_team) throw new HttpError(400, `Teams for this event must have ${e.min_team} to ${e.max_team} members (you have ${people.length}).`);
    await assertSeats(c, e, people.length);
    await assertNew(c, e.id, people);
    const [dupName] = await c.query('SELECT id FROM teams WHERE event_id=? AND name=?', [e.id, teamName]);
    if (dupName.length) throw new HttpError(409, 'That team name is taken. Choose another.');
    const [t] = await c.query('INSERT INTO teams (event_id,name,leader_id) VALUES (?,?,?)', [e.id, teamName, lead.id]);
    const members = [];
    for (const p of people) {
      const pass = newPass();
      await c.query('INSERT INTO registrations (user_id,event_id,team_id,pass_code,attendee_name,attendee_email) VALUES (?,?,?,?,?,?)', [p.user_id, e.id, t.insertId, pass, p.name, p.email]);
      members.push({ name: p.name, email: p.email, pass_code: pass, leader: !!p.leader });
    }
    return { team_id: t.insertId, members, title: e.title, uids: people.map(p => p.user_id) };
  });
  notify(out.uids, { type: 'registration', title: 'Your team is registered', body: `${teamName} is registered for ${out.title}. Every member has their own QR pass.`, link: '/my-events.html' });
  res.json({ ok: true, team_id: out.team_id, members: out.members });
}));

app.get('/api/my/registrations', auth, wrap(async (req, res) => {
  const [rows] = await db.query(`SELECT r.id, r.pass_code, r.status, r.checked_in_at, r.team_id, t.name team_name, t.leader_id,
    e.id event_id, e.title, e.category, e.venue, e.start_at, e.end_at, (e.end_at < NOW()) AS is_past,
    e.lat, e.lng, e.radius_m, (e.lat IS NOT NULL) AS has_geo, (NOW() >= DATE_SUB(e.start_at, INTERVAL 60 MINUTE) AND NOW() <= e.end_at) AS checkin_open
    FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN teams t ON t.id=r.team_id WHERE r.user_id=? ORDER BY e.start_at`, [req.user.id]);
  res.json(rows);
}));

app.get('/api/my/teams/:id', auth, wrap(async (req, res) => {
  const [[t]] = await db.query('SELECT * FROM teams WHERE id=?', [req.params.id]);
  const [rows] = await db.query('SELECT id, user_id, attendee_name name, attendee_email email, pass_code, status, checked_in_at FROM registrations WHERE team_id=? ORDER BY id', [req.params.id]);
  if (!t || !rows.some(r => r.user_id === req.user.id)) throw new HttpError(404, 'Team not found.');
  const lead = t.leader_id === req.user.id;
  res.json({ name: t.name, is_leader: lead, members: rows.map(r => ({
    name: r.name, email: r.email, status: r.status, checked_in_at: r.checked_in_at, leader: r.user_id === t.leader_id,
    pass_code: lead || r.user_id === req.user.id ? r.pass_code : null })) });
}));

app.delete('/api/my/registrations/:id', auth, wrap(async (req, res) => {
  const [[r]] = await db.query('SELECT r.*, t.leader_id, e.title, (e.end_at < NOW()) is_past FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN teams t ON t.id=r.team_id WHERE r.id=? AND r.user_id=?', [req.params.id, req.user.id]);
  if (!r) throw new HttpError(404, 'Registration not found.');
  if (+r.is_past) throw new HttpError(400, 'This event has already ended.');
  if (r.team_id) {
    if (r.leader_id !== req.user.id) throw new HttpError(403, 'Only the team leader can cancel the team.');
    const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM registrations WHERE team_id=? AND status="checked_in"', [r.team_id]);
    if (n) throw new HttpError(400, 'Some team members are already checked in.');
    const [mates] = await db.query('SELECT user_id FROM registrations WHERE team_id=?', [r.team_id]);
    await db.query('DELETE FROM teams WHERE id=?', [r.team_id]);
    notify(mates.map(m => m.user_id), { type: 'cancellation', title: 'Team registration cancelled', body: `Your team's registration for ${r.title} was cancelled by the team leader.`, link: '/events.html' });
    return res.json({ ok: true });
  } else {
    if (r.status === 'checked_in') throw new HttpError(400, 'You are already checked in.');
    await db.query('DELETE FROM registrations WHERE id=?', [r.id]);
    notify([req.user.id], { type: 'cancellation', title: 'Registration cancelled', body: `You are no longer registered for ${r.title}.`, link: '/events.html' });
  }
  res.json({ ok: true });
}));

// ---------- check-in ----------
const logScan = (reg, eventId, code, result, method) =>
  db.query('INSERT INTO scans (registration_id,event_id,code,result,method) VALUES (?,?,?,?,?)', [reg ? reg.id : null, eventId || (reg ? reg.event_id : null), String(code).slice(0, 40), result, method]);

async function teamProgress(teamId) {
  if (!teamId) return null;
  const [[p]] = await db.query('SELECT t.id, t.name, COUNT(*) total, SUM(r.status="checked_in") done FROM teams t JOIN registrations r ON r.team_id=t.id WHERE t.id=? GROUP BY t.id', [teamId]);
  return p ? { id: p.id, name: p.name, total: +p.total, done: +p.done } : null;
}

// The one place a code is verified. The UPDATE only succeeds while status is still "registered",
// so even two simultaneous scans of the same code cannot both get in.
async function doCheckin(codeIn, eventId, method) {
  const code = String(codeIn || '').trim().toUpperCase();
  const [[r]] = await db.query('SELECT r.*, e.title, t.name team_name FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN teams t ON t.id=r.team_id WHERE r.pass_code=?', [code]);
  if (!r) { await logScan(null, eventId, code, 'invalid', method); throw new HttpError(404, 'Invalid code. No registration matches it.'); }
  if (eventId && r.event_id !== +eventId) { await logScan(r, eventId, code, 'wrong_event', method); throw new HttpError(400, `${r.attendee_name}'s pass is for "${r.title}", not this event.`); }
  const [u] = await db.query('UPDATE registrations SET status="checked_in", checked_in_at=NOW(), method=? WHERE id=? AND status="registered"', [method, r.id]);
  if (!u.affectedRows) {
    await logScan(r, null, code, 'duplicate', method);
    throw new HttpError(409, `${r.attendee_name} is already checked in. Duplicate entry rejected.`, { already_at: r.checked_in_at, name: r.attendee_name });
  }
  await logScan(r, null, code, 'accepted', method);
  if (r.user_id) notify([r.user_id], { type: 'checkin', title: 'You are checked in', body: `Welcome to ${r.title}. Enjoy the event!`, link: '/my-events.html' });
  return { ok: true, name: r.attendee_name, event: r.title, team: await teamProgress(r.team_id) };
}

app.post('/api/my/checkin', auth, wrap(async (req, res) => {
  const { registration_id, code } = req.body;
  const [[r]] = await db.query('SELECT * FROM registrations WHERE id=? AND user_id=?', [registration_id, req.user.id]);
  if (!r) throw new HttpError(404, 'Registration not found.');
  if (r.status === 'checked_in') throw new HttpError(409, 'You are already checked in.');
  const [ok] = await db.query('SELECT id FROM temp_codes WHERE event_id=? AND code=? AND expires_at > NOW()', [r.event_id, String(code || '').trim()]);
  if (!ok.length) { await logScan(r, null, r.pass_code, 'invalid', 'code'); throw new HttpError(400, 'That code is invalid or has expired.'); }
  await doCheckin(r.pass_code, r.event_id, 'code');
  res.json({ ok: true });
}));

// ---------- admin ----------
const A = [auth, admin];

app.get('/api/admin/stats', ...A, wrap(async (req, res) => {
  const [[s]] = await db.query(`SELECT
    (SELECT COUNT(*) FROM events) events,
    (SELECT COUNT(*) FROM events WHERE end_at >= NOW()) active_events,
    (SELECT COUNT(*) FROM users WHERE role='student') participants,
    (SELECT COUNT(*) FROM registrations) registrations,
    (SELECT COUNT(*) FROM teams) teams,
    (SELECT COUNT(*) FROM registrations WHERE status='checked_in') attended`);
  const [chart] = await db.query(`SELECT e.title, COUNT(r.id) registrations, SUM(r.status='checked_in') attendance
    FROM events e LEFT JOIN registrations r ON r.event_id=e.id GROUP BY e.id ORDER BY e.start_at DESC LIMIT 6`);
  const [recent] = await db.query(`SELECT r.attendee_name name, e.title, r.status, r.created_at, r.checked_in_at FROM registrations r
    JOIN events e ON e.id=r.event_id ORDER BY GREATEST(r.created_at, IFNULL(r.checked_in_at,'2000-01-01')) DESC LIMIT 6`);
  res.json({ ...s, chart: chart.map(c => ({ ...c, attendance: Number(c.attendance || 0) })), recent, ...(await insights()) });
}));

// What students are into, and where supply and demand do not line up. Plain counting, no guesswork.
async function insights() {
  const [users] = await db.query("SELECT interests FROM users WHERE role='student' AND interests IS NOT NULL AND interests<>''");
  const [events] = await db.query(`SELECT e.*, (${regCount}) AS registered FROM events e WHERE e.end_at >= NOW()`);
  const demand = {};
  for (const u of users) for (const i of splitList(u.interests)) demand[i] = (demand[i] || 0) + 1;
  const top = Object.entries(demand).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  const tips = [];
  for (const t of top) {
    const supply = events.filter(e => interestScore([t.name], e).score >= 2).length;
    if (!supply) tips.push({ kind: 'gap', text: `${t.count} student${t.count === 1 ? '' : 's'} follow ${t.name}, but no upcoming event covers it. A ${t.name} event would reach them.` });
  }
  for (const e of events) {
    const fill = e.seats ? e.registered / e.seats : 0;
    if (fill >= 0.85) tips.push({ kind: 'full', text: `${e.title} is ${Math.round(fill * 100)}% full (${e.registered} of ${e.seats}). Consider raising capacity or adding a second session.` });
    else if (fill < 0.15 && new Date(e.start_at.replace(' ', 'T')) - Date.now() < 5 * 864e5 && new Date(e.start_at.replace(' ', 'T')) > Date.now())
      tips.push({ kind: 'low', text: `${e.title} starts within 5 days with only ${e.registered} registered. Send an announcement to remind students.` });
  }
  return { top_interests: top, insights: tips.slice(0, 5), students_with_interests: users.length };
}

app.get('/api/admin/events', ...A, wrap(async (req, res) => {
  const [rows] = await db.query(`SELECT e.*, ${stripLive} AS status, (${regCount}) AS registered FROM events e ORDER BY e.start_at DESC`);
  res.json(rows);
}));
const dtn = s => { s = String(s || '').replace('T', ' '); return s.length === 16 ? s + ':00' : s; };
function evFields(b) {
  const type = b.type === 'group' ? 'group' : 'individual';
  const min = Math.max(2, +b.min_team || 2), max = Math.max(min, +b.max_team || 5);
  if (!(+b.seats > 0)) throw new HttpError(400, 'Capacity must be at least 1.');
  const st = dtn(b.start_at), en = dtn(b.end_at);
  if (en <= st) throw new HttpError(400, 'End time must be after the start time.');
  const num = v => (v === '' || v == null) ? null : Number(v);
  const lat = num(b.lat), lng = num(b.lng);
  if ((lat == null) !== (lng == null)) throw new HttpError(400, 'Give both latitude and longitude, or leave both empty.');
  if (lat != null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) throw new HttpError(400, 'The event location is not valid. Latitude is -90 to 90 and longitude -180 to 180.');
  const radius = Math.min(5000, Math.max(30, Math.round(+b.radius_m) || 150));
  return [b.title, b.category, b.description || '', b.venue || '', st, en, +b.seats, +b.fee || 0, type, min, max, cleanInterests(b.tags, 5).join(','), lat, lng, radius];
}
const evCols = 'title=?,category=?,description=?,venue=?,start_at=?,end_at=?,seats=?,fee=?,type=?,min_team=?,max_team=?,tags=?,lat=?,lng=?,radius_m=?';
app.post('/api/admin/events', ...A, wrap(async (req, res) => {
  if (!req.body.title || !req.body.start_at || !req.body.end_at) throw new HttpError(400, 'Title, start and end time are required.');
  const f = evFields(req.body);
  const [r] = await db.query(`INSERT INTO events (title,category,description,venue,start_at,end_at,seats,fee,type,min_team,max_team,tags,lat,lng,radius_m) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, f);
  // Tell the students whose interests match this event.
  const ev = { title: f[0], category: f[1], description: f[2], tags: f[11] };
  const [stu] = await db.query("SELECT id, interests FROM users WHERE role='student' AND interests IS NOT NULL AND interests<>''");
  const hits = stu.map(u => ({ id: u.id, m: interestScore(u.interests, ev) })).filter(x => x.m.score >= 2);
  for (const h of hits) notify([h.id], { type: 'new_event', title: 'New event for you', body: `${ev.title} matches your interest in ${h.m.matched.slice(0, 2).join(' and ')}.`, link: '/event.html?id=' + r.insertId });
  res.json({ ok: true, id: r.insertId, notified: hits.length });
}));
app.put('/api/admin/events/:id', ...A, wrap(async (req, res) => {
  const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM registrations WHERE event_id=?', [req.params.id]);
  if (+req.body.seats < n) throw new HttpError(400, `Capacity cannot be lower than the ${n} people already registered.`);
  const [[old]] = await db.query('SELECT * FROM events WHERE id=?', [req.params.id]);
  if (!old) throw new HttpError(404, 'Event not found.');
  const f = evFields(req.body);
  await db.query(`UPDATE events SET ${evCols} WHERE id=?`, [...f, req.params.id]);
  // Registered students hear about changes that affect them straight away.
  const changes = [];
  if (old.venue !== f[3]) changes.push(`venue is now ${f[3] || 'to be announced'}`);
  if (String(old.start_at) !== f[4] || String(old.end_at) !== f[5]) changes.push(`time is now ${f[4].slice(0, 16)} to ${f[5].slice(0, 16)}`);
  if (old.title !== f[0]) changes.push(`it is now called ${f[0]}`);
  let notified = 0;
  if (changes.length) {
    const [regs] = await db.query('SELECT DISTINCT user_id FROM registrations WHERE event_id=? AND user_id IS NOT NULL', [req.params.id]);
    notified = regs.length;
    notify(regs.map(x => x.user_id), { type: 'event_update', title: `${f[0]} was updated`, body: `For ${old.title}: ${changes.join('; ')}.`, link: '/my-events.html' });
  }
  res.json({ ok: true, notified });
}));
app.delete('/api/admin/events/:id', ...A, wrap(async (req, res) => {
  const [[ev]] = await db.query('SELECT title FROM events WHERE id=?', [req.params.id]);
  const [regs] = await db.query('SELECT DISTINCT user_id FROM registrations WHERE event_id=? AND user_id IS NOT NULL', [req.params.id]);
  await db.query('DELETE FROM events WHERE id=?', [req.params.id]);
  if (ev && regs.length) notify(regs.map(x => x.user_id), { type: 'cancellation', title: `${ev.title} was cancelled`, body: 'The organizer cancelled this event. Your registration has been removed.', link: '/events.html' });
  res.json({ ok: true });
}));

// Send a message to everyone registered for an event; it appears instantly in their notification bell.
app.post('/api/admin/events/:id/announce', ...A, wrap(async (req, res) => {
  const msg = String(req.body.message || '').trim();
  if (!msg || msg.length > 400) throw new HttpError(400, 'Write a message of up to 400 characters.');
  const [[ev]] = await db.query('SELECT title FROM events WHERE id=?', [req.params.id]);
  if (!ev) throw new HttpError(404, 'Event not found.');
  const [regs] = await db.query('SELECT DISTINCT user_id FROM registrations WHERE event_id=? AND user_id IS NOT NULL', [req.params.id]);
  notify(regs.map(x => x.user_id), { type: 'announcement', title: `Update from ${ev.title}`, body: msg, link: '/my-events.html' });
  res.json({ ok: true, sent: regs.length });
}));

// AI draft: one line in, a complete event form out.
app.post('/api/admin/ai/draft', ...A, wrap(async (req, res) => {
  const idea = String(req.body.idea || '').trim();
  if (idea.length < 6) throw new HttpError(400, 'Describe the event in a few words, for example "2-day AI hackathon for teams of 3".');
  res.json(await draftEvent(idea.slice(0, 400)));
}));

// How many students have interests that match an event that has not been created yet.
app.get('/api/admin/reach', ...A, wrap(async (req, res) => {
  const ev = { title: req.query.title || '', category: req.query.category || '', description: req.query.description || '', tags: cleanInterests(req.query.tags, 5).join(',') };
  const [stu] = await db.query("SELECT interests FROM users WHERE role='student'");
  const n = stu.filter(u => interestScore(u.interests, ev).score >= 2).length;
  res.json({ matching: n, students: stu.length });
}));

app.get('/api/admin/events/:id/registrations', ...A, wrap(async (req, res) => {
  const [rows] = await db.query(`SELECT r.id, r.attendee_name name, r.attendee_email email, r.pass_code, r.team_id, t.name team_name, r.status, r.checked_in_at, r.method
    FROM registrations r LEFT JOIN teams t ON t.id=r.team_id WHERE r.event_id=? ORDER BY r.created_at, r.id`, [req.params.id]);
  res.json(rows);
}));
app.get('/api/admin/events/:id/export', ...A, wrap(async (req, res) => {
  const [rows] = await db.query(`SELECT r.attendee_name name, r.attendee_email email, t.name team, r.status, r.checked_in_at FROM registrations r LEFT JOIN teams t ON t.id=r.team_id WHERE r.event_id=?`, [req.params.id]);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Name,Email,Team,Status,Check-in time', ...rows.map(r => [r.name, r.email, r.team, r.status, r.checked_in_at].map(esc).join(','))].join('\n');
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="registrations-${req.params.id}.csv"` }).send(csv);
}));

// Live counters for the gate screen.
app.get('/api/admin/events/:id/live', ...A, wrap(async (req, res) => {
  const [[l]] = await db.query(`SELECT e.title, e.type, e.seats capacity,
    (SELECT COUNT(*) FROM registrations WHERE event_id=e.id) registered,
    (SELECT COUNT(*) FROM registrations WHERE event_id=e.id AND status='checked_in') checked_in,
    (SELECT COUNT(*) FROM teams WHERE event_id=e.id) teams,
    (SELECT COUNT(*) FROM scans WHERE event_id=e.id AND result='duplicate') duplicates_blocked
    FROM events e WHERE e.id=?`, [req.params.id]);
  if (!l) throw new HttpError(404, 'Event not found.');
  res.json(l);
}));
app.get('/api/admin/scans', ...A, wrap(async (req, res) => {
  const id = +req.query.event_id || 0;
  const [rows] = await db.query(`SELECT s.result, s.method, s.created_at, s.code, r.attendee_name name, t.name team_name
    FROM scans s LEFT JOIN registrations r ON r.id=s.registration_id LEFT JOIN teams t ON t.id=r.team_id
    WHERE (?=0 OR s.event_id=?) ORDER BY s.id DESC LIMIT 12`, [id, id]);
  res.json(rows);
}));

// Scan a QR / type a pass code. event_id (optional) rejects passes meant for a different event.
app.post('/api/admin/checkin', ...A, wrap(async (req, res) => {
  res.json(await doCheckin(req.body.pass_code, req.body.event_id, req.body.method || 'qr'));
}));
// Let a whole team in with one tap (members who are already in are skipped).
app.post('/api/admin/teams/:id/checkin', ...A, wrap(async (req, res) => {
  const [due] = await db.query('SELECT r.user_id, e.title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.team_id=? AND r.status="registered"', [req.params.id]);
  await db.query(`INSERT INTO scans (registration_id,event_id,code,result,method) SELECT id,event_id,pass_code,'accepted','team' FROM registrations WHERE team_id=? AND status='registered'`, [req.params.id]);
  const [u] = await db.query('UPDATE registrations SET status="checked_in", checked_in_at=NOW(), method="team" WHERE team_id=? AND status="registered"', [req.params.id]);
  if (due.length) notify(due.map(d => d.user_id), { type: 'checkin', title: 'You are checked in', body: `Your team is in. Welcome to ${due[0].title}!`, link: '/my-events.html' });
  res.json({ ok: true, checked_in: u.affectedRows, team: await teamProgress(req.params.id) });
}));

// ---------- face check-in ----------
// The browser turns a face into 128 numbers (face-api.js, runs on the device). Only those numbers are sent and stored, never a photo.
// Matching happens here, so templates never leave the server. Distance below the threshold = same person (lower is stricter).
const FACE_THRESHOLD = +process.env.FACE_MATCH_THRESHOLD || 0.5;
const FACE_MARGIN = 0.04; // the best match must beat the runner-up by this much, otherwise we ask for a QR instead of guessing
function cleanDescriptors(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 5) return null;
  const out = [];
  for (const v of list) {
    if (!Array.isArray(v) || v.length !== 128) return null;
    const n = v.map(Number);
    if (n.some(x => !Number.isFinite(x) || Math.abs(x) > 5)) return null;
    out.push(n.map(x => Math.round(x * 1e5) / 1e5));
  }
  return out;
}
const faceDist = (a, b) => { let s = 0; for (let i = 0; i < 128; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };

app.get('/api/my/face', auth, wrap(async (req, res) => {
  const [[f]] = await db.query('SELECT created_at FROM face_templates WHERE user_id=?', [req.user.id]);
  res.json({ enrolled: !!f, enrolled_at: f ? f.created_at : null });
}));
app.post('/api/my/face', auth, wrap(async (req, res) => {
  if (req.body.consent !== true) throw new HttpError(400, 'Please agree to face check-in before saving.');
  const d = cleanDescriptors(req.body.descriptors);
  if (!d || d.length < 3) throw new HttpError(400, 'We need 3 clear captures of your face. Please try again.');
  await db.query('INSERT INTO face_templates (user_id, descriptors) VALUES (?,?) ON DUPLICATE KEY UPDATE descriptors=VALUES(descriptors), created_at=NOW()', [req.user.id, JSON.stringify(d)]);
  res.json({ ok: true });
}));
app.delete('/api/my/face', auth, wrap(async (req, res) => {
  await db.query('DELETE FROM face_templates WHERE user_id=?', [req.user.id]);
  res.json({ ok: true });
}));

// Student self check-in: scan your own face AND be at the event location. Both must pass or nobody is signed in.
const metersBetween = (la1, lo1, la2, lo2) => {
  const r = x => x * Math.PI / 180, a = Math.sin(r(la2 - la1) / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
};
const nice = m => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';
app.post('/api/my/face-checkin', auth, wrap(async (req, res) => {
  const probe = cleanDescriptors([req.body.descriptor]);
  const lat = Number(req.body.lat), lng = Number(req.body.lng), acc = Number(req.body.accuracy) || 0;
  if (!probe) throw new HttpError(400, 'We could not read your face. Please try again.');
  if (req.body.lat == null || req.body.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new HttpError(400, 'We could not read your location. Turn on location for this site and try again.');
  const [[r]] = await db.query(`SELECT r.id, r.event_id, r.status, r.pass_code, e.title, e.lat, e.lng, e.radius_m,
    (NOW() >= DATE_SUB(e.start_at, INTERVAL 60 MINUTE) AND NOW() <= e.end_at) is_open
    FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=? AND r.user_id=?`, [+req.body.registration_id, req.user.id]);
  if (!r) throw new HttpError(404, 'Registration not found.');
  if (r.status === 'checked_in') throw new HttpError(409, 'You are already checked in.');
  if (!+r.is_open) throw new HttpError(400, 'Check-in opens 1 hour before the event starts and closes when it ends.');
  if (r.lat == null) throw new HttpError(400, 'The organizer has not set a location for this event, so location check-in is not available. Use your QR pass at the entrance.');
  const [[f]] = await db.query('SELECT descriptors FROM face_templates WHERE user_id=?', [req.user.id]);
  if (!f) throw new HttpError(400, 'Set up face check-in on your profile first.');
  if (acc > 200) throw new HttpError(400, `Your location is too imprecise (about ${nice(acc)}). Turn on GPS or move near a window, then try again.`);

  // 1. Are you at the event?
  const away = metersBetween(lat, lng, +r.lat, +r.lng);
  if (away > r.radius_m) {
    await logScan(r, null, r.pass_code, 'out_of_range', 'face-gps');
    throw new HttpError(403, `You are not at the event location. You are about ${nice(away)} away, and sign-in only works within ${nice(r.radius_m)} of the venue. You have not been signed in.`, { code: 'out_of_range', distance: Math.round(away), radius: r.radius_m });
  }
  // 2. Is it really you?
  let best = Infinity;
  for (const t of JSON.parse(f.descriptors)) best = Math.min(best, faceDist(probe[0], t));
  if (best > FACE_THRESHOLD) {
    await logScan(r, null, r.pass_code, 'face_mismatch', 'face-gps');
    throw new HttpError(403, 'Your face did not match the one on your profile. Try again in good light, looking straight at the camera. You have not been signed in.', { code: 'face_mismatch' });
  }
  const out = await doCheckin(r.pass_code, r.event_id, 'face-gps');
  res.json({ ...out, distance: Math.round(away) });
}));

// How many of the people registered for an event can be recognised (team members without an account cannot).
app.get('/api/admin/events/:id/face-status', ...A, wrap(async (req, res) => {
  const [[s]] = await db.query('SELECT COUNT(*) total, SUM(f.user_id IS NOT NULL) enrolled FROM registrations r LEFT JOIN face_templates f ON f.user_id=r.user_id WHERE r.event_id=?', [req.params.id]);
  res.json({ total: +s.total, enrolled: +(s.enrolled || 0) });
}));

// Gate camera: one face in, one check-in out. Only people registered for THIS event are considered, and the
// real check-in goes through doCheckin, so duplicate protection, the scan log and team counts all still apply.
app.post('/api/admin/face-checkin', ...A, wrap(async (req, res) => {
  const eventId = +req.body.event_id;
  const probe = cleanDescriptors([req.body.descriptor]);
  if (!eventId || !probe) throw new HttpError(400, 'Send an event and one face reading.');
  const [rows] = await db.query('SELECT r.id, r.pass_code, f.descriptors FROM registrations r JOIN face_templates f ON f.user_id=r.user_id WHERE r.event_id=?', [eventId]);
  let best = null, second = Infinity;
  for (const r of rows) {
    let d = Infinity;
    for (const t of JSON.parse(r.descriptors)) d = Math.min(d, faceDist(probe[0], t));
    if (!best || d < best.d) { if (best) second = best.d; best = { r, d }; } else if (d < second) second = d;
  }
  if (!best || best.d > FACE_THRESHOLD) throw new HttpError(404, 'Face not recognised for this event. Use the QR pass or pass code instead.');
  if (second - best.d < FACE_MARGIN) throw new HttpError(422, 'Could not tell who this is with confidence. Use the QR pass or pass code instead.');
  try {
    res.json({ ...(await doCheckin(best.r.pass_code, eventId, 'face')), registration_id: best.r.id });
  } catch (e) {
    if (e instanceof HttpError) e.extra = { ...e.extra, registration_id: best.r.id };
    throw e;
  }
}));

app.post('/api/admin/events/:id/temp-code', ...A, wrap(async (req, res) => {
  const mins = Math.min(Math.max(+req.body.minutes || 10, 1), 120);
  const code = String(crypto.randomInt(100000, 999999));
  await db.query('DELETE FROM temp_codes WHERE event_id=?', [req.params.id]);
  await db.query('INSERT INTO temp_codes (event_id,code,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL ? MINUTE))', [req.params.id, code, mins]);
  res.json({ code, minutes: mins });
}));

app.listen(process.env.PORT || 3000, () => console.log(`CATCH UP running on http://localhost:${process.env.PORT || 3000}`));
