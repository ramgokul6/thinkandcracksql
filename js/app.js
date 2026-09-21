import {evaluateThinking, thinkingIsReady, thinkingText} from './thinking.js';
import {EMPTY, readProgress, saveProgress, mergeProgress, nextTimestamp, workFingerprint, stage, chooseNext, importLegacy, storageKey} from './progress.js';
import {createCloudSync} from './cloud.js';
import {renderSchemaCards} from './schema.js';
import {escapeHtml} from './util.js';
import {SqlEvaluator,loadBrowserPGlite} from './sql-evaluator.js';

const $ = id => document.getElementById(id);
let data, scenarios=[], ids=new Set(), state=EMPTY(), current=null, user=null;
let selectedDomain=null, selectedLevel=null, client=null, deferredPrompt=null, syncTimer=null;
let authNotice='';
let sqlEvaluator=null,sqlEvaluationRunning=false;
let storage;
try { storage=window.localStorage; } catch { storage={getItem(){return null;},setItem(){throw Error('Storage unavailable');}}; }
const labels={not_started:'Not started',thinking:'Thinking in progress',answer_viewed:'Earlier answer viewed — thinking not assessed',thinking_ready:'Thinking ready',sql_written:'SQL draft saved',fiddle_opened:'DB Fiddle opened — SQL not verified',verified:'SQL verified'};
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
  return {response:$('thinking').value};
}
function updateProgress() {
  const stages=scenarios.map(s=>stage(s,state.entries[s.id]));
  const verified=stages.filter(x=>x==='verified').length;
  $('progressCount').textContent=verified+' / '+scenarios.length;
  $('progressFill').style.width=(scenarios.length ? verified/scenarios.length*100 : 0)+'%';
  $('progressStages').textContent=stages.filter(x=>x!=='not_started').length+' started · '+
    stages.filter(x=>['thinking_ready','sql_written','fiddle_opened','verified'].includes(x)).length+' thinking ready · '+verified+' verified';
  if(current) {
    $('learningStage').textContent=labels[stage(current,entry())];
    $('doneTag').classList.toggle('show',stage(current,entry())==='verified');
    $('doneTag').textContent='SQL verified';
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
  $('checkSqlButton').disabled=!ready||!hasSql||sqlEvaluationRunning;
  $('sqlGate').textContent='Write one read-only PostgreSQL SELECT query. Changing your thinking or SQL requires another check.';
  $('practiceStatus').textContent=current ? labels[stage(current,e)] : '';
  const verified=current && stage(current,e)==='verified';
  $('nextButton').disabled=!verified;
  $('solutionHelp').hidden=!verified;
  if(!verified) {$('solutionHelp').open=false;$('referenceSql').textContent='';$('pseudo').textContent='';}
}
function renderSqlEvaluation(result) {
  const box=$('sqlEvaluation');
  if(!result){box.hidden=true;box.className='evaluation';$('sqlPreview').hidden=true;return;}
  box.hidden=false;box.className='evaluation '+(result.passed?'pass':'fail');
  $('sqlEvaluationTitle').textContent=result.passed?'✓ SQL result verified':'SQL needs another look';
  $('sqlEvaluationMessage').textContent=result.message||'';
  const preview=Array.isArray(result.preview)&&result.preview.length?result.preview:null;
  $('sqlPreview').hidden=!preview;
  $('sqlPreview').textContent=preview?'Result preview:\n'+preview.map(row=>row.map(value=>value===null?'NULL':value).join(' | ')).join('\n'):'';
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
  $('thinking').value=thinkingText(e.thinking);
  $('learnerSql').value=e.sql||'';
  $('fiddleFallback').hidden=true;$('manualCopy').hidden=true;
  renderAssessment(e.assessment?evaluateThinking(current,e.thinking||{}):null);
  renderSqlEvaluation(e.evaluationFingerprint===workFingerprint(e)?e.evaluationResult:null);
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
  if(!current || stage(current,entry())!=='verified') {alert('Finish your thinking and pass the SQL result check before continuing.');return;}
  const pool=scenarios.filter(s=>s.domain===selectedDomain&&s.level===selectedLevel);
  const next=chooseNext(pool,state,current.id);
  if(!next) {
    current=pool[(pool.findIndex(s=>s.id===current.id)+1)%pool.length];renderScenario();
    $('practiceStatus').textContent='All exercises in this selection are verified. You are reviewing completed work.';return;
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
async function evaluateSql() {
  const e=entry();
  if(sqlEvaluationRunning||!current||!thinkingIsReady(current,e)||!e.sql?.trim())return;
  sqlEvaluationRunning=true;renderSqlEvaluation({passed:false,message:'Starting the local PostgreSQL engine…'});updateGates();
  try {
    if(!sqlEvaluator)sqlEvaluator=new SqlEvaluator(await loadBrowserPGlite());
    const result=await sqlEvaluator.evaluate(current,data.assets[current.domain],e.sql);
    const fingerprint=workFingerprint(entry());
    changeEntry({evaluationFingerprint:result.passed?fingerprint:null,evaluationResult:result,
      evaluationAt:Date.now(),attempts:(entry().attempts||0)+1});
    renderSqlEvaluation(result);
  } catch(error) {
    renderSqlEvaluation({passed:false,message:'The local SQL engine could not start. Check your connection once, then retry.'});
    console.error(error);
  } finally {sqlEvaluationRunning=false;updateGates();}
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
    client?'<div class="auth-row"><button id="googleSignIn" class="action primary" onclick="signInWithGoogle()">Continue with Google</button></div><p class="small">Sign in to sync your progress, or choose a domain below to practise as a guest.</p><p id="authMessage" role="status" aria-live="polite"></p>':'Guest mode: accounts are unavailable. You can still practise on this device.';
  if($('authMessage'))$('authMessage').textContent=authNotice;
  $('importGuest').hidden=!user;
  $('importCloud').hidden=!user;
}
function setSession(session) {
  const next=session?.user||null;
  if(next)authNotice='';
  if(user?.id===next?.id) {renderAuth();return;}
  clearTimeout(syncTimer);cloud.changeSession();user=next;state=readProgress(storage,user?.id,ids);
  renderAuth();updateProgress();if(current)renderScenario();
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
    button.disabled=false;button.textContent='Continue with Google';
    authNotice='Google sign-in could not start. Please retry. If it keeps failing, check the Google provider and allowed redirect URLs in Supabase. Your guest progress is saved.';
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
Object.assign(window,{selectDomain,selectLevel,evaluatePlan,evaluateSql,nextScenario,goHome,copySetup,copyQuery,runDbFiddle,resetProgress,importOldHistory,importGuestProgress,importCloudHistory,retrySync,signInWithGoogle,signOut,installApp});
try {
  const response=await fetch('./data/scenarios.json');
  if(!response.ok)throw Error('Scenario download failed');
  data=await response.json();scenarios=data.scenarios;ids=new Set(scenarios.map(s=>s.id));
  state=readProgress(storage,null,ids);
  document.querySelectorAll('.domain,.level').forEach(el=>{
    el.setAttribute('role','button');el.tabIndex=0;
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
  });
  $('thinking').addEventListener('input',()=>{
    changeEntry({thinking:readThinking(),assessment:null,fiddleFingerprint:null,evaluationFingerprint:null,evaluationResult:null});
    renderAssessment(null);renderSqlEvaluation(null);updateGates();
  });
  $('learnerSql').addEventListener('input',()=>{
    changeEntry({sql:$('learnerSql').value,fiddleFingerprint:null,evaluationFingerprint:null,evaluationResult:null});
    renderSqlEvaluation(null);updateGates();
  });
  $('solutionHelp').addEventListener('toggle',()=>{
    if($('solutionHelp').open && current && stage(current,entry())==='verified'){
      $('pseudo').textContent=current.pseudo;$('referenceSql').textContent=current.sql;changeEntry({answerViewed:true});
    }
  });
  updateProgress();void initAuth();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
} catch(error) {
  $('syncStatus').textContent='Could not load exercises. Reconnect and reload this page.';
  console.error(error);
}
