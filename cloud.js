/* Strawberry Strategic Planner — secure multi-guild cloud adapter.
   The database policies are the security boundary; this file is only the UI/client. */
(function () {
  'use strict';
  const $ = (s, root=document) => root.querySelector(s);
  const url = window.STRAWBERRY_SUPABASE_URL;
  const key = window.STRAWBERRY_SUPABASE_ANON_KEY;
  const validConfig = url && key && !url.includes('PASTE_') && !key.includes('PASTE_');
  const root = document.createElement('div');
  root.id = 'sp-cloud-root';
  document.body.appendChild(root);

  const css = document.createElement('style');
  css.textContent = `
  #sp-cloud-root{position:fixed;inset:0;z-index:999999;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#20232a}
  #sp-cloud-root .shade{position:absolute;inset:0;background:rgba(9,12,18,.78);display:grid;place-items:center;padding:16px;overflow:auto}
  #sp-cloud-root .panel{background:#fff;color:#20232a;width:min(560px,100%);max-height:92vh;overflow:auto;border-radius:18px;padding:22px;box-shadow:0 18px 70px #0006}
  #sp-cloud-root h2{font-size:22px;margin:0 0 8px} #sp-cloud-root p{color:#596273;margin:6px 0 14px}
  #sp-cloud-root label{display:block;font-weight:650;margin:12px 0 5px}
  #sp-cloud-root input,#sp-cloud-root select,#sp-cloud-root textarea{width:100%;box-sizing:border-box;border:1px solid #cbd1dc;border-radius:9px;padding:11px;font:inherit;background:#fff;color:#20232a}
  #sp-cloud-root button{border:0;border-radius:9px;padding:10px 14px;font:600 14px system-ui;cursor:pointer;background:#202b42;color:#fff;margin:8px 6px 0 0}
  #sp-cloud-root button.secondary{background:#e9edf4;color:#20232a} #sp-cloud-root button.danger{background:#9f2535}
  #sp-cloud-root .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  #sp-cloud-root .muted{font-size:12px;color:#6b7280} #sp-cloud-root .error{color:#a21d2c;white-space:pre-wrap}
  #sp-cloud-root .success{color:#087443} #sp-cloud-root .hidden{display:none!important}
  #sp-cloud-root .item{border:1px solid #e0e4eb;border-radius:10px;padding:12px;margin:9px 0}
  #sp-cloud-root .topbar{position:fixed;z-index:999998;top:10px;right:12px;background:#172033;color:#fff;border-radius:12px;padding:8px 10px;box-shadow:0 3px 14px #0003}
  body.sp-readonly #map{pointer-events:none!important} body.sp-readonly #list{pointer-events:none!important}
  body.sp-readonly #pool{pointer-events:none!important}
  body.sp-readonly > :not(#sp-cloud-root){pointer-events:none!important}
  body.sp-planner #bManage,body.sp-planner #bManageP,body.sp-planner #bPlayers,
  body.sp-planner #bAdd,body.sp-planner #bImportNames,body.sp-planner #bImportMembers,
  body.sp-planner #bScanM,body.sp-planner #bScanA{display:none!important}
  `;
  document.head.appendChild(css);

  let sb=null, session=null, activeGuild=null, activeRole=null, user=null, saveTimer=null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function shell(inner) {
    root.innerHTML = `<div class="shade"><section class="panel">${inner}</section></div>`;
  }
  function msg(s, cls='') { const el=$('#sp-msg'); if(el){el.className=cls;el.textContent=s;} }
  function configScreen() {
    shell(`<h2>Strawberry Cloud Setup</h2><p>The planner file is ready, but it needs your Supabase project URL and public anon/publishable key.</p>
      <p class="error">Open <b>config.js</b> and replace both PASTE_ values. Do not paste a service-role key.</p>
      <p class="muted">The existing offline planner remains available after cloud setup; this screen does not send your data anywhere until configured.</p>`);
  }
  function authScreen() {
    shell(`<h2>Strawberry Strategic Planner</h2><p>Sign in to access your guild's private workspace.</p>
      <label>Username</label><input id="sp-username" autocomplete="username">
      <label>Password</label><input id="sp-pass" type="password" autocomplete="current-password">
      <div class="row"><button id="sp-login">Sign in</button><button class="secondary" id="sp-signup">Create account</button></div>
      <p id="sp-msg"></p><p class="muted">Use your own account. Main Admin signs in as nitesh.</p>`);
    $('#sp-login').onclick=()=>auth(false);
    $('#sp-signup').onclick=()=>auth(true);
  }
  async function auth(signup) {
    msg('Please wait…');
    const username=$('#sp-username').value.trim(), password=$('#sp-pass').value;
    if(!username || password.length<12){msg('Enter a username and password of at least 12 characters.','error');return;}
    if(signup){
      const email=prompt('Enter your email for account confirmation and recovery:'); if(!email)return;
      const r=await fetch(`${url}/functions/v1/register-account`,{method:'POST',headers:{'Content-Type':'application/json','apikey':key},body:JSON.stringify({email,password,username})});
      const d=await r.json(); msg(d.error||'Account created. Check your email to confirm, then sign in.',d.error?'error':'success'); return;
    }
    const r=await fetch(`${url}/functions/v1/username-login`,{method:'POST',headers:{'Content-Type':'application/json','apikey':key},body:JSON.stringify({username,password})});
    const d=await r.json(); if(!r.ok){msg(d.error||'Sign in failed','error');return;}
    const stored=await sb.auth.setSession({access_token:d.session.access_token,refresh_token:d.session.refresh_token});
    if(stored.error){msg(stored.error.message,'error');return;} session=stored.data.session; user=session.user; await loadMemberships();
  }
  async function loadMemberships() {
    const {data:platformRow}=await sb.from('platform_admins').select('user_id').eq('user_id',user.id).maybeSingle();
    const {data,error}=await sb.from('guild_memberships').select('role,guild_id,guilds(id,guild_code,name,status)').eq('user_id',user.id);
    if(error){authScreen();msg(error.message,'error');return;}
    const memberships=(data||[]).filter(x=>x.guilds && x.guilds.status==='active');
    if(platformRow && !memberships.length){await platformScreen();return;}
    if(!memberships.length){requestScreen();return;}
    if(memberships.length===1){await enterGuild(memberships[0]);return;}
    shell(`<h2>Choose your guild</h2><p>Your account belongs to more than one guild.</p>
      ${memberships.map((m,i)=>`<div class="item"><b>${esc(m.guilds.name)}</b><div class="muted">${esc(m.guilds.guild_code)} · ${esc(m.role)}</div><button data-g="${i}">Open guild</button></div>`).join('')}`);
    root.querySelectorAll('[data-g]').forEach(b=>b.onclick=()=>enterGuild(memberships[+b.dataset.g]));
  }
  function requestScreen() {
    shell(`<h2>Request guild access</h2><p>Your account is signed in but is not yet a member of an active guild.</p>
      <label>Guild ID (if your guild already exists)</label><input id="sp-guild-code" placeholder="e.g. STRAWBERRY-01">
      <button id="sp-join">Request access</button>
      <hr><h2>Register a new guild</h2>
      <label>Guild name</label><input id="sp-guild-name">
      <label>Requested Guild ID</label><input id="sp-request-code" placeholder="Letters, numbers and hyphens">
      <label>Contact / reason</label><textarea id="sp-reason" rows="3"></textarea>
      <button id="sp-request">Submit registration request</button>
      <div id="sp-msg"></div><button class="secondary" id="sp-out">Sign out</button>`);
    $('#sp-join').onclick=async()=>{
      const code=$('#sp-guild-code').value.trim().toUpperCase(); if(!code)return msg('Enter your Guild ID.','error');
      const {data,error}=await sb.rpc('request_guild_membership',{p_guild_code:code});
      msg(error?error.message:'Access request sent. A guild admin must approve it.',error?'error':'success');
    };
    $('#sp-request').onclick=async()=>{
      const name=$('#sp-guild-name').value.trim(), code=$('#sp-request-code').value.trim().toUpperCase();
      if(!name||!code)return msg('Enter both a guild name and requested ID.','error');
      const {error}=await sb.from('guild_registration_requests').insert({requested_name:name,requested_code:code,contact_note:$('#sp-reason').value.trim()});
      msg(error?error.message:'Registration request submitted to the platform owner.',error?'error':'success');
    };
    $('#sp-out').onclick=()=>sb.auth.signOut().then(authScreen);
  }
  async function enterGuild(m) {
    activeGuild=m.guilds; activeRole=m.role;
    const {data,error}=await sb.from('guild_workspaces').select('workspace').eq('guild_id',activeGuild.id).maybeSingle();
    if(error){shell(`<h2>Could not load guild</h2><p class="error">${esc(error.message)}</p><button id="sp-back">Back</button>`);$('#sp-back').onclick=loadMemberships;return;}
    // Always replace the in-memory state when switching guilds. This prevents
    // a previous guild's local/offline data from remaining visible in a new guild.
    if(window.__strawberryAdopt) {
      if(data?.workspace && Array.isArray(data.workspace.players)) window.__strawberryAdopt(JSON.stringify(data.workspace));
      else window.__strawberryAdopt(JSON.stringify({players:[],pool:[]}));
    }
    window.__strawberrySetReadOnly?.(activeRole==='member');
    document.body.classList.toggle('sp-planner',activeRole==='planner');
    root.innerHTML=`<div class="topbar">Guild: ${esc(activeGuild.name)} · ${esc(activeRole)} <button id="sp-switch" class="secondary">Guild</button> <button id="sp-admin" class="secondary">Panel</button> <button id="sp-logout" class="secondary">Sign out</button></div>`;
    $('#sp-switch').onclick=loadMemberships;
    $('#sp-logout').onclick=()=>sb.auth.signOut().then(()=>{activeGuild=null;authScreen()});
    $('#sp-admin').onclick=async()=>{const p=await sb.from('platform_admins').select('user_id').eq('user_id',user.id).maybeSingle(); if(p.data) platformScreen(); else controlPanel();};
    if(activeRole==='member') participationButton();
  }
  function participationButton(){
    const b=document.createElement('button'); b.textContent='My participation'; b.style.cssText='position:fixed;z-index:999997;right:14px;top:62px;background:#246a52;color:white;border:0;border-radius:9px;padding:10px;cursor:pointer';
    b.onclick=async()=>{
      shell(`<h2>Participation entry</h2><p>Submit your name for this guild's plan. This does not grant editing access.</p><label>Your name</label><input id="sp-pname" maxlength="60"><label>Participation note (optional)</label><input id="sp-pnote" maxlength="200"><button id="sp-submit">Submit</button><button class="secondary" id="sp-cancel">Cancel</button><p id="sp-msg"></p>`);
      $('#sp-cancel').onclick=()=>enterGuild({guilds:activeGuild,role:activeRole});
      $('#sp-submit').onclick=async()=>{
        const name=$('#sp-pname').value.trim(); if(!name)return msg('Enter your name.','error');
        const {error}=await sb.from('participation_entries').insert({guild_id:activeGuild.id,display_name:name,note:$('#sp-pnote').value.trim()});
        msg(error?error.message:'Participation submitted.',error?'error':'success');
      };
    };
    root.appendChild(b);
  }
  async function platformScreen(){
    const call=async(action,payload={})=>{const {data}=await sb.auth.getSession();const res=await fetch(`${url}/functions/v1/platform-admin`,{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':`Bearer ${data.session.access_token}`},body:JSON.stringify({action,...payload})});const body=await res.json();if(!res.ok)throw new Error(body.error||'Admin request failed');return body;};
    let d; try{d=await call('dashboard')}catch(e){shell(`<h2>Platform administration</h2><p class="error">${esc(e.message)}</p><button id="sp-close">Back</button>`);$('#sp-close').onclick=loadMemberships;return;}
    const membersFor=g=>(d.memberships||[]).filter(m=>m.guild_id===g.id);
    shell(`<h2>Main Admin dashboard</h2><p>Platform owner · privileged actions run on the server and are audited.</p>
      <h3>Create guild</h3><label>Guild name</label><input id="sp-new-name"><label>Guild ID</label><input id="sp-new-code"><button id="sp-create">Create guild</button>
      <h3>Guild registration requests</h3>${(d.registrations||[]).filter(r=>r.status==='pending').map(x=>`<div class="item">${esc(x.requested_name)} · ${esc(x.requested_code)}<p>${esc(x.contact_note||'')}</p><button data-reg="${x.id}" data-approve="true">Approve</button><button class="danger" data-reg="${x.id}" data-approve="false">Reject</button></div>`).join('')||'<p>No pending requests.</p>'}
      <h3>Guilds and memberships</h3>${(d.guilds||[]).map(g=>`<div class="item"><b>${esc(g.name)}</b> · ${esc(g.guild_code)} · ${esc(g.status)}<div class="row"><input data-guild-name="${g.id}" value="${esc(g.name)}"><input data-guild-code="${g.id}" value="${esc(g.guild_code)}"><button data-save-guild="${g.id}">Save guild</button><button data-guild="${g.id}" data-status="${g.status==='active'?'suspended':'active'}">${g.status==='active'?'Suspend':'Reactivate'}</button><button class="danger" data-delete-guild="${g.id}">Delete guild</button></div>${membersFor(g).map(m=>{const p=d.profiles.find(x=>x.user_id===m.user_id);return `<div class="row">${esc(p?.username||m.user_id)} <select data-role-user="${m.user_id}" data-role-guild="${g.id}"><option value="guild_admin" ${m.role==='guild_admin'?'selected':''}>Guild Admin</option><option value="planner" ${m.role==='planner'?'selected':''}>Planner</option><option value="member" ${m.role==='member'?'selected':''}>Member</option></select><button data-remove="${m.user_id}" data-remove-guild="${g.id}">Remove</button></div>`}).join('')}</div>`).join('')||'<p>No guilds.</p>'}
      <h3>Accounts</h3><label>Email</label><input id="sp-user-email"><label>Username</label><input id="sp-user-name"><label>Guild (optional)</label><select id="sp-user-guild"><option value="">No guild</option>${(d.guilds||[]).map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select><label>Guild role</label><select id="sp-user-role"><option value="guild_admin">Guild Admin</option><option value="planner">Planner</option><option value="member">Member</option></select><button id="sp-add-user">Invite account</button>
      ${(d.profiles||[]).map(p=>{const u=(d.users||[]).find(x=>x.id===p.user_id);return `<div class="item">${esc(p.username)} · ${esc(u?.email||'')} · ${esc(p.status)}<div class="row"><input data-rename="${p.user_id}" value="${esc(p.username)}"><button data-save-name="${p.user_id}">Change username</button><button data-reset="${p.user_id}">Send password reset</button><button data-suspend="${p.user_id}" data-status="${p.status==='active'?'suspended':'active'}">${p.status==='active'?'Suspend':'Reactivate'}</button>${p.user_id!==user.id?`<button class="danger" data-delete-user="${p.user_id}">Delete account</button>`:''}</div></div>`}).join('')}
      <h3>Platform settings</h3><label>Setting key</label><input id="sp-setting-key"><label>JSON value</label><textarea id="sp-setting-value" rows="3">{}</textarea><button id="sp-setting-save">Save setting</button>${(d.settings||[]).map(s=>`<div class="item">${esc(s.setting_key)} · ${esc(JSON.stringify(s.value))}</div>`).join('')}
      <h3>Platform audit log (latest 1,000)</h3>${(d.audit||[]).map(a=>`<div class="item">${esc(a.created_at)} · ${esc(a.action)} · ${esc(JSON.stringify(a.details))}</div>`).join('')}
      <p id="sp-msg"></p><button class="secondary" id="sp-close">Close</button><button class="secondary" id="sp-logout">Sign out</button>`);
    const run=async(action,payload)=>{try{await call(action,payload);await platformScreen()}catch(e){msg(e.message,'error')}};
    $('#sp-create').onclick=()=>run('create-guild',{name:$('#sp-new-name').value,code:$('#sp-new-code').value});
    $('#sp-add-user').onclick=()=>run('create-user',{email:$('#sp-user-email').value,username:$('#sp-user-name').value,guild_id:$('#sp-user-guild').value||null,role:$('#sp-user-role').value});
    root.querySelectorAll('[data-reg]').forEach(b=>b.onclick=()=>run('review-registration',{request_id:b.dataset.reg,approve:b.dataset.approve==='true'}));
    root.querySelectorAll('[data-guild]').forEach(b=>b.onclick=()=>run('update-guild',{guild_id:b.dataset.guild,status:b.dataset.status}));
    root.querySelectorAll('[data-save-guild]').forEach(b=>b.onclick=()=>run('update-guild',{guild_id:b.dataset.saveGuild,name:$(`[data-guild-name="${b.dataset.saveGuild}"]`).value,code:$(`[data-guild-code="${b.dataset.saveGuild}"]`).value}));
    root.querySelectorAll('[data-delete-guild]').forEach(b=>b.onclick=()=>{if(confirm('Delete this guild and its data?'))run('delete-guild',{guild_id:b.dataset.deleteGuild})});
    root.querySelectorAll('[data-role-user]').forEach(s=>s.onchange=()=>run('set-role',{guild_id:s.dataset.roleGuild,user_id:s.dataset.roleUser,role:s.value}));
    root.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>run('remove-membership',{guild_id:b.dataset.removeGuild,user_id:b.dataset.remove}));
    root.querySelectorAll('[data-save-name]').forEach(b=>b.onclick=()=>run('set-username',{user_id:b.dataset.saveName,username:$(`[data-rename="${b.dataset.saveName}"]`).value}));
    root.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>run('send-password-reset',{user_id:b.dataset.reset}));
    root.querySelectorAll('[data-suspend]').forEach(b=>b.onclick=()=>run('set-account-status',{user_id:b.dataset.suspend,status:b.dataset.status}));
    root.querySelectorAll('[data-delete-user]').forEach(b=>b.onclick=()=>{if(confirm('Permanently delete this user account?'))run('delete-user',{user_id:b.dataset.deleteUser})});
    $('#sp-setting-save').onclick=()=>{try{const value=JSON.parse($('#sp-setting-value').value);run('set-setting',{key:$('#sp-setting-key').value,value})}catch(e){msg('Enter valid JSON for the setting value.','error')}};
    $('#sp-close').onclick=loadMemberships; $('#sp-logout').onclick=()=>sb.auth.signOut().then(authScreen);
    $('#sp-logout').onclick=()=>sb.auth.signOut().then(authScreen);
  }
  async function controlPanel(){
    const platform=await sb.from('platform_admins').select('user_id').eq('user_id',user.id).maybeSingle();
    const isPlatform=!platform.error && !!platform.data;
    const {data:members}=await sb.from('guild_memberships').select('user_id,role').eq('guild_id',activeGuild.id);
    const {data:profiles}=await sb.from('profiles').select('user_id,username').in('user_id',(members||[]).map(m=>m.user_id));
    const {data:requests}=await sb.from('guild_membership_requests').select('id,user_id,status,created_at').eq('guild_id',activeGuild.id).eq('status','pending');
    let extra='';
    if(isPlatform){
      const {data:gr}=await sb.from('guild_registration_requests').select('id,requested_name,requested_code,contact_note,status').eq('status','pending');
      extra=`<h3>Platform registration requests</h3>${(gr||[]).map(x=>`<div class="item">${esc(x.requested_name)} · ${esc(x.requested_code)}<p>${esc(x.contact_note||'')}</p><button data-approve-reg="${x.id}">Approve & create guild</button><button class="danger" data-reject-reg="${x.id}">Reject</button></div>`).join('')}`;
    }
    shell(`<h2>${esc(activeGuild.name)} · Control panel</h2><p>Role: ${esc(activeRole)}. Server-side database policies remain authoritative.</p>
      ${activeRole==='guild_admin'?`<h3>Guild accounts</h3><label>Invite email</label><input id="sp-invite-email"><label>Username</label><input id="sp-invite-username"><label>Role</label><select id="sp-invite-role"><option value="member">Member</option><option value="planner">Planner</option><option value="guild_admin">Guild Admin</option></select><button id="sp-invite">Invite account</button>${(members||[]).map(m=>`<div class="item">${esc(profiles?.find(p=>p.user_id===m.user_id)?.username||m.user_id)}<select data-member-role="${m.user_id}"><option value="guild_admin" ${m.role==='guild_admin'?'selected':''}>Guild Admin</option><option value="planner" ${m.role==='planner'?'selected':''}>Planner</option><option value="member" ${m.role==='member'?'selected':''}>Member</option></select><button data-member-remove="${m.user_id}">Remove</button></div>`).join('')}`:''}
      <h3>Pending membership requests</h3>${(requests||[]).map(x=>`<div class="item">User: ${esc(x.user_id)}<button data-approve-member="${x.id}">Approve as member</button><button class="danger" data-reject-member="${x.id}">Reject</button></div>`).join('')||'<p>No pending requests.</p>'}
      ${isPlatform?`<h3>Create guild directly</h3><label>Name</label><input id="sp-new-name"><label>Guild ID</label><input id="sp-new-code"><label>First Guild Admin user UUID</label><input id="sp-first-admin"><button id="sp-create">Create guild</button>${extra}`:''}
      <button class="secondary" id="sp-close">Close</button><p id="sp-msg"></p>`);
    $('#sp-close').onclick=()=>enterGuild({guilds:activeGuild,role:activeRole});
    const guildAdminCall=async(payload)=>{const {data:s}=await sb.auth.getSession();const res=await fetch(`${url}/functions/v1/guild-admin`,{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':`Bearer ${s.session.access_token}`},body:JSON.stringify({guild_id:activeGuild.id,...payload})});const body=await res.json();if(!res.ok)throw new Error(body.error||'Guild action failed');};
    if(activeRole==='guild_admin'){
      $('#sp-invite').onclick=async()=>{try{await guildAdminCall({action:'invite-member',email:$('#sp-invite-email').value,username:$('#sp-invite-username').value,role:$('#sp-invite-role').value});controlPanel()}catch(e){msg(e.message,'error')}};
      root.querySelectorAll('[data-member-role]').forEach(s=>s.onchange=async()=>{try{await guildAdminCall({action:'set-role',user_id:s.dataset.memberRole,role:s.value});controlPanel()}catch(e){msg(e.message,'error')}});
      root.querySelectorAll('[data-member-remove]').forEach(b=>b.onclick=async()=>{try{await guildAdminCall({action:'remove-member',user_id:b.dataset.memberRemove});controlPanel()}catch(e){msg(e.message,'error')}});
    }
    root.querySelectorAll('[data-approve-member]').forEach(b=>b.onclick=async()=>{const {error}=await sb.rpc('review_guild_membership',{p_request_id:b.dataset.approveMember,p_approve:true});msg(error?.message||'Membership approved.',error?'error':'success');controlPanel()});
    root.querySelectorAll('[data-reject-member]').forEach(b=>b.onclick=async()=>{const {error}=await sb.rpc('review_guild_membership',{p_request_id:b.dataset.rejectMember,p_approve:false});msg(error?.message||'Request rejected.',error?'error':'success');controlPanel()});
    if(isPlatform){
      $('#sp-create').onclick=async()=>{const {error}=await sb.rpc('create_guild',{p_name:$('#sp-new-name').value.trim(),p_code:$('#sp-new-code').value.trim().toUpperCase(),p_admin_user:$('#sp-first-admin').value.trim()||null});msg(error?.message||'Guild created.',error?'error':'success')};
      root.querySelectorAll('[data-approve-reg]').forEach(b=>b.onclick=async()=>{const {error}=await sb.rpc('review_guild_registration',{p_request_id:b.dataset.approveReg,p_approve:true});msg(error?.message||'Guild approved.',error?'error':'success');controlPanel()});
      root.querySelectorAll('[data-reject-reg]').forEach(b=>b.onclick=async()=>{const {error}=await sb.rpc('review_guild_registration',{p_request_id:b.dataset.rejectReg,p_approve:false});msg(error?.message||'Request rejected.',error?'error':'success');controlPanel()});
    }
  }
  async function cloudSave(workspace){
    if(!sb || !activeGuild || !['guild_admin','planner'].includes(activeRole))return;
    clearTimeout(saveTimer);
    saveTimer=setTimeout(async()=>{
      const {error}=await sb.from('guild_workspaces').upsert({guild_id:activeGuild.id,workspace,updated_at:new Date().toISOString()},{onConflict:'guild_id'});
      if(error) console.warn('Cloud save blocked or failed:',error.message);
    },700);
  }
  async function start(){
    if(!validConfig){configScreen();return;}
    if(!window.supabase?.createClient){shell('<h2>Cloud library did not load</h2><p>Check your internet connection and reload.</p>');return;}
    sb=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    sb.auth.onAuthStateChange((event,s)=>{session=s;if(event==='SIGNED_IN'&&s){user=s.user;setTimeout(loadMemberships,0)}else if(event==='SIGNED_OUT'){user=null;activeGuild=null;activeRole=null;}});
    const {data}=await sb.auth.getSession();
    if(data.session){session=data.session;user=session.user;await loadMemberships();}else authScreen();
    window.addEventListener('strawberry:local-save',e=>cloudSave(e.detail));
  }
  start().catch(e=>{shell(`<h2>Startup error</h2><p class="error">${esc(e.message||e)}</p>`);});
})();
