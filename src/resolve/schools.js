import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, decodeEntities } from '../lib/store.js';

export const norm = (s) => (s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ').trim();

function loadTsv() {
  const raw = fs.readFileSync(path.join(CONFIG, 'fbs.tsv'), 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => {
    const [id, name, nickname, handle, conf, extra] = line.split('\t');
    return {
      id, name, nickname, handle, conference: conf,
      aliases: (extra || '').split(';').map((s) => s.trim()).filter(Boolean),
    };
  });
}

export const SCHOOLS = loadTsv();
export const byId = new Map(SCHOOLS.map((s) => [s.id, s]));

const AMBIGUOUS = {
  tigers: ['lsu', 'auburn', 'clemson', 'missouri', 'memphis'],
  bulldogs: ['georgia', 'mississippi-state', 'fresno-state', 'louisiana-tech'],
  wildcats: ['kentucky', 'kansas-state', 'arizona', 'northwestern'],
  cougars: ['byu', 'houston', 'washington-state'],
  huskies: ['washington', 'uconn', 'northern-illinois'],
  aggies: ['texas-am', 'utah-state', 'new-mexico-state'],
  cardinals: ['louisville', 'ball-state'],
  spartans: ['michigan-state', 'san-jose-state'],
  panthers: ['pittsburgh', 'florida-international', 'georgia-state'],
  eagles: ['boston-college', 'georgia-southern', 'eastern-michigan'],
  owls: ['temple', 'rice', 'florida-atlantic', 'kennesaw-state'],
  rebels: ['ole-miss', 'unlv'],
  falcons: ['air-force', 'bowling-green'],
  broncos: ['boise-state', 'western-michigan'],
  cowboys: ['oklahoma-state', 'wyoming'],
  rams: ['colorado-state'],
  usc: ['usc', 'south-carolina'],
  osu: ['ohio-state', 'oklahoma-state', 'oregon-state'],
  msu: ['michigan-state', 'mississippi-state', 'missouri-state'],
  uw: ['washington', 'wisconsin', 'wyoming'],
  miami: ['miami', 'miami-oh'],
  ul: ['louisiana', 'louisiana-monroe'],
  ku: ['kansas'],
  nu: ['nebraska', 'northwestern'],
  ua: ['alabama', 'arizona'],
  um: ['michigan', 'miami'],
  cu: ['clemson', 'colorado'],
  tu: ['temple', 'tulsa'],
  ut: ['tennessee', 'texas'],
  ou: ['oklahoma', 'ohio'],
};

const forms = new Map();
const add = (form, id) => {
  const k = norm(form);
  if (!k || k.length < 2) return;
  if (!forms.has(k)) forms.set(k, new Set());
  forms.get(k).add(id);
};
for (const s of SCHOOLS) {
  add(s.name, s.id);
  add(`${s.name} ${s.nickname}`, s.id);
  add(s.handle, s.id);
  s.aliases.forEach((a) => {
    add(a, s.id);
    add(`${a} university`, s.id);
    add(`university of ${a}`, s.id);
  });
  add(`university of ${s.name}`, s.id);
  add(`${s.name} university`, s.id);
  add(s.nickname, s.id);
}
for (const [form, ids] of Object.entries(AMBIGUOUS)) {
  if (!forms.has(form)) forms.set(form, new Set());
  ids.forEach((i) => forms.get(form).add(i));
}

const FULL_NAME_FORMS = new Set();
for (const s2 of SCHOOLS) {
  for (const f of [s2.name, `${s2.name} university`, `university of ${s2.name}`, `${s2.name} ${s2.nickname}`, ...s2.aliases, ...s2.aliases.flatMap((a) => [`${a} university`, `university of ${a}`])]) {
    const k = norm(f);
    if (k && k !== norm(s2.nickname)) FULL_NAME_FORMS.add(k);
  }
}

const WRAPPED_LINE = /([A-Za-z&]+)[ \t]*\r?\n[ \t]*([A-Za-z&]+(?:[ \t]+[A-Za-z&]+){0,2})/g;

export function joinWrappedNames(text) {
  return String(text || '').replace(WRAPPED_LINE, (m, a, rest) => {
    const words = rest.split(/[ \t]+/);
    for (let n = words.length; n >= 1; n--) {
      const ids = forms.get(norm(`${a} ${words.slice(0, n).join(' ')}`));
      if (!ids) continue;
      const alone = forms.get(norm(a));
      if (!alone || ![...ids].every((i) => alone.has(i))) return `${a} ${rest}`;
    }
    return m;
  });
}

export const HANDLES = new Map(SCHOOLS.map((s) => [s.handle.toLowerCase(), s.id]));

const FORM_LIST = [...forms.keys()].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);

