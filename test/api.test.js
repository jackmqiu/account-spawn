import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createServer } from '../src/server.js';

const seedFile = fileURLToPath(new URL('../data/seed.json', import.meta.url));
let server;
let base;

before(async () => {
  server = createServer(new Store({ seedFile }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('lists seeded users with summary fields', async () => {
  const { status, body } = await call('/api/users');
  assert.equal(status, 200);
  assert.equal(body.length, 3);
  assert.deepEqual(Object.keys(body[0]).sort(),
    ['displayName', 'id', 'interestCount', 'plan', 'scheduleCount', 'status', 'subredditCount', 'username']);
});

test('searches by subreddit and interest', async () => {
  assert.deepEqual((await call('/api/users?q=boardgames')).body.map((u) => u.username), ['quietfox']);
  assert.deepEqual((await call('/api/users?q=photo')).body.map((u) => u.username), ['kettle_corn']);
});

test('returns full user with account info and both interest lists', async () => {
  const { status, body } = await call('/api/users/u_1');
  assert.equal(status, 200);
  assert.equal(body.account.plan, 'pro');
  assert.ok(body.subredditInterests.some((s) => s.subreddit === 'programming'));
  assert.ok(body.interests.includes('running'));
});

test('404s for an unknown user', async () => {
  assert.equal((await call('/api/users/nope')).status, 404);
});

test('creates a user, edits account info, then deletes it', async () => {
  const created = await call('/api/users', { method: 'POST', body: { username: 'new_one', email: 'n@example.com' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.account.plan, 'free');
  const { id } = created.body;

  const updated = await call(`/api/users/${id}`, { method: 'PATCH', body: { plan: 'team', location: 'Oslo' } });
  assert.equal(updated.body.account.plan, 'team');
  assert.equal(updated.body.account.location, 'Oslo');

  assert.equal((await call(`/api/users/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/users/${id}`)).status, 404);
});

test('rejects invalid input', async () => {
  assert.equal((await call('/api/users', { method: 'POST', body: { username: 'x', email: 'a@b.co' } })).status, 400);
  assert.equal((await call('/api/users', { method: 'POST', body: { username: 'sparrow_dev', email: 'a@b.co' } })).status, 400);
  assert.equal((await call('/api/users/u_1', { method: 'PATCH', body: { plan: 'gold' } })).status, 400);
  assert.equal((await call('/api/users/u_1/subreddits', { method: 'PUT', body: { subreddit: 'ok', score: 101 } })).status, 400);
});

test('adds, updates and removes subreddit interests', async () => {
  let res = await call('/api/users/u_2/subreddits', { method: 'PUT', body: { subreddit: 'r/Baking', score: 99 } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.subredditInterests[0], { subreddit: 'Baking', score: 99 });

  res = await call('/api/users/u_2/subreddits', { method: 'PUT', body: { subreddit: 'baking', score: 10 } });
  assert.equal(res.body.subredditInterests.filter((s) => s.subreddit === 'Baking').length, 1);
  assert.equal(res.body.subredditInterests.at(-1).score, 10);

  res = await call('/api/users/u_2/subreddits/baking', { method: 'DELETE' });
  assert.ok(!res.body.subredditInterests.some((s) => s.subreddit === 'Baking'));
});

test('adds and removes interests without duplicates', async () => {
  await call('/api/users/u_3/interests', { method: 'POST', body: { interest: 'Chess' } });
  const res = await call('/api/users/u_3/interests', { method: 'POST', body: { interest: '  chess ' } });
  assert.equal(res.body.interests.filter((i) => i === 'chess').length, 1);

  const removed = await call('/api/users/u_3/interests/chess', { method: 'DELETE' });
  assert.ok(!removed.body.interests.includes('chess'));
});

test('adds weekly schedule entries in day/time order and removes them', async () => {
  let res = await call('/api/users/u_1/schedule', { method: 'POST', body: { day: 'MON', time: '07:15', action: 'Check r/rust' } });
  assert.equal(res.status, 200);
  const mon = res.body.schedule.filter((e) => e.day === 'mon').map((e) => e.time);
  assert.deepEqual(mon, ['06:30', '07:15', '09:00']);
  const added = res.body.schedule.find((e) => e.action === 'Check r/rust');

  res = await call(`/api/users/u_1/schedule/${added.id}`, { method: 'DELETE' });
  assert.ok(!res.body.schedule.some((e) => e.id === added.id));
  assert.equal((await call(`/api/users/u_1/schedule/${added.id}`, { method: 'DELETE' })).status, 404);
});

test('rejects invalid schedule entries', async () => {
  const post = (body) => call('/api/users/u_1/schedule', { method: 'POST', body });
  assert.equal((await post({ day: 'someday', time: '09:00', action: 'x' })).status, 400);
  assert.equal((await post({ day: 'mon', time: '25:00', action: 'x' })).status, 400);
  assert.equal((await post({ day: 'mon', time: '09:00', action: '  ' })).status, 400);
});

test('serves the frontend and blocks path traversal', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Account Spawn/);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 404);
});
