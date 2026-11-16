import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorize,syncDrive,disconnect} from '../drive.js';
import {backup,records} from '../core.js';
const card={name:'Bolt',quantity:1,finish:'nonfoil',condition:'Near mint',language:'en',location:'',notes:'',validated:false};
const a={id:'a',recordId:'one',parents:[],at:'2026-11-16T12:00:00Z',value:card};
const b={...a,id:'b',parents:['a'],value:{...card,quantity:2}};
const c={...a,id:'c',parents:['a'],value:{...card,quantity:3}};
globalThis.google={accounts:{oauth2:{initTokenClient:config=>({requestAccessToken:()=>config.callback({access_token:'test-token',expires_in:3600})}),hasGrantedAllScopes:()=>true,revoke:(_t,cb)=>cb()}}};
test('Drive merges paginated immutable snapshots and uploads a valid related multipart',async()=>{
 const original=globalThis.fetch;let upload;
 try{
 await authorize('test.apps.googleusercontent.com');
 globalThis.fetch=async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer test-token');
  if(url.includes('uploadType=multipart')){upload=options;return new Response('{}');}
  if(url.includes('alt=media'))return new Response(backup(url.includes('/remote-b?')?[a,b]:[a,c]));
  const u=new URL(url);const q=u.searchParams.get('q');
  if(q.includes('folder-v1'))return Response.json({files:[{id:'folder'}]});
  if(u.searchParams.has('pageToken'))return Response.json({files:[{id:'remote-c'}]});
  return Response.json({files:[{id:'remote-b'}],nextPageToken:'second'});
 };
 const merged=await syncDrive([a]);assert.equal(merged.length,3);assert.equal(records(merged)[0].conflict,true);
 assert.match(upload.headers['Content-Type'],/^multipart\/related; boundary=arcana_/);assert.match(upload.body,/"parents":\["folder"\]/);assert.match(upload.body,/"app": "arcana-vault"/);assert.match(upload.body,/snapshot-v1/);
 }finally{globalThis.fetch=original;disconnect();}
});
test('failed upload rejects without mutating local revisions',async()=>{
 const original=globalThis.fetch,local=[a];try{await authorize('test.apps.googleusercontent.com');globalThis.fetch=async url=>url.includes('uploadType=')?new Response('failed',{status:503}):Response.json({files:[{id:'folder'}]});
 // No remote snapshots in this scenario.
 globalThis.fetch=async url=>{if(url.includes('uploadType='))return new Response('failed',{status:503});const q=new URL(url).searchParams.get('q');return Response.json({files:q?.includes('folder-v1')?[{id:'folder'}]:[]});};
 await assert.rejects(syncDrive(local),/503/);assert.deepEqual(local,[a]);
 }finally{globalThis.fetch=original;disconnect();}
});