const INSTITUTION_WORD = new Set(['university', 'universities', 'college', 'colleges', 'school', 'schools',
  'institute', 'institutes', 'academy', 'academies', 'seminary', 'conservatory', 'polytechnic',
  'community', 'junior', 'state', 'tech', 'technical', 'technological', 'prep', 'preparatory', 'cc', 'jc']);

const GENERIC_TAIL = new Set(['university', 'univ', 'the', 'of', 'at', 'football', 'fb', 'athletics',
  'athletic', 'program', 'staff', 'recruiting', 'sports', 'mens', 'womens', 'men', 'women',
  'department', 'edu', 'u']);

const QUALIFIER_PREFIX = new Set(['north', 'south', 'east', 'west', 'central', 'northern', 'southern',
  'eastern', 'western', 'northeastern', 'northwestern', 'southeastern', 'southwestern',
  'northwest', 'northeast', 'southwest', 'southeast', 'upper', 'lower', 'greater', 'saint', 'st',
  'mount', 'mt']);

const MODIFIER_SUFFIX = new Set(['christian', 'baptist', 'lutheran', 'wesleyan', 'methodist',
  'catholic', 'adventist', 'bible', 'biblical', 'mennonite', 'nazarene', 'brethren',
  'evangelical', 'theological', 'presbyterian', 'episcopal', 'hebrew', 'islamic',
  'military', 'maritime', 'valley', 'highlands']);

const MASCOT = new Set([
  ...SCHOOLS.flatMap((s) => norm(s.nickname).split(' ')),
  'knights', 'spiders', 'rays', 'huskies', 'crusaders', 'saints', 'warriors', 'chargers',
  'titans', 'vikings', 'pirates', 'raiders', 'lions', 'bears', 'wolves', 'wolverines',
  'hornets', 'jackets', 'gators', 'colonels', 'generals', 'patriots', 'pioneers', 'blazers',
  'bison', 'bobcats', 'braves', 'bruins', 'chiefs', 'comets', 'cyclones', 'demons', 'dragons',
  'dukes', 'explorers', 'flames', 'foxes', 'gaels', 'greyhounds', 'griffins', 'hawks',
  'highlanders', 'jaguars', 'lancers', 'leopards', 'lumberjacks', 'mavericks', 'monarchs',
  'mustangs', 'thunder', 'penguins', 'phoenix', 'ravens', 'rebels', 'roadrunners', 'royals',
  'scots', 'seahawks', 'sharks', 'stallions', 'stars', 'storm', 'thunderbirds', 'tornadoes',
  'trojans', 'vandals', 'vipers', 'yellowjackets', 'elite', 'select',
]);

function ownVocabulary(form) {
  const out = new Set();
  for (const id of forms.get(form) || []) {
    const s = byId.get(id);
    if (!s) continue;
    for (const v of [s.name, s.nickname, s.handle, ...s.aliases]) norm(v).split(' ').forEach((w) => out.add(w));
  }
  return out;
}

const BRANCH_JOIN = new Set(['at', 'in', 'of']);

const CONNECTOR = new Set(['of', 'at', 'the', '&']);

const TRIMMABLE_TAIL = new Set(['university', 'college', 'colleges', 'institute', 'academy',
  'seminary', 'community', 'junior', 'the', 'of', 'at', 'and']);

