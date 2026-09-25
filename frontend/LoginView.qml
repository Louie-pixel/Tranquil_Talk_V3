import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    id: mainWindow
    visible: true
    width: 450
    height: 650
    title: "Tranquil Talk V3"

    // Loader to switch between Login and the Clinic Map
    Loader {
        id: viewLoader
        anchors.fill: parent
        sourceComponent: loginComponent
    }

    Component {
        id: loginComponent
        Item {
            anchors.fill: parent

            ColumnLayout {
                anchors.centerIn: parent
                width: parent.width * 0.8
                spacing: 20

                Text {
                    text: "Tranquil Talk"
                    font.pixelSize: 28
                    font.bold: true
                    Layout.alignment: Qt.AlignHCenter
                    color: "#1e293b"
                }

                TextField {
                    id: emailField
                    placeholderText: "Email"
                    text: "test@tranquiltalk.com"
                    Layout.fillWidth: true
                    height: 45
                }

                TextField {
                    id: passwordField
                    placeholderText: "Password"
                    text: "mysecurepassword"
                    echoMode: TextInput.Password
                    Layout.fillWidth: true
                    height: 45
                }

                Button {
                    text: "Sign In"
                    Layout.fillWidth: true
                    height: 45
                    onClicked: {
                        statusText.text = "Authenticating...";
                        statusText.color = "blue";
                        
                        var xhr = new XMLHttpRequest();
                        xhr.open("POST", "http://localhost:8080/api/login", true);
                        xhr.setRequestHeader("Content-Type", "application/json");
                        
                        xhr.onreadystatechange = function() {
                            if (xhr.readyState === XMLHttpRequest.DONE) {
                                if (xhr.status === 200) {
                                    statusText.text = "Login successful! Loading Clinic Locator...";
                                    statusText.color = "green";
                                    
                                    // Switch view to Clinic Map after a brief pause
                                    loadTimer.start();
                                } else {
                                    statusText.text = "Login failed: " + xhr.status;
                                    statusText.color = "red";
                                }
                            }
                        };
                        
                        var payload = JSON.stringify({
                            email: emailField.text,
                            password: passwordField.text
                        });
                        xhr.send(payload);
                    }
                }

                Text {
                    id: statusText
                    text: ""
                    font.pixelSize: 14
                    Layout.alignment: Qt.AlignHCenter
                }
            }

            Timer {
                id: loadTimer
                interval: 800
                repeat: false
                onTriggered: {
                    viewLoader.sourceComponent = clinicMapComponent;
                }
            }
        }
    }

    Component {
        id: clinicMapComponent
        ClinicMapView {
            anchors.fill: parent
        }
    }
}
