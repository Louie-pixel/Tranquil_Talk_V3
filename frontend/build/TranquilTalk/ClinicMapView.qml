import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtPositioning

Rectangle {
    id: clinicRoot
    anchors.fill: parent
    color: "#F1F5F9" // Modern slate background

    property var clinicList: []
    property double activeLat: 0.0
    property double activeLng: 0.0
    property bool coordsLocked: false
    property bool hasLocationPermission: false

    // 1. Hardware Positioning Source
    PositionSource {
        id: posSource
        updateInterval: 1000
        active: false
        onPositionChanged: {
            if (position.coordinate.isValid) {
                posSource.active = false;
                timeoutTimer.stop();
                activeLat = position.coordinate.latitude;
                activeLng = position.coordinate.longitude;
                coordsLocked = true;
                reverseGeocode(activeLat, activeLng); 
            }
        }
    }

    // 2. Fallback Timer for WSL environments without GPS hardware
    Timer {
        id: timeoutTimer
        interval: 4000
        repeat: false
        onTriggered: {
            posSource.active = false;
            detectLocationIP(); // Fallback to IP if no hardware GPS is found
        }
    }

    Timer {
        id: typingTimer
        interval: 400
        repeat: false
        onTriggered: fetchSuggestions(locationField.text)
    }

    function detectLocation() {
        if (!hasLocationPermission) {
            permissionDialog.open();
        } else {
            startHardwareDetection();
        }
    }

    function startHardwareDetection() {
        statusText.text = "Acquiring precise hardware GPS...";
        statusText.color = "#0369a1";
        posSource.active = true;
        timeoutTimer.restart();
    }

    // 3. Translate exact coordinates back to a building/street name
    function reverseGeocode(lat, lng) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "https://photon.komoot.io/reverse?lon=" + lng + "&lat=" + lat, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    if (response.features.length > 0) {
                        var props = response.features[0].properties;
                        var exactName = props.name || props.street || props.district || props.city || "Unknown Location";
                        if (props.city && props.city !== exactName) exactName += ", " + props.city;
                        
                        locationField.text = exactName;
                        statusText.text = "Precise location locked: " + exactName;
                        statusText.color = "#15803d";
                    }
                } catch(e) {
                    statusText.text = "Coordinates found, but failed to resolve address.";
                    statusText.color = "#0369a1";
                }
            }
        };
        xhr.send();
    }

    // 4. IP Fallback
    function detectLocationIP() {
        statusText.text = "GPS timeout. Using network location...";
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "http://ip-api.com/json/", true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    activeLat = response.lat;
                    activeLng = response.lon;
                    coordsLocked = true;
                    reverseGeocode(activeLat, activeLng);
                } catch (e) {
                    statusText.text = "Failed to parse network location.";
                    statusText.color = "#b91c1c";
                }
            }
        };
        xhr.send();
    }

    // 5. Autocomplete Suggestions
    function fetchSuggestions(query) {
        if (query.trim().length < 3) {
            suggestionPopup.close();
            return;
        }

        var url = "https://photon.komoot.io/api/?q=" + encodeURIComponent(query) + "&limit=5";
        if (activeLat !== 0.0 && activeLng !== 0.0) {
            url += "&lat=" + activeLat + "&lon=" + activeLng;
        }

        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    suggestionModel.clear();
                    
                    for (var i = 0; i < response.features.length; i++) {
                        var props = response.features[i].properties;
                        var coords = response.features[i].geometry.coordinates; 
                        
                        var displayName = props.name || "";
                        if (props.city && props.city !== props.name) displayName += ", " + props.city;
                        if (props.state) displayName += ", " + props.state;
                        
                        suggestionModel.append({
                            "display": displayName,
                            "lon": coords[0],
                            "lat": coords[1]
                        });
                    }
                    if (suggestionModel.count > 0 && locationField.focus) suggestionPopup.open();
                    else suggestionPopup.close();
                } catch (e) {}
            }
        };
        xhr.send();
    }

    // 6. Manual Search Resolver
    function resolveAndSearch() {
        if (locationField.text.trim() === "") {
            statusText.text = "Please enter a location or click Auto-Detect.";
            statusText.color = "#b91c1c";
            return;
        }

        if (coordsLocked) {
            fetchClinics(activeLat, activeLng, radiusField.currentText);
            return;
        }

        statusText.text = "Resolving address...";
        statusText.color = "#0369a1";

        var url = "https://photon.komoot.io/api/?q=" + encodeURIComponent(locationField.text) + "&limit=1";
        if (activeLat !== 0.0 && activeLng !== 0.0) url += "&lat=" + activeLat + "&lon=" + activeLng;

        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    if (response.features.length > 0) {
                        var coords = response.features[0].geometry.coordinates;
                        activeLat = parseFloat(coords[1]);
                        activeLng = parseFloat(coords[0]);
                        coordsLocked = true;
                        fetchClinics(activeLat, activeLng, radiusField.currentText);
                    } else {
                        statusText.text = "Address not found. Try a broader search.";
                        statusText.color = "#b91c1c";
                    }
                } catch (e) {}
            }
        };
        xhr.send();
    }

    // 7. Drogon Backend Integration
    function fetchClinics(lat, lng, radius) {
        statusText.text = "Searching clinics near [" + lat.toFixed(4) + ", " + lng.toFixed(4) + "]...";
        var xhr = new XMLHttpRequest();
        var url = "http://localhost:8080/api/clinics?lat=" + lat + "&lng=" + lng + "&radius=" + radius;
        
        xhr.open("GET", url, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                if (xhr.status === 200) {
                    try {
                        var jsonResult = JSON.parse(xhr.responseText);
                        clinicList = jsonResult;
                        statusText.text = "Found " + clinicList.length + " nearby clinic(s).";
                        statusText.color = "#15803d";
                    } catch (e) {}
                } else {
                    statusText.text = "Server error: " + xhr.status;
                    statusText.color = "#b91c1c";
                }
            }
        };
        xhr.send();
    }

    // --- UI LAYOUT ---

    // Modern Location Permission Modal
    Dialog {
        id: permissionDialog
        x: Math.round((parent.width - width) / 2)
        y: Math.round((parent.height - height) / 2) - 40
        width: Math.min(320, parent.width - 60)
        modal: true
        focus: true
        closePolicy: Popup.NoAutoClose
        
        background: Rectangle {
            color: "#ffffff"
            radius: 16
            border.color: "#e2e8f0"
            border.width: 1
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 20
            spacing: 16

            Text {
                text: "📍 Location Access"
                font.pixelSize: 18
                font.bold: true
                color: "#0f172a"
                Layout.alignment: Qt.AlignHCenter
            }

            Text {
                text: "Tranquil Talk needs access to your precise device location to find clinics exactly where you are."
                font.pixelSize: 14
                color: "#475569"
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                lineHeight: 1.2
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 12
                Layout.topMargin: 8

                Button {
                    text: "Deny"
                    Layout.fillWidth: true
                    Layout.preferredHeight: 40
                    background: Rectangle {
                        color: parent.pressed ? "#e2e8f0" : (parent.hovered ? "#f1f5f9" : "#ffffff")
                        border.color: "#cbd5e1"
                        border.width: 1
                        radius: 8
                    }
                    contentItem: Text {
                        text: parent.text
                        color: "#64748b"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.bold: true
                    }
                    onClicked: {
                        permissionDialog.close();
                        statusText.text = "Location access denied.";
                        statusText.color = "#b91c1c";
                    }
                }

                Button {
                    text: "Allow"
                    Layout.fillWidth: true
                    Layout.preferredHeight: 40
                    background: Rectangle {
                        color: parent.pressed ? "#1d4ed8" : (parent.hovered ? "#2563eb" : "#3b82f6")
                        radius: 8
                    }
                    contentItem: Text {
                        text: parent.text
                        color: "white"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.bold: true
                    }
                    onClicked: {
                        permissionDialog.close();
                        hasLocationPermission = true;
                        startHardwareDetection();
                    }
                }
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 20

        Text {
            text: "Tranquil Talk"
            font.pixelSize: 28
            font.bold: true
            color: "#0f172a"
            Layout.alignment: Qt.AlignHCenter
            
            Text {
                text: "Clinic Locator"
                font.pixelSize: 14
                color: "#64748b"
                anchors.top: parent.bottom
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.topMargin: 2
            }
        }

        // Elevated Search Container
        Rectangle {
            Layout.fillWidth: true
            Layout.topMargin: 15
            height: searchLayout.implicitHeight + 40
            color: "#ffffff"
            radius: 16
            border.color: "#e2e8f0"
            border.width: 1

            ColumnLayout {
                id: searchLayout
                anchors.fill: parent
                anchors.margins: 20
                spacing: 16

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    Item {
                        Layout.fillWidth: true
                        height: locationField.height

                        TextField {
                            id: locationField
                            anchors.fill: parent
                            placeholderText: "Enter location (e.g., TuksVillage)"
                            font.pixelSize: 14
                            background: Rectangle {
                                color: "#f8fafc"
                                border.color: locationField.activeFocus ? "#3b82f6" : "#cbd5e1"
                                border.width: locationField.activeFocus ? 2 : 1
                                radius: 8
                            }
                            padding: 12
                            
                            onTextChanged: {
                                coordsLocked = false;
                                if (focus) typingTimer.restart();
                            }
                        }

                        Popup {
                            id: suggestionPopup
                            y: locationField.height + 4
                            width: locationField.width
                            height: Math.min(250, suggestionModel.count * 45)
                            padding: 0
                            
                            background: Rectangle {
                                color: "white"
                                border.color: "#e2e8f0"
                                radius: 8
                            }

                            ListView {
                                anchors.fill: parent
                                clip: true
                                model: ListModel { id: suggestionModel }
                                
                                delegate: ItemDelegate {
                                    width: parent.width
                                    height: 45
                                    
                                    contentItem: Text {
                                        text: model.display
                                        font.pixelSize: 13
                                        color: "#334155"
                                        elide: Text.ElideRight
                                        verticalAlignment: Text.AlignVCenter
                                    }

                                    background: Rectangle {
                                        color: parent.hovered ? "#f1f5f9" : "transparent"
                                        radius: 8
                                    }
                                    
                                    onClicked: {
                                        locationField.text = model.display;
                                        activeLat = model.lat;
                                        activeLng = model.lon;
                                        coordsLocked = true;
                                        suggestionPopup.close();
                                    }
                                }
                            }
                        }
                    }

                    Button {
                        text: "📍 Auto-Detect"
                        font.pixelSize: 13
                        font.bold: true
                        Layout.preferredHeight: locationField.height
                        background: Rectangle {
                            color: parent.pressed ? "#e2e8f0" : (parent.hovered ? "#f1f5f9" : "#ffffff")
                            border.color: "#cbd5e1"
                            border.width: 1
                            radius: 8
                        }
                        contentItem: Text {
                            text: parent.text
                            color: "#334155"
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                            font.bold: true
                        }
                        onClicked: detectLocation()
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12
                    
                    Label { 
                        text: "Search Radius:" 
                        font.pixelSize: 14
                        color: "#475569"
                    }
                    ComboBox {
                        id: radiusField
                        model: ["1000", "5000", "10000", "25000"]
                        currentIndex: 1 
                        Layout.preferredWidth: 120 
                        font.pixelSize: 14
                    }
                    Label { 
                        text: "meters" 
                        font.pixelSize: 14
                        color: "#475569"
                    }
                }

                Button {
                    text: "Search Nearby Clinics"
                    Layout.fillWidth: true
                    Layout.preferredHeight: 48
                    font.pixelSize: 15
                    font.bold: true
                    contentItem: Text {
                        text: parent.text
                        color: "white"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.bold: true
                    }
                    background: Rectangle {
                        color: parent.pressed ? "#1e40af" : (parent.hovered ? "#2563eb" : "#3b82f6")
                        radius: 12
                    }
                    onClicked: resolveAndSearch()
                }
            }
        }

        Text {
            id: statusText
            text: "Ready to search."
            font.pixelSize: 13
            Layout.alignment: Qt.AlignHCenter
            color: "#64748b"
        }

        ListView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            model: clinicList
            spacing: 12

            delegate: Rectangle {
                width: parent.width
                height: 90
                color: "#ffffff"
                border.color: "#e2e8f0"
                border.width: 1
                radius: 12

                // Unique Blue Accent Strip on the Card
                Rectangle {
                    width: 4
                    height: parent.height - 24
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#3b82f6"
                    radius: 2
                    anchors.leftMargin: 12
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 16
                    anchors.leftMargin: 28
                    spacing: 16

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 6

                        Text {
                            text: modelData.name || "Unknown Clinic"
                            font.bold: true
                            font.pixelSize: 16
                            color: "#0f172a"
                        }
                        Text {
                            text: "Coordinates: [" + modelData.location.coordinates[1].toFixed(4) + ", " + modelData.location.coordinates[0].toFixed(4) + "]"
                            font.pixelSize: 12
                            color: "#64748b"
                        }
                    }

                    Button {
                        text: "Route"
                        Layout.alignment: Qt.AlignVCenter
                        Layout.preferredHeight: 36
                        font.pixelSize: 13
                        font.bold: true
                        background: Rectangle {
                            color: parent.pressed ? "#dcfce7" : (parent.hovered ? "#f0fdf4" : "#ffffff")
                            border.color: "#86efac"
                            border.width: 1
                            radius: 6
                        }
                        contentItem: Text {
                            text: parent.text
                            color: "#166534"
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                            font.bold: true
                        }
                        onClicked: {
                            var lat = modelData.location.coordinates[1];
                            var lng = modelData.location.coordinates[0];
                            var url = "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng;
                            Qt.openUrlExternally(url);
                        }
                    }
                }
            }
        }
    }
}