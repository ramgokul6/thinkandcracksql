import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {evaluateThinking} from '../js/thinking.js';
import {generateScenarioCatalog} from '../js/scenario-generator.js';

const data=JSON.parse(await fs.readFile(new URL('../data/scenarios.json',import.meta.url),'utf8'));
const generated=generateScenarioCatalog(data.scenarios);

test('reviewed scenario templates create distinct scored prompts at all levels',()=>{
  assert.equal(generated.length,399);
  assert.equal(new Set(generated.map(s=>s.id)).size,generated.length);
  for(const scenario of generated){
    const score=evaluateThinking(scenario,scenario.exampleThinking);
    assert.equal(score.ready,true,`${scenario.id}: ${score.items.filter(item=>!item.passed).map(item=>item.label).join(', ')}`);
    assert.equal(score.score,10,scenario.id);
  }
});

test('every generated reference query runs against its domain fixtures',{timeout:120000},async()=>{
  for(const [domain,asset] of Object.entries(data.assets)){
    const db=new PGlite();
    try{
      await db.exec(`${asset.schema}\n${asset.sample}`);
      for(const scenario of generated.filter(item=>item.domain===domain)){
        const result=await db.query(scenario.sql);
        assert.ok(result.rows.length>0,`${scenario.id} returned no fixture rows`);
      }
    }finally{await db.close();}
  }
});
