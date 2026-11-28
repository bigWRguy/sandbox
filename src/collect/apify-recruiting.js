import { setTimeout as sleep } from 'node:timers/promises';
import { normalizeApifyPosts } from './apify-posts.js';

const API = 'https://api.apify.com/v2';
const ACTOR = 'Z5bVbtCKG1DTk1oVb';
const HOUR = 3600e3;
const OVERLAP = 15 * 60e3;
const RETRY_WINDOW = 30 * 60e3;
const MAX_BACKFILL_AGE = 96 * HOUR;
const MAX_ITEMS_PER_QUERY = 80;
const ITEM_PRICE = 150;
// Keep hourly runs below $0.14 per UTC day, or $4.34 per 31 days.
const DAILY_CREDITS = 140_000;
const RUN_CREDITS = 14_400;
const TO_USD = 1_000_000;
const OFFER = '("blessed to receive" OR "blessed to have received" OR "thankful to receive" OR "blessed to say" OR "bless to have received" OR "honored to receive" OR "received my" OR "grateful to receive" OR "blessed to announce" OR "excited to receive" OR "humbled to receive") (offer OR offered)';
const COMMIT = '("my commitment to" OR "commitment from" OR "has committed to" OR "decommits from" OR "decommitted from" OR "flipped to" OR "decommitting from" OR "reopened his recruitment" OR "reopened my recruitment" OR "committed go army")';
const REPORTED_OFFER = '("football offers" OR "football offered" OR "picks up an offer" OR "was offered by" OR "has been offered by" OR "has picked up an offer" OR "extends an offer" OR "is offered by" OR "recently offered by" OR "after receiving an offer")';

export function apifySearchWindow(now, prior = {}) {
  const lastAttempt = Date.parse(prior.at);
  if (Math.floor(lastAttempt / HOUR) === Math.floor(+now / HOUR)) return null;
  const budgetDay = now.toISOString().slice(0, 10);
  const used = prior.budgetDay === budgetDay ? prior.used || 0 : 0;
  const allowance = Math.min(RUN_CREDITS, DAILY_CREDITS - used);
  if (allowance < ITEM_PRICE) return null;
  const through = Date.parse(prior.through || prior.lastSuccessAt);
  const start = +now - HOUR - OVERLAP;
  const from = Number.isFinite(through) ? Math.max(start, Math.min(through, +now - 1) - OVERLAP) : start;
  return { from: new Date(from), to: now, budgetDay, used, allowance };
}

export function apifySpend(window, usageUsd) {
  const measured = Number.isFinite(usageUsd) && usageUsd >= 0 ? Math.ceil(usageUsd * TO_USD) : window.allowance;
  return { budgetDay: window.budgetDay, used: window.used + measured };
}

export async function collectApifyRecruiting({ token, window, prior = {}, fetchImpl = fetch }) {
  const through = Date.parse(prior.through || prior.lastSuccessAt);
  const gaps = [...(prior.gaps || [])];
  const addGap = (from, to) => {
    const last = gaps.at(-1);
    if (last && last.from <= from && last.to >= from) gaps[gaps.length - 1] = { ...last, to: Math.max(last.to, to) };
    else gaps.push({ from, to });
  };
  if (through < +window.from) addGap(through, +window.from);
  let expiredThrough = prior.expiredThrough || null;
  const oldest = +window.to - MAX_BACKFILL_AGE;
  while (gaps[0]?.from < oldest) {
    expiredThrough = new Date(Math.min(gaps[0].to, oldest)).toISOString();
    if (gaps[0].to > oldest) {
      gaps[0] = { from: oldest, to: gaps[0].to };
      break;
    }
    gaps.shift();
  }
  let spend = apifySpend(window, 0);
  const posts = new Map();
  const attempt = async (from, to, allowance) => {
    try {
      const result = await fetchApifyRecruiting({ token, from: new Date(from), to: new Date(to), allowance, fetchImpl });
      spend = apifySpend({ ...spend, allowance }, result.health.cost);
      for (const post of result.posts) posts.set(post.id, post);
      return result.health;
    } catch (error) {
      spend = apifySpend({ ...spend, allowance });
      return { error: error.message };
    }
  };
  const live = await attempt(+window.from, +window.to, window.allowance);
  if (live.error || live.atLimit) addGap(+window.from, +window.to);

  const retry = gaps[0];
  const retryAllowance = Math.min(RUN_CREDITS, window.used + window.allowance - spend.used);
  let backfill;
  if (!live.error && !live.atLimit && retry && retryAllowance >= ITEM_PRICE) {
    const to = Math.min(retry.to, retry.from + (retry.span || RETRY_WINDOW));
    backfill = await attempt(retry.from, to, retryAllowance);
    if (!backfill.error && !backfill.atLimit) {
      if (to === retry.to) gaps.shift();
      else gaps[0] = { from: to, to: retry.to };
    } else if (backfill.atLimit && to - retry.from > 5 * 60e3) {
      gaps[0] = { ...retry, span: Math.max(5 * 60e3, Math.floor((to - retry.from) / 2)) };
    }
  }

  return { posts: [...posts.values()], state: { ...live, ...spend, at: window.to.toISOString(),
    through: window.to.toISOString(), gaps, expiredThrough, ...(backfill ? { backfill } : {}) } };
}

