const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const SITE = process.env.NETLIFY_SITE_ID;
if (!TOKEN || !SITE) {
  console.error('NETLIFY_AUTH_TOKEN / NETLIFY_SITE_ID not set.');
  process.exit(1);
}

const before = await fetch(`https://api.netlify.com/api/v1/sites/${SITE}`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
}).then((r) => r.json());
console.log(`before: repo_url=${before.build_settings?.repo_url || '(none)'}`);

if (!before.build_settings?.repo_url) {
  console.log('already unlinked — nothing to do.');
  process.exit(0);
}

const res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ build_settings: { stop_builds: true } }),
});
console.log(`stop_builds request: HTTP ${res.status}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const after = await fetch(`https://api.netlify.com/api/v1/sites/${SITE}`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
}).then((r) => r.json());
console.log(`after: stop_builds=${after.build_settings?.stop_builds} repo_url=${after.build_settings?.repo_url || '(none)'}`);
console.log(after.build_settings?.stop_builds ? 'OK: builds are stopped on this site' : 'FAILED: stop_builds did not take');
