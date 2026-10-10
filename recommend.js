// CATCH UP recommendation engine.
// Pure functions (no database access) so the logic is easy to read and test.
//
// An event is scored for one student from four signals:
//   1. Interests    - what the student picked on their profile, matched against the event's tags, title and description
//   2. Activity     - which categories and topics they have registered for or attended before
//   3. Peers        - other students who joined the same events also joined this one
//   4. Timing       - spots running out, starting soon, general popularity
// Every score comes with plain-language reasons, so the student can see why an event was suggested.

const INTEREST_KEYWORDS = {
  'Coding': ['coding', 'code', 'programming', 'hackathon', 'developer', 'software', 'algorithm', 'dsa', 'competitive programming'],
  'AI & Machine Learning': ['ai', 'ml', 'machine learning', 'deep learning', 'data science', 'chatbot', 'neural', 'llm'],
  'Web Development': ['web', 'website', 'html', 'css', 'javascript', 'react', 'node', 'full-stack', 'full stack', 'frontend'],
  'Design': ['design', 'ui', 'ux', 'figma', 'poster', 'graphic'],
  'Music': ['music', 'singing', 'band', 'concert', 'open mic', 'instrument', 'melody'],
  'Dance': ['dance', 'choreography', 'garba'],
  'Drama & Theatre': ['drama', 'theatre', 'theater', 'skit', 'acting', 'mime'],
  'Sports': ['sports', 'cricket', 'kabaddi', 'football', 'athletics', 'tournament', 'track and field'],
  'Entrepreneurship': ['startup', 'pitch', 'entrepreneur', 'entrepreneurship', 'business', 'founder', 'innovation'],
  'Photography': ['photography', 'photo', 'camera', 'film', 'videography'],
  'Gaming': ['gaming', 'esports', 'e-sports', 'game'],
  'Robotics & IoT': ['robot', 'robotics', 'iot', 'arduino', 'electronics', 'drone'],
  'Public Speaking': ['debate', 'public speaking', 'quiz', 'mun', 'elocution', 'speech'],
  'Career & Placements': ['career', 'placement', 'resume', 'interview', 'internship'],
  'Art & Craft': ['art', 'craft', 'painting', 'sketch', 'rangoli', 'mehndi']
};
const INTEREST_OPTIONS = Object.keys(INTEREST_KEYWORDS);

const lc = s => String(s == null ? '' : s).toLowerCase();
const splitList = s => (Array.isArray(s) ? s : String(s || '').split(',')).map(x => String(x).trim()).filter(Boolean);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, kw) => new RegExp('(^|[^a-z0-9])' + escRe(kw) + '([^a-z0-9]|$)').test(text);

// Keep interests and tags short, tidy and unique. Used on every write.
function cleanInterests(input, max = 12) {
  const seen = new Set(), out = [];
  for (const raw of splitList(input)) {
    const v = raw.replace(/[^\p{L}\p{N} &+#.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (v && !seen.has(lc(v))) { seen.add(lc(v)); out.push(v); }
    if (out.length >= max) break;
  }
  return out;
}

// How strongly one interest matches one event. 3 = tagged with it, 2 = named in the title or tags, 1 = mentioned in the description.
function matchOne(interest, ev) {
  const name = lc(interest);
  const tags = splitList(ev.tags).map(lc);
  const title = lc(ev.title), desc = lc(ev.description), cat = lc(ev.category);
  if (tags.includes(name) || cat === name) return 3;
  const key = Object.keys(INTEREST_KEYWORDS).find(k => lc(k) === name);
  const kws = (key ? INTEREST_KEYWORDS[key] : []).concat([name]);
  const head = title + ' ' + tags.join(' ');
  if (kws.some(k => hasWord(head, k))) return 2;
  if (kws.some(k => hasWord(desc, k))) return 1;
  return 0;
}

// Total interest score for one student and one event, plus which interests matched.
function interestScore(interests, ev) {
  let score = 0; const hit = [];
  for (const i of splitList(interests)) { const m = matchOne(i, ev); if (m) { score += m; hit.push(i); } }
  return { score: Math.min(score, 6), matched: hit };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * @param {object}   p
 * @param {string[]} p.interests   the student's chosen interests
 * @param {object[]} p.history     their registrations: { event_id, status, category, tags, title }
 * @param {object}   p.coCounts    { [eventId]: number of similar students who joined it }
 * @param {object[]} p.events      candidate events (with seats, registered, start_at, ...)
 * @param {Set}      p.joined      event ids the student is already registered for
 * @param {Date}     p.now
 */
function recommend({ interests = [], history = [], coCounts = {}, events = [], joined = new Set(), now = new Date() }) {
  const cold = !interests.length && !history.length;

  // Category affinity: attending counts double, registering once.
  const catW = {}; let totalW = 0;
  const pastTags = [];
  for (const h of history) {
    const w = h.status === 'checked_in' ? 2 : 1;
    catW[h.category] = (catW[h.category] || 0) + w; totalW += w;
    pastTags.push({ title: h.title, tags: splitList(h.tags).map(lc), w });
  }

  const out = [];
  for (const ev of events) {
    if (joined.has(ev.id) || ev.status === 'Past') continue;
    const left = ev.seats - ev.registered;
    if (left <= 0) continue;

    let score = 0; const why = [];

    const im = interestScore(interests, ev);
    if (im.score) { score += im.score; why.push(`Matches your interest in ${im.matched.slice(0, 2).join(' and ')}`); }

    if (totalW && catW[ev.category]) {
      score += 3 * catW[ev.category] / totalW;
      const n = history.filter(h => h.category === ev.category).length;
      why.push(`You have joined ${plural(n, ev.category + ' event')} before`);
    }

    const evTags = splitList(ev.tags).map(lc);
    let best = null, shared = 0;
    for (const p of pastTags) {
      const k = p.tags.filter(t => evTags.includes(t)).length;
      if (k > shared) { shared = k; best = p; }
    }
    if (shared) { score += Math.min(2, shared); why.push(`Similar to ${best.title}`); }

    const c = coCounts[ev.id] || 0;
    if (c) { score += Math.min(2, 0.7 * c); why.push(`${plural(c, 'student')} with similar activity joined this`); }

    const fill = ev.seats ? ev.registered / ev.seats : 0;
    score += 0.5 * fill;
    if (fill >= 0.8) { score += 0.5; why.push(`Only ${plural(left, 'spot')} left`); }
    const days = (new Date(String(ev.start_at).replace(' ', 'T')) - now) / 864e5;
    if (days >= 0 && days <= 3) { score += 0.4; why.push('Starting soon'); }

    // A match percentage is only shown when something about this student actually pointed at the event.
    const signal = !!(im.score || shared || c || (totalW && catW[ev.category]));
    if (!why.length) why.push(cold ? 'Popular on campus' : 'Something new to try');
    const match = signal ? Math.max(10, Math.min(98, Math.round(100 * (1 - Math.exp(-score / 6))))) : null;
    out.push({ ...ev, score: +score.toFixed(2), match, reasons: why.slice(0, 3) });
  }
  return out.sort((a, b) => b.score - a.score || String(a.start_at).localeCompare(String(b.start_at)));
}

module.exports = { recommend, interestScore, cleanInterests, splitList, INTEREST_OPTIONS, INTEREST_KEYWORDS };
