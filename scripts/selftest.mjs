import { findSchools, explicitNonFbsOfferTarget, foreignInstitution, nonFbsRosterSize, SCHOOLS as SCHOOLS_LIST } from '../src/resolve/schools.js';
import { classify, findClassYear, findPosition, findNameCandidates, findTaggedRecruit, findReportedName, handleClassYear, maskAwardYears } from '../src/extract/rules.js';
import { nameKey, fuzzyKey, canMerge, parseBio, looksLikeRecruit, cleanPersonName } from '../src/resolve/players.js';
import { prefilter, rulesOnlyOffers } from '../src/pipeline.js';
import { tierOf, decorateOffers } from '../src/resolve/tiers.js';
import { backfillJobs, schoolJobs, backfillAnchorDate, phraseJobs } from '../src/collect/queries.js';
import { prioritizeJobs, SearchSession } from '../src/collect/search.js';
import { dispatchWire } from '../netlify/functions/trigger-wire.mjs';
import { resolveOfferTarget } from '../src/resolve/attribution.js';
import { decodeEntities } from '../src/lib/store.js';
import { bioPositions } from '../src/resolve/players.js';
import { buildCoachIndex, coachVotes, settlePosition } from '../src/resolve/coaches.js';
import { extractCommit, newCommitDb, upsertCommit, processCommits } from '../src/commits.js';
import { commitJobs, commitJobsDue, bioJobs } from '../src/collect/queries.js';
import { indexPlayers } from '../src/resolve/players.js';
import { loadStaff, observeNonFbs, staffVeto, pruneOffers } from '../src/resolve/staff.js';
import { parseCoachBio, loadBios, recordBio, bioFresh, wantedBioHandles, bioVeto } from '../src/resolve/coachbio.js';

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`); }
};

const ids = (text) => findSchools(text).filter((s) => s.id).map((s) => s.id).sort();
const veto = (text) => explicitNonFbsOfferTarget(text);

console.log('school resolution');
t('handle beats everything', ids('Blessed to receive an offer from @GamecockFB').includes('south-carolina'));
t('full name', ids('Ohio State has offered 2028 ATH Marcus Lee').includes('ohio-state'));
t('two-word school not truncated',
  ids('Michigan State has offered him') .includes('michigan-state') && !ids('Michigan State has offered him').includes('michigan'),
  JSON.stringify(ids('Michigan State has offered him')));
t('hashtag camelCase split', ids('Blessed to receive an offer #RollTide').includes('alabama'));
t('nickname alias', ids('Ole Miss has extended an offer').includes('ole-miss'));
t('abbreviation', ids('LSU has offered 2027 WR Jaylen Carter').includes('lsu'));
t('ambiguous USC not silently guessed', !ids('USC offered him today').length,
  JSON.stringify(ids('USC offered him today')));
t('ambiguous resolved by co-mention', ids('USC (@uscfb) offered him today').includes('usc'));
t('ambiguous Miami not guessed', !ids('Miami has offered').length);
t('bare nickname Tigers not guessed', !ids('Tigers have offered him').length);
t('no false school in plain text', !ids('He had a great game on Friday night').length,
  JSON.stringify(ids('He had a great game on Friday night')));

console.log('non-FBS offer target veto');
t('community college offer with a cheer is vetoed',
  veto('Blessed to receive an offer from Community Christian College! Go cyclones!'));
t('scholarship from a small college is vetoed',
  veto('Blessed to receive a scholarship from Santa Monica College to play football'));
t('non-FBS college "of" form is vetoed',
  veto('After a great conversation Im blessed to receive an offer from Community College of Philadelphia'));
t('Ivy League (non-FBS) is vetoed',
  veto('Blessed to receive an offer from Harvard University!'));
t('FBS "X University" is NOT vetoed',
  !veto('Blessed to receive an offer from Auburn University! War Eagle')
    && !veto('Blessed to receive an offer from Ohio State University! Go Bucks')
    && !veto('Blessed to receive an offer from Iowa State University! Go Cyclones')
    && !veto('Blessed to receive an offer from the University of Alabama! Roll Tide')
    && !veto('Blessed to receive an offer from the University of Georgia! Go Dawgs')
    && !veto('Blessed to receive an offer from Liberty University! Flames Up')
    && !veto('Blessed to receive an offer from Notre Dame University! Go Irish'));
t('a bare college mention does not veto a real FBS offer',
  !veto('Committed to Alabama. Also taking classes at Community College of Phoenix'));
t('a handle-tagged FBS offer is not vetoed', !veto('Blessed to receive an offer from @AuburnFootball War Eagle!'));

console.log('offer classification');
const POS = [
  'Blessed to receive an offer from the University of Alabama! @AlabamaFTBL',
  'After a great conversation with @CoachDrink I am blessed to receive an offer from @GamecockFB',
  'AGTG! Extremely blessed to receive my 4th D1 offer from @HawkeyeFootball',
  'BREAKING: 2028 four-star ATH Marcus Lee has been offered by Georgia',
  'Ohio State has offered 2027 QB Tyler Simmons',
  'NEWS: 2029 OL Jamal Peters picks up an offer from @TexasFootball',
];
for (const p of POS) {
  const c = classify(p);
  t(`positive: ${p.slice(0, 46)}...`, !!c.kind && !c.hardNegative && c.prior > 0.3, JSON.stringify(c));
}

const NEG = [
  'Committed! Blessed to announce I am committing to Alabama',
  'He has decommitted from LSU after receiving an offer in June',
  'Top 5! Blessed to announce my top schools after 30 offers',
  'His offer list includes Alabama, Georgia, LSU and Texas',
  'Blessed to receive a preferred walk-on offer from Iowa',
  'On this day in 2019, Alabama offered him',
  'Should Georgia offer this kid? He has been dominant',
  'Signed! Officially a member of the Texas Longhorns',
];
for (const n of NEG) {
  const c = classify(n);
  t(`negative: ${n.slice(0, 46)}...`, c.hardNegative || c.prior <= 0.3, JSON.stringify(c));
}

console.log('field extraction');
t('class year', findClassYear('2028 ATH Marcus Lee has been offered', 2026) === 2028);
t('class year ignores past', findClassYear('Since 2019 he has been dominant', 2026) === null);
t('position', findPosition('2027 QB Tyler Simmons') === 'QB');
t('lowercase Spanish de is not defensive end', findPosition('2029 G prospect de The Villages') === null);
t('single letter in prose is not a position', findPosition('California is offering a new program') === null);
t('name candidate found', findNameCandidates('BREAKING: Marcus Lee has been offered by Georgia').some((n) => n.name === 'Marcus Lee'));
t('stopwords not names', !findNameCandidates('Blessed To Receive An Offer').some((n) => /Blessed/.test(n.name)));

console.log('player identity');
t('nickname fold', nameKey('Mike Johnson') === nameKey('Michael Johnson'));
t('suffix stripped', nameKey('Marcus Lee Jr.') === nameKey('Marcus Lee'));
t('vowel-spelling fold', fuzzyKey('Jayden Thomas') === fuzzyKey('Jaiden Thomas'));
t('different names do not fold', fuzzyKey('Marcus Lee') !== fuzzyKey('Marcus Reed'));

const A = { name: 'Marcus Lee', classYear: 2028, state: 'GA', handle: null, highSchool: null, position: 'ATH' };
t('same name + same class merges', canMerge(A, { name: 'Marcus Lee', classYear: 2028 }).merge);
t('class conflict blocks merge', !canMerge(A, { name: 'Marcus Lee', classYear: 2027 }).merge);
t('state conflict blocks merge', !canMerge(A, { name: 'Marcus Lee', state: 'TX' }).merge);
t('name-only does NOT merge', !canMerge({ name: 'Marcus Lee' }, { name: 'Marcus Lee' }).merge,
  JSON.stringify(canMerge({ name: 'Marcus Lee' }, { name: 'Marcus Lee' })));
t('different HS blocks merge', !canMerge(
  { name: 'Marcus Lee', highSchool: 'Grayson' },
  { name: 'Marcus Lee', highSchool: 'Buford' },
).merge);
t('decorated display name is cleaned', cleanPersonName('Jonathan Jackson 4-star WR') === 'Jonathan Jackson');
t('ordinal decoration is removed from player name', cleanPersonName('Bruce Blanden 3rd??') === 'Bruce Blanden');
t('mistyped lowercase-L Roman suffix is normalized', cleanPersonName('Guy Vann lll') === 'Guy Vann III');
t('iam-style camel display name is cleaned', cleanPersonName('iamBraydonZeno_') === 'Braydon Zeno');
t('at-style camel display name is cleaned', cleanPersonName('@GrahamCentimole') === 'Graham Centimole');
t('ordinary Mc surname is not camel-split', cleanPersonName('Sean McDonald') === 'Sean McDonald');

console.log('bio parsing');
const B = (bio) => parseBio(bio, 2026);
t('FB is not a position', B('Garces memorial high school | W189 | FB (WR and FS)|4.19 weighted gpa|').position === 'WR',
  JSON.stringify(B('Garces memorial high school | W189 | FB (WR and FS)|4.19 weighted gpa|')));
t('qualified GPA parses', B('| 4.19 weighted gpa |').gpa === 4.19);
t('NCAA ID is not Idaho', B('Lipscomb Academy |C/O 28| |3.41GPA|OT|6-5 275| NCAA ID #2507673260').state == null,
  String(B('Lipscomb Academy |C/O 28| |3.41GPA|OT|6-5 275| NCAA ID #2507673260').state));
t('explicit Pos: label wins', B("6'2 255|Pos:DL/LB/H|3 Sport Athlete|NCAA ID:2602827047|").position === 'DL');
t('height and weight', B("C/O 28 Cache HS ||#7|| 6'2 180|| 4.35 40").height === '6-2' && B("C/O 28 Cache HS ||#7|| 6'2 180|| 4.35 40").weight === 180);
t('class from C/O short form', B('C/O 28 Cache HS').classYear === 2028);
t('class from C/ short form', B('C/28 6-3 280 RT/G').classYear === 2028);
t('class from trailing apostrophe', B("28’ 6-4 225 EDGE").classYear === 2028);
t('class apostrophe attached to school initials beats unrelated award year',
  B("MHS'27 | 2025 1st Team All State | LB").classYear === 2027);
t('two-digit height inches are not a class year', B("5'11 | 190 | LB").classYear == null);
t('past shorthand award year falls back to valid four-digit class',
  B("2029 QB | National Champions '24").classYear === 2029);
t('lowercase bio position parses', B('class of 2028 | db | 6-0 185').position === 'DB');
t('mixed-case position parses', B('C/O 2028 | 6-4 225 Edge').position === 'EDGE');
t('FS normalizes to safety', B('C/O 2028 | FS/SS | 6-1 190').position === 'S');
t('specific bio position beats generic ATH', B('3 sport ath | db | C/O 2028').position === 'DB');
t('position and class can come from structured display name', looksLikeRecruit("6'7 265 | 4.0 GPA", "Kajus Muralis 4-star '28 OT").info.position === 'OT');
t('forty time', B("6'2 180 | 4.35 40").forty === 4.35);

t('award shorthand never outranks the real class in the same bio',
  B("3⭐WR🏈 | San Ramon Valley 2028 | ⚾OF LHP | Canes National 2028 | 🏈Soph All State '25 | 6.26 60yrd/37.3 Vert").classYear === 2028,
  JSON.stringify(B("3⭐WR🏈 | San Ramon Valley 2028 | ⚾OF LHP | Canes National 2028 | 🏈Soph All State '25 | 6.26 60yrd/37.3 Vert")));
t('current-year award shorthand alone is not a class',
  B("6-4 280 | 1st Team All State '25").classYear == null);
t('past-team award year alone is not a class',
  B("6-4 280 | 2025 1st Team All District").classYear == null);
t('school-suffix shorthand is a class', B("Marysville HS 28 | OT DT | 6'5 300 lbs | 3.98 GPA").classYear === 2028);
t('bare "Class" + two digits is a class', B("Carthage HS | Class 28 \u2b50\u2b50 | LT | 6'5").classYear === 2028);
t('curly-quoted class is a class', B('Montour Highschool ATH \u201c29 6\u201d 170 lbs').classYear === 2029, JSON.stringify(B('Montour Highschool ATH \u201c29 6\u201d 170 lbs')));
t('school-suffix with star separator is a class', B("Murrieta Valley HS *28 | 6'6 280 OT").classYear === 2028);
t('jersey number after a school is not a class', B("Garland HS #28 | 6-2 195 WR").classYear == null);
t('line position codes parse from a bio ("RT/G" is not a fullback)',
  B("C/28 6-3 280 RT/G Cardinal Newman HS").position === 'RT');
t('award year in post text does not hide the real class',
  findClassYear("All-State '25 2028 ATH Marcus Lee has been offered by Georgia", 2026) === 2028);
t('award year alone in post text is not a class',
  findClassYear("Soph All State '25 has been offered", 2026) == null);

console.log('handle class year');
const HCY = (h) => handleClassYear(h, 2026);
t('handle trailing year is the class', HCY('coltonfitz2028') === 2028);
t('handle year after underscore', HCY('tyler_2028') === 2028);
t('handle with no year is not a class', HCY('jaymitch_1') == null);
t('handle stale year is not a class', HCY('coach2005') == null);

console.log('recruit vs non-recruit');
const R = (bio) => looksLikeRecruit(bio).ok;
t('recruit crediting his coach is a recruit',
  R("San Antonio Brennan C/O 28| 4 star | 4.0 GPA | RB/WR/ATH | 5'11 200lbs | 40 4.4 | Head Coach @basorecoach"));
t('stat-block bio is a recruit', R("C/O 28 Cache HS ||#7|| 6'2 180|| 4.35 40"));
t('recruit who also runs track is a recruit', R('WR | 6-1 175 | Track & Field | C/O 2029'));
t('agency is not a recruit', !R('We connect high school & transfer athletes with college programs Info@x.org'));
t('other sport is not a recruit', !R('c/o 2032 basketball player @exodusnyc scholar'));
t('basketball jargon without the word "basketball" is still the wrong sport',
  !R("2028 • 5'11 • 3-Guard • 3.8 GPA • Victory Christian Academy • Duval Elite AAU"));
t('coach is not a recruit', !R('Head Coach at Central High | Building men'));
t('plain basketball guard bio rejected', !R('Class of 2027 | 6-3 guard | 3.1 GPA'));
t('flag football without tackle evidence is rejected', !R("Park Hill || 3SSB Della KC || 5'9\" ComboG || CO '28 || 4.0 GPA || Basketball || Flag Football"));
t('flag football WITH tackle evidence (position) is a recruit', R("6-2 180 WR | Flag Football | C/O 2028"));
t('guard alongside a football position code is not basketball',
  R("5'11|175lbs|Cl-2030|ATH|Guard|To whom much is given, much is required!"),
  JSON.stringify(looksLikeRecruit("5'11|175lbs|Cl-2030|ATH|Guard|To whom much is given, much is required!")));
t('requested bio parses class 2030 and ATH',
  B("5'11|175lbs|Cl-2030|ATH|Guard").classYear === 2030 && B("5'11|175lbs|Cl-2030|ATH|Guard").position === 'ATH',
  JSON.stringify(B("5'11|175lbs|Cl-2030|ATH|Guard")));
t('plain basketball guard bio is still rejected (no football code)',
  !R('Class of 2027 | 6-3 guard | 3.1 GPA'));
t('girls basketball jargon without the word basketball is still rejected',
  !R("2028 • 5'11 • 3-Guard • 3.8 GPA • Victory Christian Academy • Duval Elite AAU"));
t('JUCO player rejected from high-school wire', !R('2027 CB | Iowa Western CC | JUCO All-American | 6-2 190'));
t('current college athlete without literal JUCO is rejected',
  !R("Navarro College 6'4|285|OL/DL Class of 25' GPA: 3.5"));
t('parent is not a recruit', !R('Proud mom of a 2028 athlete'));
t('beat writer is not a recruit', !R('Recruiting coverage for @Bama_247 at @247Sports'));

console.log('reporter-voice extraction (no LLM)');
const SCH = new Set(['alabamaftbl', 'georgiafootball', 'texasfootball']);
const KNOWN = new Set(['hayesfawcett3', 'brettgreenberg_']);
const tag = (mentioned) => findTaggedRecruit({ mentioned }, SCH, KNOWN);
t('tagged recruit yields handle AND name',
  tag([{ handle: 'jaymitch_1', name: 'Jayshawn Mitchell' }, { handle: 'alabamaftbl', name: 'Alabama Football' }])?.name === 'Jayshawn Mitchell');
t('school tags are not the recruit',
  tag([{ handle: 'alabamaftbl', name: 'Alabama Football' }]) === null);
t('reporter tags are not the recruit',
  tag([{ handle: 'hayesfawcett3', name: 'Hayes Fawcett' }]) === null);
t('two unknown tags is ambiguous -> no guess',
  tag([{ handle: 'kid_a', name: 'Aa Bb' }, { handle: 'kid_b', name: 'Cc Dd' }]) === null);
t('team account with obscure handle is not the recruit',
  (() => {
    const r = tag([
      { handle: 'damir_williams0', name: 'Damir Williams 2027 6\u20180 181' },
      { handle: 'ehstrojanftbl', name: 'EHigh Trojans Football' },
    ]);
    return r && r.handle === 'damir_williams0' && r.name === 'Damir Williams';
  })(),
  JSON.stringify(tag([{ handle: 'damir_williams0', name: 'Damir Williams' }, { handle: 'ehstrojanftbl', name: 'EHigh Trojans Football' }])));
t('recruit + team + coach still resolves to the recruit',
  (() => {
    const r = tag([
      { handle: 'marcuslee2028', name: 'Marcus Lee' },
      { handle: 'northsideFB', name: 'Northside Football' },
      { handle: 'coachsmith', name: 'Coach Smith' },
    ]);
    return r && r.handle === 'marcuslee2028';
  })(),
  JSON.stringify(tag([{ handle: 'marcuslee2028', name: 'Marcus Lee' }, { handle: 'northsideFB', name: 'Northside Football' }, { handle: 'coachsmith', name: 'Coach Smith' }])));
t('recruit display name with stats is not confused with a team',
  (() => {
    const r = tag([{ handle: 'jaxonflowers7', name: 'Jaxon Flowers 5 Star' }, { handle: 'vtechfb', name: 'Virginia Tech Football' }]);
    return r && r.handle === 'jaxonflowers7';
  })(),
  JSON.stringify(tag([{ handle: 'jaxonflowers7', name: 'Jaxon Flowers 5 Star' }, { handle: 'vtechfb', name: 'Virginia Tech Football' }])));

t('365-branded media tag is not a recruit',
  tag([{ handle: 'olemiss365', name: 'Ole Miss 365' }]) === null);
t('decorated display name is rejected as a name but handle kept', (() => {
  const r = tag([{ handle: 'jaymitch_1', name: 'Jayshawn Mitchell / NCAA ID 2512788693' }]);
  return r && r.handle === 'jaymitch_1' && r.name === null;
})());
t('lowercase display name is re-cased and still accepted', (() => {
  const r = tag([{ handle: 'cheatumlandon', name: 'landon cheatum' }]);
  return r && r.name === 'Landon Cheatum';
})(), JSON.stringify(tag([{ handle: 'cheatumlandon', name: 'landon cheatum' }])));

console.log('rules-only player gate');
{
  const [p] = prefilter([{
    id: 't1', author: 'karontaecm', authorName: 'Karontae Cunningham',
    authorBio: "C/O 2028 Football/Track Star | 5'11 180lb | Tyner Middle High Academy | 40 4.28",
    text: 'Blessed to receive an offer from @BCFootball #AGTG',
    createdAt: '2026-08-25T00:00:00Z',
  }]);
  const recs = rulesOnlyOffers(p);
  t('football-context self-announcement publishes with null position',
    recs.length === 1 && recs[0].position === null && recs[0].class_year === 2028,
    JSON.stringify(recs));
}
{
  const [p] = prefilter([{
    id: 't2', author: 'xavienlittleton', authorName: 'Xavien Littleton',
    authorBio: "Coffee Trojans 6'4 260 Class of 2029",
    text: 'Blessed to receive an offer from @RazorbackFB #WPS #Razorbacks',
    createdAt: '2026-08-25T00:00:00Z',
  }]);
  const recs = rulesOnlyOffers(p);
  t('bare stat-block bio without football evidence still stays in the archive',
    recs.length === 0,
    JSON.stringify(recs));
}
{
  const [p] = prefilter([{
    id: 't3', author: 'audreysims2028', authorName: 'Audrey Sims',
    authorBio: "Park Hill || 3SSB Della KC || 5'9\" ComboG || CO '28 || 4.0 GPA || Basketball",
    text: 'Blessed to receive an offer from @AF_Football!',
    createdAt: '2026-08-25T00:00:00Z',
  }]);
  const recs = rulesOnlyOffers(p);
  t('basketball self-announcement stays out of the football wire',
    recs.length === 0,
    JSON.stringify(recs));
}
{
  const [p] = prefilter([{
    id: 't4', author: 'c_burris2028', authorName: 'Collin Burris 3⭐',
    authorBio: "Marysville HS 28 | OT DT | 6'5 300 lbs | 3.98 GPA",
    text: 'After a great call with Coach Trickett I\u2019m blessed to receive an offer from @WVUfootball',
    createdAt: '2026-08-25T00:00:00Z',
  }]);
  const recs = rulesOnlyOffers(p);
  t('school-suffix class shorthand + handle year publish a real recruit',
    recs.length === 1 && recs[0].class_year === 2028,
    JSON.stringify(recs));
}
{
  const [p] = prefilter([{
    id: 't5', author: 'maverickowens', authorName: 'Maverick owens',
    authorBio: "5'11|175lbs|Cl-2030|ATH|Guard|To whom much is given, much is required!",
    text: 'After a great conversation with @Thamannjr Im blessed to receive a offer from @SMUFB',
    createdAt: '2026-08-29T19:34:00Z',
  }]);
  const recs = rulesOnlyOffers(p);
  t('self-announcement with ATH-guard bio publishes to SMU',
    recs.length === 1 && recs[0].school_id === 'smu' && recs[0].class_year === 2030 && recs[0].position === 'ATH' && recs[0].player_handle === 'maverickowens',
    JSON.stringify(recs));
}
t('SMU resolves from handle, abbrev, name and hashtag',
  ids('blessed to receive a offer from @SMUFB').includes('smu')
    && ids('after a great conversation Im blessed to receive from SMU').includes('smu')
    && ids("this time it's #SMU").includes('smu')
    && ids('picks up another offer from Southern Methodist').includes('smu'));

const rn = (s) => findReportedName(s);
t('name before offer verb', rn('BREAKING: 2028 four-star ATH Marcus Lee has been offered by Georgia') === 'Marcus Lee', String(rn('BREAKING: 2028 four-star ATH Marcus Lee has been offered by Georgia')));
t('name after offer verb', rn('Ohio State has offered 2027 QB Tyler Simmons') === 'Tyler Simmons', String(rn('Ohio State has offered 2027 QB Tyler Simmons')));
t('position prefix stripped', rn('NEWS: 2029 OL Jamal Peters picks up an offer from Texas') === 'Jamal Peters', String(rn('NEWS: 2029 OL Jamal Peters picks up an offer from Texas')));
t('no name present -> null', rn('Ole Miss has extended an offer') === null, String(rn('Ole Miss has extended an offer')));
t('school name is never read as a person', rn('Alabama extends offer to 2028 No. 7 RB out of San Antonio') === null, String(rn('Alabama extends offer to 2028 No. 7 RB out of San Antonio')));

console.log('hometown vs program');
t('trailing state is a hometown, not a program',
  JSON.stringify(ids('Florida has offered 4-star 2028 WR Malachi Lee out of Loudoun Sports Academy in Leesburg, Virginia.')) === JSON.stringify(['florida']),
  JSON.stringify(ids('Florida has offered 4-star 2028 WR Malachi Lee out of Loudoun Sports Academy in Leesburg, Virginia.')));
t('school-named city before a state is a hometown',
  JSON.stringify(ids('Texas has offered a kid out of Houston, Texas')) === JSON.stringify(['texas']),
  JSON.stringify(ids('Texas has offered a kid out of Houston, Texas')));
t('that city is still a school on its own', ids('Houston has offered him').includes('houston'));
t('state school still resolves as the offerer', ids('Virginia has offered him').includes('virginia'));
t('A&M survives the guard', ids('Texas A&M has offered him').includes('texas-am'));
t('regional-prefix non-FBS school is not the FBS program',
  !ids('out of Mount Pleasant has been offered by Nathan Brown and Central Arkansas').includes('arkansas'),
  JSON.stringify(ids('out of Mount Pleasant has been offered by Nathan Brown and Central Arkansas')));
t('non-FBS "State University" is not the bare state FBS program',
  !ids('has received a D1 offer to Alabama State University').includes('alabama'),
  JSON.stringify(ids('has received a D1 offer to Alabama State University')));
t('real FBS "State" school still resolves (regression guard)',
  ids('Arizona State comes through with an offer').includes('arizona-state'));
t('branch campus is not the flagship',
  !ids('Blessed to receive an offer from University of Alabama - Huntsville').includes('alabama'),
  JSON.stringify(ids('Blessed to receive an offer from University of Alabama - Huntsville')));
t('Arkansas Tech is not Arkansas', !ids('offer from Arkansas Tech University').includes('arkansas'));
t('South Carolina State is not South Carolina', !ids('offer from South Carolina State').includes('south-carolina'));
t('Arkansas State Mid-South is not Arkansas State', !ids('offer from Arkansas State University Mid-South').includes('arkansas-state'));

console.log('institution boundaries');
const notSchool = (id, text) => t(`${id} is not named by: ${text.slice(0, 54)}`,
  !ids(text).includes(id), JSON.stringify(ids(text)));

notSchool('colorado', 'I am beyond blessed to receive a scholarship offer from The Colorado School of Mines! @MinesFootball');
notSchool('oklahoma', '2027 Madi House has been offered by Oklahoma Panhandle State University.');
notSchool('wisconsin', 'Blessed to receive my first offer from Wisconsin Lutheran College. Thank you Coach Schwall');
notSchool('california', '2029 Julius Ogunfuye received an offer from Cal State Northridge.');
notSchool('arizona', 'After a great conversation with Arizona Christian I am blessed to receive my 5th offer');
notSchool('kansas', 'I have received a collegiate offer from Kansas Christian. Thank you Coach Jackson');
notSchool('west-virginia', 'So blessed to receive an offer from West Virginia Wesleyan! Thank you, Coach Vincent');
notSchool('minnesota', 'I am grateful to receive an offer from Minnesota North College - Itasca');
notSchool('texas-am', 'OFFER WIRE: Cam Claiborne 2027 Petersburg (VA) to Texas A&M-Texarkana');
notSchool('missouri', 'So blessed to receive my 6th offer from Missouri Valley College');
notSchool('florida', 'Congratulations to Morgan Mocadlo on receiving an offer to continue her career at Florida Southern!');
notSchool('kentucky', 'The art exhibit at Kentucky State University offers a range of perspectives');
notSchool('indiana', "A professor at Indiana University's Kelley School of Business");
notSchool('houston', 'The residency is offered in partnership with the University of Houston College of Pharmacy');
notSchool('iowa', 'Zavian Chones @ Iowa Central JuCo picks up @ODUFootball Offer');
notSchool('new-mexico', 'Congratulations on your offer to New Mexico Highlands University');
notSchool('louisiana', 'thankful to receive an offer to continue my career at Centenary College of Louisiana!');

const isSchool = (id, text) => t(`${id} still resolves: ${text.slice(0, 54)}`,
  ids(text).includes(id), JSON.stringify(ids(text)));

isSchool('western-michigan', 'Congratulations on receiving an offer from Western Michigan University.');
isSchool('northern-illinois', 'truly honored and blessed to receive an offer from Northern Illinois University');
isSchool('central-michigan', 'Blessed to receive an offer from Central Michigan');
isSchool('eastern-michigan', 'picks up his 5th NCAA Division I offer, this one from Eastern Michigan');
isSchool('western-kentucky', 'Blessed to receive an offer from Western Kentucky');
isSchool('virginia-tech', 'After a great conversation I am blessed to receive an offer from Virginia Tech!');
isSchool('georgia-tech', 'Extremely blessed to receive my 35th Offer FROM GEORGIA TECH!!');
isSchool('south-alabama', 'Blessed to receive an Offer from the University Of South Alabama!!');
isSchool('south-florida', 'Beyond blessed to announce I received my 21st D1 offer from the University of South Florida');
isSchool('ucf', 'Blessed to receive an offer from the University of Central Florida');
isSchool('tcu', 'Blessed to receive an offer from Texas Christian University');
isSchool('colorado-state', 'After a great conversation with Coach Wilson Colorado State offered me');
isSchool('michigan-state', 'Michigan State Spartans Football has offered him');
isSchool('sam-houston', 'Offer from Sam Houston State');
isSchool('louisiana-monroe', 'Blessed to receive an offer from Louisiana-Monroe');
isSchool('uab', 'Blessed to receive an offer from Alabama-Birmingham');

t('postal code after a school is a state, not a program',
  JSON.stringify(ids('2029 DE Emavian Gibson - Dorman HS, SC. Offer - Texas Tech')) === JSON.stringify(['texas-tech']),
  JSON.stringify(ids('2029 DE Emavian Gibson - Dorman HS, SC. Offer - Texas Tech')));
t('parenthesised postal code is a state',
  !ids('2030 ABC Prep (NM) G Jamal Washington has received an offer').includes('new-mexico'));

t('"North Texas universities" is a region', !ids('See which North Texas universities offer free tuition').includes('north-texas'));
t('"in south Florida" is a region', !ids('In south Florida we offer food and coffee').includes('south-florida'));
t('but the program still resolves', ids('Blessed to receive an offer from South Florida!').includes('south-florida'));

t('no FBS school is shadowed by the non-FBS roster', (() => {
  for (const s of SCHOOLS_LIST) {
    for (const v of [s.name, `${s.name} University`, `University of ${s.name}`, `${s.name} ${s.nickname}`, ...s.aliases]) {
      if (foreignInstitution(v)) return false;
    }
  }
  return true;
})());
t('the non-FBS roster is loaded', nonFbsRosterSize() > 2000, String(nonFbsRosterSize()));

console.log('offer verb forms');
t('plural "offers" is a reporter voice', classify('Bama offers 2028 WR Jaylen Carter').kind === 'reporter_voice');
t('counted offers is a reporter voice', classify('Georgia offers three 2029 prospects today').kind === 'reporter_voice');
t('ranking Top 5 is not a shortlist', classify("2027 Nat'l Top 5 / 5-star Cayden Daughtry received his Hog offer").prior > 0.3);
t('my top 5 IS a shortlist', classify('Blessed to announce my top 5 schools').prior <= 0.3);
t('acronym after "offers" needs a following name, not just any word',
  classify('Illinois alone offers DL tests in over 130 languages.').kind !== 'reporter_voice',
  JSON.stringify(classify('Illinois alone offers DL tests in over 130 languages.')));
t('acronym after "offers" WITH a name still classifies', classify('Bama offers OL Marcus Lee').kind === 'reporter_voice');
t('multi-school offer recap is a hard negative',
  classify('has already picked up offers from Alabama, Michigan, LSU, Florida, Georgia, Miami, Oregon, and many more').hardNegative);
t('previous offer is not a new event', classify('Alabama previously offered 2029 ATH Janzen Currie').hardNegative);
t('bare commit noun is a hard negative',
  classify('West Boca 6’3 WR Jayden St. Fort (‘27) is an Eastern Michigan commit. He had offers from Florida, FSU and Miami, among others.').hardNegative);
t('historical had-offers recap is not a new event',
  classify('2027 WR Jayden St. Fort had offers from Florida, FSU and Miami, among others.').hardNegative);
t('aspirational offer is not an offer', classify('A Western Michigan offer would be amazing').hardNegative);
t('recent-offer recap is not a new event', classify('He added a recent offer from Washington').hardNegative);
t('"has offers from X, Y, Z" recap is a hard negative',
  classify("Damir Williams @damir_williams0 - c/o 2027 - WR - Evans High School @EHSTrojanFTBL - Full Season Highlights Jr Szn (He Has Offers From The UNC Pembroke Braves, Florida Atlantic Owls, Sam Houston Bearkats, & More)").hardNegative);
t('"has offers from" without a new-offer verb is a hard negative',
  classify('He has offers from Alabama and Georgia.').hardNegative);
t('a new offer with a recap tail still survives classification',
  classify("After a great conversation I'm blessed to receive an offer from @GamecockFB! Now I have offers from Alabama, Georgia and LSU.").kind === 'player_voice',
  JSON.stringify(classify("After a great conversation I'm blessed to receive an offer from @GamecockFB! Now I have offers from Alabama, Georgia and LSU.")));
t('high school name is never read as a person',
  rn("Damir Williams - c/o 2027 - WR - Evans High School - Full Season Highlights Jr Szn (He Has Offers From The UNC Pembroke Braves)") === null,
  String(rn("Damir Williams - c/o 2027 - WR - Evans High School - Full Season Highlights Jr Szn (He Has Offers From The UNC Pembroke Braves)")));
t('explicit D2 offer is not attributed to an FBS school from search context',
  classify("I'm blessed to announce I have received a D2 offer to play running back at Minot State!").hardNegative);
t('explicit baseball offer is not a football offer',
  classify('I am thrilled to receive an offer to play baseball at The University of Akron!').hardNegative);
t('holding one D1 offer is still a stale profile statement',
  classify('2027 OT Paul Wallace holds a #D1 offer from Wyoming.').hardNegative);
t('profile label after sentence is not part of reporter player name',
  findReportedName('Nebraska offers 2028 OT Vincent Shields. Profile: link') === 'Vincent Shields');
t('reporter grammar recovers recruit when a media tag is ignored',
  findReportedName('Ole Miss offers 2030 DE Amarie Trammell - Ole Miss 365') === 'Amarie Trammell');
t('holding multiple offers is a stale profile recap',
  classify('Dieter Weber is a Class of 2028 quarterback who holds Division I offers from Miami and UConn.').hardNegative);
t('offer attributed to a prior spring showcase is stale',
  classify('Israel received his first Division I scholarship offer from Kent State following a strong spring showcase.').hardNegative);
t('offer attributed to a prior evaluation period is stale',
  classify('Jordan landed an offer from Nebraska during the spring evaluation period and has set his first visit.').hardNegative);
t('offer attributed to an earlier season is stale',
  classify('His potential gained recognition during the summer when he earned his first Division I scholarship offer from Miami.').hardNegative);
t('unrelated seasonal phrase does not suppress a current offer',
  !classify('After training during the summer, Marcus Lee has received an offer from Georgia today.').hardNegative);

console.log('offer attribution');
const target = (text) => { const r = resolveOfferTarget({ text }); return r.status === 'accepted' ? r.schoolId : `${r.status}:${r.reason}`; };
const tt = (label, text, want) => t(label, target(text) === want, `${target(text)} != ${want}`);

tt('Alabama A&M is not Alabama',
  'Blessed to say I’ve received an D1 offer from Alabama A &amp; M university @Tylan_G',
  'rejected:explicit_non_fbs_target');
t('entities are decoded everywhere', decodeEntities('A &amp; M &#39;27 &quot;x&quot;') === 'A & M \'27 "x"', decodeEntities('A &amp; M &#39;27'));
t('& holds a name together', !findSchools('offer from Franklin &amp; Marshall College').some((s) => s.id === 'marshall'));
t('& does not glue two schools together',
  ['alabama', 'auburn'].every((id) => findSchools('offers from Alabama & Auburn').some((s) => s.id === id)));
t('Texas A&M still resolves', findSchools('offer from Texas A&M').some((s) => s.id === 'texas-am'));

tt('another school’s offer list is not an offer',
  'Spain Park 2028 RB CJ Davis is a strong runner. Offers from Oregon, Tennessee, Vanderbilt and others.',
  'pending:ambiguous_target');
tt('a hashtag is not an offer',
  'The 2029 QB already holds two FBS offers from Tulsa and Samford. #RecruitGeorgia',
  'tulsa');
t('a comma-separated school list is not a hometown',
  ['oregon', 'tennessee', 'vanderbilt'].every((id) => findSchools('Offers from Oregon, Tennessee, Vanderbilt').some((s) => s.id === id)),
  JSON.stringify(findSchools('Offers from Oregon, Tennessee, Vanderbilt').map((s) => s.id)));
t('a real hometown is still a hometown',
  !findSchools('Florida has offered WR Malachi Lee out of an academy in Leesburg, Virginia').some((s) => s.id === 'virginia'));

t('a media handle is not a program',
  !findSchools('offer from talladega prep u @Alabama_Varsity @DexPreps').length,
  JSON.stringify(findSchools('offer from talladega prep u @Alabama_Varsity').map((s) => s.id)));
t('an official program handle still resolves',
  findSchools('Blessed to receive an offer from @AlabamaFTBL').some((s) => s.id === 'alabama'));
tt('a non-FBS program handle as the target is rejected',
  'After a great visit at Northwestern I am excited to announce that I have received an offer to play @nwc_fb!',
  'rejected:non_fbs_handle_target');
tt('an FBS program handle after "to play" is accepted',
  'Blessed to receive an offer to play @AuburnFootball', 'auburn');

tt('reporter voice reads the subject', 'Wake Forest has offered 2028 OT Roman Maurizio from Central Catholic HS, PA.', 'wake-forest');
tt('the recruit’s high school is not the offerer', 'Penn State offers 2028 DL Kiren Green from Ohio.', 'penn-state');
tt('"scholarship" does not outrank "offer"',
  'Blessed to announce I have received my first SEC Division I scholarship offer from the University of Oklahoma.', 'oklahoma');
tt('the offer target is read, not a trailing cheer',
  'Blessed to receive an offer from Community Christian College! Go cyclones!',
  'rejected:explicit_non_fbs_target');
t('"committing" is a commitment, not a new offer',
  classify('Trey Wright wasted little time committing to USC days after receiving a scholarship offer').hardNegative);

console.log('place name, different team');
const notSchool2 = (id, text) => t(`${id} is not named by: ${text.slice(0, 46)}`,
  !ids(text).includes(id), JSON.stringify(ids(text)));

notSchool2('georgia', 'EXTREMELY BLESSED TO RECEIVE AN OFFER FROM GEORGIA KNIGHTS FOOTBALL!!! Via Coach Wesley Jr.');
notSchool2('arizona', 'blessed to receive my second offer from Arizona Spiders #Gospiders');
notSchool2('alabama', 'I’m blessed to receive my First Offer from Alabama Rays #Gorays');
notSchool2('smu', 'I am super appreciative to receive a U-Sports offer from the SMU Huskies');
notSchool2('arizona', 'I am blessed to have received an offer from Ottawa University Arizona');
notSchool2('alabama', '#AGTG blessed to receive an offer from the University of Alabama Birmingham!');

t('a school’s own mascot is not a different team', [
  ['michigan-state', 'Michigan State Spartans Football has offered him'],
  ['boston-college', 'Boston College Eagles offered him'],
  ['georgia', 'Blessed to receive an offer from the Georgia Bulldogs'],
  ['ucf', 'Blessed to receive an offer from the UCF Knights'],
  ['alabama', 'Blessed to receive an offer from the University of Alabama'],
  ['ohio-state', 'offer from Ohio State University Thank You Coach'],
].every(([id, text]) => ids(text).includes(id)));

t('a tagged non-FBS program overrules the prose', resolveOfferTarget({
  text: 'After a great call with Coach Orris @IndWesleyan_FB and i’m grateful to receive another offer from Indiana Westland',
  mentioned: [{ handle: 'indwesleyan_fb', name: 'Indiana Wesleyan FB' }],
}).reason === 'non_fbs_program_tagged');
t('a tagged high school does not block a real offer', resolveOfferTarget({
  text: 'Blessed to receive an offer from Alabama! Roll Tide',
  mentioned: [{ handle: 'hooverfb', name: 'Hoover High School Football' }],
}).schoolId === 'alabama');

t('women’s flag football is not this wire', resolveOfferTarget({
  text: 'Beyond grateful to announce that I’ve received an offer from Eastern Michigan University Women’s Flag Football!',
}).status === 'rejected');
t('the same school’s football offer is fine',
  resolveOfferTarget({ text: 'Blessed to receive an offer from Eastern Michigan University!' }).schoolId === 'eastern-michigan');

console.log('offer tiers and player stats');
t('SEC school is P4', tierOf({ id: 'alabama', conference: 'SEC' }) === 'P4');
t('Big Ten is P4', tierOf({ id: 'michigan', conference: 'B1G' }) === 'P4');
t('Notre Dame (IND) is P4', tierOf({ id: 'notre-dame', conference: 'IND' }) === 'P4');
t('Mountain West is G5', tierOf({ id: 'boise-state', conference: 'MW' }) === 'G5');
t('UConn (IND) is G5', tierOf({ id: 'uconn', conference: 'IND' }) === 'G5');
{
  const offers = [
    { playerId: 'p1', schoolId: 'boise-state', offeredAt: '2026-07-01T00:00:00Z' },
    { playerId: 'p1', schoolId: 'troy', offeredAt: '2026-07-10T00:00:00Z' },
    { playerId: 'p1', schoolId: 'alabama', offeredAt: '2026-08-01T00:00:00Z' },
  ];
  const st = decorateOffers(offers);
  t('tiers assigned to rows', offers.every((o) => o.tier === 'G5' || o.tier === 'P4') && offers[2].tier === 'P4');
  t('first-offer claims are never inferred from archive order', offers.every((o) => !('firstForPlayer' in o) && !('firstP4ForPlayer' in o) && !('firstG5ForPlayer' in o)));
  const s = st.get('p1');
  t('player stats total/p4/g5', s.total === 3 && s.p4 === 1 && s.g5 === 2, JSON.stringify(s));
  t('player totals contain only evidence-backed counts', !('firstOfferAt' in s) && s.total === 3, JSON.stringify(s));
}
{
  const offers = [{ playerId: 'p2', schoolId: 'alabama', offeredAt: '2026-08-01T00:00:00Z' }];
  decorateOffers(offers);
  const st = decorateOffers(offers);
  t('decorate is idempotent', !('firstP4ForPlayer' in offers[0]) && st.get('p2').p4 === 1 && offers[0].tier === 'P4');
}

console.log('phrase job coverage');
const PJS = phraseJobs().map((j) => j.query);
t('general "blessed to receive" phrase query is present',
  PJS.some((q) => q.includes('"blessed to receive"')),
  PJS.join(' | '));
t('over-specific blessed-to-receive variants are folded into the general one',
  !PJS.some((q) => q.includes('"blessed to receive an offer"') || q.includes('"blessed to receive my"')),
  PJS.join(' | '));
t('other player-voice phrasings remain individual queries',
  PJS.some((q) => q.includes('"after a great conversation"')) && PJS.some((q) => q.includes('"AGTG"')),
  PJS.join(' | '));

console.log('historical job generation');
const history = backfillJobs(30, new Date('2026-08-27T12:00:00Z'));
t('one efficient month window per school by default', history.length === schoolJobs().length, String(history.length));
t('oldest slice starts 30 days back', history[0]?.start === '2026-07-28', history[0]?.start);
t('newest slice ends today', history.at(-1)?.end === '2026-08-27', history.at(-1)?.end);
t('historical keys are versioned away from incomplete daily plan', history.every((j) => j.key.startsWith('backfill:v2:')));
const weeklyHistory = backfillJobs(30, new Date('2026-08-27T12:00:00Z'), 7);
t('optional weekly chunks cover every school five times', weeklyHistory.length === schoolJobs().length * 5, String(weeklyHistory.length));
t('weekly chunks cover exactly 30 days',
  weeklyHistory.filter((j) => j.schoolId === schoolJobs()[0].key).reduce((n, j) => n + j.chunkDays, 0) === 30);
t('historical slices are fixed windows', history.every((j) => j.fixedWindow && / since:\d{4}-\d{2}-\d{2} until:\d{4}-\d{2}-\d{2}$/.test(j.query)));
const anchorState = { firstRunAt: '2026-08-27T12:00:00.000Z' };
t('backfill anchor starts at first run',
  backfillAnchorDate(anchorState, new Date('2026-08-30T12:00:00Z')).toISOString() === '2026-08-27T12:00:00.000Z');
t('backfill anchor does not slide on a later day',
  backfillAnchorDate(anchorState, new Date('2026-09-05T12:00:00Z')).toISOString() === '2026-08-27T12:00:00.000Z');

console.log('quota allocation');
const mixed = prioritizeJobs(
  [
    ...Array.from({ length: 8 }, (_, i) => ({ key: `live-${i}`, priority: 1 })),
    ...Array.from({ length: 8 }, (_, i) => ({ key: `history-${i}`, fixedWindow: true })),
  ],
  {},
  0.25,
);
t('25% backfill share puts one historical job in each four-job window',
  mixed.slice(0, 8).filter((j) => j.fixedWindow).length === 2,
  mixed.slice(0, 8).map((j) => j.fixedWindow ? 'H' : 'L').join(''));
t('live-only ordering does not invent history',
  prioritizeJobs([{ key: 'live', priority: 1 }], {}, 0.25).every((j) => !j.fixedWindow));

console.log('search response safety');
const fakePage = (onGoto = () => {}, onWheel = () => {}, bodyText = 'Latest') => ({
  waitForResponse: async () => null,
  goto: async () => { onGoto(); },
  waitForTimeout: async () => {},
  url: () => 'https://x.com/search',
  title: async () => 'Search / X',
  evaluate: async () => bodyText,
  mouse: { wheel: async () => { onWheel(); } },
});
const missingTimeline = new SearchSession({ authToken: 'test', ct0: 'test' });
missingTimeline.page = fakePage();
const missingResult = await missingTimeline.search('test', { settleMs: 1 });
t('missing SearchTimeline response leaves job pending',
  !missingResult.ok && /slice left pending/.test(missingResult.error), JSON.stringify(missingResult));

const loginWall = new SearchSession({ authToken: 'test', ct0: 'test' });
loginWall.page = fakePage(() => {}, () => {}, "Don't miss what's happening. Sign in to X.");
const loginWallResult = await loginWall.search('test', { settleMs: 1 });
t('login wall at /search is reported as an expired session, not a missing response',
  !loginWallResult.ok && loginWall.loggedOut && /session expired/i.test(loginWallResult.error),
  JSON.stringify(loginWallResult));

const HOLDING = 'x.com Performing security verification This website uses a security service to protect against malicious bots.';
let cleared = false;
const challenged = new SearchSession({ authToken: 'test', ct0: 'test' });
challenged.page = {
  ...fakePage(),
  evaluate: async () => (cleared ? 'Latest' : HOLDING),
  waitForTimeout: async () => {
    if (!challenged.challengesSeen) return;
    cleared = true;
    challenged.timelineResponses = 1;
    challenged.timelineStatuses = [200];
    challenged.captured = [{}];
  },
};
const challengedResult = await challenged.search('test', { settleMs: 1 });
t('a bot-check interstitial is waited out instead of failing the job',
  challengedResult.ok && challenged.challengesSeen === 1 && !challenged.challengeStuck,
  JSON.stringify(challengedResult));

const stuckChallenge = new SearchSession({ authToken: 'test', ct0: 'test' });
stuckChallenge.page = fakePage(() => {}, () => {},
  'x.com Performing security verification This website uses a security service to protect against malicious bots.');
const stuckResult = await stuckChallenge.search('test', { settleMs: 1, challengeMs: 2 });
t('a bot check that never clears is flagged so the sweep can stop early',
  !stuckResult.ok && stuckResult.challengeStuck && stuckChallenge.challengeStuck,
  JSON.stringify(stuckResult));

const limitPage = new SearchSession({ authToken: 'test', ct0: 'test' });
limitPage.page = fakePage(() => {}, () => {}, 'Rate limit exceeded. Please wait a few moments then try again.');
const limitPageResult = await limitPage.search('test', { settleMs: 1 });
t('rate-limit interstitial is reported as rate limiting, not a dead session',
  !limitPageResult.ok && limitPageResult.rateLimited && !limitPage.loggedOut,
  JSON.stringify(limitPageResult));

const emptyTimeline = new SearchSession({ authToken: 'test', ct0: 'test' });
emptyTimeline.page = fakePage(() => {
  emptyTimeline.timelineResponses = 1;
  emptyTimeline.timelineStatuses = [200];
  emptyTimeline.captured = [{}];
});
const emptyResult = await emptyTimeline.search('test', { settleMs: 1 });
t('valid parsed empty timeline can complete', emptyResult.ok && emptyResult.posts.length === 0, JSON.stringify(emptyResult));

const paginatedLimit = new SearchSession({ authToken: 'test', ct0: 'test' });
paginatedLimit.page = fakePage(
  () => {
    paginatedLimit.timelineResponses = 1;
    paginatedLimit.timelineStatuses = [200];
    paginatedLimit.captured = [{}];
  },
  () => {
    paginatedLimit.rateLimited = true;
    paginatedLimit.timelineResponses++;
    paginatedLimit.timelineStatuses.push(429);
  },
);
const limitedResult = await paginatedLimit.search('test', { scrolls: 1, settleMs: 1 });
t('pagination rate limit leaves fixed window pending',
  !limitedResult.ok && limitedResult.rateLimited && /slice left pending/.test(limitedResult.error),
  JSON.stringify(limitedResult));

console.log('scheduler fallback');
const noToken = await dispatchWire({ token: '', fetchImpl: async () => { throw new Error('must not fetch'); } });
t('Netlify trigger is inert until token is configured', noToken.skipped === 'missing GITHUB_DISPATCH_TOKEN');
let dispatchCalls = 0;
const dispatched = await dispatchWire({
  token: 'test',
  now: Date.parse('2026-08-30T01:25:00Z'),
  fetchImpl: async (_url, init = {}) => {
    dispatchCalls++;
    if (init.method === 'POST') return { ok: true, status: 204, text: async () => '' };
    return { ok: true, status: 200, json: async () => ({ workflow_runs: [] }), text: async () => '' };
  },
});
t('Netlify trigger dispatches when no recent run exists', dispatched.dispatched && dispatchCalls === 2);
dispatchCalls = 0;
const skippedRecent = await dispatchWire({
  token: 'test',
  now: Date.parse('2026-08-30T01:25:00Z'),
  fetchImpl: async () => {
    dispatchCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ workflow_runs: [{ id: 123, status: 'completed', created_at: '2026-08-30T01:20:00Z' }] }),
      text: async () => '',
    };
  },
});
t('Netlify trigger suppresses a recent GitHub run', skippedRecent.runId === 123 && dispatchCalls === 1);

console.log('position from bio order');
{
  const edgeTe = "6’7|230lbs| 83 inch Wingspan| C\\O 2027 The Pennington School | 908-386-0432|Edge Rusher/Tight End| Sf/Pf|";
  t('first-listed bio position wins over a later spelled-out one', JSON.stringify(bioPositions(edgeTe)) === JSON.stringify(['EDGE', 'TE']), JSON.stringify(bioPositions(edgeTe)));
  t('parseBio takes the first-listed position', parseBio(edgeTe, 2026).position === 'EDGE');
  t('a weight in lb is not a linebacker', parseBio("6'4 230 lb | WR | C/O 2028", 2026).position === 'WR', JSON.stringify(parseBio("6'4 230 lb | WR | C/O 2028", 2026)));
  t('uppercase LB after a class year is still a linebacker', parseBio('C/O 2028 LB 6-1 215', 2026).position === 'LB');
  t('WR/Safety lists WR first', parseBio('5\'11 160 WR/Safety/Track ATH c/o28', 2026).position === 'WR', JSON.stringify(parseBio('5\'11 160 WR/Safety/Track ATH c/o28', 2026)));
  t('C/O is not a center in post text', findPosition('C/O ‘27 3 star WR Jayden Elder has committed to FIU') === 'WR');
  t('post text takes the first-listed position', findPosition('2028 Edge Rusher/Tight End Joshua Benka-Coker') === 'EDGE', String(findPosition('2028 Edge Rusher/Tight End Joshua Benka-Coker')));
}

console.log('position from tagged coaches');
{
  const mk = (i, pos, coach, school) => ({
    player: { id: `p${i}`, name: `Player ${i}`, handle: `player${i}`, position: pos, bio: `C/O 2028 | ${pos} | 6-2 200` },
    offer: { playerId: `p${i}`, schoolId: school, evidence: [{ author: `player${i}`, text: `Blessed to receive an offer from @School @${coach} @HeadCoachX` }] },
  });
  const rows = [mk(1, 'DE', 'CoachDLine', 'ohio-state'), mk(2, 'DT', 'CoachDLine', 'ohio-state'), mk(3, 'EDGE', 'CoachDLine', 'ohio-state'), mk(4, 'DE', 'CoachDLine', 'ohio-state'),
    mk(5, 'WR', 'CoachDLine2', 'ohio-state'), mk(6, 'CB', 'CoachDLine2', 'ohio-state'), mk(7, 'QB', 'CoachDLine2', 'ohio-state')];
  const target = { id: 'pt', name: 'Target Kid', handle: 'targetkid', position: 'TE', bio: '6-5 240 TE/DE C/O 2028' };
  const ath = { id: 'pa', name: 'Athlete Kid', handle: 'athkid', position: 'ATH', bio: '6-1 190 ATH C/O 2028' };
  const offers = [...rows.map((r) => r.offer),
    { playerId: 'pt', schoolId: 'ohio-state', evidence: [{ author: 'targetkid', text: 'Blessed to receive an offer @CoachDLine @HeadCoachX' }] },
    { playerId: 'pa', schoolId: 'ohio-state', evidence: [{ author: 'athkid', text: 'Blessed to receive an offer @CoachDLine @HeadCoachX' }] }];
  const players = [...rows.map((r) => r.player), target, ath];
  const index = buildCoachIndex(offers, players, new Set());
  const vt = coachVotes(index, target, offers.filter((o) => o.playerId === 'pt'));
  t('a school-concentrated, position-pure handle is read as a DL coach', vt && vt.group === 'DL', JSON.stringify(vt));
  t('TE/DE bio with a DL coach tag settles on DE', settlePosition(target, vt).position === 'DE', JSON.stringify(settlePosition(target, vt)));
  const va = coachVotes(index, ath, offers.filter((o) => o.playerId === 'pa'));
  t('ATH tagging a DL coach is filled from the coach', ['EDGE', 'DL', 'DT'].includes(settlePosition(ath, va).position), JSON.stringify(settlePosition(ath, va)));
  const head = coachVotes(index, target, [{ playerId: 'pt', schoolId: 'ohio-state', evidence: [{ author: 'targetkid', text: 'offer @HeadCoachX' }] }]);
  t('a handle with no position history gives no signal', head === null, JSON.stringify(head));
  t('mixed-position handle is not a position coach', coachVotes(index, target, [{ playerId: 'pt', schoolId: 'ohio-state', evidence: [{ author: 'targetkid', text: 'offer @CoachDLine2' }] }]) === null);
  t('a clear single bio position is not overridden by one coach tag',
    settlePosition({ id: 'x', name: 'X Y', position: 'TE', bio: '6-5 240 TE C/O 2028' }, { group: 'DL', count: 1, total: 1, share: 1, schools: 1, fine: null }).position === 'TE');
}

console.log('commit and decommit extraction');
{
  const ctx = () => ({ db: { players: [] }, cdb: newCommitDb([]), affiliations: { accounts: {} }, known: new Set() });
  const rep = (text, extra = {}) => ({ id: 'c' + Math.random(), author: 'somereporter', authorName: 'Some Reporter', authorBio: 'Recruiting analyst', text, mentions: [], mentioned: [], createdAt: '2026-11-10T12:00:00Z', ...extra });
  const one = (text, extra) => extractCommit(rep(text, extra), ctx());
  const a = one('BREAKING: Elite 2028 QB Josiah Boyd has Committed to UCLA, he tells me for @Rivals The 6’3 180 QB from Moreno Valley, CA chose the Bruins over Oregon and Kentucky');
  t('reporter commit resolves player, class, position and school', a.status === 'accepted' && a.records[0].kind === 'commit' && a.records[0].school_id === 'ucla' && a.records[0].player_name === 'Josiah Boyd' && a.records[0].class_year === 2028 && a.records[0].position === 'QB', JSON.stringify(a));
  const d = one('🚨BREAKING🚨 2027 LB Jahmiere Daniels-Portis has decommitted from Colorado. https://t.co/x');
  t('decommit is its own event type', d.status === 'accepted' && d.records[0].kind === 'decommit' && d.records[0].school_id === 'colorado', JSON.stringify(d));
  const f = one('NEWS: 2027 DL Kavarris Duncan has flipped his commitment from Tulane to Alabama. Was offered by the Crimson Tide yesterday.');
  t('a flip is a commit to the new school plus a decommit from the old one',
    f.status === 'accepted' && f.records.some((r) => r.kind === 'commit' && r.school_id === 'alabama' && r.flip_from === 'tulane') && f.records.some((r) => r.kind === 'decommit' && r.school_id === 'tulane'), JSON.stringify(f));
  const p = extractCommit({ id: 'pv1', author: 'jayvynw', authorName: 'Jayvyn Williams', authorBio: "C/O 2027 | DT | 6'4 290 | Hickory HS", text: 'Blessed to say I’m committed to App State! @AppState_FB', mentions: ['appstate_fb'], mentioned: [{ handle: 'appstate_fb', name: 'App State Football' }], createdAt: '2026-11-10T12:00:00Z' }, ctx());
  t('player announcement resolves from the tagged program', p.status === 'accepted' && p.voice === 'player' && p.records[0].school_id === 'appalachian-state' && p.records[0].position === 'DT', JSON.stringify(p));
  const q = (text, extra) => one(text, extra).status;
  t('a recruit already committed elsewhere is not a new commit', q('Alabama offers 2027 OL John Smith currently committed to Memphis') !== 'accepted');
  t('"who’s committed to" is a status, not an event', q('The prolific 2027 RB John Smith who’s committed to Utah State has landed a new offer from Utah') !== 'accepted');
  t('basketball commitments are not football commits', q('NEWS: 4 star Howard Williams has committed to Arizona State. The 6-7 forward is a top-50 recruit in the 2027 class.') !== 'accepted');
  t('a future commitment is not an event', q('2027 QB Tyler Simmons will commit to Georgia on Friday') !== 'accepted');
  t('a non-FBS target is rejected', q('2027 WR Saywer Kuypers has committed to Southeastern, choosing the Lions over FBS offers from Kent State and UMass.') !== 'accepted');
  t('a summer commitment recapped now is stale', q('Per 247Sports, Missouri offered 2027 3-star DL Jason Lewis. The 6-foot-4 Lewis verbally committed to Syracuse football in mid-June.') !== 'accepted');
  t('transfer portal and JUCO commitments are out of scope', q('BREAKING: 2027 JUCO WR Marlon Fluker has committed to Troy!') !== 'accepted');
  t('a list of players in one post is not a commit', q('Roswell Hornets 14 players with college offers:\n- 3 star OT committed to Georgia\n- 3 star Edge Jaxon Holly committed to Florida State\n2027 class football') !== 'accepted');
  const status = extractCommit({ id: 'pv2', author: 'masonm', authorName: 'Mason McClure', authorBio: "C/O 2027 | WR | 6'1 190 | Thompson HS", text: 'I remain COMMITTED to Maryland! @TerpsFootball', mentions: ['terpsfootball'], mentioned: [{ handle: 'terpsfootball', name: 'Maryland Football' }], createdAt: '2026-11-10T12:00:00Z' }, ctx());
  t('"I remain committed" is not a new commitment', status.status !== 'accepted', JSON.stringify(status));
  const prog = extractCommit({ id: 'pv3', author: 'kidwr', authorName: 'Kid Wideout', authorBio: "C/O 2027 | WR | 6'1 190 | Thompson HS", text: 'Thank you Coach for the offer from @Alabama_FB. I’m committed to the grind.', mentions: ['alabama_fb'], mentioned: [], createdAt: '2026-11-10T12:00:00Z' }, ctx());
  t('"committed to the grind" is not a school commitment', prog.status !== 'accepted', JSON.stringify(prog));

  const db = { players: [], review: [], _index: indexPlayers([]), _new: [], offers: [] };
  const cdb = newCommitDb([]);
  const posts = [
    rep('BREAKING: Class of 2027 QB Bo Bryan has Committed to Georgia, he tells me for @Rivals', { id: 'b1', author: 'hayes1' }),
    rep('Bo Bryan, son of country star Luke Bryan, has committed to Georgia. The three-star QB in the 2027 class picked the Bulldogs.', { id: 'b2', author: 'reporter2', createdAt: '2026-11-10T14:00:00Z' }),
    rep('Georgia has landed a commitment from 2027 QB Bo Bryan, the son of country music star Luke Bryan.', { id: 'b3', author: 'reporter3', createdAt: '2026-11-10T15:00:00Z' }),
  ];
  const st = processCommits(posts, { cdb, db, affiliations: { accounts: {} }, known: new Set(), observedAt: '2026-11-10T16:00:00Z', audit: {} });
  t('three posts about one commitment make one corroborated event', cdb.events.length === 1 && cdb.events[0].corroborations === 3 && st.accepted === 3, JSON.stringify({ n: cdb.events.length, c: cdb.events[0]?.corroborations, st }));
  t('the event is dated to the earliest post', cdb.events[0]?.at === '2026-11-10T12:00:00Z', String(cdb.events[0]?.at));
  const re = rep('BREAKING: Class of 2027 QB Bo Bryan has decommitted from Georgia', { id: 'b4', author: 'hayes1', createdAt: '2026-11-12T12:00:00Z' });
  processCommits([re], { cdb, db, affiliations: { accounts: {} }, known: new Set(), observedAt: '2026-11-12T13:00:00Z', audit: {} });
  t('a later decommit is a separate event for the same player', cdb.events.length === 2 && cdb.events.some((e) => e.kind === 'decommit') && db.players.length === 1, JSON.stringify(cdb.events.map((e) => e.kind)));
}

console.log('tagged staff of non-FBS programs');
{
  const known = new Set();
  const staff = loadStaff({ handles: {
    coachhawk225: { x: 37, f: { minnesota: 1 }, at: '2026-11-12T00:00:00Z' },
    mixedcoach: { x: 4, f: { alabama: 6 }, at: '2026-11-12T00:00:00Z' },
    coachsupports: { x: 5, f: { minnesota: 3 }, at: '2026-11-12T00:00:00Z' },
  } });
  const post = (text, extra = {}) => ({ author: 'kid1', text, mentions: [], ...extra });
  t('offerer coach known to belong to a non-FBS program vetoes a name-only FBS attribution',
    !!staffVeto(staff, post('After a great conversation with @CoachHawk225 im proud to recieve my first ever offer from Minnesota ‼️ AGTG'), 'minnesota', known));
  t('a coach with FBS sightings for that school does not veto', staffVeto(staff, post('After a great conversation with @CoachSupports I am blessed to receive an offer from Minnesota'), 'minnesota', known) === null);
  t('a mixed-history coach does not veto', staffVeto(staff, post('After a great conversation with @MixedCoach I am blessed to receive an offer from Alabama'), 'alabama', known) === null);
  t('a coach only in a trailing list of tags is not read as the offerer', staffVeto(staff, post('Blessed to receive an offer from Minnesota @Kid2 @CoachHawk225'), 'minnesota', known) === null);
  t('an unknown coach tagged next to a known non-FBS coach blocks the veto', staffVeto(staff, post('After a great conversation with @CoachHawk225 and @CoachNewGuy I am blessed to receive an offer from Minnesota'), 'minnesota', known) === null);
  t('a handle that looks like the school’s own account never vetoes', staffVeto(loadStaff({ handles: { huskerfootball: { x: 17, f: { nebraska: 1 }, at: '2026-11-12T00:00:00Z' } } }), post('Thanks @HuskerFootball for the game day invite, after a great talk I am blessed to receive an offer from Nebraska'), 'nebraska', known) === null);
  const learn = loadStaff(null);
  for (let i = 0; i < 3; i++) observeNonFbs(learn, post('After a great conversation with @CoachNewHawk I am blessed to receive an offer from Minnesota State Community and Technical College', { author: 'kid' + i }), known, '2026-11-12T00:00:00Z');
  t('three explicit non-FBS offers teach the veto', !!staffVeto(learn, post('After a great conversation with @CoachNewHawk I am blessed to receive an offer from Minnesota'), 'minnesota', known));
  const offers = [
    { id: 'o1', playerName: 'Weak Kid', schoolName: 'Minnesota', schoolId: 'minnesota', evidence: [{ author: 'kid1', text: 'After a great conversation with @CoachHawk225 im proud to recieve my first ever offer from Minnesota', attribution: { schoolEvidenceType: 'full_school_name' } }] },
    { id: 'o2', playerName: 'Official Kid', schoolName: 'Minnesota', schoolId: 'minnesota', evidence: [{ author: 'kid3', text: 'After a great conversation with @CoachHawk225 offer from @GopherFootball', attribution: { schoolEvidenceType: 'official_school_tag' } }] },
  ];
  const pr = pruneOffers(offers, staff, known);
  t('cleanup removes only the weakly attributed offer', pr.removed.length === 1 && pr.removed[0].id === 'o1' && pr.kept.length === 1);
}

console.log('coach bios');
{
  t('bio names school and position coach role', JSON.stringify(parseCoachBio('San Diego State Aztec wide receivers and pass game coordinator')) === JSON.stringify({ school: 'san-diego-state', nonFbs: null, group: 'WR' }));
  const rb = parseCoachBio('Running Backs Coach | Minnesota State Community & Technical College');
  t('bio at a non-FBS college is flagged non-FBS', rb.school === null && !!rb.nonFbs && rb.group === 'RB', JSON.stringify(rb));
  t('an alum is not read as staff', parseCoachBio('Head Coach at Central High | Alabama alum').school === null);
  t('a bio with no program gives nothing', parseCoachBio('Dad. Coach. Trainer.').group === null);
  const bios = loadBios(null);
  recordBio(bios, 'Coach_Middleton', { authorName: 'Matthew Middleton', authorBio: 'San Diego State Aztec wide receivers and pass game coordinator' }, '2026-11-12T00:00:00Z');
  recordBio(bios, 'CoachHawkBio', { authorName: 'Nick Hawkins', authorBio: 'Running Backs Coach | Minnesota State Community & Technical College' }, '2026-11-12T00:00:00Z');
  recordBio(bios, 'silentcoach', null, '2026-11-12T00:00:00Z');
  t('a lookup that finds no posts is remembered as a miss', bios.handles.silentcoach.miss === true && bioFresh(bios.handles.silentcoach, Date.parse('2026-11-20T00:00:00Z')) && !bioFresh(bios.handles.silentcoach, Date.parse('2027-01-20T00:00:00Z')));
  const weaver = { id: 'pw', name: 'Nick Weaver', handle: 'nickweaver_1', position: 'ATH', bio: 'MICDS | C/O 2027 | Football. ATH| 3.4 GPA | 6’3' };
  const wOffers = [
    { playerId: 'pw', schoolId: 'san-diego-state', evidence: [{ author: 'nickweaver_1', text: 'After a Conversation with Coach Middleton. I’m excited to announce an Offer from San Diego State University! @jasonthomasfb @ContinuedFight @Coach_Middleton @BrendanThompsn' }] },
    { playerId: 'pw', schoolId: 'boston-college', evidence: [{ author: 'nickweaver_1', text: 'After a great conversation with @therealkwat . I’m excited to announce I got an offer from Boston College!!' }] },
  ];
  const idx = buildCoachIndex(wOffers, [weaver], new Set());
  t('without a coach bio the ATH stays ATH', coachVotes(idx, weaver, wOffers) === null);
  const wv = coachVotes(idx, weaver, wOffers, bios);
  t('a coach bio at the offering school reads as that position', wv && wv.group === 'WR', JSON.stringify(wv));
  t('an ATH tagging a WR coach settles on WR', settlePosition(weaver, wv).position === 'WR', JSON.stringify(settlePosition(weaver, wv)));
  t('a coach bio from a different school gives no vote', coachVotes(idx, weaver, [{ ...wOffers[0], schoolId: 'boston-college' }], bios) === null);
  const hawkPost = { author: 'kid1', text: 'After a great conversation with @CoachHawkBio I am blessed to receive an offer from Minnesota', mentions: [] };
  t('a non-FBS coach bio vetoes a name-only FBS attribution', !!bioVeto(bios, hawkPost, 'minnesota', new Set()));
  t('a coach bio at the offering school does not veto', bioVeto(bios, { author: 'kid1', text: 'After a conversation with @Coach_Middleton I am blessed to receive an offer from San Diego State', mentions: [] }, 'san-diego-state', new Set()) === null);
  const ledgerOffers = [
    { playerId: 'pw', offeredAt: new Date().toISOString(), evidence: [{ author: 'nickweaver_1', text: 'Offer @Coach_Middleton @Plain_Handle @CoachNobody', attribution: { schoolEvidenceType: 'official_school_tag' } }] },
  ];
  const wanted = wantedBioHandles(ledgerOffers, [weaver], loadBios(null), new Set());
  t('ATH offers ask for the tagged coaches’ bios, only coach-like handles', JSON.stringify(wanted) === JSON.stringify(['coach_middleton', 'coachnobody']), JSON.stringify(wanted));
  t('a clear-position offer with an official tag asks for nothing', wantedBioHandles([{ ...ledgerOffers[0], playerId: 'pr' }], [{ id: 'pr', name: 'R R', position: 'WR', bio: 'C/O 2027 | WR' }], loadBios(null), new Set()).length === 0);
  t('already-cached handles are not asked again', wantedBioHandles(ledgerOffers, [weaver], bios, new Set()).join() === 'coachnobody', wantedBioHandles(ledgerOffers, [weaver], bios, new Set()).join());
  const jobs = bioJobs(['a_coach', 'b_coach']);
  t('bio lookups are plain from: searches', jobs.length === 2 && jobs[0].query === 'from:a_coach' && jobs[0].kind === 'bio' && jobs[0].handle === 'a_coach');
  const live = Array.from({ length: 20 }, (_, i) => ({ key: `L${i}`, kind: 'school', priority: 1 }));
  const bj = Array.from({ length: 20 }, (_, i) => ({ key: `bio:${i}`, kind: 'bio', handle: `h${i}`, query: `from:h${i}` }));
  const order = prioritizeJobs([...bj, ...live], {}, 0.25, 0.2, 0.1);
  t('bio lookups are a small lane and never starve the offer searches', order.slice(0, 20).filter((j) => j.kind === 'school').length >= 17 && order.slice(0, 20).some((j) => j.kind === 'bio') && order.length === 40);
}

console.log('commit search jobs');
{
  const jobs = commitJobs();
  t('one commit search per FBS school', jobs.length === SCHOOLS_LIST.length && jobs.every((j) => j.kind === 'commit' && j.schoolId && j.key === `commit:${j.schoolId}`));
  t('commit queries carry commit terms and a football context', jobs.every((j) => /committed/.test(j.query) && /football/.test(j.query) && /decommit/.test(j.query)));
  t('commit queries stay a sane length', Math.max(...jobs.map((j) => j.query.length)) < 600);
  const due0 = commitJobsDue({ watermarks: {} }, Date.parse('2026-11-10T12:00:00Z'));
  t('every commit search is due on a cold ledger', due0.length === jobs.length);
  const marks = { 'commit:alabama': { at: '2026-11-10T08:00:00Z' }, 'commit:georgia': { at: '2026-11-09T08:00:00Z' }, 'commit:lsu': { at: '2026-11-10T08:00:00Z', window: { completed: false } } };
  const due1 = commitJobsDue({ watermarks: marks }, Date.parse('2026-11-10T12:00:00Z'), 12);
  t('a recently swept commit search waits for its interval', !due1.some((j) => j.schoolId === 'alabama') && due1.some((j) => j.schoolId === 'georgia'));
  t('an unfinished commit window is never made to wait', due1.some((j) => j.schoolId === 'lsu'));
  const live = Array.from({ length: 12 }, (_, i) => ({ key: `L${i}`, kind: 'school', priority: 1 }));
  const com = Array.from({ length: 12 }, (_, i) => ({ key: `C${i}`, kind: 'commit', priority: 1 }));
  const m = {};
  for (const c of com) m[c.key] = { at: '2026-11-09T00:00:00Z' };
  for (const l of live) m[l.key] = { at: '2026-11-10T11:00:00Z' };
  const order = prioritizeJobs([...com, ...live], m, 0.25, 0.2);
  const first12 = order.slice(0, 12);
  t('older commit searches cannot starve the offer searches', first12.filter((j) => j.kind === 'school').length >= 8 && first12.some((j) => j.kind === 'commit'), first12.map((j) => j.key).join(','));
  t('every job is still scheduled exactly once', order.length === 24 && new Set(order.map((j) => j.key)).size === 24);
}

console.log(`\n${pass} passed, ${fail} failed`);

console.log('official football account self-announcement');
{
  const [p] = prefilter([{
    id: 'official-tag-context', author: 'jujudagre8', authorName: 'Juvon Smith',
    authorBio: 'C/O 2028 Athlete | 5-10 175 | Manvel HS',
    text: 'After a great conversation with @_ArmaniLinton I have received another offer thank you @KStateFB. Extremely blessed!!!',
    mentions: ['_armanilinton', 'kstatefb'], createdAt: '2026-08-29T17:06:15Z',
  }]);
  const recs = rulesOnlyOffers(p);
  t('official football-account tag rescues athlete-only self-announcement',
    recs.length === 1 && recs[0].school_id === 'kansas-state' && recs[0].class_year === 2028 && recs[0].position === null,
    JSON.stringify(recs));
}process.exit(fail ? 1 : 0);
