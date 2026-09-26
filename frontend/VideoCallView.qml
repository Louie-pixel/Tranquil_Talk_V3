import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtWebEngine
import TranquilTalk.WebRTC 1.0

Rectangle {
    id: callRoot
    anchors.fill: parent
    color: "#0f172a" 

    WebRTCClient {
        id: callSignalingClient
        
        Component.onCompleted: {
            // Join the routing session immediately when the view opens
            callSignalingClient.connectToRoom("clinic_room_101");
        }

        // C++ WebSocket -> QML -> JavaScript
        onIncomingSignal: (actionType, payload) => {
            var jsonString = JSON.stringify(payload);
            var jsInjection = `if (typeof receiveRemoteSignal === 'function') { receiveRemoteSignal('${actionType}', ${jsonString}); }`;
            rtcEngine.runJavaScript(jsInjection);
        }
    }

    WebEngineView {
        id: rtcEngine
        anchors.fill: parent
        backgroundColor: "#1e293b"
        url: "file:///mnt/c/users/louie/Tranquil_Talk_V3/frontend/index.html"
        
        onFeaturePermissionRequested: function(securityOrigin, feature) {
            if (feature === WebEngineView.MediaVideoCapture || feature === WebEngineView.MediaAudioCapture) {
                rtcEngine.grantFeaturePermission(securityOrigin, feature, true);
            }
        }

        // ADD THIS: Route embedded browser logs directly to your Ubuntu terminal
        onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID) {
            console.log("[Browser JS] " + message);
        }

        onNavigationRequested: function(request) {
            var urlStr = request.url.toString();
            // ADD THIS: Log every time the browser tries to change URLs
            console.log("[QML Intercept] Browser navigating to: " + urlStr.substring(0, 50) + "..."); 
            
            if (urlStr.startsWith("rtcsignal:")) {
                request.action = WebEngineNavigationRequest.IgnoreRequest;
                var dataStr = decodeURIComponent(urlStr.substring(10));
                var msg = JSON.parse(dataStr);
                callSignalingClient.sendSignal(msg.type, msg.payload);
            }
        }
    }
    RowLayout {
        id: controlsRow
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: 40
        spacing: 24

        Button {
            text: "📡 Start Call"
            font.bold: true
            Layout.preferredWidth: 120
            Layout.preferredHeight: 50
            background: Rectangle {
                color: parent.pressed ? "#166534" : "#15803d"
                radius: 25
            }
            contentItem: Text {
                text: parent.text
                color: "white"
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                font.bold: true
            }
            onClicked: {
                console.log("[QML] Start Call clicked. Injecting WebRTC script...");
                rtcEngine.runJavaScript(`
                    try {
                        console.log("Script execution started.");
                        if (!peerConnection) createPeerConnection();
                        
                        peerConnection.createOffer()
                            .then(offer => {
                                console.log("Offer generated successfully!");
                                return peerConnection.setLocalDescription(offer).then(() => {
                                    sendSignalToQML('offer', { offer: offer });
                                });
                            })
                            .catch(err => console.error("WebRTC Offer Error: " + err));
                    } catch (fatalErr) {
                        console.error("Fatal JS Error: " + fatalErr.message);
                    }
                `);
            }
        }

        Button {
            text: "📞 End Call"
            font.bold: true
            Layout.preferredWidth: 120
            Layout.preferredHeight: 50
            background: Rectangle {
                color: parent.pressed ? "#b91c1c" : "#ef4444"
                radius: 25
            }
            contentItem: Text {
                text: parent.text
                color: "white"
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                font.bold: true
            }
        }
    }
}