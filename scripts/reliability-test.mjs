import assert from 'node:assert/strict';
import { resolveOfferTarget } from '../src/resolve/attribution.js';
import { liveWindowQuery, advanceLiveWindow } from '../src/collect/search.js';
import { fetchPublicRecruiting, parse247Commitments, parseCommitOdds, parseProfileRecruiting, parsePublicRecruiting } from '../src/collect/public-recruiting.js';
import { apifySearchWindow, apifySpend, collectApifyRecruiting, fetchApifyRecruiting } from '../src/collect/apify-recruiting.js';
import { normalizeApifyPosts } from '../src/collect/apify-posts.js';
import { commitSignals } from '../src/extract/commits.js';
import { ensurePlayer } from '../src/resolve/ledger.js';
import { indexPlayers } from '../src/resolve/players.js';
import { focusedSearchInput, focusedSearchMatcher } from '../src/collect/focused-search.js';
const p = (text, mentioned = []) => ({ text, mentioned });
assert.deepEqual(commitSignals("@RecruitingNews Hasn't Jordan Example committed to Missouri for 2027?", 'reporter'), []);
assert.equal(commitSignals('Jordan Example has committed to Missouri. Who is next?', 'reporter').length, 1);

const jan = new Date('2027-01-02T16:00:00Z');
const publicOfferHtml = `<div class="day"><b>Thursday, Dec 31</b></div>
<div class="lb og" data-e="offer" data-lv="fbs" data-p="Texas A&amp;M">
  <a href="/college-recruiting/texas-am">Texas A&amp;M</a> offered <b class="on">2</b>
  <span class="oi" data-st="TX" data-pos="QB" data-cls="2028"><a class="nm" href="/college/recruits/jordan-example-2028">Jordan Example QB</a> <i>2028</i><span class="sk">3 stars</span></span>
  <span class="oi" data-st="" data-pos="LB" data-cls="2026"><span class="nm">Owen Example</span> <i>2026</i></span>
</div>`;
const publicOffers = parsePublicRecruiting(publicOfferHtml, jan);
assert.deepEqual(publicOffers.incompleteGroups, []);
assert.equal(publicOffers.records.length, 1);
assert.equal(publicOffers.records[0].post.createdAt, '2026-12-31T00:00:00.000Z');
assert.equal(publicOffers.records[0].record.player_name, 'Jordan Example');
assert.equal(publicOffers.records[0].record.school_id, 'texas-am');
assert.equal(publicOffers.records[0].post.datePrecision, 'day');
const oddsTable = `<table class='cohub cod'>
<tr data-s='football'><td>Jan 1, 2027</td><td><a href='/players/jordan-example-2028/'>Jordan Example</a></td><td>2028</td><td>QB</td><td>Committed</td><td><a href='/schools/texas-am/'>Texas A&amp;M</a></td></tr>
<tr data-s='basketball'><td>Jan 2, 2027</td><td>Other Player</td><td>2028</td><td>PG</td><td>Committed</td><td>Texas A&amp;M</td></tr>
</table>`;
assert.equal(parseCommitOdds(oddsTable, jan).records.length, 1);
assert.equal(parseCommitOdds(oddsTable, jan).records[0].record.kind, 'commit');
assert.throws(() => parsePublicRecruiting('<h1>Service unavailable</h1>', jan), /no dated event rows/);
const publicOnly = await fetchPublicRecruiting(jan, async (url) => url.includes('sticktothemodel.com')
  ? new Response(publicOfferHtml) : new Response('', { status: 503 }));
assert.equal(publicOnly.records.length, 1);
assert.equal(publicOnly.health['https://commitodds.com/offers/'].error, 'HTTP 503');
await assert.rejects(fetchPublicRecruiting(jan, async () => new Response('', { status: 503 })), /No recent FBS records/);

