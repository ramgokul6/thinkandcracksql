import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudSync} from '../js/cloud.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('cloud sync serializes requests',async()=>{
  let active=0,maxActive=0,calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const sync=createCloudSync({
    client:{async rpc(){calls++;active++;maxActive=Math.max(maxActive,active);await gate;active--;return {data:{version:2,resetAt:0,entries:{}},error:null};}},
    getContext:()=>({userId:'u1',state:{version:2,resetAt:0,entries:{}}}),onMerged(){},onStatus(){}
  });
  sync.request();sync.request();await tick();release();await tick();await tick();
  assert.equal(maxActive,1);assert.equal(calls,2);
});

test('late response from a previous account is ignored',async()=>{
  let userId='u1',release,merged=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const sync=createCloudSync({client:{async rpc(){await gate;return {data:{},error:null};}},
    getContext:()=>({userId,state:{}}),onMerged(){merged++;},onStatus(){}});
  sync.request();await tick();userId='u2';sync.changeSession();release();await tick();
  assert.equal(merged,0);
});
