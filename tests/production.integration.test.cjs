const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomBytes}=require('node:crypto'),{execFileSync}=require('node:child_process');
test('isolated production stack authenticates, restarts, backs up and restores its fixture database',{skip:process.env.TEST_ALLOW_PRODUCTION_FIXTURE!=='1',timeout:300000},async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'tt-production-')),project='ttvalidation'+Date.now(),restore=project+'-restore';let restoreCreated=false;
    const run=(args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:190000});
    const compose=(args)=>run(['compose','--env-file',path.join(root,'.env.fixture'),'-p',project,'-f',path.join(root,'compose.yaml'),'-f',path.join(root,'fixture.yaml'),...args]);
    const auth="const fs=require('fs');if(!db.getSiblingDB('admin').auth(fs.readFileSync('/run/secrets/mongo_root_user','utf8').trim(),fs.readFileSync('/run/secrets/mongo_root_password','utf8').trim()).ok)quit(1);";
    try{
        fs.mkdirSync(path.join(root,'deploy','secrets'),{recursive:true,mode:0o700});fs.mkdirSync(path.join(root,'backups'),{mode:0o700});
        fs.copyFileSync('compose.live.yaml',path.join(root,'compose.yaml'));for(const name of ['mongo-init.js','backup.sh','Caddyfile'])fs.copyFileSync(path.join('deploy',name),path.join(root,'deploy',name));
        const password=randomBytes(32).toString('hex');const secrets={'jwt-secret':randomBytes(48).toString('hex'),'resend-key':'fixture-provider-key-not-used','turn-secret':randomBytes(32).toString('hex'),'mongo-root-user':'fixture_root','mongo-root-password':randomBytes(32).toString('hex'),'mongo-app-user':'fixture_app','mongo-app-password':password,'mongo-cluster-key':randomBytes(48).toString('base64'),'mongo-uri':`mongodb://fixture_app:${password}@mongo:27017/tranquil_talk?authSource=tranquil_talk&replicaSet=rs0&serverSelectionTimeoutMS=5000`};
        for(const [name,value] of Object.entries(secrets))fs.writeFileSync(path.join(root,'deploy','secrets',name),value,{mode:0o644});
        // Temporary fixture secrets need read access for the image's unprivileged app UID.
        fs.writeFileSync(path.join(root,'.env.fixture'),'DOMAIN=example.com\nMAIL_FROM=fixture@example.com\nTURN_URL=turn:fixture.invalid:3478\n');
        fs.writeFileSync(path.join(root,'fixture.yaml'),'services:\n  app:\n    image: tranquil-test:ci\n');
        compose(['up','-d','--no-build','--wait','--wait-timeout','180','app','mongo']);
        assert.match(compose(['exec','-T','app','curl','--fail','--silent','http://127.0.0.1:8080/api/health']),/"ready":true/);
        compose(['run','--rm','--no-deps','proxy','caddy','validate','--config','/etc/caddy/Caddyfile']);
        const unauth=compose(['exec','-T','mongo','mongosh','--quiet','--eval',"try{db.getSiblingDB('tranquil_talk').users.findOne();quit(2);}catch(e){if(e.code!==13)quit(3);print('authentication-required');}"]);
        assert.match(unauth,/authentication-required/);
        compose(['exec','-T','mongo','mongosh','--quiet','--eval',auth+"db.getSiblingDB('tranquil_talk').restore_fixture.insertOne({_id:'isolated-production-sentinel',value:42});"]);
        compose(['restart','app']);await new Promise(r=>setTimeout(r,3000));assert.match(compose(['exec','-T','app','curl','--fail','--silent','http://127.0.0.1:8080/api/health']),/"ready":true/);
        compose(['run','--rm','backup']);const archives=fs.readdirSync(path.join(root,'backups')).filter(f=>f.endsWith('.archive.gz'));assert.equal(archives.length,1);assert.ok(fs.statSync(path.join(root,'backups',archives[0])).size>100);
        run(['run','-d','--name',restore,'--network',project+'_database','--network-alias','fixture-restore','-v',path.join(root,'backups')+':/backups:ro','mongo:7.0','--replSet','restoreRs','--bind_ip_all']);restoreCreated=true;
        const end=Date.now()+30000;while(true){try{run(['exec',restore,'mongosh','--quiet','--eval',"db.adminCommand('ping')"]);break;}catch{if(Date.now()>end)throw new Error('Restore fixture did not start');await new Promise(r=>setTimeout(r,500));}}
        run(['exec',restore,'mongosh','--quiet','--eval',"rs.initiate({_id:'restoreRs',members:[{_id:0,host:'fixture-restore:27017'}]})"]);
        while(true){try{run(['exec',restore,'mongosh','--quiet','--eval',"if(!db.hello().isWritablePrimary)quit(1)"]);break;}catch{if(Date.now()>end+20000)throw new Error('Restore replica set did not become ready');await new Promise(r=>setTimeout(r,500));}}
        run(['exec',restore,'mongorestore','--gzip','--archive=/backups/'+archives[0],'--oplogReplay']);
        assert.match(run(['exec',restore,'mongosh','--quiet','--eval',"if(db.getSiblingDB('tranquil_talk').restore_fixture.findOne({_id:'isolated-production-sentinel'}).value!==42)quit(1);print('restored-fixture-ok')"]),/restored-fixture-ok/);
    }finally{
        if(restoreCreated)try{run(['rm','-f',restore]);}catch{}
        try{compose(['down','--volumes','--remove-orphans']);}catch{}
        if(path.dirname(root)!==os.tmpdir() || !path.basename(root).startsWith('tt-production-'))throw new Error('Refusing unexpected fixture cleanup path');
        fs.rmSync(root,{recursive:true,force:true});
    }
});
