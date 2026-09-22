import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SqlEvaluator,compareResults,validateReadOnlySql} from '../js/sql-evaluator.js';

const data=JSON.parse(await fs.readFile(new URL('../data/scenarios.json',import.meta.url),'utf8'));

test('read-only guard accepts SELECT/CTE and rejects writes or multiple statements',()=>{
  assert.equal(validateReadOnlySql('SELECT * FROM accounts;').ok,true);
  assert.equal(validateReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x').ok,true);
  for(const sql of ['',"DELETE FROM accounts",'SELECT 1; DROP TABLE accounts','UPDATE accounts SET status=\'x\'']) {
    assert.equal(validateReadOnlySql(sql).ok,false,sql);
  }
  assert.equal(validateReadOnlySql("SELECT 'drop table accounts' AS harmless -- delete\n").ok,true);
});

test('result comparison handles unordered results and enforces required order',()=>{
  const fields=[{name:'value'}];
  const one={fields,rows:[{value:1},{value:2}]};
  const reversed={fields,rows:[{value:2},{value:1}]};
  assert.equal(compareResults(one,reversed,false).passed,true);
  assert.equal(compareResults(one,reversed,true).passed,false);
});

test('local evaluator passes equivalent SQL and rejects incorrect SQL', {timeout:30000}, async()=>{
  const scenario=data.scenarios.find(s=>s.id==='BAN_BEG_001');
  const evaluator=new SqlEvaluator(PGlite);
  try {
    const equivalent=await evaluator.evaluate(scenario,data.assets.Banking,"SELECT * FROM accounts WHERE status IN ('Active')");
    assert.equal(equivalent.passed,true,equivalent.message);
    const wrong=await evaluator.evaluate(scenario,data.assets.Banking,"SELECT * FROM accounts WHERE status = 'Pending'");
    assert.equal(wrong.passed,false);
    const write=await evaluator.evaluate(scenario,data.assets.Banking,"DELETE FROM accounts");
    assert.equal(write.kind,'guard');
  } finally {await evaluator.close();}
});
