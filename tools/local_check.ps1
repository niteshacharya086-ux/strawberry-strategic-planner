$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$sql = Get-Content -Raw (Join-Path $root 'supabase/schema.sql')
$migration = Get-Content -Raw (Join-Path $root 'supabase/migrations/20261116000000_strawberry_platform.sql')
$hardening = Get-Content -Raw (Join-Path $root 'supabase/migrations/20261116010000_auth_hardening.sql')
if ($migration -notmatch 'create table public\.guilds' -or $hardening -notmatch 'create table public\.login_rate_limits') { throw 'Base schema or incremental hardening migration is missing.' }
$tables = @('profiles','platform_admins','guilds','guild_memberships','guild_workspaces','guild_players','guild_maps','guild_plans','guild_placements','participation_entries','guild_files','guild_audit_logs','platform_audit_logs')
foreach ($table in $tables) {
  if ($sql -notmatch "create table public\.$table\b") { throw "Missing table $table" }
}
if ($sql -notmatch "alter table public\.%I enable row level security" -or $sql -notmatch "foreach t in array array\['profiles'.*'platform_audit_logs'.*'login_rate_limits'\]") { throw 'Could not verify the generated RLS enablement list.' }
foreach ($item in @('bootstrap-main-admin','username-login','register-account','platform-admin','guild-admin')) {
  if (!(Test-Path (Join-Path $root "supabase/functions/$item/index.ts"))) { throw "Missing function $item" }
}
$config = Get-Content -Raw (Join-Path $root 'config.js')
if ($config -match '(?m)^window\.STRAWBERRY_SUPABASE_(?:URL|ANON_KEY)\s*=\s*["''](?!(?:PASTE_|https://)).*(?:service_role|secret|password)') { throw 'A suspicious value was found in browser config.' }
if ($sql -notmatch "if t<>'guild_players' then execute format\('create policy .*delete") { throw 'Could not verify that direct player delete policies are withheld.' }
if ($sql -notmatch "values\('guild-files','guild-files',false\)") { throw 'The guild file bucket is not visibly private.' }
if ($sql -notmatch 'sync_workspace_normalized' -or $sql -notmatch 'guild_placements' -or $sql -notmatch 'workspace_saved') { throw 'Workspace-to-normalized content synchronization is missing.' }
if ($sql -match 'grant\s+(?:insert|update|delete).*public\.guild_memberships') { throw 'Direct membership mutation is granted to browser roles.' }
$platform = Get-Content -Raw (Join-Path $root 'supabase/functions/platform-admin/index.ts')
if ($platform -notmatch 'requireMainAdmin') { throw 'Platform API does not call the Main Admin guard.' }
Write-Output "PASS: schema coverage, base/incremental migrations, expected tables with RLS, Edge Function files, browser config secret scan."
Write-Output "LIMIT: static checks only; PostgreSQL application, runtime compilation, authorization and cross-guild isolation were not exercised."

