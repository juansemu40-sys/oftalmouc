# Oftalmología + IA — Historia clínica asistida por voz

MVP que convierte el **dictado de un oftalmólogo** en una **historia clínica estructurada** y en una
**explicación en lenguaje sencillo para el paciente**. La IA transcribe, organiza y redacta; **nunca diagnostica**.
Nada se guarda sin la revisión del médico.

```
 1 Dictado ─▶ 2 Transcripción ─▶ 3 Extracción ─▶ 4 Borrador ─▶ 5 Revisión ─▶ 6 Guardado ─▶ 7 Explicación ─▶ 8 Aprobación
   médico       IA (Whisper)       IA (LLM)        código        MÉDICO        código        IA (LLM)          MÉDICO
```

Este README es el **contrato de ingeniería**: siguiéndolo al pie de la letra, la aplicación debe quedar
funcionando en una máquina limpia. Las decisiones técnicas están en [`docs/decisiones.md`](docs/decisiones.md).

---

**Ambientada para Colombia:** costos de la IA en pesos (COP) según la TRM, fechas y horas de Bogotá, número de
historia clínica interno (nunca la cédula), registro médico (RETHUS) e IPS opcionales, aviso de tratamiento de
datos según la Ley 1581 de 2012 y explicación al paciente en español colombiano, que remite a la EPS para citas
y exámenes.

> **Windows, sin comandos:** después de instalar Docker Desktop, haga doble clic en `iniciar-demo.bat` (IA
> simulada, sin llaves) o en `iniciar.bat` (usa el proveedor configurado en `.env`).

## 0. Instalar con una IA (lo más fácil)

Abra su asistente de IA con acceso a la carpeta del proyecto (Claude Code, Cursor, GitHub Copilot, Codex…) y
escríbale:

> **Instala este proyecto siguiendo INSTALAR_CON_IA.md y dime qué necesitas de mí.**

La IA revisa el computador, le dice qué falta (por ejemplo Docker Desktop), le pide solo lo que usted debe poner
(su contraseña y, si quiere la IA real, una llave gratuita de Groq), arranca la aplicación y comprueba que quedó
funcionando. Con un chat sin acceso a su computador (por ejemplo, en el navegador), adjunte o pegue
[`INSTALAR_CON_IA.md`](INSTALAR_CON_IA.md) y siga sus indicaciones: le dará un comando a la vez.

Si prefiere hacerlo usted mismo, siga las secciones 1 y 2.

## 1. Qué necesita instalado

| Requisito | Versión | Cómo verificarlo |
|---|---|---|
| Docker Desktop (Windows / Mac) o Docker Engine (Linux) | 24 o superior | `docker --version` |
| Docker Compose **v2** (viene con Docker Desktop) | 2.20 o superior | `docker compose version` |
| Conexión a internet | Solo la primera vez (descarga imágenes, librerías, el modelo de Whisper y la voz) | — |
| Memoria / disco | 8 GB de RAM recomendados, 10 GB libres en disco | — |
| Puertos libres | `8080` (web), `8000` (API) y `8090` (página del paciente para el QR) | — |

**No necesita** instalar Python, Node ni PostgreSQL: todo corre dentro de contenedores con versiones fijas
(Python 3.11, Node 22, PostgreSQL 16, nginx 1.27).

> En Windows, abra **Docker Desktop** y espere a que diga *"Engine running"* antes de continuar.

---

## 2. Levantar la aplicación (5 pasos)

**Paso 1. Descargue el proyecto y entre a la carpeta**

```bash
git clone <enlace-del-repositorio> oftalmologia-ia     # o en GitHub: Code → Download ZIP, y descomprímalo
cd oftalmologia-ia
```

**Paso 2. Cree su archivo de configuración**

```bash
cp .env.example .env          # Windows PowerShell:  copy .env.example .env
```

**Paso 3. Escriba su contraseña y la llave de API en `.env`**

Abra `.env` con cualquier editor. Primero la **contraseña del médico** (obligatoria, mínimo 10 caracteres; sin
ella nadie puede entrar):

```dotenv
MEDICO_USUARIO=medico
MEDICO_CLAVE=su-contraseña-aquí
```

Luego la llave del proveedor de IA (por defecto Groq):

