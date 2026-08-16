!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; The uninstaller deliberately defaults to preserving Electron's userData
; directory.  The checkbox on the uninstaller welcome page is the explicit
; opt-in for removing local settings, the database, logs, and remembered
; project roots.  Keep this separate from electron-builder's
; --delete-app-data escape hatch so silent uninstall/reinstall remains safe.
!ifdef BUILD_UNINSTALLER
Var /GLOBAL unDeleteUserData
Var unDeleteUserDataCheckbox

Function un.CreateDataChoicePage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 34u "Book Writer stores its database, logs, settings, and remembered project locations in your Windows user-data folder."
  Pop $0
  ${NSD_CreateLabel} 0 40u 100% 28u "By default those files stay on this computer so a reinstall or later install can recover your work."
  Pop $0
  ${NSD_CreateCheckbox} 0 76u 100% 18u "Remove all local Book Writer data"
  Pop $unDeleteUserDataCheckbox
  ; Never preselect a destructive action, including when the user navigates
  ; back to this page from the confirmation page.
  ${NSD_Uncheck} $unDeleteUserDataCheckbox

  nsDialogs::Show
FunctionEnd

Function un.LeaveDataChoicePage
  ${NSD_GetState} $unDeleteUserDataCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $unDeleteUserData "1"
  ${Else}
    StrCpy $unDeleteUserData "0"
  ${EndIf}
FunctionEnd

!macro customUnWelcomePage
  ; This page runs before the uninstall section, allowing the explicit choice
  ; to be applied before the installed files and user data are removed.
  UninstPage custom un.CreateDataChoicePage un.LeaveDataChoicePage
!macroend

!macro customUnInstall
  ${If} $unDeleteUserData == "1"
    ; Keep the same locations as electron-builder's built-in
    ; --delete-app-data path.  This build is per-user, but preserve the mode
    ; switch so a future all-users build does not accidentally target the
    ; installer's elevation context.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}

    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif

    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${EndIf}
!macroend
!endif

; Advisory first-launch hint only. The application always repeats discovery in
; the main process and never trusts this marker for an executable path.
!macro customInstall
  CreateDirectory "$APPDATA\Book Writer"

  nsExec::ExecToStack '"$SYSDIR\where.exe" claude'
  Pop $0
  Pop $1
  ${If} $0 == 0
    WriteINIStr "$APPDATA\Book Writer\installer-provider-detection.ini" "providers" "claude" "1"
  ${Else}
    WriteINIStr "$APPDATA\Book Writer\installer-provider-detection.ini" "providers" "claude" "0"
  ${EndIf}

  nsExec::ExecToStack '"$SYSDIR\where.exe" codex'
  Pop $0
  Pop $1
  ${If} $0 == 0
    WriteINIStr "$APPDATA\Book Writer\installer-provider-detection.ini" "providers" "codex" "1"
  ${Else}
    WriteINIStr "$APPDATA\Book Writer\installer-provider-detection.ini" "providers" "codex" "0"
  ${EndIf}
!macroend
