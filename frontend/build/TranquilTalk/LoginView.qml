import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    visible: true
    width: 400
    height: 650
    title: "Tranquil Talk"
    color: "#f4f7f6" // Soft, calming background color

    // Listen to the C++ ApiClient signals
    Connections {
        target: apiClient
        
        function onLoginSuccess() {
            statusText.text = "Login successful! Connecting..."
            statusText.color = "#27ae60" // Green
            // TODO: Route to CallView.qml or Clinic Locator
        }
        
        function onLoginFailed(error) {
            statusText.text = error
            statusText.color = "#e74c3c" // Red
        }
    }

    ColumnLayout {
        anchors.centerIn: parent
        spacing: 24
        width: parent.width * 0.85

        Text {
            text: "Tranquil Talk"
            font.pixelSize: 32
            font.bold: true
            color: "#2c3e50"
            Layout.alignment: Qt.AlignHCenter
            Layout.bottomMargin: 20
        }

        TextField {
            id: emailInput
            placeholderText: "Email Address"
            font.pixelSize: 16
            Layout.fillWidth: true
            Layout.preferredHeight: 50
        }

        TextField {
            id: passwordInput
            placeholderText: "Password"
            font.pixelSize: 16
            echoMode: TextInput.Password // Hide characters
            Layout.fillWidth: true
            Layout.preferredHeight: 50
        }

        Button {
            text: "Sign In"
            font.pixelSize: 16
            font.bold: true
            Layout.fillWidth: true
            Layout.preferredHeight: 50
            
            onClicked: {
                if (emailInput.text === "" || passwordInput.text === "") {
                    statusText.text = "Please fill in all fields"
                    statusText.color = "#e74c3c"
                    return
                }
                
                statusText.text = "Authenticating..."
                statusText.color = "#7f8c8d"
                
                // Call the C++ slot
                apiClient.login(emailInput.text, passwordInput.text)
            }
        }

        Text {
            id: statusText
            text: ""
            font.pixelSize: 14
            Layout.alignment: Qt.AlignHCenter
        }
    }
}
