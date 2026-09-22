import {evaluateThinking, thinkingIsReady, thinkingText} from './thinking.js';
import {EMPTY, readProgress, saveProgress, mergeProgress, nextTimestamp, workFingerprint, stage, chooseNext, importLegacy, storageKey} from './progress.js';
import {createCloudSync} from './cloud.js';
import {renderSchemaCards} from './schema.js';
import {escapeHtml} from './util.js';
import {generateScenarioCatalog} from './scenario-generator.js';

const $ = id => document.getElementById(id);
let data, scenarios=[], ids=new Set(), state=EMPTY(), current=null, user=null;
let selectedDomain=null, selectedLevel=null, client=null, deferredPrompt=null, syncTimer=null;
let authNotice='';
let storage;
try { storage=window.localStorage; } catch { storage={getItem(){return null;},setItem(){throw Error('Storage unavailable');}}; }
const labels={not_started:'Not started',thinking:'Thinking in progress',answer_viewed:'Earlier answer viewed — thinking not assessed',thinking_ready:'Thinking score ready',sql_generated:'Reference SQL generated',fiddle_opened:'DB Fiddle opened — awaiting your confirmation',practice_confirmed:'DB Fiddle practice self-reported'};
const cloud=createCloudSync({
  client: {rpc(...args){return client.rpc(...args);}},
  getContext:()=>({userId:user?.id,state:structuredClone(state)}),
  onMerged(remote,owner) {
    if(owner!==user?.id) return;
    const before=current?JSON.stringify(state.entries[current.id]):null;
    state=mergeProgress(state,remote,ids);
    persist(false); updateProgress();
    // Local edits have their own timestamp and win over older cloud snapshots.
    if(current && before!==JSON.stringify(state.entries[current.id])) renderScenario();
  },
  onStatus:message=>{ $('syncStatus').textContent=message; }
});
function persist(sync=true) {
  const saved=saveProgress(storage,user?.id,state);
  if(!saved) $('syncStatus').textContent='Browser storage is unavailable. Keep this page open; local progress cannot be saved.';
  else if(!user) $('syncStatus').textContent='Guest progress saved on this device.';
  if(sync && user && client) {
    clearTimeout(syncTimer);
    syncTimer=setTimeout(()=>cloud.request(),500);
  }
}
function isAdmin() { return user?.app_metadata?.app_role==='admin'; }
function trackEvent(eventType,metadata={}) {
  if(client&&user) void client.from('usage_events').insert({user_id:user.id,event_type:eventType,metadata});
}
function entry() { return current ? state.entries[current.id] || {} : {}; }
function changeEntry(patch) {
  if(!current) return;
  state.entries[current.id]={...entry(),...patch,updatedAt:nextTimestamp(state)};
  persist(); updateProgress();
}
function readThinking() {
  return {response:$('thinking').value};
}
function updateProgress() {
  const prepared=data?.scenarios||scenarios;
  const stages=prepared.map(s=>stage(s,state.entries[s.id]));
  const confirmed=stages.filter(x=>x==='practice_confirmed').length;
  $('progressCount').textContent=confirmed+' / '+prepared.length;
  $('progressFill').style.width=(prepared.length ? confirmed/prepared.length*100 : 0)+'%';
  $('progressStages').textContent=stages.filter(x=>x!=='not_started').length+' started · '+
    stages.filter(x=>['thinking_ready','sql_generated','fiddle_opened','practice_confirmed'].includes(x)).length+' thinking ready · '+stages.filter(x=>['sql_generated','fiddle_opened','practice_confirmed'].includes(x)).length+' SQL generated · '+confirmed+' DB Fiddle confirmations';
  if(current) {
    $('learningStage').textContent=labels[stage(current,entry())];
    $('doneTag').classList.toggle('show',stage(current,entry())==='practice_confirmed');
    $('doneTag').textContent='Practice confirmed';
  }
  const generator=$('generateAfterAll');
  if(generator){generator.hidden=!user||!allPreparedSolved();$('generateScenarioButton').disabled=!selectedDomain||!selectedLevel;}
}
function allPreparedSolved(){return !!data?.scenarios?.length&&data.scenarios.every(s=>stage(s,state.entries[s.id])==='practice_confirmed');}
function renderAssessment(result) {
  $('feedback').classList.add('active');
  $('score').textContent='Thinking Score: '+(result?.score??0)+'/10';
  $('assessmentMessage').textContent=result?.message||'Start explaining your approach. Your score will update as you type.';
  $('improve').replaceChildren(...(result?.items||[]).map(item=>{
    const li=document.createElement('li');
    const points=Number(item.weight).toFixed(Number.isInteger(item.weight)?0:1);
    li.textContent=(item.passed?'✓ You covered: ':'Next thinking step: ')+item.label+' ('+points+' points)';return li;
  }));
  const started=!!$('thinking').value.trim();
  $('thinkingDecode').hidden=!started||!current;
  $('expectedThinking').textContent=started&&current?current.pseudo:'';
}
function updateGates() {
  const e=entry(),ready=current && thinkingIsReady(current,e),fingerprint=workFingerprint(e);
  const generated=!!(ready&&e.sqlGenerated&&e.referenceSql);
  $('sqlGenerateSection').hidden=!ready||generated;
  $('answerSection').hidden=!generated;
  $('referenceSql').textContent=generated?e.referenceSql:'';
  $('fiddleButton').disabled=!generated;
  $('copySetup').disabled=!generated;
  $('copyQuery').disabled=!generated;
  $('confirmDbFiddle').disabled=!generated||e.fiddleFingerprint!==fingerprint||e.externalValidationFingerprint===fingerprint;
  $('sqlGate').textContent='Copy the schema, sample data and reference SQL into DB Fiddle, then run the query there.';
  $('practiceStatus').textContent=current ? labels[stage(current,e)] : '';
  $('nextButton').disabled=!current||stage(current,e)!=='practice_confirmed';
}
function renderScenario() {
  if(!user||!current)return;
  $('home').classList.remove('active');$('practice').classList.add('active');
  $('meta').textContent=current.domain+' • '+current.level;
  $('title').textContent=current.id;$('question').textContent=current.question;
  const pool=scenarios.filter(s=>s.domain===current.domain&&s.level===current.level&&!!s.generated===!!current.generated);
  $('qno').textContent=(current.generated?'Generated ':'Exercise ')+current.questionNo+' / '+pool.length;
  $('tags').textContent=(current.generated?'New scenario · ':'')+'Think → Score → Generate SQL → Validate in DB Fiddle';
  renderSchemaCards(current.schemaText);
  const e=entry();
  $('thinking').value=thinkingText(e.thinking);
  $('fiddleFallback').hidden=true;$('manualCopy').hidden=true;
  renderAssessment(e.assessment?evaluateThinking(current,e.thinking||{}):null);
  updateProgress();updateGates();trackEvent('scenario_opened',{scenario_id:current.id,domain:current.domain,level:current.level});
}
function loadScenario() {
  if(!user||!selectedDomain||!selectedLevel) return;
  if(allPreparedSolved()){$('generateScenarioButton').disabled=false;$('generatorMessage').textContent='Your prepared scenario bank is complete. Select Generate a new scenario.';return;}
  const pool=(data?.scenarios||[]).filter(s=>s.domain===selectedDomain&&s.level===selectedLevel);
  current=chooseNext(pool,state,null)||pool[0];
  if(current) renderScenario();
}
function selectDomain(domain,el) {
  if(!user)return;
  selectedDomain=domain;document.querySelectorAll('.domain').forEach(x=>x.classList.toggle('active',x===el));loadScenario();
}
function selectLevel(level,el) {
  if(!user)return;
  selectedLevel=level;document.querySelectorAll('.level').forEach(x=>x.classList.toggle('active',x===el));loadScenario();
}
function evaluatePlan() {
  if(!user||!current) return;
  const thinking=readThinking(),assessment=evaluateThinking(current,thinking);
  changeEntry({thinking,assessment,sqlGenerated:false,referenceSql:'',fiddleFingerprint:null,externalValidationFingerprint:null});
  renderAssessment(assessment);updateGates();
}
function generateSql() {
  if(!user||!current||!thinkingIsReady(current,entry()))return;
  changeEntry({sqlGenerated:true,referenceSql:current.sql});
  trackEvent('sql_generated',{scenario_id:current.id,domain:current.domain,level:current.level});
  updateGates();
}
function nextScenario() {
  if(!user||!current || stage(current,entry())!=='practice_confirmed') {if(user)alert('Run the reference SQL in DB Fiddle and confirm that you checked its output before continuing.');return;}
  const pool=scenarios.filter(s=>s.domain===selectedDomain&&s.level===selectedLevel&&!!s.generated===!!current.generated);
  const next=chooseNext(pool,state,current.id);
  if(!next) {
    if(current.generated){$('nextButton').disabled=true;$('practiceStatus').textContent='You have completed the generated scenarios for this domain and level.';return;}
    if(allPreparedSolved()){goHome();$('generatorMessage').textContent='All prepared scenarios are complete. Generate a new scenario for more practice.';return;}
    current=pool[(pool.findIndex(s=>s.id===current.id)+1)%pool.length];renderScenario();
    $('practiceStatus').textContent='You have confirmed practice for all exercises in this selection. You are reviewing them again.';return;
  }
  current=next;renderScenario();
}
function generateNewScenario(){
  if(!user||!allPreparedSolved())return;
  if(!selectedDomain||!selectedLevel){$('generatorMessage').textContent='Choose a domain and level first.';return;}
  const pool=scenarios.filter(s=>s.generated&&s.domain===selectedDomain&&s.level===selectedLevel);
  const next=chooseNext(pool,state,null);
  if(!next){$('generatorMessage').textContent='You have completed the generated scenarios for this domain and level. Choose another domain or level to explore more.';return;}
  current=next;trackEvent('scenario_generated',{scenario_id:current.id,domain:current.domain,level:current.level});renderScenario();
}
function goHome() {$('practice').classList.remove('active');$('admin').classList.remove('active');$('home').classList.add('active');}
async function copy(text) {
  try {await navigator.clipboard.writeText(text);$('sqlGate').textContent='Copied. Paste into the appropriate DB Fiddle pane.';}
  catch {$('manualCopy').hidden=false;$('copyText').value=text;$('copyText').focus();$('copyText').select();}
}
function copySetup() {if(user&&current&&entry().sqlGenerated&&thinkingIsReady(current,entry()))void copy(data.assets[current.domain].schema+'\n\n'+data.assets[current.domain].sample);}
function copyQuery() {if(user&&current&&entry().sqlGenerated&&thinkingIsReady(current,entry()))void copy(entry().referenceSql||'');}
function runDbFiddle() {
  if(!user||!current||!entry().sqlGenerated||!thinkingIsReady(current,entry())) return;
  window.open('https://www.db-fiddle.com/','_blank','noopener,noreferrer');
  changeEntry({fiddleFingerprint:workFingerprint(entry())});
  trackEvent('dbfiddle_opened',{scenario_id:current.id,domain:current.domain,level:current.level});
  $('fiddleFallback').hidden=false;updateGates();
}
function confirmDbFiddle() {
  const e=entry(),fingerprint=workFingerprint(e);
  if(!user||!current||!thinkingIsReady(current,e)||e.fiddleFingerprint!==fingerprint)return;
  changeEntry({externalValidationFingerprint:fingerprint});
  trackEvent('practice_confirmed',{scenario_id:current.id,domain:current.domain,level:current.level});
  $('practiceStatus').textContent='Practice confirmation saved. DB Fiddle does not send its results to this app.';
  updateGates();
}
function resetProgress() {
  if(!confirm('Reset progress for '+(user?'this signed-in account':'this guest profile')+'? Other accounts will not be changed.'))return;
  const resetAt=nextTimestamp(state);state={...EMPTY(),resetAt};persist();updateProgress();
  if(current)renderScenario();
}
function importOldHistory() {
  if(!confirm('Earlier device history may belong to someone else. Import it into this profile only as “answer viewed”, without awarding thinking or SQL completion?'))return;
  let old;try{old=JSON.parse(storage.getItem('crackSqlProgress'));}catch{old=[];}
  state=importLegacy(old,state,data.aliases,ids);persist();updateProgress();if(current)renderScenario();
}
function importGuestProgress() {
  if(!user||!confirm('Import this device’s guest practice into your signed-in account?'))return;
  const guest=readProgress(storage,null,ids);
  // Explicit imports re-date entries so an intentional import works after a reset.
  const imported=structuredClone(guest);imported.resetAt=state.resetAt;
  let at=nextTimestamp(state);for(const e of Object.values(imported.entries))e.updatedAt=at++;
  state=mergeProgress(state,imported,ids);persist();updateProgress();if(current)renderScenario();
}
async function importCloudHistory() {
  if(!user||!client||!confirm('Import your earlier account completions as answer-viewed history? This will not award thinking or SQL completion.'))return;
  const owner=user.id;
  try {
    const {data:rows,error}=await client.from('progress').select('scenario_id').eq('user_id',owner);
    if(owner!==user?.id)return;
    if(error)throw error;
    state=importLegacy(rows.map(row=>row.scenario_id),state,data.aliases,ids);
    persist();updateProgress();if(current)renderScenario();
  } catch {if(owner===user?.id)alert('Earlier account history could not be fetched. Your current progress is unchanged.');}
}
function retrySync() {if(user&&client)cloud.request();else $('syncStatus').textContent='Sign in to sync. Guest practice is saved only on this device.';}
function renderAuth() {
  $('authBox').innerHTML=user?'<div class="auth-row"><span>Signed in as '+escapeHtml(user.email||'learner')+'</span>'+(isAdmin()?'<button class="linkbtn" onclick="openAdmin()">Admin dashboard</button>':'')+'<button class="linkbtn" onclick="signOut()">Sign out</button></div>':
    client?'<div class="auth-row"><button id="googleSignIn" class="action primary" onclick="signInWithGoogle()">Sign in with Google</button></div><p class="small">Sign-in is required to use Crack SQL. Google sign-in creates an account the first time.</p><p id="authMessage" role="status" aria-live="polite"></p>':'Sign-in service is unavailable. Please try again later.';
  $('learnerArea').hidden=!user;
  $('authRequired').hidden=!!user;
  if((!user||!isAdmin())&&$('admin').classList.contains('active')){$('admin').classList.remove('active');$('home').classList.add('active');}
  if(!user&&$('practice').classList.contains('active')){$('practice').classList.remove('active');$('home').classList.add('active');}
  if($('authMessage'))$('authMessage').textContent=authNotice;
  $('importGuest').hidden=true;
  $('importCloud').hidden=!user;
}
function openAdmin(){
  if(!isAdmin())return;
  $('home').classList.remove('active');$('practice').classList.remove('active');$('admin').classList.add('active');
  void loadAdminDashboard();
}
function adminStatus(message){$('adminStatus').textContent=message;}
function renderAdminSummary(summary){
  const host=$('adminSummary');host.replaceChildren();
  const stats=document.createElement('div');stats.className='dashboard-grid';
  for(const [label,value] of [['Signed-in users',summary.total_users||0],['Scenarios confirmed',summary.total_confirmed||0],['SQL generated',summary.total_sql_generated||0],['New scenarios',summary.total_generated_scenarios||0],['DB Fiddle opened',summary.total_fiddle_opened||0]]){
    const card=document.createElement('div');card.className='dashboard-stat';card.textContent=label;
    const strong=document.createElement('strong');strong.textContent=String(value);card.append(strong);stats.append(card);
  }
  host.append(stats);
  const wrap=document.createElement('div');wrap.className='admin-scroll';
  const table=document.createElement('table');table.className='admin-table';table.innerHTML='<thead><tr><th>Learner</th><th>Started</th><th>Confirmed</th><th>Avg. thinking score</th><th>SQL generated</th><th>New scenarios</th><th>DB Fiddle opened</th><th>Latest sign-in</th></tr></thead>';
  const body=document.createElement('tbody');
  for(const row of summary.users||[]){const tr=document.createElement('tr');for(const val of [row.email,row.scenarios_started,row.scenarios_completed,row.average_thinking_score??'—',row.sql_generated||0,row.generated_scenarios||0,row.dbfiddle_opened||0,row.last_sign_in_at?new Date(row.last_sign_in_at).toLocaleString():'—']){const td=document.createElement('td');td.textContent=String(val??'—');tr.append(td);}body.append(tr);}
  table.append(body);wrap.append(table);host.append(wrap);
  const activity=document.createElement('div');activity.className='admin-scroll';
  const eventTable=document.createElement('table');eventTable.className='admin-table';eventTable.innerHTML='<thead><tr><th>Recent activity</th><th>Action</th><th>When</th></tr></thead>';
  const eventBody=document.createElement('tbody');
  for(const ev of summary.recent_activity||[]){const tr=document.createElement('tr');for(const value of [ev.email,ev.event_type,new Date(ev.created_at).toLocaleString()]){const td=document.createElement('td');td.textContent=String(value||'');tr.append(td);}eventBody.append(tr);}
  eventTable.append(eventBody);activity.append(eventTable);host.append(activity);
}
async function loadAdminDashboard(){
  if(!isAdmin()||!client)return;
  adminStatus('Loading usage and learning progress…');
  const {data:summary,error}=await client.rpc('admin_dashboard_summary');
  if(error){adminStatus('Admin setup is pending. Apply migrations/003_admin_challenge.sql in Supabase and assign your account the admin role.');return;}
  renderAdminSummary(summary||{});adminStatus('Dashboard refreshed. DB Fiddle execution results are not returned to this app.');
  await loadAdminChallenges();
}
async function loadActiveChallenge(){
  if(!user||!client)return;
  const now=new Date().toISOString();
  const {data:rows,error}=await client.from('daily_challenges').select('id,title,prompt,starts_at,ends_at,capacity,prize_inr').eq('is_active',true).lte('starts_at',now).gt('ends_at',now).order('starts_at',{ascending:false}).limit(1);
  if(error){$('challengeStatus').textContent='Challenge setup is pending. Sign-in and learning still work.';return;}
  const challenge=rows?.[0];if(!challenge){$('challengeStatus').textContent='No challenge is open right now. Please check again later.';return;}
  window.currentChallenge=challenge;$('challengeDetails').hidden=false;$('challengeTitle').textContent=challenge.title;$('challengePrompt').textContent=challenge.prompt;
  const {count}=await client.from('challenge_entries').select('user_id',{count:'exact',head:true}).eq('challenge_id',challenge.id);
  const {data:mine}=await client.from('challenge_entries').select('thinking_text,sql_text').eq('challenge_id',challenge.id).eq('user_id',user.id).maybeSingle();
  $('challengeMeta').textContent=`${count||0} / ${challenge.capacity} places taken · ₹${challenge.prize_inr} reward · Closes ${new Date(challenge.ends_at).toLocaleString()}`;
  const joined=!!mine;$('joinChallenge').hidden=joined||((count||0)>=challenge.capacity);$('joinChallenge').textContent=(count||0)>=challenge.capacity?'All places are filled':'Join challenge';
  $('challengeSubmission').hidden=!joined;
  if(joined){$('challengeThinking').value=mine.thinking_text||'';$('challengeSql').value=mine.sql_text||'';}
}
async function joinChallenge(){
  if(!user||!window.currentChallenge)return;
  const {error}=await client.rpc('join_daily_challenge',{challenge_id:window.currentChallenge.id});
  if(error){$('challengeStatus').textContent=error.message.includes('FULL')?'This challenge is full.':'Could not reserve a place. It may be closed or full.';return;}
  trackEvent('challenge_joined',{challenge_id:window.currentChallenge.id});await loadActiveChallenge();
}
async function submitChallenge(){
  if(!user||!window.currentChallenge)return;
  const {error}=await client.rpc('submit_daily_challenge',{challenge_id:window.currentChallenge.id,thinking_text:$('challengeThinking').value,sql_text:$('challengeSql').value});
  $('challengeStatus').textContent=error?'Could not save your entry. The deadline may have passed.':'Your challenge entry has been saved.';
}
async function createChallenge(){
  if(!isAdmin())return;
  const startValue=$('newChallengeStart').value,endValue=$('newChallengeEnd').value;
  const startsAt=new Date(startValue),endsAt=new Date(endValue);
  if(!startValue||!endValue||Number.isNaN(startsAt.valueOf())||endsAt<=startsAt){adminStatus('Enter a valid start and end time.');return;}
  const title=$('newChallengeTitle').value.trim(),prompt=$('newChallengePrompt').value.trim();
  if(!title||!prompt){adminStatus('Add a challenge title and prompt.');return;}
  const {error}=await client.from('daily_challenges').insert({title,prompt,starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),created_by:user.id});
  if(error){adminStatus('Could not publish. Check the Supabase migration and challenge details.');return;}
  adminStatus('Challenge published. First 25 signed-in participants can enter.');await loadAdminChallenges();
}
async function loadAdminChallenges(){
  if(!isAdmin())return;const host=$('adminChallenges');host.replaceChildren();
  const {data:rows,error}=await client.from('daily_challenges').select('id,title,starts_at,ends_at,capacity,prize_inr,winner_user_id').order('created_at',{ascending:false}).limit(30);
  if(error){host.textContent='Challenge data is unavailable until the migration is applied.';return;}
  for(const challenge of rows||[]){
    const card=document.createElement('div');card.className='dashboard-stat';const title=document.createElement('h3');title.textContent=challenge.title;
    const desc=document.createElement('p');desc.textContent=`${challenge.capacity} places · ₹${challenge.prize_inr} · ${new Date(challenge.starts_at).toLocaleString()} to ${new Date(challenge.ends_at).toLocaleString()}${challenge.winner_user_id?' · Winner recorded':''}`;card.append(title,desc);
    const {data:entries}=await client.rpc('admin_challenge_entries',{challenge_id:challenge.id});
    for(const entry of entries||[]){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`${entry.email||entry.user_id} · submitted ${new Date(entry.submitted_at).toLocaleString()}`;
      const thought=document.createElement('p');thought.textContent='Thinking: '+entry.thinking_text;const query=document.createElement('pre');query.textContent=entry.sql_text||'(No SQL submitted)';details.append(summary,thought,query);
      if(!challenge.winner_user_id&&entry.thinking_text.trim()){const award=document.createElement('button');award.className='action secondary';award.textContent='Award ₹500 to this entry';award.onclick=()=>awardChallenge(challenge.id,entry.user_id);details.append(award);}else if(!entry.thinking_text.trim()){const incomplete=document.createElement('p');incomplete.textContent='This participant has not submitted a thinking response.';details.append(incomplete);}card.append(details);}
    host.append(card);
  }
}
async function awardChallenge(challengeId,winnerId){
  if(!isAdmin()||!confirm('Confirm this participant as the single ₹500 challenge winner?'))return;
  const {error}=await client.rpc('award_daily_challenge',{challenge_id:challengeId,winner_id:winnerId});
  adminStatus(error?'Could not record the winner. Check eligibility and Supabase setup.':'Winner recorded. Arrange the ₹500 reward separately.');await loadAdminChallenges();
}
function setSession(session) {
  const next=session?.user||null;
  if(next)authNotice='';
  if(user?.id===next?.id) {renderAuth();return;}
  clearTimeout(syncTimer);cloud.changeSession();user=next;state=readProgress(storage,user?.id,ids);
  renderAuth();updateProgress();if(current&&user)renderScenario();
  if(user)void loadActiveChallenge();
  if(user)cloud.request();else $('syncStatus').textContent='Guest profile. Signed-in progress stays separate.';
}
async function signInWithGoogle() {
  const button=$('googleSignIn'),message=$('authMessage');
  if(!client || !button || button.disabled)return;
  button.disabled=true;button.textContent='Connecting to Google…';
  authNotice='';if(message)message.textContent='';
  try {
    const {error}=await client.auth.signInWithOAuth({
      provider:'google',
      options:{
        redirectTo:location.origin+location.pathname,
        queryParams:{prompt:'select_account'}
      }
    });
    if(error)throw error;
  } catch {
    button.disabled=false;button.textContent='Sign in with Google';
    authNotice='Google sign-in could not start. Please retry. If it keeps failing, check the Google provider and allowed redirect URLs in Supabase.';
    if(message)message.textContent=authNotice;
  }
}
async function signOut() {
  try {const {error}=await client.auth.signOut();if(error)throw error;setSession(null);}
  catch {alert('Sign-out failed. Please try again; your account has not been switched.');}
}
async function initAuth() {
  try {
    client=window.supabase?.createClient('https://qklnaqfspvmnlequqagf.supabase.co','sb_publishable_dthVX8zmvd1HvWaYWBaojA_2YbvHWe1')||null;
    renderAuth();if(!client)return;
    const callback=new URLSearchParams(location.hash.slice(1));
    if(callback.has('error')||callback.has('error_description')) {
      const message=$('authMessage');
      authNotice='Google sign-in was cancelled or unsuccessful. Please try again.';
      if(message)message.textContent=authNotice;
      history.replaceState(null,'',location.pathname+location.search);
    }
    // Register first, and do database work only after the auth callback returns.
    let authEventSeen=false;
    client.auth.onAuthStateChange((event,session)=>{authEventSeen=true;setTimeout(()=>{setSession(session);if(event==='SIGNED_IN')setTimeout(()=>trackEvent('sign_in'),0);},0);});
    const {data:auth,error}=await client.auth.getSession();
    if(error)throw error;
    if(!authEventSeen)setSession(auth.session);
  } catch {$('syncStatus').textContent='Sign-in connection unavailable. Reload or try again later.';renderAuth();}
}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;$('installBanner').classList.add('show');});
async function installApp(){if(deferredPrompt){await deferredPrompt.prompt();deferredPrompt=null;$('installBanner').classList.remove('show');}}
window.addEventListener('appinstalled',()=>{$('installBanner').classList.remove('show');});
if(/iPad|iPhone|iPod/.test(navigator.userAgent)&&!navigator.standalone)$('iosHint').style.display='';
window.addEventListener('online',retrySync);
window.addEventListener('storage',event=>{
  if(event.key!==storageKey(user?.id))return;
  const merged=mergeProgress(state,readProgress(storage,user?.id,ids),ids);
  if(JSON.stringify(merged)===JSON.stringify(state))return;
  state=merged;updateProgress();if(current)renderScenario();
});
Object.assign(window,{selectDomain,selectLevel,evaluatePlan,generateSql,generateNewScenario,confirmDbFiddle,nextScenario,goHome,copySetup,copyQuery,runDbFiddle,resetProgress,importOldHistory,importGuestProgress,importCloudHistory,retrySync,signInWithGoogle,signOut,installApp,openAdmin,loadAdminDashboard,joinChallenge,submitChallenge,createChallenge});
try {
  const response=await fetch('./data/scenarios.json');
  if(!response.ok)throw Error('Scenario download failed');
  data=await response.json();scenarios=[...data.scenarios,...generateScenarioCatalog(data.scenarios)];ids=new Set(scenarios.map(s=>s.id));
  state=readProgress(storage,null,ids);
  document.querySelectorAll('.domain,.level').forEach(el=>{
    el.setAttribute('role','button');el.tabIndex=0;
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
  });
  $('thinking').addEventListener('input',evaluatePlan);
  $('thinking').addEventListener('blur',()=>{if(current&&entry().assessment)trackEvent('thinking_scored',{scenario_id:current.id,domain:current.domain,level:current.level,score:entry().assessment.score});});
  updateProgress();void initAuth();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
} catch(error) {
  $('syncStatus').textContent='Could not load exercises. Reconnect and reload this page.';
  console.error(error);
}
