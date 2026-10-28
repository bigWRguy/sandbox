import assert from 'node:assert/strict';
import { resolveOfferTarget } from '../src/resolve/attribution.js';
import { liveWindowQuery, advanceLiveWindow } from '../src/collect/search.js';
const p = (text, mentioned = []) => ({ text, mentioned });
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
