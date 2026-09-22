param([Parameter(Mandatory=$true)][string]$Binary)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator approval is required.' }
$root = Join-Path $env:ProgramFiles 'Apollo'
New-Item -ItemType Directory -Force $root | Out-Null
$target = Join-Path $root 'apollo-wfp-service.exe'
Copy-Item -Force $Binary $target
if (Get-Service ApolloProtectionService -ErrorAction SilentlyContinue) { Stop-Service ApolloProtectionService -ErrorAction SilentlyContinue; sc.exe delete ApolloProtectionService | Out-Null }
sc.exe create ApolloProtectionService binPath= ('"' + $target + '"') start= auto DisplayName= 'Apollo Protection Service' | Out-Null
sc.exe description ApolloProtectionService 'Apollo outbound protection using Windows Filtering Platform.' | Out-Null
Start-Service ApolloProtectionService