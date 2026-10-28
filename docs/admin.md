# Admin and access codes

## Create the first admin

Admins also get an **Admin** tab in the iPhone app (access codes, hosts, live games). It appears only for admin accounts.

Admins are hosts whose user id is listed in `public.admin_users`. No API can add the first admin. This is deliberate: it has to be done once, by someone with database access.

1. Sign up on the website with the email the admin will use, and confirm the email.
2. In the Supabase dashboard, open **SQL Editor** and run:
   ```sql
   insert into public.admin_users (user_id, note)
   select id, 'first admin' from auth.users where email = 'you@example.com';
   ```
3. Sign out and back in. An **Admin** link appears in the navigation.

To add more admins later, run the same statement with another email. To remove an admin, delete their row from `admin_users`.

## Issue an access code

Admin → **Access codes** → **New access code**. You choose:

- how long the access lasts (1 day, 1 week, 30 days, or any number of hours)
- how many hosts can redeem the code (1 = single use)
- optional: an expiry date for the code, a game limit, a custom code and a note

The code is shown **once**. Only a hash and the first 4 characters are stored, so copy it straight away. Codes look like `ABCD-EFGH-JKLM` and are not case-sensitive.

Hosts redeem codes at **Account → Redeem a code**. If the host already has access, the new time is added after it ends. If access runs out during a game, that game finishes normally.

## Other admin tools

- **Hosts**: search, see access and usage, grant or revoke access, disable an account. Disabling a host also ends their live games.
- **Games**: see live and recent games and end any of them.
- **Audit log**: recent admin actions, game commands, buzzer wins and code redemptions.
- **Overview**: counts of hosts, games and players.

Admins can always launch games without a code.

## Photo storage (Cloudflare R2)

Question photos are stored in a Cloudflare R2 bucket. The website uploads and deletes them (`/api/photos`) and sends photo addresses on to R2 (`/photos/...`). It needs these Netlify environment variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `PHOTO_PUBLIC_URL` (the bucket's public address).

Overview tab → **Photo storage** has two buttons:

- **Copy old photos to Cloudflare** copies photos uploaded before the move out of the old Supabase bucket. It skips anything already copied, so it is safe to run again. Until a photo is copied, it is still shown from Supabase.
- **Delete expired photos** removes files the nightly clean-up has queued. Every night the database detaches old photos (30 days after a quiz's last game, or 90 days after the last edit if it was never played), deletes drafts untouched for 60 days, and queues photos nothing uses. Press it now and then (weekly is plenty).