const profile = parseProfileRecruiting(JSON.stringify({ CLASS_2028: [{
  id: 'TEST', name: 'Jordan Example', pos: 'QB', socialTag: '@JordanExample',
  offerDates: { 'Miami (OH)': '12.31.26', 'Miami (FL)': '1.1.27', Yale: '1.1.27', Texas: '1.4.27' },
  commitment: 'Miami (FL)', commitDate: '1.1.27',
  decommitLog: [{ school: 'Texas A&M', decommitDate: '2027-01-02' }],
}] }), jan);
assert.deepEqual(profile.records.map(({ record }) => [record.kind, record.school_id]), [
  ['offer', 'miami-oh'], ['offer', 'miami'], ['commit', 'miami'], ['decommit', 'texas-am'],
]);
assert.deepEqual(profile.unknownSchools, ['Yale']);
assert.equal(profile.records[0].post.url, 'https://profilefb.com/#recruit/TEST');
assert.equal(profile.records[0].record.published_handle, 'jordanexample');
const twins = ['alternate', 'jordanexample'].map(handle => ({
  id: handle, handle, name: 'Jordan Example', classYear: 2028, position: 'QB',
}));
const identityDb = { players: twins, _index: indexPlayers(twins), review: [], _new: [] };
const { post: duplicateNamePost, record: duplicateNameRecord } = profile.records[0];
assert.equal(ensurePlayer(identityDb, duplicateNameRecord, duplicateNamePost, jan)?.id, 'jordanexample');
assert.equal(ensurePlayer(identityDb, { ...duplicateNameRecord, published_handle: 'unknown' }, duplicateNamePost, jan), null);
assert.ok(twins.every(player => !player.published_handle));
const cbsHtml = `<ul data-js="recruit-list"><li class="ri-page__list-item">
<a class="ri-page__name-link" href="//247sports.com/Player/jordan-example-987/">Jordan Example</a>
<span class="meta"> Decommitted: <b>1/1/2027</b> </span>
<div class="status"><div class="decommit-status"><img alt="Texas A&amp;M"></div></div>
<div class="position">QB</div></li></ul>`;
const cbsEvents = parse247Commitments(cbsHtml, jan, 2028, 'decommit').records;
assert.equal(cbsEvents.length, 1);
assert.equal(cbsEvents[0].record.school_id, 'texas-am');

const apifyEnd = new Date('2027-01-02T18:27:00Z');
const apifyWindow = apifySearchWindow(apifyEnd, { at: '2027-01-02T12:27:00Z', lastSuccessAt: '2027-01-02T12:27:00Z' });
assert.equal(apifyWindow.from.toISOString(), '2027-01-02T17:12:00.000Z');
assert.equal(apifySearchWindow(apifyEnd, { at: '2027-01-02T18:00:00Z' }), null);
const nearBudget = apifySearchWindow(apifyEnd, { budgetDay: '2027-01-02', used: 136_000 });
assert.equal(nearBudget.allowance, 4_000);
assert.deepEqual(apifySpend(nearBudget, 0.00315), { budgetDay: '2027-01-02', used: 139_150 });
assert.deepEqual(apifySpend(nearBudget), { budgetDay: '2027-01-02', used: 140_000 });
assert.equal(apifySearchWindow(apifyEnd, { budgetDay: '2027-01-02', used: 140_000 }), null);
assert.equal(apifySearchWindow(apifyEnd, { budgetDay: '2027-01-01', used: 140_000 }).allowance, 14_400);
const fakePosts = [
  { id: '1234567890123456789', created_at: '2027-01-02T17:30:00Z', author: { username: 'jordan_example' }, text: 'Blessed to receive an offer from @CanesFootball' },
  { id: '2234567890123456789', created_at: '2027-01-01T14:59:59Z', author: { username: 'jordan_example' }, text: 'Blessed to receive an offer' },
];
const duplicateWithBio = { ...fakePosts[0], author: { username: 'jordan_example', description: 'Class of 2028 QB' } };
const duplicateWithLongText = { ...fakePosts[0], text: fakePosts[0].text + ' Thanks @ExampleCoach' };
const [mergedPost] = normalizeApifyPosts([duplicateWithBio, duplicateWithLongText]);
assert.equal(mergedPost.authorBio, 'Class of 2028 QB');
assert.match(mergedPost.text, /ExampleCoach/);
assert.deepEqual(mergedPost.mentions, ['canesfootball', 'examplecoach']);
const fixtureApify = await fetchApifyRecruiting({ token: 'fixture', ...apifyWindow, fetchImpl: async (url, options) => {
  if (url.endsWith('/users/me')) return Response.json({ data: { plan: { tier: 'FREE', monthlyBasePriceUsd: 0 } } });
  if (url.endsWith('/users/me/limits')) return Response.json({ data: { current: { monthlyUsageUsd: 1.5 } } });
  if (url.includes('/runs?')) {
    assert.equal(new URL(url).searchParams.get('maxTotalChargeUsd'), '0.0144');
    const input = JSON.parse(options.body);
    assert.equal(input.searchQueries.length, 4);
    assert.match(input.searchQueries.at(-1), /"football offers".+"high school"/);
    assert.ok(input.searchQueries.every(query => query.length <= 500));
    assert.equal(input.searchCategory, 'Latest');
    return Response.json({ data: { status: 'SUCCEEDED', defaultDatasetId: 'fixture', usageTotalUsd: 0.009 } });
  }
  assert.match(url, /datasets\/fixture\/items/);
  return Response.json(fakePosts);
} });
assert.equal(fixtureApify.posts.length, 1);
assert.equal(fixtureApify.posts[0].id, fakePosts[0].id);
assert.deepEqual(fixtureApify.posts[0].mentions, ['canesfootball']);
assert.equal(fixtureApify.health.atLimit, false);
await assert.rejects(fetchApifyRecruiting({ token: 'fixture', ...apifyWindow, fetchImpl: async (url) => {
  if (url.endsWith('/users/me')) return Response.json({ data: { plan: { tier: 'FREE', monthlyBasePriceUsd: 0 } } });
  assert.ok(url.endsWith('/users/me/limits'));
  return Response.json({ data: { current: { monthlyUsageUsd: 4.65 } } });
} }), /monthly collection budget reached/);

