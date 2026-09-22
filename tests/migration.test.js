import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('learning progress migration installs and atomically merges state', {timeout:30000}, async()=>{
  const sql=await fs.readFile(new URL('../migrations/002_learning_progress.sql',import.meta.url),'utf8');
  const lower=sql.toLowerCase();
  for(const expected of ['enable row level security','auth.uid() = user_id','actor <> expected_user','for update','on conflict (user_id) do nothing','grant execute','to authenticated']) {
    assert.ok(lower.includes(expected),`missing: ${expected}`);
  }
  const db=new PGlite(),user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
      CREATE ROLE authenticated; INSERT INTO auth.users VALUES ('${user}'),('${other}');`);
    await db.exec(sql);
    await db.exec(`SELECT set_config('app.user_id','${user}',false);`);
    const first={version:2,resetAt:0,entries:{A:{updatedAt:10,sql:'old'}}};
    const second={version:2,resetAt:0,entries:{A:{updatedAt:20,sql:'new'},B:{updatedAt:15}}};
    await db.query('SELECT public.merge_learning_progress($1::jsonb,$2::uuid)',[JSON.stringify(first),user]);
    const result=await db.query('SELECT public.merge_learning_progress($1::jsonb,$2::uuid) state',[JSON.stringify(second),user]);
    assert.equal(result.rows[0].state.entries.A.sql,'new');
    assert.ok(result.rows[0].state.entries.B);
    await assert.rejects(db.query('SELECT public.merge_learning_progress($1::jsonb,$2::uuid)',[JSON.stringify(second),other]),/does not match/);
  } finally {await db.close();}
});
