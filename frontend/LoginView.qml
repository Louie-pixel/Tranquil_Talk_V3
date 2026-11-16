import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtWebEngine

ApplicationWindow {
    id: window
    width: 1280
    height: 850
    minimumWidth: 400
    minimumHeight: 600
    visible: true
    title: "Tranquil Talk — Speak freely, Heal quietly"

    WebEngineView {
        id: browser
        anchors.fill: parent
        url: backendUrl
        onFeaturePermissionRequested: function(origin, feature) {
            if (origin.toString().replace(/\/$/, "") !== backendUrl.toString().replace(/\/$/, "")) {
                browser.grantFeaturePermission(origin, feature, false);
                return;
            }
            permissionDialog.origin = origin;
            permissionDialog.feature = feature;
            permissionDialog.open();
        }
        onNavigationRequested: function(request) {
            var target = request.url.toString();
            var base = backendUrl.toString().replace(/\/$/, "");
            if (target === base || target.startsWith(base + "/") || target === "about:blank") return;
            request.action = WebEngineNavigationRequest.IgnoreRequest;
            if (target.startsWith("https://")) Qt.openUrlExternally(request.url);
        }
    }
    Dialog {
        id: permissionDialog
        property url origin
        property int feature
        anchors.centerIn: parent
        title: "Device access"
        modal: true
        standardButtons: Dialog.Yes | Dialog.No
        Label { text: "Allow this page to use the requested camera, microphone or location?"; wrapMode: Text.WordWrap; width: 300 }
        onAccepted: browser.grantFeaturePermission(origin, feature, true)
        onRejected: browser.grantFeaturePermission(origin, feature, false)
    }
}