```dotenv
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_su_llave_aqui
```

Cómo obtener una llave de Groq (gratis, 2 minutos): entre a <https://console.groq.com/keys>, inicie sesión,
pulse **Create API Key**, copie el valor que empieza por `gsk_` y péguelo después del `=` sin comillas ni espacios.

> **¿No tiene llave?** Ponga `LLM_PROVIDER=mock`. La aplicación funciona completa con una IA *simulada por
> reglas* (sin internet). Sirve para revisar el flujo, no para evaluar al modelo.

**Paso 4. Ejecute el script de arranque**

```bash
./run.sh                      # Linux, Mac, o Windows con Git Bash / WSL
```

```powershell
.\run.ps1                     # Windows PowerShell
# si Windows bloquea el script:  powershell -ExecutionPolicy Bypass -File .\run.ps1
```

El script verifica Docker, revisa el `.env`, construye las imágenes, levanta los 4 servicios (base de datos, API,
web y la puerta del QR) y espera a que la API responda. **La primera vez tarda entre 5 y 10 minutos** (descarga ~2 GB: librerías y el modelo Whisper `small`).
Las siguientes veces arranca en segundos.

Al final verá:

```
✔ Aplicación lista:
    Web:              http://localhost:8080
    API (Swagger):    http://localhost:8000/docs
```

**Paso 5. Abra <http://localhost:8080>** y entre con el usuario `medico` y su contraseña.

Equivalente manual al paso 4, si prefiere no usar el script: `docker compose up --build`.

---

## 3. Variables de entorno (`.env`)

