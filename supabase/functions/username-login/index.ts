import { adminClient, cors, publicClient, respond } from '../_shared/http.ts';
async function loginKey(username:string) {
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(username.trim().toLowerCase()));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
const limited=(retry:number)=>new Response(JSON.stringify({error:'Too many sign-in attempts. Try again later.'}),{status:429,headers:{...cors,'Content-Type':'application/json','Retry-After':String(Math.max(1,retry))}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(req.method!=='POST') return respond({error:'POST required'},405);
 try {
  const {username,password}=await req.json();
  if(typeof username!=='string'||!/^[A-Za-z0-9_.-]{3,32}$/.test(username.trim())||typeof password!=='string'||password.length<1||password.length>128) return respond({error:'Username and password are required'},400);
  const admin=adminClient();
  const key=await loginKey(username);
  const {data:remaining,error:limitError}=await admin.rpc('login_rate_limit_remaining',{p_key:key});
  if(limitError) throw limitError;
  if(remaining>0) return limited(remaining);
  const fail=async()=>{const {data,error}=await admin.rpc('record_login_failure',{p_key:key});if(error)throw error;return Number(data||0)};
  const {data:profile,error}=await admin.from('profiles').select('user_id,status').ilike('username',username.trim()).maybeSingle();
  if(error||!profile||profile.status!=='active') {const retry=await fail();return retry>0?limited(retry):respond({error:'Invalid username or password'},401)}
  const {data:userData,error:userErr}=await admin.auth.admin.getUserById(profile.user_id);
  if(userErr||!userData.user?.email) {const retry=await fail();return retry>0?limited(retry):respond({error:'Invalid username or password'},401)}
  const {data,error:loginErr}=await publicClient().auth.signInWithPassword({email:userData.user.email,password});
  if(loginErr||!data.session) {const retry=await fail();return retry>0?limited(retry):respond({error:'Invalid username or password'},401)}
  const {error:clearError}=await admin.rpc('clear_login_failures',{p_key:key});if(clearError)throw clearError;
  return respond({session:data.session,user:{id:data.user.id,email:data.user.email,username:username.trim()}});
 } catch(error){return respond({error:error instanceof Error?error.message:'Sign-in failed'},400)}
});
