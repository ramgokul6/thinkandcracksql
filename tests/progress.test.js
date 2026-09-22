import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {evaluateThinking} from '../js/thinking.js';
import {EMPTY,mergeProgress,stage,workFingerprint,storageKey,importLegacy} from '../js/progress.js';

const data=JSON.parse(await fs.readFile(new URL('../data/scenarios.json',import.meta.url),'utf8'));
const scenario=data.scenarios[0],ids=new Set(data.scenarios.map(s=>s.id));
const assessment=evaluateThinking(scenario,scenario.exampleThinking);

test('practice is confirmed only after current thinking and DB Fiddle handoff',()=>{
  const entry={thinking:{response:scenario.exampleThinking},assessment,referenceSql:'',sqlGenerated:false,updatedAt:1};
  assert.equal(stage(scenario,entry),'thinking_ready');
  entry.referenceSql=scenario.sql;entry.sqlGenerated=true;
  assert.equal(stage(scenario,entry),'sql_generated');
  const fingerprint=workFingerprint(entry);
  entry.fiddleFingerprint=fingerprint;
  assert.equal(stage(scenario,entry),'fiddle_opened');
  entry.externalValidationFingerprint=fingerprint;
  assert.equal(stage(scenario,entry),'practice_confirmed');
  entry.thinking={response:'I will look at the data.'};
  assert.equal(stage(scenario,entry),'thinking');
});

test('merge keeps the newest edit and respects reset tombstones',()=>{
  const a=EMPTY(),b=EMPTY();
  a.entries[scenario.id]={thinking:{},sql:'old',updatedAt:10};
  b.entries[scenario.id]={thinking:{},sql:'new',updatedAt:20};
  assert.equal(mergeProgress(a,b,ids).entries[scenario.id].sql,'new');
  a.resetAt=25;
  assert.equal(mergeProgress(a,b,ids).entries[scenario.id],undefined);
});

test('guest/account keys are isolated and legacy completion becomes viewed only',()=>{
  assert.notEqual(storageKey(null),storageKey('user-1'));
  const state=importLegacy(['BAN_BEG_001'],EMPTY(),data.aliases,ids,100);
  assert.equal(state.entries.BAN_BEG_001.legacyViewed,true);
  assert.equal(stage(scenario,state.entries.BAN_BEG_001),'answer_viewed');
});