const initial = apifySearchWindow(apifyEnd);
const firstRun = await collectApifyRecruiting({ token: 'fixture', window: initial, fetchImpl: async (url) => {
  if (url.endsWith('/users/me')) return Response.json({ data: { plan: { tier: 'FREE', monthlyBasePriceUsd: 0 } } });
  if (url.endsWith('/users/me/limits')) return Response.json({ data: { current: { monthlyUsageUsd: 0 } } });
  if (url.includes('/runs?')) return Response.json({ data: { status: 'SUCCEEDED', defaultDatasetId: 'capped', usageTotalUsd: 0.0144 } });
  return Response.json(fakePosts);
} });
assert.deepEqual(firstRun.state.gaps, [{ from: +initial.from, to: +initial.to }]);
assert.equal(firstRun.state.used, 14_400);
const retryEnd = new Date('2027-01-02T19:27:00Z');
const next = apifySearchWindow(retryEnd, firstRun.state);
const replayCalls = [];
const secondRun = await collectApifyRecruiting({ token: 'fixture', window: next, prior: firstRun.state, fetchImpl: async (url, options) => {
  if (url.endsWith('/users/me')) return Response.json({ data: { plan: { tier: 'FREE', monthlyBasePriceUsd: 0 } } });
  if (url.endsWith('/users/me/limits')) return Response.json({ data: { current: { monthlyUsageUsd: 0.0144 } } });
  if (url.includes('/runs?')) {
    replayCalls.push({ query: JSON.parse(options.body).searchQueries[0], cap: +new URL(url).searchParams.get('maxTotalChargeUsd') });
    return Response.json({ data: { status: 'SUCCEEDED', defaultDatasetId: 'retry', usageTotalUsd: 0.003 } });
  }
  return Response.json(fakePosts);
} });
assert.deepEqual(replayCalls.map(call => call.cap), [0.0144, 0.0114]);
assert.ok(replayCalls[0].query.includes('since_time:' + (+next.from / 1000)));
assert.ok(replayCalls[1].query.includes('since_time:' + (+initial.from / 1000)));
assert.equal(secondRun.state.used, 20_400);
assert.deepEqual(secondRun.state.gaps, [{ from: +initial.from + 30 * 60e3, to: +initial.to }]);
assert.equal(secondRun.posts[0].id, fakePosts[0].id);

