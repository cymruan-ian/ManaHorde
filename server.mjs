// ManaHorde Local Server
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const allowed = new Set(['index.html','app.js','core.js','drive.js','prices.js','styles.css','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png']);
const server = http.createServer(async(req,res)=>{
  const requestUrl=new URL(req.url,'http://localhost');
  if(requestUrl.pathname==='/api/mtg-news'){
    try{const upstream=await fetch('https://magic.wizards.com/en/news',{headers:{'User-Agent':'ManaHorde news preview'}});if(!upstream.ok)throw Error('News source unavailable');const html=await upstream.text();res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=900','X-Content-Type-Options':'nosniff'});res.end(html);}catch{res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('DailyMTG news is unavailable.');}return;
  }
  if(requestUrl.pathname==='/api/price-guide'){
    try{const upstream=await fetch('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json');if(!upstream.ok)throw Error('Price guide unavailable');const json=await upstream.text();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(json);}catch{res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('Cardmarket price guide is unavailable.');}return;
  }
  if(requestUrl.pathname==='/api/commander-guide'){
    const name=String(requestUrl.searchParams.get('name')||'').trim();
    const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if(!slug){res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":"Missing commander name"}');return;}
    try{const upstream=await fetch(`https://json.edhrec.com/pages/commanders/${encodeURIComponent(slug)}.json`,{headers:{'User-Agent':'ManaHorde deck helper'}});if(!upstream.ok)throw Error('Commander guide unavailable');const json=await upstream.text();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(json);}catch{res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end('{"error":"Commander data unavailable"}');}return;
  }
  const name = decodeURIComponent(requestUrl.pathname).replace(/^\//,'') || 'index.html';
  if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
  try {const data=await readFile(path.join(root,name));res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4173,'127.0.0.1',()=>console.log('ManaHorde: http://localhost:4173 — keep this window open while using the local app.'));
