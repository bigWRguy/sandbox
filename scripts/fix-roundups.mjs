import fs from 'node:fs';
import path from 'node:path';
import { prefilter, rulesOnlyOffers, upsert } from '../src/pipeline.js';
import { indexPlayers } from '../src/resolve/players.js';
import { decorateOffers } from '../src/resolve/tiers.js';
import { resolveOfferTarget } from '../src/resolve/attribution.js';
import { parseRoundup } from '../src/extract/rules.js';
import { DATA } from '../src/lib/store.js';

const write = process.argv.includes('--write');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const offers = read('offers.json');
const players = read('players.json');
const affiliations = read('affiliations.json');

const rawDir = path.join(DATA, 'raw');
const roundups = fs.readdirSync(rawDir).sort().flatMap((f) =>
  fs.readFileSync(path.join(rawDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  .filter((p) => (parseRoundup(p.text) || []).length >= 2);
const ids = new Set(roundups.map((p) => p.id));
console.log(`roundup posts in archive: ${roundups.length}`);

const kept = offers.filter((o) => !o.evidence.every((e) => ids.has(e.postId)));
const dropped = offers.length - kept.length;
const stillUsed = new Set(kept.map((o) => o.playerId));
const orphans = players.filter((p) => !stillUsed.has(p.id) && !p.handle && !p.bio);
const keptPlayers = players.filter((p) => !orphans.includes(p));

const db = {
  players: keptPlayers, offers: kept, review: [],
  offerMap: new Map(kept.map((o) => [`${o.playerId}::${o.schoolId}`, o])),
  _index: indexPlayers(keptPlayers), _new: [], newOffers: [],
};
let made = 0;
for (const p of prefilter(roundups)) {
  for (const rec of rulesOnlyOffers(p)) {
    const target = resolveOfferTarget(p, affiliations);
    if (target.status !== 'accepted') continue;
    rec.school_id = target.schoolId; rec.attribution = target.evidence;
    const at = new Date(p.createdAt).toISOString();
    if (upsert(db, rec, p, 0.45, at)) made++;
  }
}
const stats = decorateOffers(db.offers);
for (const pl of db.players) { const st = stats.get(pl.id); if (st) pl.offerCounts = { total: st.total, p4: st.p4, g5: st.g5 }; }
db.offers.sort((a, b) => new Date(b.offeredAt) - new Date(a.offeredAt));
console.log(`offers ${offers.length} -> ${db.offers.length} (dropped ${dropped}, rebuilt ${made}); players ${players.length} -> ${db.players.length}`);
if (write) {
  fs.writeFileSync(path.join(DATA, 'offers.json'), JSON.stringify(db.offers, null, 2) + '\n');
  fs.writeFileSync(path.join(DATA, 'players.json'), JSON.stringify(db.players, null, 2) + '\n');
  console.log('written');
}
