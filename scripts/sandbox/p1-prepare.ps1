# Docs: docs/code/scripts/sandbox.md
# Runs inside Windows Sandbox for the clean-setup scenario P1 (A43, J0): downloads Tessera at the
# commit p1.ps1 chose, installs the Node version its .nvmrc names, installs and builds Tessera,
# and puts a Tessera shortcut on the desktop. It never installs Claude Code or Codex: the tester
# follows Tessera's setup check for those. Windows PowerShell 5.1.
param(
  # Where Tessera goes; the mapped folder is read-only.
  [string]$Target = "C:\Tessera"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$here = $PSScriptRoot
$commit = (Get-Content (Join-Path $here "commit.txt") -Raw).Trim()
$work = Join-Path $env:TEMP "p1"
New-Item -ItemType Directory -Force $work | Out-Null

Write-Host "1/4 Downloading Tessera at $commit..."
$zip = Join-Path $work "tessera.zip"
Invoke-WebRequest "https://github.com/suredo/Tessera/archive/$commit.zip" -OutFile $zip -UseBasicParsing
Expand-Archive $zip -DestinationPath $work -Force
if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
Move-Item (Join-Path $work "Tessera-$commit") $Target

$version = (Get-Content (Join-Path $Target ".nvmrc") -Raw).Trim()
Write-Host "2/4 Installing Node $version..."
$msi = Join-Path $work "node.msi"
Invoke-WebRequest "https://nodejs.org/dist/v$version/node-v$version-x64.msi" -OutFile $msi -UseBasicParsing
$install = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Node's installer stopped with code $($install.ExitCode)." }
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

Write-Host "3/4 Installing and building Tessera..."
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
Push-Location $Target
try {
  corepack enable
  if ($LASTEXITCODE -ne 0) { throw "corepack enable failed." }
  corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed." }
  corepack pnpm build
  if ($LASTEXITCODE -ne 0) { throw "pnpm build failed." }
} finally {
  Pop-Location
}

Write-Host "4/4 Putting Tessera on the desktop..."
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Tessera.lnk"))
$link.TargetPath = Join-Path $Target "Tessera.cmd"
$link.WorkingDirectory = $Target
$link.Save()

Write-Host ""
Write-Host "Ready. Claude Code and Codex are not installed, on purpose."
Write-Host "Double-click Tessera on the desktop and follow the steps in docs/testing/clean-setup.md."
