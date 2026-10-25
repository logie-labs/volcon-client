; Volcon's additions to the installer Tauri generates.

; Uninstalling takes Volcon out of Windows' Startup apps, so nothing is left
; behind there. Volcon remembers whether it was switched on in its own data, so
; a reinstall - or the new version an upgrade puts straight back - lists it
; again the same way. An update installs over Volcon without uninstalling it,
; and leaves the listing alone.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
!macroend
