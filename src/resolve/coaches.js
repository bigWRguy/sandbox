import { HANDLES } from './schools.js';
import { bioPositions } from './players.js';

export const GROUP = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  OT: 'OL', LT: 'OL', RT: 'OL', OG: 'OL', LG: 'OL', RG: 'OL', OL: 'OL', IOL: 'OL', OC: 'OL', C: 'OL',
  DL: 'DL', DT: 'DL', DE: 'DL', EDGE: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB',
  CB: 'DB', S: 'DB', SAF: 'DB', DB: 'DB',
};

const FILL = {
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', LB: 'LB',
  OL: ['OT', 'IOL'], DL: ['EDGE', 'DT'], DB: ['CB', 'S'],
};
const FILL_DEFAULT = { OL: 'OL', DL: 'DL', DB: 'DB' };
const FINE = {
  OT: 'OT', LT: 'OT', RT: 'OT', OG: 'IOL', LG: 'IOL', RG: 'IOL', IOL: 'IOL', OC: 'IOL', C: 'IOL',
  DT: 'DT', DE: 'EDGE', EDGE: 'EDGE', CB: 'CB', S: 'S', SAF: 'S',
};

const NOISE_HANDLE = /(recruit|scout|report|sports|247|rivals|on3|espn|media|network|nation|camp|prep|insider|365|highschool|hs$|academy|official|nfl|cfb|news|profootball|hudl|maxpreps|nike|adidas)/i;

const MIN_PLAYERS = 3;
const MIN_SHARE = 0.8;
const MIN_SCHOOL_SHARE = 0.8;
const OVERRIDE_MIN_COACHES = 3;

export const groupOf = (pos) => GROUP[String(pos || '').toUpperCase()] || null;

export function referenceGroup(player) {
  const bio = player.bio ? bioPositions(player.bio).filter((p) => p !== 'ATH') : [];
  if (bio.length) {
    const groups = new Set(bio.map(groupOf).filter(Boolean));
    return groups.size === 1 ? [...groups][0] : null;
  }
  if (player.bio && bioPositions(player.bio).includes('ATH')) return null;
  return player.position && player.position !== 'ATH' ? groupOf(player.position) : null;
}

function referencePosition(player) {
  const bio = player.bio ? bioPositions(player.bio).filter((p) => p !== 'ATH') : [];
  if (bio.length) return bio[0];
  return player.position && player.position !== 'ATH' ? player.position : null;
}

const tagsOf = (text) => [...new Set([...String(text || '').matchAll(/@([A-Za-z0-9_]{2,15})/g)].map((m) => m[1].toLowerCase()))];

export function buildCoachIndex(offers, players, known = new Set()) {
  const byPlayer = new Map(players.map((p) => [p.id, p]));
  const staff = new Map();
  for (const o of offers) {
    const pl = byPlayer.get(o.playerId);
    if (!pl) continue;
    const group = referenceGroup(pl);
    const fine = group ? (FINE[referencePosition(pl)] || null) : null;
    for (const e of o.evidence || []) {
      for (const h of tagsOf(e.text)) {
        if (h === pl.handle || h === e.author || HANDLES.has(h) || known.has(h) || NOISE_HANDLE.test(h)) continue;
        let rec = staff.get(h);
        if (!rec) staff.set(h, rec = { schools: new Map(), players: new Map(), posts: 0 });
        rec.posts++;
        rec.schools.set(o.schoolId, (rec.schools.get(o.schoolId) || 0) + 1);
        if (group) rec.players.set(pl.id, { group, fine });
      }
    }
  }
  return { staff, byPlayer };
}

