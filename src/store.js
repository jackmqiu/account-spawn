// JSON-file-backed store for users, their account info, interests, and weekly schedules.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PLANS = ['free', 'pro', 'team'];
export const STATUSES = ['active', 'suspended', 'closed'];
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;
const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(value, field, { max = 200, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${field} is required`);
  if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return trimmed;
}

function oneOf(value, field, allowed) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

// Accepts "r/foo", "/r/foo" or "foo" and returns "foo".
export function normalizeSubreddit(value) {
  const name = str(value, 'subreddit', { max: 30, required: true }).replace(/^\/?r\//i, '');
  if (!SUBREDDIT_RE.test(name)) {
    throw new ValidationError('subreddit must be 2-21 letters, numbers or underscores');
  }
  return name;
}

function normalizeScore(value) {
  if (value === undefined) return 50;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new ValidationError('score must be an integer from 0 to 100');
  return n;
}

function normalizeInterest(value) {
  return str(value, 'interest', { max: 60, required: true }).replace(/\s+/g, ' ').toLowerCase();
}

export class Store {
  constructor({ file, seedFile }) {
    this.file = file;
    if (file && existsSync(file)) {
      this.data = JSON.parse(readFileSync(file, 'utf8'));
    } else {
      this.data = seedFile ? JSON.parse(readFileSync(seedFile, 'utf8')) : { users: [] };
      this.save();
    }
    // Older data files predate the weekly schedule.
    for (const user of this.data.users) user.schedule ??= [];
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  listUsers({ q } = {}) {
    const query = (q || '').trim().toLowerCase();
    return this.data.users
      .filter((u) => !query
        || u.username.toLowerCase().includes(query)
        || u.displayName.toLowerCase().includes(query)
        || u.interests.some((i) => i.includes(query))
        || u.subredditInterests.some((s) => s.subreddit.toLowerCase().includes(query)))
      .map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        plan: u.account.plan,
        status: u.account.status,
        interestCount: u.interests.length,
        subredditCount: u.subredditInterests.length,
        scheduleCount: u.schedule.length,
      }));
  }

  getUser(id) {
    const user = this.data.users.find((u) => u.id === id);
    if (!user) throw new NotFoundError(`user ${id} not found`);
    return user;
  }

  createUser(input = {}) {
    const username = str(input.username, 'username', { max: 32, required: true });
    if (!USERNAME_RE.test(username)) {
      throw new ValidationError('username must be 3-32 letters, numbers, underscores or dashes');
    }
    if (this.data.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw new ValidationError(`username ${username} is taken`);
    }
    const email = str(input.email, 'email', { max: 254, required: true });
    if (!EMAIL_RE.test(email)) throw new ValidationError('email is not valid');

    const user = {
      id: `u_${randomUUID().slice(0, 8)}`,
      username,
      displayName: str(input.displayName, 'displayName', { max: 80 }) || username,
      email,
      createdAt: new Date().toISOString(),
      account: {
        plan: oneOf(input.plan, 'plan', PLANS) || 'free',
        status: 'active',
        location: str(input.location, 'location', { max: 80 }) || '',
        bio: str(input.bio, 'bio', { max: 500 }) || '',
      },
      subredditInterests: [],
      interests: [],
      schedule: [],
    };
    this.data.users.push(user);
    this.save();
    return user;
  }

  updateAccount(id, input = {}) {
    const user = this.getUser(id);
    const displayName = str(input.displayName, 'displayName', { max: 80 });
    const email = str(input.email, 'email', { max: 254 });
    if (email !== undefined && !EMAIL_RE.test(email)) throw new ValidationError('email is not valid');
    const updates = {
      plan: oneOf(input.plan, 'plan', PLANS),
      status: oneOf(input.status, 'status', STATUSES),
      location: str(input.location, 'location', { max: 80 }),
      bio: str(input.bio, 'bio', { max: 500 }),
    };

    if (displayName) user.displayName = displayName;
    if (email) user.email = email;
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) user.account[key] = value;
    }
    this.save();
    return user;
  }

  deleteUser(id) {
    const index = this.data.users.findIndex((u) => u.id === id);
    if (index === -1) throw new NotFoundError(`user ${id} not found`);
    this.data.users.splice(index, 1);
    this.save();
  }

  addInterest(id, value) {
    const user = this.getUser(id);
    const interest = normalizeInterest(value);
    if (!user.interests.includes(interest)) user.interests.push(interest);
    this.save();
    return user;
  }

  removeInterest(id, value) {
    const user = this.getUser(id);
    const interest = normalizeInterest(value);
    user.interests = user.interests.filter((i) => i !== interest);
    this.save();
    return user;
  }

  // Adds a subreddit interest, or updates its score if the user already has it.
  setSubredditInterest(id, { subreddit, score } = {}) {
    const user = this.getUser(id);
    const name = normalizeSubreddit(subreddit);
    const value = normalizeScore(score);
    const existing = user.subredditInterests.find((s) => s.subreddit.toLowerCase() === name.toLowerCase());
    if (existing) existing.score = value;
    else user.subredditInterests.push({ subreddit: name, score: value });
    user.subredditInterests.sort((a, b) => b.score - a.score);
    this.save();
    return user;
  }

  removeSubredditInterest(id, subreddit) {
    const user = this.getUser(id);
    const name = normalizeSubreddit(subreddit).toLowerCase();
    user.subredditInterests = user.subredditInterests.filter((s) => s.subreddit.toLowerCase() !== name);
    this.save();
    return user;
  }

  // Schedule entries are recurring weekly actions, kept sorted by day then time.
  addScheduleEntry(id, input = {}) {
    const user = this.getUser(id);
    const day = oneOf(str(input.day, 'day', { required: true }).toLowerCase(), 'day', DAYS);
    const time = str(input.time, 'time', { max: 5, required: true });
    if (!TIME_RE.test(time)) throw new ValidationError('time must be HH:MM in 24-hour format');
    const entry = {
      id: `s_${randomUUID().slice(0, 8)}`,
      day,
      time,
      action: str(input.action, 'action', { max: 120, required: true }),
    };
    user.schedule.push(entry);
    user.schedule.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.time.localeCompare(b.time));
    this.save();
    return user;
  }

  removeScheduleEntry(id, entryId) {
    const user = this.getUser(id);
    if (!user.schedule.some((e) => e.id === entryId)) throw new NotFoundError(`schedule entry ${entryId} not found`);
    user.schedule = user.schedule.filter((e) => e.id !== entryId);
    this.save();
    return user;
  }
}