| Variable | Obligatoria | Valor por defecto | Para qué sirve |
|---|---|---|---|
| `LLM_PROVIDER` | Sí | `groq` | Proveedor del LLM: `groq`, `gemini`, `openai` o `mock` (simulado, sin red) |
| `GROQ_API_KEY` | Si `LLM_PROVIDER=groq` o `TRANSCRIPCION_PROVIDER=groq` | — | Llave de <https://console.groq.com/keys> |
| `GEMINI_API_KEY` | Si `LLM_PROVIDER=gemini` | — | Llave de <https://aistudio.google.com/apikey> |
| `OPENAI_API_KEY` | Si `LLM_PROVIDER=openai` | — | Llave de OpenAI |
| `LLM_MODEL` | No | vacío = por defecto del proveedor | `openai/gpt-oss-120b` (groq), `gemini-2.5-flash` (gemini), `gpt-4o-mini` (openai) |
| `TRANSCRIPCION_PROVIDER` | No | `local` | `local` = faster-whisper en el contenedor (el audio no sale del equipo); `groq` = Whisper en Groq (más preciso y rápido; el audio sale a Groq, gratis dentro de sus límites) |
| `WHISPER_GROQ_MODEL` | No | `whisper-large-v3-turbo` | Con Groq: `whisper-large-v3` es el más preciso (≈10 % de palabras con error frente a ≈12 % del turbo) |
| `WHISPER_MODEL` | No | `small` | Tamaño del modelo local: `tiny`, `base`, `small`, `medium` |
| `PRECARGAR_WHISPER` | No | `true` | Descarga el modelo al construir la imagen (la demo no espera descargas) |
| `VOZ_PROVIDER` | No | `piper` | Voz que lee la explicación aprobada: `piper` (local, el texto no sale del equipo), `elevenlabs` (nube, la más humana; el texto sale a ElevenLabs) o `ninguno` (lee la voz del navegador) |
| `ELEVENLABS_API_KEY` | Si `VOZ_PROVIDER=elevenlabs` | — | Llave de <https://elevenlabs.io> (Developers → API Keys) |
| `ELEVENLABS_VOZ_ID` / `ELEVENLABS_MODELO` | No | voz de ejemplo / `eleven_multilingual_v2` | Voice ID de la voz elegida y modelo (`eleven_flash_v2_5` gasta la mitad de créditos) |
| `VOZ_PIPER` / `PRECARGAR_VOZ` | No | `es_MX-claude-high` / `true` | Voz de Piper que se descarga al construir la imagen. Si la descarga falla, la app arranca igual |
| `VOZ_RITMO` | No | `1.05` | Ritmo de lectura (1.0 normal; más alto = más pausado) |
| `VOZ_VARIACION` / `VOZ_VARIACION_RITMO` | No | `0.5` / `0.6` | Variación de entonación y de ritmo de Piper: más bajo = voz más pareja y estable |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | No | `oftalmologia` / `oftalmologia` / `oftalmologia_local` | Credenciales de la BD del contenedor |
| `DATABASE_URL` | No (informativa) | `postgresql+psycopg://…@db:5432/oftalmologia` | `docker-compose.yml` la construye a partir de las tres anteriores |
| `AGENTE_MAX_ITERACIONES` | No | `5` | Límite 1 del agente: llamadas máximas al LLM por extracción |
| `AGENTE_TIMEOUT_S` | No | `60` | Límite 2: tiempo máximo total del agente |
| `AGENTE_MAX_TOKENS_TOTALES` | No | `20000` | Límite 3: presupuesto de tokens por extracción |
| `LLM_TIMEOUT_S` | No | `30` | Tiempo máximo por llamada individual al LLM |
| `LLM_MAX_TOKENS_RESPUESTA` | No | `4096` | Tokens máximos de cada respuesta del LLM |
| `LLM_TEMPERATURE` | No | `0` | Temperatura (0 = lo más determinista posible) |
| `TRM_COP` | No | `3160` | Pesos colombianos por dólar para mostrar el costo de la IA en COP (actualícela con la TRM del día) |
| `URL_PUBLICA` | No | vacío = la detecta `iniciar.bat` | Dirección del PC en la red para el código QR del paciente (ej. `http://192.168.1.20:8080`). Con `run.sh` (Mac/Linux) fíjela a mano |
| `ENLACE_PACIENTE_DIAS` | No | `30` | Días que el enlace del QR sigue abierto |
| `MEDICO_USUARIO` / `MEDICO_CLAVE` | **Sí** (la clave) | `medico` / — | Acceso del médico. La contraseña la escribe usted, mínimo 10 caracteres. Sin ella nadie entra |
| `SESION_INACTIVIDAD_MIN` | No | `120` | Minutos sin usar la app tras los que la sesión se cierra |
| `MAX_AUDIO_MINUTOS` | No | `20` | Duración máxima de un dictado subido |
| `PUERTO_PUERTA` | No | `8090` | Puerto local de la puerta que publica Tailscale Funnel (solo la página del paciente) |
| `PERMITIR_SIMULAR_FALLAS` | No | `true` | Habilita `POST /api/demo/falla` para demostrar el manejo de errores |
| `PUERTO_WEB` / `PUERTO_API` | No | `8080` / `8000` | Cámbielos si esos puertos están ocupados |

Si falta la llave del proveedor elegido, la aplicación **arranca igual** y muestra un mensaje claro al usar la IA.

---

## 4. Proveedor y modelo declarados

| Uso | Proveedor / modelo | Justificación |
|---|---|---|
| Extracción (pasos 3–4) y explicación (paso 7) | **Groq · `openai/gpt-oss-120b`**, `temperature=0`, `reasoning_effort=low` | Latencia muy baja en hardware LPU, US$ 0,15 / 0,60 por millón de tokens, contexto de 131k, *tool calling* compatible con OpenAI |
| Transcripción (paso 2) | **faster-whisper `small`** (int8, CPU, local) | El audio de un paciente no sale del equipo; ~4× más rápido que Whisper original en CPU |
| Alternativas listas sin cambiar código | Gemini 2.5 Flash, GPT-4o-mini, Groq Whisper large-v3-turbo | Cambiando `LLM_PROVIDER` / `TRANSCRIPCION_PROVIDER` en `.env` |

El detalle y lo descartado está en [`docs/decisiones.md`](docs/decisiones.md), sección 3.

---

## 5. Recorrido guiado (sirve como guion de la demo de 6 minutos)

0. **Ingreso**: usuario `medico` y la contraseña que puso en `MEDICO_CLAVE` (archivo `.env`).
1. **Nueva consulta**: escriba un identificador (ej. `HC-0457`, nunca el nombre) y el médico.
2. **Dictado**: pestaña *Grabar con el micrófono* (el navegador pedirá permiso) o *Escribir o pegar* → elija
   *"Sospecha de glaucoma (dictado completo)"*. Pulse **Generar borrador con IA**.
