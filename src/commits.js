import { decodeEntities, sha1 } from './lib/store.js';
import { findClassYear, findPosition, findCommitName, findTaggedRecruit, handleClassYear, taggedAsSubject, NEVER_THE_RECRUIT } from './extract/rules.js';
import { commitSignals, footballContext, wrongSport, wrongLevel, isListPost, isFirstPerson, COMMIT_HINT } from './extract/commits.js';
import { resolveCommitTarget } from './resolve/attribution.js';
import { looksLikeRecruit, cleanPersonName, nameKey } from './resolve/players.js';
import { byId, findSchools, SCHOOLS } from './resolve/schools.js';
import { tierOf } from './resolve/tiers.js';
import { ensurePlayer, schoolOnlyFromPlayerName } from './resolve/ledger.js';

const ORG_AUTHOR = new RegExp(NEVER_THE_RECRUIT.source + '|american|radar|rankings|classic', 'i');
const DAY = 864e5;
const SAME_EVENT_WINDOW = 21 * DAY;
const SCHOOL_HANDLES = new Set(SCHOOLS.map((s) => s.handle.toLowerCase()));

const reject = (reason, extra = {}) => ({ status: 'rejected', reason, ...extra });

export function commitCandidate(post) {
  const text = decodeEntities([post.text, post.extra].filter(Boolean).join(' '));
  if (!COMMIT_HINT.test(text)) return false;
  const hay = text + ' ' + (post.mentions || []).map((m) => '@' + m).join(' ') + ' ' + (post.hashtags || []).map((h) => '#' + h).join(' ');
  return findSchools(hay).some((s) => s.id && s.confidence >= 0.8);
}

export function newCommitDb(events = []) {
  const eventMap = new Map();
  for (const e of [...events].sort((a, b) => new Date(a.at) - new Date(b.at))) eventMap.set(`${e.playerId}::${e.schoolId}::${e.kind}`, e);
  return { events, eventMap, newEvents: [] };
}

export function currentCommitSchool(cdb, playerId) {
  let latest = null;
  for (const e of cdb.events) {
    if (e.playerId !== playerId) continue;
    if (!latest || new Date(e.at) > new Date(latest.at)) latest = e;
  }
  return latest && latest.kind === 'commit' ? latest.schoolId : null;
}

function knownPlayerByName(db, name) {
  const k = nameKey(name);
  if (!k) return null;
  const hits = db.players.filter((p) => nameKey(p.name) === k);
  if (hits.length !== 1) return null;
  return hits[0];
}

function nameSentenceIndex(text, name) {
  const toks = String(name || '').toLowerCase().split(' ').filter((t) => t.length >= 3);
  if (!toks.length) return -1;
  const sents = decodeEntities(String(text || '')).replace(/https?:\/\/\S+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z@#\d\u2705\u{1F300}-\u{1FAFF}])|\n+/u).map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < sents.length; i++) {
    const low = sents[i].toLowerCase();
    if (toks.every((t) => low.includes(t))) return i;
  }
  return -1;
}

