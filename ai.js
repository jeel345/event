// Organizer assistant: turns a one-line idea into a ready-to-edit event draft.
// With ANTHROPIC_API_KEY set it asks Claude; without a key (or if the call fails) it falls back to a
// built-in smart template, so event creation always works.
const { INTEREST_OPTIONS, INTEREST_KEYWORDS, cleanInterests } = require('./recommend');

const CATEGORIES = ['Technical', 'Cultural', 'Sports', 'Workshop'];
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const hasWord = (t, k) => new RegExp('(^|[^a-z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(t);

function templateDraft(idea) {
  const text = idea.toLowerCase();
  const tags = INTEREST_OPTIONS.filter(i => INTEREST_KEYWORDS[i].some(k => hasWord(text, k))).slice(0, 4);
  let category = 'Technical';
  if (/workshop|bootcamp|training|masterclass|session|seminar|talk/.test(text)) category = 'Workshop';
  else if (/cricket|football|kabaddi|tournament|athletic|sports|match|marathon/.test(text)) category = 'Sports';
  else if (/dance|music|drama|singing|fest|cultural|talent|open mic|art|photography/.test(text)) category = 'Cultural';
  else if (/hackathon|coding|tech|robot|ai\b|ml\b|web|app|software/.test(text)) category = 'Technical';
  const team = /team|group|hackathon|duo|squad|pairs?/.test(text);
  const n = text.match(/(\d{2,4})\s*(students|seats|people|participants|attendees)/);
  const defSeats = { Workshop: 60, Technical: 100, Cultural: 300, Sports: 200 }[category];
  const sz = text.match(/teams? of (\d)(?:\s*(?:to|-)\s*(\d))?/);
  let title = idea.trim().split(/[.\n]/)[0].split(/,| for | with | around | of \d/i)[0].replace(/\s+/g, ' ').trim() || idea.trim();
  title = title.length > 60 ? title.slice(0, 57).replace(/\s+\S*$/, '') + '...' : title;
  title = title.charAt(0).toUpperCase() + title.slice(1);
  const topic = tags.length ? ` Great if you are into ${tags.slice(0, 3).join(', ')}.` : '';
  const description = `${title}: a chance to learn by doing and meet students who share your interests.${topic} `
    + `Register on CATCH UP to get your QR pass, then show it at the entrance for a quick check-in.`;
  return {
    title, category, description, tags, seats: n ? +n[1] : defSeats,
    type: team ? 'group' : 'individual', min_team: sz ? +sz[1] : 2, max_team: sz ? +(sz[2] || sz[1]) : 4
  };
}

function normalize(d, fallback) {
  const cat = CATEGORIES.includes(d.category) ? d.category : fallback.category;
  const type = d.type === 'group' ? 'group' : 'individual';
  const min = Math.max(2, Math.min(10, +d.min_team || 2)), max = Math.max(min, Math.min(10, +d.max_team || min));
  return {
    title: String(d.title || fallback.title).slice(0, 120),
    category: cat,
    description: String(d.description || fallback.description).slice(0, 900),
    tags: cleanInterests(d.tags && d.tags.length ? d.tags : fallback.tags, 5),
    seats: Math.max(1, Math.min(5000, +d.seats || fallback.seats)),
    type, min_team: min, max_team: max
  };
}

async function askClaude(idea) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 700,
        system: 'You help college event organizers. Turn a one-line idea into an event draft. Reply with ONLY a JSON object, no markdown, with keys: '
          + 'title (max 70 chars), category (one of Technical, Cultural, Sports, Workshop), description (2 to 3 friendly sentences for students, no invented dates, venues or prices), '
          + 'tags (2 to 4 items chosen from: ' + INTEREST_OPTIONS.join(', ') + '), seats (integer, use a number from the idea if given, else a sensible default), '
          + 'type ("individual" or "group"), min_team, max_team (integers, only meaningful when type is group).',
        messages: [{ role: 'user', content: idea }]
      })
    });
    if (!r.ok) throw new Error('Claude API ' + r.status);
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(json);
  } finally { clearTimeout(t); }
}

async function draftEvent(idea) {
  const base = templateDraft(idea);
  if (!process.env.ANTHROPIC_API_KEY) return { ...base, source: 'template' };
  try { return { ...normalize(await askClaude(idea), base), source: 'ai' }; }
  catch (e) { console.error('AI draft failed, using template:', e.message); return { ...base, source: 'template' }; }
}

module.exports = { draftEvent, templateDraft };
