import { findPosition } from '../extract/rules.js';
import { decodeEntities, sha1 } from '../lib/store.js';
import { cleanPersonName, nameKey } from '../resolve/players.js';
import { byId, norm, SCHOOLS } from '../resolve/schools.js';

const FEED = 'https://sticktothemodel.com/college-recruiting/live';
const COMMIT_ODDS = 'https://commitodds.com';
const SPORTS_247 = 'https://247sports.com';
const PROFILE_FB = 'https://profilefb.com';
const DAY = 864e5;
const SCHOOL_IDS = { fiu: 'florida-international', 'miami-ohio': 'miami-oh', umass: 'massachusetts' };
const KINDS = { offer: 'received a football offer from', commit: 'committed to', decommit: 'decommitted from' };
const ODDS_KINDS = { Offer: 'offer', Committed: 'commit', Decommitted: 'decommit' };
const attr = (html, name) => html.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '';
const plain = (html) => decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
const dayOf = (date) => Date.parse(date.toISOString().slice(0, 10));
const schoolByPublishedName = new Map(SCHOOLS.map((school) => [norm(school.name), school]));
for (const [name, id] of Object.entries({
  'Miami (OH)': 'miami-oh', 'Miami (FL)': 'miami', FIU: 'florida-international', UMass: 'massachusetts',
  Connecticut: 'uconn', 'North Carolina State': 'nc-state',
})) {
  schoolByPublishedName.set(norm(name), byId.get(id));
}

function entry({ source, url, kind, school, name: rawName, classYear, position, state, reportedAt, publishedHandle }, now) {
  const graduationYear = now.getUTCFullYear() + Number(now.getUTCMonth() >= 6);
  const name = cleanPersonName(rawName);
  if (!name || classYear < graduationYear || classYear > graduationYear + 5) return null;
  const schoolName = school.id === 'miami' ? 'University of Miami' : school.name;
  const createdAt = new Date(reportedAt).toISOString();
  const id = 'public_' + sha1([kind, nameKey(name), classYear, school.id, createdAt].join('|'));
  return {
    post: { id, author: source, via: 'public recruiting feed', url, createdAt, datePrecision: 'day',
      text: `${name} ${KINDS[kind]} ${schoolName}.` },
    record: { kind, player_name: name, class_year: classYear, position: findPosition(position), state, school_id: school.id,
      ...(publishedHandle ? { published_handle: publishedHandle } : {}),
      voice: 'recruiting feed', attribution: { schoolEvidenceType: 'published_recruiting_record', targetText: schoolName } },
  };
}

function datedHeading(heading, today) {
  const date = heading.match(/^[A-Za-z]+, ([A-Za-z]{3} \d{1,2})$/)?.[1];
  if (!date) return NaN;
  let at = Date.parse(`${date} ${new Date(today).getUTCFullYear()} 00:00:00 GMT`);
  if (at > today) at = Date.parse(`${date} ${new Date(today).getUTCFullYear() - 1} 00:00:00 GMT`);
  return at;
}

export function parsePublicRecruiting(html, now = new Date()) {
  const today = dayOf(now);
  const blocks = [...html.matchAll(/<div class="(day|lb [^"]+)"([^>]*)>/g)];
  if (!blocks.some((block) => block[1] === 'day') || !blocks.some((block) => attr(block[2], 'data-e') === 'offer')) {
    throw new Error('Public recruiting feed has no dated event rows');
  }

  const records = new Map();
  const unknownSchools = new Set();
  const incompleteGroups = [];
  let reportedAt = NaN;
  for (const [index, block] of blocks.entries()) {
    const [, type, attributes] = block;
    const body = html.slice(block.index + block[0].length, blocks[index + 1]?.index);
    if (type === 'day') {
      reportedAt = datedHeading(body.match(/^\s*<b>([^<]+)<\/b>/)?.[1] || '', today);
      continue;
    }
    const kind = attr(attributes, 'data-e');
    if (!Object.hasOwn(KINDS, kind) || attr(attributes, 'data-lv') !== 'fbs') continue;
    if (!Number.isFinite(reportedAt) || reportedAt < today - 7 * DAY) continue;

    const slug = body.match(/href="\/college-recruiting\/([a-z0-9-]+)"/)?.[1];
    const school = byId.get(SCHOOL_IDS[slug] || slug);
    if (!school) {
      unknownSchools.add(`${slug || '?'} (${decodeEntities(attr(attributes, 'data-p'))})`);
      continue;
    }

    const athletes = kind === 'offer'
      ? body.split('<span class="oi"').slice(1).map((athlete) => {
        const end = athlete.indexOf('>');
        return { attrs: athlete.slice(0, end), profile: athlete.slice(end + 1) };
      })
      : [{ attrs: attributes, profile: body }];
    const declaredCount = kind === 'offer' ? Number(body.match(/<b class="on">(\d+)<\/b>/)?.[1]) : 1;
    if (athletes.length !== declaredCount) incompleteGroups.push(`${school.id} ${new Date(reportedAt).toISOString().slice(0, 10)}`);

    for (const { attrs, profile } of athletes) {
      const player = profile.match(/<(a|span) class="nm"([^>]*)>(.*?)<\/\1>/s);
      if (!player) continue;
      const profilePath = attr(player[2], 'href');
      const url = /^\/college\/recruits\/[a-z0-9-]+$/.test(profilePath) ? new URL(profilePath, FEED).href : FEED;
      const event = entry({ source: 'Stick to the Model', url, kind, school, name: plain(player[3]), reportedAt,
        classYear: Number(attr(attrs, 'data-cls')), position: attr(attrs, 'data-pos'), state: attr(attrs, 'data-st') || null }, now);
      if (event) records.set(event.post.id, event);
    }
  }
  return { records: [...records.values()], unknownSchools: [...unknownSchools].sort(), incompleteGroups };
}