export function extractCommit(post, ctx) {
  const text = decodeEntities(post.text || '');
  if (!COMMIT_HINT.test(text)) return reject('no_commit_term');
  if (wrongSport(post)) return reject('other_sport');
  if (wrongLevel(post)) return reject('juco_or_transfer');
  if (text.length > 700) return reject('roundup_too_long');
  if (isListPost(text)) return reject('list_post');

  const verdict = looksLikeRecruit(post.authorBio, post.authorName);
  const named = findCommitName(text);
  const orgAuthor = ORG_AUTHOR.test(post.author || '') || ORG_AUTHOR.test(String(post.authorName || '').replace(/\s+/g, ''));
  const authorName = verdict.ok && !orgAuthor ? cleanPersonName(post.authorName) : null;
  const thirdParty = !!named && !(authorName && nameKey(named) === nameKey(authorName));
  const voice = !thirdParty && verdict.ok && !orgAuthor && isFirstPerson(text) ? 'player' : 'reporter';
  if (!footballContext(post, voice)) return reject('no_football_context');

  const signals = commitSignals(text, voice);
  if (!signals.length) return reject('no_commit_event');

  let rec;
  let nameAt = -1;
  if (voice === 'player') {
    if (!authorName) return reject('player_display_name_unusable');
    const cls = findClassYear(text) ?? verdict.info.classYear ?? handleClassYear(post.author);
    if (cls == null) return reject('player_missing_class_year');
    rec = {
      player_name: authorName,
      player_handle: post.author,
      class_year: cls,
      position: verdict.info.position ?? findPosition(text) ?? null,
      high_school: verdict.info.highSchool ?? null,
      state: verdict.info.state ?? null,
    };
  } else {
    const tagged = findTaggedRecruit({ ...post, mentioned: (post.mentioned || []).filter((m) => m.handle !== post.author) }, SCHOOL_HANDLES, ctx.known);
    const taggedOk = tagged && tagged.name && taggedAsSubject(text, tagged.handle);
    const name = named || (taggedOk ? tagged.name : null);
    if (!name) return reject('reporter_missing_player_name');
    nameAt = nameSentenceIndex(text, name);
    if (nameAt < 0 && !taggedOk) return reject('reporter_name_not_in_text');
    const known = knownPlayerByName(ctx.db, name);
    const cls = findClassYear(text) ?? (taggedOk ? handleClassYear(tagged.handle) : null) ?? known?.classYear ?? null;
    if (cls == null) return reject('reporter_missing_class_year');
    rec = {
      player_name: name,
      player_handle: taggedOk && nameKey(tagged.name) === nameKey(name) ? tagged.handle : (known?.handle ?? null),
      class_year: cls,
      position: findPosition(text) ?? known?.position ?? null,
      high_school: null,
      state: null,
    };
  }

  const nowDate = new Date();
  const minClass = nowDate.getUTCFullYear() + (nowDate.getUTCMonth() >= 1 ? 1 : 0);
  if (rec.class_year < minClass) return reject('class_year_not_current');

  const records = [];
  let lastReason = 'no_commit_event';
  let lastEvidence = null;
  for (const signal of signals) {
    const reach = text.length <= 300 ? 1 : 0;
    if (voice === 'reporter' && nameAt >= 0 && Math.abs(signal.index - nameAt) > reach) { lastReason = 'reporter_name_far_from_event'; continue; }
    let target = resolveCommitTarget(post, signal, ctx.affiliations);
    let viaLastKnown = false;
    if (signal.type === 'decommit' && target.status !== 'accepted' && ['commit_school_not_tagged', 'unresolved_commit_target', 'no_target_clause'].includes(target.reason)) {
      const probe = knownPlayerByName(ctx.db, rec.player_name) || (rec.player_handle ? ctx.db.players.find((p) => p.handle === rec.player_handle) : null);
      const last = probe ? currentCommitSchool(ctx.cdb, probe.id) : null;
      if (last) {
        target = { status: 'accepted', schoolId: last, reason: 'last_known_commit', evidence: { targetText: String(signal.clause || '').slice(0, 180), schoolEvidenceType: 'last_known_commit', affiliationSource: 'commit_ledger' } };
        viaLastKnown = true;
      }
    }
    if (target.status !== 'accepted') { lastReason = target.reason; lastEvidence = target.evidence; continue; }
    if (records.some((r) => r.school_id === target.schoolId && r.kind === signal.type)) continue;
    const entry = { ...rec, school_id: target.schoolId, kind: signal.type, attribution: target.evidence, flip_from: null, voice, viaLastKnown, sentence: signal.sentence };
    records.push(entry);
    if (signal.flip && signal.from) {
      const from = resolveCommitTarget(post, { clause: signal.from, form: 'object' }, ctx.affiliations);
      if (from.status === 'accepted' && from.schoolId !== target.schoolId) {
        entry.flip_from = from.schoolId;
        if (!records.some((r) => r.school_id === from.schoolId && r.kind === 'decommit')) {
          records.push({ ...rec, school_id: from.schoolId, kind: 'decommit', attribution: from.evidence, flip_from: null, voice, viaLastKnown: false, derived: 'flip', sentence: signal.sentence });
        }
      }
    }
  }
  if (!records.length) return reject(lastReason, { evidence: lastEvidence });
  return { status: 'accepted', records, voice };
}

