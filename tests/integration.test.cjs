const {test} = require("node:test");
const assert = require("node:assert/strict");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8080";
async function request(path, method="GET", body, token) {
    return fetch(base + path, {method, headers:{
        ...(body ? {"content-type":"application/json"} : {}),
        ...(token ? {authorization:"Bearer " + token} : {})
    }, body:body ? JSON.stringify(body) : undefined});
}
test("real backend: authentication, public resources, room capabilities and signaling isolation", {timeout:60000}, async () => {
    const home = await request("/");
    assert.equal(home.status,200);
    assert.match(home.headers.get("content-security-policy"),/frame-ancestors 'none'/);
    for (const query of ["lat=oops&lng=0&radius=10","lat=nan&lng=0&radius=10",
        "lat=91&lng=0&radius=10","lat=0&lng=181&radius=10","lat=0&lng=0&radius=0",
        "lat=0&lng=0&radius=100001","lat=90x&lng=0&radius=10"]) {
        assert.equal((await request("/api/clinics?"+query)).status,400);
    }
    assert.equal((await request("/api/clinics?lat=0&lng=0&radius=5000")).status,200);
    assert.equal((await request("/api/clinics","POST",{name:"Unauthorized",lat:0,lng:0})).status,401);
    assert.equal((await request("/api/sessions","POST")).status,401);
    const email = "integration-" + Date.now() + "@example.com";
    const password = "a-strong-test-password";
    assert.equal((await request("/api/register","POST",{email,password,role:"admin"})).status,400);
    assert.equal((await request("/api/register","POST",{email,password,role:"expert"})).status,201);
    assert.equal((await request("/api/register","POST",{email:email.toUpperCase(),password,role:"expert"})).status,409);
    assert.equal((await request("/api/login","POST",{email,password:"wrong"})).status,401);
    const login = await request("/api/login","POST",{email:email.toUpperCase(),password});
    assert.equal(login.status,200);
    const account = await login.json();
    assert.equal(account.role,"expert_pending");
    const claims = JSON.parse(Buffer.from(account.token.split(".")[1],"base64url"));
    assert(claims.exp > claims.iat && claims.exp - claims.iat === 3600);
    assert.equal(claims.email,undefined);
    assert.equal((await request("/api/clinics","POST",{name:"Not approved",lat:0,lng:0},account.token)).status,403);
    assert.equal((await request("/api/blogs","POST",{title:"Not approved",body:"x".repeat(100),author:"X"},account.token)).status,403);
    const rooms = [];
    for (let i=0;i<2;i++) {
        const response = await request("/api/sessions","POST",undefined,account.token);
        assert.equal(response.status,201); rooms.push(await response.json());
    }
    const roomClaims = JSON.parse(Buffer.from(rooms[0].ticket.split(".")[1],"base64url"));
    assert.equal(roomClaims.aud,"tranquil-room");
    assert.equal(roomClaims.sub,rooms[0].roomId);
    assert.equal(roomClaims.email,undefined);
    assert.equal((await request("/api/sessions","POST",undefined,rooms[0].ticket)).status,401);
    for(const path of ["/api/blogs","/api/events"]) {
        const response = await request(path);
        assert.equal(response.status,200); assert(Array.isArray(await response.json()));
    }
    // Expose handshake status/body when a WebSocket client only reports a network error.
    const handshake = await new Promise((resolve,reject)=>{
        const http = require("node:http");
        const https = require("node:https");
        const url = new URL("/rtc/signal",base);
        const req = (url.protocol === "https:" ? https : http).request(url,{
            headers:{connection:"Upgrade",upgrade:"websocket",
                "sec-websocket-version":"13","sec-websocket-key":require("node:crypto").randomBytes(16).toString("base64")}
        });
        req.on("upgrade",(res,socket)=>{socket.destroy();resolve({status:res.statusCode});});
        req.on("response",res=>{
            let body="";res.on("data",chunk=>{body+=chunk;});
            res.on("end",()=>resolve({status:res.statusCode,body:body.slice(0,500)}));
        });
        req.on("error",reject);req.end();
    });
    assert.equal(handshake.status,101,JSON.stringify(handshake));
    require("node:diagnostics_channel").channel("undici:request:headers").subscribe(({request,response})=>{
        if(request.path === "/rtc/signal") console.log("WebSocket HTTP status:",response.statusCode);
    });
    const sockets=[];
    async function connect() {
        const ws=new WebSocket(base.replace(/^http/,"ws")+"/rtc/signal");
        const messages=[], waiters=[];
        ws.addEventListener("message",event=>{
            const body=JSON.parse(event.data);
            const index=waiters.findIndex(waiter=>waiter.type===body.type);
            if(index>=0) waiters.splice(index,1)[0].resolve(body); else messages.push(body);
        });
        const opened=Promise.withResolvers();
        ws.addEventListener("open",()=>opened.resolve(),{once:true});
        ws.addEventListener("error",event=>opened.reject(new Error("WebSocket open failed: "+(event.message || event.error?.message || "unknown error"))),{once:true});
        await opened.promise; sockets.push(ws); console.log("WebSocket connected:",sockets.length);
        return {
            ws,
            send(body){ws.send(JSON.stringify(body));},
            next(type) {
                const index=messages.findIndex(body=>body.type===type);
                if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);
                return new Promise((resolve,reject)=>{
                    const timer=setTimeout(()=>reject(new Error("Timed out waiting for "+type)),5000);
                    waiters.push({type,resolve:body=>{clearTimeout(timer);resolve(body);}});
                });
            }
        };
    }
    try {
        const a=await connect(),b=await connect(),intruder=await connect();
        intruder.send({type:"offer",roomId:rooms[0].roomId,offer:{type:"offer",sdp:"forged"}});
        assert.equal((await intruder.next("error")).error,"Join a room with a valid invitation first");
        a.send({type:"join",ticket:rooms[0].ticket});
        assert.equal((await a.next("joined")).peers,0);
        b.send({type:"join",ticket:rooms[0].ticket});
        assert.equal((await b.next("joined")).peers,1);
        await a.next("peer_joined");
        intruder.send({type:"join",ticket:rooms[0].ticket});
        assert.match((await intruder.next("error")).error,/full/);
        a.send({type:"join",ticket:rooms[0].ticket});
        assert.equal((await a.next("joined")).peers,1);
        // Duplicate join does not occupy a third slot or forward twice.
        a.send({type:"offer",roomId:"injected",email:"must-not-relay",offer:{type:"offer",sdp:"valid"}});
        const offer=await b.next("offer");
        assert.deepEqual(offer,{type:"offer",offer:{type:"offer",sdp:"valid"}});
        a.send({type:"join",ticket:rooms[1].ticket});
        assert.match((await a.next("error")).error,/unavailable/);
        b.ws.close();
        await a.next("peer_left");
    } finally {for(const ws of sockets)ws.close();}
});
