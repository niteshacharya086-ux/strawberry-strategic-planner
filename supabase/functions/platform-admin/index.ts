import { audit, cors, requireMainAdmin, respond } from '../_shared/http.ts';

Deno.serve(async req=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(req.method!=='POST') return respond({error:'POST required'},405);
 try {
  const {admin,user}=await requireMainAdmin(req); const b=await req.json(); const action=String(b.action||''); let result:unknown={ok:true};
  const validRole=(r:string)=>['guild_admin','planner','member'].includes(r);
  switch(action){
   case 'dashboard': {
    const [g,m,r,a,s,p]=await Promise.all([admin.from('guilds').select('*').order('created_at',{ascending:false}),admin.from('guild_memberships').select('guild_id,user_id,role,created_at'),admin.from('guild_registration_requests').select('*').order('created_at',{ascending:false}),admin.from('platform_audit_logs').select('*').order('created_at',{ascending:false}).range(0,999),admin.from('platform_settings').select('*'),admin.from('profiles').select('user_id,username,display_name,status,created_at')]);
    for(const x of [g,m,r,a,s,p]) if(x.error) throw x.error;
    const authUsers=await admin.auth.admin.listUsers({page:1,perPage:1000}); if(authUsers.error) throw authUsers.error;
    result={guilds:g.data,memberships:m.data,registrations:r.data,audit:a.data,settings:s.data,profiles:p.data,users:authUsers.data.users.map(u=>({id:u.id,email:u.email,created_at:u.created_at,last_sign_in_at:u.last_sign_in_at}))}; break;
   }
   case 'create-guild': {
    const name=String(b.name||'').trim(),code=String(b.code||'').trim().toUpperCase(); if(name.length<2||name.length>80||! /^[A-Z0-9-]{3,32}$/.test(code)) throw new Error('Valid guild name and code required');
    const {data,error}=await admin.from('guilds').insert({name,guild_code:code}).select('id').single(); if(error) throw error;
    const {error:workspaceError}=await admin.from('guild_workspaces').insert({guild_id:data.id,workspace:{players:[],pool:[]}});
    if(workspaceError){await admin.from('guilds').delete().eq('id',data.id);throw workspaceError;}
    result={id:data.id}; await audit(admin,user.id,action,{name,code},undefined,data.id); break;
   }
   case 'update-guild': {
    const patch:Record<string,unknown>={}; if(typeof b.name==='string') patch.name=b.name.trim();
    if(typeof b.code==='string'){const code=b.code.trim().toUpperCase();if(!/^[A-Z0-9-]{3,32}$/.test(code))throw new Error('Invalid guild code');patch.guild_code=code;}
    if(typeof b.status==='string'&&['active','suspended'].includes(b.status)) patch.status=b.status;
    const {error}=await admin.from('guilds').update(patch).eq('id',b.guild_id); if(error) throw error; await audit(admin,user.id,action,{patch},undefined,String(b.guild_id)); break;
   }
   case 'delete-guild': {
    const gid=String(b.guild_id||''); if(!gid) throw new Error('guild_id required');
    const paths:string[]=[];
    const collect=async(prefix:string)=>{let offset=0;for(;;){const {data:objects,error}=await admin.storage.from('guild-files').list(prefix,{limit:100,offset});if(error)throw error;for(const o of objects||[]){const path=`${prefix}/${o.name}`;if(o.id)paths.push(path);else await collect(path);}if(!objects||objects.length<100)break;offset+=objects.length;}};
    await collect(gid);
    for(let i=0;i<paths.length;i+=100){const {error}=await admin.storage.from('guild-files').remove(paths.slice(i,i+100));if(error)throw error;}
    const {error}=await admin.from('guilds').delete().eq('id',gid); if(error) throw error; await audit(admin,user.id,action,{deleted:true},undefined,gid); break;
   }
   case 'review-registration': {
    const {data:r,error}=await admin.from('guild_registration_requests').select('*').eq('id',b.request_id).eq('status','pending').single(); if(error) throw error;
    let createdGuild:string|undefined;
    try {
     if(b.approve){const {data:g,error:ge}=await admin.from('guilds').insert({name:r.requested_name,guild_code:r.requested_code}).select('id').single(); if(ge) throw ge; createdGuild=g.id;
      const {error:we}=await admin.from('guild_workspaces').insert({guild_id:g.id,workspace:{players:[],pool:[]}}); if(we) throw we;
      const {error:me}=await admin.from('guild_memberships').insert({guild_id:g.id,user_id:r.requester_id,role:'guild_admin'}); if(me) throw me;
     }
     const {error:re}=await admin.from('guild_registration_requests').update({status:b.approve?'approved':'rejected',reviewed_by:user.id,reviewed_at:new Date().toISOString()}).eq('id',r.id); if(re) throw re;
    } catch(error) { if(createdGuild) await admin.from('guilds').delete().eq('id',createdGuild); throw error; }
    await audit(admin,user.id,action,{request_id:r.id,approved:!!b.approve}); break;
   }
   case 'create-user': {
    const email=String(b.email||'').trim().toLowerCase(),username=String(b.username||'').trim(); if(!email||!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error('Valid email and username required');
    if(b.guild_id&&!validRole(String(b.role))) throw new Error('Invalid guild role');
    const {data:u,error}=await admin.auth.admin.inviteUserByEmail(email); if(error) throw error;
    const {error:pe}=await admin.from('profiles').insert({user_id:u.user.id,username,display_name:String(b.display_name||'')}); if(pe) {await admin.auth.admin.deleteUser(u.user.id); throw pe;}
    if(b.guild_id){const {error:me}=await admin.from('guild_memberships').insert({guild_id:b.guild_id,user_id:u.user.id,role:b.role}); if(me) {await admin.auth.admin.deleteUser(u.user.id); throw me;}}
    await audit(admin,user.id,action,{username,email},u.user.id,b.guild_id); result={user_id:u.user.id}; break;
   }
   case 'set-username': {
    if(!/^[A-Za-z0-9_.-]{3,32}$/.test(String(b.username||''))) throw new Error('Invalid username');
    const {error}=await admin.from('profiles').update({username:b.username.trim(),updated_at:new Date().toISOString()}).eq('user_id',b.user_id); if(error) throw error;
    await audit(admin,user.id,action,{username:b.username},String(b.user_id)); break;
   }
   case 'set-role': {
    if(String(b.user_id)===user.id) throw new Error('You cannot change your own role');
    if(!validRole(String(b.role))) throw new Error('Invalid guild role');
    const {error}=await admin.from('guild_memberships').upsert({guild_id:b.guild_id,user_id:b.user_id,role:b.role}); if(error) throw error;
    await audit(admin,user.id,action,{role:b.role},String(b.user_id),String(b.guild_id)); break;
   }
   case 'remove-membership': {
    const {error}=await admin.from('guild_memberships').delete().eq('guild_id',b.guild_id).eq('user_id',b.user_id); if(error) throw error;
    await audit(admin,user.id,action,{},String(b.user_id),String(b.guild_id)); break;
   }
   case 'set-account-status': {
    const status=b.status==='suspended'?'suspended':'active';
    const {data:primary,error:pe}=await admin.from('platform_admins').select('is_primary').eq('user_id',b.user_id).maybeSingle(); if(pe) throw pe;
    if(primary?.is_primary && status==='suspended') throw new Error('The primary Main Admin account cannot be suspended');
    const {error}=await admin.from('profiles').update({status,updated_at:new Date().toISOString()}).eq('user_id',b.user_id); if(error) throw error;
    const {error:ae}=await admin.auth.admin.updateUserById(b.user_id,{ban_duration:status==='suspended'?'876000h':'none'}); if(ae) throw ae;
    await audit(admin,user.id,action,{status},String(b.user_id)); break;
   }
   case 'send-password-reset': {
    const {data:u,error}=await admin.auth.admin.getUserById(b.user_id); if(error||!u.user?.email) throw error||new Error('User email unavailable');
    const {error:re}=await admin.auth.resetPasswordForEmail(u.user.email); if(re) throw re;
    await audit(admin,user.id,action,{delivery:'email'},String(b.user_id)); result={ok:true,message:'Password reset email sent; no password was exposed.'}; break;
   }
   case 'delete-user': {
    if(String(b.user_id)===user.id) throw new Error('Main Admin cannot delete the currently signed-in account');
    const {data:primary,error:pe}=await admin.from('platform_admins').select('is_primary').eq('user_id',b.user_id).maybeSingle(); if(pe) throw pe;
    if(primary?.is_primary) throw new Error('The primary Main Admin account cannot be deleted');
    const {error}=await admin.auth.admin.deleteUser(b.user_id); if(error) throw error;
    await audit(admin,user.id,action,{deleted:true},String(b.user_id)); break;
   }
   case 'set-setting': {
    const key=String(b.key||''); if(!/^[a-z][a-z0-9_]{1,63}$/.test(key)) throw new Error('Invalid setting key');
    const {error}=await admin.from('platform_settings').upsert({setting_key:key,value:b.value,updated_by:user.id,updated_at:new Date().toISOString()}); if(error) throw error;
    await audit(admin,user.id,action,{key}); break;
   }
   default: throw new Error('Unsupported admin action');
  }
  return respond(result);
 } catch(error) { const message=error instanceof Error?error.message:'Request failed'; return respond({error:message},message.includes('permission')||message.includes('Admin')?403:400); }
});
