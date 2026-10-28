# Archivos horneados en la imagen

## `cohort.npy`

Cohorte de referencia para la s-norm de `/voice/compare`: 60 × 192 (float32, normalizada L2),
centroides ECAPA de 10 hablantes de SLR73 que no entran a la prueba de la evaluación. Es una copia
de `eval/cohort.npy` (SHA-256 `6fbc8914c4dac021cfbf74de5dc9c26fa6698962899b5b149d84ac0645f24561`);
el Dockerfile la copia a `/models/cohort.npy` para que la s-norm funcione desde el arranque.
Si la evaluación la regenera: `cp eval/cohort.npy services/ml/assets/cohort.npy` y reconstruir la
imagen. En caliente también se puede reemplazar con `POST /voice/cohort`.

**Atribución y licencia.** Vectores derivados de **OpenSLR SLR73**, "Crowdsourced high-quality
Peruvian Spanish speech data set", https://www.openslr.org/73/. Copyright 2018, 2019 Google, Inc.
Licencia Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0),
https://creativecommons.org/licenses/by-sa/4.0/. Cita: Guevara-Rukoz, A., Demirsahin, I., He, F.,
Chu, S.-H. C., Sarin, S., Pipatsrisawat, K., Gutkin, A., Butryna, A. y Kjartansson, O. (2020).
*Crowdsourcing Latin American Spanish for Low-Resource Text-to-Speech*. Proceedings of LREC 2020,
pp. 6504–6513. Este archivo se comparte bajo la misma licencia CC BY-SA 4.0. Los audios no se
redistribuyen. Detalle en `eval/README.md`.
