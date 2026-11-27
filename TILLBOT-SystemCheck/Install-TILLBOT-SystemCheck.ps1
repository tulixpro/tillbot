$ErrorActionPreference='Stop'
$i=[Security.Principal.WindowsIdentity]::GetCurrent();$p=[Security.Principal.WindowsPrincipal]::new($i)
if(-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'));exit}
if($env:OS -ne 'Windows_NT'){throw 'Nur Windows wird unterstützt.'}
$src=Join-Path $PSScriptRoot 'TILLBOT-SystemCheck.ps1';if(-not(Test-Path $src)){throw 'TILLBOT-SystemCheck.ps1 fehlt. Beide Dateien müssen zusammen im Ordner liegen.'}
$dest=Join-Path $env:ProgramFiles 'TILLBOT\System Check';New-Item -ItemType Directory -Force -Path $dest|Out-Null
Copy-Item -LiteralPath $src -Destination (Join-Path $dest 'TILLBOT-SystemCheck.ps1') -Force
$cmd=Join-Path $dest 'TILLBOT-SystemCheck.cmd'
@('@echo off','powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0TILLBOT-SystemCheck.ps1"')|Set-Content -LiteralPath $cmd -Encoding ASCII
$d=[Environment]::GetFolderPath('CommonDesktopDirectory');$s=[Environment]::GetFolderPath('CommonPrograms');$w=New-Object -ComObject WScript.Shell
foreach($x in @((Join-Path $d 'TILLBOT SYSTEM CHECK.lnk'),(Join-Path $s 'TILLBOT SYSTEM CHECK.lnk'))){$l=$w.CreateShortcut($x);$l.TargetPath=$cmd;$l.WorkingDirectory=$dest;$l.Description='Lokale Windows-System- und Sicherheitsdiagnose';$l.Save()}
Write-Host 'TILLBOT SYSTEM CHECK installiert. Startmenü und Desktop-Verknüpfung erstellt.' -ForegroundColor Green