3. Mire el panel **Qué pasó en esta consulta** a la derecha: cada etapa en palabras sencillas, quién la hizo
   (la IA, el médico o el sistema), cuánto tardó y si hay algo que revisar. El registro técnico completo (tokens,
   llamadas al LLM, herramientas) sigue en `GET /api/consultas/{id}/trazas`.
4. **Revisión médica**: la rejilla OD (rojo) / OI (azul) muestra AV y PIO. Al hacer clic en un campo se resalta en
   el dictado la frase que lo respalda. Corrija lo que quiera.
5. Pruebe el caso *"Dictado ambiguo"*: aparecen alertas bloqueantes; el botón **Guardar** no se habilita hasta
   marcarlas como revisadas y confirmar.
6. **Guardar** → **Redactar explicación** → edite → **Aprobar explicación**. Puede imprimir el resultado.
   **Explicación en voz alta**: en la consulta finalizada pulse **Escuchar explicación** (casilla *Más despacio*
   activada por defecto). **Descargar audio** entrega un WAV para enviarlo por WhatsApp, e **Imprimir en letra
   grande** sirve para pacientes con baja visión. Si el servidor no tiene la voz instalada, la lee el navegador.
   **Código QR para el paciente**: pulse **Crear código QR**. Sale en pantalla y en la hoja impresa; el paciente
   lo escanea con la cámara del celular y escucha o lee su explicación en casa. El panel muestra cuántas veces lo
   abrió el paciente. Sin configurar nada, abre en celulares del **mismo Wi-Fi** del PC; con Tailscale Funnel
   (abajo), desde **cualquier red**.
7. **Manejo de fallos en vivo**: con la sesión iniciada en la app, abra <http://localhost:8000/docs> y ejecute `POST /api/demo/falla` con
   `{"tipo": "timeout"}` (o `caida`, `limite_tasa`, `json_roto`) y genere un borrador: verá un mensaje claro (sin
   stack trace), la etapa en rojo en el panel con la causa en palabras sencillas, y podrá reintentar sin perder el dictado.

### Código QR desde cualquier red (Tailscale Funnel, gratis)

1. Cree una cuenta gratis en <https://tailscale.com>, instale **Tailscale para Windows** e inicie sesión.
2. En PowerShell ejecute **una sola vez**: `tailscale funnel --bg 8090`. La primera vez muestra un enlace para
   aprobar Funnel en su cuenta: ábralo y apruebe. Queda encendido aunque reinicie el PC.
3. Ejecute `iniciar.bat`. Al final dirá *"Código QR: abre desde CUALQUIER red -> https://<su-pc>.<red>.ts.net"*.

La dirección es **fija**: los QR impresos siguen sirviendo aunque reinicie. El PC debe estar encendido con la app
abierta. Por internet solo pasa la **puerta** (`puerta/nginx.conf`): la página del paciente, su audio y los archivos
de la página. La pantalla del médico, la lista de consultas, las historias y Swagger responden 404, y no se acepta
ningún cambio (solo `GET`). Para apagarlo: `tailscale funnel reset`.

---

## 6. Pruebas

```bash
./run.sh test           # Windows: .\run.ps1 test
```

Corre dentro de Docker (no instala nada en su equipo), sin internet ni llaves (BD SQLite en memoria, LLM y Whisper simulados):

| Suite | Archivo | Qué verifica |
|---|---|---|
| Unitarias — extractor AV/PIO | `backend/tests/unit/test_mediciones.py` | Lateralidad en 7 formas de dictado, "2040"→20/40, números en palabras, "ambos ojos", ambigüedades que NO se adivinan, distractores (presión arterial, "3 meses") |
| Unitarias — verificador | `backend/tests/unit/test_verificador.py` | Ojos intercambiados por el LLM, números inventados, citas falsas, diagnósticos no dictados, inyección de instrucciones |
| Unitarias — agente | `backend/tests/unit/test_agente.py` | Los 4 límites (iteraciones, timeout, tokens, confirmación humana), recuperación de JSON roto, caída del proveedor |
| Unitarias — explicación | `backend/tests/unit/test_guardas_y_explicacion.py` | La guarda bloquea diagnósticos y cifras nuevas; reintento y plantilla segura |
| Unitarias — contratos | `backend/tests/unit/test_esquemas_y_estados.py` | Formatos de AV/PIO y máquina de estados de los 8 pasos |
| Integración — API | `backend/tests/integration/test_flujo_api.py` | Los 8 pasos por HTTP; los 3 fallos (timeout 504, caída 503, validación 422) con mensaje amigable y sin stack trace; 409 por orden incorrecto |
| Frontend | `frontend/src/logica/revision.test.ts` | Reglas de bloqueo de la revisión obligatoria (se ejecutan en el build) |

