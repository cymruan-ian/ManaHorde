import {records,mergeEvents,parseBackup,backup,cardFromScryfall,scryfallImageUrl as imageUrl,artUrlFromCard as artUrl,allowsMultipleCopies,cardTypeGroup,cardFitsDeck,validCommanderPair,validateCommanderDeck,suggestDeckPlaystyle,shoppingCsv,sumCardValues,groupCollectionEntries} from './core.js';
import {prepareGoogle,authorize,connected,disconnect,syncDrive,tokenExpiresAt} from './drive.js';
import {priceCards} from './prices.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,events=[],editing=null,draft=null,heads=[],assignmentDraft={},results=[],nextPage=null,searchBusy=false,driveBusy=false,toastTimer,installPrompt,currentPage='home',cardCatalog=[],cardPrices=new Map(),lastPriceKey='';
let activeDeck='',selectedDeck='',deckSearch='',deckSearchOpen=false,deckSort='default',deckSimpleView=false,hydrationRunning=false,pendingCommanderAnim=null;const hydrationTried=new Set();
const deckCtasKey=()=>matchMedia('(pointer: coarse)').matches||innerWidth<=900?'arcana-hide-deck-ctas-mobile':'arcana-hide-deck-ctas-desktop';
const isDeckCtasVisible=()=>localStorage.getItem(deckCtasKey())!=='true';
const DEFAULT_CLIENT_ID='713228552059-d3nb08komhcf7o4vtvsd2oma8g03ooch.apps.googleusercontent.com';
let clientId=localStorage.getItem('arcana-client-id')||DEFAULT_CLIENT_ID,geminiApiKey=localStorage.getItem('arcana-gemini-key')||'',autoConnectDrive=localStorage.getItem('arcana-auto-connect')==='true',autoSyncDrive=localStorage.getItem('arcana-auto-sync')==='true',lastOnlineGuide='',lookedUpCard=null,autoSyncTimer,keepAliveTimer;
async function confirmAction(message){
 const modal=$('confirm-dialog');$('confirm-message').textContent=message;
 return new Promise(resolve=>{modal.addEventListener('close',()=>resolve(modal.returnValue==='yes'),{once:true});modal.showModal();});
}
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('arcana-vault'):null;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function show(id){$(id).showModal();}
function report(e){console.error(e);toast(e.message||'Something went wrong. Please try again.');}
async function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('arcana-vault',1);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);req.onblocked=()=>toast('Close other Arcana Vault tabs, then reload.');});}
async function read(){return new Promise((resolve,reject)=>{const tx=db.transaction('state');const req=tx.objectStore('state').get('events');req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}
async function commit(incoming,{fromSync=false}={}){return new Promise((resolve,reject)=>{
 const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');let merged;const req=store.get('events');
 req.onsuccess=()=>{try{merged=mergeEvents(req.result||[],incoming);store.put(merged,'events');}catch(e){tx.abort();reject(e);}};
 tx.oncomplete=()=>{events=merged;render();channel?.postMessage('changed');if(!fromSync)scheduleAutoSync();resolve();};
 tx.onerror=()=>reject(tx.error||Error('Unable to save. Download a backup and check available storage.'));
 tx.onabort=()=>reject(tx.error||Error('Save failed. Your previous collection is unchanged.'));
});}
function revision(value,kind='card'){return {id:crypto.randomUUID(),recordId:editing||crypto.randomUUID(),parents:heads.map(h=>h.id),at:new Date().toISOString(),value,...(kind==='deck'?{kind:'deck'}:{})};}
function placeholder(name){return `<div class="card-placeholder"><span>◇</span>${esc(name)}</div>`;}
function flipButton(v){const front=imageUrl(v?.image),back=imageUrl(v?.backImage);return front&&back?`<button type="button" class="flip-card-btn" data-flip-front="${esc(front)}" data-flip-back="${esc(back)}" aria-label="Flip card" title="Flip card">↻</button>`:'';}
function render(){
 const recordsNow=records(events),decks=recordsNow.filter(r=>(r.value||r.heads.find(h=>h.value)?.value)?.kind==='deck'),all=recordsNow.filter(r=>(r.value||r.heads.find(h=>h.value)?.value)?.kind!=='deck'),active=all.filter(r=>r.value!==null||r.conflict),clean=all.filter(r=>r.value&&!r.conflict),ownedActive=active.filter(r=>!(r.value||r.heads.find(h=>h.value)?.value)?.notOwned),ownedClean=clean.filter(r=>!r.value.notOwned);
 $('total').textContent=ownedClean.reduce((s,r)=>s+r.value.quantity,0).toLocaleString();$('unique').textContent=new Set(ownedClean.map(r=>r.value.scryfallId||r.value.name.toLowerCase())).size.toLocaleString();$('foils').textContent=ownedClean.filter(r=>r.value.finish!=='nonfoil').reduce((s,r)=>s+r.value.quantity,0).toLocaleString();$('nav-count').textContent=ownedActive.length;
 const pending=ownedClean.filter(r=>!r.value.validated).length,conflicts=all.filter(r=>r.conflict),colValue=sumCardValues(ownedClean,cardPrices);
 $('collection-status').textContent=conflicts.length?'Review edits':pending?'Validation pending':'All organised';$('pending-count').textContent=conflicts.length?`${conflicts.length} conflicting entries · excluded from totals`:pending?`${pending} awaiting Scryfall validation`:'No cards awaiting validation';
 $('collection-value').textContent=colValue.pricedCount?`£${colValue.total.toFixed(2)}`:'—';$('priced-count').textContent=colValue.pricedCount?`Across ${colValue.pricedCount} priced ${colValue.pricedCount===1?'card':'cards'}`:'No priced cards yet';
 const deckSelect=$('deck-filter'),oldDeck=deckSelect.value;deckSelect.innerHTML='<option value="">All collection</option>'+decks.filter(d=>d.value).sort((a,b)=>Number(!!b.value.favourite)-Number(!!a.value.favourite)).map(d=>`<option value="${esc(d.id)}">${esc(d.value.name)}</option>`).join('');if(decks.some(d=>d.id===oldDeck))deckSelect.value=oldDeck;activeDeck=deckSelect.value;
 const q=$('filter').value.toLowerCase().trim(),finish=$('finish-filter').value,ownedSuper=terms($('owned-supertype').value),ownedTypes=terms($('owned-type').value),ownedSub=terms($('owned-subtype').value),identity=[...document.querySelectorAll('input[name="owned-identity"]:checked')].map(x=>x.value.toUpperCase()),onlyLegal=$('owned-legal').checked;
 let visible=ownedActive.filter(r=>{const v=r.value||r.heads.find(h=>h.value)?.value;if(!v)return false;const assigned=v.deckCounts?.[activeDeck]||0;const parts=String(v.type||'').toLowerCase().split('—').map(s=>s.trim()),left=parts[0]||'',right=parts[1]||'',passTerms=(list,source)=>list.every(t=>source.includes(t));return (!activeDeck||assigned>0)&&(!finish||v.finish===finish)&&[v.name,v.set,v.setName,v.location,v.type,v.notes].some(s=>String(s||'').toLowerCase().includes(q))&&passTerms(ownedSuper,left)&&passTerms(ownedTypes,left)&&passTerms(ownedSub,right)&&(!identity.length||(v.colorIdentity&&identity.every(c=>v.colorIdentity.includes(c))))&&(!onlyLegal||v.legalities?.commander==='legal');});
 const sort=$('sort').value,ungroup=$('ungroup-cards').checked,groupedVisible=groupCollectionEntries(visible,{ungroup,activeDeck});
 groupedVisible.sort((a,b)=>{const ar=a.primary,br=b.primary,av=ar.value||{},bv=br.value||{};if(sort==='recent')return br.heads[0].at.localeCompare(ar.heads[0].at);if(sort==='quantity')return b.quantity-a.quantity;if(sort==='value')return ((cardPrices.get(br.id)?.gbp??-1)-(cardPrices.get(ar.id)?.gbp??-1))||String(av.name||'').localeCompare(String(bv.name||''));if(sort==='type')return cardTypeGroup(av).localeCompare(cardTypeGroup(bv))||String(av.name||'').localeCompare(String(bv.name||''));return String(sort==='set'?av.setName:av.name).localeCompare(String(sort==='set'?bv.setName:bv.name));});
 $('result-count').textContent=`${groupedVisible.length} ${groupedVisible.length===1?'entry':'entries'}`;
 let lastGroup='';
 $('cards').innerHTML=groupedVisible.map(g=>{const r=g.primary,v=r.value||r.heads.find(h=>h.value)?.value,img=imageUrl(v.image),qty=g.quantity,tags=decks.filter(d=>d.value&&(g.deckCounts?.[d.id]||0)>0).map(d=>`<span class="deck-tag">${esc(d.value.name)} · ${g.deckCounts[d.id]}</span>`).join(''),group=sort==='type'?cardTypeGroup(v):'',heading=group&&group!==lastGroup?`<h3 class="card-group-heading">${esc(lastGroup=group)}</h3>`:'',price=cardPrices.get(r.id),priceHtml=`<div class="price-line">${price?`<strong>£${price.gbp.toFixed(2)}</strong><span>Cardmarket · €${price.eur.toFixed(2)}</span>`:'<span class="price-muted">Price unavailable</span>'}</div>`,setText=g.rows.length>1?`${g.printingsCount>1?`${g.printingsCount} printings`:v.setName||'Combined entries'}`:`${v.setName||'Manual entry'}${v.number?' · #'+v.number:''}`,stackClass=qty>5?'card-stack-2':qty>1?'card-stack-1':'',palette={W:'#ead06b',U:'#4e9dd2',B:'#786a98',R:'#df5c4d',G:'#4f9964'},altPalette={W:'#c49432',U:'#2b6fa3',B:'#51466d',R:'#b33b2e',G:'#2f6f42'},idColors=(v.colorIdentity||[]).map(c=>palette[c]).filter(Boolean),c1=g.printingsCount>1?(idColors[0]||'#8e9892'):'#cfc6b2',c2=g.printingsCount>1?(idColors[1]||altPalette[v.colorIdentity?.[0]]||'#6c7670'):'#b8af9b',stackStyle=stackClass?` style="--stack-c1:${c1};--stack-c2:${c2};"`:'';return `${heading}<button class="card ${stackClass}"${stackStyle} data-record="${esc(r.id)}" aria-label="${esc(r.conflict?'Resolve conflict for '+v.name:'Edit '+v.name)}"><div class="collection-card-art">${img?`<img class="card-art" src="${esc(img)}" alt="${esc(v.name)}" loading="lazy">`:placeholder(v.name)}${flipButton(v)}</div><div class="card-info"><h3>${esc(v.name)}</h3><p>${esc(setText)}</p><p>${esc(v.location||'No location assigned')}</p><div class="card-meta"><span class="quantity">${r.conflict?'Review required':'× '+qty}</span><span class="badge ${r.conflict||!v.validated?'warning':''}">${r.conflict?'Conflicting edits':!v.validated?'Awaiting validation':esc(v.finish)}</span></div><div class="deck-tags">${tags||'<span class="deck-tag unassigned">Not in a deck</span>'}</div>${priceHtml}</div></button>`;}).join('');
 $('empty').hidden=ownedActive.length>0;
 if(ownedActive.length&&!groupedVisible.length)$('cards').innerHTML='<p class="muted">No cards match your filters.</p>';
 $('cards').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{const replacement=document.createElement('div');replacement.innerHTML=placeholder(img.alt);img.replaceWith(replacement.firstElementChild);},{once:true}));
 $('conflicts').innerHTML=conflicts.length?conflicts.map(r=>`<div class="conflict"><h4>${esc(r.heads.find(h=>h.value)?.value.name||'Deleted entry')}</h4>${r.heads.map((h,i)=>`<div><p>${h.value?`${esc(h.value.name)} · × ${h.value.quantity} · ${esc(h.value.finish)} · ${esc(h.value.language)} · ${esc(h.value.condition)}<br>${esc(h.value.setName||'Manual entry')} #${esc(h.value.number||'')} · ${esc(h.value.location||'No location')}<br>Notes: ${esc(h.value.notes||'None')}`:'Deleted on another device'}<br>${esc(new Date(h.at).toLocaleString())}</p><button class="button subtle" data-resolve="${esc(r.id)}" data-index="${i}">Keep this ${h.value?'version':'deletion'}</button></div>`).join('')}</div>`).join(''):'<p>No conflicting edits.</p>';
 const last=localStorage.getItem('arcana-last-sync');$('sync-footer').textContent=last?`Last Drive sync · ${new Date(last).toLocaleString()}`:'Local storage · Download a backup to keep it safe';
 renderDeckManager(decks,clean);renderShoppingList(clean,decks);hydrateCards(clean);refreshPrices(clean);
}
async function refreshPrices(cards){
 const items=cards.filter(r=>r.value?.cardmarketId).map(r=>({id:r.id,cardmarketId:r.value.cardmarketId,finish:r.value.finish}));
 const key=items.map(c=>`${c.id}:${c.cardmarketId}:${c.finish}`).join('|');
 if(!items.length||key===lastPriceKey)return;
 lastPriceKey=key;
 try{const res=await priceCards(items);cardPrices=res.prices;render();}catch(e){console.info('Prices unavailable',e);}
}
function renderShoppingList(cards,decks){
 const grouped=new Map();for(const row of cards.filter(r=>r.value.notOwned)){const key=String(row.value.name||'').trim().toLocaleLowerCase();if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}const groups=[...grouped.values()].sort((a,b)=>String(a[0].value.name).localeCompare(String(b[0].value.name)));
 $('shopping-cards').innerHTML=groups.length?groups.map(group=>{const primary=group[0].value,name=primary.name,art=imageUrl(primary.image),byDeck=new Map();let total=0,assigned=0;for(const row of group){const v=row.value,quantity=Number(v.quantity)||Object.values(v.deckCounts||{}).reduce((a,n)=>a+n,0);total+=quantity;for(const [id,count] of Object.entries(v.deckCounts||{})){if(count>0){assigned+=count;byDeck.set(id,(byDeck.get(id)||0)+count);}}}const deckTags=[...byDeck].map(([id,count])=>{const deck=decks.find(d=>d.id===id&&d.value&&!d.conflict);return deck?`<button type="button" class="deck-tag" data-shopping-deck="${esc(deck.id)}">${esc(deck.value.name)} · ${count}</button>`:'';}).filter(Boolean).join(''),unassigned=Math.max(0,total-assigned),versions=group.length>1?`<p>${group.length} printings</p>`:'';return `<article class="card shopping-card is-not-owned"><div class="shopping-card-art">${art?`<img class="card-art" src="${esc(art)}" alt="${esc(name)}" loading="lazy">`:placeholder(name)}${flipButton(primary)}</div><div class="card-info"><h3>${esc(name)} <span class="not-owned-tag">Not Owned</span></h3><p>${esc(primary.setName||'Manual entry')}${primary.number?' · #'+esc(primary.number):''}</p>${versions}<div class="card-meta"><span class="quantity">Quantity · ${total}</span><span class="badge warning">Shopping list</span></div><div class="deck-tags">${deckTags}${unassigned?`<span class="deck-tag unassigned">Unassigned · ${unassigned}</span>`:''}</div>${(()=>{const p=cardPrices.get(group[0].id);return `<div class="price-line">${p?`<strong>£${(p.gbp*total).toFixed(2)}</strong><span>£${p.gbp.toFixed(2)} each</span>`:'<span class="price-muted">Price unavailable</span>'}</div>`;})()}</div></article>`;}).join(''):'<div class="empty shopping-empty"><div class="eyebrow">NOTHING ON THE LIST</div><h2>No cards marked Not Owned.</h2><p>Add cards from a deck’s search and they’ll appear here.</p></div>';
 const summaryEl=$('shopping-summary'),totalEl=$('shopping-total');
 if(totalEl){if(groups.length){const notOwnedRows=cards.filter(r=>r.value.notOwned),totalCards=notOwnedRows.reduce((s,r)=>s+(Number(r.value.quantity)||Object.values(r.value.deckCounts||{}).reduce((a,n)=>a+n,0)||1),0),val=sumCardValues(notOwnedRows,cardPrices,r=>Number(r.value.quantity)||Object.values(r.value.deckCounts||{}).reduce((a,n)=>a+n,0)||1);totalEl.innerHTML=`<div><span class="eyebrow">ESTIMATED SHOPPING TOTAL</span><strong>${val.pricedCount?`£${val.total.toFixed(2)}`:'—'}</strong><small>${val.pricedCount?`${val.pricedCount} of ${totalCards} cards priced (Cardmarket)`:'Prices unavailable or loading'}</small></div><p class="shopping-disclaimer">These prices aren’t live and may be subject to change and delivery costs.</p>`;totalEl.hidden=false;}else{totalEl.innerHTML='';totalEl.hidden=true;}}
 if(summaryEl){if(groups.length){const items=groups.map(group=>{const total=group.reduce((s,row)=>s+(Number(row.value.quantity)||Object.values(row.value.deckCounts||{}).reduce((a,n)=>a+n,0)),0);return `${total}× ${group[0].value.name}`;});summaryEl.textContent=`Not Owned cards (${items.length}): ${items.join(', ')}`;summaryEl.hidden=false;}else{summaryEl.textContent='';summaryEl.hidden=true;}}
}
function exportShoppingList(){
 const csv=shoppingCsv(events),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`manahorde-shopping-list-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function terms(s){return s.toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);}
function renderDeckAssignments(value){
 const allDecks=records(events).filter(r=>r.value?.kind==='deck'&&!r.conflict&&r.value),cards=records(events).filter(r=>r.value&&r.value.kind!=='deck'&&!r.conflict),quantity=Number(value.quantity)||1,counts=assignmentDraft,assigned=Object.values(counts).reduce((a,n)=>a+n,0),decks=allDecks.filter(d=>cardFitsDeck(value,d,cards)),incompatible=allDecks.filter(d=>counts[d.id]&&!decks.some(valid=>valid.id===d.id)),createOption=value.commanderEligible&&value.legalities?.commander==='legal'?'<button type="button" class="text-button create-deck-from-card" data-create-deck-from-card>Create new Deck</button>':'';
 if(!decks.length){$('deck-assignments').innerHTML='<p>No existing decks are valid for this card.</p>'+createOption;return;}
 if(quantity===1){const ids=Object.keys(counts).filter(id=>counts[id]>0);$('deck-assignments').innerHTML=`<label class="assignment-row"><input type="radio" name="deck-assignment" value="" data-deck-assignment ${ids.length===0?'checked':''}>Not in a deck</label>${decks.map(d=>`<label class="assignment-row"><input type="radio" name="deck-assignment" value="${esc(d.id)}" data-deck-assignment ${ids.length===1&&counts[d.id]?'checked':''}>${esc(d.value.name)}</label>`).join('')}${incompatible.map(d=>`<label class="assignment-row incompatible-assignment"><input type="radio" name="deck-assignment" value="" data-deck-assignment checked>Remove from ${esc(d.value.name)} (card is not legal)</label>`).join('')}${assigned>1?'<p class="assignment-warning">This entry has more than one copy assigned. Choose one deck or Not in a deck before saving.</p>':''}${createOption}`;return;}
 $('deck-assignments').innerHTML=decks.map(d=>`<label class="assignment-row"><input type="checkbox" value="${counts[d.id]?1:0}" data-deck-assignment data-deck-id="${esc(d.id)}" ${counts[d.id]?'checked':''}>${esc(d.value.name)}</label>`).join('')+incompatible.map(d=>`<label class="assignment-row incompatible-assignment"><input type="checkbox" value="1" data-deck-assignment data-deck-id="${esc(d.id)}" checked>${esc(d.value.name)} · card is not legal</label>`).join('')+`<p class="assignment-total">Assigned ${assigned} of ${quantity} copies</p>${assigned>quantity?'<p class="assignment-warning">Reduce assignments to match the quantity owned.</p>':''}${createOption}`;
}
function renderDeckManager(decks,cards){
 const validDecks=decks.filter(d=>d.value&&!d.conflict).sort((a,b)=>Number(!!b.value.favourite)-Number(!!a.value.favourite));$('decks-nav').classList.toggle('active',currentPage==='deck'||currentPage==='decks');$('home-nav').classList.toggle('active',currentPage==='home');$('collection-nav').classList.toggle('active',currentPage==='collection');$('shopping-nav').classList.toggle('active',currentPage==='shopping');
 document.querySelectorAll('[data-mobile-nav]').forEach(b=>b.classList.toggle('active',b.dataset.mobileNav==={home:'home-nav',collection:'collection-nav',shopping:'shopping-nav',deck:'decks-nav',decks:'decks-nav'}[currentPage]));
 const deckButton=d=>{const members=cards.filter(r=>(r.value.deckCounts?.[d.id]||0)>0),count=members.reduce((n,r)=>n+r.value.deckCounts[d.id],0),cmd=(d.value.commanders||[]).map(id=>members.find(r=>r.id===id)).find(Boolean)||members.find(r=>r.value.commanderEligible),art=cmd&&artUrl(cmd.value),checks=validateCommanderDeck(d,members,cards);return {members,count,cmd,art,checks};};
 $('decks-submenu').innerHTML=`<button type="button" class="deck-submenu-new" data-sidebar-new>＋ New Deck</button>${validDecks.map(d=>{const {art}=deckButton(d);return `<button type="button" class="deck-submenu-item" data-sidebar-deck="${esc(d.id)}">${art?`<span class="deck-menu-art"><img src="${esc(art)}" alt="" loading="lazy"></span>`:'<span class="deck-menu-art deck-submenu-placeholder">◇</span>'}<span class="deck-menu-copy">${esc(d.value.name)}</span></button>`;}).join('')}`;
 const deckItems=validDecks.map(d=>({d,...deckButton(d)})).filter(item=>(!$('deck-filter-legal')?.checked||item.checks.valid)&&(!$('deck-filter-favourite')?.checked||item.d.value.favourite));
 const showCollectionDecks=isDeckCtasVisible();
 $('collection-deck-section').hidden=!validDecks.length;$('collection-deck-ctas').hidden=!showCollectionDecks;$('collection-deck-section').querySelector('h2').hidden=!showCollectionDecks;$('deck-filter-legal').closest('label').hidden=!showCollectionDecks;$('deck-filter-favourite').closest('label').hidden=!showCollectionDecks;$('toggle-deck-ctas').textContent=showCollectionDecks?'Hide decks':'Show decks';$('toggle-deck-ctas').setAttribute('aria-expanded',String(showCollectionDecks));$('collection-deck-ctas').innerHTML=deckItems.length?deckItems.map(({d,members,count,checks,art})=>{const selected=(d.value.commanders||[]).map(id=>members.find(r=>r.id===id)).filter(Boolean),identity=[...new Set(selected.flatMap(r=>r.value.colorIdentity||[]))],palette={W:'#ead06b',U:'#4e9dd2',B:'#786a98',R:'#df5c4d',G:'#4f9964'},colors=identity.map(c=>palette[c]).filter(Boolean),borderGradient=colors.length===1?`linear-gradient(120deg,${colors[0]},${colors[0]})`:colors.length?`linear-gradient(120deg,${colors.join(',')})`:'linear-gradient(120deg,#b8bdb3,#8f968b)';const bracket=Math.min(5,Math.max(1,Number(d.value.bracket)||3)),bracketBg=['#ffffff','#d7ebd9','#d7e7f7','#f7dad7','#d0d4d2'][bracket-1],commanderNames=selected.map(r=>r.value.name).join(' & ')||'No commander';return `<button type="button" class="collection-deck-cta bracket-${bracket}" style="--cta-border:${borderGradient};--bracket-bg:${bracketBg};" data-collection-deck="${esc(d.id)}">${d.value.favourite?'<span class="deck-favourite-star" aria-label="Favourite deck">★</span>':''}${checks.valid?'':'<span class="deck-attention-mark" aria-label="Deck needs attention">!</span>'}<span class="collection-deck-thumb">${art?`<img src="${esc(art)}" alt="" loading="lazy">`:'◇'}</span><span class="collection-deck-copy"><strong class="collection-deck-name">${esc(d.value.name)}</strong><span class="collection-deck-sub">${esc(commanderNames)} · B${bracket} · ${count}</span></span></button>`;}).join(''):'<p class="muted">No decks match the selected filters.</p>';
 const deckListHtml=validDecks.length?validDecks.map(d=>{const {count,cmd,art,checks}=deckButton(d);return `<button type="button" class="deck-row" data-deck-open="${esc(d.id)}"><div class="deck-thumb-wrapper">${art?`<img class="deck-thumb" src="${esc(art)}" alt="${esc(cmd.value.name)} commander art" loading="lazy">`:'<span class="deck-thumb deck-thumb-empty">◇</span>'}${d.value.favourite?'<span class="deck-favourite-star" aria-label="Favourite deck">★</span>':''}</div><span class="deck-row-copy"><strong>${esc(d.value.name)}</strong><span>${count}/100 cards</span><span class="deck-validity ${checks.valid?'valid':'invalid'}">${checks.valid?'Commander rules pass':'Needs attention'}</span></span></button>`;}).join(''):'<p class="muted">No decks yet. Choose New Deck to get started.</p>';
 $('deck-list').innerHTML=deckListHtml;$('decks-page-list').innerHTML=deckListHtml;
 $('decks-home').hidden=false;$('deck-detail').hidden=true;$('home-page').hidden=currentPage!=='home';$('information-page').hidden=currentPage!=='information';$('collection-page').hidden=currentPage!=='collection';$('decks-page').hidden=currentPage!=='decks';$('deck-page').hidden=currentPage!=='deck';$('shopping-page').hidden=currentPage!=='shopping';
 if(currentPage==='deck'){const deck=validDecks.find(d=>d.id===selectedDeck);if(deck)renderDeckPage(deck,cards);else{currentPage='collection';$('deck-page').hidden=true;$('collection-page').hidden=false;}}
}
function deckCardLegalityIssue(deck,members,row){
 const v=row.value,commanders=(deck.value.commanders||[]).map(id=>members.find(r=>r.id===id)).filter(Boolean);
 if(v.legalities?.commander!=='legal')return v.legalities?.commander?'Not legal in Commander':'Commander legality not verified';
 if(!commanders.length)return '';
 if(!Array.isArray(v.colorIdentity))return 'Colour identity not verified';
 if(commanders.some(r=>!Array.isArray(r.value.colorIdentity)))return 'Commander colour identity not verified';
 const allowed=new Set(commanders.flatMap(r=>r.value.colorIdentity||[]));if(v.colorIdentity.some(c=>!allowed.has(c)))return 'Outside commander colour identity';
 const name=v.name.toLowerCase(),same=members.filter(r=>r.value.name.toLowerCase()===name),copies=same.reduce((n,r)=>n+(r.value.deckCounts?.[deck.id]||0),0);if(copies>1&&!same.some(r=>allowsMultipleCopies(r.value)))return 'Commander is singleton: extra copy';
 return '';
}
function renderDeckPage(deck,cards){
 const members=cards.filter(r=>(r.value.deckCounts?.[deck.id]||0)>0),commanders=deck.value.commanders||[],checks=validateCommanderDeck(deck,members),size=members.reduce((n,r)=>n+r.value.deckCounts[deck.id],0),commanderRows=commanders.map(id=>members.find(r=>r.id===id)).filter(Boolean),otherRows=members.filter(r=>!commanders.includes(r.id)),ordered=deckSort==='name'?[...members].sort((a,b)=>String(a.value.name||'').localeCompare(String(b.value.name||''))):deckSort==='value'?[...members].sort((a,b)=>((cardPrices.get(b.id)?.gbp??-1)-(cardPrices.get(a.id)?.gbp??-1))||String(a.value.name||'').localeCompare(String(b.value.name||''))):deckSort==='type'?[...commanderRows,...[...otherRows].sort((a,b)=>cardTypeGroup(a.value).localeCompare(cardTypeGroup(b.value))||String(a.value.name||'').localeCompare(String(b.value.name||'')))]:[...commanderRows,...otherRows];
 const bracket=Math.min(5,Math.max(1,Number(deck.value.bracket)||3)),lead=commanderRows[0],leadArt=lead&&imageUrl(lead.value.image),leadNames=commanderRows.map(r=>r.value.name).join(' & ')||'No commander selected',leadText=commanderRows.map(r=>[r.value.type,r.value.text].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')||'Choose “Set as Commander” on an eligible card below to display your commander here.',suggestedPlaystyle=suggestDeckPlaystyle(commanderRows),playstyleText=typeof deck.value.playstyle==='string'&&deck.value.playstyle.trim()?deck.value.playstyle:suggestedPlaystyle,hasCustomPlaystyle=typeof deck.value.playstyle==='string'&&deck.value.playstyle.trim()!==''&&deck.value.playstyle.trim()!==suggestedPlaystyle,leadColors=[...new Set(commanderRows.flatMap(r=>r.value.colorIdentity||[]))].filter(c=>['W','U','B','R','G'].includes(c)),chipPalette={W:'#f1df9a',U:'#5b97d2',B:'#465251',R:'#d85c54',G:'#4e9a62'},favChipBg=leadColors.length>1?`conic-gradient(${leadColors.map((c,i)=>`${chipPalette[c]} ${(i*100/leadColors.length).toFixed(2)}% ${((i+1)*100/leadColors.length).toFixed(2)}%`).join(',')})`:leadColors.length===1?chipPalette[leadColors[0]]:'#cfc9bc',favManaLabel=leadColors.length?leadColors.join(''):'◇',favChipText=leadColors.length===1&&leadColors[0]==='W'?'#554719':leadColors.length?'#fff':'#3d3a34',deckValue=sumCardValues(members,cardPrices,r=>r.value.deckCounts?.[deck.id]||0);let lastDeckGroup='';
 const crownSvg='<span class="commander-crown" aria-label="Commander"><svg viewBox="0 0 120 50" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="cg-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#eab854"/><stop offset="55%" stop-color="#c98d2b"/><stop offset="100%" stop-color="#9c6718"/></linearGradient><linearGradient id="cg-band" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e3ad47"/><stop offset="65%" stop-color="#b87b20"/><stop offset="100%" stop-color="#875511"/></linearGradient></defs><path d="M3 39Q60 29 117 39Q118 24 115 12Q106 23 99 24Q93 25 88 18Q82 26 75 25Q68 24 60 7Q52 24 45 25Q38 26 32 18Q27 25 21 24Q14 23 5 12Q2 24 3 39z" fill="url(#cg-front)" stroke="#7d4f10" stroke-width="1.4" stroke-linejoin="round"/><path d="M22 33Q31 27 42 32M78 32Q89 27 98 33M50 28Q60 19 70 28" fill="none" stroke="#f5d37d" stroke-width="1.3" stroke-linecap="round" opacity=".55"/><path d="M3 39Q60 29 117 39L119 48Q114 49 111 45Q60 36 9 45Q6 49 1 48z" fill="url(#cg-band)" stroke="#73480d" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 37Q60 27 112 37" fill="none" stroke="#f7d98a" stroke-width="1.4" stroke-linecap="round" opacity=".6"/><path d="M60 1.5C62.5 1.5 64 4 60 7C56 4 57.5 1.5 60 1.5z" fill="#eab854" stroke="#7d4f10" stroke-width="1.1"/><circle cx="5" cy="11.5" r="2.6" fill="#eab854" stroke="#7d4f10" stroke-width="1.1"/><circle cx="115" cy="11.5" r="2.6" fill="#eab854" stroke="#7d4f10" stroke-width="1.1"/><circle cx="32" cy="17.5" r="2.2" fill="#eab854" stroke="#7d4f10" stroke-width="1"/><circle cx="88" cy="17.5" r="2.2" fill="#eab854" stroke="#7d4f10" stroke-width="1"/><ellipse cx="60" cy="37.5" rx="3.4" ry="2.6" fill="#d9a13b" stroke="#855412" stroke-width="1"/><circle cx="34" cy="38.5" r="2.1" fill="#d9a13b" stroke="#855412" stroke-width=".9"/><circle cx="86" cy="38.5" r="2.1" fill="#d9a13b" stroke="#855412" stroke-width=".9"/><circle cx="16" cy="40.5" r="1.6" fill="#d9a13b" stroke="#855412" stroke-width=".8"/><circle cx="104" cy="40.5" r="1.6" fill="#d9a13b" stroke="#855412" stroke-width=".8"/></svg></span>';
 const simpleGroups=[];if(deckSimpleView){const grouped=new Map();if(commanderRows.length)grouped.set('Commander',[...commanderRows].sort((a,b)=>String(a.value.name||'').localeCompare(String(b.value.name||''))));for(const r of [...otherRows].sort((a,b)=>cardTypeGroup(a.value).localeCompare(cardTypeGroup(b.value))||String(a.value.name||'').localeCompare(String(b.value.name||'')))){const g=cardTypeGroup(r.value);if(!grouped.has(g))grouped.set(g,[]);grouped.get(g).push(r);}for(const [label,list] of grouped)simpleGroups.push([label,list]);}
 const membersHtml=deckSimpleView?(simpleGroups.length?`<div class="deck-stack-groups">${simpleGroups.map(([label,list])=>`<section class="deck-stack-group"><h3>${esc(label)}</h3><div class="deck-stack">${list.map(r=>{const v=r.value,art=imageUrl(v.image);return `<button type="button" class="deck-stack-card ${v.notOwned?'is-not-owned':''}" data-stack-card="${esc(r.id)}" aria-label="${esc(v.name)}">${art?`<img src="${esc(art)}" alt="${esc(v.name)}" loading="lazy">`:`<span class="deck-card-empty">${esc(v.name)}</span>`}</button>`;}).join('')}</div></section>`).join('')}</div>`:'<p>No cards assigned yet.</p>'):`<div class="deck-card-grid">${ordered.map(r=>{const v=r.value,isCommander=commanders.includes(r.id),canLead=v.commanderEligible||v.backgroundEligible,art=imageUrl(v.image),action=v.backgroundEligible&&!v.commanderEligible?'Set as Background':'Set as Commander',count=v.deckCounts[deck.id],issue=deckCardLegalityIssue(deck,members,r),group=deckSort==='type'?(isCommander?'Commander':cardTypeGroup(v)):'',heading=group&&group!==lastDeckGroup?`<h3 class="card-group-heading">${esc(lastDeckGroup=group)}</h3>`:'';return `${heading}<article class="deck-display-card ${isCommander?'is-commander':''} ${canLead?'can-command':''} ${issue?'illegal-card':''} ${v.notOwned?'is-not-owned':''}" data-manage-deck-card="${esc(r.id)}" tabindex="0" role="group" aria-label="Manage quantity for ${esc(v.name)}">${isCommander?crownSvg:''}<div class="deck-card-art">${art?`<img src="${esc(art)}" alt="${esc(v.name)}" loading="lazy">`:'<span class="deck-card-empty">◇</span>'}${flipButton(v)}<button type="button" class="remove-deck-card" data-remove-from-deck="${esc(r.id)}" aria-label="${v.notOwned?'Remove '+esc(v.name)+' from deck and shopping list':'Remove one '+esc(v.name)+' copy from deck'}" title="${v.notOwned?'Remove from deck and shopping list':'Remove one copy from deck'}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></div><div class="deck-card-caption"><strong>${esc(v.name)}</strong><small>× ${count}${isCommander?' · Commander':canLead?' · Commander-capable':''}</small>${v.notOwned?'<span class="not-owned-tag">Not Owned</span>':''}${issue?`<small class="card-legality-comment">${esc(issue)}</small>`:''}${canLead?`<button type="button" class="commander-action" data-deck-commander="${esc(r.id)}" ${isCommander?'disabled':''}>${isCommander?'Commander selected':action}</button>`:''}</div></article>`;}).join('')||'<p>No cards assigned yet.</p>'}</div>`;
 const notOwnedMembers=ordered.filter(r=>r.value.notOwned),notOwnedSummary=notOwnedMembers.length?`<p class="not-owned-summary"><strong>Not Owned (${notOwnedMembers.reduce((s,r)=>s+(r.value.deckCounts?.[deck.id]||0),0)}):</strong> ${esc(notOwnedMembers.map(r=>`${r.value.deckCounts[deck.id]}× ${r.value.name}`).join(', '))}</p>`:'';
 $('deck-page-content').innerHTML=`<div class="page-heading"><div><div class="deck-title-row"><h1>${esc(deck.value.name)}</h1><button type="button" class="icon-button deck-rename-button" id="rename-deck" aria-label="Rename deck" title="Rename deck">✎</button></div></div><span class="deck-validity ${checks.valid?'valid':'invalid'}">${checks.valid?'Commander rules pass':'Needs attention'}</span></div><div class="deck-overview"><div class="deck-commander-art">${leadArt?`<img src="${esc(leadArt)}" alt="${esc(lead.value.name)}" loading="lazy">`:'<div class="card-placeholder"><span>♛</span>No commander</div>'}${lead?flipButton(lead.value):''}</div><div class="deck-commander-details"><div class="deck-commander-header"><div class="eyebrow">COMMANDER</div><label class="deck-fav-mana" title="${deck.value.favourite?'Favourited (click to unfavourite)':'Favourite this deck'}"><input type="checkbox" id="deck-favourite" ${deck.value.favourite?'checked':''} aria-label="Favourite deck"><span class="mana-chip deck-fav-chip" style="background:${favChipBg};color:${favChipText};" aria-hidden="true">${favManaLabel}</span><span class="deck-fav-label">Favourite</span></label></div><h2>${esc(leadNames)}</h2><p class="deck-commander-text">${esc(leadText)}</p><div class="deck-playstyle"><div class="deck-playstyle-header"><label for="deck-playstyle" class="eyebrow">HOW TO PLAY THIS DECK</label><div class="deck-playstyle-actions">${commanderRows.length?'<button type="button" class="text-button" id="search-commander-online">Search online</button>':''}${hasCustomPlaystyle?'<button type="button" class="text-button" id="reset-playstyle">Reset to suggested</button>':''}</div></div><textarea id="deck-playstyle" rows="4" maxlength="4000" placeholder="Describe how this deck should be played…">${esc(playstyleText)}</textarea></div><div class="deck-total-cost"><span class="eyebrow">ESTIMATED DECK COST</span><strong>${deckValue.pricedCount?`£${deckValue.total.toFixed(2)}`:'—'}</strong><small>${deckValue.pricedCount?`${deckValue.pricedCount} of ${size} cards priced (Cardmarket)`:'Prices unavailable or loading'}</small></div></div><section class="deck-bracket"><div class="deck-bracket-heading"><label for="deck-bracket-range">EDH Bracket</label><div class="bracket-shape bracket-shape-${bracket}" id="deck-bracket-shape"><output id="deck-bracket-value" aria-live="polite">${bracket}</output><span class="bracket-mana-symbol white">W</span><span class="bracket-mana-symbol blue">U</span><span class="bracket-mana-symbol black">B</span><span class="bracket-mana-symbol red">R</span><span class="bracket-mana-symbol green">G</span></div></div><div class="deck-bracket-scale"><span aria-label="Bracket 1: smiley face">1 🙂</span><input type="range" id="deck-bracket-range" min="1" max="5" step="1" value="${bracket}" aria-label="Deck bracket, from 1 to 5"><span aria-label="Bracket 5: crossed swords">⚔️ 5</span></div></section><ul class="deck-issues">${checks.issues.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>Deck size, legality, colour identity and singleton checks passed.</li>'}</ul></div><section class="deck-members"><div class="deck-members-header"><h2>Cards in this deck</h2><div class="deck-members-controls"><label class="deck-cta-toggle"><input type="checkbox" id="deck-simple-view" ${deckSimpleView?'checked':''}> Simplified view</label><select id="deck-sort" aria-label="Sort deck cards" ${deckSimpleView?'hidden':''}><option value="default" ${deckSort==='default'?'selected':''}>Default order</option><option value="name" ${deckSort==='name'?'selected':''}>Name A–Z</option><option value="type" ${deckSort==='type'?'selected':''}>Card type (A–Z)</option><option value="value" ${deckSort==='value'?'selected':''}>Value (high–low)</option></select></div></div>${deckSimpleView?'<p>Click any card to slide stacked cards below it down for a clear view.</p>':'<p>Use “Set as Commander” on a commander-capable card. Legality checks update automatically.</p>'}${membersHtml}${notOwnedSummary}</section><section class="deck-add"><h2>Add cards to this deck</h2><div class="deck-tool-buttons"><button type="button" class="button subtle" id="deck-collection-toggle" aria-expanded="${deckSearchOpen}">＋ Add from my collection</button><button type="button" class="button subtle" id="optimized-basic-lands">＋ Add optimised basic lands</button><button type="button" class="button subtle" id="add-unowned-card">＋ Add a wanted card</button></div><div class="deck-search-panel" ${deckSearchOpen?'':'hidden'}><label>Search your collection<input type="search" data-owned-search value="${esc(deckSearch)}" placeholder="Search owned cards…"></label><div class="deck-owned-results"></div></div></section>`;
 renderDeckPicker(deck,cards);
 if(pendingCommanderAnim){
  const {id,from}=pendingCommanderAnim;pendingCommanderAnim=null;
  const target=$('deck-page-content').querySelector(`.deck-display-card.is-commander[data-manage-deck-card="${CSS.escape(id)}"]`);
  if(target&&from){
   const to=target.getBoundingClientRect(),dx=from.left-to.left,dy=from.top-to.top,crown=target.querySelector('.commander-crown');
   if(crown)crown.classList.add('is-entering');
   target.style.transition='none';target.style.transform=`translate(${dx}px,${dy}px)`;target.style.zIndex='8';target.offsetWidth;
   target.style.transition='transform .46s cubic-bezier(.22,.68,.28,1)';target.style.transform='translate(0,0)';
   const land=()=>{
    target.style.transition='';target.style.transform='';target.style.zIndex='';
    if(crown){crown.classList.remove('is-entering');crown.classList.add('is-landing');setTimeout(()=>crown.classList.remove('is-landing'),450);}
    const burst=document.createElement('div');burst.className='commander-confetti';
    const colors=['#f6ce6b','#4e9dd2','#8473aa','#df5c4d','#4f9964','#fff4b8'];
    for(let i=0;i<24;i++){const p=document.createElement('i'),angle=(Math.PI*2*i)/24+(Math.random()-.5)*.25,dist=65+Math.random()*75;p.style.setProperty('--tx',`${Math.cos(angle)*dist}px`);p.style.setProperty('--ty',`${Math.sin(angle)*dist-25}px`);p.style.setProperty('--rot',`${Math.round((Math.random()-.5)*540)}deg`);p.style.background=colors[i%colors.length];burst.appendChild(p);}
    target.appendChild(burst);setTimeout(()=>burst.remove(),1000);
   };
   setTimeout(land,470);
  }
 }
}function renderDeckPicker(deck,cards){
 const box=$('deck-page-content').querySelector('.deck-owned-results');if(!box)return;const q=deckSearch.toLowerCase().trim();
 const matches=cards.filter(r=>!r.value.notOwned&&cardFitsDeck(r.value,deck,cards)&&(!q||[r.value.name,r.value.setName,r.value.type].some(s=>String(s||'').toLowerCase().includes(q)))).sort((a,b)=>String(a.value.name||'').localeCompare(String(b.value.name||''))).slice(0,80);
 box.innerHTML=matches.length?matches.map(r=>{const v=r.value,art=artUrl(v),counts=v.deckCounts||{},assigned=Object.values(counts).reduce((a,n)=>a+n,0),free=v.quantity-assigned,here=counts[deck.id]||0,multiple=allowsMultipleCopies(v),sources=records(events).filter(d=>d.value?.kind==='deck'&&!d.conflict&&d.id!==deck.id&&counts[d.id]>0);return `<div class="deck-owned-row"><div class="deck-owned-info">${art?`<img class="deck-owned-thumb" src="${esc(art)}" alt="${esc(v.name)}" loading="lazy">`:'<span class="deck-owned-thumb deck-owned-thumb-empty" aria-hidden="true">◇</span>'}<span><strong>${esc(v.name)}</strong><small>Owned ${v.quantity} · In this deck ${here}</small></span></div><span class="deck-owned-actions">${free>0?(multiple&&free>1?`<label class="deck-add-quantity">Add copies<input type="number" min="1" max="${free}" value="1" data-copy-quantity="${esc(r.id)}"></label><button type="button" class="button primary" data-add-copy="${esc(r.id)}">Add quantity</button>`:`<button type="button" class="button primary" data-add-copy="${esc(r.id)}">Add 1 unassigned</button>`):''}${sources.map(d=>`<button type="button" class="button subtle" data-move-copy="${esc(r.id)}" data-from-deck="${esc(d.id)}">Move 1 from ${esc(d.value.name)}</button>`).join('')||(!free?'<small>No unassigned copies available</small>':'')}</span></div>`;}).join(''):'<p class="muted">No matching cards in your collection.</p>';
}
function sameCard(a,b){return a.oracleId&&b.oracleId?a.oracleId===b.oracleId:String(a.name||'').toLowerCase()===String(b.name||'').toLowerCase();}
function renderDeckCardQuantity(recordId){
 const selected=records(events).find(r=>r.id===recordId&&r.value&&!r.conflict),deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!selected||!deck){if($('deck-card-dialog').open)$('deck-card-dialog').close();return;}const value=selected.value,items=records(events).filter(r=>r.value&&r.value.kind!=='deck'&&!r.conflict&&sameCard(r.value,value)).sort((a,b)=>a.id===recordId?-1:b.id===recordId?1:String(a.value.setName||'').localeCompare(b.value.setName||'')),total=items.reduce((n,r)=>n+(r.value.deckCounts?.[deck.id]||0),0);$('deck-card-dialog-title').textContent=value.name;$('deck-card-quantity-content').innerHTML=`<p class="deck-card-quantity-intro">${total} ${total===1?'copy':'copies'} of ${esc(value.name)} in this deck. Add an unassigned copy from any printing, or move one from another deck.</p><div class="deck-version-list">${items.map(r=>{const v=r.value,count=v.deckCounts?.[deck.id]||0,assigned=Object.values(v.deckCounts||{}).reduce((n,c)=>n+c,0),free=v.notOwned?0:Math.max(0,(Number(v.quantity)||0)-assigned),sources=records(events).filter(d=>d.value?.kind==='deck'&&!d.conflict&&d.id!==deck.id&&(v.deckCounts?.[d.id]||0)>0),version=v.setName?`${v.setName}${v.set?' · '+v.set.toUpperCase():''}${v.number?' · #'+v.number:''}`:'Manual entry';return `<article class="deck-version-row"><div><strong>${esc(version)}</strong><small>${v.notOwned?'<span class="not-owned-tag">Not Owned</span>':`Owned ${v.quantity} · Unassigned ${free}`}</small></div><div class="deck-version-quantity"><button type="button" class="button subtle" data-card-quantity-remove="${esc(r.id)}" aria-label="Remove one ${esc(v.name)} copy from this deck" ${count?'':'disabled'}>−</button><strong>${count}</strong><button type="button" class="button primary" data-card-quantity-add="${esc(r.id)}" aria-label="Add one ${esc(v.name)} copy to this deck" ${free?'':'disabled'}>＋</button></div>${sources.length?`<div class="deck-version-moves">${sources.map(d=>`<button type="button" class="text-button" data-card-quantity-move="${esc(r.id)}" data-from-deck="${esc(d.id)}">Move one from ${esc(d.value.name)}</button>`).join('')}</div>`:''}</article>`;}).join('')}</div>`;if(!$('deck-card-dialog').open)$('deck-card-dialog').showModal();
}
async function changeDeckQuantity(recordId,direction){
 const card=records(events).find(r=>r.id===recordId&&r.value&&!r.conflict),deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!card||!deck)return;const value={...card.value,deckCounts:{...(card.value.deckCounts||{})}},count=value.deckCounts[deck.id]||0;if(direction<0){if(!count)return;try{if(value.notOwned&&value.quantity<=1){await commit([{id:crypto.randomUUID(),recordId:card.id,parents:card.heads.map(h=>h.id),at:new Date().toISOString(),value:null}]);}else{if(value.notOwned)value.quantity--;value.deckCounts[deck.id]=count-1;if(!value.deckCounts[deck.id])delete value.deckCounts[deck.id];await commit([{id:crypto.randomUUID(),recordId:card.id,parents:card.heads.map(h=>h.id),at:new Date().toISOString(),value}]);}toast(`${card.value.name} quantity updated.`);}catch(err){report(err);}}
 renderDeckCardQuantity(recordId);
}
async function searchCommanderOnline(){
 const all=records(events),deck=all.find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!deck)return;
 const leaders=(deck.value.commanders||[]).map(id=>all.find(r=>r.id===id&&r.value)).filter(Boolean);if(!leaders.length)return;
 const names=leaders.map(r=>r.value.name).join(' & '),query=`${names} EDH commander deck build guide`;
 $('commander-guide-title').textContent=names;
 $('commander-guide-google').href=`https://www.google.com/search?q=${encodeURIComponent(query)}`;
 $('commander-guide-status').textContent=geminiApiKey?'Generating Google AI deckbuilding guide…':'Fetching online commander guide…';
 $('commander-guide-body').innerHTML='';$('apply-commander-guide').hidden=true;lastOnlineGuide='';
 show('commander-guide-dialog');
 if(geminiApiKey){
  try{
   const prompt=`Give a concise Magic: The Gathering Commander (EDH) deckbuilding and playstyle guide for ${names}. Cover: 1) Core strategy and win conditions, 2) Key card synergies and packages to include, 3) Ramp/draw/interaction priorities.`;
   const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],tools:[{google_search:{}}]})});
   const data=await r.json();if(!r.ok)throw Error(data.error?.message||'Google AI request failed.');
   const text=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
   if(!text)throw Error('Google AI returned an empty response.');
   lastOnlineGuide=text;
   $('commander-guide-status').textContent='Google AI generated guide (with Google Search grounding):';
   $('commander-guide-body').innerHTML=`<p class="commander-guide-text">${esc(text)}</p>`;
   $('apply-commander-guide').hidden=false;
   return;
  }catch(e){$('commander-guide-status').textContent=`Google AI unavailable (${e.message}). Checking EDHREC…`;}
 }
 try{
  const primary=leaders[0].value.name;
  const r=await fetch(`./api/commander-guide?name=${encodeURIComponent(primary)}`);
  if(!r.ok)throw Error('Online commander data unavailable.');
  const data=await r.json(),lists=data?.container?.json_dict?.cardlists||[],tags=(data?.panels?.taglinks||[]).slice(0,5).map(t=>t.value).filter(Boolean);
  const sections=lists.slice(0,3).map(l=>({header:l.header,cards:(l.cardviews||[]).slice(0,8).map(c=>c.name).filter(Boolean)})).filter(s=>s.cards.length);
  const summaryLines=[tags.length?`Popular themes: ${tags.join(', ')}.`:'',...sections.map(s=>`${s.header}: ${s.cards.join(', ')}.`)].filter(Boolean);
  if(!summaryLines.length)throw Error('No commander suggestions returned.');
  lastOnlineGuide=summaryLines.join('\n');
  $('commander-guide-status').textContent=geminiApiKey?'Showing EDHREC commander data:':'Showing EDHREC commander data (add a Gemini API key in Settings for Google AI responses):';
  $('commander-guide-body').innerHTML=`${tags.length?`<p><strong>Popular themes:</strong> ${esc(tags.join(', '))}</p>`:''}${sections.map(s=>`<div class="commander-guide-section"><h3>${esc(s.header)}</h3><p>${esc(s.cards.join(' · '))}</p></div>`).join('')}`;
  $('apply-commander-guide').hidden=false;
 }catch{
  $('commander-guide-status').textContent='Could not load online suggestions automatically. Add a Gemini API key in Settings for Google AI guides, or open Google Search below.';
 }
}
$('apply-commander-guide').onclick=async()=>{
 const deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!deck||!lastOnlineGuide)return;
 try{await commit([{id:crypto.randomUUID(),recordId:deck.id,parents:deck.heads.map(h=>h.id),at:new Date().toISOString(),kind:'deck',value:{...deck.value,playstyle:lastOnlineGuide.slice(0,4000)}}]);$('commander-guide-dialog').close();toast('Online guide applied to deck.');}catch(err){report(err);}
};
async function hydrateCards(cards){
 const missing=cards.filter(r=>r.value.scryfallId&&(!Array.isArray(r.value.colorIdentity)||!r.value.legalities||typeof r.value.commanderEligible!=='boolean'||typeof r.value.backgroundEligible!=='boolean'||typeof r.value.anyNumber!=='boolean'||typeof r.value.basicLand!=='boolean'||typeof r.value.backImage!=='string')&&!hydrationTried.has(r.id));if(!missing.length||hydrationRunning)return;
 hydrationRunning=true;missing.slice(0,75).forEach(r=>hydrationTried.add(r.id));
 try{const response=await fetch('https://api.scryfall.com/cards/collection',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({identifiers:missing.slice(0,75).map(r=>({id:r.value.scryfallId}))})});if(!response.ok)throw Error('Card rules data could not be refreshed.');const data=await response.json();const byId=new Map((data.data||[]).map(c=>[c.id,c]));const changes=[];
  for(const r of missing.slice(0,75)){const c=byId.get(r.value.scryfallId);if(!c)continue;const full=cardFromScryfall(c);changes.push({id:crypto.randomUUID(),recordId:r.id,parents:r.heads.map(h=>h.id),at:new Date().toISOString(),value:{...r.value,artImage:full.artImage,backImage:full.backImage,colorIdentity:full.colorIdentity,legalities:full.legalities,keywords:full.keywords,commanderEligible:full.commanderEligible,backgroundEligible:full.backgroundEligible,basicLand:full.basicLand,anyNumber:full.anyNumber}});}
  if(changes.length)await commit(changes);
 }catch(e){console.info('Commander card data could not be refreshed',e);}finally{hydrationRunning=false;}
}
function newManual(){return {name:$('lookup').value.trim(),quantity:1,finish:'nonfoil',condition:'Near mint',language:'en',location:'Collection',notes:'',validated:false};}
function edit(value,id=null,currentHeads=[],carry=null){
 editing=id;heads=currentHeads;draft={...value,...carry};assignmentDraft={...(draft.deckCounts||{})};
 $('edit-title').textContent=id?'Edit card':'Add to collection';$('edit-eyebrow').textContent=draft.validated?'SCRYFALL VERIFIED PRINTING':'AWAITING VALIDATION';
 for(const [field,key] of [['card-name','name'],['quantity','quantity'],['finish','finish'],['condition','condition'],['language','language'],['location','location'],['notes','notes']])$(field).value=draft[key]??'';
 $('card-name').readOnly=!!draft.validated;
 $('printing-info').textContent=draft.validated?`${draft.setName} · ${draft.set.toUpperCase()} #${draft.number}`:'Manual entry · validate with Scryfall when online';
 const img=imageUrl(draft.image);$('card-preview').innerHTML=(img?`<div class="card-preview-art"><img src="${esc(img)}" alt="${esc(draft.name)}">${flipButton(draft)}</div>`:placeholder('Awaiting lookup'))+(draft.text?`<p>${esc(draft.type)}\n\n${esc(draft.text)}</p>`:'');
 $('delete-card').hidden=!id;$('validate-card').hidden=!!draft.validated;
 renderDeckAssignments(draft);
 if(!$('edit-dialog').open)show('edit-dialog');
}
function formValue(){const deckCounts=Object.fromEntries(Object.entries(assignmentDraft).filter(([,n])=>Number(n)>0).map(([id,n])=>[id,Number(n)]));return {...draft,name:$('card-name').value.trim(),quantity:Number($('quantity').value),finish:$('finish').value,condition:$('condition').value,language:$('language').value.trim(),location:$('location').value.trim(),notes:$('notes').value.trim(),deckCounts};}
let lookupContext=null;
function openLookup(context=null){lookupContext=context;$('lookup').value=context?.value?.name||'';$('lookup-suggestions').innerHTML='';$('lookup-suggestions').hidden=true;$('lookup-status').textContent='';$('search-results').innerHTML='';$('more-results').hidden=true;show('add-dialog');$('lookup').focus();}
function filterCatalogMatches(q){
 const lowerQ=q.trim().toLowerCase();
 if(!cardCatalog.length||lowerQ.length<2||/^[a-z0-9]{2,8}\s+\d+[a-z★]*$/i.test(lowerQ))return [];
 const prefix=[],contains=[];
 for(const name of cardCatalog){const lower=name.toLowerCase();if(lower.startsWith(lowerQ))prefix.push(name);else if(lower.includes(lowerQ)&&contains.length<8)contains.push(name);if(prefix.length>=8)break;}
 return [...prefix,...contains].slice(0,8);
}
function renderLookupSuggestions(){
 const box=$('lookup-suggestions'),hits=filterCatalogMatches($('lookup').value);
 if(!hits.length){box.hidden=true;box.innerHTML='';return;}
 box.innerHTML=hits.map(name=>`<button type="button" class="lookup-suggestion" role="option" data-suggest="${esc(name)}">${esc(name)}</button>`).join('');
 box.hidden=false;
}
function openCardLookup(){
 lookedUpCard=null;
 $('card-lookup-input').value='';
 $('card-lookup-suggestions').innerHTML='';$('card-lookup-suggestions').hidden=true;
 $('card-lookup-status').textContent='';
 $('card-lookup-result').innerHTML='';$('card-lookup-result').hidden=true;
 show('card-lookup-dialog');$('card-lookup-input').focus();
}
async function runCardLookup(nameOverride=null){
 const q=(nameOverride??$('card-lookup-input').value).trim();if(!q)return;
 $('card-lookup-suggestions').hidden=true;
 $('card-lookup-status').textContent='Looking up original printing on Scryfall…';
 $('card-lookup-result').hidden=true;$('card-lookup-submit').disabled=true;
 try{
  const query=`game:paper ${nameOverride?`!"${q.replace(/["\\]/g,'')}"`:`name:"${q.replace(/["\\]/g,'')}"`}`;
  const r=await fetch(`https://api.scryfall.com/cards/search?${new URLSearchParams({q:query,unique:'prints',order:'released',dir:'asc'})}`,{headers:{Accept:'application/json'}});
  const data=await r.json();if(!r.ok||!data.data?.length)throw Error(r.status===404?'Card not found on Scryfall.':data.details||'Card lookup failed.');
  const raw=data.data[0],card=cardFromScryfall(raw);
  lookedUpCard={raw,card};
  let rulings=[];
  if(raw.rulings_uri?.startsWith('https://api.scryfall.com/')){
   try{const rr=await fetch(raw.rulings_uri,{headers:{Accept:'application/json'}});if(rr.ok){const rd=await rr.json();rulings=rd.data||[];}}catch{}
  }
  const ownedCount=records(events).filter(row=>row.value&&row.value.kind!=='deck'&&!row.conflict&&!row.value.notOwned&&sameCard(row.value,card)).reduce((sum,row)=>sum+(Number(row.value.quantity)||0),0);
  const img=imageUrl(card.image),formats=['standard','pioneer','modern','legacy','vintage','commander','pauper','brawl','historic','alchemy'];
  const legalitiesHtml=formats.map(f=>{const status=card.legalities?.[f]||'not_legal',label=status==='legal'?'Legal':status==='banned'?'Banned':status==='restricted'?'Restricted':'Not legal';return `<div class="legality-pill legality-${esc(status)}"><span>${esc(f)}</span><strong>${esc(label)}</strong></div>`;}).join('');
  const rulingsHtml=rulings.length?`<ul class="card-rulings-list">${rulings.map(ru=>`<li><time>${esc(ru.published_at)}</time><p>${esc(ru.comment)}</p></li>`).join('')}</ul>`:'<p class="muted">No official rulings on Scryfall.</p>';
  $('card-lookup-status').textContent=`Original printing: ${card.setName} (${card.set.toUpperCase()} #${card.number})`;
  $('card-lookup-result').innerHTML=`<div class="card-lookup-hero"><div class="card-lookup-art">${img?`<img src="${esc(img)}" alt="${esc(card.name)}">`:placeholder(card.name)}${flipButton(card)}</div><div class="card-lookup-summary"><h3>${esc(card.name)}</h3><p class="card-lookup-owned">${ownedCount?`In your collection: <strong>× ${ownedCount}</strong> (across all printings)`:'Not in your collection yet'}</p><div class="button-row"><button type="button" class="button primary" id="lookup-add-collection">Add to Collection</button><button type="button" class="button subtle" id="lookup-add-shopping">Add to Shopping list</button></div>${card.text?`<p class="card-lookup-oracle">${esc(card.type)}\n\n${esc(card.text)}</p>`:''}</div></div><section class="card-lookup-section"><h4>Format legality</h4><div class="legality-grid">${legalitiesHtml}</div></section><section class="card-lookup-section"><h4>Rulings</h4>${rulingsHtml}</section>`;
  $('card-lookup-result').hidden=false;
 }catch(e){$('card-lookup-status').textContent=navigator.onLine?e.message:'You are offline. Card lookup requires an internet connection.';}finally{$('card-lookup-submit').disabled=false;}
}
async function preloadCardCatalog(){
 const url='https://api.scryfall.com/catalog/card-names';
 try{
  if('caches'in globalThis){const cache=await caches.open('manahorde-catalog-v1'),cached=await cache.match(url);if(cached){const data=await cached.json();if(Array.isArray(data?.data))cardCatalog=data.data;}}
  if(!cardCatalog.length&&navigator.onLine){const r=await fetch(url,{headers:{Accept:'application/json'}});if(r.ok){if('caches'in globalThis){const cache=await caches.open('manahorde-catalog-v1');await cache.put(url,r.clone());}const data=await r.json();if(Array.isArray(data?.data))cardCatalog=data.data;}}
 }catch{}
}
function renderSearch(){
 $('search-results').innerHTML=results.map((c,i)=>{const v=cardFromScryfall(c),img=imageUrl(v.image);return `<button type="button" class="search-result" data-choice="${i}"><div class="search-result-art">${img?`<img src="${esc(img)}" alt="${esc(v.name)}" loading="lazy">`:placeholder(v.name)}${flipButton(v)}</div><div>${esc(v.name)}<small>${esc(v.setName)} · #${esc(v.number)} · ${esc(v.language)}</small></div></button>`;}).join('');$('more-results').hidden=!nextPage;
}
async function searchCards(url=null){
 if(searchBusy)return;searchBusy=true;$('search-button').disabled=true;$('more-results').disabled=true;$('lookup-status').textContent='Looking up cards on Scryfall…';
 try{
  if(!url){results=[];nextPage=null;const q=$('lookup').value.trim();if(!q)throw Error('Enter a card name.');const numbered=q.match(/^([a-zA-Z0-9]{2,8})\s+(\d+[a-zA-Z★]*)$/);url=numbered?`https://api.scryfall.com/cards/${encodeURIComponent(numbered[1].toLowerCase())}/${encodeURIComponent(numbered[2])}`:`https://api.scryfall.com/cards/search?${new URLSearchParams({q:`game:paper name:"${q.replace(/["\\]/g,'')}"`,unique:lookupContext?.deckId?'cards':'prints',order:'released',dir:'desc'})}`;}
  const r=await fetch(url,{headers:{Accept:'application/json'}});const data=await r.json();if(!r.ok)throw Error(r.status===404?'No cards found. Try a shorter name, or a set code and collector number.':r.status===429?'Scryfall is busy. Wait a moment and search again.':data.details||'Card lookup failed.');
  results.push(...(data.object==='card'?[data]:data.data));nextPage=data.has_more&&data.next_page?.startsWith('https://api.scryfall.com/')?data.next_page:null;renderSearch();$('lookup-status').textContent=`${results.length}${nextPage?'+':''} printings found. Select the one you own.`;
 }catch(e){$('lookup-status').textContent=navigator.onLine?e.message:'You are offline. Enter the card manually and validate it later.';}finally{searchBusy=false;$('search-button').disabled=false;$('more-results').disabled=false;}
}
document.addEventListener('click',e=>{
 const flip=e.target.closest('.flip-card-btn');
 if(!flip)return;
 e.preventDefault();e.stopPropagation();
 const img=flip.parentElement?.querySelector('img');if(!img)return;
 const showBack=flip.dataset.flipped!=='1';
 flip.dataset.flipped=showBack?'1':'0';
 flip.classList.toggle('is-flipped',showBack);
 img.src=showBack?flip.dataset.flipBack:flip.dataset.flipFront;
},true);
document.querySelectorAll('.close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
for(const id of ['add-button','first-card','add-nav'])$(id).onclick=()=>openLookup();
$('mobile-bottom-nav').onclick=e=>{const b=e.target.closest('[data-mobile-nav]');if(b)$(b.dataset.mobileNav)?.click();};
$('home-nav').onclick=()=>{currentPage='home';selectedDeck='';$('decks-submenu').hidden=true;$('decks-nav').setAttribute('aria-expanded','false');render();window.scrollTo({top:0,behavior:'smooth'});};$('home-open-collection').onclick=()=>$('collection-nav').click();$('home-lookup-card').onclick=openCardLookup;
$('card-lookup-input').oninput=()=>{const box=$('card-lookup-suggestions'),hits=filterCatalogMatches($('card-lookup-input').value);if(!hits.length){box.hidden=true;box.innerHTML='';return;}box.innerHTML=hits.map(name=>`<button type="button" class="lookup-suggestion" role="option" data-lookup-suggest="${esc(name)}">${esc(name)}</button>`).join('');box.hidden=false;};
$('card-lookup-suggestions').onclick=e=>{const b=e.target.closest('[data-lookup-suggest]');if(!b)return;$('card-lookup-input').value=b.dataset.lookupSuggest;runCardLookup(b.dataset.lookupSuggest);};
$('card-lookup-form').onsubmit=e=>{e.preventDefault();runCardLookup();};
$('card-lookup-result').onclick=async e=>{
 if(!lookedUpCard)return;
 if(e.target.closest('#lookup-add-collection')){const {card,raw}=lookedUpCard;$('card-lookup-dialog').close();edit(card);const options=$('finish').options;for(const o of options)o.disabled=!raw.finishes.includes(o.value);return;}
 if(e.target.closest('#lookup-add-shopping')){const {card}=lookedUpCard;try{await commit([{id:crypto.randomUUID(),recordId:crypto.randomUUID(),parents:[],at:new Date().toISOString(),value:{...card,quantity:1,notOwned:true,location:'Not owned',deckCounts:{}}}]);$('card-lookup-dialog').close();toast(`${card.name} added to Shopping list as Not Owned.`);}catch(err){report(err);}}
};
$('open-information').onclick=()=>{currentPage='information';selectedDeck='';render();window.scrollTo({top:0,behavior:'smooth'});};$('information-home').onclick=()=>$('home-nav').click();
$('shopping-nav').onclick=()=>{currentPage='shopping';selectedDeck='';render();window.scrollTo({top:0,behavior:'smooth'});};$('export-shopping').onclick=exportShoppingList;
$('shopping-cards').onclick=e=>{const b=e.target.closest('[data-shopping-deck]');if(!b)return;selectedDeck=b.dataset.shoppingDeck;currentPage='deck';deckSearch='';deckSearchOpen=false;render();window.scrollTo({top:0,behavior:'smooth'});};
$('collection-deck-ctas').onclick=e=>{const b=e.target.closest('[data-collection-deck]');if(!b)return;selectedDeck=b.dataset.collectionDeck;currentPage='deck';deckSearch='';deckSearchOpen=false;render();window.scrollTo({top:0,behavior:'smooth'});};
$('collection-nav').onclick=()=>{currentPage='collection';selectedDeck='';$('filter').value='';$('deck-filter').value='';$('finish-filter').value='';$('owned-supertype').value='';$('owned-type').value='';$('owned-subtype').value='';$('owned-legal').checked=false;document.querySelectorAll('input[name="owned-identity"]').forEach(x=>x.checked=false);$('collection-filter-panel').hidden=true;$('decks-submenu').hidden=true;$('decks-nav').setAttribute('aria-expanded','false');render();window.scrollTo({top:0,behavior:'smooth'});};
for(const id of ['filter','finish-filter','sort'])$(id).addEventListener('input',render);
$('deck-filter').onchange=render;$('ungroup-cards').onchange=render;$('deck-filter-legal').onchange=render;$('deck-filter-favourite').onchange=render;$('toggle-deck-ctas').onclick=()=>{localStorage.setItem(deckCtasKey(),String(isDeckCtasVisible()));render();};$('collection-filters').onclick=()=>$('collection-filter-panel').hidden=!$('collection-filter-panel').hidden;
for(const el of [$('owned-supertype'),$('owned-type'),$('owned-subtype'),$('owned-legal'),...document.querySelectorAll('input[name="owned-identity"]')])el.addEventListener('input',render);
$('clear-owned-filters').onclick=()=>{$('owned-supertype').value='';$('owned-type').value='';$('owned-subtype').value='';$('owned-legal').checked=false;document.querySelectorAll('input[name="owned-identity"]').forEach(x=>x.checked=false);render();};
$('decks-nav').onclick=()=>{if(matchMedia('(pointer: coarse)').matches||innerWidth<=900){currentPage='decks';selectedDeck='';$('decks-submenu').hidden=true;$('decks-nav').setAttribute('aria-expanded','false');render();window.scrollTo({top:0,behavior:'smooth'});return;}const open=$('decks-submenu').hidden;$('decks-submenu').hidden=!open;$('decks-nav').setAttribute('aria-expanded',String(open));};
$('decks-page-list').onclick=e=>{const b=e.target.closest('[data-deck-open]');if(!b)return;selectedDeck=b.dataset.deckOpen;currentPage='deck';deckSearch='';deckSearchOpen=false;render();window.scrollTo({top:0,behavior:'smooth'});};
$('decks-page-new').onclick=()=>{$('create-deck-form').hidden=false;show('decks-dialog');$('new-deck-name').focus();};
$('decks-submenu').onclick=e=>{const create=e.target.closest('[data-sidebar-new]'),open=e.target.closest('[data-sidebar-deck]');if(create){currentPage='home';selectedDeck='';deckSearch='';deckSearchOpen=false;$('create-deck-form').hidden=false;render();show('decks-dialog');$('new-deck-name').focus();}else if(open){currentPage='deck';selectedDeck=open.dataset.sidebarDeck;deckSearch='';deckSearchOpen=false;render();window.scrollTo({top:0,behavior:'smooth'});}};
$('new-deck-toggle').onclick=()=>{$('create-deck-form').hidden=!$('create-deck-form').hidden;if(!$('create-deck-form').hidden)$('new-deck-name').focus();};
$('create-deck-form').onsubmit=async e=>{e.preventDefault();const name=$('new-deck-name').value.trim();if(!name)return;const id=crypto.randomUUID();try{await commit([{id:crypto.randomUUID(),recordId:id,parents:[],at:new Date().toISOString(),kind:'deck',value:{kind:'deck',name,commanders:[]}}]);selectedDeck=id;currentPage='deck';deckSearch='';deckSearchOpen=false;$('new-deck-name').value='';$('create-deck-form').hidden=true;$('decks-dialog').close();render();}catch(err){report(err);}};
$('deck-list').onclick=e=>{const b=e.target.closest('[data-deck-open]');if(!b)return;selectedDeck=b.dataset.deckOpen;currentPage='deck';deckSearch='';deckSearchOpen=false;$('decks-dialog').close();render();};
$('deck-page-content').oninput=e=>{if(e.target.matches('#deck-bracket-range')){$('deck-bracket-value').value=e.target.value;$('deck-bracket-value').textContent=e.target.value;$('deck-bracket-shape').className=`bracket-shape bracket-shape-${e.target.value}`;$('deck-bracket-shape').setAttribute('aria-label',`EDH Bracket ${e.target.value}`);return;}if(e.target.matches('[data-owned-search]')){deckSearch=e.target.value;const deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(deck)renderDeckPicker(deck,records(events).filter(r=>r.value&&r.value.kind!=='deck'&&!r.conflict));}};
$('deck-page-content').onchange=async e=>{
  const deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!deck)return;
  if(e.target.matches('#deck-simple-view')){deckSimpleView=e.target.checked;render();return;}
  if(e.target.matches('#deck-sort')){deckSort=e.target.value;render();return;}
  if(e.target.matches('#deck-playstyle')){const playstyle=e.target.value;try{await commit([{id:crypto.randomUUID(),recordId:deck.id,parents:deck.heads.map(h=>h.id),at:new Date().toISOString(),kind:'deck',value:{...deck.value,playstyle}}]);toast('Deck guide saved.');}catch(err){report(err);}return;}
  if(e.target.matches('#deck-bracket-range')){const bracket=Number(e.target.value);try{await commit([{id:crypto.randomUUID(),recordId:deck.id,parents:deck.heads.map(h=>h.id),at:new Date().toISOString(),kind:'deck',value:{...deck.value,bracket}}]);}catch(err){report(err);}}
  if(e.target.matches('#deck-favourite')){const favourite=e.target.checked;try{await commit([{id:crypto.randomUUID(),recordId:deck.id,parents:deck.heads.map(h=>h.id),at:new Date().toISOString(),kind:'deck',value:{...deck.value,favourite}}]);}catch(err){report(err);}}
};
let stackRevealTimer;
$('deck-page-content').onclick=async e=>{
 const stackCard=e.target.closest('[data-stack-card]');if(stackCard){
  clearTimeout(stackRevealTimer);
  const root=$('deck-page-content'),prev=root.querySelector('.deck-stack-card.is-revealed'),hadShifted=!!root.querySelector('.deck-stack-card.is-shifted');
  root.querySelectorAll('.deck-stack-card.is-revealed,.deck-stack-card.is-shifted').forEach(el=>el.classList.remove('is-revealed','is-shifted'));
  root.querySelectorAll('.deck-stack.has-revealed').forEach(el=>el.classList.remove('has-revealed'));
  if(prev===stackCard)return;
  const reveal=()=>{
   const stack=stackCard.closest('.deck-stack'),cards=[...stack.querySelectorAll('.deck-stack-card')],idx=cards.indexOf(stackCard);
   stackCard.classList.add('is-revealed');
   if(idx<cards.length-1){stack.classList.add('has-revealed');for(let i=idx+1;i<cards.length;i++)cards[i].classList.add('is-shifted');}
  };
  if(hadShifted)stackRevealTimer=setTimeout(reveal,280);else reveal();
  return;
 }
 if(e.target.closest('#deck-back')){$('collection-nav').click();return;}
 if(e.target.closest('#rename-deck')){const deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!deck)return;const name=window.prompt('Deck name',deck.value.name)?.trim().slice(0,100);if(!name||name===deck.value.name)return;try{await commit([{id:crypto.randomUUID(),recordId:deck.id,parents:deck.heads.map(h=>h.id),at:new Date().toISOString(),kind:'deck',value:{...deck.value,name}}]);toast('Deck renamed.');}catch(err){report(err);}return;}
 if(e.target.closest('#reset-playstyle')){const deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(deck){const next={...deck.value};delete next.playstyle;try{await commit([{id:crypto.randomUUID(),recordId:deck.id,parents:deck.heads.map(h=>h.id),at:new Date().toISOString(),kind:'deck',value:next}]);toast('Restored suggested deck guide.');}catch(err){report(err);}}return;}
 if(e.target.closest('#search-commander-online')){await searchCommanderOnline();return;}
 if(e.target.closest('#deck-collection-toggle')){deckSearchOpen=!deckSearchOpen;const panel=$('deck-page-content').querySelector('.deck-search-panel'),toggle=$('deck-collection-toggle');if(panel)panel.hidden=!deckSearchOpen;if(toggle)toggle.setAttribute('aria-expanded',String(deckSearchOpen));if(deckSearchOpen)$('deck-page-content').querySelector('[data-owned-search]')?.focus();return;}
 if(e.target.closest('#optimized-basic-lands')){await addOptimizedBasicLands();return;}
 if(e.target.closest('#add-unowned-card')){openLookup({notOwnedDeckId:selectedDeck});return;}
 const remove=e.target.closest('[data-remove-from-deck]');if(remove){await removeFromDeck(remove.dataset.removeFromDeck);return;}
 const commander=e.target.closest('[data-deck-commander]');if(commander){const fresh=records(events),deck=fresh.find(r=>r.id===selectedDeck&&r.value?.kind==='deck'),candidate=fresh.find(r=>r.id===commander.dataset.deckCommander&&r.value);if(deck&&candidate){const current=deck.value.commanders||[],previous=current.length===1?fresh.find(r=>r.id===current[0]&&r.value):null,next=previous&&previous.id!==candidate.id&&validCommanderPair(previous.value,candidate.value)?[previous.id,candidate.id]:[candidate.id],cardEl=commander.closest('.deck-display-card');if(cardEl)pendingCommanderAnim={id:candidate.id,from:cardEl.getBoundingClientRect()};try{await commit([{id:crypto.randomUUID(),recordId:deck.id,parents:deck.heads.map(h=>h.id),at:new Date().toISOString(),kind:'deck',value:{...deck.value,commanders:next}}]);}catch(err){pendingCommanderAnim=null;report(err);}}return;}
 const add=e.target.closest('[data-add-copy]'),move=e.target.closest('[data-move-copy]');if(add||move){const qty=add?Number(add.closest('.deck-owned-actions').querySelector(`[data-copy-quantity="${CSS.escape(add.dataset.addCopy)}"]`)?.value)||1:1;await addOwnedCopy((add||move).dataset.addCopy||(add||move).dataset.moveCopy,move?.dataset.fromDeck,qty);return;}
 const manage=e.target.closest('[data-manage-deck-card]');if(manage){renderDeckCardQuantity(manage.dataset.manageDeckCard);return;}
};
$('deck-page-content').onkeydown=e=>{if(e.target.matches('[data-manage-deck-card]')&&['Enter',' '].includes(e.key)){e.preventDefault();renderDeckCardQuantity(e.target.dataset.manageDeckCard);}};
$('deck-card-dialog').onclick=async e=>{const remove=e.target.closest('[data-card-quantity-remove]'),add=e.target.closest('[data-card-quantity-add]'),move=e.target.closest('[data-card-quantity-move]');if(remove){await changeDeckQuantity(remove.dataset.cardQuantityRemove,-1);return;}if(add){const id=add.dataset.cardQuantityAdd;await addOwnedCopy(id);renderDeckCardQuantity(id);return;}if(move){const id=move.dataset.cardQuantityMove;await addOwnedCopy(id,move.dataset.fromDeck);renderDeckCardQuantity(id);}};
async function addOwnedCopy(recordId,fromDeckId,requestedQuantity=1){
 const card=records(events).find(r=>r.id===recordId&&r.value&&!r.conflict),deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!card||!deck)return;
 const value={...card.value,deckCounts:{...(card.value.deckCounts||{})}},assigned=Object.values(value.deckCounts).reduce((a,n)=>a+n,0),free=value.quantity-assigned+(fromDeckId?1:0);
 if(fromDeckId){const source=records(events).find(r=>r.id===fromDeckId&&r.value?.kind==='deck');if(!source||!(value.deckCounts[fromDeckId]>0))return;if(!await confirmAction(`${card.value.name} is currently assigned to ${source.value.name}. Adding one copy to ${deck.value.name} will remove one copy from ${source.value.name}. Continue?`))return;value.deckCounts[fromDeckId]--;if(!value.deckCounts[fromDeckId])delete value.deckCounts[fromDeckId];}
 else if(free<1){toast('No unassigned copies are available. Choose a deck to move one copy from.');return;}
 const copies=fromDeckId?1:Math.max(1,Math.floor(Number(requestedQuantity)||1));if(copies>free){toast(`Only ${free} unassigned ${free===1?'copy is':'copies are'} available.`);return;}if(copies>1&&!allowsMultipleCopies(value)){toast('Only basic lands and cards with “A deck can have any number” may add multiple copies at once.');return;}
 value.deckCounts[deck.id]=(value.deckCounts[deck.id]||0)+copies;
  try{await commit([{id:crypto.randomUUID(),recordId:card.id,parents:card.heads.map(h=>h.id),at:new Date().toISOString(),value}]);await offerCommander(deck.id,card.id,card.value);toast(`${card.value.name} added to ${deck.value.name}.`);}catch(err){report(err);}
}
async function offerCommander(deckId,cardId,cardValue){const deck=records(events).find(r=>r.id===deckId&&r.value?.kind==='deck');if(!deck||(deck.value.commanders||[]).length||!cardValue.commanderEligible||cardValue.legalities?.commander!=='legal')return;if(!await confirmAction(`Add ${cardValue.name} as the commander for ${deck.value.name}?`))return;await commit([{id:crypto.randomUUID(),recordId:deck.id,parents:deck.heads.map(h=>h.id),at:new Date().toISOString(),kind:'deck',value:{...deck.value,commanders:[cardId]}}]);}
async function addScryfallCardToDeck(value,deckId){
 const deck=records(events).find(r=>r.id===deckId&&r.value?.kind==='deck');if(!deck)return;const cards=records(events).filter(r=>r.value&&r.value.kind!=='deck'&&!r.conflict),named=cards.filter(r=>r.value.name.toLowerCase()===value.name.toLowerCase()),rank=r=>r.value.scryfallId===value.scryfallId?0:r.value.oracleId&&r.value.oracleId===value.oracleId?1:2,owned=named.filter(r=>!r.value.notOwned).sort((a,b)=>rank(a)-rank(b)),available=owned.find(r=>r.value.quantity-Object.values(r.value.deckCounts||{}).reduce((n,c)=>n+c,0)>0);
 if(available){await addOwnedCopy(available.id);return;}
 if(owned.length){const current=owned.find(r=>(r.value.deckCounts?.[deck.id]||0)>0);if(current){toast(`${value.name} is already in ${deck.value.name}.`);return;}const source=owned.find(r=>Object.values(r.value.deckCounts||{}).some(n=>n>0));if(source){const from=records(events).find(d=>d.value?.kind==='deck'&&!d.conflict&&(source.value.deckCounts?.[d.id]||0)>0);if(from){await addOwnedCopy(source.id,from.id);return;}}}
 const missing=named.filter(r=>r.value.notOwned).sort((a,b)=>rank(a)-rank(b)),shopping=missing.find(r=>Object.values(r.value.deckCounts||{}).reduce((n,c)=>n+c,0)===0)||missing[0];if(shopping){if((shopping.value.deckCounts?.[deck.id]||0)>0){toast(`${value.name} is already in ${deck.value.name} as Not Owned.`);return;}const from=records(events).find(d=>d.value?.kind==='deck'&&!d.conflict&&(shopping.value.deckCounts?.[d.id]||0)>0);if(from&&!await confirmAction(`${value.name} is marked Not Owned in ${from.value.name}. Adding it to ${deck.value.name} will remove it from that deck. Continue?`))return;const next={...shopping.value,deckCounts:{...(shopping.value.deckCounts||{})}};if(from){next.deckCounts[from.id]--;if(!next.deckCounts[from.id])delete next.deckCounts[from.id];}next.deckCounts[deck.id]=1;try{await commit([{id:crypto.randomUUID(),recordId:shopping.id,parents:shopping.heads.map(h=>h.id),at:new Date().toISOString(),value:next}]);await offerCommander(deck.id,shopping.id,next);toast(`${value.name} moved to ${deck.value.name} as Not Owned.`);}catch(err){report(err);}return;}
 await addNotOwnedCard(value,deck.id);
}
async function addNotOwnedCard(cardValue,deckId){const deck=records(events).find(r=>r.id===deckId&&r.value?.kind==='deck');if(!deck)return;const value={...cardValue,quantity:1,notOwned:true,location:'Not owned',deckCounts:{[deck.id]:1}},recordId=crypto.randomUUID();try{await commit([{id:crypto.randomUUID(),recordId,parents:[],at:new Date().toISOString(),value}]);await offerCommander(deck.id,recordId,value);toast(`${value.name} added to ${deck.value.name} as Not Owned.`);}catch(err){report(err);}}
async function removeFromDeck(recordId){
 const card=records(events).find(r=>r.id===recordId&&r.value&&!r.conflict),deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!card||!deck)return;
 const value={...card.value,deckCounts:{...(card.value.deckCounts||{})}},count=value.deckCounts[deck.id]||0;if(!count)return;
 if(value.notOwned){await commit([{id:crypto.randomUUID(),recordId:card.id,parents:card.heads.map(h=>h.id),at:new Date().toISOString(),value:null}]);toast(`${card.value.name} removed from ${deck.value.name} and the shopping list.`);return;}
 value.deckCounts[deck.id]=count-1;if(!value.deckCounts[deck.id])delete value.deckCounts[deck.id];
 try{await commit([{id:crypto.randomUUID(),recordId:card.id,parents:card.heads.map(h=>h.id),at:new Date().toISOString(),value}]);toast(`${card.value.name} removed from ${deck.value.name}.`);}catch(err){report(err);}
}
async function addOptimizedBasicLands(){
 const deck=records(events).find(r=>r.id===selectedDeck&&r.value?.kind==='deck');if(!deck)return;const cards=records(events).filter(r=>r.value&&r.value.kind!=='deck'&&!r.conflict),members=cards.filter(r=>(r.value.deckCounts?.[deck.id]||0)>0),colorByName={Plains:'W',Island:'U',Swamp:'B',Mountain:'R',Forest:'G'},nameByColor={W:'Plains',U:'Island',B:'Swamp',R:'Mountain',G:'Forest'},weights={W:0,U:0,B:0,R:0,G:0};
 for(const row of members){const v=row.value;if(/\bland\b/i.test(v.type||''))continue;for(const match of String(v.mana||'').matchAll(/\{([^}]+)\}/g)){const colors=[...new Set(match[1].toUpperCase().split('/').flatMap(part=>part.match(/[WUBRG]/g)||[]))];if(colors.length)for(const color of colors)weights[color]+=1/colors.length;}}
 if(!Object.values(weights).some(n=>n>0)){const leaders=(deck.value.commanders||[]).map(id=>cards.find(r=>r.id===id)?.value).filter(Boolean),identity=[...new Set(leaders.flatMap(v=>v.colorIdentity||[]))];for(const color of identity)if(weights[color]!==undefined)weights[color]=1;}
 const nonlandCount=members.reduce((n,r)=>n+(!/\bland\b/i.test(r.value.type||'')?r.value.deckCounts[deck.id]:0),0),landCount=members.reduce((n,r)=>n+(/\bland\b/i.test(r.value.type||'')?r.value.deckCounts[deck.id]:0),0),target=Math.min(37,Math.max(0,100-nonlandCount)),needed=Math.max(0,target-landCount);if(!needed){toast('This deck already has its target number of lands.');return;}const total=Object.values(weights).reduce((a,b)=>a+b,0);if(!total){toast('Set a commander with a coloured identity or add coloured mana cards before optimising basic lands.');return;}
 const colors=Object.keys(weights).filter(c=>weights[c]>0),allocations=Object.fromEntries(colors.map(c=>[c,Math.floor(needed*weights[c]/total)])),remainders=colors.map(c=>[c,(needed*weights[c]/total)-allocations[c]]).sort((a,b)=>b[1]-a[1]);let left=needed-Object.values(allocations).reduce((a,b)=>a+b,0);for(let i=0;i<left;i++)allocations[remainders[i%remainders.length][0]]++;
 const changes=[],summary=[],unowned=[];for(const color of colors){let need=allocations[color];if(!need)continue;const name=nameByColor[color];for(const row of cards.filter(r=>r.value.name.toLowerCase()===name.toLowerCase()&&!r.value.notOwned)){const v={...row.value,deckCounts:{...(row.value.deckCounts||{})}},free=Math.max(0,(Number(v.quantity)||0)-Object.values(v.deckCounts).reduce((a,n)=>a+n,0)),add=Math.min(need,free);if(!add)continue;v.deckCounts[deck.id]=(v.deckCounts[deck.id]||0)+add;changes.push({id:crypto.randomUUID(),recordId:row.id,parents:row.heads.map(h=>h.id),at:new Date().toISOString(),value:v});need-=add;if(!need)break;}
  if(need)unowned.push({name,need});
 }
 if(unowned.length){
  const fetched=await Promise.all(unowned.map(async({name})=>{try{const r=await fetch(`https://api.scryfall.com/cards/search?${new URLSearchParams({q:`game:paper !"${name}"`,unique:'prints',order:'released',dir:'desc'})}`,{headers:{Accept:'application/json'}});if(!r.ok)return null;const data=await r.json();return data.data?.[0]||null;}catch{return null;}}));
  unowned.forEach(({name,need},i)=>{
   const printing=fetched[i]?cardFromScryfall(fetched[i]):{name,type:`Basic Land — ${name}`,mana:'',text:'',colorIdentity:[],legalities:{commander:'legal'},commanderEligible:false,backgroundEligible:false,basicLand:true,anyNumber:false,validated:false};
   changes.push({id:crypto.randomUUID(),recordId:crypto.randomUUID(),parents:[],at:new Date().toISOString(),value:{...printing,quantity:need,finish:'nonfoil',condition:'Near mint',language:'en',location:'Not owned',notes:'Added by optimised basic land tool',notOwned:true,deckCounts:{[deck.id]:need}}});
   summary.push(`${need} ${name}${need===1?'':'s'} marked Not Owned`);
  });
 }
 try{await commit(changes);toast(`Added ${needed} optimised basic lands${summary.length?`; ${summary.join(', ')}`:''}.`);}catch(err){report(err);}
}
$('lookup').oninput=renderLookupSuggestions;
$('lookup-suggestions').onclick=e=>{const b=e.target.closest('[data-suggest]');if(!b)return;$('lookup').value=b.dataset.suggest;$('lookup-suggestions').hidden=true;searchCards();};
$('lookup-form').onsubmit=e=>{e.preventDefault();$('lookup-suggestions').hidden=true;searchCards();};$('more-results').onclick=()=>searchCards(nextPage);
$('advanced-form').onsubmit=e=>{
 e.preventDefault();const clean=s=>s.trim().replace(/["\\]/g,'');const terms=[];
 for(const [id] of [['supertype'],['type-filter'],['subtype']])for(const value of $(id).value.split(',').map(clean).filter(Boolean))terms.push(`type:"${value}"`);
 const colors=[...document.querySelectorAll('input[name="identity"]:checked')].map(x=>x.value).join('');
 if($('identity-colorless').checked)terms.push('id:c');else if(colors)terms.push(`id<=${colors}`);
 if($('commander-legal').checked)terms.push('f:commander');
 if(!terms.length){$('lookup-status').textContent='Choose at least one filter to search.';return;}
 $('lookup').value='';results=[];nextPage=null;$('search-results').innerHTML='';$('lookup-status').textContent='';searchCards(`https://api.scryfall.com/cards/search?${new URLSearchParams({q:`game:paper ${terms.join(' ')}`,unique:lookupContext?.deckId?'cards':'prints',order:'released',dir:'desc'})}`);
};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
 const advanced=button.dataset.mode==='advanced';$('lookup-form').hidden=advanced;$('advanced-form').hidden=!advanced;
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b===button));
 $('lookup-status').textContent='';$('search-results').innerHTML='';$('more-results').hidden=true;
});
$('identity-colorless').onchange=e=>{if(e.target.checked)document.querySelectorAll('input[name="identity"]').forEach(x=>x.checked=false);};
document.querySelectorAll('input[name="identity"]').forEach(box=>box.onchange=()=>{if(box.checked)$('identity-colorless').checked=false;});
$('search-results').onclick=async e=>{const b=e.target.closest('[data-choice]');if(!b)return;const c=results[Number(b.dataset.choice)],v=cardFromScryfall(c),ctx=lookupContext;$('add-dialog').close();if(ctx?.deckId){await addScryfallCardToDeck(v,ctx.deckId);return;}if(ctx?.notOwnedDeckId){await addNotOwnedCard(v,ctx.notOwnedDeckId);return;}
 const carry=ctx?{quantity:ctx.value.quantity,condition:ctx.value.condition,location:ctx.value.location,notes:ctx.value.notes,finish:c.finishes.includes(ctx.value.finish)?ctx.value.finish:v.finish}:null;
 edit(v,ctx?.id,ctx?.heads||[],carry);
 const options=$('finish').options;for(const o of options)o.disabled=!c.finishes.includes(o.value);
};
$('manual-button').onclick=async()=>{const ctx=lookupContext;$('add-dialog').close();if(ctx?.deckId){await addNotOwnedCard(newManual(),ctx.deckId);return;}if(ctx?.notOwnedDeckId){await addNotOwnedCard(newManual(),ctx.notOwnedDeckId);return;}edit(ctx?.value||newManual(),ctx?.id,ctx?.heads||[]);for(const o of $('finish').options)o.disabled=false;};
$('cards').onclick=e=>{const b=e.target.closest('[data-record]');if(!b)return;const r=records(events).find(r=>r.id===b.dataset.record);if(r.conflict){show('backup-dialog');return;}for(const o of $('finish').options)o.disabled=false;edit(r.value,r.id,r.heads);};
$('card-form').onchange=e=>{const radio=e.target.closest('[data-deck-assignment][type="radio"]'),check=e.target.closest('[data-deck-assignment][type="checkbox"]');if(radio){assignmentDraft=radio.value?{[radio.value]:1}:{};renderDeckAssignments({...draft,quantity:Number($('quantity').value)});}else if(check){check.value=check.checked?'1':'0';if(check.checked)assignmentDraft[check.dataset.deckId]=1;else delete assignmentDraft[check.dataset.deckId];renderDeckAssignments({...draft,quantity:Number($('quantity').value)});}};
$('card-form').onclick=async e=>{if(!e.target.closest('[data-create-deck-from-card]'))return;const isCommander=await confirmAction(`Is this ${draft.name} the commander?`);let name=draft.name;if(!isCommander){name=window.prompt('Deck name',`${draft.name} Deck`)?.trim();if(!name)return;}const value=formValue();if(!isCommander&&!value.deckCounts) value.deckCounts={};const deckId=crypto.randomUUID(),recordId=editing||crypto.randomUUID();value.deckCounts={...(value.deckCounts||{}),[deckId]:1};if(Object.values(value.deckCounts).reduce((a,n)=>a+n,0)>value.quantity){toast('There are not enough copies to assign one to the new deck.');return;}const now=new Date().toISOString(),changes=[{id:crypto.randomUUID(),recordId,parents:heads.map(h=>h.id),at:now,value},{id:crypto.randomUUID(),recordId:deckId,parents:[],at:now,kind:'deck',value:{kind:'deck',name,bracket:3,commanders:isCommander?[recordId]:[]}}];try{await commit(changes);$('edit-dialog').close();selectedDeck=deckId;currentPage='deck';render();window.scrollTo({top:0,behavior:'smooth'});}catch(err){report(err);}};
$('card-form').oninput=e=>{if(e.target.id==='quantity'){renderDeckAssignments({...draft,quantity:Number(e.target.value)});return;}};
$('card-form').onsubmit=async e=>{e.preventDefault();const button=$('save-card');button.disabled=true;try{const value=formValue(),assigned=Object.values(value.deckCounts).reduce((a,b)=>a+b,0);if(assigned>value.quantity)throw Error(`You have assigned ${assigned} copies to decks, but own only ${value.quantity}.`);await commit([revision(value)]);$('edit-dialog').close();toast('Card saved on this device.');navigator.storage?.persist?.().catch(()=>{});}catch(e){report(e);}finally{button.disabled=false;}};
$('delete-card').onclick=async()=>{if(!await confirmAction(`Delete this entry for ${draft.name}? This deletion will be included in your next sync.`))return;try{await commit([revision(null)]);$('edit-dialog').close();toast('Entry deleted.');}catch(e){report(e);}};
$('validate-card').onclick=()=>{const ctx={value:formValue(),id:editing,heads};$('edit-dialog').close();openLookup(ctx);};
$('home-backup').onclick=()=>{updateDrive();show('backup-dialog');};$('home-settings').onclick=()=>{$('client-id').value=clientId;$('gemini-api-key').value=geminiApiKey;$('drive-auto-connect').checked=autoConnectDrive;$('drive-auto-sync').checked=autoSyncDrive;show('settings-dialog');};
$('save-settings').onclick=()=>{clientId=$('client-id').value.trim();geminiApiKey=$('gemini-api-key').value.trim();autoConnectDrive=$('drive-auto-connect').checked;autoSyncDrive=$('drive-auto-sync').checked;if(clientId&&!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)){toast('Enter a valid Google OAuth web client ID.');return;}disconnect();clearTimeout(keepAliveTimer);localStorage.setItem('arcana-client-id',clientId);localStorage.setItem('arcana-gemini-key',geminiApiKey);localStorage.setItem('arcana-auto-connect',String(autoConnectDrive));localStorage.setItem('arcana-auto-sync',String(autoSyncDrive));updateDrive();if(clientId)prepareGoogle().then(()=>{if(autoConnectDrive)return connectDriveOnLoad();}).catch(()=>{});toast('Settings saved.');};
function scheduleDriveKeepAlive(){
 clearTimeout(keepAliveTimer);
 if(!autoConnectDrive||!connected())return;
 const delay=Math.max(60000,(tokenExpiresAt()-Date.now())-120000);
 keepAliveTimer=setTimeout(async()=>{
  if(!autoConnectDrive||!clientId||!navigator.onLine)return;
  try{await authorize(clientId,{silent:true});updateDrive();scheduleDriveKeepAlive();}catch{}
 },delay);
}
async function connectDriveOnLoad(){
 if(!autoConnectDrive||!clientId||!navigator.onLine)return;
 try{
  await prepareGoogle();
  await authorize(clientId,{silent:true});
  updateDrive();scheduleDriveKeepAlive();
  if(autoSyncDrive)await runDriveSync({quiet:true});
 }catch{}
}
function scheduleAutoSync(){
 if(!autoSyncDrive||!connected()||!navigator.onLine)return;
 clearTimeout(autoSyncTimer);
 autoSyncTimer=setTimeout(()=>runDriveSync({quiet:true}),2500);
}
async function runDriveSync({quiet=false}={}){
 if(!connected())return;
 if(driveBusy){if(!quiet)toast('Drive sync is already in progress…');return;}
 driveBusy=true;$('sync-drive').disabled=true;$('home-sync-drive').disabled=true;$('home-sync-drive').classList.add('is-syncing');$('disconnect-drive').disabled=true;$('drive-status').textContent='Merging snapshots and saving a dated backup…';
 try{
  const merged=await syncDrive(events);
  await commit(merged,{fromSync:true});
  localStorage.setItem('arcana-last-sync',new Date().toISOString());
  render();
  if(!quiet)toast('Drive sync complete. A dated backup was saved.');
 }catch(e){if(!quiet)report(e);else console.info('Auto sync skipped:',e);}
 finally{driveBusy=false;$('sync-drive').disabled=false;$('home-sync-drive').disabled=false;$('home-sync-drive').classList.remove('is-syncing');$('disconnect-drive').disabled=false;updateDrive();}
}
function updateDrive(){$('connect-drive').hidden=connected();$('sync-drive').hidden=!connected();$('disconnect-drive').hidden=!connected();$('home-connect-drive').hidden=connected();$('home-sync-drive').hidden=!connected();$('drive-status').textContent=connected()?'Google Drive connected for this session.':clientId?'Ready to connect to Google Drive.':'Google Drive needs one-time setup. Open Settings & install to add your client ID.';}
$('connect-drive').onclick=$('home-connect-drive').onclick=async()=>{try{if(!clientId){$('backup-dialog').close();$('client-id').value='';show('settings-dialog');return;}if(!globalThis.google?.accounts?.oauth2){await prepareGoogle();toast('Google sign-in is ready. Press Connect Google Drive again.');return;}await authorize(clientId);updateDrive();scheduleDriveKeepAlive();if(autoSyncDrive)await runDriveSync({quiet:true});toast('Drive connected. Press Sync now to merge and back up.');}catch(e){report(e);}};
$('disconnect-drive').onclick=()=>{clearTimeout(keepAliveTimer);clearTimeout(autoSyncTimer);disconnect();updateDrive();toast('Google Drive disconnected.');};
$('sync-drive').onclick=$('home-sync-drive').onclick=()=>runDriveSync({quiet:false});
$('export').onclick=()=>{const blob=new Blob([backup(events)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`arcana-vault-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);$('backup-status').textContent='Backup download started. Keep the file somewhere safe.';};
$('import').onclick=()=>$('import-file').click();$('empty-import').onclick=()=>{show('backup-dialog');$('import-file').click();};
$('import-file').onchange=async()=>{try{const file=$('import-file').files[0];if(!file)return;if(file.size>30_000_000)throw Error('Choose a backup smaller than 30 MB.');const incoming=parseBackup(await file.text());const merged=mergeEvents(events,incoming);const added=merged.length-events.length;if(!added){toast('This backup is already in your collection.');return;}if(!await confirmAction(`Merge ${added} new revisions from this backup? Existing independent edits will be preserved for review.`))return;await commit(incoming);$('backup-status').textContent=`Merged ${added} revisions. Review any conflicting edits below.`;toast('Backup imported.');}catch(e){report(e);}finally{$('import-file').value='';}};
$('conflicts').onclick=async e=>{const b=e.target.closest('[data-resolve]');if(!b)return;try{const r=records(events).find(r=>r.id===b.dataset.resolve);if(!r||!r.conflict)return;const chosen=r.heads[Number(b.dataset.index)];if(!await confirmAction('Keep this version and resolve the other versions of this entry?'))return;await commit([{id:crypto.randomUUID(),recordId:r.id,parents:r.heads.map(h=>h.id),at:new Date().toISOString(),value:chosen.value}]);toast('Conflict resolved. Sync to share your choice.');}catch(e){report(e);}};
$('persist').onclick=async()=>{try{const granted=await navigator.storage?.persist?.();$('persist-status').textContent=granted?'Persistent storage granted. Keep backups as well.':'Your browser did not grant persistent storage. Regular backups are recommended.';}catch(e){report(e);}};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});$('install').onclick=async()=>{if(!installPrompt)return;await installPrompt.prompt();installPrompt=null;$('install').hidden=true;};
function network(){$('network-status').textContent=navigator.onLine?'Local-first storage':'Offline · collection available';if(navigator.onLine&&autoConnectDrive&&!connected())connectDriveOnLoad();else if(navigator.onLine&&autoSyncDrive&&connected())scheduleAutoSync();}window.addEventListener('online',network);window.addEventListener('offline',network);
if(matchMedia('(pointer: coarse)').matches||innerWidth<=900){
 let leavingApp=false,exitPromptOpen=false;
 if(!history.state?.manaHordeGuard)history.pushState({manaHordeGuard:true},'');
 window.addEventListener('popstate',async()=>{
  if(leavingApp)return;
  const openDialog=document.querySelector('dialog[open]');
  if(openDialog){if(openDialog.id!=='confirm-dialog')openDialog.close();history.pushState({manaHordeGuard:true},'');return;}
  if(exitPromptOpen){history.pushState({manaHordeGuard:true},'');return;}
  exitPromptOpen=true;
  const leave=await confirmAction('Are you sure you want to leave ManaHorde?');
  exitPromptOpen=false;
  if(leave){leavingApp=true;history.back();}
  else history.pushState({manaHordeGuard:true},'');
 });
}
async function loadMtgNews(){
 const target='https://magic.wizards.com/en/news',container=$('mtg-news'),sources=['./api/mtg-news',`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`];
 for(const source of sources){try{
  const response=await fetch(source);if(!response.ok)continue;const documentNews=new DOMParser().parseFromString(await response.text(),'text/html'),seen=new Set(),items=[];
  for(const link of documentNews.querySelectorAll('a[href*="/en/news/"]')){const url=new URL(link.getAttribute('href'),target);if(url.hostname!=='magic.wizards.com'||/\/news\/(archive|announcements|feature|making-magic|mtg-arena)\/?$/i.test(url.pathname))continue;const title=(link.getAttribute('title')||link.textContent||'').replace(/\s+/g,' ').trim();if(title.length<16||title.length>150||seen.has(url.href))continue;seen.add(url.href);const root=link.closest('article')||link.closest('[class*="card"]')||link.parentElement,date=root?.querySelector('time')?.getAttribute('datetime')||'',summary=(root?.querySelector('p')?.textContent||'').replace(/\s+/g,' ').trim();items.push({title,url:url.href,date,summary});if(items.length===5)break;}
  if(!items.length)continue;container.innerHTML=items.map(item=>`<article class="news-item"><div class="news-item-copy"><h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>${item.summary?`<p>${esc(item.summary.slice(0,190))}</p>`:''}</div>${item.date?`<time>${esc(new Date(item.date).toLocaleDateString())}</time>`:''}</article>`).join('');return;
 }catch{}}
 container.innerHTML='<p class="muted">DailyMTG headlines could not be loaded right now. <a href="https://magic.wizards.com/en/news" target="_blank" rel="noopener">Open the latest Magic news ↗</a></p>';
}if(channel)channel.onmessage=async()=>{try{events=await read();render();}catch(e){report(e);}};
const splashEl=$('mobile-splash');
if(splashEl){if(matchMedia('(pointer: coarse)').matches||innerWidth<=900){setTimeout(()=>{splashEl.classList.add('is-done');setTimeout(()=>splashEl.remove(),160);},500);}else splashEl.remove();}
loadMtgNews();
preloadCardCatalog();
try{db=await openDB();events=mergeEvents(await read());render();updateDrive();network();if(clientId){if(autoConnectDrive)connectDriveOnLoad();else prepareGoogle().catch(()=>{});}if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(e=>{console.error(e);toast('Offline setup failed. Keep the local server running and reload.');});}catch(e){$('add-button').disabled=true;$('first-card').disabled=true;report(Error('Local storage could not open. Enable browser site storage and reload before adding cards.'));}
