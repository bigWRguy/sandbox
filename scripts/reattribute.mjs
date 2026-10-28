import fs from 'node:fs';
import path from 'node:path';
import { DATA, decodeEntities } from '../src/lib/store.js';
import { byId } from '../src/resolve/schools.js';
import { resolveOfferTarget } from '../src/resolve/attribution.js';

const write = process.argv.includes('--write');
const offers = JSON.parse(fs.readFileSync(path.join(DATA, 'offers.json'), 'utf8'));
const affiliations = JSON.parse(fs.readFileSync(path.join(DATA, 'affiliations.json'), 'utf8'));

const kept = [];
const removed = [];
const moved = [];
for (const o of offers) {
  const verdicts = (o.evidence || []).filter((e) => e.text).map((e) => ({
    e, r: resolveOfferTarget({ text: decodeEntities(e.text), mentioned: [] }, affiliations),
  }));
  const wrong = verdicts.filter(({ e, r }) => (r.status === 'accepted' && r.schoolId !== o.schoolId) || (r.status === 'rejected' && e.attribution?.affiliationSource !== 'profile_cache'));
  if (!wrong.length) { kept.push(o); continue; }
  const ok = verdicts.filter((v) => !wrong.includes(v));
  const elsewhere = new Set(wrong.filter(({ r }) => r.status === 'accepted').map(({ r }) => r.schoolId));
  if (!ok.length && elsewhere.size === 1 && wrong.every(({ r }) => r.status === 'accepted')) {
    const school = byId.get([...elsewhere][0]);
    moved.push({ id: o.id, player: o.playerName, from: o.schoolName, to: school.name });
    o.schoolId = school.id; o.schoolName = school.name; o.conference = school.conference;
    kept.push(o);
  } else if (ok.length) {
    o.evidence = ok.map((v) => v.e);
    o.corroborations = o.evidence.length;
    kept.push(o);
  } else {
    removed.push({ id: o.id, player: o.playerName, school: o.schoolName, text: decodeEntities(wrong[0].e.text).replace(/\s+/g, ' ').slice(0, 110) });
  }
}

console.log(`ledger ${offers.length} -> ${kept.length}; removed ${removed.length}, moved ${moved.length}`);
for (const r of removed) console.log(`  - ${r.school} <- ${r.player}: ${r.text}`);
for (const m of moved) console.log(`  ~ ${m.player}: ${m.from} -> ${m.to}`);
if (write) {
  fs.writeFileSync(path.join(DATA, 'offers.json'), JSON.stringify(kept, null, 2) + '\n');
  console.log('written');
}