export async function fetchApifyRecruiting({ token, from, to, allowance, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${token}` };
  const request = async (route, body) => {
    const options = body ? { method: 'POST', body: JSON.stringify(body), headers: { ...headers, 'Content-Type': 'application/json' } } : { headers };
    const response = await fetchImpl(API + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(65_000) });
    if (!response.ok) throw new Error(`Apify HTTP ${response.status}`);
    return response.json();
  };

  const { data: account } = await request('/users/me');
  if (!account?.plan || !(account.plan.tier === 'FREE' || /^free$/i.test(account.plan.id || ''))
    || account.isPaying === true || account.plan.monthlyBasePriceUsd !== 0) {
    throw new Error('Apify Free plan could not be verified');
  }
  const { data: usage } = await request('/users/me/limits');
  const monthlySpend = usage?.current?.monthlyUsageUsd;
  if (!Number.isFinite(monthlySpend) || monthlySpend < 0) throw new Error('Apify monthly usage could not be verified');
  const remaining = Math.floor((4.65 - monthlySpend) * TO_USD);
  const credits = Math.min(allowance, remaining);
  if (credits < ITEM_PRICE) throw new Error('Apify monthly collection budget reached');

  const seconds = (date) => Math.floor(+date / 1000);
  const query = (term, start, end) => `${term} -filter:retweets -"transfer portal" since_time:${seconds(start)} until_time:${seconds(end)}`;
  const year = to.getUTCFullYear();
  const context = `(football OR ${year + 1} OR ${year + 2} OR ${year + 3} OR ${year + 4} OR QB OR LB OR CB OR ATH OR RB OR OT OR "go army")`;
  const reporterContext = `(${year + 1} OR ${year + 2} OR ${year + 3} OR ${year + 4} OR JUCO OR "high school")`;
  const middle = new Date((+from + +to) / 2);
  const input = { mode: 'searchTweets', searchCategory: 'Latest', maxItems: MAX_ITEMS_PER_QUERY, maxPages: 7,
    searchQueries: [query(OFFER, from, middle), query(OFFER, middle, to), query(`${COMMIT} ${context}`, from, to),
      query(`${REPORTED_OFFER} ${reporterContext}`, from, to)] };
  const params = new URLSearchParams({ maxTotalChargeUsd: credits / TO_USD, timeout: 120, waitForFinish: 55 });
  let { data: run } = await request(`/actors/${ACTOR}/runs?${params}`, input);
  const active = new Set(['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING']);
  const deadline = Date.now() + 90_000;
  while (active.has(run?.status) && Date.now() < deadline) {
    await sleep(3000);
    ({ data: run } = await request(`/actor-runs/${encodeURIComponent(run.id)}`));
  }
  if (run?.status !== 'SUCCEEDED' || !run.defaultDatasetId) throw new Error(`Apify run ended with status ${run?.status || 'unknown'}`);
  const rows = await request(`/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?format=json`);
  const posts = normalizeApifyPosts(rows).filter((post) => {
    const at = Date.parse(post.createdAt);
    return at >= +from && at < +to;
  });
  const cost = run.usageTotalUsd ?? null;
  const rowsByQuery = new Map();
  for (const row of rows) if (typeof row?.input === 'string') rowsByQuery.set(row.input, (rowsByQuery.get(row.input) || 0) + 1);
  const queryLimit = [...rowsByQuery.values()].some(count => count >= MAX_ITEMS_PER_QUERY);
  return { posts, health: { records: posts.length, from: from.toISOString(), to: to.toISOString(), cost,
    atLimit: queryLimit || !Number.isFinite(cost) || Math.round(cost * TO_USD) >= credits - ITEM_PRICE,
    excludedRows: rows.length - posts.length } };
}
