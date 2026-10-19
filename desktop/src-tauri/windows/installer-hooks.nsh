!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog 'sc.exe create ApolloProtectionService binPath= "$INSTDIR\apollo-wfp-service.exe" start= auto DisplayName= "Apollo Protection Service"'
  nsExec::ExecToLog 'sc.exe description ApolloProtectionService "Apollo outbound protection using Windows Filtering Platform."'
  nsExec::ExecToLog 'sc.exe start ApolloProtectionService'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'sc.exe stop ApolloProtectionService'
  nsExec::ExecToLog 'sc.exe delete ApolloProtectionService'
!macroend