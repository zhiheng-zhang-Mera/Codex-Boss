param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("wechat", "qq")]
  [string]$Channel,

  [Parameter(Mandatory = $true)]
  [ValidatePattern("^/[^\s]{1,19}$")]
  [string]$CommandPrefix
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$processNames = if ($Channel -eq "wechat") { @("WeChat", "Weixin", "WXWork") } else { @("QQ", "QQNT", "TIM") }
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$lastStatus = ""

function Write-RelayRecord([hashtable]$Record) {
  [Console]::Out.WriteLine(($Record | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Set-RelayStatus([string]$Status, [string]$Message) {
  $key = "$Status|$Message"
  if ($script:lastStatus -eq $key) { return }
  $script:lastStatus = $key
  Write-RelayRecord @{ type = "status"; channel = $Channel; status = $Status; message = $Message }
}

function Read-ElementText([System.Windows.Automation.AutomationElement]$Element) {
  $text = $Element.Current.Name
  try {
    $pattern = $Element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    if ($pattern) { $text = $pattern.DocumentRange.GetText(12000) }
  } catch {}
  return [string]$text
}

function Inspect-Window([System.Diagnostics.Process]$Process) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  if (-not $root) { return }
  $conditions = @(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
  )
  foreach ($condition in $conditions) {
    $nodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $limit = [Math]::Min($nodes.Count, 600)
    for ($index = 0; $index -lt $limit; $index += 1) {
      $text = Read-ElementText $nodes.Item($index)
      foreach ($line in ($text -split "[\r\n]+")) {
        $trimmed = $line.Trim()
        $marker = "$CommandPrefix "
        if (-not $trimmed.StartsWith($marker, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        $body = $trimmed.Substring($marker.Length).Trim()
        if (-not $body) { continue }
        $dedupeKey = "$Channel|$($Process.Id)|$trimmed"
        if (-not $seen.Add($dedupeKey)) { continue }
        Write-RelayRecord @{ type = "command"; channel = $Channel; body = $body; sourceWindow = $root.Current.Name }
      }
    }
  }
}

Set-RelayStatus "waiting" "等待已登录的桌面客户端窗口；仅识别 $CommandPrefix 前缀"
while ($true) {
  try {
    $clients = @(Get-Process -Name $processNames -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($clients.Count -eq 0) {
      Set-RelayStatus "waiting" "未发现可见客户端；请先登录并打开聊天窗口"
    } else {
      Set-RelayStatus "ready" "已连接本机可见窗口；指令将进入待确认队列"
      foreach ($client in $clients) { Inspect-Window $client }
    }
    if ($seen.Count -gt 2000) { $seen.Clear() }
  } catch {
    Set-RelayStatus "error" "读取桌面辅助树失败：$($_.Exception.Message)"
  }
  Start-Sleep -Milliseconds 1200
}
