# account-spawn

A small website for managing users. Each user has:

- **Account info**: display name, email, plan (`free` / `pro` / `team`), status (`active` / `suspended` / `closed`), location and bio
- **Interest by subreddit**: subreddits scored 0–100
- **Interests**: free-form interest tags
- **Weekly schedule**: recurring actions, each with a day and a time

The site has no dependencies: a plain Node HTTP server, a JSON file for storage and a vanilla JS frontend.

## Running it

Needs Node 20 or newer.

```sh
npm start        # http://localhost:3000
npm run dev      # restarts on file changes
npm test
```

On first run, `data/seed.json` is copied to `data/db.json` (gitignored), and all edits are saved there. Delete `data/db.json` to reset to the seed data. Use `PORT` and `DB_FILE` to change the port or the data file.

## API

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/users?q=` | Lists users. `q` searches names, interests and subreddits |
| POST | `/api/users` | `{ username, email, displayName?, plan?, location?, bio? }` |
| GET | `/api/users/:id` | Gets one user with all their data |
| PATCH | `/api/users/:id` | `{ displayName?, email?, plan?, status?, location?, bio? }` |
| DELETE | `/api/users/:id` | — |
| POST | `/api/users/:id/interests` | `{ interest }` |
| DELETE | `/api/users/:id/interests/:interest` | — |
| PUT | `/api/users/:id/subreddits` | `{ subreddit, score }`. Adds the subreddit, or updates its score if the user already has it |
| DELETE | `/api/users/:id/subreddits/:subreddit` | — |
| POST | `/api/users/:id/schedule` | `{ day: "mon".."sun", time: "HH:MM", action }` |
| DELETE | `/api/users/:id/schedule/:entryId` | — |
