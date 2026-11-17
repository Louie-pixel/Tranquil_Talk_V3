/* Shared browser call engine. No media is requested until join() is called. */
(function(root) {
"use strict";
class TranquilCall {
    constructor({send, status, localVideo, remoteVideo, mediaDevices, PeerConnection, iceServers, iceTransportPolicy = "all"}) {
        this.send = send;
        this.status = status;
        this.localVideo = localVideo;
        this.remoteVideo = remoteVideo;
        this.mediaDevices = mediaDevices || navigator.mediaDevices;
        this.PeerConnection = PeerConnection || RTCPeerConnection;
        this.iceServers = iceServers || [{urls: "stun:stun.l.google.com:19302"}];
        this.stream = null; this.peer = null; this.candidates = [];
        this.ended = false; this.muted = false; this.cameraOff = false;
        this.generation = 0;
        this.iceTransportPolicy = iceTransportPolicy;
        this.offerer = false; this.restarts = 0; this.restartTimer = null;
    }
    async prepare(mode, devices = {}) {
        if (mode !== "audio" && mode !== "video") throw new Error("Choose audio or video");
        const generation = ++this.generation;
        this.ended = false;
        if (!this.mediaDevices?.getUserMedia) throw new Error("Use HTTPS or localhost to access your microphone");
        const stream = await this.mediaDevices.getUserMedia({audio: devices.audioDeviceId ? {deviceId:{exact:devices.audioDeviceId}} : true,
            video: mode === "video" ? devices.videoDeviceId ? {deviceId:{exact:devices.videoDeviceId}} : true : false});
        if (this.ended || generation !== this.generation) {
            stream.getTracks().forEach(track => track.stop());
            throw new Error("Call ended before device access completed");
        }
        this.stream = stream;
        stream.getAudioTracks().forEach(track => {track.enabled = !this.muted;});
        stream.getVideoTracks().forEach(track => {track.enabled = !this.cameraOff;});
        this.localVideo.srcObject = stream;
        this.localVideo.hidden = mode === "audio";
        const peer = new this.PeerConnection({iceServers: this.iceServers, iceTransportPolicy:this.iceTransportPolicy});
        this.peer = peer;
        stream.getTracks().forEach(track => peer.addTrack(track, stream));
        peer.onicecandidate = event => {
            if (!this.ended && event.candidate) this.send("ice_candidate", {candidate: event.candidate});
        };
        peer.ontrack = event => {
            if (!this.ended && event.streams?.[0]) this.remoteVideo.srcObject = event.streams[0];
        };
        peer.onconnectionstatechange = () => {
            if (this.ended) return;
            const state = peer.connectionState;
            if(state === "connected") {clearTimeout(this.restartTimer);this.restartTimer=null;}
            if(this.offerer && ["disconnected","failed"].includes(state) && !this.restartTimer && this.restarts < 2) {
                this.restartTimer=setTimeout(async()=>{
                    this.restartTimer=null;
                    if(this.ended || this.peer!==peer || peer.connectionState==="connected")return;
                    ++this.restarts;
                    try {await this.offer({iceRestart:true});}
                    catch {this.status("Reconnection failed. Leave and reconnect from your appointment.");}
                },state==="failed" ? 500 : 4000);
            }
            this.status(state === "connected" ? "Connected" :
                state === "failed" ? "Connection failed. Reconnecting where possible; otherwise leave and reconnect from your appointment." :
                state === "disconnected" ? "Connection interrupted. Waiting to reconnect…" : "Connecting…");
        };
    }
    async receive(type, payload) {
        if (this.ended || !this.peer) return;
        const peer = this.peer;
        if (type === "offer") {
            await peer.setRemoteDescription(payload.offer);
            if (this.ended) return;
            await this.flushCandidates();
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            if (!this.ended) this.send("answer", {answer: peer.localDescription});
        } else if (type === "answer") {
            await peer.setRemoteDescription(payload.answer);
            await this.flushCandidates();
        } else if (type === "ice_candidate" && payload.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(payload.candidate);
            else this.candidates.push(payload.candidate);
        }
    }
    async offer(options) {
        if (this.ended || !this.peer) return;
        const peer = this.peer;
        this.offerer = true;
        const offer = await peer.createOffer(options);
        await peer.setLocalDescription(offer);
        if (!this.ended) this.send("offer", {offer: peer.localDescription});
    }
    async flushCandidates() {
        while (!this.ended && this.candidates.length)
            await this.peer.addIceCandidate(this.candidates.shift());
    }
    toggleMute() {
        this.muted = !this.muted;
        this.stream?.getAudioTracks().forEach(track => {track.enabled = !this.muted;});
        return this.muted;
    }
    toggleCamera() {
        this.cameraOff = !this.cameraOff;
        this.stream?.getVideoTracks().forEach(track => {track.enabled = !this.cameraOff;});
        return this.cameraOff;
    }
    end() {
        clearTimeout(this.restartTimer); this.restartTimer=null;
        this.ended = true; ++this.generation;
        this.stream?.getTracks().forEach(track => track.stop());
        if (this.peer) {
            this.peer.onicecandidate = null; this.peer.ontrack = null;
            this.peer.onconnectionstatechange = null; this.peer.close();
        }
        this.stream = null; this.peer = null; this.candidates = [];
        this.localVideo.srcObject = null; this.remoteVideo.srcObject = null;
    }
}
if (typeof module !== "undefined" && module.exports) module.exports = {TranquilCall};
else root.TranquilCall = TranquilCall;
})(typeof window !== "undefined" ? window : globalThis);
