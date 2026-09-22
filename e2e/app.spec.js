import {test,expect} from '@playwright/test';
import fs from 'node:fs';

const data=JSON.parse(fs.readFileSync(new URL('../data/scenarios.json',import.meta.url),'utf8'));

test('mobile thinking score reveals SQL and gates progress on DB Fiddle confirmation',async({page})=>{
  await page.addInitScript(()=>{window.open=()=>({closed:false});});
  const learner={id:'test-learner',email:'learner@example.test',app_metadata:{}};
  await page.addInitScript(({learner})=>{
    const emptyState={version:2,resetAt:0,entries:{}};
    const query={select(){return this;},eq(){return this;},lte(){return this;},gt(){return this;},order(){return this;},limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:null,error:null}),insert:async()=>({data:null,error:null})};
    window.supabase={createClient(){return {
      auth:{onAuthStateChange(callback){setTimeout(()=>callback('SIGNED_IN',{user:learner}),0);return {data:{subscription:{unsubscribe(){}}}};},async getSession(){return {data:{session:{user:learner}},error:null};},async signOut(){return {error:null};}},
      async rpc(name,args){return {data:name==='merge_learning_progress'?(args?.incoming||emptyState):null,error:null};},
      from(){return query;}
    };}};
  },{learner});
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',route=>route.abort());
  await page.setViewportSize({width:375,height:812});
  await page.goto('/');
  await expect(page.locator('#progressCount')).toHaveText('0 / 420');
  await page.getByText('Banking',{exact:true}).click();
  await page.getByText('Beginner',{exact:true}).click();
  const scenario=data.scenarios.find(s=>s.id==='BAN_BEG_001');
  await page.locator('#thinking').fill(scenario.exampleThinking);
  await expect(page.locator('#score')).toHaveText('Thinking Score: 10/10');
  await expect(page.locator('#sqlGenerateSection')).toBeVisible();
  await expect(page.locator('#thinkingDecode')).toBeVisible();
  await page.getByRole('button',{name:'Generate SQL'}).click();
  await expect(page.locator('#answerSection')).toBeVisible();
  await expect(page.locator('#referenceSql')).toHaveText(scenario.sql);
  await expect(page.locator('#nextButton')).toBeDisabled();
  await expect(page.locator('#confirmDbFiddle')).toBeDisabled();
  await page.getByRole('button',{name:'Open DB Fiddle'}).click();
  await expect(page.locator('#confirmDbFiddle')).toBeEnabled();
  await page.getByRole('button',{name:'I ran and checked it in DB Fiddle'}).click();
  await expect(page.locator('#nextButton')).toBeEnabled();
  await expect(page.locator('#progressCount')).toHaveText('1 / 420');
});