const NON_FBS = new Map();
let NON_FBS_MAX = 0;
try {
  const txt = fs.readFileSync(path.join(CONFIG, 'non-fbs.txt'), 'utf8');
  for (const line of txt.split('\n')) {
    const name = line.trim();
    if (!name || name.startsWith('#')) continue;
    const n = norm(name);
    const variants = [n];
    const head = n.split(' ');
    while (head.length > 2 && ['the', 'university', 'college', 'of', 'at'].includes(head[0])) {
      head.shift();
      const v = head.join(' ');
      if (head.length >= 2 && !forms.has(v) && !isFbsInstitutionName(v)) variants.push(v);
    }
    const t = n.split(' ');
    while (t.length > 2 && TRIMMABLE_TAIL.has(t[t.length - 1])) {
      t.pop();
      const v = t.join(' ');
      if (!forms.has(v) && !isFbsInstitutionName(v)) variants.push(v);
    }
    for (const v of variants) {
      const len = v.split(' ').length;
      if (len < 2) continue;
      if (!NON_FBS.has(v)) NON_FBS.set(v, name);
      if (len > NON_FBS_MAX) NON_FBS_MAX = len;
    }
  }
} catch {  }

export const nonFbsRosterSize = () => NON_FBS.size;

function longestNonFbsSpan(tokens) {
  for (let len = Math.min(tokens.length, NON_FBS_MAX); len >= 2; len--) {
    for (let s = 0; s + len <= tokens.length; s++) {
      const hit = NON_FBS.get(tokens.slice(s, s + len).join(' '));
      if (hit) return { name: hit, s, e: s + len };
    }
  }
  return null;
}

export function namePhrases(raw) {
  const src = String(raw || '');
  const toks = [];
  for (const m of src.matchAll(/&|[A-Za-z][A-Za-z0-9&'’.]*(?:[-–][A-Za-z0-9&'’.]+)*/g)) {
    toks.push({ t: m[0], i: m.index, e: m.index + m[0].length });
  }
  const out = [];
  let cur = [];
  const flush = () => {
    while (cur.length && CONNECTOR.has(cur[cur.length - 1].t.toLowerCase())) cur.pop();
    if (cur.length) out.push({ start: cur[0].i, end: cur[cur.length - 1].e, text: src.slice(cur[0].i, cur[cur.length - 1].e) });
    cur = [];
  };
  for (let k = 0; k < toks.length; k++) {
    const joined = k > 0 && /^[ \t]*(?:[-–—][ \t]*)?$/.test(src.slice(toks[k - 1].e, toks[k].i));
    if (!joined) flush();
    const t = toks[k].t;
    const endsSentence = /\.$/.test(t) && t.replace(/\.+$/, '').length > 2;
    if (/^[A-Z]/.test(t)) { cur.push(toks[k]); if (endsSentence) flush(); continue; }
    else if (cur.length && (CONNECTOR.has(t.toLowerCase()) || INSTITUTION_WORD.has(t.toLowerCase()))) cur.push(toks[k]);
    else flush();
  }
  flush();
  return out;
}

function longestFormSpan(tokens) {
  for (let len = Math.min(tokens.length, 7); len >= 1; len--) {
    for (let s = 0; s + len <= tokens.length; s++) {
      const f = tokens.slice(s, s + len).join(' ');
      if (forms.has(f)) return { s, e: s + len, form: f };
    }
  }
  return null;
}

function foreignByShape(tokens, best, dashStarts = new Set()) {
  const before = tokens[best.s - 1];
  if (before && QUALIFIER_PREFIX.has(before)) return 'qualifier';
  if (before === 'of' && best.s >= 2 && INSTITUTION_WORD.has(tokens[best.s - 2]) && tokens[best.s - 2] !== 'university') {
    return 'head';
  }
  if (before && INSTITUTION_WORD.has(before)) return 'campus';

  let after = tokens.slice(best.e);
  const stop = after.findIndex((t) => SENTENCE_WORDS.has(t));
  if (stop >= 0) after = after.slice(0, stop);
  if (!after.length) return null;
  if (MODIFIER_SUFFIX.has(after[0])) return 'modifier';
  if (MASCOT.has(after[0]) && !ownVocabulary(best.form).has(after[0])) return 'mascot';
  let lastKw = -1;
  after.forEach((t, i) => { if (INSTITUTION_WORD.has(t)) lastKw = i; });
  if (lastKw >= 0) return after.slice(0, lastKw + 1).some((t) => !GENERIC_TAIL.has(t)) ? 'suffix' : null;
  if (BRANCH_JOIN.has(after[0]) && after.some((t) => !GENERIC_TAIL.has(t))) return 'branch';
  if (QUALIFIER_PREFIX.has(after[0])) return 'branch';
  if (dashStarts.has(best.e) && after.some((t) => !GENERIC_TAIL.has(t))) return 'branch';
  return null;
}

