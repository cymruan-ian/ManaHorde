import {deflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
function chunk(type,b){const t=Buffer.from(type),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(b.length);check.writeUInt32BE(crc(Buffer.concat([t,b])));return Buffer.concat([len,t,b,check]);}

function sdRoundBox(px,py,cx,cy,hw,hh,r,deg=0){
 const a=-deg*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),dx=px-cx,dy=py-cy;
 const rx=dx*cos-dy*sin,ry=dx*sin+dy*cos;
 const qx=Math.abs(rx)-(hw-r),qy=Math.abs(ry)-(hh-r);
 return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
}

const cards=[
 {deg:-32,cy:191,color:[241,223,154]},
 {deg:-16,cy:185,color:[91,151,210]},
 {deg:0,cy:181,color:[60,71,70]},
 {deg:16,cy:185,color:[216,92,84]},
 {deg:32,cy:191,color:[78,154,98]}
];

function sample(px,py){
 let c=[244,240,231];
 const paint=(d,fill,stroke,sw)=>{if(d<=0)c=fill;else if(d<=sw)c=stroke;};
 paint(sdRoundBox(px,py,256,384,140,36,18),[217,206,186],[255,253,248],8);
 paint(sdRoundBox(px,py,256,366,128,36,18),[203,185,143],[255,253,248],8);
 for(const card of cards){
  const rad=card.deg*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
  const ox=0,oy=card.cy-360;
  const cx=256+ox*cos-oy*sin,cy=360+ox*sin+oy*cos;
  paint(sdRoundBox(px,py,cx,cy,60,89,18,card.deg),card.color,[255,253,248],10);
 }
 paint(sdRoundBox(px,py,256,346,114,38,18),[23,62,50],[255,253,248],10);
 if(sdRoundBox(px,py,256,346,90,8,8)<=0)c=[223,195,138];
 return c;
}

for(const n of [192,512]){
 const rows=Buffer.alloc(n*(n*4+1)),scale=512/n;
 for(let y=0;y<n;y++){
  for(let x=0;x<n;x++){
   let r=0,g=0,b=0;
   for(const sy of [.25,.75])for(const sx of [.25,.75]){
    const [sr,sg,sb]=sample((x+sx)*scale,(y+sy)*scale);
    r+=sr;g+=sg;b+=sb;
   }
   rows.set([Math.round(r/4),Math.round(g/4),Math.round(b/4),255],y*(n*4+1)+1+x*4);
  }
 }
 const h=Buffer.alloc(13);h.writeUInt32BE(n,0);h.writeUInt32BE(n,4);h[8]=8;h[9]=6;
 writeFileSync(fileURLToPath(new URL(`../icon-${n}.png`,import.meta.url)),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));
}
