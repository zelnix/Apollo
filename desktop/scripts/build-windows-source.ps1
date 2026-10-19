$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$native = Join-Path $root 'native\windows-wfp'
$build = Join-Path $native 'build'
cmake -S $native -B $build -A x64
cmake --build $build --config Release
$bin = Join-Path $root 'src-tauri\binaries'
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item -Force (Join-Path $build 'Release\apollo-wfp-service.exe') (Join-Path $bin 'apollo-wfp-service-x86_64-pc-windows-msvc.exe')
Push-Location $root
try {
  yarn web:export
  cargo tauri build --bundles nsis --config src-tauri/tauri.windows.conf.json
} finally { Pop-Location }