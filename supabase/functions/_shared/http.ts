import { createClient } from 'npm:@supabase/supabase-js@2';

export const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-bootstrap-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
export const respond = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
export const env = (name: string) => { const value=Deno.env.get(name); if(!value) throw new Error(`Missing server configuration: ${name}`); return value; };
export const adminClient = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession:false, autoRefreshToken:false } });
export const publicClient = () => createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession:false, autoRefreshToken:false } });
export async function requireUser(req: Request) {
 const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,''); if(!token) throw new Error('Sign in required');
 const admin=adminClient(); const {data,error}=await admin.auth.getUser(token); if(error||!data.user) throw new Error('Invalid session');
 const {data:profile}=await admin.from('profiles').select('status,username').eq('user_id',data.user.id).maybeSingle();
 if(!profile || profile.status!=='active') throw new Error('Account profile is missing or suspended');
 return {admin,user:data.user,profile};
}
export async function requireMainAdmin(req: Request) {
 const ctx=await requireUser(req); const {data}=await ctx.admin.from('platform_admins').select('is_primary').eq('user_id',ctx.user.id).maybeSingle();
 if(!data?.is_primary) throw new Error('Main Admin permission required'); return ctx;
}
export async function audit(admin: ReturnType<typeof adminClient>, actor:string, action:string, details:Record<string,unknown>={}, target?:string, guild?:string) {
 const {error}=await admin.from('platform_audit_logs').insert({actor_id:actor,target_user_id:target||null,guild_id:guild||null,action,details}); if(error) throw error;
}