export function parseCommitOdds(html, now = new Date()) {
  const table = html.match(/<table class=['"]cohub cod['"]>(.*?)<\/table>/s)?.[1];
  if (!table) throw new Error('CommitOdds event table is missing');
  const today = dayOf(now);
  const records = [];
  const unknownSchools = new Set();
  for (const [, row] of table.matchAll(/<tr\b[^>]*data-s=['"]football['"][^>]*>(.*?)<\/tr>/gs)) {
    const cells = [...row.matchAll(/<td>(.*?)<\/td>/gs)].map(([, content]) => content);
    if (cells.length !== 6) throw new Error('CommitOdds event row has unexpected columns');
    const [date, player, year, position, label, team] = cells;
    const reportedAt = Date.parse(`${plain(date)} 00:00:00 GMT`);
    if (!(reportedAt >= today - 7 * DAY && reportedAt <= today)) continue;
    const slug = team.match(/href=['"]\/schools\/([a-z0-9-]+)\/['"]/)?.[1];
    const school = byId.get(SCHOOL_IDS[slug] || slug);
    if (!school) { unknownSchools.add(slug || plain(team)); continue; }
    const profile = player.match(/href=['"](\/players\/[a-z0-9-]+\/)['"]/i)?.[1];
    const kind = ODDS_KINDS[plain(label)];
    if (!kind || !profile) continue;
    const event = entry({ source: 'CommitOdds', url: new URL(profile, COMMIT_ODDS).href, kind, school, name: plain(player),
      classYear: Number(plain(year)), position: plain(position), state: null, reportedAt }, now);
    if (event) records.push(event);
  }
  return { records, unknownSchools: [...unknownSchools], incompleteGroups: [] };
}

export function parse247Commitments(html, now, classYear, kind) {
  if (!html.includes('data-js="recruit-list"')) throw new Error('247Sports recruit list is missing');
  const today = dayOf(now);
  const cutoff = today - 7 * DAY;
  const records = [];
  const unknownSchools = new Set();
  const incompleteGroups = [];
  let oldest = Infinity;
  let count = 0;
  for (const [, row] of html.matchAll(/<li class="ri-page__list-item">([\s\S]*?)<\/li>/g)) {
    count++;
    const date = kind === 'commit' ? row.match(/<b>Committed:<\/b>\s*(\d+\/\d+\/\d{4})/)
      : row.match(/Decommitted:\s*<b>(\d+\/\d+\/\d{4})<\/b>/);
    if (!date) continue;
    const reportedAt = Date.parse(`${date[1]} 00:00:00 GMT`);
    oldest = Math.min(oldest, reportedAt);
    if (!(reportedAt >= cutoff && reportedAt <= today)) continue;

    const team = decodeEntities(row.match(/class="status"[\s\S]*?<img alt="([^"]+)"/)?.[1] || '');
    const school = schoolByPublishedName.get(norm(team));
    if (!school) { if (team) unknownSchools.add(team); continue; }
    const profile = row.match(/<a class="ri-page__name-link" href="(?:https:)?\/\/247sports\.com(\/Player\/[a-z0-9-]+\/)".*?>([^<]+)<\/a>/is);
    if (!profile) continue;
    const position = row.match(/class="position">\s*([^<]+)</)?.[1]?.trim() || '';
    const state = row.match(/<span class="meta">[^<]+,\s*([A-Z]{2})\)/)?.[1] || null;
    const event = entry({ source: '247Sports', url: new URL(profile[1], SPORTS_247).href, kind, school,
      name: plain(profile[2]), classYear, position, state, reportedAt }, now);
    if (event) records.push(event);
  }
  if (count >= 50 && oldest > cutoff) incompleteGroups.push('The latest page ends inside the seven-day window');
  return { records, unknownSchools: [...unknownSchools].sort(), incompleteGroups };
}

function profileDate(value) {
  if (typeof value !== 'string') return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value);
  const date = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  return date ? Date.parse(`${date[1]}/${date[2]}/20${date[3]} 00:00:00 GMT`) : NaN;
}

export function parseProfileRecruiting(json, now = new Date()) {
  const classes = Object.entries(JSON.parse(json)).filter(([key, rows]) => /^CLASS_20\d\d$/.test(key) && Array.isArray(rows));
  if (!classes.some(([, rows]) => rows.length)) throw new Error('Profile Recruiting has no class data');
  const today = dayOf(now);
  const records = [];
  const unknownSchools = new Set();
  for (const [key, classRows] of classes) {
    const classYear = Number(key.slice(6));
    for (const athlete of classRows) {
      if (typeof athlete?.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(athlete?.id || '')) continue;
      const publishedHandle = typeof athlete.socialTag === 'string' && /^@?[a-z0-9_]{1,15}$/i.test(athlete.socialTag.trim())
        ? athlete.socialTag.trim().replace(/^@/, '').toLowerCase() : null;
      const events = Object.entries(athlete.offerDates || {}).map(([school, date]) => ({ kind: 'offer', school, date }));
      if (athlete.commitment && !athlete.walkOn) events.push({ kind: 'commit', school: athlete.commitment, date: athlete.commitDate });
      for (const decommit of (Array.isArray(athlete.decommitLog) ? athlete.decommitLog : [])) {
        if (decommit?.school) events.push({ kind: 'decommit', school: decommit.school, date: decommit.decommitDate });
      }
      for (const { kind, school: label, date } of events) {
        const reportedAt = profileDate(date);
        if (!(reportedAt >= today - 7 * DAY && reportedAt <= today)) continue;
        if (typeof label !== 'string' || !label.trim()) continue;
        const school = schoolByPublishedName.get(norm(label));
        if (!school) { unknownSchools.add(label); continue; }
        const url = `${PROFILE_FB}/#recruit/${athlete.id}`;
        const event = entry({ source: 'Profile Recruiting', url, kind, school, name: athlete.name,
          classYear, position: athlete.pos, state: athlete.state || null, reportedAt, publishedHandle }, now);
        if (event) records.push(event);
      }
    }
  }
  return { records, unknownSchools: [...unknownSchools].sort(), incompleteGroups: [] };
}

export async function fetchPublicRecruiting(now = new Date(), fetchImpl = fetch) {
  const classYear = now.getUTCFullYear() + Number(now.getUTCMonth() >= 6);
  const sources = [
    [FEED, parsePublicRecruiting], [`${PROFILE_FB}/api/logos`, parseProfileRecruiting],
    ...['offers', 'commits', 'decommits'].map((page) => [`${COMMIT_ODDS}/${page}/`, parseCommitOdds]),
    [`${SPORTS_247}/Season/${classYear}-Football/Commits/`, (html, date) => parse247Commitments(html, date, classYear, 'commit')],
    [`${SPORTS_247}/Season/${classYear}-Football/Decommits/`, (html, date) => parse247Commitments(html, date, classYear, 'decommit')],
  ];
  const results = await Promise.allSettled(sources.map(async ([url, parse]) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parse(await response.text(), now);
  }));
  const records = new Map();
  const health = {};
  for (const [index, result] of results.entries()) {
    const [url] = sources[index];
    if (result.status === 'rejected') { health[url] = { error: result.reason.message }; continue; }
    const { records: sourceRecords, unknownSchools, incompleteGroups } = result.value;
    health[url] = { records: sourceRecords.length, unknownSchools, incompleteGroups };
    for (const event of sourceRecords) {
      const previous = records.get(event.post.id);
      if (!previous || !previous.record.published_handle && event.record.published_handle) records.set(event.post.id, event);
    }
  }
  const latestAt = [...records.values()].reduce((latest, { post }) => post.createdAt > latest ? post.createdAt : latest, '');
  if (!records.size) throw new Error(`No recent FBS records from public recruiting sources: ${JSON.stringify(health)}`);
  return { records: [...records.values()], latestAt, health };
}
