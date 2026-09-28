param([switch]$NoRun)
$ErrorActionPreference = 'Stop'

function Split-CsvLine {
    param([string]$Line)
    $values = New-Object 'System.Collections.Generic.List[string]'
    $field = New-Object Text.StringBuilder
    $quoted = $false
    for ($i = 0; $i -lt $Line.Length; $i++) {
        $c = $Line[$i]
        if ($c -eq '"') {
            if ($quoted -and $i + 1 -lt $Line.Length -and $Line[$i + 1] -eq '"') { [void]$field.Append('"'); $i++ }
            else { $quoted = -not $quoted }
        } elseif ($c -eq ',' -and -not $quoted) {
            $values.Add($field.ToString()); [void]$field.Clear()
        } else { [void]$field.Append($c) }
    }
    $values.Add($field.ToString())
    return ,($values.ToArray())
}

function Find-WizTree {
    $locations = New-Object 'System.Collections.Generic.List[string]'
    foreach ($p in @($env:WIZTREE_PATH, $PSScriptRoot)) { if ($p) { $locations.Add($p) } }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($base) { $locations.Add([IO.Path]::Combine($base, 'WizTree')) }
    }
    if ($env:LOCALAPPDATA) { $locations.Add([IO.Path]::Combine($env:LOCALAPPDATA, 'Programs\WizTree')) }
    foreach ($key in @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WizTree_is1', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WizTree_is1', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\WizTree_is1')) {
        try {
            $location = (Get-ItemProperty -LiteralPath $key -ErrorAction Stop).InstallLocation
            if ($location) { $locations.Add($location) }
        } catch { }
    }
    $fallback = New-Object 'System.Collections.Generic.List[string]'
    foreach ($location in $locations) {
        if (Test-Path -LiteralPath $location -PathType Leaf) {
            if ([IO.Path]::GetFileName($location) -ieq 'WizTree64.exe') { return $location }
            if ([IO.Path]::GetFileName($location) -ieq 'WizTree.exe') { $fallback.Add($location) }
        } else {
            $candidate = [IO.Path]::Combine($location, 'WizTree64.exe')
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
            $fallback.Add([IO.Path]::Combine($location, 'WizTree.exe'))
        }
    }
    if (Get-Command where.exe -ErrorAction SilentlyContinue) {
        $found = @(& where.exe WizTree64.exe 2>$null)
        foreach ($candidate in $found) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    }
    if (-not [Environment]::Is64BitOperatingSystem) {
        foreach ($candidate in $fallback) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    }
    return $null
}

function Select-CsvFolder {
    param([string]$TempPath = [IO.Path]::GetTempPath())
    $folder = $null
    try {
        $drive = New-Object IO.DriveInfo 'D:'
        if ($drive.IsReady -and $drive.DriveType -eq [IO.DriveType]::Fixed -and $drive.AvailableFreeSpace -gt 500MB) { $folder = 'D:\DiskPilotLite_temp' }
    } catch { }
    if (-not $folder) {
        $folder = [IO.Path]::Combine($TempPath, 'DiskPilotLite_temp')
        if ($folder -match '[^\x00-\x7F]') { $folder = 'C:\ProgramData\DiskPilotLite_temp' }
    }
    $created = -not (Test-Path -LiteralPath $folder -PathType Container)
    [void][IO.Directory]::CreateDirectory($folder)
    return [pscustomobject]@{ Path = $folder; Created = $created }
}

function Get-CsvEncoding {
    # WizTree 官方未写明 CSV 编码：有 BOM 时 StreamReader 会自动识别；
    # 无 BOM 时先按严格 UTF-8 试读前 1 MB，失败则用系统 ANSI 编码（中文 Windows 为 GBK）。
    param([Parameter(Mandatory=$true)][string]$CsvPath)
    $stream = [IO.File]::OpenRead($CsvPath)
    try {
        $buffer = New-Object byte[] 1048576
        $count = $stream.Read($buffer, 0, $buffer.Length)
    } finally { $stream.Dispose() }
    if ($count -ge 2 -and (($buffer[0] -eq 0xFF -and $buffer[1] -eq 0xFE) -or ($buffer[0] -eq 0xFE -and $buffer[1] -eq 0xFF))) { return [Text.Encoding]::UTF8 }
    if ($count -ge 3 -and $buffer[0] -eq 0xEF -and $buffer[1] -eq 0xBB -and $buffer[2] -eq 0xBF) { return [Text.Encoding]::UTF8 }
    # 末尾可能截断在一个多字节字符中间，去掉最后 3 个字节再校验。
    $checkCount = [Math]::Max(0, $count - 3)
    if ($count -lt $buffer.Length) { $checkCount = $count }
    $strict = New-Object Text.UTF8Encoding($false, $true)
    try { [void]$strict.GetString($buffer, 0, $checkCount); return [Text.Encoding]::UTF8 }
    catch { return [Text.Encoding]::Default }
}

