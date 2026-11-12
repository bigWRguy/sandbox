import { decodeEntities } from '../lib/store.js';

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec';

export const COMMIT_HINT = /\b(?:de-?commit\w*|commit(?:s|ted|ting|ment)?|pledge[sd]?|verbal(?:ly)?|flip(?:s|ped)?|switch(?:es|ed)?|re-?open\w*\s+(?:up\s+)?(?:my|his|her)\s+recruitment)\b/i;

const FUTURE = /\b(?:will|won'?t|gonna|going\s+to|plans?\s+to|planning\s+to|set\s+to|expected\s+to|expects?\s+to|about\s+to|could|might|may|would|should|hopes?\s+to|hoping\s+to|likely\s+to|leans?|leaning|prediction|predicts?|predicted|crystal\s*ball|(?:decision|commitment)\s+(?:date|day|soon|coming|time|announcement)|announc(?:e|es|ing)\s+(?:his|her|my)?\s*(?:decision|commitment)\s+(?:on|at|tomorrow|today|this|next)|commit(?:ting)?\s+(?:on|this|tomorrow|next|at)\b|visit(?:s|ing|ed)?\b|top\s*\d|finalists?)\b/i;

const STALE = new RegExp(String.raw`\b(?:mid|early|late)[-\s]+(?:${MONTHS}|summer|spring|winter|fall)\b|\b(?:this|last)\s+(?:summer|spring|winter|offseason|year|month)\b|\b(?:in|on|back\s+in|during|since|originally)\s+(?:${MONTHS})\b|\b\d+\s+(?:days?|weeks?|months?|years?)\s+ago\b|\bsince\b|\bback\s+in\b|\bearlier\s+this\b|\bover\s+the\s+summer\b|\bprevious(?:ly)?\b|\bformer(?:ly)?\b|\boriginally\b`, 'i');

const STATUS_BEFORE = /\b(?:is|are|was|were|be|been|being|currently|already|still|remains?|remained|previously|formerly|who(?:'s|’s)?|that(?:'s|’s)?|which|once|ever|never|not|until|unless|if|when|whether|should|would|could)\s*(?:\w+\s+){0,2}$/i;
const FIRST_PERSON_BEFORE = /\b(?:i|i'm|i’m|im|i\s+am|am)\s*(?:\w+\s+){0,2}$/i;
const PERFECT_BEFORE = /\b(?:has|have|just|officially|verbally|now|also|had)\s+(?:verbally\s+)?$/i;
const NAME_BEFORE = /\b[A-Z][\p{L}'’.-]+\s+[A-Z][\p{L}'’.-]+(?:\s+(?:Jr\.?|Sr\.?|II|III|IV))?\s*$/u;

const OTHER_SPORT = /\b(?:baseball|softball|basketball|soccer|volleyball|lacrosse|golf|tennis|wrestling|hockey|catcher|pitcher|shortstop|outfielder|rhp|lhp|forward|hoops|nba|pf|sf|sg|pg|point\s+guard|shooting\s+guard|combo\s+guard|swingman)\b/i;

const CUT = /,|;|\s[-–—]\s|\s\|\s|\bover\b|\bafter\b|\bfollowing\b|\bdespite\b|\binstead\s+of\b|\bchoosing\b|\bpicking\b|\bvia\b|\bper\b|\baccording\b|\bahead\s+of\b|\btells?\b|\btoday\b|\btonight\b|\byesterday\b|\bthis\s+(?:week|weekend|morning|afternoon|evening)\b|\bon\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bwith\b|\bwhile\b|\bbut\b|\bas\b|\bwho\b|\band\b|\bthe\s+\d|https?:\/\//i;

const cutClause = (raw) => {
  let s = String(raw || '').trim();
  const m = s.match(CUT);
  if (m && m.index > 0) s = s.slice(0, m.index);
  return s.replace(/\s+/g, ' ').trim();
};

const sentences = (src) => src.split(/(?<=[.!?])\s+(?=[A-Z@#\d✅\u{1F300}-\u{1FAFF}])|\n+/u).map((s) => s.trim()).filter(Boolean);

const FLIP_FROM_TO = /\b(?:flip(?:s|ped|ping)?|switch(?:es|ed|ing)?)\s+(?:(?:his|her|my)\s+)?(?:commitment\s+)?from\s+(.{1,70}?)\s+to\s+(.+)$/i;
const FLIP_TO = /\b(?:flip(?:s|ped|ping)?|switch(?:es|ed|ing)?)\s+(?:(?:his|her|my)\s+)?(?:commitment\s+)?to\s+(.+)$/i;
const DECOMMIT_FROM = /\bde-?commit(?:s|ted|ting|ment)?\s+from\s+(.+)$/i;
const WITHDRAW = /\b(?:withdr[ae]w|withdrawing|pulls?|pulled|backs?\s+off|backed\s+off|walks?\s+away\s+from|steps?\s+away\s+from)\s+(?:(?:his|her|my)\s+)?commitment\s+(?:to|from)\s+(.+)$/i;
const DECOMMIT_BARE = /\b(?:de-?commit(?:s|ted|ting)?|re-?open(?:s|ed|ing)?\s+(?:up\s+)?(?:my|his|her)\s+recruitment)\b/i;
const COMMIT_TO = /\b(?:committed|commits|commit|committing|commitment|pledged|pledges|pledging|verbal(?:ly)?\s+committed)\s+to\s+(.+)$/i;
const LANDS = /\b(?:lands?|landed|secures?|secured|gets?|got|adds?|added|picks?\s+up|picked\s+up|receives?|received|reels?\s+in|reeled\s+in|nabs?|nabbed|snags?|snagged|welcomes?)\s+(?:an?\s+|the\s+|another\s+|its\s+|their\s+)?(?:[\w'’-]+\s+){0,4}?(?:commitment|commit|pledge|verbal)\s+from\b/i;
const BARE_PLAYER = /(?:^\s*(?:#?committed|100%\s*committed|✅\s*committed)|#committed\b|\bcommitted\s*✅|\b(?:i(?:'m|’m|\s+am|'ve|’ve|\s+have)?|im)\s+(?:\w+\s+){0,3}?committed\b|\bmy\s+commitment\b|\bannounc\w*\s+(?:my\s+)?commitment\b)/i;
const STATUS_BARE = /\b(?:remain|remains|remained|still|stay(?:s|ing)?|stick(?:s|ing)?|loyal|forever|always|never)\b[^.!?]{0,30}\bcommit/i;
export const isListPost = (text) => (String(text || '').match(/^\s*(?:[-•*▪]|\d+[.)]|[1-5]\s*(?:⭐|star))/gmu) || []).length >= 2;
const FIRST_PERSON_SENT =/\b(?:i|i'm|i’m|im|i've|i’ve|my|me)\b|^\s*(?:#?committed|100%\s*committed|✅)|#committed|\bcommitted\s*✅/i;
const OFFER_VOICE =/\b(?:blessed\s+to\s+receive|received\s+(?:my|an?)\s+\w*\s*offer|receive\s+(?:my|an?)\s+\w*\s*offer|\d(?:st|nd|rd|th)\s+(?:d1\s+)?offer)\b/i;

export function commitSignals(text, voice) {
  const src = decodeEntities(String(text || '')).replace(/https?:\/\/\S+/g, ' ');
  const out = [];
  for (const [index, sentence] of sentences(src).entries()) {
    if (!COMMIT_HINT.test(sentence)) continue;
    if (FUTURE.test(sentence)) continue;
    if (STALE.test(sentence)) continue;

    const guard = (m, { needsPerfectOrName = false } = {}) => {
      const before = sentence.slice(Math.max(0, m.index - 48), m.index);
      if (STATUS_BEFORE.test(before)) return false;
      if (voice === 'reporter' && FIRST_PERSON_BEFORE.test(before)) return false;
      if (voice === 'reporter' && needsPerfectOrName && !PERFECT_BEFORE.test(before) && !NAME_BEFORE.test(before.replace(/\s*\([^)]*\)\s*$/, ' ').replace(/@\w+/g, ' '))) return false;
      if (voice === 'reporter' && needsPerfectOrName && !PERFECT_BEFORE.test(before) && /\boffer(?:s|ed|ing)?\b/i.test(sentence.slice(0, m.index))) return false;
      if (voice === 'player' && !FIRST_PERSON_SENT.test(sentence)) return false;
      return true;
    };
    const add = (s) => out.push({ ...s, sentence, index });

    let m = sentence.match(FLIP_FROM_TO);
    if (m && guard(m)) { add({ type: 'commit', form: 'object', clause: cutClause(m[2]), from: cutClause(m[1]), flip: true }); continue; }

    const dm = sentence.match(DECOMMIT_FROM) || sentence.match(WITHDRAW);
    const fm = sentence.match(FLIP_TO);
    if (fm && guard(fm)) {
      add({ type: 'commit', form: 'object', clause: cutClause(fm[1]), from: dm ? cutClause(dm[1]) : null, flip: true });
      continue;
    }
    if (dm && guard(dm)) {
      add({ type: 'decommit', form: 'object', clause: cutClause(dm[1]), from: null });
      const tail = sentence.slice(dm.index + dm[0].length - dm[1].length);
      const cm = tail.match(COMMIT_TO);
      if (cm && !/de-?commit/i.test(tail.slice(Math.max(0, cm.index - 3), cm.index + 3)) && guard({ index: dm.index }) ) add({ type: 'commit', form: 'object', clause: cutClause(cm[1]), from: null });
      continue;
    }

    m = sentence.match(DECOMMIT_BARE);
    if (m && guard(m)) { add({ type: 'decommit', form: 'whole', clause: sentence, from: null }); continue; }

    m = sentence.match(COMMIT_TO);
    if (m && guard(m, { needsPerfectOrName: /^committed$/i.test(m[0].split(/\s+/)[0]) })) {
      add({ type: 'commit', form: 'object', clause: cutClause(m[1]), from: null });
      continue;
    }

    m = sentence.match(LANDS);
    if (m) { add({ type: 'commit', form: 'subject', clause: cutClause(sentence.slice(0, m.index)), from: null }); continue; }

    if (voice === 'player' && !OFFER_VOICE.test(sentence) && !STATUS_BARE.test(sentence)) {
      m = sentence.match(BARE_PLAYER);
      if (m && guard({ index: m.index })) add({ type: 'commit', form: 'whole', clause: sentence, from: null });
    }
  }
  return out.slice(0, 3);
}

const POSITION_CODE = /\b(?:QB|RB|WR|TE|OT|OG|OL|IOL|DL|DE|DT|EDGE|LB|ILB|OLB|CB|DB|SAF|ATH)\b/;

export const footballContext = (post, voice) => {
  const text = String(post.text || '');
  const hay = voice === 'player' ? `${text} ${post.authorBio || ''}` : text;
  return /\bfootball\b|🏈|\b(?:QB|RB|WR|TE|OT|OG|OL|IOL|DL|DE|DT|EDGE|LB|ILB|OLB|CB|DB|SAF|ATH)\b|\b(?:quarterback|running back|wide receiver|tight end|linebacker|cornerback|safety|lineman|offensive (?:tackle|guard|lineman)|defensive (?:end|tackle|lineman|back))\b/.test(hay)
    || /@\w*(?:football|fb|ftbl|fball)\b/i.test(text);
};

export const wrongSport = (post) => {
  const text = String(post.text || '');
  if (!OTHER_SPORT.test(text) && !/hoops|basketball/i.test(text)) return false;
  return !POSITION_CODE.test(text);
};

export const wrongLevel = (post) => /\bjuco\b|junior\s+college|community\s+college|\bportal\b|\btransfer(?:s|red|ring)?\b|\bgrad(?:uate)?\s+transfer\b/i.test(post.text || '');

export const isFirstPerson = (text) => /\b(?:i|i'm|i’m|im|i've|i’ve|my|me)\b|^\s*(?:#?committed|100%\s*committed|✅)|#committed/i.test(String(text || ''));
