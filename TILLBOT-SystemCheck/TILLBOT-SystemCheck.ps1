param([ValidateSet('quick','normal','deep')][string]$ScanMode,[string]$ReportPath,[string]$LogPath)
$ErrorActionPreference='Continue'
function IsAdmin{$i=[Security.Principal.WindowsIdentity]::GetCurrent();([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}
if($env:OS -ne 'Windows_NT'){Write-Error 'Nur Windows wird unterstützt.';exit 2}
if(-not(IsAdmin)){if($ScanMode){exit 3};Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'));exit}
if($ScanMode){
 $script:items=[System.Collections.Generic.List[object]]::new()
 function Add-Result($s,$n,$d){$script:items.Add([pscustomobject]@{Status=$s;Pruefung=$n;Ergebnis=$d;Zeitpunkt=(Get-Date).ToString('s')});if($LogPath){Add-Content -LiteralPath $LogPath -Value ("{0}|{1}|{2}" -f $s,$n,($d -replace '[\r\n|]',' ')) -Encoding UTF8}}
 function Check($n,[scriptblock]$b){try{&$b}catch{Add-Result 'WARNUNG' $n ('Prüfung nicht möglich: '+$_.Exception.Message)}}
 if($LogPath){Set-Content -LiteralPath $LogPath -Value '' -Encoding UTF8}
 Add-Result 'INFO' 'Start' ('Prüfmodus '+$ScanMode)
 Check 'Windows-Version' {$o=Get-CimInstance Win32_OperatingSystem;Add-Result 'INFO' 'Windows-Version' ($o.Caption+' Build '+$o.BuildNumber)}
 Check 'Arbeitsspeicher' {$o=Get-CimInstance Win32_OperatingSystem;$f=[math]::Round($o.FreePhysicalMemory/1MB,1);$t=[math]::Round($o.TotalVisibleMemorySize/1MB,1);if($f/$t -lt .1){Add-Result 'WARNUNG' 'Arbeitsspeicher' ("Nur $f GB von $t GB frei")}else{Add-Result 'OK' 'Arbeitsspeicher' ("$f GB von $t GB frei")}}
 Check 'Systemlaufwerk' {$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'";$f=[math]::Round($d.FreeSpace/1GB,1);if($d.FreeSpace/$d.Size -lt .1){Add-Result 'WARNUNG' 'Systemlaufwerk' ("Nur $f GB frei")}else{Add-Result 'OK' 'Systemlaufwerk' ("$f GB frei")}}
 Check 'Firewall' {$p=Get-NetFirewallProfile;$off=@($p|Where-Object{$_.Enabled -ne $true});if($off.Count){Add-Result 'KRITISCH' 'Firewall' ('Deaktiviert: '+(($off.Name)-join ', '))}else{Add-Result 'OK' 'Firewall' 'Alle Profile aktiviert.'}}
 Check 'Microsoft Defender' {$d=Get-MpComputerStatus;if(-not $d.AntivirusEnabled -or -not $d.RealTimeProtectionEnabled){Add-Result 'KRITISCH' 'Microsoft Defender' 'Virenschutz oder Echtzeitschutz deaktiviert.'}else{Add-Result 'OK' 'Microsoft Defender' 'Virenschutz und Echtzeitschutz aktiv.'};if($d.AntivirusSignatureLastUpdated -and ((Get-Date)-$d.AntivirusSignatureLastUpdated).TotalDays -gt 7){Add-Result 'WARNUNG' 'Virendefinitionen' 'Definitionen sind älter als 7 Tage.'}}
 Check 'UAC' {$v=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name EnableLUA).EnableLUA;if($v -ne 1){Add-Result 'WARNUNG' 'UAC' 'Benutzerkontensteuerung ist ausgeschaltet.'}else{Add-Result 'OK' 'UAC' 'Benutzerkontensteuerung ist eingeschaltet.'}}
 Check 'Remote Desktop' {$v=(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections).fDenyTSConnections;if($v -eq 0){Add-Result 'WARNUNG' 'Remote Desktop' 'Remotedesktop ist aktiviert.'}else{Add-Result 'OK' 'Remote Desktop' 'Remotedesktop ist deaktiviert.'}}
 Check 'SMBv1' {$v=Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -ErrorAction Stop;if($v.State -eq 'Enabled'){Add-Result 'KRITISCH' 'SMBv1' 'Veraltetes SMBv1 ist aktiviert.'}else{Add-Result 'OK' 'SMBv1' 'SMBv1 ist nicht aktiviert.'}}
 Check 'Windows-Updates' {$h=Get-HotFix|Sort-Object InstalledOn -Descending|Select-Object -First 1;if($h.InstalledOn -and ((Get-Date)-$h.InstalledOn).TotalDays -gt 60){Add-Result 'WARNUNG' 'Windows-Updates' 'Letztes erkanntes Hotfix ist älter als 60 Tage; Windows Update prüfen.'}elseif($h){Add-Result 'OK' 'Windows-Updates' ('Letztes Hotfix '+$h.HotFixID)}else{Add-Result 'INFO' 'Windows-Updates' 'Hotfix-Datum nicht ermittelbar.'}}
 Check 'BitLocker' {if(Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue){$b=Get-BitLockerVolume -MountPoint $env:SystemDrive;if($b.ProtectionStatus -eq 'On'){Add-Result 'OK' 'BitLocker' 'Laufwerksschutz aktiv.'}else{Add-Result 'INFO' 'BitLocker' 'Laufwerksschutz nicht aktiv oder nicht verfügbar.'}}else{Add-Result 'INFO' 'BitLocker' 'BitLocker-Verwaltung nicht verfügbar.'}}
 Check 'Secure Boot' {try{if(Confirm-SecureBootUEFI -ErrorAction Stop){Add-Result 'OK' 'Secure Boot' 'Aktiviert.'}else{Add-Result 'WARNUNG' 'Secure Boot' 'Deaktiviert.'}}catch{Add-Result 'INFO' 'Secure Boot' 'Status nicht ermittelbar (BIOS/VM möglich).'}}
 Check 'Defender-Schnellprüfung' {Start-MpScan -ScanType QuickScan -ErrorAction Stop;Add-Result 'OK' 'Defender-Schnellprüfung' 'Windows Defender-Schnellprüfung wurde gestartet.'}
 if($ScanMode -in @('normal','deep')){
  Check 'Systemereignisse' {$e=Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=(Get-Date).AddDays(-7)} -MaxEvents 100 -ErrorAction SilentlyContinue;if(@($e).Count){Add-Result 'WARNUNG' 'Systemereignisse' (@($e).Count+' kritische/Fehler-Ereignisse in 7 Tagen.')}else{Add-Result 'OK' 'Systemereignisse' 'Keine kritischen Fehler im Zeitraum gefunden.'}}
  Check 'Defender-Verlauf' {$t=@(Get-MpThreatDetection -ErrorAction Stop|Where-Object{$_.InitialDetectionTime -gt (Get-Date).AddDays(-30)});if($t.Count){Add-Result 'WARNUNG' 'Defender-Verlauf' ($t.Count+' Erkennungen in 30 Tagen. Windows-Sicherheit öffnen.')}else{Add-Result 'OK' 'Defender-Verlauf' 'Keine aktuellen Erkennungen im Verlauf.'}}
 }
 if($ScanMode -eq 'deep'){
  Check 'DISM' {Add-Result 'INFO' 'DISM' 'Starte ScanHealth.';$p=Start-Process dism.exe -ArgumentList '/Online','/Cleanup-Image','/ScanHealth' -Wait -PassThru -WindowStyle Hidden;if($p.ExitCode -eq 0){Add-Result 'OK' 'DISM' 'Komponentenspeicher-Prüfung abgeschlossen.'}else{Add-Result 'WARNUNG' 'DISM' ('Exitcode '+$p.ExitCode)}}
  Check 'SFC' {Add-Result 'INFO' 'SFC' 'Starte verifyonly; keine Reparaturen.';$p=Start-Process sfc.exe -ArgumentList '/verifyonly' -Wait -PassThru -WindowStyle Hidden;if($p.ExitCode -eq 0){Add-Result 'OK' 'SFC' 'Systemdatei-Prüfung abgeschlossen.'}else{Add-Result 'WARNUNG' 'SFC' ('Exitcode '+$p.ExitCode)}}
 }
 $out=[pscustomobject]@{Product='TILLBOT SYSTEM CHECK';Version='1.0';Mode=$ScanMode;CreatedAt=(Get-Date).ToString('o');Findings=@($items)}
 if($ReportPath){$out|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $ReportPath -Encoding UTF8}
 if($LogPath){Add-Content -LiteralPath $LogPath -Value 'FERTIG|Scan|Abgeschlossen.' -Encoding UTF8};exit 0
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$f=[Windows.Forms.Form]::new();$f.Text='TILLBOT SYSTEM CHECK';$f.Size=[Drawing.Size]::new(900,620);$f.MinimumSize=[Drawing.Size]::new(760,500);$f.StartPosition='CenterScreen';$f.BackColor=[Drawing.Color]::FromArgb(17,22,34);$f.ForeColor=[Drawing.Color]::White
$h=[Windows.Forms.Label]::new();$h.Text='TILLBOT SYSTEM CHECK';$h.Font=[Drawing.Font]::new('Segoe UI',20,[Drawing.FontStyle]::Bold);$h.Location=[Drawing.Point]::new(22,16);$h.Size=[Drawing.Size]::new(600,38);$f.Controls.Add($h)
$sub=[Windows.Forms.Label]::new();$sub.Text='Windows-Diagnose · lokale Sicherheits- und Systemprüfung';$sub.Location=[Drawing.Point]::new(25,58);$sub.Size=[Drawing.Size]::new(700,24);$f.Controls.Add($sub)
$m=[Windows.Forms.ComboBox]::new();$m.DropDownStyle='DropDownList';[void]$m.Items.AddRange(@('Schnellprüfung','Normalprüfung','Tiefenprüfung'));$m.SelectedIndex=0;$m.Location=[Drawing.Point]::new(25,100);$m.Size=[Drawing.Size]::new(240,30);$f.Controls.Add($m)
$go=[Windows.Forms.Button]::new();$go.Text='Prüfung starten';$go.Location=[Drawing.Point]::new(275,98);$go.Size=[Drawing.Size]::new(140,34);$f.Controls.Add($go)
$open=[Windows.Forms.Button]::new();$open.Text='Bericht öffnen';$open.Location=[Drawing.Point]::new(425,98);$open.Size=[Drawing.Size]::new(125,34);$open.Enabled=$false;$f.Controls.Add($open)
$folder=Join-Path $env:ProgramData 'TILLBOT\SystemCheck';New-Item -ItemType Directory -Force -Path $folder|Out-Null
$lv=[Windows.Forms.ListView]::new();$lv.Location=[Drawing.Point]::new(25,150);$lv.Size=[Drawing.Size]::new(830,360);$lv.Anchor='Top,Bottom,Left,Right';$lv.View='Details';$lv.FullRowSelect=$true;$lv.GridLines=$true;$lv.BackColor=[Drawing.Color]::FromArgb(25,32,47);$lv.ForeColor=[Drawing.Color]::White
[void]$lv.Columns.Add('Status',95);[void]$lv.Columns.Add('Prüfung',220);[void]$lv.Columns.Add('Ergebnis',490);$f.Controls.Add($lv)
$st=[Windows.Forms.Label]::new();$st.Text='Bereit. Prüfmodus auswählen.';$st.Location=[Drawing.Point]::new(25,520);$st.Size=[Drawing.Size]::new(830,25);$st.Anchor='Bottom,Left,Right';$f.Controls.Add($st)
$bar=[Windows.Forms.ProgressBar]::new();$bar.Location=[Drawing.Point]::new(25,550);$bar.Size=[Drawing.Size]::new(830,15);$bar.Anchor='Bottom,Left,Right';$f.Controls.Add($bar)
$script:rp=Join-Path $folder 'Bericht.json';$script:lg=Join-Path $folder 'scan.log';$script:proc=$null;$script:tm=[Windows.Forms.Timer]::new();$script:tm.Interval=1000
$go.Add_Click({if($script:proc -and -not $script:proc.HasExited){return};$lv.Items.Clear();$open.Enabled=$false;$mode=@('quick','normal','deep')[$m.SelectedIndex];$st.Text='Prüfung läuft …';$bar.Style='Marquee';$go.Enabled=$false;$ps=Join-Path $PSHOME 'powershell.exe';$aa=@('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"' + $PSCommandPath + '"'),'-ScanMode',$mode,'-ReportPath',('"' + $script:rp + '"'),'-LogPath',('"' + $script:lg + '"'));$script:proc=Start-Process -FilePath $ps -ArgumentList $aa -PassThru -WindowStyle Hidden;$script:tm.Start()})
$script:tm.Add_Tick({if(Test-Path $script:lg){$lv.Items.Clear();foreach($line in (Get-Content $script:lg -ErrorAction SilentlyContinue)){$p=$line -split '\|',3;if($p.Count -lt 3 -or $p[0] -eq 'FERTIG'){continue};$it=[Windows.Forms.ListViewItem]::new($p[0]);[void]$it.SubItems.Add($p[1]);[void]$it.SubItems.Add($p[2]);if($p[0] -eq 'KRITISCH'){$it.ForeColor=[Drawing.Color]::Salmon}elseif($p[0] -eq 'WARNUNG'){$it.ForeColor=[Drawing.Color]::Gold}elseif($p[0] -eq 'OK'){$it.ForeColor=[Drawing.Color]::LightGreen};[void]$lv.Items.Add($it)}};if($script:proc -and $script:proc.HasExited){$script:tm.Stop();$bar.Style='Blocks';$bar.Value=100;$go.Enabled=$true;if(Test-Path $script:rp){$open.Enabled=$true;$st.Text='Prüfung abgeschlossen · Bericht lokal gespeichert.'}else{$st.Text='Kein Bericht erstellt. scan.log prüfen.'}}})
$open.Add_Click({if(Test-Path $script:rp){Start-Process notepad.exe -ArgumentList ('"' + $script:rp + '"')}})
$f.Add_FormClosing({if($script:proc -and -not $script:proc.HasExited){[void][Windows.Forms.MessageBox]::Show('Prüfung läuft noch. Bitte zuerst abwarten.','TILLBOT SYSTEM CHECK');$_.Cancel=$true}})
[void]$f.ShowDialog()