## 7. Evaluación (casos dorados y línea base)

```bash
./run.sh eval                              # con el proveedor del .env (gasta tokens: ~40 llamadas)
./run.sh eval mock                         # proveedor simulado, sin red
./run.sh eval -- --repeticiones 3          # 3 corridas para medianas más estables
```

Imprime el resultado por caso, guarda `eval/resultados/<fecha>_<proveedor>.json` y un bloque Markdown con las
**4 cifras de línea base** (latencia mediana, costo mediano, exactitud de campos críticos, errores de lateralidad /
alucinaciones) para pegar en `docs/decisiones.md`. Ver [`eval/README.md`](eval/README.md).

## 8. Otros comandos

| Comando | Qué hace |
|---|---|
| `./run.sh logs` | Muestra las trazas del backend en vivo (un JSON por evento) |
| `./run.sh stop` | Detiene los contenedores (los datos se conservan) |
| `./run.sh reset` | Detiene y **borra** la base de datos |
| `make up` / `make test` / `make eval` | Atajos equivalentes |

## 9. API

Documentación interactiva en <http://localhost:8000/docs>.

| Método y ruta | Paso | Descripción |
|---|---|---|
| `POST /api/consultas` | 1 | Crea la consulta (`paciente_ref`, `medico`) |
| `POST /api/consultas/{id}/audio` | 2 | Sube el audio y lo transcribe con Whisper (multipart, campo `audio`) |
| `PUT /api/consultas/{id}/transcripcion` | 2 | Dictado escrito o corrección de la transcripción |
| `POST /api/consultas/{id}/extraccion` | 3–4 | Agente LLM + verificación → borrador con alertas |
| `POST /api/consultas/{id}/revision` | 5–6 | Revisión del médico y guardado |
| `POST /api/consultas/{id}/explicacion` | 7 | Explicación para el paciente |
| `POST /api/consultas/{id}/aprobacion` | 8 | Aprobación final |
| `GET /api/consultas/{id}/audio-explicacion` | después del 8 | La explicación aprobada leída en voz alta (WAV). `?descargar=true` la entrega como archivo. 409 si aún no está aprobada |
| `GET` · `POST` · `DELETE /api/consultas/{id}/enlace-paciente` | después del 8 | Ver, crear (409 sin aprobación) o anular el enlace privado del código QR |
| `GET /api/paciente/{token}` | — | Lo que abre el celular del paciente: SOLO la explicación aprobada. 410 si venció o se anuló |
| `GET /api/paciente/{token}/audio` | — | El audio de esa explicación para el celular |
| `GET /api/consultas/{id}/trazas` | — | Trazas y resumen (tokens, costo, latencia, fallos) |
| `GET /api/salud` | — | Estado, proveedor, modelo y límites activos |
| `POST /api/demo/falla` | — | Arma un fallo simulado para la próxima llamada a la IA |

## 10. Estructura del repositorio

