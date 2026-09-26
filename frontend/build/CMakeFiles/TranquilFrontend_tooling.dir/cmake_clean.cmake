file(REMOVE_RECURSE
  "TranquilTalk/ClinicMapView.qml"
  "TranquilTalk/LoginView.qml"
  "TranquilTalk/VideoCallView.qml"
)

# Per-language clean rules from dependency scanning.
foreach(lang )
  include(CMakeFiles/TranquilFrontend_tooling.dir/cmake_clean_${lang}.cmake OPTIONAL)
endforeach()
