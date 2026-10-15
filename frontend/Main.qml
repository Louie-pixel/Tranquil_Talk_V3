import Qt Quick 
import Qt Quick.Controls
import Qt Quick.Layouts


ApplicationWindow {
    id: mainWindow
    width: 640
    height: 480
    visible: true
    title: qsTr("TranquilTalk V3")
    color: surface
   
    //session management properties
    property string authToken: ""
    property string userEmail: ""
    readonly property bool loggedIn: authToken !== ""
   
    // Loader to switch between Login and the Clinic Map
    propperty string currentPage:""

    //pallete colors
    readonly property color ink: "#1e293b"
    readonly property color surface: "#f1f5f9"
    readonly property color accent: "#2dd4cf"
    readonly property color muted:"#64748b"

    //Navigation functions
    function navigate(page) {
        currentPage = page
        if ((page === "clinics" || page === "call") && !loggedIn) 
            page = "login"
        if (page === currentPage)
            return

        var pages = {
            "login": loginComponent,
            "register": registrationComponent,
            "clinics": clinicMapComponent,
            "call": videoCallComponent
        }

        stack.replace(null, pages[page])
        currentPage = page
        
    }

    function showNotice(message) {
        banner.text = message
        banner.visible = true
        bannerTimer.restart()
    }

    function signIn(token, email) {
        authToken = token
        userEmail = email
        navigate("clinics")
    }

    function signOut() {
        authToken = ""
        userEmail = ""
        navigate("login")
    }

    function loadVideoCall() {
        navigate("call")
    }

    Component.onCompleted: navigate("login")

    Component BarButton: ToolButton {
        id:controlBar
        contentItem: Label{
            text: control.text
            color: white
            font.pixelSize: 14
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    header: ToolBar{
        visible: mainWindow.loggedIn
        background: Rectangle {color: mainWindow.ink}

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            anchors.rightMargin: 8
            spacing: 5

            BarButton {
                visible: mainWindow.currentPage === "call"
                text: qsTr("Back to clinics")
                onClicked: mainWindow.navigate("clinics")
            }

            label {
                text: qsTr("Tranquil Talk V3")
                color: white
                font.pixelSize: 15
                font.bold: true
                layout.fillWidth: true
                layout.leftMargin: 8
                elide: Text.ElideRight
            }

            BarButton {
                text: qsTr("Sign Out")
                onClicked: mainWindow.signOut()
            }
        }
    }

//pages
    StackView {
        id: stack
        anchors.fill: parent

        replaceEnter: Transition {
            NumberAnimation {property: "opacity"; from: 0; to: 1; duration: 150}
        }
        replaceExit: Transition {
            NumberAnimation {property: "opacity"; from: 1; to: 0; duration: 150}
        }
    }

    Component {
        id:loginPage
        LoginView {
            onLoginSuceeded: function (token, email) {
                mainWindow.signIn(token, email)
            }
            onRegisterRequested: function () {
                mainWindow.navigate("register")
            }
        }
    }
    
    Component {
        id:registrationPage
        RegistrationView {
            onRegistrationSuceeded: function (email) {
                mainWindow.navigate("login")
                mainWindow.showNotice(qsTr("Registration was successful! Please log in."))
            }
            onBackToLoginRequested: function () {
                mainWindow.navigate("login")
            }
        }
    }

    Component{
        id: clinicsPage
        ClinicMapView { } 
    }
    
    Component {
        id: videoCallPage
        Item{
            //video call view will be loaded via url
            Loader {
                id: videoCallLoader
                anchors.fill: parent
                source: "VideoCallView.qml"
            }

            ColumnLayout {
                visible: videoCallLoader.status !== Loader.Ready
                anchors.centerIn: parent
                width: parent.width * 0.8
                spacing: 14

                Label {
                    text: qsTr("Loading video call...")
                    font.pixelSize: 18
                    font.bold: true
                    wrapMode: Text.WordWrap
                    color: mainWindow.ink
                    horizontalAlignment: Text.AlignHCenter
                    Layout.fillWidth: true
                }
                Button {
                    text: qsTr("Back to clinics")
                    Layout.alignment: Qt.AlignHCenter
                    onClicked: mainWindow.navigate("clinics")
                }
            }
        }
    }
    
    // Notice banner
    Rectangle {
        id: banner
        property alias text: bannerLabel.text
        visible: false
        z: 10
        anchors.top: parent.top
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.topMargin: 10
        width: Math.min(parent.width * 0.8, 400)
        height: bannerLabel.implicitHeight + 20
        radius: 6
        color: mainWindow.ink
       
       Label {
        id: bannerLabel
        anchors.fill: parent
        anchors.margins: 10
        color: "white"
        WrapMode: Text.WordWrap
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
       }

        MouseArea {
            anchors.fill: parent
            onClicked: banner.visible = false
        }

        Timer {
            id: bannerTimer
            interval: 4000
            onTriggered: banner.visible = false
        }
    }
}