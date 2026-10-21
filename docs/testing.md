# Testing

| Suite | Where | What it covers | Command |
| --- | --- | --- | --- |
| Unit | `packages/shared/src/__tests__` | Scoring, ranking, buzzer resolution rules, state machine, validation, settings, access-code rules, link parsing, server clock | `pnpm test` |
| Database integration | `packages/db-tests` | The real SQL engine on Postgres: full games, deadlines, late answers, buzzer races, replays, pause/resume, idempotent commands, rate limits, row-level security and tenant isolation, concurrent code redemption, quiz editing, data retention | `pnpm test:db` |
| End-to-end (browser) | `apps/web/e2e` | Full flow in Chromium against local Supabase: admin creates a code, host signs up and redeems it, builds a quiz in the editor, runs a Multiple Choice game with 3 phone-sized players and a projector, then a Color Buzzer game with a lockout and a simultaneous buzz | `pnpm test:e2e` |
| Type checks | all packages | TypeScript strict mode | `pnpm typecheck` |
| Lint | `apps/web` | ESLint (Next.js and React hooks rules) | `pnpm lint` |

## Database tests

These need a Postgres 15+ server you can drop databases on. By default they use `postgres://postgres:postgres@localhost:5432/postgres`; set `CQ_TEST_ADMIN_URL` to change it. The suite creates a throw-away database called `crowdquiz_test`, loads a small stand-in for Supabase's `auth` schema and roles (`packages/db-tests/sql/supabase_stub.sql`), then applies every migration. Each statement runs as the `anon` or `authenticated` role, the same way the Supabase API would run it.

Never point `CQ_TEST_ADMIN_URL` at a real project.

## End-to-end tests

```bash
pnpm db:start                      # local Supabase
pnpm --filter web build            # uses apps/web/.env.local (local URL + anon key)
pnpm test:e2e
```

The tests read the local keys with `supabase status`. They create an admin user with the local service-role key, which is the same step as the admin bootstrap. The website itself never sees that key. Playwright starts `next start` on port 3100.

## Not covered by automated tests

- The native app runs no automated UI tests. It is checked by type-checking and by building both the iOS and Android JavaScript bundles with `expo export`. It has **not** been run on a real device or simulator yet; see docs/mobile.md for the manual checklist.
- Email delivery (sign-up confirmation, password reset). Local Supabase captures emails in Mailpit at http://127.0.0.1:54324.
- Load beyond what the tests generate (40 simultaneous buzzes, 30 simultaneous answers).
