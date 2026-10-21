# Architecture

## Pieces

| Piece | Tech | Who uses it |
| --- | --- | --- |
| Website (`apps/web`) | Next.js App Router, TypeScript, Tailwind, React Hook Form, Zod, lucide icons | Hosts, admins, projector screens, browser players |
| Player app (`apps/player-mobile`) | Expo React Native, Expo Router, expo-camera, expo-secure-store | Players on iOS and Android |
| Shared package (`packages/shared`) | TypeScript | Both apps: rules, scoring, validation, API client, realtime sync, server clock |
| Database (`supabase/migrations`) | Supabase Postgres, Auth, Realtime, pg_cron | Everything: the game engine lives here |

## Main idea: the database is the game server

All game rules that matter for fairness run inside Postgres as `SECURITY DEFINER` functions:

- opening and closing questions and checking deadlines
- accepting answers and resolving the first correct buzz
- scoring, replays and host commands

Every function that changes a game first locks that game's row (`select … for update`). This puts all actions on one game in a single queue. Two players pressing at the same instant are handled one after the other, and the first one the database accepts wins. Times are taken from the database clock (`clock_timestamp()`), never from a phone.

There is no separate game server to deploy or scale. Supabase is the only backend.

## Who can call what

| Caller | How they prove who they are | What they can call |
| --- | --- | --- |
| Player (web or app) | A random secret generated on the device. The server stores only its SHA-256 hash. | `get_join_info`, `resolve_room_code`, `join_session`, `player_state`, `submit_answer`, `tick_session` |
| Projector | The unguessable projector token in its URL (read-only) | `projector_state`, `tick_session` |
| Host | Supabase Auth email and password | Their own quizzes through row-level security, plus `create_session`, `host_state`, `host_command`, `session_results` and related functions |
| Admin | A host whose user id is in `admin_users` | `admin_*` functions |

Anonymous users have no direct table access at all. Hosts reach tables only through row-level security policies that check ownership. The player secret column cannot be selected by anyone.

## Realtime

When a game changes, the database sends a broadcast message on the channel `session:<id>` using `realtime.send`. The message says only that something changed (`state`, `roster` or `answers`) and carries no private data. Each client then asks for its own view through an RPC, so a player only ever receives what that player is allowed to see. For example, the correct answer is not sent until the question closes.

`SessionSync` in `packages/shared/src/sync.ts` handles the client side for both apps:

- refreshes when a broadcast arrives
- sends a heartbeat, and falls back to polling if realtime drops, with backoff
- ignores any state older than the one it already has (`stateVersion`)
- estimates the offset between the device clock and the server clock, so countdowns line up across devices

## Automatic progression

Timed phases move on by themselves: countdown, then question, then reveal, then leaderboard, then the next question. Two mechanisms do this:

1. Clients call `tick_session` when a deadline they know about passes. The server checks its own clock and advances only if the deadline really passed. Repeated calls are harmless.
2. A pg_cron job (`crowdquiz_tick`, every 2 seconds) does the same for every game. This keeps games moving even when no device is connected.

## Access and entitlements

Hosts need active access to launch a game. Admins create access codes, and hosts redeem them for a period of access. Only a hash of each code is stored. Redemption locks the code row, so a code with one use left cannot be redeemed twice at the same time. A new redemption adds its time after any access the host already has. There are no payments; the `entitlements.source` column reserves the value `stripe` for later.

## Logs and audit

- `audit_log`: records admin actions, host game commands, buzzer wins, code redemptions and retention runs.
- `/api/health`: a JSON health endpoint that writes structured logs.
- Errors from the database use stable codes (`CQ:<code>`). Both apps map these codes to plain-language messages in `packages/shared/src/errors.ts`.
