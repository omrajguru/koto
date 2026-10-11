# Generates every Windows icon and tile image from the brand artwork in app/assets/brand.
# Run after changing the artwork:
#
#   powershell -File app/windows/generate-icons.ps1
#
# Uses System.Drawing, which ships with Windows, so no extra tools are needed.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$appRoot = Split-Path $PSScriptRoot -Parent
$brand = Join-Path $appRoot 'assets\brand'
$images = Join-Path $PSScriptRoot 'Koto.Package\Images'
$nativeProject = Join-Path $PSScriptRoot 'Koto'
$interfaceAssets = Join-Path $appRoot 'src\interface\assets'

$appIcon = [System.Drawing.Image]::FromFile((Join-Path $brand 'koto-app-icon.png'))
$markOnDark = [System.Drawing.Image]::FromFile((Join-Path $brand 'koto-logomark-on-dark.png'))
$markOnLight = [System.Drawing.Image]::FromFile((Join-Path $brand 'koto-logomark-on-light.png'))
# The navy of the app icon, used behind the logomark on wide and splash images.
$brandNavy = [System.Drawing.Color]::FromArgb(255, 0x1F, 0x2A, 0x44)

function New-Canvas([int]$width, [int]$height) {
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

# Draws an image centred, scaled to fit `fraction` of the canvas's smaller side, keeping its aspect ratio.
function Add-Centred($canvas, $image, [double]$fraction) {
  $width = $canvas.Bitmap.Width
  $height = $canvas.Bitmap.Height
  $box = [Math]::Min($width, $height) * $fraction
  $scale = [Math]::Min($box / $image.Width, $box / $image.Height)
  $drawWidth = [int][Math]::Round($image.Width * $scale)
  $drawHeight = [int][Math]::Round($image.Height * $scale)
  $x = [int](($width - $drawWidth) / 2)
  $y = [int](($height - $drawHeight) / 2)
  $canvas.Graphics.DrawImage($image, $x, $y, $drawWidth, $drawHeight)
}

function Save-Canvas($canvas, [string]$path) {
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Bitmap.Dispose()
}

function Save-AppIcon([int]$size, [string]$path) {
  $canvas = New-Canvas $size $size
  Add-Centred $canvas $appIcon 1.0
  Save-Canvas $canvas $path
}

function Save-Banner([int]$width, [int]$height, [double]$markFraction, [string]$path) {
  $canvas = New-Canvas $width $height
  $canvas.Graphics.Clear($brandNavy)
  Add-Centred $canvas $markOnDark $markFraction
  Save-Canvas $canvas $path
}

Get-ChildItem $images -Filter '*.png' | Remove-Item

# Start menu, taskbar and Settings. Windows picks the closest size, so provide the common ones.
foreach ($scale in @(@{ Name = 'scale-100'; Size = 44 }, @{ Name = 'scale-200'; Size = 88 }, @{ Name = 'scale-400'; Size = 176 })) {
  Save-AppIcon $scale.Size (Join-Path $images "Square44x44Logo.$($scale.Name).png")
}
foreach ($size in 16, 24, 32, 48, 256) {
  Save-AppIcon $size (Join-Path $images "Square44x44Logo.targetsize-$size.png")
  # Taskbar in dark and light mode. The icon carries its own navy plate, so one image suits both.
  Save-AppIcon $size (Join-Path $images "Square44x44Logo.targetsize-$($size)_altform-unplated.png")
  Save-AppIcon $size (Join-Path $images "Square44x44Logo.targetsize-$($size)_altform-lightunplated.png")
}

# Tiles: the icon at two thirds of the tile, as Windows expects for tile padding.
foreach ($scale in @(@{ Name = 'scale-100'; Size = 150 }, @{ Name = 'scale-200'; Size = 300 })) {
  $canvas = New-Canvas $scale.Size $scale.Size
  Add-Centred $canvas $appIcon 0.66
  Save-Canvas $canvas (Join-Path $images "Square150x150Logo.$($scale.Name).png")
}
Save-Banner 310 150 0.6 (Join-Path $images 'Wide310x150Logo.scale-100.png')
Save-Banner 620 300 0.6 (Join-Path $images 'Wide310x150Logo.scale-200.png')
Save-Banner 1240 600 0.5 (Join-Path $images 'SplashScreen.scale-200.png')
Save-AppIcon 50 (Join-Path $images 'StoreLogo.png')

# Lock screen badge: the light logomark on transparent.
$canvas = New-Canvas 48 48
Add-Centred $canvas $markOnDark 0.9
Save-Canvas $canvas (Join-Path $images 'LockScreenLogo.scale-200.png')

# .ico files for the executable, window and tray icon. Each size is stored as PNG, which
# Windows supports in .ico files and keeps them small.
function Save-Ico([int[]]$sizes, [string]$path) {
  $entries = @()
  foreach ($size in $sizes) {
    $canvas = New-Canvas $size $size
    Add-Centred $canvas $appIcon 1.0
    $canvas.Graphics.Dispose()
    $stream = New-Object System.IO.MemoryStream
    $canvas.Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Bitmap.Dispose()
    $entries += @{ Size = $size; Bytes = $stream.ToArray() }
  }
  $file = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($file)
  $writer.Write([UInt16]0)               # reserved
  $writer.Write([UInt16]1)               # type: icon
  $writer.Write([UInt16]$entries.Count)
  $offset = 6 + 16 * $entries.Count
  foreach ($entry in $entries) {
    $dimension = if ($entry.Size -ge 256) { 0 } else { $entry.Size }
    $writer.Write([Byte]$dimension)      # width (0 means 256)
    $writer.Write([Byte]$dimension)      # height
    $writer.Write([Byte]0)               # palette size
    $writer.Write([Byte]0)               # reserved
    $writer.Write([UInt16]1)             # colour planes
    $writer.Write([UInt16]32)            # bits per pixel
    $writer.Write([UInt32]$entry.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $entry.Bytes.Length
  }
  foreach ($entry in $entries) {
    $writer.Write($entry.Bytes)
  }
  $writer.Flush()
  [System.IO.File]::WriteAllBytes($path, $file.ToArray())
  $writer.Dispose()
}
$icoSizes = 16, 20, 24, 32, 40, 48, 64, 96, 128, 256
Save-Ico $icoSizes (Join-Path $nativeProject 'Koto.ico')
Save-Ico $icoSizes (Join-Path $nativeProject 'small.ico')

# Logomarks used inside the app's own interface (sidebar), at 3x for sharpness. They are
# embedded in the JavaScript bundle as data URIs, so the bundle is a single file with no
# separate image assets to ship.
New-Item -ItemType Directory -Force $interfaceAssets | Out-Null
$embedded = @()
foreach ($variant in @(@{ Image = $markOnDark; Name = 'LOGOMARK_ON_DARK' }, @{ Image = $markOnLight; Name = 'LOGOMARK_ON_LIGHT' })) {
  $canvas = New-Canvas 72 90
  Add-Centred $canvas $variant.Image 1.0
  $canvas.Graphics.Dispose()
  $stream = New-Object System.IO.MemoryStream
  $canvas.Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Bitmap.Dispose()
  $embedded += "export const $($variant.Name) = 'data:image/png;base64,$([Convert]::ToBase64String($stream.ToArray()))';"
}
$header = '// Generated by app/windows/generate-icons.ps1 from app/assets/brand. Do not edit.'
Set-Content -Path (Join-Path $interfaceAssets 'logomarks.ts') -Value (@($header) + $embedded) -Encoding utf8

$appIcon.Dispose()
$markOnDark.Dispose()
$markOnLight.Dispose()
Write-Host 'Icons generated.'
