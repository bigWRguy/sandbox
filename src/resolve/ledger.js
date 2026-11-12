import { findSchools } from './schools.js';
import { decodeEntities, sha1 } from '../lib/store.js';
import { resolve as resolvePlayer, mergeInto, nameKey, fuzzyKey, parseBio } from './players.js';

export function schoolOnlyFromPlayerName(rec, post) {
  const name = String(rec.player_name || '');
  if (!name || !findSchools(name).some((s) => s.id === rec.school_id)) return false;
  const text = decodeEntities([post.text, post.extra].filter(Boolean).join(' '));
  const words = name.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length < 2) return false;
  const stripped = text.replace(new RegExp(`\\b${words.join('\\s+')}\\b`, 'gi'), ' ');
  return !findSchools(stripped).some((s) => s.id === rec.school_id);
}

export function ensurePlayer(db, rec, post, observedAt) {
  const incoming = {
    name: rec.player_name,
    bio: post.authorBio && rec.player_handle && post.author === String(rec.player_handle).toLowerCase()
      ? post.authorBio : null,
    handle: rec.player_handle ? String(rec.player_handle).toLowerCase().replace(/^@/, '') : null,
    classYear: rec.class_year ?? null,
    position: rec.position ?? null,
    highSchool: rec.high_school ?? null,
    state: rec.state ?? null,
  };
  if (!incoming.name || incoming.classYear == null) return null;
  if (incoming.name && !nameKey(incoming.name)) return null;

  if (incoming.bio) {
    const b = parseBio(incoming.bio);
    for (const f of ['classYear', 'position', 'highSchool', 'state', 'height', 'weight']) {
      if (incoming[f] == null && b[f] != null) incoming[f] = b[f];
    }
    for (const f of ['stars', 'gpa', 'forty']) if (b[f] != null) incoming[f] = b[f];
  }

  let player = null;
  if (incoming.handle) player = db.players.find((p) => p.handle === incoming.handle) || null;
  if (!player && incoming.name) {
    const r = resolvePlayer(db._index, incoming);
    if (r.ambiguous) db.review.push({ at: observedAt, type: 'ambiguous_player', name: incoming.name, candidates: r.candidates, post: post.id });
    player = r.player;
  }
  if (!player) {
    const identity = incoming.name || '@' + incoming.handle;
    player = {
      id: 'p_' + sha1(identity + '|' + (incoming.classYear ?? '') + '|' + (incoming.handle ?? '')),
      ...incoming,
      aliases: incoming.name ? [incoming.name] : [],
      firstSeen: observedAt,
    };
    db.players.push(player);
    if (incoming.name) db._new.push(player);
    const fk = fuzzyKey(player.name);
    if (fk) {
      if (!db._index.has(fk)) db._index.set(fk, []);
      db._index.get(fk).push(player);
    }
  } else {
    mergeInto(player, incoming);
  }
  return player;
}
