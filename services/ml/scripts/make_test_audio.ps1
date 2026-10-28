# Genera voces sintéticas (Windows SAPI) para los tests pesados de huella de voz.
# Dos "hablantes" distintos: Sabina (es-MX) y Zira (en-US leyendo español).
# Salida: services/ml/models/test-audio/*.wav (no se versiona). Requiere ffmpeg en el PATH.
#   powershell -ExecutionPolicy Bypass -File services/ml/scripts/make_test_audio.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot "..\models\test-audio"
New-Item -ItemType Directory -Force $out | Out-Null

$textos = @{
  "sabina_1" = @("Microsoft Sabina Desktop", "Hola, habla con el jefe. Tienes cuarenta y ocho horas para pagar dos mil soles por Yape. No llames a la policía, porque sabemos dónde está tu tienda y quién atiende en las mañanas. Esta es la última vez que te aviso.")
  "sabina_2" = @("Microsoft Sabina Desktop", "Buenas tardes, vecino. La cuota de esta semana sube a quinientos soles. Deposita en la cuenta que te mandamos por mensaje y guarda silencio. Si no cumples, la próxima visita no va a ser amable, y lo vas a lamentar.")
  "zira_1"   = @("Microsoft Zira Desktop",   "Hola, habla con el jefe. Tienes cuarenta y ocho horas para pagar dos mil soles por Yape. No llames a la policía, porque sabemos dónde está tu tienda y quién atiende en las mañanas. Esta es la última vez que te aviso.")
  "zira_2"   = @("Microsoft Zira Desktop",   "Buenas tardes, vecino. La cuota de esta semana sube a quinientos soles. Deposita en la cuenta que te mandamos por mensaje y guarda silencio. Si no cumples, la próxima visita no va a ser amable, y lo vas a lamentar.")
}

foreach ($k in $textos.Keys) {
  $voz, $texto = $textos[$k]
  $tmp = Join-Path $out "$k.raw.wav"
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($voz)
  $s.SetOutputToWaveFile($tmp)
  $s.Speak($texto)
  $s.Dispose()
  ffmpeg -nostdin -hide_banner -loglevel error -y -i $tmp -ac 1 -ar 16000 -c:a pcm_s16le (Join-Path $out "$k.wav")
  Remove-Item $tmp
  Write-Output "$k.wav"
}
