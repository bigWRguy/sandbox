import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { normalizeApifyPosts } from '../src/collect/apify-posts.js';
import { focusedSearchInput, focusedSearchMatcher } from '../src/collect/focused-search.js';
import { fetchPublicRecruiting } from '../src/collect/public-recruiting.js';
import { readJson, readNdjson } from '../src/lib/store.js';
import { nameKey } from '../src/resolve/players.js';

const { values } = parseArgs({ options: {
  from: { type: 'string' }, to: { type: 'string' }, public: { type: 'boolean' },
  'search-input': { type: 'boolean' }, 'max-posts': { type: 'string', default: '5000' },
  dataset: { type: 'string' },
} });
const start = Date.parse(values.from);
const end = Date.parse(values.to);
if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
  throw new Error('Supply --from and --to as ISO dates or timestamps, with --to after --from');
}
if (values['search-input']) {
  const count = Number(values['max-posts']);
  if (!Number.isInteger(count) || count < 1 || count > 5000) throw new Error('--max-posts must be 1–5000');
  console.log(JSON.stringify(focusedSearchInput(new Date(start), new Date(end), count), null, 2));
  process.exit(0);
}
const inPeriod = (value) => { const at = Date.parse(value); return at >= start && at < end; };
const isOriginalPost = (evidence) => /^\d+$/.test(evidence.postId);
const allPlayers = new Map(readJson('players.json', []).map((player) => [player.id, player]));
const offers = readJson('offers.json', []).filter((offer) => inPeriod(offer.firstSeenAt) && offer.evidence.some(isOriginalPost));
const events = readJson('commits.json', []).filter((event) => inPeriod(event.firstSeenAt) && event.evidence.some(isOriginalPost));
const direct = (offer, evidence) => isOriginalPost(evidence) && evidence.author === allPlayers.get(offer.playerId)?.handle;
const newRecruit = (offer) => inPeriod(allPlayers.get(offer.playerId)?.firstSeen);
const programCount = new Set(offers.map((offer) => offer.schoolId)).size;
const hoursToFind = offers.map((offer) => (Date.parse(offer.firstSeenAt) - Date.parse(offer.offeredAt)) / 36e5)
  .filter((hours) => Number.isFinite(hours) && hours >= 0).sort((a, b) => a - b);
const archives = new Map();
let legacySearchRequests = 0;
for (let ms = Date.parse(new Date(start).toISOString().slice(0, 10)); ms < end; ms += 864e5) {
  const date = new Date(ms).toISOString().slice(0, 10);
  for (const file of [`raw/${date}.ndjson`, `raw/commits-${date}.ndjson`]) {
    for (const post of readNdjson(file)) if (inPeriod(post.createdAt) && !archives.has(post.id)) archives.set(post.id, post);
  }
  for (const run of readNdjson(`audit/${date}.ndjson`)) if (run.mode === 'live' && inPeriod(run.at)) legacySearchRequests += run.search?.requests || 0;
}
const summary = {
  from: new Date(start).toISOString(), to: new Date(end).toISOString(),
  legacy: {
    offers: offers.length, schools: programCount,
    offersWithRecruitPost: offers.filter((offer) => offer.evidence.some((evidence) => direct(offer, evidence))).length,
    offersFromNewRecruits: offers.filter(newRecruit).length,
    newRecruits: new Set(offers.filter(newRecruit).map((offer) => offer.playerId)).size,
    offersAtGroupOfFiveSchools: offers.filter((offer) => offer.tier === 'G5').length,
    commitmentEvents: events.length, searchRequests: legacySearchRequests,
    medianHoursToFind: +(hoursToFind[Math.floor(hoursToFind.length / 2)] ?? 0).toFixed(1),
  },
};

const trackerIds = new Set();
const trackerEvents = new Set();
if (values.public) {
  const { records } = await fetchPublicRecruiting(new Date(Math.min(Date.now(), end - 1)));
  const key = (school, name, year) => `${school}|${nameKey(name)}|${year}`;
  const publicOffers = new Set(records.filter(({ record }) => record.kind === 'offer')
    .map(({ record }) => key(record.school_id, record.player_name, record.class_year)));
  const overlap = offers.filter((offer) => publicOffers.has(key(offer.schoolId, offer.playerName, allPlayers.get(offer.playerId)?.classYear)));
  for (const offer of overlap) trackerIds.add(offer.id);
  const commitmentKey = (kind, school, player, year) => `${kind}|${key(school, player, year)}`;
  const publicEvents = new Map();
  for (const { post, record } of records) {
    if (record.kind === 'offer') continue;
    const id = commitmentKey(record.kind, record.school_id, record.player_name, record.class_year);
    if (!publicEvents.has(id)) publicEvents.set(id, []);
    publicEvents.get(id).push(Date.parse(post.createdAt));
  }
  for (const event of events) {
    const id = commitmentKey(event.kind, event.schoolId, event.playerName, allPlayers.get(event.playerId)?.classYear);
    if (publicEvents.get(id)?.some((at) => Math.abs(at - Date.parse(event.at)) < 2 * 864e5)) trackerEvents.add(event.id);
  }
  summary.currentPublicTrackers = { overlappingLegacyOffers: overlap.length, legacyOffers: offers.length,
    overlappingFirstPersonOffers: overlap.filter((offer) => offer.evidence.some((evidence) => direct(offer, evidence))).length,
    overlappingCommitmentEvents: trackerEvents.size, legacyCommitmentEvents: events.length };
}

function recoveredBy(ids) {
  const found = (item) => item.evidence.some((evidence) => ids.has(evidence.postId));
  return {
    offers: offers.filter(found).length,
    ...(values.public ? { offersWithTrackers: offers.filter((offer) => found(offer) || trackerIds.has(offer.id)).length } : {}),
    offersWithRecruitPost: offers.filter((offer) => offer.evidence.some((evidence) => ids.has(evidence.postId) && direct(offer, evidence))).length,
    newRecruits: new Set(offers.filter((offer) => newRecruit(offer) && found(offer)).map((offer) => offer.playerId)).size,
    commitmentEvents: events.filter(found).length,
    ...(values.public ? { commitmentEventsWithTrackers: events.filter((event) => found(event) || trackerEvents.has(event.id)).length } : {}),
  };
}

const matches = focusedSearchMatcher(new Date(start));
const matchingPosts = new Set([...archives.values()].filter((post) => matches(post).length).map((post) => post.id));
summary.archivedSearchReplay = {
  matchingPosts: matchingPosts.size,
  projectedArchivePostsPer30Days: Math.round(matchingPosts.size * 30 * 864e5 / (end - start)),
  ...recoveredBy(matchingPosts),
};
if (values.dataset) {
  const rows = JSON.parse(readFileSync(values.dataset, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('The collected dataset must be a JSON array');
  const ids = new Set(normalizeApifyPosts(rows).filter((post) => inPeriod(post.createdAt)).map((post) => post.id));
  summary.collectedDataset = { rows: rows.length, postsInPeriod: ids.size, ...recoveredBy(ids) };
}
console.log(JSON.stringify(summary, null, 2));
