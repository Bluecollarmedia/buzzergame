# Deployment

Nothing in this repo deploys itself. These steps need your own accounts.

## 1. Supabase project

1. Create a project at supabase.com. Note the **Project URL** and the **anon public key** (Project Settings → API).
2. Enable the **pg_cron** extension (Database → Extensions). It provides automatic progression when no device is connected and runs the nightly retention job. Without it games still work, because clients advance them, but enable it in production.
3. Push the migrations from your machine:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   Read the migrations before pushing to a project that already has data. They are written for a new project.
4. Authentication → URL configuration:
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/**`
5. Authentication → Providers → Email: keep **Confirm email** on. Configure a custom SMTP sender (Authentication → Emails), because the built-in sender is heavily rate limited.
6. Realtime needs no setup. The database sends broadcast messages with `realtime.send`.

## 2. Website on Vercel

1. Import the GitHub repository into Vercel.
2. Set **Root Directory** to `apps/web`. Vercel detects Next.js and pnpm from the lockfile.
3. Add environment variables (Production and Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` = `https://<your-domain>`
   - Optional, for the native app's links: `IOS_APP_ID`, `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_CERT_FINGERPRINTS`
4. Deploy, then add your domain in Vercel → Domains.
5. Check `https://<your-domain>/api/health`. It should return `{"ok":true,…}`.

Do **not** add the service-role key to Vercel. The website does not use it.

Any host that runs Next.js works. Vercel is the simplest option.

## 3. First admin and first access code

See [admin.md](admin.md).

## 4. Native app

See [mobile.md](mobile.md).

## Production checklist

- [ ] Migrations pushed, pg_cron enabled, `select * from cron.job` shows `crowdquiz_tick` and `crowdquiz_retention`
- [ ] Site URL and redirect URLs set; custom SMTP configured
- [ ] Vercel env vars set; `/api/health` OK
- [ ] First admin created; a test code redeemed by a test host
- [ ] A test game played end to end on real phones
- [ ] Privacy policy published (docs/privacy.md is a starting point, not legal advice)
