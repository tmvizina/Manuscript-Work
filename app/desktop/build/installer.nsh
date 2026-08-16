!include "LogicLib.nsh"

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
