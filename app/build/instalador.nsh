; Trechos extras do instalador NSIS (incluídos pelo electron-builder).

; Ao desinstalar: tira o "iniciar junto com o computador" do registro. O
; Electron grava o valor com o nome do AppUserModelId (appId do
; electron-builder.yml = ID_DO_APP em main/index.ts); o Windows guarda também
; se o usuário o desativou no Gerenciador de Tarefas (StartupApproved).
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "br.dev.anselmorota.acessoremoto"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "br.dev.anselmorota.acessoremoto"
!macroend
