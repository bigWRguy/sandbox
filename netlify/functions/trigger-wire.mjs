const API = 'https://api.github.com/repos/bigWRguy/sandbox';
const RECENT_MS = 10 * 60 * 1000;

export async function dispatchWire({
  token = process.env.GITHUB_DISPATCH_TOKEN,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (!token) return { ok: true, skipped: 'missing GITHUB_DISPATCH_TOKEN' };

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const runsResponse = await fetchImpl(
    API + '/actions/workflows/wire.yml/runs?per_page=5',
    { headers },
  );
  if (!runsResponse.ok) {
    throw new Error('GitHub runs check failed: ' + runsResponse.status + ' ' + await runsResponse.text());
  }

  const runs = (await runsResponse.json()).workflow_runs || [];
  const recent = runs.find((run) =>
    Number.isFinite(Date.parse(run.created_at)) && now - Date.parse(run.created_at) < RECENT_MS);
  if (recent) {
    return { ok: true, skipped: 'recent run exists', runId: recent.id, status: recent.status };
  }

  const dispatchResponse = await fetchImpl(
    API + '/actions/workflows/wire.yml/dispatches',
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    },
  );
  if (!dispatchResponse.ok) {
    throw new Error('GitHub dispatch failed: ' + dispatchResponse.status + ' ' + await dispatchResponse.text());
  }
  return { ok: true, dispatched: true };
}

// HARD KILL 2026-09-23: this function was firing every 15 min and dispatching
// wire.yml on GitHub, which triggered git-linked Netlify build attempts that
// billed real money even when instantly canceled. Schedule removed so Netlify
// stops invoking this at all. wire.yml itself now also refuses to run without
// an explicit confirm_kill_switch=YES input, so this is inert even if called.
export default async () => Response.json({ ok: true, disabled: 'kill switch 2026-09-23' });
