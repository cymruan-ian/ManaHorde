import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 cardFromScryfall,
 artUrlFromCard,
 cardTypeGroup,
 cardFitsDeck,
 validateCommanderDeck,
 suggestDeckPlaystyle,
 shoppingCsv,
 sumCardValues,
 groupCollectionEntries,
 pickCollectionStats,
 validateEvents
} from '../core.js';

const baseCard={
 quantity:1,finish:'nonfoil',condition:'Near mint',language:'en',location:'Collection',notes:'',validated:true,
 legalities:{commander:'legal'},colorIdentity:['G'],commanderEligible:false,backgroundEligible:false,basicLand:false,anyNumber:false,deckCounts:{}
};

test('cardFromScryfall extracts artImage and artUrlFromCard derives art_crop safely',()=>{
 const single=cardFromScryfall({
  name:'Llanowar Elves',id:'id-1',set:'dom',set_name:'Dominaria',collector_number:'168',rarity:'common',lang:'en',finishes:['nonfoil'],
  image_uris:{normal:'https://cards.scryfall.io/normal/front/a/b/123.jpg',art_crop:'https://cards.scryfall.io/art_crop/front/a/b/123.jpg'}
 });
 assert.equal(single.artImage,'https://cards.scryfall.io/art_crop/front/a/b/123.jpg');
 assert.equal(single.backImage,'');
 const dfc=cardFromScryfall({
  name:'Front // Back',id:'id-2',set:'tst',set_name:'Test',collector_number:'2',rarity:'rare',lang:'en',finishes:['nonfoil'],
  card_faces:[{name:'Front',oracle_text:'A',image_uris:{normal:'https://cards.scryfall.io/front.jpg'}},{name:'Back',oracle_text:'B',image_uris:{normal:'https://cards.scryfall.io/back.jpg'}}]
 });
 assert.equal(dfc.backImage,'https://cards.scryfall.io/back.jpg');
 assert.equal(artUrlFromCard(single),'https://cards.scryfall.io/art_crop/front/a/b/123.jpg');
 assert.equal(artUrlFromCard({image:'https://cards.scryfall.io/normal/front/1/2/xyz.jpg'}),'https://cards.scryfall.io/art_crop/front/1/2/xyz.jpg');
 assert.equal(artUrlFromCard({image:'https://evil.example.com/normal/x.jpg'}),'');
 assert.doesNotThrow(()=>validateEvents([{id:'e1',recordId:'r1',parents:[],at:'2026-11-16T12:00:00Z',value:single}]));
});

test('cardTypeGroup strips supertypes and defaults to Other',()=>{
 assert.equal(cardTypeGroup({type:'Legendary Creature — Elf Druid'}),'Creature');
 assert.equal(cardTypeGroup({type:'Basic Snow Land — Forest'}),'Land');
 assert.equal(cardTypeGroup({type:'Artifact Creature — Construct'}),'Artifact Creature');
 assert.equal(cardTypeGroup({type:''}),'Other');
});

test('cardFitsDeck enforces Commander legality and combined partner colour identity',()=>{
 const cmdW={id:'cmd-w',value:{...baseCard,name:'Partner W',colorIdentity:['W'],commanderEligible:true}};
 const cmdU={id:'cmd-u',value:{...baseCard,name:'Partner U',colorIdentity:['U'],commanderEligible:true}};
 const deck={id:'d1',value:{kind:'deck',name:'Azorius',commanders:['cmd-w','cmd-u']}};
 const cards=[cmdW,cmdU];
 assert.equal(cardFitsDeck({...baseCard,colorIdentity:['W','U']},deck,cards),true);
 assert.equal(cardFitsDeck({...baseCard,colorIdentity:['G']},deck,cards),false);
 assert.equal(cardFitsDeck({...baseCard,colorIdentity:['W'],legalities:{commander:'banned'}},deck,cards),false);
 assert.equal(cardFitsDeck({...baseCard,colorIdentity:['R']},{id:'d2',value:{kind:'deck',name:'Empty',commanders:[]}},cards),true);
});

test('validateCommanderDeck emits custom size notices for under and over 100 cards and passes at 100',()=>{
 const deck={id:'d1',value:{kind:'deck',name:'Mono Green',commanders:['cmd']}};
 const cmd={id:'cmd',value:{...baseCard,name:'Omnath',colorIdentity:['G'],commanderEligible:true,deckCounts:{d1:1}}};
 const forest=(n)=>({id:'forest',value:{...baseCard,name:'Forest',type:'Basic Land — Forest',basicLand:true,colorIdentity:['G'],quantity:n,deckCounts:{d1:n}}});

 const under=validateCommanderDeck(deck,[cmd,forest(10)]);
 assert.equal(under.valid,false);
 assert.ok(under.issues.includes('Only 11 cards in the deck. You need 100.'));

 const over=validateCommanderDeck(deck,[cmd,forest(102)]);
 assert.equal(over.valid,false);
 assert.ok(over.issues.includes("You've got 3 too many cards. You may need to cut some. They better not be lands!"));

 const exact=validateCommanderDeck(deck,[cmd,forest(99)]);
 assert.equal(exact.valid,true);
 assert.deepEqual(exact.issues,[]);
});

