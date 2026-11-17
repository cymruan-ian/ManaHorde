import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('index.html has home action labels, deck toggles, type sort, suggestions, summary, and no breadcrumbs',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/Backups &amp; sync/);
 assert.match(html,/Settings &amp; install/);
 assert.match(html,/id="deck-filter-legal"/);
 assert.match(html,/id="deck-filter-favourite"/);
 assert.match(html,/id="toggle-deck-ctas"/);
 assert.match(html,/<option value="type">Card type \(A–Z\)<\/option>/);
 assert.match(html,/<option value="value">Value \(high–low\)<\/option>/);
 assert.match(html,/id="lookup-suggestions"/);
 assert.match(html,/id="shopping-summary"/);
 assert.match(html,/id="shopping-total"/);
 assert.match(html,/id="collection-value"/);
 assert.match(html,/id="commander-guide-dialog"/);
 assert.match(html,/id="gemini-api-key"/);
 assert.match(html,/id="mobile-bottom-nav"/);
 assert.match(html,/id="home-lookup-card"/);
 assert.match(html,/id="card-lookup-dialog"/);
 assert.doesNotMatch(html,/class="breadcrumb"/);
});

test('styles.css defines CTA cap/border, yellow star, not-owned overlay, fixed bracket, quarter stack, and mobile/foldable grids',async()=>{
 const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.collection-deck-cta\{[^}]*max-height:80px;[^}]*border:6px solid transparent/);
 assert.match(css,/\.collection-deck-cta \.deck-favourite-star\{[^}]*color:#f0c419!important/);
 assert.match(css,/\.collection-deck-cta\.bracket-5 \.collection-deck-sub\{color:#34463c\}/);
 assert.match(css,/background:rgba\(255,255,255,\.5\)/);
 assert.match(css,/\.deck-bracket\{[^}]*height:96px/);
 assert.match(css,/\.deck-stack-card\+\.deck-stack-card\{margin-top:-105%\}/);
 assert.match(css,/@media\(max-width:900px\)/);
 assert.match(css,/@media\(max-width:580px\)/);
});

test('sw.js precaches prices.js and server.mjs exposes /api/price-guide',async()=>{
 const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(sw,/'\.\/prices\.js'/);
 assert.match(server,/\/api\/price-guide/);
 assert.match(server,/\/api\/commander-guide/);
});
