export const SCHEMA=1;
export const finishes=['nonfoil','foil','etched'];
export const conditions=['Near mint','Lightly played','Moderately played','Heavily played','Damaged'];
export function validateEvents(input){
 if(!Array.isArray(input)||input.length>200000)throw Error('Invalid or oversized backup.');
 const ids=new Map();
 for(const e of input){
  if(!e||typeof e.id!=='string'||!e.id||e.id.length>100||typeof e.recordId!=='string'||!e.recordId||e.recordId.length>100||!Array.isArray(e.parents)||e.parents.some(p=>typeof p!=='string'||p===e.id)||new Set(e.parents).size!==e.parents.length||!Number.isFinite(Date.parse(e.at)))throw Error('Invalid revision in backup.');
  if(e.value!==null){const v=e.value;if(e.kind==='deck'){if(v.kind!=='deck'||typeof v.name!=='string'||!v.name.trim()||v.name.length>100||!Array.isArray(v.commanders)||v.commanders.some(x=>typeof x!=='string'))throw Error('Invalid deck information in backup.');}
   else {if(!v||v.kind==='deck'||typeof v.name!=='string'||!v.name.trim()||v.name.length>300||!Number.isInteger(v.quantity)||v.quantity<1||v.quantity>99999||!finishes.includes(v.finish)||!conditions.includes(v.condition)||typeof v.language!=='string'||v.language.length>40||typeof v.location!=='string'||v.location.length>200||typeof v.notes!=='string'||v.notes.length>4000||typeof v.validated!=='boolean')throw Error('Invalid card information in backup.');
   if(v.deckCounts!==undefined&&(!v.deckCounts||typeof v.deckCounts!=='object'||Array.isArray(v.deckCounts)||Object.values(v.deckCounts).some(n=>!Number.isInteger(n)||n<0)||Object.values(v.deckCounts).reduce((a,b)=>a+b,0)>v.quantity))throw Error('Invalid deck card assignments.');
   for(const k of ['scryfallId','oracleId','cardmarketId','set','setName','number','image','type','mana','text','rarity','uri'])if(v[k]!==undefined&&(typeof v[k]!=='string'||v[k].length>20000))throw Error('Invalid card details.');
   for(const k of ['colorIdentity','legalities'])if(v[k]!==undefined&&(!Array.isArray(v[k])&&typeof v[k]!=='object'))throw Error('Invalid Commander card details.');
   }
  }
  if(ids.has(e.id)&&JSON.stringify(ids.get(e.id))!==JSON.stringify(e))throw Error('Conflicting revision identifiers.');ids.set(e.id,e);
 }
 for(const e of ids.values())for(const p of e.parents){const parent=ids.get(p);if(!parent||parent.recordId!==e.recordId)throw Error('Backup has missing or unrelated revisions.');}
 const visiting=new Set(),done=new Set();
 function visit(id){if(done.has(id))return;if(visiting.has(id))throw Error('Backup contains a revision cycle.');visiting.add(id);for(const p of ids.get(id).parents)visit(p);visiting.delete(id);done.add(id);}
 for(const id of ids.keys())visit(id);
 return [...ids.values()];
}
export function mergeEvents(...groups){return validateEvents(groups.flat());}
export function records(events){
 const retired=new Set(events.flatMap(e=>e.parents));const map=new Map();
 for(const e of events)if(!retired.has(e.id)){if(!map.has(e.recordId))map.set(e.recordId,[]);map.get(e.recordId).push(e);}
 return [...map].map(([id,heads])=>({id,heads:heads.sort((a,b)=>a.id.localeCompare(b.id)),conflict:heads.length>1,value:heads[0].value}));
}
export function parseBackup(text){const b=JSON.parse(text);if(b.app!=='arcana-vault'||b.schema!==SCHEMA)throw Error('Choose an Arcana Vault version 1 JSON backup.');return validateEvents(b.events);}
export function backup(events){return JSON.stringify({app:'arcana-vault',schema:SCHEMA,exportedAt:new Date().toISOString(),events},null,2);}
export function cardFromScryfall(c){
 const faces=c.card_faces||[];
 const text=c.oracle_text||faces.map(f=>f.oracle_text||'').join(' '),type=c.type_line||'';
 const mainType=type.split('—')[0].toLowerCase(),keywords=c.keywords||[];
 return {name:c.name,scryfallId:c.id,oracleId:c.oracle_id||'',cardmarketId:c.cardmarket_id?String(c.cardmarket_id):'',set:c.set,setName:c.set_name,number:c.collector_number,image:c.image_uris?.normal||faces[0]?.image_uris?.normal||'',type,mana:c.mana_cost||faces.map(f=>f.mana_cost).filter(Boolean).join(' // '),text:c.oracle_text||faces.map(f=>`${f.name}\n${f.oracle_text||''}`).join('\n\n'),rarity:c.rarity,uri:c.scryfall_uri,colorIdentity:c.color_identity||[],legalities:c.legalities||{},keywords,commanderEligible:(mainType.includes('legendary')&&mainType.includes('creature'))||/can be your commander/i.test(text),backgroundEligible:/\bbackground\b/i.test(type.split('—')[1]||''),basicLand:/\bbasic\b/i.test(mainType)&&/\bland\b/i.test(mainType),anyNumber:/a deck can have any number of cards named/i.test(text),validated:true,language:c.lang||'en',finish:c.finishes?.[0]||'nonfoil',quantity:1,condition:'Near mint',location:'Collection',notes:'',deckCounts:{}};
}
