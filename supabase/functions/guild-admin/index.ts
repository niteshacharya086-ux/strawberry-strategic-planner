import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Missing server configuration: ${name}`); return value; };
const adminClient = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
async function requireUser(req: Request) {
 const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, ''); if (!token) throw new Error('Sign in required');
 const admin = adminClient(); const { data, error } = await admin.auth.getUser(token); if (error || !data.user) throw new Error('Invalid session');
 const { data: profile } = await admin.from('profiles').select('status,username').eq('user_id', data.user.id).maybeSingle();
 if (!profile || profile.status !== 'active') throw new Error('Account profile is missing or suspended');
 return { admin, user: data.user, profile };
}
async function audit(admin: ReturnType<typeof adminClient>, actor: string, action: string, details: Record<string, unknown> = {}, target?: string, guild?: string) {
 const { error } = await admin.from('platform_audit_logs').insert({ actor_id: actor, target_user_id: target || null, guild_id: guild || null, action, details }); if (error) throw error;
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(req.method!=='POST') return respond({error:'POST required'},405);
 try{
  const {admin,user}=await requireUser(req); const b=await req.json(); const action=String(b.action||''),gid=String(b.guild_id||'');
  if(!gid) throw new Error('guild_id required');
  const {data:membership,error:me}=await admin.from('guild_memberships').select('role').eq('guild_id',gid).eq('user_id',user.id).maybeSingle();
  const {data:guild,error:ge}=await admin.from('guilds').select('status').eq('id',gid).maybeSingle();
  if(me||ge) throw me||ge; if(membership?.role!=='guild_admin'||guild?.status!=='active') return respond({error:'Guild Admin permission required'},403);
  if(action==='set-role'){
   if(String(b.user_id)===user.id) return respond({error:'You cannot change your own role'},403);
   if(!['guild_admin','planner','member'].includes(b.role)) throw new Error('Invalid role');
   const {error}=await admin.from('guild_memberships').upsert({guild_id:gid,user_id:b.user_id,role:b.role}); if(error) throw error;
   await audit(admin,user.id,action,{role:b.role},String(b.user_id),gid);
  }else if(action==='remove-member'){
   const {error}=await admin.from('guild_memberships').delete().eq('guild_id',gid).eq('user_id',b.user_id);if(error)throw error;
   await audit(admin,user.id,action,{},String(b.user_id),gid);
  }else if(action==='invite-member'){
   const email=String(b.email||'').trim().toLowerCase(),username=String(b.username||'').trim(),role=String(b.role||'member');
   if(!email||! /^[A-Za-z0-9_.-]{3,32}$/.test(username)||!['guild_admin','planner','member'].includes(role)) throw new Error('Valid email, username, and role required');
   const {data:invited,error}=await admin.auth.admin.inviteUserByEmail(email);if(error)throw error;
   const {error:profileErr}=await admin.from('profiles').insert({user_id:invited.user.id,username});if(profileErr){await admin.auth.admin.deleteUser(invited.user.id);throw profileErr;}
   const {error:membershipErr}=await admin.from('guild_memberships').insert({guild_id:gid,user_id:invited.user.id,role});if(membershipErr){await admin.auth.admin.deleteUser(invited.user.id);throw membershipErr;}
   await audit(admin,user.id,action,{email,username,role},invited.user.id,gid);
  }else if(action==='delete-player'){
   const {error}=await admin.from('guild_players').delete().eq('guild_id',gid).eq('id',b.player_id);if(error)throw error;
   await audit(admin,user.id,action,{player_id:b.player_id},undefined,gid);
  }else throw new Error('Unsupported guild admin action');
  return respond({ok:true});
 }catch(error){return respond({error:error instanceof Error?error.message:'Request failed'},400)}
});

