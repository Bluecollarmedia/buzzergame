# Game engine

The engine lives in `supabase/migrations/20261021000300_game_engine.sql` and `…0400_gameplay_api.sql`. The TypeScript rules in `packages/shared` match it, so both apps can show the same rules, and unit tests check them.

## States

```
lobby ──start──▶ countdown ──▶ question_open ──▶ reveal ──▶ leaderboard ──▶ countdown …
                                                   │
                                                   └── last question ──▶ finished
any live state ──pause──▶ paused ──resume──▶ (previous state)
any live state ──end──▶ finished          lobby ──end──▶ aborted
```

- `countdown`: a short "get ready" phase (3 seconds by default; 0 skips it).
- `question_open`: answers are accepted.
- `reveal`: shows the correct answer. Players see whether they were right.
- `leaderboard`: optional standings between questions. Off by default (`showLeaderboard`), so the reveal goes straight to the next countdown and standings appear only at the end.
- After the last question's reveal the game goes straight to `finished`.

Every change increases `state_version`. Clients never apply an older version.

## Timing

- **Multiple Choice.** The server sets `deadline = opened_at + timeLimitSeconds`, with 15 seconds by default. A question can have its own timer. An answer counts only if the database accepts it before the deadline. Late answers get `too_late` or `question_closed`. Phones do not run their own timers; they count down to the server deadline using the estimated clock offset.
- **Color Buzzer.** There is no timer by default. The host can set a time limit. A question closes when someone buzzes the right colour, when every player has been locked out, when the time limit passes, or when the host closes it.
- **Pause** freezes the remaining time and **resume** restores it. If a question was open, at least 3 seconds are restored.

## Scoring

All points go into a ledger, the `score_events` table, which allows one row per player per round. Totals are always summed from this ledger.

- **Multiple Choice.** A correct answer earns `pointsCorrect` (1 by default) and wrong answers earn 0. With the speed bonus on, a correct answer adds `floor(speedBonusMaxPoints × time left / total time)`. Answers are scored when the question closes. If answer changes are allowed, only the last answer counts.
- **Color Buzzer.** The winner earns `pointsCorrect`, and everyone else earns 0.
- **Ranking** uses competition style: tied players share a rank, and the next rank skips (1, 1, 3).

## Buzzer resolution

`submit_answer` for a buzzer game:

1. Locks the game row. All presses for this game are handled one at a time.
2. Rejects the press if the round is closed, the player already pressed (with lockout on), or the game is paused.
3. Records the answer with the database time.
4. If the press is correct and the round has no winner yet, it sets the winner, adds the score event and closes the round with reason `winner`. Exactly one player can win because step 1 serialises the presses and the ledger allows one award per round.
5. If the press is wrong, the player is locked out. When every player is locked out, the round closes as `all_wrong`.

The DB test suite fires 40 simultaneous correct presses and checks that there is exactly one winner and one award. The browser test does the same with two phones.

## Host commands

`host_command(session, command, expected_version, args)` accepts these commands:

| Command | Effect |
| --- | --- |
| `start` | Starts the game from the lobby (needs at least 1 player) |
| `pause` / `resume` | Freezes or restores the clock |
| `next` | Advances to the next phase now; during countdown it opens the question immediately |
| `close_question` | Closes the open question now |
| `skip` | Skips the current question without scoring it |
| `replay` | Voids the current round's points and runs the question again |
| `end` | Ends the game (or cancels it from the lobby) |
| `remove_player` | Removes a player |

Commands are idempotent. The client sends the `stateVersion` it was looking at. If the game has already moved on, for example because of a double click or two host tabs, the command is ignored and returns `applied: false`. The website asks for confirmation before skip, replay, end and remove.

## Projector music

The projector plays music and sound effects. Phones stay silent.

- **Generated live, no audio files.** Everything is synthesised in the browser with the Web Audio API (`apps/web/src/components/projector/audio/GameAudio.ts`). There are no samples or recordings, so there is nothing to license and nothing extra to download.
- **Builds with the timer.** During a question, intensity is the share of the timer used (`1 - timeLeft / timeLimit`), worked out from the server deadline and the shared server clock. A 15-second and a 30-second question therefore sound the same at the same point, and both reach full intensity at the buzzer. Tempo, filter brightness, drums and a rising sweep all follow intensity. The last 3 seconds tick.
- **Other scenes.** A calm loop in the lobby and on the final screen, ticks during the countdown, a quieter groove between questions, and one-shot sounds for time up, a buzzer winner and the final results. A paused game is silent.
- **Turning it on and off.** Browsers block sound until someone clicks, so the projector shows a "Click to turn on music" button once. The speaker icon in the projector header mutes that screen only. The host can turn music off for the game with **Projector music off** in the live controls (`host_set_sound`), or before launch with the "Music and sound effects on the projector" setting (`soundOn`, default on).

## Joining and reconnecting

- The QR code encodes `https://<site>/j/<joinToken>`. The token is 24 random bytes and cannot be guessed. The 6-character room code is a fallback for typing; looking it up is rate limited.
- Each device creates a 43-character random secret for each game, stored in `localStorage` on the web or the keychain/keystore in the app. Joining again with the same secret returns the same player. This is how reconnecting works and why a double tap never creates two players.
- Display names are 1–24 characters. Control and invisible characters are rejected, and each name must be unique within the game (case-insensitive).

## Rate limits

Fixed one-minute windows unless stated otherwise:

| Action | Limit |
| --- | --- |
| join info by token | 300 per IP |
| room code lookup | 60 per IP |
| join | 200 per IP; 600 per game |
| submit answer | 40 per player |
| host commands | 120 per game |
| create game | 20 per host per 10 minutes |
| redeem code | 10 per user per 10 minutes |

The IP limits are generous because a whole venue often shares one Wi-Fi address. Other limits:

- Each host can have at most 10 live games.
- A game can have at most `maxPlayers` players: 100 by default, and up to 500.
