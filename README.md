# CrowdQuiz

Live multiplayer quiz games for a room full of people. A host runs the game from a laptop, a projector or TV shows the questions, and players answer on their phones. Players can use the website or the native app, and they never need an account.

There are two game modes:

- **Multiple Choice.** Every player answers each question before a timer runs out (15 seconds by default). The phone shows only the coloured A/B/C/D buttons. A correct answer scores one point, and an optional speed bonus adds more.
- **Color Buzzer.** Red = A, Blue = B, Green = C, Purple = D. The first player to press the right colour wins the question. A wrong press locks that player out for the rest of the question. The server decides who was first.

## What's in the repo

```
apps/
  web/              Next.js website: host dashboard, quiz editor, live host controls,
                    projector view, browser player, admin console
  player-mobile/    Expo React Native player app for iOS and Android (QR scanner, deep links)
packages/
  shared/           Game rules, scoring, validation, typed API client and realtime sync,
                    used by both apps
  db-tests/         Integration tests that run the SQL game engine on real Postgres
supabase/
  migrations/       Database schema, game engine, security rules and scheduled jobs
  config.toml       Local Supabase settings
scripts/seed-dev.mjs  Local development seed data
docs/               Architecture, game engine, testing, deployment, admin, mobile, privacy
```

## Quick start (local)

You need Node 20+, pnpm 10, Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
pnpm install
pnpm db:start                       # starts local Supabase and applies all migrations
cp apps/web/.env.example apps/web/.env.local
# paste the anon key from `supabase status` into apps/web/.env.local
pnpm seed:dev                       # admin + host accounts and two sample quizzes
pnpm dev                            # http://localhost:3100
```

Seeded accounts (local only):

| Email | Password | Role |
| --- | --- | --- |
| admin@crowdquiz.local | admin-password | Admin |
| host@crowdquiz.local | host-password | Host with access |

To try a game, sign in as the host, open a sample quiz, press **Launch**, then open the join link in a second browser window (or a phone on the same network).

Native app:

```bash
cp apps/player-mobile/.env.example apps/player-mobile/.env   # fill in the values
pnpm mobile                                                  # Expo dev server
```

The app uses native modules (camera, secure storage), so run it in a development build (`pnpm --filter @crowdquiz/player-mobile android` or `ios`). See [docs/mobile.md](docs/mobile.md).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Website in development mode on port 3100 |
| `pnpm build` | Type-checks the shared package and builds the website |
| `pnpm lint` | ESLint for the website |
| `pnpm typecheck` | TypeScript in every package |
| `pnpm test` | Unit tests for the shared rules package |
| `pnpm test:db` | Database integration tests (needs a local Postgres 15+ on port 5432, see docs/testing.md) |
| `pnpm test:e2e` | Browser tests against local Supabase and a production build of the website |
| `pnpm db:reset` | Recreate the local database from the migrations |
| `pnpm db:types` | Generate TypeScript types from the local database |
| `pnpm seed:dev` | Local seed data (refuses to run against a non-local database) |

## Documentation

- [Architecture](docs/architecture.md): how the pieces fit together and why
- [Game engine](docs/game-engine.md): states, timing, scoring, buzzer resolution, host commands
- [Testing](docs/testing.md): what is tested and how to run it
- [Deployment](docs/deployment.md): Supabase, Vercel and domains
- [Admin and access codes](docs/admin.md): first admin, issuing codes, managing hosts
- [Mobile app](docs/mobile.md): development builds, EAS builds, store submission, deep links
- [Privacy and data retention](docs/privacy.md)

## Security in one paragraph

The browser and the app only ever hold the public Supabase anon key. Every table has row-level security, and anonymous users cannot read any table directly. Players and the projector talk to the database only through a small set of functions that check an unguessable token or the player's own secret. Hosts can only see and change their own quizzes and games. Scoring, timing and buzzer resolution happen inside the database under a row lock, using the database clock. The service-role key is never used by the apps.
