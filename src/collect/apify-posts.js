function normalizePost(row) {
  const url = [row?.url, row?.twitterUrl, row?.link].find(value => typeof value === 'string') || '';
  const path = url.match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([a-z0-9_]{1,15})\/status\/(\d+)/i);
  const id = [row?.id, row?.id_str, row?.tweetId, row?.tweet_id, path?.[2]].find(value => typeof value === 'string' && /^\d+$/.test(value));
  const author = row?.author || row?.user || {};
  const handle = [author.userName, author.username, author.screen_name, row?.authorUsername, row?.username, path?.[1]]
    .find(value => typeof value === 'string' && /^@?[a-z0-9_]{1,15}$/i.test(value))?.replace(/^@/, '').toLowerCase();
  const text = [row?.noteTweet?.text, row?.fullText, row?.full_text, row?.text, row?.snippet, row?.content]
    .find(value => typeof value === 'string' && value.trim());
  if (!id || !handle || !text) return null;

  const at = Date.parse(row.createdAt || row.created_at || row.createdUtc || row.date || '');
  const time = Number.isFinite(at) ? at : Number((BigInt(id) >> 22n) + 1288834974657n);
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return null;
  const entities = row.entities || {};
  const mentioned = new Map();
  const entityMentions = entities.user_mentions || entities.userMentions;
  for (const entry of [...(Array.isArray(entityMentions) ? entityMentions : []), ...(Array.isArray(row.mentions) ? row.mentions : [])]) {
    const name = typeof entry === 'string' ? entry : entry?.screen_name || entry?.username || entry?.userName;
    if (/^@?[a-z0-9_]{1,15}$/i.test(name || '')) mentioned.set(name.replace(/^@/, '').toLowerCase(), entry?.name || null);
  }
  for (const match of text.matchAll(/@([a-z0-9_]{1,15})\b/gi)) {
    const name = match[1].toLowerCase();
    if (!mentioned.has(name)) mentioned.set(name, null);
  }
  const fields = (items, key) => (Array.isArray(items) ? items.map(item => typeof item === 'string' ? item : item?.[key]).filter(Boolean) : []);

  return {
    id, text, author: handle, authorName: author.name || author.displayName || row.authorName || '',
    authorBio: author.profile_bio?.description || author.description || author.bio || null,
    authorLocation: author.location || null, authorFollowers: author.followers ?? author.followersCount ?? row.authorFollowers ?? null,
    authorVerified: !!(author.isBlueVerified || author.verified || author.isVerified || row.authorVerified),
    createdAt: date.toISOString(), mentions: [...mentioned.keys()], mentioned: [...mentioned].map(([handle, name]) => ({ handle, name })),
    hashtags: fields(entities.hashtags || row.hashtags, 'text'), links: fields(entities.urls || row.links, 'expanded_url'),
    hasMedia: !!(row.media?.length || row.extendedEntities?.media?.length || entities.media?.length),
    isRetweet: !!(row.isRetweet || row.is_retweet || /^RT @/.test(text)),
    url: `https://x.com/${handle}/status/${id}`, source: 'x', via: 'apify:search',
  };
}

export function normalizeApifyPosts(rows) {
  if (!Array.isArray(rows)) throw new Error('An Apify JSON export must be an array of posts');
  const unique = new Map();
  for (const row of rows.flatMap(row => Array.isArray(row?.tweets) ? row.tweets : [row])) {
    const post = normalizePost(row);
    if (!post) continue;
    const previous = unique.get(post.id);
    if (!previous) {
      unique.set(post.id, post);
      continue;
    }
    const content = post.text.length > previous.text.length ? post : previous;
    const profile = previous.authorBio ? previous : post;
    const mentioned = new Map(previous.mentioned.map((entry) => [entry.handle, entry]));
    for (const entry of post.mentioned) {
      if (!mentioned.has(entry.handle) || entry.name && !mentioned.get(entry.handle).name) mentioned.set(entry.handle, entry);
    }
    unique.set(post.id, { ...content, authorName: profile.authorName || content.authorName,
      authorBio: profile.authorBio, authorLocation: profile.authorLocation || content.authorLocation,
      mentions: [...mentioned.keys()], mentioned: [...mentioned.values()],
      hasMedia: previous.hasMedia || post.hasMedia });
  }
  return [...unique.values()];
}
