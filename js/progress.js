import {thinkingIsReady} from './thinking.js';
export const EMPTY = () => ({version:2, resetAt:0, entries:{}});
export const storageKey = userId => 'crackSqlProgress:v2:' + (userId ? 'user:' + userId : 'guest');
export function sanitize(value, ids) {
  const result = EMPTY();
  if (!value || value.version !== 2 || typeof value.entries !== 'object' || !value.entries || Array.isArray(value.entries)) return result;
  result.resetAt = Number.isFinite(value.resetAt) ? Math.max(0,value.resetAt) : 0;
  for (const [id,entry] of Object.entries(value.entries)) {
    if (!ids.has(id) || !entry || typeof entry !== 'object' || !Number.isFinite(entry.updatedAt) || entry.updatedAt <= result.resetAt) continue;
    const thinking = {response:String(entry.thinking?.response||'').slice(0,8000)};
    // Keep earlier four-box answers readable after upgrading to the single-box UI.
    for(const k of ['goal','sources','steps','check'])thinking[k]=String(entry.thinking?.[k]||'').slice(0,4000);
    result.entries[id] = {thinking, sql:String(entry.sql || '').slice(0,20000),
      assessment: entry.assessment && typeof entry.assessment === 'object' ? entry.assessment : null,
      fiddleFingerprint: typeof entry.fiddleFingerprint === 'string' ? entry.fiddleFingerprint : null,
      externalValidationFingerprint: typeof entry.externalValidationFingerprint === 'string' ? entry.externalValidationFingerprint : null,
      evaluationFingerprint: typeof entry.evaluationFingerprint === 'string' ? entry.evaluationFingerprint : null,
      evaluationResult: entry.evaluationResult && typeof entry.evaluationResult === 'object' ? entry.evaluationResult : null,
      evaluationAt: Number.isFinite(entry.evaluationAt) ? entry.evaluationAt : null,
      attempts: Number.isFinite(entry.attempts) ? Math.max(0,Math.floor(entry.attempts)) : 0,
      validationNotes:String(entry.validationNotes || '').slice(0,4000),
      answerViewed:!!entry.answerViewed, legacyViewed:!!entry.legacyViewed,
      updatedAt:entry.updatedAt};
  }
  return result;
}
export function readProgress(storage, userId, ids) {
  try { return sanitize(JSON.parse(storage.getItem(storageKey(userId))), ids); }
  catch { return EMPTY(); }
}
export function saveProgress(storage,userId,state) {
  try { storage.setItem(storageKey(userId),JSON.stringify(state)); return true; }
  catch { return false; }
}
export function mergeProgress(a,b,ids) {
  a=sanitize(a,ids); b=sanitize(b,ids);
  const result=EMPTY(); result.resetAt=Math.max(a.resetAt,b.resetAt);
  for(const id of ids) {
    const x=a.entries[id],y=b.entries[id];
    const e=!x?y:!y?x:x.updatedAt>y.updatedAt?x:y;
    if(e && e.updatedAt>result.resetAt) result.entries[id]=e;
  }
  return result;
}
export function nextTimestamp(state, now=Date.now()) {
  return Math.max(now,state.resetAt+1,...Object.values(state.entries).map(e=>e.updatedAt+1));
}
export function workFingerprint(entry) {
  return JSON.stringify([
    entry.assessment?.fingerprint || '',
    String(entry.referenceSql || entry.sql || '').trim()
  ]);
}
export function stage(scenario,entry) {
  if(!entry) return 'not_started';
  if(!thinkingIsReady(scenario,entry)) return entry.legacyViewed?'answer_viewed':'thinking';
  if(entry.externalValidationFingerprint===workFingerprint(entry)) return 'practice_confirmed';
  if(entry.fiddleFingerprint===workFingerprint(entry)) return 'fiddle_opened';
  return 'thinking_ready';
}
export function chooseNext(pool,state,currentId) {
  return pool.find(s=>s.id!==currentId && stage(s,state.entries[s.id])!=='practice_confirmed')
    || pool.find(s=>s.id===currentId && stage(s,state.entries[s.id])!=='practice_confirmed') || null;
}
export function importLegacy(idsFromOldStorage,state,aliases,ids,now=Date.now()) {
  const next=structuredClone(state);let timestamp=nextTimestamp(next,now);
  for(const oldId of Array.isArray(idsFromOldStorage)?idsFromOldStorage:[]) {
    const id=aliases[oldId];
    if(!ids.has(id) || next.entries[id]) continue;
    next.entries[id]={thinking:{},sql:'',legacyViewed:true,answerViewed:true,updatedAt:timestamp++};
  }
  return sanitize(next,ids);
}
