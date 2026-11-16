"use strict";
const $ = id => document.getElementById(id);
let account = null, call = null, socket = null, creating = false, previewExploring = false, backendMode = "unknown";
const api = async (path, {method = "GET", body, authenticated = false} = {}) => {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (authenticated) {
        if (!account || Date.now() >= account.expiresAt) {
            signOut(); throw new Error("Please sign in again to continue.");
        }
        headers.Authorization = "Bearer " + account.token;
    }
    const response = await fetch("/api" + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
        credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || "The service is unavailable. Please try again.");
        error.status = response.status; throw error;
    }
    return data;
};
function status(id, message, error = false) {
    $(id).textContent = message;
    $(id).classList.toggle("error", error);
}
function make(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function renderAccount() {
    $("account-button").textContent = !account ? "Sign in" : account.role === "admin" ? "Administrator" :
        account.role === "expert" ? "Verified professional" : "Your account";
    $("logout").hidden = !account;
    $("publish-form").hidden = account?.role !== "expert";
    window.dispatchEvent(new CustomEvent("tranquil-account", {detail: account ? {id:account.id,role:account.role} : null}));
}
async function refreshAccount() {
    if (!account) return;
    const token = account.token;
    const identity = await api("/me", {authenticated:true});
    if (account?.token !== token) return;
    account = {...account,...identity};
    renderAccount();
}
function signOut() {
    account = null;
    renderAccount();
    endCall();
}
function openAuth() {
    previewExploring=false;
    for(const id of ["expert-dialog","booking-dialog"])if($(id)?.open)$(id).close();
    location.hash="signin";
}
$("account-button").addEventListener("click",()=>account ? location.hash="account" : openAuth());
$("logout").addEventListener("click",()=>{signOut();previewExploring=false;location.hash="signin";});
$("auth-form").addEventListener("submit",async event=>{
    event.preventDefault();const button=$("auth-submit");if(button.disabled)return;button.disabled=true;
    status("auth-status","Signing in...");
    try {
        const data=await api("/login",{method:"POST",body:Object.fromEntries(new FormData(event.currentTarget))});
        if(typeof data.token!=="string" || typeof data.id!=="string" || !Number.isFinite(data.expiresIn))
            throw new Error("The sign-in service is not available. Start the full application server.");
        account={...data,expiresAt:Date.now()+data.expiresIn*1000};$("password").value="";previewExploring=false;
        renderAccount();location.hash="home";status("auth-status","");
    }catch(error){status("auth-status",error.message,true);}finally{button.disabled=false;}
});
$("signup-form").addEventListener("submit",async event=>{
    event.preventDefault();const button=$("signup-submit");if(button.disabled)return;button.disabled=true;
    status("signup-status","Creating your account...");
    try {
        const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
        const data=await api("/register",{method:"POST",body:values});
        if(typeof data.message!=="string")throw new Error("Account creation is not available in this preview.");
        $("auth-form").elements.email.value=values.email;form.reset();location.hash="signin";
        status("auth-status","Your account is ready. Sign in to continue, then verify your email from Account.");
    }catch(error){status("signup-status",error.message,true);}finally{button.disabled=false;}
});
$("preview-interface").addEventListener("click",()=>{previewExploring=true;location.hash="home";});
async function checkServerMode(){
    try {const mode=await api("/status");if(mode.mode==="application"){backendMode="application";return;}}
    catch {if(!["localhost","127.0.0.1","::1"].includes(location.hostname)){backendMode="offline";return;}}
    backendMode="preview";
    $("preview-notice").hidden=false;$("preview-interface").hidden=false;
}
const backendReady=checkServerMode();
$("create-room").addEventListener("click", async () => {
    if (!account || Date.now() >= account.expiresAt) { signOut(); openAuth(); return; }
    $("create-room").disabled = true;
    try {
        const data = await api("/sessions", {method: "POST", authenticated: true});
        const invitation = location.origin + "/#invite=" + encodeURIComponent(data.ticket);
        $("invitation").value = invitation; $("ticket").value = invitation;
        $("invitation-panel").hidden = false;
        status("room-status", "Room created. Copy the invitation, share it privately, then enter below.");
    } catch (error) { status("room-status", error.message, true); }
    finally { $("create-room").disabled = false; }
});
$("copy-invitation").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("invitation").value); status("room-status", "Invitation copied."); }
    catch { $("invitation").select(); status("room-status", "Select and copy the invitation link manually."); }
});
function ticketFrom(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        const url = new URL(trimmed);
        if (url.origin !== location.origin) throw new Error("Use an invitation from this Tranquil Talk server.");
        return new URLSearchParams(url.hash.slice(1)).get("invite") || "";
    }
    return trimmed;
}
function send(type, payload = {}) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type, ...payload}));
}
function endCall(notify = true, message = "Conversation ended. Your microphone and camera are off.") {
    if (notify) send("hangup");
    if (socket) {
        socket.onmessage = null; socket.onclose = null; socket.onerror = null;
        socket.close(); socket = null;
    }
    call?.end(); call = null;
    $("call-panel").hidden = true; $("join-form").querySelector("button").disabled = false;
    status("join-status", message);
}
$("join-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (creating || call) return;
    creating = true;
    const button = event.currentTarget.querySelector("button"); button.disabled = true;
    const mode = document.querySelector('[name="mode"]:checked').value;
    try {
        const ticket = ticketFrom($("ticket").value);
        if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket) || ticket.length > 4096)
            throw new Error("Paste a valid invitation link or ticket.");
        status("join-status", "Preparing your devices.");
        $("call-panel").hidden = false;
        $("mute").textContent = "Mute microphone";
        $("camera").textContent = "Turn camera off"; $("camera").hidden = mode === "audio";
        call = new TranquilCall({send, status: message => status("call-status", message),
            localVideo: $("local-video"), remoteVideo: $("remote-video")});
        const activeCall = call;
        await activeCall.prepare(mode);
        if (call !== activeCall) return;
        const activeSocket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/rtc/signal");
        socket = activeSocket;
        const timeout = setTimeout(() => {
            if (socket === activeSocket) endCall(false, "Room connection timed out. Please try again.");
        }, 10000);
        activeSocket.onopen = () => send("join", {ticket});
        // Serialize signaling so early ICE and SDP cannot race each other.
        let queue = Promise.resolve();
        activeSocket.onmessage = event => {
            queue = queue.then(async () => {
                if (socket !== activeSocket) return;
                const data = JSON.parse(event.data);
                if (data.type === "error") throw new Error(data.error);
                if (data.type === "joined") {
                    clearTimeout(timeout);
                    status("join-status", "");
                    status("call-status", data.peers ? "Connecting." : "Waiting for the other participant.");
                    if (data.peers) await activeCall.offer();
                } else if (data.type === "peer_left" || data.type === "hangup") {
                    endCall(false, "The other participant left. Your microphone and camera are off.");
                } else if (["offer", "answer", "ice_candidate"].includes(data.type)) {
                    await activeCall.receive(data.type, data);
                }
            }).catch(error => {
                clearTimeout(timeout);
                if (socket === activeSocket) endCall(false, error.message || "The call could not connect.");
            });
        };
        activeSocket.onerror = () => { clearTimeout(timeout); if (socket === activeSocket) endCall(false, "Couldn't connect to the room. Please try again."); };
        activeSocket.onclose = () => { clearTimeout(timeout); if (socket === activeSocket) endCall(false, "Room closed or expired. Your devices are off."); };
    } catch (error) { endCall(false, error.message || "Device access was denied. Please try again."); }
    finally { creating = false; if (!call) button.disabled = false; }
});
$("hangup").addEventListener("click", () => endCall());
$("mute").addEventListener("click", () => {
    if (call) $("mute").textContent = call.toggleMute() ? "Unmute microphone" : "Mute microphone";
});
$("camera").addEventListener("click", () => {
    if (call) $("camera").textContent = call.toggleCamera() ? "Turn camera on" : "Turn camera off";
});
window.addEventListener("pagehide", () => {
    endCall();
    account = null;
    renderAccount();
    $("reflection").value = "";
    $("reflection-count").textContent = "0 words";
    $("ticket").value = "";
    $("invitation").value = "";
    $("invitation-panel").hidden = true;
    $("password").value = "";
});
window.addEventListener("pageshow", event => {
    if (event.persisted) signOut();
});
$("reflection").addEventListener("input", () => {
    const text = $("reflection").value.trim();
    $("reflection-count").textContent = (text ? text.split(/\s+/).length : 0) + " words";
});
$("clear-reflection").addEventListener("click", () => {
    $("reflection").value = ""; $("reflection").dispatchEvent(new Event("input")); $("reflection").focus();
});
async function loadBlogs() {
    status("blog-status", "Loading articles.");
    try {
        const articles = await api("/blogs");
        if (!Array.isArray(articles)) throw new Error("Unexpected article response.");
        $("blog-list").replaceChildren();
        for (const article of articles) {
            const details = make("details", undefined, "article");
            details.append(make("summary", article.title), make("p", "By " + article.author, "meta"), make("p", article.body, "body"));
            if(article._id?.$oid){const report=make("button","Report article","text-link small");report.type="button";
                report.addEventListener("click",()=>window.reportItem("article",article._id.$oid));details.append(report);}
            $("blog-list").append(details);
        }
        status("blog-status", articles.length ? "" : "No articles published yet. Verified professionals will be able to share their perspectives here.");
    } catch (error) { status("blog-status", error.message, true); }
}
$("refresh-blogs").addEventListener("click", loadBlogs);
$("publish-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button"); button.disabled = true;
    try {
        await api("/blogs", {method: "POST", body: Object.fromEntries(new FormData(form)), authenticated: true});
        form.reset(); status("publish-status", "Article published."); await loadBlogs();
    } catch (error) { status("publish-status", error.message, true); }
    finally { button.disabled = false; }
});
async function loadEvents() {
    try {
        const events = await api("/events");
        if (!Array.isArray(events)) throw new Error("Unexpected event response.");
        $("event-list").replaceChildren();
        for (const event of events) {
            const card = make("article", undefined, "event-card");
            const date = new Date(event.startsAt);
            card.append(make("h3", event.title), make("p", event.description),
                make("p", (Number.isNaN(date.getTime()) ? "Date to be confirmed" : date.toLocaleString()) + " � " + (event.location || "Location to be confirmed")));
            $("event-list").append(card);
        }
        status("event-status", events.length ? "" : "No upcoming events listed yet. Check back for community conversations and workshops.");
    } catch (error) { status("event-status", error.message, true); }
}
const invitation = new URLSearchParams(location.hash.slice(1)).get("invite");
if (invitation) {
    $("ticket").value = invitation;
    history.replaceState(null, "", location.pathname + location.search + "#connect");
    $("connect").scrollIntoView();
    status("join-status", "Invitation ready. Choose audio or video, then enter when you're comfortable.");
}
if(location.hash==="#register")history.replaceState(null,"",location.pathname+location.search+"#signup");
loadBlogs(); loadEvents();