const SENTENCE_WORDS = new Set(['thank', 'thanks', 'you', 'for', 'and', 'via', 'with', 'to', 'i', 'im', 'is', 'was',
  'my', 'blessed', 'grateful', 'coach', 'coaches', 'after', 'from', 'by', 'on', 'will', 'can', 'all', 'god',
  'glory', 'excited', 'honored', 'humbled', 'agtg', 'looking', 'forward', 'huge', 'big', 'so', 'much', 'a',
  'an', 'this', 'that', 'it', 'we', 'our', 'am', 'are', 'be', 'been', 'have', 'has', 'had', 'what', 'when']);

const NAME_END = /https?:\/\/|[@#!?‼|]|\p{Extended_Pictographic}/u;

function tokenizePhrase(phrase) {
  const tokens = [];
  const dashStarts = new Set();
  const segs = String(phrase || '').split(NAME_END)[0].split(/\s*[-–—]\s*/);
  segs.forEach((seg, i) => {
    const t = norm(seg).split(' ').filter(Boolean);
    if (i > 0 && t.length) dashStarts.add(tokens.length);
    tokens.push(...t);
  });
  return { tokens, dashStarts };
}

export function foreignInstitution(phrase) {
  const { tokens, dashStarts } = tokenizePhrase(phrase);
  const best = longestFormSpan(tokens);
  const known = longestNonFbsSpan(tokens);
  if (known && (!best || known.e - known.s > best.e - best.s)) return { name: known.name, why: 'roster' };
  if (!best) return null;
  const why = foreignByShape(tokens, best, dashStarts);
  return why ? { name: best.form, why } : null;
}

export function isFbsInstitutionName(name) {
  const tokens = norm(name).split(' ').filter(Boolean);
  const best = longestFormSpan(tokens);
  if (!best) return false;
  return [...tokens.slice(0, best.s), ...tokens.slice(best.e)].every((t) => GENERIC_TAIL.has(t));
}

function stripForeignInstitutions(raw) {
  let out = String(raw || '');
  for (const p of namePhrases(out)) {
    if (foreignInstitution(p.text)) out = out.slice(0, p.start) + ' '.repeat(p.end - p.start) + out.slice(p.end);
  }
  return out;
}

const WEAK_SURFACE = new Set(['tech', 'wake', 'app', 'coastal', 'kent', 'cards', 'irish',
  'rockets', 'the u', 'cuse', 'cards', 'hogs', 'horns']);

const POSTAL_CODE = /(,\s*|\(\s*)(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/g;

const OFFER_TARGET_HANDLE = /\b(?:offer|offered|offers|scholarship)\s+(?:from|by)\s+@([A-Za-z0-9_]{2,15})/gi;
function taggedForeignProgram(raw) {
  let foreign = false;
  for (const m of String(raw || '').matchAll(OFFER_TARGET_HANDLE)) {
    if (HANDLES.has(m[1].toLowerCase())) return false;
    foreign = true;
  }
  return foreign;
}

export function findSchools(text) {
  const hits = new Map();
  const raw = decodeEntities(text || '');

  for (const m of raw.matchAll(/@([A-Za-z0-9_]{2,15})/g)) {
    const id = HANDLES.get(m[1].toLowerCase());
    if (id) hits.set(id, { id, surface: '@' + m[1], method: 'handle', confidence: 0.99 });
  }

  const STATE_NAMES = new RegExp("(,\\s*|\\bin\\s+|\\bout\\s+of\\s+[^,]{0,40},\\s*)(?:(?:North|Northern|South|Southern|East|Eastern|West|Western|Central)\\s+)?(Alabama|Arizona|Arkansas|California|Colorado|Connecticut|Florida|Georgia|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Nebraska|Nevada|New Mexico|North Carolina|Ohio|Oklahoma|Oregon|Pennsylvania|South Carolina|Tennessee|Texas|Utah|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\\b(?!\\s*(?:State|Tech|A&M|Football|offer))", 'gi');
  const REGION_USE = new RegExp("(?:(?:North|Northern|South|Southern|East|Eastern|West|Western|Central)\\s+)?(Alabama|Arizona|Arkansas|California|Colorado|Connecticut|Florida|Georgia|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Nebraska|Nevada|New Mexico|North Carolina|Ohio|Oklahoma|Oregon|Pennsylvania|South Carolina|Tennessee|Texas|Utah|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\\s+(?:area|areas|region|regions|universities|colleges|schools|residents|natives?|weather|county|counties|cities)\\b", "gi");
  const CITY_THEN_STATE = new RegExp("\\b(Houston|Miami|Buffalo|Cincinnati|Memphis|Charlotte|Toledo|Akron|Tulsa|Auburn|Boise|Fresno|Reno|Baylor|Rice|Temple|Troy|Duke|Rutgers|Syracuse)\\s*,\\s*(?:Alabama|Arizona|Arkansas|California|Colorado|Florida|Georgia|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Nebraska|Nevada|New York|North Carolina|Ohio|Oklahoma|Oregon|Pennsylvania|South Carolina|Tennessee|Texas|Utah|Virginia|Washington|Wisconsin|[A-Z]{2}\\b)", 'gi');
  const deSchooled = stripForeignInstitutions(raw);
  const deLocated = deSchooled.replace(POSTAL_CODE, (m, pre, code, offset, str) => {
    const prev = (str.slice(Math.max(0, offset - 30), offset).match(/([A-Za-z]+)[^A-Za-z]*$/) || [])[1];
    return prev && forms.has(norm(`${prev} ${code}`)) ? m : pre;
  }).replace(REGION_USE, ' ').replace(CITY_THEN_STATE, ' ').replace(STATE_NAMES, (m, pre, state, offset, str) => {
    const words = str.slice(Math.max(0, offset - 40), offset).trim().replace(/[,;]\s*$/, '').split(/\s+/);
    for (let k = 1; k <= 4 && k <= words.length; k++) {
      if (forms.has(norm(words.slice(-k).join(' ')))) return m;
    }
    return pre + ' ';
  });

  const deHandled = deLocated.replace(/@[A-Za-z0-9_]+/g, ' ');
  let hay = ' ' + norm(deHandled.replace(/#([A-Za-z]+)/g, (_, w) => ' ' + w.replace(/([a-z])([A-Z])/g, '$1 $2') + ' ')) + ' ';
  const consume = (form) => { hay = hay.split(' ' + form + ' ').join('     '); };
  const unbacked = taggedForeignProgram(raw);
  const nameConfidence = (form) => {
    if (WEAK_SURFACE.has(form) || !FULL_NAME_FORMS.has(form)) return 0.8;
    return unbacked ? 0.85 : 0.92;
  };

  for (const form of FORM_LIST) {
    if (!hay.includes(' ' + form + ' ')) continue;
    const ids = [...forms.get(form)];

    if (ids.length === 1) {
      const id = ids[0];
      consume(form);
      if (!hits.has(id)) {
        hits.set(id, { id, surface: form, method: 'name', confidence: nameConfidence(form) });
      }
      continue;
    }

    if (ids.some((i) => hits.has(i))) { consume(form); continue; }

    const alt = ids.filter((i) => {
      const full = norm(byId.get(i).name);
      if (full === form) return false;
      return hay.includes(' ' + full + ' ');
    });

    consume(form);
    if (alt.length === 1) {
      hits.set(alt[0], { id: alt[0], surface: form, method: 'name+context', confidence: 0.85 });
    } else {
      hits.set('?' + form, { id: null, surface: form, candidates: ids, method: 'ambiguous', confidence: 0.4 });
    }
  }
  return [...hits.values()];
}

function containsFbsName(phrase) {
  const n = norm(phrase);
  if (!n) return false;
  const joined = ' ' + n + ' ';
  return FORM_LIST.some((f) => joined.includes(' ' + f + ' '));
}

export function explicitNonFbsOfferTarget(text) {
  const src = decodeEntities(text || '');
  for (const h of src.matchAll(/@([A-Za-z0-9_]{2,15})/g)) if (HANDLES.has(h[1].toLowerCase())) return false;
  const m = src.match(/\b(?:offer|offered|offers|scholarship)\s+(?:to\s+play\s+\w+\s+)?(?:from|by)\s+(?:the\s+)?/i);
  if (!m) return false;
  const at = m.index + m[0].length;
  const rest = src.slice(at);
  const phrase = namePhrases(rest).find((p) => p.start === 0);
  if (!phrase) return false;
  if (foreignInstitution(phrase.text)) return true;
  const tokens = norm(phrase.text).split(' ').filter(Boolean);
  if (!tokens.some((t) => INSTITUTION_WORD.has(t))) return false;
  return !containsFbsName(phrase.text);
}

const WRITTEN_BREAK = new Set(['a', 'an', 'i', 'im', 'ive', 'my', 'me', 'we', 'is', 'was', 'has', 'have', 'had',
  'after', 'before', 'thanks', 'thank', 'coach', 'coaches', 'blessed', 'grateful', 'honored', 'excited',
  'extremely', 'official', 'offer', 'offered', 'offers', 'from', 'to', 'at', 'in', 'on', 'with', 'by', 'for',
  'and', 'or', 'but', 'great', 'visit', 'game', 'day', 'call', 'conversation', 'agtg', 'sec', 'acc', 'big',
  'ten', 'b1g', 'pac', 'mac', 'mwc', 'aac', 'sbc', 'cusa', 'fbs', 'fcs', 'd1', 'div', 'division', 'ncaa',
  'power', 'p4', 'p5', 'g5']);

const WRITTEN_FILLER = new Set(['the', 'of', 'university', 'univ', 'college', 'football', 'fb', 'athletics',
  'athletic', 'program', 'staff', 'recruiting', 'sports', 'edu', 'u', 'and']);

function nearTo(tok, vocab) {
  if (tok.length < 3) return false;
  for (const w of vocab) {
    if (Math.abs(w.length - tok.length) > 1 || w.length < 3) continue;
    let i = 0;
    while (i < tok.length && i < w.length && tok[i] === w[i]) i++;
    const a = tok.slice(i), b = w.slice(i);
    if (a === b) return true;
    if (a.slice(1) === b || a === b.slice(1) || a.slice(1) === b.slice(1)) return true;
    if (a.length > 1 && b.length > 1 && a[0] === b[1] && a[1] === b[0] && a.slice(2) === b.slice(2)) return true;
  }
  return false;
}

function schoolVocabulary(id) {
  const s = byId.get(id);
  const out = new Set();
  if (!s) return out;
  for (const v of [s.name, s.nickname, ...s.aliases]) norm(v).split(' ').forEach((w) => out.add(w));
  return out;
}

export function writtenNameConflict(clause, schoolId) {
  const own = schoolVocabulary(schoolId);
  const known = new Set([...own, ...WRITTEN_FILLER]);
  const src = String(clause || '').replace(/@[A-Za-z0-9_]+/g, ' ').replace(/#[A-Za-z0-9_]+/g, ' ');
  for (const p of namePhrases(src)) {
    if (/\b[A-Za-z]&[TtSs]\b/.test(p.text) && !/\bA&M\b/i.test(p.text)) return p.text.trim();
    const { tokens } = tokenizePhrase(p.text);
    let span = null;
    for (let len = Math.min(tokens.length, 7); len >= 1 && !span; len--) {
      for (let s = 0; s + len <= tokens.length; s++) {
        const f = tokens.slice(s, s + len).join(' ');
        if (forms.get(f)?.has(schoolId)) { span = { s, e: s + len }; break; }
      }
    }
    if (!span) continue;
    const walk = (list) => {
      let seen = 0;
      for (const t of list) {
        if (WRITTEN_BREAK.has(t)) return null;
        if (known.has(t) || nearTo(t, known)) { if (++seen >= 3) return null; continue; }
        if (t.length < 3 || /^\d+$/.test(t)) return null;
        return t;
      }
      return null;
    };
    const bad = walk(tokens.slice(0, span.s).reverse()) || walk(tokens.slice(span.e));
    if (bad) return p.text.trim();
  }
  return null;
}