export function upsertCommit(cdb, db, rec, post, confidence, observedAt) {
  const school = byId.get(rec.school_id);
  if (!school) return null;
  if (schoolOnlyFromPlayerName(rec, post)) return null;
  const player = ensurePlayer(db, rec, post, observedAt);
  if (!player) return null;

  const key = `${player.id}::${school.id}::${rec.kind}`;
  const at = post.createdAt;
  const evidence = {
    postId: post.id,
    author: post.author,
    url: post.url || `https://x.com/${post.author}/status/${post.id}`,
    postedAt: at,
    via: post.via || null,
    voice: rec.voice,
    confidence,
    text: String(post.text || '').slice(0, 400),
    attribution: rec.attribution || null,
  };
  let event = cdb.eventMap.get(key);
  if (event && Math.abs(new Date(at) - new Date(event.at)) > SAME_EVENT_WINDOW) event = null;
  if (!event) {
    event = {
      id: 'c_' + sha1(key + '|' + String(at).slice(0, 10)),
      kind: rec.kind,
      playerId: player.id,
      playerName: player.name,
      schoolId: school.id,
      schoolName: school.name,
      conference: school.conference,
      at,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      confidence,
      corroborations: 1,
      flipFrom: rec.flip_from || null,
      evidence: [evidence],
    };
    cdb.events.push(event);
    cdb.eventMap.set(key, event);
    cdb.newEvents.push(event);
    return event;
  }
  if (event.evidence.some((e) => e.postId === post.id)) return event;
  event.evidence.push(evidence);
  event.evidence.sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt));
  event.at = event.evidence[0].postedAt;
  event.lastSeenAt = observedAt;
  event.corroborations = new Set(event.evidence.map((e) => e.author)).size;
  event.confidence = Math.min(0.99, Math.max(event.confidence, confidence) + 0.08 * (event.corroborations - 1));
  if (rec.flip_from && !event.flipFrom) event.flipFrom = rec.flip_from;
  return event;
}

export function processCommits(posts, { cdb, db, affiliations, known, observedAt, audit }) {
  const stats = { candidates: posts.length, accepted: 0, rejected: 0, reasons: {} };
  const bump = (reason, post, extra) => {
    stats.rejected++;
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
    if (audit && post) {
      const bucket = (audit.samples ||= []);
      if (bucket.length < 24) bucket.push({ reason, postId: post.id, author: post.author, text: String(post.text || '').replace(/\s+/g, ' ').slice(0, 240), ...(extra || {}) });
    }
  };
  const ctx = { db, cdb, affiliations, known };
  const retry = [];
  const handle = (post, final) => {
    let res;
    try { res = extractCommit(post, ctx); } catch (e) { res = reject('extractor_error:' + e.message); }
    if (res.status !== 'accepted') {
      if (!final && res.reason === 'reporter_missing_class_year') { retry.push(post); return; }
      bump(res.reason, post, { targetText: res.evidence?.targetText });
      return;
    }
    let made = 0;
    for (const rec of res.records) {
      const conf = rec.derived ? 0.4 : rec.voice === 'player' ? 0.55 : 0.5;
      if (upsertCommit(cdb, db, rec, post, conf, observedAt)) made++;
    }
    if (made) stats.accepted++; else bump('invalid_or_incomplete_commit_record', post);
  };
  for (const post of posts) handle(post, false);
  for (const post of retry) handle(post, true);
  return stats;
}

export function buildCommitView(cdb, db, limit = 5000) {
  const playerById = new Map(db.players.map((p) => [p.id, p]));
  const latestByPlayer = new Map();
  for (const e of cdb.events) {
    const cur = latestByPlayer.get(e.playerId);
    if (!cur || new Date(e.at) > new Date(cur.at)) latestByPlayer.set(e.playerId, e);
  }
  const rows = [...cdb.events].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit).map((e) => {
    const p = playerById.get(e.playerId) || {};
    const school = byId.get(e.schoolId);
    const from = e.flipFrom ? byId.get(e.flipFrom) : null;
    return {
      ...e,
      playerName: p.name || e.playerName,
      playerHandle: p.handle || null,
      classYear: p.classYear ?? null,
      position: p.position ?? null,
      highSchool: p.highSchool ?? null,
      state: p.state ?? null,
      tier: tierOf(school),
      flipFromName: from ? from.name : null,
      current: latestByPlayer.get(e.playerId) === e,
      player: {
        height: p.height ?? null,
        weight: p.weight ?? null,
        gpa: p.gpa ?? null,
        bio: p.bio ?? null,
        state: p.state ?? null,
      },
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      events: cdb.events.length,
      commits: cdb.events.filter((e) => e.kind === 'commit').length,
      decommits: cdb.events.filter((e) => e.kind === 'decommit').length,
      players: new Set(cdb.events.map((e) => e.playerId)).size,
    },
    events: rows,
  };
}
