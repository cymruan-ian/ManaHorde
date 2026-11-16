import {backup,parseBackup,mergeEvents} from './core.js';
let token='',expires=0,loading;
const scope='https://www.googleapis.com/auth/drive.file';
function loadGoogle(){
 if(globalThis.google?.accounts?.oauth2)return Promise.resolve();
 if(!loading)loading=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=resolve;s.onerror=()=>{loading=null;s.remove();reject(Error('Google sign-in could not load. Check your connection.'));};document.head.append(s);});return loading;
}
export async function prepareGoogle(){await loadGoogle();}
export function authorize(clientId){return new Promise((resolve,reject)=>{
 if(!clientId.endsWith('.apps.googleusercontent.com'))return reject(Error('Enter your Google OAuth web client ID in Settings first.'));
 if(!globalThis.google?.accounts?.oauth2)return reject(Error('Google sign-in is loading. Try again in a moment.'));
 google.accounts.oauth2.initTokenClient({client_id:clientId,scope,callback:r=>{if(r.error)return reject(Error(r.error_description||r.error));if(!google.accounts.oauth2.hasGrantedAllScopes(r,scope))return reject(Error('Drive file permission is needed to sync.'));token=r.access_token;expires=Date.now()+Number(r.expires_in)*1000;resolve();},error_callback:()=>reject(Error('Google sign-in was closed or blocked. Try again.'))}).requestAccessToken({prompt:''});
});}
export function connected(){return !!token&&Date.now()<expires-60000;}
export function disconnect(){if(token&&globalThis.google)google.accounts.oauth2.revoke(token,()=>{});token='';expires=0;}
async function request(url,options={}){if(!connected())throw Error('Connect Google Drive again; your session has expired.');const r=await fetch(url,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`}});if(!r.ok){if(r.status===401){token='';throw Error('Google session expired. Connect again.');}throw Error(`Google Drive request failed (${r.status}). Your local collection is safe.`);}return r;}
async function list(q){let files=[],page;do{const p=new URLSearchParams({q,fields:'nextPageToken,files(id,name,mimeType)',pageSize:'1000'});if(page)p.set('pageToken',page);const data=await(await request(`https://www.googleapis.com/drive/v3/files?${p}`)).json();files.push(...data.files);page=data.nextPageToken;}while(page);return files;}
export async function syncDrive(localEvents){
 // Immutable snapshots avoid destructive read/modify/write races between devices.
 const files=await list("trashed = false and appProperties has { key='arcanaVault' and value='snapshot-v1' }");
 let merged=localEvents;
 for(const f of files){const r=await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`);const t=await r.text();if(t.length>30_000_000)throw Error('A Drive backup is too large to import.');merged=mergeEvents(merged,parseBackup(t));}
 let folders=await list("trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='arcanaVault' and value='folder-v1' }");
 if(!folders.length){const r=await request('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Arcana Vault Backups',mimeType:'application/vnd.google-apps.folder',appProperties:{arcanaVault:'folder-v1'}})});folders=[await r.json()];}
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),boundary=`arcana_${crypto.randomUUID()}`;
 const metadata=JSON.stringify({name:`Arcana Vault ${stamp}.json`,parents:[folders[0].id],appProperties:{arcanaVault:'snapshot-v1'}});
 const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${backup(merged)}\r\n--${boundary}--`;
 await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});return merged;
}
