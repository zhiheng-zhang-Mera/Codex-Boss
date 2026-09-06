param([Parameter(Mandatory=$true)][string]$ReadyFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework
[xml]$markup=@'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Codex Boss UIA Acceptance" Width="460" Height="220">
<StackPanel x:Name="Panel" Margin="20">
<TextBox x:Name="Input" AutomationProperties.AutomationId="acceptanceInput" AutomationProperties.Name="Acceptance input" Margin="0,0,0,15" />
<Button x:Name="Apply" AutomationProperties.AutomationId="acceptanceButton" AutomationProperties.Name="Apply acceptance value" Content="Apply acceptance value" Width="200" HorizontalAlignment="Left" />
</StackPanel>
</Window>
'@
$reader=New-Object System.Xml.XmlNodeReader $markup
$window=[System.Windows.Markup.XamlReader]::Load($reader)
$inputBox=$window.FindName('Input')
$button=$window.FindName('Apply')
$lateTimer=New-Object System.Windows.Threading.DispatcherTimer
$lateTimer.Interval=[TimeSpan]::FromMilliseconds(2500)
$lateTimer.Add_Tick({
  $lateTimer.Stop()
  $late=New-Object System.Windows.Controls.TextBox
  [System.Windows.Automation.AutomationProperties]::SetAutomationId($late,'lateInput')
  $late.Text='BOSS_UIA_LATE'
  $window.FindName('Panel').Children.Add($late) | Out-Null
})
$button.Add_Click({$inputBox.Text='BOSS_UIA_CLICKED';$lateTimer.Start()})
$window.Add_ContentRendered({@{pid=$PID;title=$window.Title} | ConvertTo-Json | Set-Content -LiteralPath $ReadyFile -Encoding UTF8})
$window.ShowDialog() | Out-Null
