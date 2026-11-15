import { adminClient, cors, publicClient, respond } from '../_shared/http.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(req.method!=='POST') return respond({error:'POST required'},405);
 try {
  const {email,password,username}=await req.json();
  if(typeof email!=='string'||email.trim().length>320||!/^\S+@\S+\.\S+$/.test(email.trim())||typeof password!=='string'||password.length<12||password.length>128||typeof username!=='string'||!/^[A-Za-z0-9_.-]{3,32}$/.test(username.trim())||username.trim().toLowerCase()==='nitesh') return respond({error:'Enter a valid email, username, and password between 12 and 128 characters. The username nitesh is reserved.'},400);
  const {data,error}=await publicClient().auth.signUp({email:email.trim(),password}); if(error) throw error;
  if(data.user){const admin=adminClient();const {error:pe}=await admin.from('profiles').insert({user_id:data.user.id,username:username.trim()}); if(pe){await admin.auth.admin.deleteUser(data.user.id);throw pe;}}
  return respond({ok:true,confirmation_required:!data.session});
 } catch(error){return respond({error:error instanceof Error?error.message:'Registration failed'},400)}
});