export function coachRole(index, handle, schoolId, excludePlayerId = null) {
  const rec = index.staff.get(handle);
  if (!rec) return null;
  const rows = [...rec.players].filter(([pid]) => pid !== excludePlayerId).map(([, r]) => r);
  const n = rows.length;
  if (n < MIN_PLAYERS) return null;
  const counts = new Map();
  for (const r of rows) counts.set(r.group, (counts.get(r.group) || 0) + 1);
  const [group, top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top / n < MIN_SHARE) return null;
  if ((rec.schools.get(schoolId) || 0) / rec.posts < MIN_SCHOOL_SHARE) return null;
  const fines = new Map();
  for (const r of rows) if (r.group === group && r.fine) fines.set(r.fine, (fines.get(r.fine) || 0) + 1);
  const finTotal = [...fines.values()].reduce((s, c) => s + c, 0);
  const [fine, fc] = [...fines.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  return { group, players: n, share: top / n, fine: fine && finTotal >= 3 && fc / finTotal >= 0.7 ? fine : null };
}

function fillPosition(group, fine) {
  const opts = FILL[group];
  if (typeof opts === 'string') return opts;
  if (fine && opts.includes(fine)) return fine;
  return FILL_DEFAULT[group];
}

export function coachVotes(index, player, offers) {
  const seen = new Set();
  const votes = new Map();
  const schools = new Map();
  const fines = new Map();
  for (const o of offers) {
    for (const e of o.evidence || []) {
      for (const h of tagsOf(e.text)) {
        const key = `${h}::${o.schoolId}`;
        if (seen.has(key) || h === player.handle) continue;
        seen.add(key);
        const role = coachRole(index, h, o.schoolId, player.id);
        if (!role) continue;
        votes.set(role.group, (votes.get(role.group) || 0) + 1);
        if (!schools.has(role.group)) schools.set(role.group, new Set());
        schools.get(role.group).add(o.schoolId);
        if (role.fine) fines.set(`${role.group}:${role.fine}`, (fines.get(`${role.group}:${role.fine}`) || 0) + 1);
      }
    }
  }
  const total = [...votes.values()].reduce((s, v) => s + v, 0);
  if (!total) return null;
  const [group, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const fineBest = [...fines.entries()].filter(([k]) => k.startsWith(group + ':')).sort((a, b) => b[1] - a[1])[0];
  return { group, count, total, share: count / total, schools: schools.get(group).size, fine: fineBest ? fineBest[0].split(':')[1] : null };
}

export function settlePosition(player, votes) {
  const bio = player.bio ? bioPositions(player.bio) : [];
  const clean = bio.filter((p) => p !== 'ATH');
  const stored = player.position && player.position !== 'ATH' ? player.position : null;
  const fromBio = stored && (clean.includes(stored) || bioPositions(player.bio, { legacy: true })[0] === stored);
  const base = (fromBio ? clean[0] : stored ?? clean[0]) ?? (bio.includes('ATH') || player.position === 'ATH' ? 'ATH' : null);
  if (!votes || votes.share < 2 / 3) return { position: base, by: null };
  const inGroup = clean.find((p) => groupOf(p) === votes.group);
  if (inGroup) return { position: inGroup, by: inGroup === base ? null : 'coach' };
  if (!base || base === 'ATH') return { position: fillPosition(votes.group, votes.fine), by: 'coach' };
  if (votes.count >= OVERRIDE_MIN_COACHES && votes.schools >= OVERRIDE_MIN_COACHES && votes.share >= MIN_SHARE && groupOf(base) !== votes.group) {
    return { position: fillPosition(votes.group, votes.fine), by: 'coach' };
  }
  return { position: base, by: null };
}

export function settlePositions(offers, players, known = new Set()) {
  const index = buildCoachIndex(offers, players, known);
  const offersBy = new Map();
  for (const o of offers) {
    if (!offersBy.has(o.playerId)) offersBy.set(o.playerId, []);
    offersBy.get(o.playerId).push(o);
  }
  const changes = [];
  for (const p of players) {
    const mine = offersBy.get(p.id);
    if (!mine) continue;
    const votes = coachVotes(index, p, mine);
    const { position, by } = settlePosition(p, votes);
    if (by) p.positionBy = by; else delete p.positionBy;
    if ((position ?? null) !== (p.position ?? null)) {
      changes.push({ id: p.id, name: p.name, from: p.position ?? null, to: position ?? null, by, votes: votes ? `${votes.group}x${votes.count}/${votes.total}` : null });
      p.position = position;
    }
  }
  return changes;
}
