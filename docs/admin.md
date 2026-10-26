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

## Photo storage clean-up

Every night the database detaches old photos (30 days after a quiz's last game, or 90 days after the last edit if it was never played) and deletes drafts untouched for 60 days. The files themselves are removed by a small script, because a database cannot delete files from storage:

```
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... pnpm purge:photos
```

Run it now and then (weekly is plenty). Keep the service-role key private. Moving photo storage to Cloudflare R2 later would let a lifecycle rule do this automatically.
