import {evaluateThinking, thinkingIsReady} from './thinking.js';
import {EMPTY, readProgress, saveProgress, mergeProgress, nextTimestamp, workFingerprint, stage, chooseNext, importLegacy, storageKey} from './progress.js';
import {createCloudSync} from './cloud.js';
import {renderSchemaCards} from './schema.js';
import {escapeHtml} from './util.js';

const $ = id => document.getElementById(id);
let data, scenarios=[], ids=new Set(), state=EMPTY(), current=null, user=null;
let selectedDomain=null, selectedLevel=null, client=null, deferredPrompt=null, syncTimer=null;
let storage;
try { storage=window.localStorage; } catch { storage={getItem(){return null;},setItem(){throw Error('Storage unavailable');}}; }
const labels={not_started:'Not started',thinking:'Thinking in progress',answer_viewed:'Earlier answer viewed — thinking not assessed',thinking_ready:'Thinking ready',sql_written:'SQL draft saved',fiddle_opened:'DB Fiddle opened — results not verified',practiced:'Practiced — self-reported'};
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
function entry() { return current ? state.entries[current.id] || {} : {}; }
function changeEntry(patch) {
  if(!current) return;
  state.entries[current.id]={...entry(),...patch,updatedAt:nextTimestamp(state)};
  persist(); updateProgress();
}
function readThinking() {
  return {goal:$('thinkingGoal').value,sources:$('thinkingSources').value,steps:$('thinking').value,check:$('thinkingCheck').value};
}
function updateProgress() {
  const stages=scenarios.map(s=>stage(s,state.entries[s.id]));
  const practiced=stages.filter(x=>x==='practiced').length;
  $('progressCount').textContent=practiced+' / '+scenarios.length;
  $('progressFill').style.width=(scenarios.length ? practiced/scenarios.length*100 : 0)+'%';
  $('progressStages').textContent=stages.filter(x=>x!=='not_started').length+' started · '+
    stages.filter(x=>['thinking_ready','sql_written','fiddle_opened','practiced'].includes(x)).length+' thinking ready · '+practiced+' practiced';
  if(current) {
    $('learningStage').textContent=labels[stage(current,entry())];
    $('doneTag').classList.toggle('show',stage(current,entry())==='practiced');
    $('doneTag').textContent='Practice recorded';
  }
}
function renderAssessment(result) {
  $('feedback').classList.toggle('active',!!result);
  if(!result) return;
  $('score').textContent='Thinking coverage: '+result.score+'/10';
  $('assessmentMessage').textContent=result.message;
  $('improve').replaceChildren(...result.items.map(item=>{
    const li=document.createElement('li');
    li.textContent=(item.passed?'✓ ':'Revise: ')+item.label;return li;
  }));
}
function updateGates() {
  const e=entry(),ready=current && thinkingIsReady(current,e),hasSql=!!e.sql?.trim();
  $('sqlSection').hidden=!ready;
  $('fiddleButton').disabled=!ready||!hasSql;
  $('copySetup').disabled=!ready;
  $('copyQuery').disabled=!ready||!hasSql;
  $('sqlGate').textContent='Write your own query before opening DB Fiddle. Changing your thinking requires another check.';
  $('finishButton').disabled=!ready||!hasSql||e.fiddleFingerprint!==workFingerprint(e);
  $('practiceStatus').textContent=current ? labels[stage(current,e)] : '';
  const practiced=current && stage(current,e)==='practiced';
  $('solutionHelp').hidden=!practiced;
  if(!practiced) {$('solutionHelp').open=false;$('referenceSql').textContent='';$('pseudo').textContent='';}
}
function renderScenario() {
  $('home').classList.remove('active');$('practice').classList.add('active');
  $('meta').textContent=current.domain+' • '+current.level;
  $('title').textContent=current.id;$('question').textContent=current.question;
  const pool=scenarios.filter(s=>s.domain===current.domain&&s.level===current.level);
  $('qno').textContent='Exercise '+current.questionNo+' / '+pool.length;
  $('tags').textContent='Think → Write → Validate';
  renderSchemaCards(current.schemaText);
  const e=entry();
  for(const [id,key]of [['thinkingGoal','goal'],['thinkingSources','sources'],['thinking','steps'],['thinkingCheck','check']]) $(id).value=e.thinking?.[key]||'';
  $('learnerSql').value=e.sql||'';$('validationNotes').value=e.validationNotes||'';
  $('validationConfirm').checked=stage(current,e)==='practiced';
  $('fiddleFallback').hidden=true;$('manualCopy').hidden=true;
  renderAssessment(e.assessment?evaluateThinking(current,e.thinking||{}):null);
  updateProgress();updateGates();
}
function loadScenario() {
  if(!selectedDomain||!selectedLevel) return;
  const pool=scenarios.filter(s=>s.domain===selectedDomain&&s.level===selectedLevel);
  current=chooseNext(pool,state,null)||pool[0];
  if(current) renderScenario();
}
function selectDomain(domain,el) {
  selectedDomain=domain;document.querySelectorAll('.domain').forEach(x=>x.classList.toggle('active',x===el));loadScenario();
}
function selectLevel(level,el) {
  selectedLevel=level;document.querySelectorAll('.level').forEach(x=>x.classList.toggle('active',x===el));loadScenario();
}
function evaluatePlan() {
  if(!current) return;
  const thinking=readThinking(),assessment=evaluateThinking(current,thinking);
  changeEntry({thinking,assessment});
  renderAssessment(assessment);updateGates();
  if(assessment.ready) $('learnerSql').focus();
}
function nextScenario() {
  if(!current || stage(current,entry())!=='practiced') {alert('Finish your thinking, then write and check your SQL in DB Fiddle before continuing.');return;}
  const pool=scenarios.filter(s=>s.domain===selectedDomain&&s.level===selectedLevel);
  const next=chooseNext(pool,state,current.id);
  if(!next) {
    current=pool[(pool.findIndex(s=>s.id===current.id)+1)%pool.length];renderScenario();
    $('practiceStatus').textContent='All exercises in this selection have practice recorded. You are reviewing completed work.';return;
  }
  current=next;renderScenario();
}
function goHome() {$('practice').classList.remove('active');$('home').classList.add('active');}
async function copy(text) {
  try {await navigator.clipboard.writeText(text);$('sqlGate').textContent='Copied. Paste into the appropriate DB Fiddle pane.';}
  catch {$('manualCopy').hidden=false;$('copyText').value=text;$('copyText').focus();$('copyText').select();}
}
function copySetup() {if(current&&thinkingIsReady(current,entry()))void copy(data.assets[current.domain].schema+'\n\n'+data.assets[current.domain].sample);}
function copyQuery() {if(current&&thinkingIsReady(current,entry()))void copy(entry().sql||'');}
function runDbFiddle() {
  if(!current||!thinkingIsReady(current,entry())||!entry().sql?.trim()) return;
  // Open synchronously within the user gesture, before any clipboard await.
  window.open('https://www.db-fiddle.com/','_blank','noopener,noreferrer');
  changeEntry({fiddleFingerprint:workFingerprint(entry())});
  $('fiddleFallback').hidden=false;updateGates();
}
function finishPractice() {
  const e=entry();
  if(!current||!thinkingIsReady(current,e)||!e.sql?.trim()||e.fiddleFingerprint!==workFingerprint(e))return;
  const notes=$('validationNotes').value.trim();
  if(!$('validationConfirm').checked||notes.split(/\s+/).length<6) {alert('Confirm you ran the query and describe what you observed in at least one sentence.');return;}
  changeEntry({validationNotes:notes,practiceFingerprint:workFingerprint(e)});updateGates();
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
  $('authBox').innerHTML=user?'<div class="auth-row"><span>Signed in as '+escapeHtml(user.email||'learner')+'</span><button class="linkbtn" onclick="signOut()">Sign out</button></div>':
    client?'<label for="authEmail">Email for a sign-in link</label><div class="auth-row"><input id="authEmail" type="email" placeholder="you@email.com"><button class="action primary" onclick="signInWithEmail()">Sign in</button></div>':'Guest mode: accounts are unavailable. You can still practise on this device.';
  $('importGuest').hidden=!user;
  $('importCloud').hidden=!user;
}
function setSession(session) {
  const next=session?.user||null;
  if(user?.id===next?.id) {renderAuth();return;}
  clearTimeout(syncTimer);cloud.changeSession();user=next;state=readProgress(storage,user?.id,ids);
  renderAuth();updateProgress();if(current)renderScenario();
  if(user)cloud.request();else $('syncStatus').textContent='Guest profile. Signed-in progress stays separate.';
}
async function signInWithEmail() {
  const email=$('authEmail')?.value.trim();if(!email||!$('authEmail').checkValidity()){alert('Enter a valid email address.');return;}
  try {
    const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
    alert(error?'Sign-in failed: '+error.message:'Check your email for a sign-in link.');
  } catch {alert('Sign-in is unavailable. Your guest progress remains on this device.');}
}
async function signOut() {
  try {const {error}=await client.auth.signOut();if(error)throw error;setSession(null);}
  catch {alert('Sign-out failed. Please try again; your account has not been switched.');}
}
async function initAuth() {
  try {
    client=window.supabase?.createClient('https://kagvkyyehlvkcpqxmwpg.supabase.co','sb_publishable_3SEGnFL_C1sQ9RlFKp7Z9w_3H9oCI_5')||null;
    renderAuth();if(!client)return;
    // Register first, and do database work only after the auth callback returns.
    let authEventSeen=false;
    client.auth.onAuthStateChange((_event,session)=>{authEventSeen=true;setTimeout(()=>setSession(session),0);});
    const {data:auth,error}=await client.auth.getSession();
    if(error)throw error;
    if(!authEventSeen)setSession(auth.session);
  } catch {$('syncStatus').textContent='Account connection unavailable. Local practice is still available.';renderAuth();}
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
Object.assign(window,{selectDomain,selectLevel,evaluatePlan,nextScenario,goHome,copySetup,copyQuery,runDbFiddle,finishPractice,resetProgress,importOldHistory,importGuestProgress,importCloudHistory,retrySync,signInWithEmail,signOut,installApp});
try {
  const response=await fetch('./data/scenarios.json');
  if(!response.ok)throw Error('Scenario download failed');
  data=await response.json();scenarios=data.scenarios;ids=new Set(scenarios.map(s=>s.id));
  state=readProgress(storage,null,ids);
  document.querySelectorAll('.domain,.level').forEach(el=>{
    el.setAttribute('role','button');el.tabIndex=0;
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
  });
  for(const id of ['thinkingGoal','thinkingSources','thinking','thinkingCheck'])$(id).addEventListener('input',()=>{
    changeEntry({thinking:readThinking(),assessment:null,fiddleFingerprint:null,practiceFingerprint:null});
    $('validationConfirm').checked=false;renderAssessment(null);updateGates();
  });
  $('learnerSql').addEventListener('input',()=>{
    changeEntry({sql:$('learnerSql').value,fiddleFingerprint:null,practiceFingerprint:null});
    $('validationConfirm').checked=false;updateGates();
  });
  $('validationNotes').addEventListener('input',()=>{changeEntry({validationNotes:$('validationNotes').value,practiceFingerprint:null});updateGates();});
  $('validationConfirm').addEventListener('change',()=>{if(!$('validationConfirm').checked){changeEntry({practiceFingerprint:null});updateGates();}});
  $('solutionHelp').addEventListener('toggle',()=>{
    if($('solutionHelp').open && current && stage(current,entry())==='practiced'){
      $('pseudo').textContent=current.pseudo;$('referenceSql').textContent=current.sql;changeEntry({answerViewed:true});
    }
  });
  updateProgress();void initAuth();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
} catch(error) {
  $('syncStatus').textContent='Could not load exercises. Reconnect and reload this page.';
  console.error(error);
}
