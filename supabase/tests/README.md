# Live authorization test matrix

Run these checks only against a disposable Supabase project after applying the migration and deploying the Edge Functions. Use at least two guilds (A and B), one account per role in each, and a Main Admin. Record actual HTTP/PostgREST/Storage status and response without exposing tokens. These checks are required before security can be considered verified.

| Actor | Attempt | Expected |
| --- | --- | --- |
| Guild A member | Read Guild A workspace, plans, maps, members, participation | Allowed only where member read policy exists |
| Guild A member | Read/insert/update any Guild B row by changing `guild_id` | Denied / zero rows |
| Guild A member | Update workspace, roles, memberships, guild status, or platform settings | Denied |
| Guild A member | Submit participation with another `user_id` or to Guild B | Denied |
| Guild A planner | Update Guild A workspace, plans, maps, placements | Allowed |
| Guild A planner | Delete a `guild_players` row or remove a player from legacy workspace JSON | Denied by table grants/RLS or trigger |
| Guild A planner | Change memberships, roles, guilds, accounts, platform settings | Denied |
| Guild A guild admin | Manage Guild A memberships and content; invite users | Allowed through `guild-admin` with valid JWT |
| Guild A guild admin | Modify Guild B or platform-wide accounts/settings | Denied |
| Guild A guild admin | Delete a Guild A player | Allowed only within Guild A |
| Any signed-in non-admin | Call `platform-admin` with arbitrary action or forged body | HTTP 403; no mutation/audit-as-admin |
| Unauthenticated user | Call `platform-admin` | Rejected by gateway/function authorization |
| Member of A | Download/upload/delete Storage object under B's UUID prefix | Denied |
| Planner of A | Upload/read file under A; delete file under A | Upload/read allowed; delete denied |
| Guild Admin A | Upload/read/delete file under A; access B file | Own guild allowed; B denied |
| Main Admin | Cross-guild administration and review platform audit | Allowed, all mutations audited |
| Any account | Read an existing password or receive reset password in response | Impossible; only Auth recovery email flow |
| Bootstrap caller | Bootstrap after a primary admin exists or with wrong token | Rejected with no second primary account |

Also inspect the hosted SQL catalog to confirm every public table has RLS enabled and verify Storage bucket `guild-files` is private. Run checks again after any policy, function, role, schema, or auth configuration change. A browser UI inspection does not replace these request-level checks.
