"use strict";
// Node 22+. The operator supplies their own short-lived administrator token.
const fs=require('node:fs');
async function main(){
    const [action,...rest]=process.argv.slice(2),args={};
    for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--') || rest[i+1]===undefined)throw new Error('Options need a value');args[rest[i].slice(2)]=rest[i+1];}
    const base=new URL(args.base || 'http://localhost:8080');
    if((base.protocol!=='https:' && !(base.protocol==='http:' && ['localhost','127.0.0.1'].includes(base.hostname))) || base.username || base.password || base.pathname!=='/' || base.search || base.hash)throw new Error('Use an HTTPS origin, or localhost for development');
    const token=process.env.TRANQUIL_ADMIN_TOKEN;if(!token)throw new Error('Set TRANQUIL_ADMIN_TOKEN to your short-lived administrator access token');
    let body,path;
    if(action==='preview'){
        if(!args.output)throw new Error('Choose --output for the review file');
        body={lat:Number(args.lat),lng:Number(args.lng),radius:Number(args.radius || 5000)};
        if(!Number.isFinite(body.lat) || !Number.isFinite(body.lng))throw new Error('Supply --lat and --lng for the clinic area');
        path='/api/admin/clinics/osm-preview';
    }else if(action==='import'){
        if(!args.file)throw new Error('Supply --file with your reviewed import JSON');
        body=JSON.parse(fs.readFileSync(args.file,'utf8').replace(/^\uFEFF/,''));
        if(body.reviewed!==true)throw new Error('Review source details and set reviewed: true in the import file');
        path='/api/admin/clinics/import';
    }else throw new Error('Usage: clinic-directory.cjs preview --lat N --lng N --output file.json | import --file reviewed.json [--base origin]');
    const response=await fetch(new URL(path,base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(result.error || result.message || 'Directory request failed');
    if(action==='preview'){
        // Atomic exclusive creation protects an earlier reviewed file from replacement.
        fs.writeFileSync(args.output,JSON.stringify({...result,reviewed:false},null,2)+'\n',{encoding:'utf8',flag:'wx'});
        console.log('Preview saved. Complete missing addresses and verify details before importing.');
    }else console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
