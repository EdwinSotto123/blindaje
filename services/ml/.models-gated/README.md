# Pesos con acceso restringido (no se versionan)

Aquí va el modelo de producción de Llama Prompt Guard 2 que el Dockerfile copia a la imagen
(`/models/llama-prompt-guard-2-86m/`). Git ignora todo menos este archivo; Docker sí lo incluye en
el contexto del build. El contenedor no descarga nada en tiempo de ejecución.

Requisitos: una cuenta de Hugging Face con acceso aprobado a `meta-llama/Llama-Prompt-Guard-2-86M`
(y a `-22M` para la evaluación) y un token de lectura. El token se pasa solo por la variable
`HF_TOKEN`; nunca va a la línea de comandos, al repo, a los logs ni a la imagen.

```bash
cd services/ml
read -rs HF_TOKEN && export HF_TOKEN                 # pega el token; no queda en el historial
# descarga los dos modelos a services/ml/models/ (gitignorado) con revisiones y SHA-256 fijados
uv run python scripts/download_models.py --gated
unset HF_TOKEN
uv run python scripts/eval_prompt_guard.py            # eval/results/prompt_guard.json
uv run python scripts/download_models.py --stage-gated .models-gated   # copia el de producción aquí
```

Junto a los pesos van `LICENSE` (Llama 4 Community License), `USE_POLICY.md` y `NOTICE` con el aviso
que exige la sección 1.b.iii de la licencia. Quien despliegue el servicio debe mostrar
"Built with Llama" en la documentación o la interfaz del producto (sección 1.b.i).

Sin estos pesos la imagen igual se construye y `/safety/prompt-guard` responde
503 `prompt_guard_unavailable`.
