const {test} = require("node:test");
const assert = require("node:assert/strict");
const {TranquilCall} = require("../web/rtc.js");

function setup(mediaOverride) {
    const tracks = ["audio", "video"].map(kind => ({kind, enabled: true, stopped: false, stop(){this.stopped = true;}}));
    const stream = {getTracks:()=>tracks, getAudioTracks:()=>[tracks[0]], getVideoTracks:()=>[tracks[1]]};
    const mediaCalls = [], signals = [];
    class Peer {
        constructor() {this.remoteDescription = null; this.candidates = []; this.tracks = [];}
        addTrack(track) {this.tracks.push(track);}
        async createOffer() {return {type:"offer", sdp:"offer-sdp"};}
        async createAnswer() {return {type:"answer", sdp:"answer-sdp"};}
        async setLocalDescription(value) {this.localDescription = value;}
        async setRemoteDescription(value) {this.remoteDescription = value;}
        async addIceCandidate(value) {this.candidates.push(value);}
        close(){this.closed = true;}
    }
    const localVideo = {}, remoteVideo = {};
    const call = new TranquilCall({send:(type,payload)=>signals.push({type,...payload}),status:()=>{},
        localVideo,remoteVideo,PeerConnection:Peer,
        mediaDevices:{getUserMedia:mediaOverride || (async constraints => {mediaCalls.push(constraints);return stream;})}});
    return {call, tracks, stream, mediaCalls, signals, localVideo, remoteVideo};
}
test("audio mode never requests camera access", async () => {
    const {call, mediaCalls, localVideo} = setup();
    assert.equal(mediaCalls.length, 0);
    await call.prepare("audio");
    assert.deepEqual(mediaCalls, [{audio:true,video:false}]);
    assert.equal(localVideo.hidden, true);
    call.end();
});
test("video mode requests both devices and sends an SDP offer", async () => {
    const {call, mediaCalls, signals} = setup();
    await call.prepare("video"); await call.offer();
    assert.deepEqual(mediaCalls, [{audio:true,video:true}]);
    assert.deepEqual(signals, [{type:"offer", offer:{type:"offer",sdp:"offer-sdp"}}]);
    call.end();
});
test("ICE arriving before SDP is queued and applied after remote description", async () => {
    const {call, signals} = setup();
    await call.prepare("audio");
    await call.receive("ice_candidate",{candidate:{candidate:"early"}});
    assert.equal(call.peer.candidates.length, 0);
    await call.receive("offer",{offer:{type:"offer",sdp:"remote"}});
    assert.deepEqual(call.peer.candidates,[{candidate:"early"}]);
    assert.equal(signals[0].type,"answer");
    call.end();
});
test("answer flushes queued ICE", async () => {
    const {call} = setup();
    await call.prepare("audio");
    await call.receive("ice_candidate",{candidate:{candidate:"early"}});
    await call.receive("answer",{answer:{type:"answer",sdp:"remote"}});
    assert.equal(call.peer.candidates.length,1);
    call.end();
});
test("mute and camera controls toggle actual tracks", async () => {
    const {call,tracks} = setup();
    await call.prepare("video");
    assert.equal(call.toggleMute(),true); assert.equal(tracks[0].enabled,false);
    assert.equal(call.toggleMute(),false); assert.equal(tracks[0].enabled,true);
    assert.equal(call.toggleCamera(),true); assert.equal(tracks[1].enabled,false);
    call.end();
});
test("hangup stops every track, closes the peer and clears both views", async () => {
    const {call,tracks,localVideo,remoteVideo,signals} = setup();
    await call.prepare("video");
    const peer = call.peer;
    call.end(); call.end();
    assert(tracks.every(track=>track.stopped));
    assert.equal(peer.closed,true);
    assert.equal(localVideo.srcObject,null);
    assert.equal(remoteVideo.srcObject,null);
    await call.receive("offer",{offer:{}});
    assert.equal(signals.length,0);
});
test("ending while a permission prompt is pending still releases the eventual stream", async () => {
    let resolve;
    const {call,stream,tracks} = setup(()=>new Promise(r=>{resolve=r;}));
    const preparing = call.prepare("video");
    call.end(); resolve(stream);
    await assert.rejects(preparing,/Call ended/);
    assert(tracks.every(track=>track.stopped));
    assert.equal(call.peer,null);
});
test("permission denial propagates without opening a peer", async () => {
    const {call} = setup(async()=>{throw new Error("denied");});
    await assert.rejects(call.prepare("audio"),/denied/);
    assert.equal(call.peer,null);
});
test("invalid call modes are rejected before requesting devices", async () => {
    const {call,mediaCalls} = setup();
    await assert.rejects(call.prepare("other"),/Choose audio or video/);
    assert.equal(mediaCalls.length,0);
});

test("mute and camera choices made during device permission are applied before tracks are sent", async () => {
    let resolve;
    const {call,stream,tracks} = setup(()=>new Promise(r=>{resolve=r;}));
    const preparing = call.prepare("video");
    call.toggleMute(); call.toggleCamera();
    resolve(stream); await preparing;
    assert.equal(tracks[0].enabled,false);
    assert.equal(tracks[1].enabled,false);
    call.end();
});
