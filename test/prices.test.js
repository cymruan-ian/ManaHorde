import {test} from 'node:test';
import assert from 'node:assert/strict';

test('priceCards converts Cardmarket EUR prices to GBP and falls back from local proxy to S3',async()=>{
 const originalFetch=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(url)=>{
  calls.push(String(url));
  if(String(url)==='./api/price-guide')return new Response('unavailable',{status:502});
  if(String(url).includes('price_guide_1.json')){
   return Response.json({
    createdAt:'2026-11-16T00:00:00Z',
    priceGuides:[
     {idProduct:100,low:2.0,'low-foil':5.0},
     {idProduct:200,low:4.0}
    ]
   });
  }
  if(String(url).includes('frankfurter.dev'))return Response.json({rates:{GBP:0.85}});
  throw Error(`Unexpected URL ${url}`);
 };
 try{
  const {priceCards}=await import(`../prices.js?t=${Date.now()}`);
  const res=await priceCards([
   {id:'c1',cardmarketId:'100',finish:'nonfoil'},
   {id:'c2',cardmarketId:'100',finish:'foil'},
   {id:'c3',cardmarketId:'200',finish:'etched'},
   {id:'c4',cardmarketId:'',finish:'nonfoil'}
  ]);
  assert.ok(calls.includes('./api/price-guide'));
  assert.equal(res.createdAt,'2026-11-16T00:00:00Z');
  assert.deepEqual(res.prices.get('c1'),{eur:2.0,gbp:1.7});
  assert.deepEqual(res.prices.get('c2'),{eur:5.0,gbp:4.25});
  assert.deepEqual(res.prices.get('c3'),{eur:4.0,gbp:3.4});
  assert.equal(res.prices.get('c4'),null);
 }finally{
  globalThis.fetch=originalFetch;
 }
});

test('priceCards rejects on failure and retries on subsequent call',async()=>{
 const originalFetch=globalThis.fetch;
 let fail=true;
 globalThis.fetch=async(url)=>{
  if(fail)return new Response('down',{status:503});
  if(String(url)==='./api/price-guide')return Response.json({createdAt:'2026-11-16T01:00:00Z',priceGuides:[{idProduct:10,low:10}]});
  return Response.json({rates:{GBP:0.8}});
 };
 try{
  const {priceCards}=await import(`../prices.js?retry=${Date.now()}`);
  await assert.rejects(priceCards([{id:'a',cardmarketId:'10',finish:'nonfoil'}]),/unavailable/i);
  fail=false;
  const res=await priceCards([{id:'a',cardmarketId:'10',finish:'nonfoil'}]);
  assert.deepEqual(res.prices.get('a'),{eur:10,gbp:8});
 }finally{
  globalThis.fetch=originalFetch;
 }
});
test('priceCards falls back to Scryfall collection EUR prices when guide is blocked by CORS',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  const u=String(url);
  if(u==='./api/price-guide')return new Response('Not found',{status:404});
  if(u.includes('price_guide_1.json'))throw new TypeError('Failed to fetch');
  if(u.includes('frankfurter.dev'))return Response.json({rates:{GBP:0.85}});
  if(u.includes('api.scryfall.com/cards/collection')){
   return Response.json({data:[{id:'scry-1',cardmarket_id:100,prices:{eur:'2.00',eur_foil:'5.00'}}]});
  }
  throw Error(`Unexpected URL ${url}`);
 };
 try{
  const {priceCards}=await import(`../prices.js?scry=${Date.now()}`);
  const res=await priceCards([
   {id:'c1',cardmarketId:'100',scryfallId:'scry-1',finish:'nonfoil'},
   {id:'c2',cardmarketId:'100',scryfallId:'scry-1',finish:'foil'}
  ]);
  assert.deepEqual(res.prices.get('c1'),{eur:2,gbp:1.7});
  assert.deepEqual(res.prices.get('c2'),{eur:5,gbp:4.25});
 }finally{
  globalThis.fetch=originalFetch;
 }
});
