$ErrorActionPreference='Stop'
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
$script:asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1)
function Await-Operation($operation,[Type]$resultType) {
 $task=$script:asTask.MakeGenericMethod($resultType).Invoke($null,@($operation))
 $task.Wait()
 return $task.Result
}
$file=Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync([string]$request.path)) ([Windows.Storage.StorageFile])
$stream=Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
 $decoder=Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $bitmap=Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 try {
  $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if(-not $engine){throw 'No installed OCR language'}
  $result=Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines=@($result.Lines | ForEach-Object {
   @{text=$_.Text;words=@($_.Words | ForEach-Object { @{text=$_.Text;x=$_.BoundingRect.X;y=$_.BoundingRect.Y;width=$_.BoundingRect.Width;height=$_.BoundingRect.Height} })}
  })
  @{width=$bitmap.PixelWidth;height=$bitmap.PixelHeight;lines=$lines;language=$engine.RecognizerLanguage.LanguageTag} | ConvertTo-Json -Compress -Depth 8
 } finally {$bitmap.Dispose()}
} finally {$stream.Dispose()}
