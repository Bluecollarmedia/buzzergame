# Privacy and data retention

This describes what the service stores and for how long. It is the source for the public privacy policy at `/privacy` (apps/web/src/app/(marketing)/privacy/page.tsx); keep the two in step. It is not legal advice.

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

Hosts can attach one photo to a question from the Buzzavid app. Photos are stored in a public Cloudflare R2 bucket under `<host id>/<random id>.jpg` (the address is unguessable but not secret) and are shown on the projector and host screens. Uploads and deletions go through the website's `/api/photos` route, which acts with the host's own sign-in, so only the owning host can add or remove their photos. The database keeps the list of photos (`private.photo_files`) to enforce the photo limit and the Photo uploads switch. Photos uploaded before the move sat in the Supabase `question-images` bucket and are copied to R2 from the Admin tab.

Hosts can delete their account in the app (`delete_my_account()`). That removes the Supabase Auth user, which cascades to their profile, quizzes, questions, games (with guest names, answers and scores), entitlements and redemptions, after the app has removed their photos (any left over are queued and deleted from the Admin tab). Audit log rows keep only the random user id until the 365-day purge.

## Retention

A nightly job (`private.purge_expired_data`, scheduled with pg_cron at 03:30 UTC) does the following:

| Data | Kept for |
| --- | --- |
| Live game with no activity | Cancelled after 24 hours |
| Finished or cancelled games, including guest names, answers and scores | Deleted 90 days after the game ends |
| Draft quizzes | Deleted after 60 days without edits |
| Question photos | Removed 30 days after the quiz's last game (90 days after the last edit if never played); limit of 10 photos for free accounts, 200 with hosting access |
| Audit log entries | 365 days |
| Rate-limit counters (contain IP addresses) | 1 hour |

Hosts can delete a finished game sooner from their dashboard. Deleting a host account in Supabase Auth removes the host's quizzes, games and access records.

To change these periods, edit `supabase/migrations/20261021000800_retention.sql` in a new migration.
