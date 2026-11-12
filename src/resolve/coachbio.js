import { findSchools, foreignInstitution, namePhrases, HANDLES } from './schools.js';
import { bioPositions } from './players.js';
import { NOISE_HANDLE, tagsFor } from './staff.js';

const ROLES = [
  ['QB', /\b(?:quarterbacks?|QBs?)\b/i],
  ['WR', /\b(?:wide\s*receivers?|receivers?|WRs?)\b/i],
  ['RB', /\b(?:running\s*backs?|RBs?)\b/i],
  ['TE', /\b(?:tight\s*ends?|TEs?)\b/i],
  ['OL', /\b(?:offensive\s*line(?:men)?|o-?line|OLs?|offensive\s*tackles?|interior\s*offensive)\b/i],
  ['DL', /\b(?:defensive\s*line(?:men)?|d-?line|DLs?|defensive\s*ends?|defensive\s*tackles?|edge|pass\s*rush(?:ers?)?)\b/i],
  ['LB', /\b(?:linebackers?|LBs?)\b/i],
  ['DB', /\b(?:cornerbacks?|CBs?|safet(?:y|ies)|defensive\s*backs?|DBs?|secondary|nickels?)\b/i],
];

const TTL_FOUND_MS = 60 * 864e5;
const TTL_MISS_MS = 30 * 864e5;
const COACHY_HANDLE = /coach/i;

export function parseCoachBio(bio) {
  const text = String(bio || '').replace(/\s+/g, ' ').trim();
  if (!text) return { school: null, nonFbs: null, group: null };
  let group = null;
  let at = Infinity;
  for (const [g, re] of ROLES) {
    const m = text.match(re);
    if (m && m.index < at) { group = g; at = m.index; }
  }
  const fbs = [...new Set(findSchools(text).filter((s) => s.id && s.confidence >= 0.9).map((s) => s.id))];
  let nonFbs = null;
  for (const p of namePhrases(text.replace(/[@#][A-Za-z0-9_]+/g, ' '))) {
    const f = foreignInstitution(p.text);
    if (f) { nonFbs = f.name; break; }
  }
  if (/\b(?:alum|alumni|alumnus|former|formerly|class\s+of|graduate|played\s+at)\b/i.test(text)) return { school: null, nonFbs: null, group };
  if (fbs.length === 1 && !nonFbs) return { school: fbs[0], nonFbs: null, group };
  if (!fbs.length && nonFbs) return { school: null, nonFbs, group };
  return { school: null, nonFbs: null, group };
}

export function loadBios(raw) {
  return raw && raw.handles ? raw : { version: 1, handles: {} };
}

export function recordBio(bios, handle, post, nowIso) {
  const h = String(handle).toLowerCase();
  if (!post) { bios.handles[h] = { at: nowIso, miss: true }; return; }
  bios.handles[h] = { at: nowIso, name: post.authorName || null, bio: post.authorBio || null, ...parseCoachBio(post.authorBio) };
}

export function bioFresh(entry, nowMs = Date.now()) {
  if (!entry) return false;
  return nowMs - new Date(entry.at).getTime() < (entry.miss ? TTL_MISS_MS : TTL_FOUND_MS);
}

export function wantedBioHandles(offers, players, bios, known, nowMs = Date.now(), limit = 80, days = 14) {
  const byPlayer = new Map(players.map((p) => [p.id, p]));
  const cutoff = nowMs - days * 864e5;
  const out = [];
  const seen = new Set();
  for (const o of offers) {
    if (new Date(o.offeredAt).getTime() < cutoff) continue;
    const p = byPlayer.get(o.playerId);
    if (!p) continue;
    const clean = p.bio ? bioPositions(p.bio).filter((x) => x !== 'ATH') : [];
    const ambiguous = !p.position || p.position === 'ATH' || clean.length >= 2;
    const ev = o.evidence || [];
    const weak = ev.length > 0 && ev.every((e) => e.attribution?.schoolEvidenceType && e.attribution.schoolEvidenceType !== 'official_school_tag');
    if (!ambiguous && !weak) continue;
    for (const e of ev) {
      for (const m of String(e.text || '').matchAll(/@([A-Za-z0-9_]{2,15})/g)) {
        const h = m[1].toLowerCase();
        if (seen.has(h) || h === e.author || h === p.handle || HANDLES.has(h) || known.has(h) || NOISE_HANDLE.test(h) || !COACHY_HANDLE.test(h)) continue;
        if (bioFresh(bios.handles[h], nowMs)) continue;
        seen.add(h);
        out.push(h);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

export function bioVeto(bios, post, schoolId, known) {
  const tags = tagsFor(post, known);
  if (!tags.length) return null;
  let hit = null;
  for (const h of tags) {
    const b = bios.handles[h];
    if (!b || b.miss) return null;
    if (b.school === schoolId) return null;
    if (!b.nonFbs) return null;
    hit ||= { handle: h, nonFbs: b.nonFbs };
  }
  return hit;
}
