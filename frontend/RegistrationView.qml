import QtQuick
import QtQuick.Controls
import QtQuick.Layouts


ApplicationWindow {
    id: root
    visible: true
    title: "Tranquil Talk V3"
    width: 800
    height: 1000

    property string apiBase: "http://localhost:8080"

    signal registrationSucceeded(string email)
    signal backToLoginRequested()

    property bool busy: false
    property string errorText: ""

    function isValidEmail(address) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
    }

    function validate(){
        if (nameRegField.text.trim().length === 0) {
            errorText = "Please enter your full names"
            return false
        }
        if (!isValidEmail(emailRegField.text.trim())) {
            errorText = "Please enter a valid email address"
            return false
        }
        if (passwordRegField.text.length < 8) {
            errorText = "Password must be at least 8 characters"
            return false
        }
        if (passwordConfField.text !== passwordRegField.text) {
            errorText = "The two passwords do not match"
            return false
        }
        errorText = ""
        return true
    }

    function registerUser() {
        if(!validate())
            return

        busy = true
        errorText = ""

        var xhr = new XMLHttpRequest()
        xhr.open("POST", apiBase + "/api/register")
        xhr.setRequestHeader("Content-Type", "application/json")

        xhr.onreadystatechange = function(){
            if(xhr.readyState != XMLHttpRequest.DONE)
                return

            busy = false

            if(xhr.status === 200 || xhr.status ===201){
                root.registrationSucceeded(emailRegField.text.trim())
            }else {
                let message = "Failed registration! Please try again."
                try {
                    const body = JSON.parse(xhr.responseText)
                    if (body && body.message)
                       message = body.message
                } catch(e) {
                    
                }
                if (xhr.status === 409)
                    message = "An account with a similar email already exists"
                errorText = message
            }

        }

        xhr.onerror = function() {
            busy = false
            errorText = "Check your connection. could not reach the server"
        }

        xhr.send(JSON.stringify({
            name: nameRegField.text.trim(),
            email: emailRegField.text.trim(),
            phone: phoneRegField.text.trim(),
            password: passwordRegField.text
        }))
    }
    

    Rectangle {
        id: registrationComponent
        anchors.fill: parent
        color: "#f0f4f8"

        ScrollView {
            anchors.fill: parent
            contentWidth: availableWidth

            ColumnLayout {
                width: parent.width * 0.8
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: 20
                y: 24

                Text {
                    text: "Tranquil Talk"
                    font.pixelSize: 28
                    font.bold: true
                    Layout.alignment: Qt.AlignHCenter
                    color: "#1e293b"
                }

                Label{
                    text: "Create your account"
                    font.pixelSize: 24
                    font.bold: true
                    Layout.alignment: Qt.AlignHCenter
                }
                
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 5

                    Label{
                    text: "Full Names"
                    font.pixelSize: 12
                    color: "#444444"
                    Layout.alignment: Qt.AlignHCenter
                    }
                    
                    TextField {
                    id: nameRegField
                    placeholderText: "John Doe"
                    Layout.fillWidth: true
                    }

                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 5

                    Label{
                    text: "Email"
                    font.pixelSize: 12
                    color: "#444444"
                    Layout.alignment: Qt.AlignHCenter
                    }
                    
                    TextField {
                    id: emailRegField
                    placeholderText: "Johndoe@email.com"
                    Layout.fillWidth: true
                    }

                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 5

                    Label{
                    text: "Phone number"
                    font.pixelSize: 12
                    color: "#444444"
                    Layout.alignment: Qt.AlignHCenter
                    }
                    
                    TextField {
                    id: phoneRegField
                    placeholderText: "07xxxxxxxx"
                    inputMethodHints: Qt.ImhDialCharactersOnly
                    Layout.fillWidth: true
                    }

                }
                
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 5

                    Label{
                    text: "Password"
                    font.pixelSize: 12
                    color: "#444444"
                    Layout.alignment: Qt.AlignHCenter
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 5
                    
                        TextField {
                        id: passwordRegField
                        placeholderText: "Input at least 8 characters"
                        Layout.fillWidth: true
                        echoMode: showPassword.checked ? TextInput.Normal : TextInput.Password

                        }
                        ToolButton {
                            id: showPassword
                            checkable: true
                            text: checked ? "Hide" : "Show"
                        }

                    }              
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 5

                    Label{
                    text: "Confirm Password"
                    font.pixelSize: 12
                    color: "#444444"
                    Layout.alignment: Qt.AlignHCenter
                    }
                    
                    TextField {
                    id: passwordConfField
                    placeholderText: "Re-enter your pasword"
                    Layout.fillWidth: true
                    echoMode: showPassword.checked ? TextInput.Normal : TextInput.Password
                   
                    onAccepted: root.registerUser()
                    }
                              
                }

                Button {
                    Layout.fillWidth: true
                    Layout.topMargin: 5
                    text: root.busy ? "Creating account..." : "Create account"
                    enabled: !root.busy
                    highlighted: true
                    onClicked: root.registerUser()
                    
                    BusyIndicator{
                        visible: root.busy
                        running: root.busy
                        anchors.right: parent.right
                        anchors.rightMargin: 10
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    
                }

                RowLayout {
                    Layout.alignment: Qt.AlignHCenter
                    spacing: 4

                    Label{
                        text: "Already have an account?"
                        font.pixelSize: 12
                        color: "#666666"
                        
                    }
                     Label{
                        text: "Log in"
                        font.pixelSize: 12
                        color: "#666666"
                        
                        MouseArea {
                            anchors.fill: parent 
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.backToLoginRequested()
                        }
                    }
                }
            }

           
        }
    }

   
}