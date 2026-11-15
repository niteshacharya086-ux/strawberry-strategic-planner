# Strawberry Strategic Planner

This package preserves the existing offline planner and adds a Supabase-backed, multi-guild platform foundation: Auth, a permanent Main Admin (`nitesh`), role-scoped guild access, private file storage, administrative Edge Functions, and audit logging. The browser config targets the Strawberry Strategic Planner Supabase project using its publishable key. No database password, initial admin password, service-role key, or bootstrap token is included. The Main Admin bootstrap has been completed and its one-time token removed from Supabase secrets.

## Components

- `index.html` is the existing planner and retains its workspace serialization bridge.
- `cloud.js` is the browser client and Main Admin UI. Client-side controls are convenience only; SQL RLS and Edge Function authorization are the access boundary.
- `config.js` contains only the Supabase project URL and public anon/publishable key.
- `supabase/schema.sql` is the complete new-project SQL setup. Ordered migrations are in `supabase/migrations/`.
- `supabase/functions/` contains username login, account registration, one-time Main Admin bootstrap, and the privileged Main Admin API.

## Deploy to a new Supabase project

1. Create a Supabase project and keep its database password private. This repository does not need that password.
2. In the Supabase SQL Editor, review and run `supabase/schema.sql` once on the new project. Alternatively install the Supabase CLI, link this project, and run `supabase db push`. Do not run this initial schema on a populated database without first adapting it as a reviewed migration.
3. Deploy the Edge Functions from the project root with the Supabase CLI:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy bootstrap-main-admin
   supabase functions deploy username-login
   supabase functions deploy register-account
   supabase functions deploy platform-admin
   supabase functions deploy guild-admin
   ```

   Supabase injects project URL and server API key variables into Edge Functions. They are used only by server-side code. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side; never paste it into `config.js`, HTML, browser storage, GitHub Pages, or a public issue.
4. Generate a long random bootstrap token locally and set an Edge Function secret named `MAIN_ADMIN_BOOTSTRAP_TOKEN` in the Supabase Dashboard or CLI. For example, use a password manager to create a random value of at least 32 characters. Do not put it in Git or in the browser.
5. Set the frontend configuration in `config.js` to the Supabase Project URL and the public anon/publishable key. Those two values are intended for browser use with RLS enabled. Never use a secret/service-role key here.
6. Configure Supabase Auth email templates, SMTP/recovery delivery, allowed redirect URLs, and rate limits for the deployed site. Deploy the static site (for example GitHub Pages) only after the backend is configured.
7. Bootstrap Main Admin once from a private workstation. The endpoint accepts a private email, one-time bootstrap token, and the password chosen at deployment; it forces username `nitesh`. Avoid shell history and shared terminals. The function does not log the request body or return the password:

   ```powershell
   $email = Read-Host 'Main Admin email'
   $password = Read-Host 'Choose a strong Main Admin password' -AsSecureString
   $plain = [System.Net.NetworkCredential]::new('', $password).Password
   $token = Read-Host 'One-time bootstrap token' -AsSecureString
   $tokenText = [System.Net.NetworkCredential]::new('', $token).Password
   $body = @{ email = $email; password = $plain } | ConvertTo-Json -Compress
   Invoke-RestMethod -Method Post `
     -Uri 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/bootstrap-main-admin' `
     -Headers @{ 'apikey' = 'YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY'; 'x-bootstrap-token' = $tokenText } `
     -ContentType 'application/json' -Body $body
   Remove-Variable plain,tokenText,body,password,token
   ```

   This call must be made over HTTPS from a private computer. Do not paste the password into a chat, GitHub, issue, source file, or dashboard SQL editor. After it succeeds, immediately delete `MAIN_ADMIN_BOOTSTRAP_TOKEN` from Edge Function secrets and redeploy/restart the bootstrap function if required. The unique primary-admin index and one-time check prevent a second bootstrap.
8. Sign in as username `nitesh` and the password configured privately during bootstrap. The Main Admin dashboard can invite accounts; invited users set their own password through Supabase Auth email. It supports account suspension/reactivation, username changes, role changes, password reset emails, guild lifecycle and registration requests, memberships, platform settings, and platform audit history. Passwords cannot be retrieved.

## Authorization model

- **Main Admin:** represented by a non-client-writable `platform_admins` row. The `is_primary` constraint allows one permanent primary account. Privileged platform actions pass through `platform-admin`, which validates the Supabase user token and checks the primary admin row server-side before using the server key.
- **Bootstrap:** username `nitesh` is reserved by a database trigger. Bootstrap checks both the primary-admin row and a persistent completion setting, requires a 32-character private token, uses constant-time token comparison, and only succeeds once. Insert of the primary role precedes profile creation so no public signup can claim `nitesh` first.
- **Login abuse protection:** username-login hashes the normalized username before storing any rate-limit key, blocks after 8 failed attempts for 15 minutes, and relies on Supabase Auth's own sign-in rate limits as a second layer. Configure Auth rate limits and monitor function logs during deployment.
- **Signup:** register-account validates email, username, and password lengths; it ignores any client-supplied role/guild fields and reserves `nitesh`. Only trusted admin functions can assign roles.
- **Guild Admin:** manages the membership and content of their own active guild. Admin account and role changes are scoped to their guild; platform-wide user and guild operations remain Main Admin only.
- **Planner:** edits plans/maps/workspace and placements, but has no direct account or membership-management privileges and no delete permission on the normalized player table. A database trigger also blocks deleting roster entries through the retained legacy workspace JSON.
- **Member:** reads guild workspace/plans/maps and can submit participation for their own user. They cannot write plans or change roles.
- **Isolation:** guild foreign keys and RLS require active membership for every guild-scoped row. Storage uses a private `guild-files` bucket and requires the first object path segment to be the guild UUID. Never create public URLs for private guild files.
- **Audit:** Main Admin operations are recorded in `platform_audit_logs`; guild events can be recorded in `guild_audit_logs`. Reset actions send Auth recovery mail and never reveal or store the user's password.

## Existing planner compatibility and known boundaries

The current planner stores its map/roster state as one JSON workspace row. That format remains the compatibility format for the shipped UI. A database trigger mirrors its roster and extra pool to `guild_players`, map tabs to `guild_maps` and `guild_plans`, placements to `guild_placements`, and saves to guild history. The normalized tables enforce guild-scoped access independently. File metadata and a private bucket are ready, but this legacy planner has no file upload controls yet. New modules should use the normalized tables and private Storage directly.

## Verification status

This source package is prepared without a live Supabase project. Local source/static checks can check packaging, required RLS declarations, privilege separation, and JavaScript syntax where a local runtime is available. They cannot prove that SQL applies to a particular hosted Postgres version, that Auth/Storage behavior matches the deployed project settings, or that cross-guild requests are denied. Before production use, apply to a disposable Supabase project and run the included authorization test plan against at least two guilds and accounts in each role. Confirm that cross-guild selects, inserts, updates, storage access, role escalation, and planner player deletion all fail, and that legitimate within-guild actions succeed. Until those live tests pass, authorization and cross-guild isolation are **not verified**, and this package is **not certified production-secure**.

## Local checks

Run `powershell -ExecutionPolicy Bypass -File tools/local_check.ps1` from the project root. This script is a static package/invariant check only; it does not execute SQL or prove database security. See `supabase/tests/README.md` for the required live authorization test matrix.

For current platform details, consult the official [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [Edge Function authorization](https://supabase.com/docs/guides/functions/auth), and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) docs.
