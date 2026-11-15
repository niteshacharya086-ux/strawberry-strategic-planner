import { adminClient, cors, env, respond } from '../_shared/http.ts';

Deno.serve(async req => {
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(req.method!=='POST') return respond({error:'POST required'},405);
 let stage='read-bootstrap-secret'; let failureStage='';
 try {
  const expected=env('MAIN_ADMIN_BOOTSTRAP_TOKEN');
  const supplied=req.headers.get('x-bootstrap-token')||'';
  const expectedBytes=new TextEncoder().encode(expected), suppliedBytes=new TextEncoder().encode(supplied);
  let mismatch=expectedBytes.length ^ suppliedBytes.length;
  for(let i=0;i<Math.max(expectedBytes.length,suppliedBytes.length);i++) mismatch|=(expectedBytes[i]||0)^(suppliedBytes[i]||0);
  if(expectedBytes.length<32 || mismatch!==0) return respond({error:'Invalid bootstrap authorization'},403);
  stage='create-admin-client';
  const admin=adminClient();
  stage='check-one-time-state';
  const {data:already,error:checkErr}=await admin.from('platform_admins').select('user_id').eq('is_primary',true).maybeSingle();
  if(checkErr) throw checkErr;
  const {data:bootstrapped,error:stateErr}=await admin.from('platform_settings').select('value').eq('setting_key','main_admin_bootstrapped').maybeSingle();
  if(stateErr) throw stateErr;
  if(already || bootstrapped?.value===true) return respond({error:'Bootstrap is already complete'},409);
  stage='validate-input';
  const body=await req.json(); const email=String(body.email||'').trim().toLowerCase(); const password=String(body.password||'');
  if(email.length>320||!/^\S+@\S+\.\S+$/.test(email)||password.length<12||password.length>128) return respond({error:'Enter a valid private email and a password between 12 and 128 characters'},400);
  stage='create-auth-user';
  const {data:created,error:createErr}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{}});
  if(createErr) throw createErr;
  try {
   stage='create-primary-admin-record';
   const {error:adminErr}=await admin.from('platform_admins').insert({user_id:created.user.id,is_primary:true});
   if(adminErr) throw adminErr;
   stage='create-main-admin-profile';
   const {error:profileErr}=await admin.from('profiles').insert({user_id:created.user.id,username:'nitesh',display_name:'Main Admin'});
   if(profileErr) throw profileErr;
   stage='mark-bootstrap-complete';
   const {error:stateWriteErr}=await admin.from('platform_settings').insert({setting_key:'main_admin_bootstrapped',value:true,updated_by:created.user.id});
   if(stateWriteErr) throw stateWriteErr;
   stage='write-audit-entry';
   const {error:auditErr}=await admin.from('platform_audit_logs').insert({actor_id:created.user.id,action:'main_admin_bootstrapped',details:{username:'nitesh'}});
   if(auditErr) throw auditErr;
   return respond({ok:true,username:'nitesh',message:'Main Admin created. Remove MAIN_ADMIN_BOOTSTRAP_TOKEN from function secrets now.'});
  } catch(error) { failureStage=stage; await admin.auth.admin.deleteUser(created.user.id); throw error; }
 } catch(error) {
  const err=error as { name?:unknown; code?:unknown };
  const diagnosticId=failureStage||stage;
  console.error('Main Admin bootstrap failed', {diagnosticId, errorName:String(err?.name||'Error'), errorCode:String(err?.code||'unknown')});
  return respond({error:'Bootstrap failed',diagnostic_id:diagnosticId},500);
 }
});
