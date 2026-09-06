import { spawn } from "node:child_process";
import type { SemanticAction, SemanticBackend, SemanticResult } from "../semantic-runtime";
export interface UiaTarget { processId: number; windowTitle?: string; automationId?: string; name?: string; }
export interface ApplicationSpec { executable: string; args?: string[]; }
export function parseUiaTarget(target: string): UiaTarget {
  if (!target.startsWith("uia:")) throw new Error("UIA target must be structured");
  const value = JSON.parse(target.slice(4)) as UiaTarget;
  if (!Number.isInteger(value.processId) || value.processId <= 0 || Object.keys(value).some((key) => !["processId", "windowTitle", "automationId", "name"].includes(key))) throw new Error("Invalid UIA target");
  for (const key of ["windowTitle", "automationId", "name"] as const) if (value[key] !== undefined && (typeof value[key] !== "string" || value[key]!.length > 500)) throw new Error("Invalid UIA selector");
  return value;
}
const bridge = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
$selector=$request.selector
$deadline=[DateTime]::UtcNow.AddMilliseconds([int]$request.timeoutMs)
$condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$selector.processId)
do {
  $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)
  $matching=@($windows | Where-Object { -not $selector.windowTitle -or $_.Current.Name -eq $selector.windowTitle })
  if($matching.Count -gt 0 -or $request.name -ne 'wait_for_state'){break}
  Start-Sleep -Milliseconds 100
}while([DateTime]::UtcNow -lt $deadline)
if($matching.Count -ne 1){@{status='FAILED';message='UIA requires exactly one matching window; no action performed'} | ConvertTo-Json -Compress;exit}
$window=$matching[0]
if($request.name -eq 'focus_window'){
  $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
  if(-not $focused -or $focused.Current.ProcessId -ne [int]$selector.processId){
    $focusCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty,$true)
    $focusable=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$focusCondition)
    if(-not $focusable){
      $children=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      $details=@($children | Select-Object -First 10 | ForEach-Object {@{name=$_.Current.Name;id=$_.Current.AutomationId;type=$_.Current.ControlType.ProgrammaticName;focusable=$_.Current.IsKeyboardFocusable;offscreen=$_.Current.IsOffscreen}})
      throw ('Window has no focusable control: '+(@{window=$window.Current.Name;class=$window.Current.ClassName;enabled=$window.Current.IsEnabled;offscreen=$window.Current.IsOffscreen;handle=$window.Current.NativeWindowHandle;children=$details}|ConvertTo-Json -Depth 5 -Compress))
    }
    $focusable.SetFocus()
  }
  $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
  @{status=$(if($focused.Current.ProcessId -eq [int]$selector.processId){'SUCCESS'}else{'FAILED'});evidence=@{processId=$selector.processId;window=$window.Current.Name}} | ConvertTo-Json -Compress
  exit
}
$conditions=New-Object 'System.Collections.Generic.List[System.Windows.Automation.Condition]'
if($selector.automationId){$conditions.Add(([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,[string]$selector.automationId)))}
if($selector.name){$conditions.Add(([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,[string]$selector.name)))}
if($conditions.Count -eq 0){$element=$window}
else {
  $query=if($conditions.Count -eq 1){$conditions[0]}else{[System.Windows.Automation.AndCondition]::new($conditions.ToArray())}
  do {
    $matches=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$query)
    if($matches.Count -gt 0 -or $request.name -ne 'wait_for_state'){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  if($matches.Count -ne 1){@{status='FAILED';message='UIA requires exactly one matching control; no action performed'} | ConvertTo-Json -Compress;exit}
  $element=$matches[0]
}
function Read-State($node){
  $valuePattern=$null
  $value=$null
  if($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$valuePattern)){$value=$valuePattern.Current.Value}
  @{name=$node.Current.Name;automationId=$node.Current.AutomationId;enabled=$node.Current.IsEnabled;value=$value;processId=$node.Current.ProcessId}
}
if($request.name -eq 'click_control'){
  $invoke=$null
  if(-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){@{status='UNSUPPORTED';message='Control has no InvokePattern'} | ConvertTo-Json -Compress;exit}
  $invoke.Invoke()
  @{status='SUCCESS';evidence=(Read-State $element)} | ConvertTo-Json -Compress -Depth 5
}elseif($request.name -eq 'enter_text'){
  $valuePattern=$null
  if(-not $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$valuePattern)){@{status='UNSUPPORTED';message='Control has no ValuePattern'} | ConvertTo-Json -Compress;exit}
  $valuePattern.SetValue([string]$request.value)
  $state=Read-State $element
  @{status=$(if($state.value -ceq [string]$request.value){'SUCCESS'}else{'UNCERTAIN'});evidence=$state} | ConvertTo-Json -Compress -Depth 5
}elseif($request.name -in @('verify_state','wait_for_state')){
  do{
    $state=Read-State $element
    $matched=($state.value -ceq [string]$request.value -or $state.name -ceq [string]$request.value)
    if($matched -or $request.name -eq 'verify_state'){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  @{status=$(if($matched){'SUCCESS'}else{'FAILED'});evidence=$state} | ConvertTo-Json -Compress -Depth 5
}else{@{status='SUCCESS';evidence=(Read-State $element)} | ConvertTo-Json -Compress -Depth 5}
`;
export class WindowsUiaBackend implements SemanticBackend {
  readonly kind = "uia" as const;
  constructor(private readonly apps: Record<string, ApplicationSpec> = {}, private readonly platform = process.platform) {}
  supports(action: SemanticAction): boolean { return this.platform === "win32" && (action.name === "open_app" ? Object.hasOwn(this.apps, action.target) : action.target.startsWith("uia:") && ["focus_window", "find_control", "click_control", "enter_text", "read_page", "wait_for_state", "verify_state"].includes(action.name)); }
  async execute(action: SemanticAction, signal: AbortSignal): Promise<SemanticResult> {
    if (!this.supports(action)) return { status: "UNSUPPORTED" };
    if (signal.aborted) return { status: "FAILED", message: "Cancelled before action" };
    if (action.name === "open_app") {
      const app = this.apps[action.target];
      return new Promise((resolve) => { const child = spawn(app.executable, app.args ?? [], { windowsHide: false, detached: false, stdio: "ignore" }); child.once("error", (error) => resolve({ status: "FAILED", message: String(error) })); child.once("spawn", () => { child.unref(); resolve({ status: "SUCCESS", evidence: { processId: child.pid, application: action.target } }); }); });
    }
    if (action.value && action.value.length > 100000) throw new Error("UIA input exceeds budget");
    const selector = parseUiaTarget(action.target);
    return new Promise((resolve) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", bridge], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let output = ""; let errors = ""; const abort = () => child.kill(); signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (data) => { output += String(data); if (output.length > 1000000) child.kill(); });
      child.stderr.on("data", (data) => { errors += String(data).slice(0, 4000); });
      child.once("error", (error) => { signal.removeEventListener("abort", abort); resolve({ status: "FAILED", message: String(error) }); });
      child.once("close", (code) => { signal.removeEventListener("abort", abort); try { if (code !== 0) throw new Error(errors || "UIA process interrupted"); resolve(JSON.parse(output.trim())); } catch (error) { resolve({ status: ["click_control", "enter_text", "focus_window"].includes(action.name) ? "UNCERTAIN" : "FAILED", message: String(error) }); } });
      child.stdin.end(JSON.stringify({ ...action, value: action.expected ?? action.value, selector, timeoutMs: Math.min(action.timeoutMs ?? 15000, 120000) }));
    });
  }
}