```
oftalmologia-ia/
├── README.md                  ← este contrato
├── docker-compose.yml         ← BD + API + web
├── run.sh / run.ps1 / Makefile← arranque en un comando
├── .env.example               ← plantilla de variables (sin llaves reales)
├── docs/decisiones.md         ← arquitectura, datos (no-RAG), fallos, línea base
├── eval/                      ← casos dorados, script de medición y resultados
├── backend/
│   ├── Dockerfile, requirements*.txt
│   ├── app/
│   │   ├── main.py            ← FastAPI, manejo global de errores
│   │   ├── api/rutas.py       ← endpoints (sin lógica de negocio)
│   │   ├── servicios.py       ← orquestación de los 8 pasos
│   │   ├── estados.py         ← máquina de estados
│   │   ├── esquemas.py        ← contrato de la historia clínica (Pydantic)
│   │   ├── db.py              ← modelos SQLAlchemy (consultas, trazas)
│   │   ├── clinica/           ← DETERMINISTA: mediciones AV/PIO, verificador, guardas
│   │   └── ia/                ← PROBABILÍSTICO: agente, herramientas, proveedores, prompts, Whisper
│   └── tests/                 ← unitarias e integración
└── frontend/
    ├── Dockerfile, nginx.conf
    └── src/                   ← App, pantallas de dictado/revisión/explicación, panel de trazas
```

## 11. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Docker está instalado pero no está corriendo` | Docker Desktop cerrado | Ábralo, espere "Engine running", repita `./run.sh` |
| `port is already allocated` | Otro programa usa 8080 u 8000 | Cambie `PUERTO_WEB` / `PUERTO_API` en `.env` |
| `permission denied: ./run.sh` | Se perdió el permiso de ejecución al descomprimir | `chmod +x run.sh` o `bash run.sh` |
| La IA dice "Falta GROQ_API_KEY" | Llave vacía o mal pegada | Revise `.env` (sin comillas ni espacios) y ejecute `./run.sh` de nuevo |
| "El proveedor rechazó la llave" | Llave vencida o revocada | Genere otra en la consola del proveedor |
| Error 429 frecuente | Cuota gratuita agotada | Espere un minuto o cambie de proveedor en `.env` |
| El micrófono no funciona | Permiso denegado o sitio no seguro | Use `http://localhost:8080` (no la IP) y permita el micrófono; o use *Subir un audio* / *Escribir o pegar* |
| La primera transcripción tarda | El modelo de Whisper se está cargando en memoria | Espere ~10 s; las siguientes son más rápidas. Con poca RAM use `WHISPER_MODEL=base` |
| La construcción tarda mucho | Primera descarga | Para una demo más liviana: `PRECARGAR_WHISPER=false` y `TRANSCRIPCION_PROVIDER=groq` |
| El celular no abre el código QR | El celular está en otra red, o el firewall de Windows bloquea el puerto | Conecte el celular al mismo Wi-Fi del PC. Si sigue sin abrir, permita el puerto 8080 en el firewall de Windows (redes privadas). La dirección del QR aparece al terminar `iniciar.bat` |
| `iniciar.bat` dice "solo abre en el mismo Wi-Fi" aunque instalé Tailscale | Funnel no está activo o Tailscale no tiene sesión iniciada | Abra Tailscale e inicie sesión; ejecute `tailscale funnel --bg 8090` y apruebe el enlace que muestra; vuelva a ejecutar `iniciar.bat` |
| El QR abre "404" desde internet | Funnel apunta a otro puerto | `tailscale funnel reset` y luego `tailscale funnel --bg 8090` (el puerto de la puerta, no el 8080) |
| El QR avisa "solo existe en este computador" | No se detectó la IP del PC | Ejecute de nuevo `iniciar.bat`, o fije `URL_PUBLICA=http://<IP-del-PC>:8080` en `.env` (la IP sale con `ipconfig`) |
| Quiero empezar de cero | — | `./run.sh reset` y luego `./run.sh` |

## 12. Prueba del compañero

Antes de entregar, otra persona descarga el proyecto en una máquina distinta y lo instala **sin ayuda**: siguiendo
este README o pidiéndole a una IA que siga [`INSTALAR_CON_IA.md`](INSTALAR_CON_IA.md).

| Fecha | Quién | Sistema operativo | Tiempo hasta ver la app | Problemas encontrados | Corrección aplicada |
|---|---|---|---|---|---|
| _completar_ | | | | | |

## 13. Seguridad

### Controles

