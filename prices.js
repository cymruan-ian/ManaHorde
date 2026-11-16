const GUIDE='https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json';
const RATE='https://api.frankfurter.dev/v1/latest?base=EUR&symbols=GBP';
let guidePromise,ratePromise;
async function getGuide(){
 if(guidePromise)return guidePromise;
 guidePromise=(async()=>{
  const r=await fetch(GUIDE);if(!r.ok)throw Error(`Cardmarket price guide unavailable (${r.status}).`);
  const data=await r.json();if(!Array.isArray(data.priceGuides))throw Error('Cardmarket price guide had an unexpected format.');
  const prices=new Map();for(const p of data.priceGuides)if(Number.isFinite(Number(p.low))||Number.isFinite(Number(p['low-foil'])))prices.set(String(p.idProduct),{low:Number(p.low)||null,foil:Number(p['low-foil'])||null});
  return {createdAt:data.createdAt,prices};
 })().catch(e=>{guidePromise=null;throw e;});return guidePromise;
}
async function getRate(){
 if(ratePromise)return ratePromise;
 ratePromise=fetch(RATE).then(async r=>{if(!r.ok)throw Error('GBP exchange rate is unavailable.');const d=await r.json();if(!Number.isFinite(d.rates?.GBP))throw Error('GBP exchange rate response was invalid.');return d.rates.GBP;}).catch(e=>{ratePromise=null;throw e;});return ratePromise;
}
export async function priceCards(cards){
 const [guide,rate]=await Promise.all([getGuide(),getRate()]);
 return {createdAt:guide.createdAt,prices:new Map(cards.map(c=>{const p=guide.prices.get(String(c.cardmarketId));if(!c.cardmarketId||!p)return [c.id,null];const euros=c.finish==='foil'||c.finish==='etched'?p.foil??p.low:p.low;return [c.id,euros?{gbp:euros*rate,eur:euros}:null];}))};
}
