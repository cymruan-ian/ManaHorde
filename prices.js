const GUIDE='https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json';
const RATE='https://api.frankfurter.dev/v1/latest?base=EUR&symbols=GBP';
const SCRYFALL_COLLECTION='https://api.scryfall.com/cards/collection';
let guidePromise,ratePromise;
async function getGuide(){
 if(guidePromise)return guidePromise;
 guidePromise=(async()=>{
  let data;
  for(const url of ['./api/price-guide',GUIDE]){try{const r=await fetch(url);if(!r.ok)continue;data=await r.json();break;}catch{}}
  if(!data||!Array.isArray(data.priceGuides))throw Error('Cardmarket price guide unavailable.');
  const prices=new Map();for(const p of data.priceGuides)if(Number.isFinite(Number(p.low))||Number.isFinite(Number(p['low-foil'])))prices.set(String(p.idProduct),{low:Number(p.low)||null,foil:Number(p['low-foil'])||null});
  return {createdAt:data.createdAt,prices};
 })().catch(e=>{guidePromise=null;throw e;});return guidePromise;
}
async function getRate(){
 if(ratePromise)return ratePromise;
 ratePromise=fetch(RATE).then(async r=>{if(!r.ok)throw Error('GBP exchange rate is unavailable.');const d=await r.json();if(!Number.isFinite(d.rates?.GBP))throw Error('GBP exchange rate response was invalid.');return d.rates.GBP;}).catch(e=>{ratePromise=null;throw e;});return ratePromise;
}
async function getScryfallPrices(cards,rate){
 const ids=[...new Set(cards.map(c=>c.scryfallId).filter(Boolean))];
 if(!ids.length)throw Error('Cardmarket price guide unavailable.');
 const byId=new Map(),byCm=new Map();let anyOk=false;
 for(let i=0;i<ids.length;i+=75){
  const batch=ids.slice(i,i+75).map(id=>({id}));
  try{
   const r=await fetch(SCRYFALL_COLLECTION,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({identifiers:batch})});
   if(!r.ok)continue;
   const d=await r.json();anyOk=true;
   for(const card of d.data||[]){
    if(card.id)byId.set(String(card.id).toLowerCase(),card);
    if(card.cardmarket_id)byCm.set(String(card.cardmarket_id),card);
   }
  }catch{}
 }
 if(!anyOk)throw Error('Cardmarket price guide unavailable.');
 return {createdAt:new Date().toISOString(),prices:new Map(cards.map(c=>{
  const sc=byId.get(String(c.scryfallId||'').toLowerCase())||byCm.get(String(c.cardmarketId||''));
  const raw=c.finish==='foil'||c.finish==='etched'?(sc?.prices?.eur_foil??sc?.prices?.eur):sc?.prices?.eur;
  const euros=Number(raw);
  return [c.id,Number.isFinite(euros)&&euros>0?{gbp:euros*rate,eur:euros}:null];
 }))};
}
export async function priceCards(cards){
 const rate=await getRate();
 try{
  const guide=await getGuide();
  return {createdAt:guide.createdAt,prices:new Map(cards.map(c=>{const p=guide.prices.get(String(c.cardmarketId));if(!c.cardmarketId||!p)return [c.id,null];const euros=c.finish==='foil'||c.finish==='etched'?p.foil??p.low:p.low;return [c.id,euros?{gbp:euros*rate,eur:euros}:null];}))};
 }catch{
  return getScryfallPrices(cards,rate);
 }
}