const focusedInput = focusedSearchInput(jan, new Date('2027-01-03T16:00:00Z'), 500);
assert.equal(focusedInput.maxItems, 500);
assert.ok(focusedInput.searchTerms.every((query) => query.length <= 500 && /since_time:\d+ until_time:\d+$/.test(query)));
assert.ok(focusedInput.searchTerms.some((query) => query.includes('@MiamiOHFootball')));
const focusedMatch = focusedSearchMatcher(jan);
assert.ok(focusedMatch({ text: 'Blessed to receive an offer from Bowling Green' }).includes('offers'));
assert.ok(focusedMatch({ text: 'I am officially decommitted. 2028 QB' }).includes('commitments'));
assert.ok(focusedMatch({ text: 'New offer', mentions: ['NDSUfootball'] }).includes('offers'));
assert.deepEqual(focusedMatch({ text: 'Undercooked. No offer.' }), []);
assert.deepEqual(focusedMatch({ text: 'RT @recruit Blessed to receive an offer', isRetweet: true }), []);
for (const text of [
  'Brayden Atwood received an offer from SEMO Redhawks. Go Miami RedHawks!',
  'Blessed to receive an offer from Community Christian College. Go Cyclones!',
  'Offer from Calhoun softball Warhawks',
  'Offer from Wisconsin River Falls', 'Offer from Wisconsin Lutheran College',
  'Offer from Eastern New Mexico', 'Offer from Chattanooga',
]) assert.equal(resolveOfferTarget(p(text)).status, 'rejected', text);
assert.equal(resolveOfferTarget(p('Blessed to receive an offer from @RFootball', [{handle:'RFootball', name:'Rutgers Football'}])).schoolId, 'rutgers');
assert.equal(resolveOfferTarget(p('Blessed to receive an offer from @CanesFootball', [{handle:'CanesFootball', name:'Miami Hurricanes Football'}])).schoolId, 'miami');
const cache={accounts:{coachx:{handle:'coachx', affiliationType:'coach', fbsSchoolId:'virginia', expiresAt:'2099-01-01T00:00:00Z'}}};
assert.equal(resolveOfferTarget(p('After a great talk, I received an offer from @CoachX', [{handle:'coachx',name:'Coach X'}]),cache).schoolId,'virginia');
assert.equal(resolveOfferTarget(p('Blessed to receive an offer from @Unknown', [{handle:'unknown',name:'Unknown'}])).status,'pending');
for (const text of [
  'After a great conversation I am blessed to receive my 5th offer from CCC Florida!! @Apes_Tampa',
  'I am grateful to announce another offer from the Valley Huskers! Thank you Coach',
  'Extremely blessed to receive an offer from Texas A&M Texarkana! @TAMUT_football',
  'Blessed to receive an offer from CSU Pueblo @CoachX',
  'Blessed to receive my 2nd official offer from South Carolina Gladiators!!',
  'Blessed to receive an offer from UNC Pembroke!',
  'Blessed to receive an offer from Missouri S&T to continue my career',
]) assert.equal(resolveOfferTarget(p(text)).status, 'rejected', text);
for (const [text, id] of [
  ['Blessed to receive an offer from Miami Ohio University #AGTG', 'miami-oh'],
  ['Blessed to receive an offer from Florida \nAtlantic University #WIP', 'florida-atlantic'],
  ['Blessed to receive an offer from Auburn University #AGTG', 'auburn'],
  ['Blessed to receive an offer from Virginia Tech 🖤 #AGTG https://t.co/abc', 'virginia-tech'],
  ['Blessed to receive an offer from San Diego State University thank you @AztecFB!!', 'san-diego-state'],
  ['Blessed to receive an offer from Texas A&M! #AGTG', 'texas-am'],
]) assert.equal(resolveOfferTarget(p(text)).schoolId, id, text);
const mark={at:'2026-08-31T00:00:00.000Z'}; const w=liveWindowQuery({query:'offer'},mark,Date.parse('2026-08-31T02:00:00Z'),0);
assert.match(w.query,/since_time:.*until_time:/); assert.equal(advanceLiveWindow(mark,w.window,[{createdAt:'2026-08-31T01:00:00Z'}],true),false); assert.ok(mark.window);
const q2=liveWindowQuery({query:'offer'},mark,Date.parse('2026-08-31T03:00:00Z'),0); assert.equal(q2.window.upper,w.window.upper); assert.ok(new Date(q2.window.until_time)<new Date(w.window.until_time));
assert.equal(advanceLiveWindow(mark,q2.window,[],false),true); assert.equal(mark.at,w.window.upper); console.log('reliability assertions passed');
