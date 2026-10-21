# Privacy and data retention

This describes what CrowdQuiz stores and for how long. It is a starting point for your own privacy policy, not legal advice.

## Players (guests)

Players do not create accounts. For each game the server stores:

- the display name the player typed
- a SHA-256 hash of a random secret created on the player's device (the secret itself never leaves the device except to prove it is the same player)
- the player's answers with the server time they were accepted, and their points
- the time they joined and were last seen

The server does **not** store player email addresses, phone numbers, device identifiers or locations. IP addresses are used only for rate-limit counters, which are deleted after one hour. The native app uses the camera only to read QR codes; nothing is recorded or uploaded.

On the device, the website keeps the per-game secret in `localStorage` and the app keeps it in the Keychain or Keystore. Both expire after 24 hours.

## Hosts

Hosts have an account with an email address, a display name and a password, handled by Supabase Auth. Their quizzes, games, access history and audit entries are linked to their account.

## Retention

A nightly job (`private.purge_expired_data`, scheduled with pg_cron at 03:30 UTC) does the following:

| Data | Kept for |
| --- | --- |
| Live game with no activity | Cancelled after 24 hours |
| Finished or cancelled games, including guest names, answers and scores | Deleted 90 days after the game ends |
| Audit log entries | 365 days |
| Rate-limit counters (contain IP addresses) | 1 hour |

Hosts can delete a finished game sooner from their dashboard. Deleting a host account in Supabase Auth removes the host's quizzes, games and access records.

To change these periods, edit `supabase/migrations/20261021000800_retention.sql` in a new migration.
