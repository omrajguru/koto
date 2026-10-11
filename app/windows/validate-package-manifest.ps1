# Validates Koto.Package/Package.appxmanifest with MakeAppx, the same tool the build uses,
# without compiling the app. Run it before pushing manifest changes so CI does not fail on them.
#
#   pwsh app/windows/validate-package-manifest.ps1
#
# Needs only the Windows SDK (MakeAppx), not Visual Studio.

$ErrorActionPreference = 'Stop'
$packageDirectory = Join-Path $PSScriptRoot 'Koto.Package'

$makeAppx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\*\makeappx.exe" |
  Where-Object { $_.Directory.Name -eq ($env:PROCESSOR_ARCHITECTURE -replace 'AMD64', 'x64').ToLower() } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeAppx) {
  throw 'MakeAppx was not found. Install the Windows SDK.'
}

$layout = Join-Path ([System.IO.Path]::GetTempPath()) ("koto-manifest-check-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $layout | Out-Null
try {
  # Mirror the packaged layout: images, and the executable in a Koto folder.
  Copy-Item (Join-Path $packageDirectory 'Images') $layout -Recurse
  New-Item -ItemType Directory -Path (Join-Path $layout 'Koto') | Out-Null
  Copy-Item "$env:WINDIR\System32\cmd.exe" (Join-Path $layout 'Koto\Koto.exe')

  # Images are referenced without their scale suffix; MakeAppx needs the plain names to exist.
  Get-ChildItem (Join-Path $layout 'Images') -Filter '*.scale-200.png' | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $_.DirectoryName ($_.Name -replace '\.scale-200', ''))
  }
  Get-ChildItem (Join-Path $layout 'Images') -Filter '*.targetsize-24_altform-unplated.png' | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $_.DirectoryName ($_.Name -replace '\.targetsize-24_altform-unplated', ''))
  }

  # Substitute the values the build fills in.
  $manifest = Get-Content (Join-Path $packageDirectory 'Package.appxmanifest') -Raw
  $manifest = $manifest.Replace('$targetnametoken$.exe', 'Koto\Koto.exe')
  $manifest = $manifest.Replace('$targetentrypoint$', 'Windows.FullTrustApplication')
  $manifest = $manifest.Replace('Language="x-generate"', 'Language="en-us"')
  Set-Content -Path (Join-Path $layout 'AppxManifest.xml') -Value $manifest -Encoding utf8

  $output = Join-Path $layout 'check.msix'
  & $makeAppx.FullName pack /d $layout /p $output /o 2>&1 | Write-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Package manifest is not valid (MakeAppx exit code $LASTEXITCODE)."
  }
  Write-Host 'Package manifest is valid.'
} finally {
  Remove-Item -LiteralPath $layout -Recurse -Force
}