| Riesgo (OWASP Top 10) | Control | Dónde | Prueba |
|---|---|---|---|
| Acceso sin permiso (A01) | Todas las rutas del médico exigen sesión; se verifica **antes** de leer la petición y otra vez en cada ruta. Sin sesión: 401 | `app/seguridad.py`, `app/main.py`, `app/api/rutas.py` | `test_sin_sesion_ninguna_ruta_del_medico_responde` recorre **todas** las rutas |
| Contraseñas débiles o adivinadas (A07) | Usuario y contraseña (mín. 10) en `.env`, comparación en tiempo constante, mismo mensaje si falla el usuario o la clave. 5 intentos por IP y 20 en total cada 15 min | `app/seguridad.py` | `test_fuerza_bruta_*` |
| Robo de sesión | Token aleatorio de 256 bits en cookie `HttpOnly` (JavaScript no la lee), `SameSite=Strict`, solo para `/api`; el servidor guarda solo su hash. Se cierra por inactividad (2 h) y siempre a las 12 h. Cerrar sesión la invalida en el servidor | `app/seguridad.py` | `test_cookie_*`, `test_la_sesion_*` |
| CSRF (otra página usa su sesión) | `SameSite=Strict` + rechazo por `Sec-Fetch-Site` y `Origin` (Fetch Metadata, OWASP) | `app/seguridad.py` | `test_csrf_*` |
| Inyección SQL (A03) | Solo consultas parametrizadas del ORM (SQLAlchemy) | `app/db.py`, `app/servicios.py` | `test_inyeccion_sql_se_guarda_como_texto` |
| XSS (A03) | React escapa todo; prohibido insertar HTML (prueba estática); CSP `script-src 'self'` | `frontend/nginx.conf` | `test_xss_*`, `frontend/src/logica/seguridad.test.ts` |
| Asignación masiva | Esquemas Pydantic con campos explícitos: no se puede saltar pasos enviando `estado` | `app/esquemas.py` | `test_asignacion_masiva_no_salta_pasos` |
| Archivos maliciosos | Se valida el **contenido** (firma del audio), no la extensión; nombre de archivo ignorado; máx. 25 MB y 20 minutos; el audio se borra tras transcribir | `app/api/rutas.py`, `app/ia/transcripcion.py` | `test_archivo_disfrazado_*`, `test_audio_*` |
| Denegación de servicio por entradas gigantes | Límites en todos los textos (dictado 20.000, campo 5.000, historia 60.000 caracteres) | `app/esquemas.py` | `test_textos_gigantes_*`, `test_historia_gigante_*` |
| Fuga de información (A05) | Errores sin stack trace; `/api/salud` sin sesión solo dice si la app está viva; sin versión de nginx ni uvicorn; los logs no guardan el dictado | `app/main.py`, `app/trazas.py`, `nginx.conf`, `Dockerfile` | `test_salud_*`, `test_los_logs_no_guardan_el_dictado` |
| Cabeceras (A05) | CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cache-Control: no-store` en la API | `frontend/nginx.conf`, `app/main.py` | `test_cabeceras_de_seguridad_en_la_api` |
| Exposición en la red | API y Swagger (8000) y la puerta del QR (8090) solo en `127.0.0.1`. Por internet solo sale la página del paciente | `docker-compose.yml`, `puerta/nginx.conf` | Probado con nginx real: 29/29 intentos bloqueados |
| Librerías vulnerables (A06) | `npm audit` y `pip-audit` sin vulnerabilidades conocidas (noviembre de 2026) | `frontend/package.json`, `backend/requirements.txt` | `npm audit`, `pip-audit -r backend/requirements.txt` |

Correr solo las pruebas de seguridad: `docker compose run --rm --no-deps backend pytest tests/integration/test_seguridad.py -v`.

**Fuera del alcance de este MVP** (necesarios antes de usar datos reales): HTTPS en un servidor propio, varias cuentas
de médico con roles, cifrado de la base de datos en reposo, copias de seguridad y registro de auditoría de quién vio
cada historia.

### Buenas prácticas

- **Nunca** incluya `.env` en el ZIP. Para empaquetar sin archivos pesados ni secretos:
  ```bash
  zip -r ../oftalmologia-ia.zip . -x ".env" "*/node_modules/*" "*/dist/*" "*/__pycache__/*" "*/.venv/*" ".git/*" "*.db"
  ```
- Use solo dictados **ficticios** en la demo: con un proveedor en la nube, la transcripción sale del equipo.
- El audio se elimina inmediatamente después de transcribirlo.
