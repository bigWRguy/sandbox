import { SCHOOLS } from '../resolve/schools.js';

const OFFER = ['offer', 'offers', 'offered'];
const FIRST_PERSON = [
  ...['blessed', 'honored', 'excited', 'humbled'].flatMap((word) =>
    ['receive', 'have received', 'announce'].map((phrase) => `${word} to ${phrase}`)),
  'thankful to receive', 'grateful to receive', 'first offer', 'first D1 offer', 'first Division 1 offer',
  'offer to play football', 'received an offer', 'received my', 'bless to receive', 'blessed to have receive',
  'blessed to be offered', 'grateful to have received',
];
const REPORTED = [
  'has been offered by', 'picks up an offer', 'pick up an offer', 'picked up an offer', 'receives an offer',
  'lands an offer', 'extends an offer', 'extended an offer', 'adds an offer', 'offered by', 'got an offer',
  'new scholarship offer', 'new offer',
];
const COMMIT = ['committed', 'commits', 'commitment', 'decommitted', 'decommits', 'decommitment', 'de-committed', 'flipped', 'reopening my recruitment', 'reopening his recruitment'];
const REPORTED_COMMIT = [
  'committed to', 'commits to', 'flipped to', 'has committed', 'commitment from', 'decommitted from',
  'decommits from', 'flipped his commitment', 'flipped my commitment', 'recruitment is officially open',
];
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'DB', 'LB', 'CB', 'OT', 'EDGE', 'ATH', 'IOL'];
const SPECIFIC_COMMIT = [
  ...['committed', 'decommitted'].flatMap((verb) => ['I', 'I am', "I'm", 'I have', "I've"].flatMap((start) =>
    [`${start} ${verb}`, `${start} officially ${verb}`])),
  'I will be committing', 'reopening my recruitment', 'reopening his recruitment', 'decommitted from',
  'flipped my commitment', 'flipped his commitment', 'flips his commitment', 'flips commitment',
];
const schoolTags = SCHOOLS.map(({ handle }) => `@${handle}`);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quote = (term) => /[\s-]/.test(term) ? `"${term}"` : term;

function families(at) {
  const year = at.getUTCFullYear();
  const classes = Array.from({ length: 6 }, (_, offset) => String(year + offset));
  const context = [...classes, 'football', 'recruiting', 'high school', 'prep football'];
  const recruiting = [...context, ...POSITIONS, '5-star', '4-star', '3-star'];
  return [
    { kind: 'offers', groups: [FIRST_PERSON, OFFER] },
    { kind: 'offers', groups: [schoolTags, OFFER] },
    { kind: 'offers', groups: [REPORTED, recruiting] },
    { kind: 'offers', groups: [classes, POSITIONS, OFFER] },
    { kind: 'commitments', groups: [schoolTags, COMMIT] },
    { kind: 'commitments', groups: [SPECIFIC_COMMIT, context, COMMIT] },
    { kind: 'commitments', groups: [REPORTED_COMMIT, recruiting] },
  ];
}

export function focusedSearchInput(start, end, maxItems) {
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || +start >= +end) throw new Error('Invalid search time window');
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) throw new Error('A maximum result count is required');
  const suffix = ` -filter:retweets -"transfer portal" since_time:${Math.floor(+start / 1000)} until_time:${Math.floor(+end / 1000)}`;
  const clause = (terms) => `(${terms.map(quote).join(' OR ')})`;
  const searchTerms = families(start).flatMap(({ groups: [terms, ...rest] }) => {
    const ending = ` ${rest.map(clause).join(' ')}${suffix}`;
    const result = [];
    let chunk = [];
    for (const term of terms) {
      if (chunk.length && clause([...chunk, term]).length + ending.length > 500) {
        result.push(clause(chunk) + ending);
        chunk = [];
      }
      chunk.push(term);
    }
    result.push(clause(chunk) + ending);
    return result;
  });
  return { searchTerms, sort: 'latest', maxItems };
}

export function focusedSearchMatcher(at) {
  const pattern = (term) => term.startsWith('@') ? `${escape(term)}\\b` : `\\b${escape(term)}\\b`;
  const rules = families(at).map(({ kind, groups }) => ({ kind, tests: groups.map((terms) => new RegExp(terms.map(pattern).join('|'), 'i')) }));
  return (post) => {
    if (post.isRetweet) return [];
    const text = String(post.text || '').replace(/\s+/g, ' ');
    if (/\btransfer portal\b/i.test(text)) return [];
    const joined = text + ' ' + (post.mentions || []).map((handle) => `@${handle}`).join(' ');
    return rules.filter(({ tests }) => tests.every((test) => test.test(joined))).map(({ kind }) => kind);
  };
}