test('suggestDeckPlaystyle adapts to commander abilities and handles empty commanders',()=>{
 assert.match(suggestDeckPlaystyle([]),/Select a commander/);
 const guide=suggestDeckPlaystyle([{value:{name:'Krenko',type:'Legendary Creature — Goblin',text:'Create X 1/1 red Goblin creature tokens.',colorIdentity:['R'],keywords:[]}}]);
 assert.match(guide,/Krenko/);
 assert.match(guide,/token generation/);
 assert.match(guide,/How to build:/);
});

test('shoppingCsv exports only Card Name and Quantity for Not Owned cards grouped and sorted',()=>{
 const events=[
  {id:'1',recordId:'r1',parents:[],at:'2026-11-16T12:00:00Z',value:{...baseCard,name:'Sol Ring',quantity:2,notOwned:true,deckCounts:{d1:2}}},
  {id:'2',recordId:'r2',parents:[],at:'2026-11-16T12:00:00Z',value:{...baseCard,name:'Sol Ring',quantity:1,notOwned:true,deckCounts:{d2:1}}},
  {id:'3',recordId:'r3',parents:[],at:'2026-11-16T12:00:00Z',value:{...baseCard,name:'Arcane Signet',quantity:1,notOwned:true,deckCounts:{d1:1}}},
  {id:'4',recordId:'r4',parents:[],at:'2026-11-16T12:00:00Z',value:{...baseCard,name:'Owned Card',quantity:4,notOwned:false}}
 ];
 const csv=shoppingCsv(events).replace(/^\ufeff/,'');
 assert.equal(csv,'"Card Name","Quantity"\r\n"Arcane Signet","1"\r\n"Sol Ring","3"');
});

test('sumCardValues totals priced cards for collection and per-deck counts',()=>{
 const prices=new Map([['a',{gbp:1.5,eur:1.75}],['b',{gbp:4.0,eur:4.7}],['c',null]]);
 const items=[
  {id:'a',value:{quantity:3,deckCounts:{d1:2}}},
  {id:'b',value:{quantity:2,deckCounts:{d1:1}}},
  {id:'c',value:{quantity:5,deckCounts:{d1:3}}}
 ];
 assert.deepEqual(sumCardValues(items,prices),{total:12.5,pricedCount:5});
 assert.deepEqual(sumCardValues(items,prices,r=>r.value.deckCounts.d1),{total:7.0,pricedCount:3});
});

test('groupCollectionEntries combines versions by default and keeps distinct versions when ungrouped',()=>{
 const rows=[
  {id:'1',heads:[{at:'2026-11-16T12:00:00Z'}],value:{...baseCard,name:'Sol Ring',oracleId:'o-sol',scryfallId:'s-1',set:'c21',number:'1',finish:'nonfoil',quantity:2,deckCounts:{d1:1}}},
  {id:'2',heads:[{at:'2026-11-16T12:00:00Z'}],value:{...baseCard,name:'Sol Ring',oracleId:'o-sol',scryfallId:'s-1',set:'c21',number:'1',finish:'nonfoil',quantity:1,deckCounts:{d2:1}}},
  {id:'3',heads:[{at:'2026-11-16T12:00:00Z'}],value:{...baseCard,name:'Sol Ring',oracleId:'o-sol',scryfallId:'s-2',set:'cmr',number:'2',finish:'foil',quantity:1,deckCounts:{}}}
 ];
 const grouped=groupCollectionEntries(rows,{ungroup:false});
 assert.equal(grouped.length,1);
 assert.equal(grouped[0].quantity,4);
 assert.equal(grouped[0].printingsCount,2);
 assert.deepEqual(grouped[0].deckCounts,{d1:1,d2:1});

 const ungrouped=groupCollectionEntries(rows,{ungroup:true});
 assert.equal(ungrouped.length,2);
 assert.equal(ungrouped[0].quantity,3);
 assert.equal(ungrouped[1].quantity,1);
});

test('pickCollectionStats selects 4 analytics plus Collection Value as the 5th stat',()=>{
 const owned=[{id:'a',value:{...baseCard,name:'Sol Ring',quantity:2,rarity:'uncommon',set:'c21',colorIdentity:['C'],validated:true}}];
 const prices=new Map([['a',{gbp:2.5,eur:2.9}]]);
 const stats=pickCollectionStats({ownedClean:owned,allCards:owned,decks:[],conflicts:[],prices});
 assert.equal(stats.length,5);
 assert.equal(new Set(stats.map(s=>s.id)).size,5);
 assert.equal(stats[4].id,'value');
 assert.equal(stats[4].label,'COLLECTION VALUE');
 assert.equal(stats[4].value,'£5.00');
});
