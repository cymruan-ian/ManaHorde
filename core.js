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
   for(const k of ['scryfallId','oracleId','cardmarketId','set','setName','number','image','artImage','backImage','type','mana','text','rarity','uri'])if(v[k]!==undefined&&(typeof v[k]!=='string'||v[k].length>20000))throw Error('Invalid card details.');
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
  return {name:c.name,scryfallId:c.id,oracleId:c.oracle_id||'',cardmarketId:c.cardmarket_id?String(c.cardmarket_id):'',set:c.set,setName:c.set_name,number:c.collector_number,image:c.image_uris?.normal||faces[0]?.image_uris?.normal||'',artImage:c.image_uris?.art_crop||faces[0]?.image_uris?.art_crop||'',backImage:faces[1]?.image_uris?.normal||'',type,mana:c.mana_cost||faces.map(f=>f.mana_cost).filter(Boolean).join(' // '),text:c.oracle_text||faces.map(f=>`${f.name}\n${f.oracle_text||''}`).join('\n\n'),rarity:c.rarity,uri:c.scryfall_uri,colorIdentity:c.color_identity||[],legalities:c.legalities||{},keywords,commanderEligible:(mainType.includes('legendary')&&mainType.includes('creature'))||/can be your commander/i.test(text),backgroundEligible:/\bbackground\b/i.test(type.split('—')[1]||''),basicLand:/\bbasic\b/i.test(mainType)&&/\bland\b/i.test(mainType),anyNumber:/a deck can have any number of cards named/i.test(text),validated:true,language:c.lang||'en',finish:c.finishes?.[0]||'nonfoil',quantity:1,condition:'Near mint',location:'Collection',notes:'',deckCounts:{}};
}
export function scryfallImageUrl(s){try{const u=new URL(s);return u.protocol==='https:'&&u.hostname==='cards.scryfall.io'?u.href:'';}catch{return '';}}
export function artUrlFromCard(v){const art=scryfallImageUrl(v?.artImage);if(art)return art;const img=scryfallImageUrl(v?.image);return img?img.replace(/\/(small|normal|large|png|border_crop)\//,'/art_crop/'):'';}
export function allowsMultipleCopies(v){return !!(v?.basicLand||v?.anyNumber||/a deck can have any number of cards named/i.test(v?.text||''));}
export function cardTypeGroup(v){return String(v?.type||'').split('—')[0].replace(/\b(Legendary|Basic|Snow|World|Ongoing|Token)\b/gi,'').replace(/\s+/g,' ').trim()||'Other';}
export function cardFitsDeck(value,deck,cards){
 if(value?.legalities?.commander!=='legal'||!Array.isArray(value.colorIdentity))return false;
 const leaders=(deck?.value?.commanders||[]).map(id=>cards.find(r=>r.id===id&&r.value)).filter(Boolean);
 if(!leaders.length)return true;
 if(leaders.some(r=>!Array.isArray(r.value.colorIdentity)))return false;
 const allowed=new Set(leaders.flatMap(r=>r.value.colorIdentity||[]));
 return value.colorIdentity.every(c=>allowed.has(c));
}
export function validCommanderPair(a,b){
 if(!a||!b)return false;const at=a.text||'',bt=b.text||'',ak=a.keywords||[],bk=b.keywords||[],bgA=/choose a background/i.test(at),bgB=/choose a background/i.test(bt),backgroundA=!!a.backgroundEligible,backgroundB=!!b.backgroundEligible;
 const partnerA=ak.includes('Partner')||ak.includes('Friends forever')||ak.includes('Partner with'),partnerB=bk.includes('Partner')||bk.includes('Friends forever')||bk.includes('Partner with');
 const namedMatch=(source,other)=>/partner with/i.test(source)&&source.toLowerCase().includes(`partner with ${other.name.toLowerCase()}`);
 const matchesNamed=(!ak.includes('Partner with')||namedMatch(at,b))&&(!bk.includes('Partner with')||namedMatch(bt,a));
 return (bgA&&backgroundB)||(bgB&&backgroundA)||(partnerA&&partnerB&&matchesNamed);
}
export function validateCommanderDeck(deck,members){
 const issues=[],commanders=deck.value.commanders||[],counts=new Map(),identity=new Set();
 let size=0;const repeatExceptions=new Set();for(const r of members){const v=r.value,n=v.deckCounts?.[deck.id]||0;if(!n)continue;size+=n;const key=(v.name||'').toLowerCase();counts.set(key,(counts.get(key)||0)+n);if(allowsMultipleCopies(v))repeatExceptions.add(key);if(!Array.isArray(v.colorIdentity))issues.push(`${v.name}: colour identity is unknown; validate this entry.`);else v.colorIdentity.forEach(c=>identity.add(c));if(v.legalities?.commander!=='legal')issues.push(`${v.name}: not verified as legal in Commander.`);}
 if(size<100)issues.push(`Only ${size} cards in the deck. You need 100.`);
 else if(size>100)issues.push(`You've got ${size-100} too many cards. You may need to cut some. They better not be lands!`);
 if(commanders.length<1||commanders.length>2)issues.push('Choose one commander, or a valid pair of partner commanders.');
 const commanderRows=commanders.map(id=>members.find(r=>r.id===id)).filter(Boolean);
 if(commanderRows.length!==commanders.length)issues.push('Every selected commander must be assigned to this deck.');
 if(commanderRows.some(r=>!r.value.commanderEligible&&!r.value.backgroundEligible))issues.push('Selected commander must be a legendary creature, an eligible Background, or explicitly allow itself as commander.');
 if(commanders.length===2&&!validCommanderPair(commanderRows[0]?.value,commanderRows[1]?.value))issues.push('The two commanders do not have a matching Partner, Friends forever, or Choose a Background pairing.');
 if(commanders.length===1&&commanderRows[0]?.value.backgroundEligible&&!commanderRows[0]?.value.commanderEligible)issues.push('A Background needs a commander with “Choose a Background”.');
 if(commanderRows.some(r=>r.value.legalities?.commander!=='legal'))issues.push('Commander card must itself be legal in the Commander format.');
 if(commanderRows.some(r=>!Array.isArray(r.value.colorIdentity)))issues.push('Commander colour identity is incomplete; validate the commander entry.');
 else {const allowed=new Set(commanderRows.flatMap(r=>r.value.colorIdentity||[]));for(const r of members)if((r.value.deckCounts?.[deck.id]||0)>0&&Array.isArray(r.value.colorIdentity)&&r.value.colorIdentity.some(c=>!allowed.has(c)))issues.push(`${r.value.name}: colour identity is outside the commander's identity.`);}
 for(const [name,n] of counts)if(n>1&&!repeatExceptions.has(name))issues.push(`${members.find(r=>r.value.name.toLowerCase()===name)?.value.name||name}: Commander is singleton; only basic lands or cards allowing any number may repeat.`);
 const valid=issues.length===0;return {valid,issues:[...new Set(issues)]};
}
export function suggestDeckPlaystyle(commanderRows){
 if(!commanderRows.length)return 'Select a commander to generate a suggested game plan and deckbuilding guide, or write your own strategy notes here.';
 const names=commanderRows.map(r=>r.value.name).join(' & '),text=commanderRows.map(r=>`${r.value.type||''} ${r.value.text||''} ${(r.value.keywords||[]).join(' ')}`).join(' ').toLowerCase(),colors=new Set(commanderRows.flatMap(r=>r.value.colorIdentity||[])),themes=[],buildTips=[];
 const checks=[
  [/\b(tokens?|create a|create two|populate)\b/,'token generation and go-wide pressure','pack token generators, anthem buffs, and payoffs that trigger when creatures enter or die'],
  [/\b(\+1\/\+1|counter|proliferate)\b/,'+1/+1 counters and board scaling','include counter amplifiers, proliferate spells, and resilient threats that reward extra counters'],
  [/\b(graveyard|dies|sacrifice|mill|return target)\b/,'graveyard recursion and sacrifice value','run free sacrifice outlets, self-mill or entomb effects, and reanimation spells'],
  [/\b(instant|sorcery|noncreature|magecraft|storm)\b/,'spellslinger synergies and instant/sorcery triggers','focus on cheap cantrips, cost reducers, and payoffs for casting noncreature spells'],
  [/\b(artifact|equipment|treasure|clue|food)\b/,'artifact synergies and mana/value engines','include artifact ramp, cost reducers, and cards that turn artifacts into cards or damage'],
  [/\b(enchantment|aura|constellation|shrine)\b/,'enchantment synergies and value engines','build around enchantress draw engines, protective auras, and constellation payoffs'],
  [/\b(landfall|play an additional land|search your library for a .*land)\b/,'land ramp and landfall payoffs','prioritise extra-land-drop effects, fetch lands, and landfall finishers'],
  [/\b(enters)\b/,'enter-the-battlefield triggers','add blink/flicker spells and trigger doublers to repeat enter effects'],
  [/\b(draw a card|draw cards)\b/,'steady card advantage','include repeatable draw engines and cards that reward drawing extra cards each turn'],
  [/\b(gain life|lifelink)\b/,'lifegain triggers and sustain','pair cheap lifegain triggers with payoffs that convert life into counters, tokens, or drain'],
  [/\b(attack|combat|double strike|trample|commander damage|equipped|enchanted)\b/,'aggressive combat and commander damage','run haste/evasion enablers, protection spells, and combat buffs to push damage through']
 ];
 for(const [re,label,tip] of checks)if(re.test(text)){if(themes.length<3)themes.push(label);if(buildTips.length<3)buildTips.push(tip);}
 const rampTip=colors.has('G')?'Include 10–12 land/creature ramp spells alongside 36–38 lands, 10+ card draw sources, and 8–10 interaction/protection pieces.':'Use 10–12 mana rocks and colour-fixing artifacts alongside 36–38 lands, 10+ card draw sources, and 8–10 interaction/protection pieces.';
 const playLine=themes.length?`Play ${names} by leaning into ${themes.join(', ')}.`:`Play ${names} by getting it onto the battlefield early and protecting it while building incremental value.`;
 const buildLine=buildTips.length?`How to build: ${buildTips.join('; ')}. ${rampTip}`:`How to build: Surround ${names} with cards that directly trigger or amplify its abilities. ${rampTip}`;
 return `${playLine}\n${buildLine}`;
}
export function shoppingCsv(allEvents){
 const items=records(allEvents).filter(r=>r.value?.notOwned&&!r.conflict),quote=value=>`"${String(value??'').replace(/"/g,'""')}"`,grouped=new Map();
 for(const r of items){const v=r.value,name=String(v.name||'').trim(),key=name.toLocaleLowerCase(),qty=Number(v.quantity)||Object.values(v.deckCounts||{}).reduce((a,n)=>a+n,0)||1;if(!grouped.has(key))grouped.set(key,{name,qty:0});grouped.get(key).qty+=qty;}
 const rows=[['Card Name','Quantity'],...[...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(x=>[x.name,x.qty])];
 return '\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
}
export function sumCardValues(items,prices,getQty=r=>r.value?.quantity||0){
 let total=0,pricedCount=0;
 for(const r of items){const p=prices.get(r.id),qty=Number(getQty(r))||0;if(p&&qty>0){total+=p.gbp*qty;pricedCount+=qty;}}
 return {total,pricedCount};
}
export function groupCollectionEntries(rows,{ungroup=false,activeDeck=''}={}){
 const groups=new Map();
 for(const r of rows){
  const v=r.value||r.heads.find(h=>h.value)?.value;if(!v)continue;
  const cardKey=v.oracleId||String(v.name||'').trim().toLowerCase();
  const key=r.conflict?`conflict:${r.id}`:ungroup?`exact:${cardKey}|${v.scryfallId||''}|${v.set||''}|${v.number||''}|${v.finish||''}|${v.condition||''}|${v.language||''}|${v.location||''}`:`card:${cardKey}`;
  const qty=activeDeck?(v.deckCounts?.[activeDeck]||0):(Number(v.quantity)||0);
  if(!groups.has(key)){groups.set(key,{primary:r,rows:[r],quantity:qty,deckCounts:{...(v.deckCounts||{})}});}
  else{
   const g=groups.get(key);g.rows.push(r);g.quantity+=qty;
   for(const [did,count] of Object.entries(v.deckCounts||{}))g.deckCounts[did]=(g.deckCounts[did]||0)+count;
  }
 }
 return [...groups.values()].map(g=>({...g,printingsCount:new Set(g.rows.map(r=>{const v=r.value||r.heads.find(h=>h.value)?.value;return `${v.scryfallId||v.set||''}:${v.number||''}`})).size}));
}
