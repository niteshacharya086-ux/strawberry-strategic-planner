import { audit, cors, requireUser, respond } from '../_shared/http.ts';
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
