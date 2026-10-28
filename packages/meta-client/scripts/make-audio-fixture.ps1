# Genera test/fixtures/dialogo.wav: un diálogo ficticio de dos voces para las pruebas live de
# Voice Transcribe. Usa la voz TTS de Windows en español (Microsoft Sabina) y ffmpeg para bajar el
# tono de la segunda voz. Salida: WAV RIFF mono PCM16 a 16 kHz (lo que exige la API).
# Uso: powershell -File packages/meta-client/scripts/make-audio-fixture.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot "..\test\fixtures"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "blindaje-audio"
New-Item -ItemType Directory -Force $tmp | Out-Null

function Speak([string]$text, [string]$file) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voice = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like "es-*" } | Select-Object -First 1
  if ($null -eq $voice) { throw "No hay voz TTS en español instalada" }
  $s.SelectVoice($voice.VoiceInfo.Name)
  $s.Rate = -1
  $s.SetOutputToWaveFile($file)
  $s.Speak($text)
  $s.Dispose()
}

# Contenido ficticio (sección 10 del PROMPT: todo dato de demo es inventado).
Speak "Hola, habla el jefe. Tienes que yapear quinientos soles de cupo antes del viernes." "$tmp\a.wav"
Speak "No tengo esa plata. Por favor, denme más plazo." "$tmp\b.wav"

ffmpeg -loglevel error -y -i "$tmp\a.wav" -ac 1 -ar 16000 -c:a pcm_s16le "$tmp\a16.wav"
# Segunda voz: tono más grave (asetrate) y misma duración aproximada (atempo).
ffmpeg -loglevel error -y -i "$tmp\b.wav" -af "asetrate=22050*0.72,aresample=16000,atempo=1.25" -ac 1 -ar 16000 -c:a pcm_s16le "$tmp\b16.wav"
ffmpeg -loglevel error -y -f lavfi -i "anullsrc=r=16000:cl=mono" -t 0.8 -c:a pcm_s16le "$tmp\pause.wav"
ffmpeg -loglevel error -y -i "$tmp\a16.wav" -i "$tmp\pause.wav" -i "$tmp\b16.wav" `
  -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1" -ac 1 -ar 16000 -c:a pcm_s16le -map_metadata -1 "$out\dialogo.wav"
Write-Output "OK: $out\dialogo.wav"
