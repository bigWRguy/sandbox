import { HANDLES, byId, norm } from './schools.js';
import { decodeEntities } from '../lib/store.js';

export const NOISE_HANDLE = /(recruit|scout|report|sports|247|rivals|on3|espn|media|network|nation|camp|prep|insider|365|highschool|hs$|academy|official|nfl|cfb|news|profootball|hudl|maxpreps|nike|adidas)/i;

const MIN_NON_FBS = 3;
const MIN_SHARE = 0.8;
const MIN_FBS = 2;
const MAX_ENTRIES = 30000;
const SINGLETON_TTL_MS = 14 * 864e5;

export const NON_FBS_REASONS = new Set(['explicit_non_fbs_target', 'non_fbs_handle_target', 'non_fbs_program_tagged']);

const OBJECT_HANDLE = /\b(?:offer|offered|offers|scholarship)\s+(?:to\s+play\s+\w+\s+)?(?:from|by)\s+@([A-Za-z0-9_]{2,15})/gi;

export function nonFbsHandleTarget(text) {
  for (const m of decodeEntities(text || '').matchAll(OBJECT_HANDLE)) {
    const h = m[1].toLowerCase();
    if (HANDLES.has(h)) return false;
    if (/(football|fball|athletics|_fb|fb|ftbl)$/i.test(h)) return true;
  }
  return false;
}

const CUE_BEFORE = /(?:conversation|convo|call|talk|chat|speaking|spoke|thank(?:s| you)?|thanks|appreciate|grateful\s+to)\b(?:\s+(?:with|to|from|you|coach|for|the|a|great|good|nice|long|phone|call|conversation|and|&))*(?:\s+@[A-Za-z0-9_]+(?:\s*(?:,|&|and)\s*)?)*\s*$/i;
const CUE_AFTER = /^\s*(?:for\s+(?:the\s+)?(?:opportunity|offer|believing|belief|reaching)|offered)/i;
const OFFER_FROM = /\b(?:offer|offered|scholarship)\s+(?:from|by)\s+(?:coach\s+)?$/i;

export function tagsFor(post, known = new Set()) {
  const text = decodeEntities(String(post.text || ''));
  const out = new Set();
  for (const m of text.matchAll(/@([A-Za-z0-9_]{2,15})/g)) {
    const h = m[1].toLowerCase();
    if (h === post.author || h === post.playerHandle || HANDLES.has(h) || known.has(h) || NOISE_HANDLE.test(h) || /juco/i.test(h)) continue;
    const before = text.slice(Math.max(0, m.index - 70), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (CUE_BEFORE.test(before) || CUE_AFTER.test(after) || OFFER_FROM.test(before)) out.add(h);
  }
  return [...out];
}

export function loadStaff(raw) {
  return raw && raw.handles ? raw : { version: 1, handles: {} };
}

export function observeNonFbs(staff, post, known, at) {
  for (const h of tagsFor(post, known)) {
    const r = (staff.handles[h] ||= { x: 0, f: {}, at });
    r.x++;
    r.at = at;
  }
}

export function observeFbs(staff, post, schoolId, known, at) {
  for (const h of tagsFor(post, known)) {
    const r = (staff.handles[h] ||= { x: 0, f: {}, at });
    r.f[schoolId] = (r.f[schoolId] || 0) + 1;
    r.at = at;
  }
}

const GENERIC_WORD = new Set(['state', 'university', 'college', 'football', 'tech', 'north', 'south', 'east', 'west', 'central', 'national', 'american', 'atlantic', 'international', 'carolina', 'miami', 'texas', 'florida']);

function looksLikeSchoolAccount(handle, schoolId) {
  const s = byId.get(schoolId);
  if (!s) return false;
  const flat = String(handle).toLowerCase().replace(/[^a-z0-9]/g, '');
  const words = new Set();
  for (const v of [s.name, s.nickname, s.handle, ...(s.aliases || [])]) {
    for (const w of norm(v).split(' ')) {
      if (w.length < 3 || GENERIC_WORD.has(w)) continue;
      words.add(w);
      if (w.length >= 5 && w.endsWith('s')) words.add(w.slice(0, -1));
    }
  }
  return [...words].some((w) => flat.includes(w));
}

export function staffVeto(staff, post, schoolId, known) {
  const tags = tagsFor(post, known);
  if (!tags.length) return null;
  let hit = null;
  for (const h of tags) {
    const r = staff.handles[h];
    if (!r) return null;
    if (looksLikeSchoolAccount(h, schoolId)) return null;
    if ((r.f?.[schoolId] || 0) >= MIN_FBS) return null;
    const f = Object.values(r.f || {}).reduce((a, b) => a + b, 0);
    if (!(r.x >= MIN_NON_FBS && r.x / (r.x + f) >= MIN_SHARE)) return null;
    hit ||= { handle: h, nonFbs: r.x, fbs: f };
  }
  return hit;
}

export function pruneStaff(staff, nowMs = Date.now()) {
  const entries = Object.entries(staff.handles);
  for (const [h, r] of entries) {
    const n = r.x + Object.values(r.f || {}).reduce((a, b) => a + b, 0);
    if (n <= 1 && nowMs - new Date(r.at).getTime() > SINGLETON_TTL_MS) delete staff.handles[h];
  }
  const left = Object.entries(staff.handles);
  if (left.length > MAX_ENTRIES) {
    left.sort((a, b) => new Date(a[1].at) - new Date(b[1].at));
    for (const [h] of left.slice(0, left.length - MAX_ENTRIES)) delete staff.handles[h];
  }
}

export function pruneOffers(offers, staff, known, bios = null, bioCheck = null) {
  const removed = [];
  const kept = [];
  for (const o of offers) {
    const ev = o.evidence || [];
    const weak = ev.length > 0 && ev.every((e) => e.attribution?.schoolEvidenceType && e.attribution.schoolEvidenceType !== 'official_school_tag');
    const vetoed = weak && ev.every((e) => {
      const post = { author: e.author, text: e.text, mentions: [] };
      return staffVeto(staff, post, o.schoolId, known) || (bioCheck && bioCheck(bios, post, o.schoolId, known));
    });
    if (vetoed) removed.push(o); else kept.push(o);
  }
  return { kept, removed };
}
