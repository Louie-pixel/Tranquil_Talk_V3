"use strict";
const $ = id => document.getElementById(id);
let account = null, registering = false, call = null, socket = null, creating = false;
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
    if (!response.ok) throw new Error(data.error || "The service is unavailable. Please try again.");
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
function signOut() {
    account = null;
    $("account-button").textContent = "Sign in";
    $("logout").hidden = true;
    $("publish-form").hidden = true;
    endCall();
}
function openAuth() {
    if (!$("auth-dialog").open) $("auth-dialog").showModal();
}
$("account-button").addEventListener("click", () => {
    if (!account) openAuth();
    else status("room-status", "Signed in. You can create a private room below.");
});
$("logout").addEventListener("click", signOut);
$("close-auth").addEventListener("click", () => $("auth-dialog").close());
$("switch-auth").addEventListener("click", () => {
    registering = !registering;
    $("auth-title").textContent = registering ? "A place to start." : "Welcome back.";
    $("auth-description").textContent = registering ? "Use a password of 12–72 bytes. Your email stays private." : "Sign in to create a private conversation room.";
    $("auth-submit").textContent = registering ? "Create account" : "Sign in";
    $("switch-auth").textContent = registering ? "Already have an account? Sign in" : "New here? Create an account";
    $("role-label").hidden = !registering;
    $("password").minLength = registering ? 12 : 1;
    $("password").autocomplete = registering ? "new-password" : "current-password";
    status("auth-status", "");
});
$("auth-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("auth-submit"); button.disabled = true;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    status("auth-status", registering ? "Creating account…" : "Signing in…");
    try {
        const data = await api(registering ? "/register" : "/login", {method: "POST", body: values});
        $("password").value = "";
        if (registering) {
            status("auth-status", data.message);
        } else {
            account = {...data, expiresAt: Date.now() + data.expiresIn * 1000};
            $("account-button").textContent = data.role === "expert" ? "Verified expert" : "Signed in";
            $("logout").hidden = false;
            $("publish-form").hidden = data.role !== "expert";
            $("auth-dialog").close();
            status("room-status", data.role === "expert_pending" ? "Signed in. Professional verification is still pending." : "You’re signed in. Create a private room whenever you’re ready.");
        }
    } catch (error) { status("auth-status", error.message, true); }
    finally { button.disabled = false; }
});
$("locate").addEventListener("click", () => {
    if (!navigator.geolocation) return status("clinic-status", "Location isn’t available. Enter coordinates instead.", true);
    $("locate").disabled = true; status("clinic-status", "Waiting for location permission…");
    navigator.geolocation.getCurrentPosition(position => {
        $("latitude").value = position.coords.latitude.toFixed(6);
        $("longitude").value = position.coords.longitude.toFixed(6);
        $("locate").disabled = false;
        status("clinic-status", "Location ready. Select a radius and search.");
    }, () => {
        $("locate").disabled = false;
        status("clinic-status", "Location could not be obtained. You can enter coordinates instead.", true);
    }, {enableHighAccuracy: false, timeout: 10000, maximumAge: 60000});
});
$("clinic-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    $("clinic-results").replaceChildren();
    status("clinic-status", "Searching nearby clinics…");
    try {
        const params = new URLSearchParams(new FormData(event.currentTarget));
        const clinics = await api("/clinics?" + params);
        if (!Array.isArray(clinics)) throw new Error("Unexpected clinic response. Please try again.");
        for (const clinic of clinics) {
            const coordinates = clinic.location?.coordinates;
            if (!Array.isArray(coordinates) || coordinates.length !== 2 ||
                !coordinates.every(Number.isFinite)) continue;
            const card = make("article", undefined, "clinic-card");
            card.append(make("h3", clinic.name), make("p", "Contact the clinic to confirm available mental health services."));
            const link = make("a", "Open directions ↗");
            link.href = "https://www.google.com/maps/dir/?api=1&destination=" +
                encodeURIComponent(coordinates[1] + "," + coordinates[0]);
            link.target = "_blank"; link.rel = "noopener noreferrer";
            card.append(link); $("clinic-results").append(card);
        }
        const count = $("clinic-results").childElementCount;
        status("clinic-status", count ? count + " clinic(s) found." : "No clinics listed within this radius. Try a wider search.");
        if (!count) $("clinic-results").append(make("p", "No matching clinics are currently listed.", "empty"));
    } catch (error) {
        status("clinic-status", error.message, true);
        $("clinic-results").append(make("p", "We couldn’t load clinics. Please try again.", "empty"));
    } finally { button.disabled = false; }
});
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
        status("join-status", "Preparing your devices…");
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
                    status("call-status", data.peers ? "Connecting…" : "Waiting for the other participant…");
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
        activeSocket.onerror = () => { clearTimeout(timeout); if (socket === activeSocket) endCall(false, "Couldn’t connect to the room. Please try again."); };
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
window.addEventListener("pagehide", () => endCall());
$("reflection").addEventListener("input", () => {
    const text = $("reflection").value.trim();
    $("reflection-count").textContent = (text ? text.split(/\s+/).length : 0) + " words";
});
$("clear-reflection").addEventListener("click", () => {
    $("reflection").value = ""; $("reflection").dispatchEvent(new Event("input")); $("reflection").focus();
});
async function loadBlogs() {
    status("blog-status", "Loading articles…");
    try {
        const articles = await api("/blogs");
        if (!Array.isArray(articles)) throw new Error("Unexpected article response.");
        $("blog-list").replaceChildren();
        for (const article of articles) {
            const details = make("details", undefined, "article");
            details.append(make("summary", article.title), make("p", "By " + article.author, "meta"), make("p", article.body, "body"));
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
                make("p", (Number.isNaN(date.getTime()) ? "Date to be confirmed" : date.toLocaleString()) + " · " + (event.location || "Location to be confirmed")));
            $("event-list").append(card);
        }
        status("event-status", events.length ? "" : "No upcoming events listed yet. Check back for community conversations and workshops.");
    } catch (error) { status("event-status", error.message, true); }
}
const invitation = new URLSearchParams(location.hash.slice(1)).get("invite");
if (invitation) {
    $("ticket").value = invitation;
    history.replaceState(null, "", location.pathname + location.search);
    $("connect").scrollIntoView();
    status("join-status", "Invitation ready. Choose audio or video, then enter when you’re comfortable.");
}
loadBlogs(); loadEvents();
