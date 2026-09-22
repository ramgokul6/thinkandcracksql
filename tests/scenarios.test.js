import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {evaluateThinking} from '../js/thinking.js';

const data=JSON.parse(await fs.readFile(new URL('../data/scenarios.json',import.meta.url),'utf8'));
const required=['Banking','Healthcare','Insurance','Capital Markets','Semiconductor','Education'];
const levels=['Beginner','Intermediate','Expert'];

test('required domains contain 20 unique exercises at every level',()=>{
  assert.deepEqual(data.requiredDomains,required);
  assert.equal(new Set(data.scenarios.map(s=>s.id)).size,data.scenarios.length);
  assert.equal(data.scenarios.length,420);
  for(const domain of required) for(const level of levels) {
    const group=data.scenarios.filter(s=>s.domain===domain&&s.level===level);
    assert.equal(group.length,20,`${domain} ${level}`);
    assert.equal(new Set(group.map(s=>s.question)).size,20,`${domain} ${level} questions`);
    assert.equal(new Set(group.map(s=>s.sql)).size,20,`${domain} ${level} SQL`);
  }
});

test('every authored reasoning example passes and generic filler does not',()=>{
  for(const scenario of data.scenarios) {
    const result=evaluateThinking(scenario,scenario.exampleThinking);
    assert.equal(result.ready,true,`${scenario.id}: ${result.items.filter(x=>!x.passed).map(x=>x.label).join(', ')}`);
    assert.equal(result.score,10,scenario.id);
    const filler='I will solve this carefully using some relevant data and then check the useful result when I finish.';
    assert.equal(evaluateThinking(scenario,filler).ready,false,`${scenario.id} accepted generic filler`);
  }
});

test('all reference queries execute in PostgreSQL', {timeout:120000}, async()=>{
  for(const [domain,asset] of Object.entries(data.assets)) {
    const db=new PGlite();
    try {
      await db.exec(`${asset.schema}\n${asset.sample}`);
      for(const scenario of data.scenarios.filter(s=>s.domain===domain)) {
        await assert.doesNotReject(db.query(scenario.sql),scenario.id);
      }
    } finally {await db.close();}
  }
});