function Convert-WizTreeCsvToEmbed {
    param([Parameter(Mandatory=$true)][string]$CsvPath, [long]$MinBytes = 10MB)
    Write-Host '正在整理扫描结果…'
    $reader = New-Object IO.StreamReader($CsvPath, (Get-CsvEncoding -CsvPath $CsvPath), $true)
    $output = New-Object Text.StringBuilder
    [void]$output.AppendLine('File Name,Size,Allocated')
    $columns = @(0, 1, 2); $headerSeen = $false; $lineCount = 0
    try {
        while ($null -ne ($line = $reader.ReadLine())) {
            $lineCount++
            if ($lineCount % 50000 -eq 0) { Write-Host ('正在整理扫描结果… 已读取 {0} 行' -f $lineCount) }
            if (-not $line.Trim() -or $line.StartsWith('Generated by')) { continue }
            if (-not $headerSeen) {
                $v = Split-CsvLine $line
                $nameIndex = -1; $sizeIndex = -1; $allocatedIndex = -1
                for ($i = 0; $i -lt $v.Length; $i++) {
                    switch ($v[$i].Trim().ToLowerInvariant()) {
                        { $_ -in @('file name', '文件名', '文件名称') } { $nameIndex = $i }
                        { $_ -in @('size', '大小') } { $sizeIndex = $i }
                        { $_ -in @('allocated', '分配', '已分配') } { $allocatedIndex = $i }
                    }
                }
                $headerSeen = $true
                if ($nameIndex -ge 0 -and $sizeIndex -ge 0 -and $allocatedIndex -ge 0) {
                    $columns = @($nameIndex, $sizeIndex, $allocatedIndex); continue
                }
                if (-not $v[0].EndsWith('\')) { continue }
            }
            # WizTree normally puts the quoted path first. Split only the numeric tail.
            if ($columns[0] -eq 0) {
                if ($line.StartsWith('"')) {
                    $end = $line.IndexOf('",', 1)
                    if ($end -lt 0) { continue }
                    $path = $line.Substring(1, $end - 1).Replace('""', '"')
                    if (-not $path.EndsWith('\')) { continue }
                    $values = $line.Substring($end + 2).Split(',')
                    $sizeColumn = $columns[1] - 1
                    $allocatedColumn = $columns[2] - 1
                } else {
                    $values = $line.Split(',')
                    $path = $values[0]
                    if (-not $path.EndsWith('\')) { continue }
                    $sizeColumn = $columns[1]
                    $allocatedColumn = $columns[2]
                }
            } else {
                # Reordered headers still use the general CSV parser.
                $values = Split-CsvLine $line
                if ($values.Length -le $columns[0]) { continue }
                $path = $values[$columns[0]]
                if (-not $path.EndsWith('\')) { continue }
                $sizeColumn = $columns[1]
                $allocatedColumn = $columns[2]
            }
            if ($values.Length -le [Math]::Max($sizeColumn, $allocatedColumn)) { continue }
            [long]$size = 0
            [long]$allocated = 0
            if (-not [long]::TryParse($values[$sizeColumn], [ref]$size)) { continue }
            if ([string]::IsNullOrWhiteSpace($values[$allocatedColumn])) { $allocated = $size }
            elseif (-not [long]::TryParse($values[$allocatedColumn], [ref]$allocated)) { continue }
            if ($allocated -lt $MinBytes -and $path -notmatch '^[a-zA-Z]:\\$') { continue }
            [void]$output.Append('"').Append($path.Replace('"', '""')).Append('",').Append($size).Append(',').Append($allocated).Append("`n")
        }
    } finally { $reader.Dispose() }
    return $output.ToString()
}

function New-ReportHtml {
    param([string]$TemplatePath, [string]$OutPath, [string]$CsvText, $Meta)
    $html = [IO.File]::ReadAllText($TemplatePath, [Text.Encoding]::UTF8)
    $csvTag = '<script type="text/plain" id="dp-embedded-csv"></script>'
    $metaTag = '<script type="application/json" id="dp-embedded-meta">null</script>'
    if (-not $html.Contains($csvTag) -or -not $html.Contains($metaTag)) { throw '报告模板缺少数据占位标签，请重新解压工具。' }
    $safeCsv = $CsvText.Replace('</', '<\/')
    $safeMeta = (ConvertTo-Json -InputObject $Meta -Depth 10 -Compress).Replace('</', '<\/')
    $html = $html.Replace($csvTag, '<script type="text/plain" id="dp-embedded-csv">' + $safeCsv + '</script>')
    $html = $html.Replace($metaTag, '<script type="application/json" id="dp-embedded-meta">' + $safeMeta + '</script>')
    $encoding = New-Object Text.UTF8Encoding $false
    [IO.File]::WriteAllText($OutPath, $html, $encoding)
}

function Test-InstallConsent {
    # 只有 Y、y、是（去掉首尾空白后）表示同意安装；空输入或其他任何内容都表示不安装。
    param([AllowNull()][string]$Answer)
    if ($null -eq $Answer) { return $false }
    $text = $Answer.Replace([string][char]0, '').Trim()
    return ($text -ceq 'Y' -or $text -ceq 'y' -or $text -ceq '是')
}

function Format-Elapsed {
    param([TimeSpan]$Elapsed)
    $minutes = [int][Math]::Floor($Elapsed.TotalMinutes)
    if ($minutes -gt 0) { return ('{0} 分 {1} 秒' -f $minutes, $Elapsed.Seconds) }
    return ('{0} 秒' -f [int][Math]::Floor($Elapsed.TotalSeconds))
}

function Wait-WizTreeExport {
    # 先等 WizTree 进程结束，再等 CSV 大小连续 StableSeconds 秒不变。
    # 返回 'ok'、'timeout'（超过总时限）或 'missing'（进程已结束但没有生成 CSV）。不抛异常。
    param(
        $Process,
        [string]$CsvPath,
        [switch]$SlowMode,
        [double]$TimeoutMinutes = 0,
        [int]$StableSeconds = 5,
        [int]$MissingSeconds = 60,
        [int]$HeartbeatSeconds = 30,
        [double]$PollSeconds = 1
    )
    if ($TimeoutMinutes -le 0) { if ($SlowMode) { $TimeoutMinutes = 60 } else { $TimeoutMinutes = 20 } }
    if ($SlowMode) { $message = '慢速模式，可能要 10 分钟以上，请耐心等，不要关闭这个窗口' }
    else { $message = '正在扫描 C 盘，大约需要 1 到 2 分钟，请不要关闭这个窗口' }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $spinner = @('|', '/', '-', '\')
    $tick = 0
    $nextHeartbeat = $HeartbeatSeconds
    Write-Host $message
    # 第 1 步：等 WizTree 退出（导出完成前它不会退出）。
    while (-not $Process.HasExited) {
        if ($watch.Elapsed.TotalMinutes -ge $TimeoutMinutes) { Write-Host ''; return 'timeout' }
        if ($watch.Elapsed.TotalSeconds -ge $nextHeartbeat) {
            Write-Host ''
            Write-Host ('仍在扫描，程序没有卡住，已用 {0}' -f (Format-Elapsed $watch.Elapsed))
            $nextHeartbeat += $HeartbeatSeconds
        }
        Write-Host -NoNewline ("`r{0} … 已用 {1} {2}  " -f $message, (Format-Elapsed $watch.Elapsed), $spinner[$tick % 4])
        Start-Sleep -Milliseconds ([int]($PollSeconds * 1000))
        $tick++
        $Process.Refresh()
    }
    Write-Host ''
    # 第 2 步：等 CSV 写完：存在、非空、大小连续 StableSeconds 秒不变。
    $exitedAt = $watch.Elapsed.TotalSeconds
    $lastLength = -1
    $stableSince = $null
    while ($true) {
        if ($watch.Elapsed.TotalMinutes -ge $TimeoutMinutes) { Write-Host ''; return 'timeout' }
        $length = -1
        if (Test-Path -LiteralPath $CsvPath -PathType Leaf) { $length = (Get-Item -LiteralPath $CsvPath).Length }
        if ($length -le 0) {
            if ($watch.Elapsed.TotalSeconds - $exitedAt -ge $MissingSeconds) { Write-Host ''; return 'missing' }
            $stableSince = $null
        } elseif ($length -ne $lastLength) {
            $stableSince = $watch.Elapsed.TotalSeconds
        } elseif ($watch.Elapsed.TotalSeconds - $stableSince -ge $StableSeconds) {
            Write-Host ''
            return 'ok'
        }
        $lastLength = $length
        if ($watch.Elapsed.TotalSeconds -ge $nextHeartbeat) {
            Write-Host ''
            Write-Host ('仍在写入扫描结果，程序没有卡住，已用 {0}' -f (Format-Elapsed $watch.Elapsed))
            $nextHeartbeat += $HeartbeatSeconds
        }
        Write-Host -NoNewline ("`r正在等待扫描结果写入完成… 已用 {0} {1}  " -f (Format-Elapsed $watch.Elapsed), $spinner[$tick % 4])
        Start-Sleep -Milliseconds ([int]($PollSeconds * 1000))
        $tick++
    }
}

function Remove-TempCsv {
    # 只删除本脚本自己生成的那一个 CSV；若文件夹是本脚本新建且已空，再删空文件夹。
    param([string]$CsvPath, $Folder)
    Write-Host ('正在删除临时文件：' + $CsvPath)
    try {
        if (Test-Path -LiteralPath $CsvPath -PathType Leaf) { Remove-Item -LiteralPath $CsvPath }
        if ($Folder.Created -and [IO.Directory]::GetFileSystemEntries($Folder.Path).Length -eq 0) { [IO.Directory]::Delete($Folder.Path, $false) }
        return $true
    } catch {
        Write-Host ('临时文件清理失败，你可以手动删除这个文件：' + $CsvPath)
        return $false
    }
}

function Show-InstallHelp {
    Write-Host '请用浏览器打开官网 https://diskanalyzer.com/download 下载安装 WizTree（个人免费），装好后再双击本工具'
    Write-Host '也可以直接打开「看示例或导入CSV.html」看示例或导入 CSV。'
    Write-Host ('示例与导入页面：' + [IO.Path]::Combine($PSScriptRoot, '看示例或导入CSV.html'))
}

function Invoke-DiskPilot {
    $template = [IO.Path]::Combine($PSScriptRoot, '看示例或导入CSV.html')
    $tempRoot = [IO.Path]::GetTempPath().TrimEnd('\') + '\'
    $inTemp = $PSScriptRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)
    $archiveTemp = $inTemp -and (($PSScriptRoot + '\') -match '\\Temp\\d*_[^\\]*\.zip\\|\\Rar\$|\\7z[^\\]*\\')
    if (-not (Test-Path -LiteralPath $template -PathType Leaf) -or $archiveTemp) {
        Write-Host '请先右键解压，再双击'
        Write-Host '右键 zip →「全部解压缩」→ 打开解压出的文件夹 → 双击 一键扫描C盘.cmd'
        return
    }
    Write-Host 'DiskPilot Lite · C 盘空间报告'
    Write-Host '本工具只生成报告和建议，不会删除你的任何文件'
    $wiz = Find-WizTree
    if (-not $wiz) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Show-InstallHelp; return }
        Write-Host '没有找到 WizTree（免费的磁盘扫描工具，本工具靠它读取 C 盘）。可以用 Windows 自带的 winget 从官方软件源安装：软件包 AntibodySoftware.WizTree，发布者 Antibody Software，大小约 5–8 MB。安装时 Windows 可能弹出一次管理员确认。'
        Write-Host '安装即表示你同意 WizTree 的许可协议（个人免费），协议原文见：https://diskanalyzer.com/eula'
        Write-Host '本工具不内置 WizTree，其 EULA 禁止未经分发许可的再分发。'
        $answer = Read-Host '输入 Y 或「是」后按回车安装；直接按回车 = 不安装'
        if (-not (Test-InstallConsent $answer)) { Write-Host '没有安装。'; Show-InstallHelp; return }
        Write-Host '正在下载安装，期间出现的英文进度信息是正常的，不需要你做任何选择'
        & winget install --id AntibodySoftware.WizTree -e --source winget --accept-package-agreements --accept-source-agreements --silent
        $wiz = Find-WizTree
        if (-not $wiz) { Write-Host '安装后仍未找到 WizTree。'; Show-InstallHelp; return }
    }
    Write-Host '扫描结果会先存成一个临时表格文件，大约需要 50–200 MB 空间，生成报告后马上删除'
    $folder = Select-CsvFolder
    $csvPath = [IO.Path]::Combine($folder.Path, ('c-folders-{0}.csv' -f (Get-Date -Format 'yyyyMMdd-HHmmss')))
    if (Test-Path -LiteralPath $csvPath) { throw '同名临时文件已存在，请稍等几秒后重试，避免覆盖已有文件。' }
    Write-Host ('临时文件：' + $csvPath)
    Write-Host '接下来 Windows 会弹出『是否允许此应用对你的设备进行更改？』，请点『是』。原因：需要管理员权限才能快速读取磁盘，这样 1～2 分钟就能扫完。点『否』也行，但会改用慢速模式，可能要 10 分钟以上。'
    [void](Read-Host '按回车键继续')
    $adminScan = $true
    $argString = 'C: /export="' + $csvPath + '" /admin=1 /exportfiles=0'
    try { $process = Start-Process -FilePath $wiz -ArgumentList $argString -Verb RunAs -PassThru }
    catch {
        $errorObject = $_.Exception
        $cancelled = $false
        while ($null -ne $errorObject) {
            if ($errorObject -is [ComponentModel.Win32Exception] -and $errorObject.NativeErrorCode -eq 1223) { $cancelled = $true }
            $errorObject = $errorObject.InnerException
        }
        if (-not $cancelled) { throw }
        Write-Host '你选择了不授权，改用慢速模式扫描。'
        $adminScan = $false
        $argString = 'C: /export="' + $csvPath + '" /admin=0 /exportfiles=0'
        $process = Start-Process -FilePath $wiz -ArgumentList $argString -PassThru
    }
    $waitResult = Wait-WizTreeExport -Process $process -CsvPath $csvPath -SlowMode:(-not $adminScan)
    if ($waitResult -eq 'timeout') {
        Write-Host '等了很久扫描还没有结束，本工具先停下来了。'
        Write-Host '可能是电脑文件特别多或磁盘比较慢。你可以关掉 WizTree 窗口，稍后重新双击「一键扫描C盘.cmd」再试一次。'
        if ($process.HasExited) { [void](Remove-TempCsv -CsvPath $csvPath -Folder $folder) }
        else { Write-Host ('WizTree 还在运行；它结束后，你可以手动删除这个临时文件：' + $csvPath) }
        return
    }
    if ($waitResult -eq 'missing') {
        Write-Host 'WizTree 已经结束，但没有生成扫描结果。请重新双击「一键扫描C盘.cmd」再试一次；如果一直这样，可以先打开「看示例或导入CSV.html」，按页面里的步骤手动导出 CSV。'
        return
    }
    $csvText = Convert-WizTreeCsvToEmbed -CsvPath $csvPath
    $drive = New-Object IO.DriveInfo 'C:'
    $meta = @{ source='real'; drive='C:'; scannedAt=(Get-Date).ToString('o'); totalBytes=$drive.TotalSize; freeBytes=$drive.AvailableFreeSpace; minFolderBytes=10MB; exportKind='folders'; adminScan=$adminScan }
    $name = 'C盘报告-{0}.html' -f (Get-Date -Format 'yyyyMMdd-HHmm')
    $reportPath = [IO.Path]::Combine($PSScriptRoot, $name)
    # 同一分钟重试时保留先前报告。
    if (Test-Path -LiteralPath $reportPath) { $reportPath = [IO.Path]::Combine($PSScriptRoot, ('C盘报告-{0}.html' -f (Get-Date -Format 'yyyyMMdd-HHmmssfff'))) }
    try { New-ReportHtml -TemplatePath $template -OutPath $reportPath -CsvText $csvText -Meta $meta }
    catch {
        $reportPath = [IO.Path]::Combine([IO.Path]::GetTempPath(), ('C盘报告-{0}.html' -f [guid]::NewGuid().ToString('N')))
        New-ReportHtml -TemplatePath $template -OutPath $reportPath -CsvText $csvText -Meta $meta
        Write-Host ('原文件夹无法写入，报告已保存到：' + $reportPath)
    }
    Write-Host ('报告文件：' + $reportPath + '（想留就留，不想要可以直接删）')
    try { Start-Process -FilePath $reportPath } catch { Write-Host ('无法自动打开报告，请双击上述文件。原始错误：' + $_.Exception.Message) }
    Start-Sleep -Seconds 2
    [void](Remove-TempCsv -CsvPath $csvPath -Folder $folder)
    Write-Host '报告已打开，可以关掉这个窗口了'
}

if (-not $NoRun) {
    # 输入输出都用 UTF-8，保证中文提示正常显示、Read-Host 能读到「是」。
    try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { $null = $_ }
    try { [Console]::InputEncoding = New-Object Text.UTF8Encoding $false } catch { $null = $_ }
    try { Invoke-DiskPilot }
    catch { Write-Host '出错了，未能完成报告。'; Write-Host ('原始错误：' + $_.Exception.Message) }
    [void](Read-Host '按回车键关闭窗口')
    exit 0
}
