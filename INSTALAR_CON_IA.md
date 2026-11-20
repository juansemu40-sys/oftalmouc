# Instalación guiada por IA — OftalmoUC (Oftalmología + IA)

> **Para la IA que lee este archivo:** una persona te pidió instalar este proyecto en su computador.
> Sigue los pasos **en orden**, ejecuta tú los comandos que puedas y explícale a la persona, en **español
> sencillo**, solo lo que ella tiene que hacer. Supón que no sabe programar. Al terminar cada paso, confirma
> que salió bien antes de seguir.
>
> Si no tienes acceso a una terminal (por ejemplo, un chat web), guía a la persona paso a paso: dale **un
> comando a la vez**, pídele que lo copie, lo pegue y te muestre lo que respondió.

**Para la persona:** no necesitas leer este archivo. Abre tu asistente de IA en la carpeta del proyecto y
escríbele: *"Instala este proyecto siguiendo INSTALAR_CON_IA.md y dime qué necesitas de mí"*.

---

## 0. Reglas obligatorias para la IA

1. **Nunca muestres, repitas ni copies las llaves de API ni la contraseña del médico**: ni en el chat, ni en
   archivos, ni en mensajes de commit. Para comprobar que existen usa los comandos de la sección 3.4, que solo
   dicen "configurada" o "falta".
2. **Las llaves y la contraseña las escribe la persona** en el archivo `.env`: abre el archivo (o dile cómo
   abrirlo) y pídele que pegue el valor ella misma. Si insiste en dártelo en el chat, puedes escribirlo en
   `.env`, pero nunca lo repitas en tus respuestas.
3. **Nunca desactives la verificación de certificados** (TLS/SSL: `verify=False`, `NODE_TLS_REJECT_UNAUTHORIZED=0`,
   `--insecure`, etc.). Si aparece `CERTIFICATE_VERIFY_FAILED`, es casi siempre un antivirus: sección 8.
4. **No cambies el código para "hacer pasar" un error.** Diagnostica con los mensajes y las trazas, explícale a
   la persona qué pasa y pregúntale antes de tocar cualquier archivo que no sea `.env`.
5. **No borres datos** (`.\run.ps1 reset`, `./run.sh reset`, `docker compose down -v`, borrar volúmenes) sin que
   la persona lo pida explícitamente: se pierden todas las consultas.
6. **No hagas `git commit` ni `git push`**, y nunca agregues `.env` a git (ya está en `.gitignore`).
7. **No instales programas del sistema sin permiso** (Docker, WSL, etc.): dile a la persona qué falta, de dónde
   descargarlo y espera a que lo haga.
8. La app es para **datos ficticios**: recuérdale a la persona que no use pacientes reales.

---

## 1. Qué se va a instalar

Una aplicación web que convierte el dictado de un oftalmólogo en una historia clínica estructurada y en una
explicación sencilla para el paciente (texto, voz y código QR). La IA transcribe, organiza y redacta; **el médico
revisa y aprueba todo**. Corre completa dentro de **Docker**, en 4 contenedores:

| Contenedor | Qué hace | Puerto en el computador |
|---|---|---|
| `db` | Base de datos PostgreSQL 16 | ninguno (interno) |
| `backend` | API FastAPI + Whisper + IA | `8000`, solo en este PC (Swagger en `/docs`) |
| `frontend` | La página web (React servida por nginx) | `8080` |
| `puerta` | Lo único que se puede publicar a internet: la página del paciente | `8090`, solo en este PC |

No hace falta instalar Python, Node ni PostgreSQL: todo viene dentro de los contenedores.

---

## 2. Revisar el computador (lo hace la IA)

Si la persona solo te dio el enlace de GitHub, primero descarga el proyecto:
`git clone <enlace-del-repositorio>` y entra a la carpeta. Si no tiene `git`, pídele que en GitHub pulse
**Code → Download ZIP**, que lo descomprima y que te diga dónde quedó la carpeta.

Ejecuta estas comprobaciones **desde la carpeta del proyecto**. En Windows usa PowerShell.

| Qué revisar | Windows (PowerShell) | Mac / Linux | Debe responder |
|---|---|---|---|
| Docker instalado | `docker --version` | `docker --version` | versión 24 o mayor |
| Docker Compose v2 | `docker compose version` | `docker compose version` | versión 2.20 o mayor |
| Docker encendido | `docker info --format "{{.ServerVersion}}"` | igual | un número de versión, sin error |
| Puertos libres | `Get-NetTCPConnection -State Listen -LocalPort 8080,8000,8090 -ErrorAction SilentlyContinue` | `lsof -nP -iTCP:8080 -iTCP:8000 -iTCP:8090 -sTCP:LISTEN` | **nada** (vacío) |
| Espacio en disco | `Get-PSDrive C` | `df -h .` | al menos **10 GB** libres |

**Si algo falla, díselo así a la persona:**

- **Docker no está instalado:** "Necesitas instalar Docker Desktop. Descárgalo de
  <https://www.docker.com/products/docker-desktop/>, instálalo con las opciones por defecto, reinicia el
  computador si te lo pide, ábrelo y espera a que abajo a la izquierda diga *Engine running*. Avísame cuando esté."
  (En Windows, Docker Desktop usa WSL 2; el instalador lo configura.)
- **Docker está instalado pero no encendido:** "Abre Docker Desktop y espera a que diga *Engine running*."
- **Un puerto está ocupado:** no cierres programas de la persona. Cambia el puerto en `.env` (después del paso 3):
  `PUERTO_WEB=8081`, `PUERTO_API=8001` o `PUERTO_PUERTA=8091`, y usa ese número en las direcciones.
- **Poco espacio:** pídele liberar espacio; la primera instalación descarga unos 3 GB.

La computadora necesita **internet** la primera vez. Se recomiendan **8 GB de RAM**.

---

## 3. Preparar la configuración (`.env`)

### 3.1 Crear el archivo

Si no existe `.env`, créalo a partir de la plantilla:

- Windows: `Copy-Item .env.example .env`
- Mac / Linux: `cp .env.example .env`

### 3.2 Preguntas para la persona (en este orden)

**1. La contraseña del médico (obligatoria).** Sin ella nadie puede entrar a la app.
Pregunta: *"¿Qué contraseña quieres para entrar a la aplicación? Mínimo 10 caracteres. La escribirás tú en el
archivo .env."* Debe quedar así (el usuario por defecto es `medico`):

```dotenv
MEDICO_USUARIO=medico
MEDICO_CLAVE=su-contraseña-de-al-menos-10-caracteres
```

Si prefiere que la genere la IA, crea una al azar y dísela **una sola vez** para que la guarde:
Windows `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 16 | ForEach-Object {[char]$_})`;
Mac / Linux `openssl rand -base64 12`.

**2. ¿IA real o simulada?**
- **Real (recomendada):** necesita una llave **gratuita** de Groq. Explícale: "Entra a
  <https://console.groq.com/keys>, inicia sesión (puede ser con Google), pulsa **Create API Key**, copia el valor
  que empieza por `gsk_` y pégalo en el archivo .env después de `GROQ_API_KEY=`, sin comillas ni espacios."
  ```dotenv
  LLM_PROVIDER=groq
  GROQ_API_KEY=gsk_...
  ```
- **Simulada (sin llaves, para una demostración rápida):** `LLM_PROVIDER=mock`. Funciona todo el flujo, pero la
  IA es un simulador por reglas.

**3. Voz a texto (transcripción del dictado).**
- Si tiene llave de Groq, usa la opción **más precisa** (el audio se envía a Groq; gratis dentro de sus límites):
  ```dotenv
  TRANSCRIPCION_PROVIDER=groq
  WHISPER_GROQ_MODEL=whisper-large-v3
  ```
- Si no tiene llave o no quiere que el audio salga del computador: `TRANSCRIPCION_PROVIDER=local` (Whisper
  `small` dentro de Docker; más lento y menos preciso).

**4. La voz que lee la explicación al paciente (opcional).**
- Por defecto `VOZ_PROVIDER=piper`: voz local y gratuita, no necesita nada.
- Opcional, voz muy humana con **ElevenLabs** (plan gratis ≈ 10.000 créditos al mes):
  ```dotenv
  VOZ_PROVIDER=elevenlabs
  ELEVENLABS_API_KEY=sk_...
  ELEVENLABS_VOZ_ID=...
  ```
  La llave está en <https://elevenlabs.io> → Developers → API Keys. **Importante:** en el plan gratis, las voces
  de la *Voice Library* dan error 402; hay que usar una voz predeterminada o una creada por la persona (Voice
  Design) y copiar su **Voice ID**.

**5. Código QR desde cualquier red (opcional):** ver la sección 7. Sin esto, el QR abre en celulares conectados
al mismo Wi-Fi del computador.

### 3.3 Lo que NO hay que tocar

Deje los demás valores como vienen en `.env.example`. `URL_PUBLICA` debe quedar **vacía**: el script de arranque
la detecta sola.

### 3.4 Comprobar sin mostrar los valores

- Windows:
  ```powershell
  foreach ($c in "MEDICO_CLAVE","LLM_PROVIDER","GROQ_API_KEY","TRANSCRIPCION_PROVIDER","VOZ_PROVIDER") {
    $l = Select-String -Path .env -Pattern "^$c=(.+)$" | Select-Object -Last 1
    $v = if ($l) { $l.Matches[0].Groups[1].Value.Trim() } else { "" }
    if ($c -match "CLAVE|KEY") { "{0}: {1}" -f $c, $(if ($v.Length -ge 10) {"configurada"} else {"FALTA"}) } else { "{0}: {1}" -f $c, $v }
  }
  ```
- Mac / Linux:
  ```bash
  for c in MEDICO_CLAVE GROQ_API_KEY; do grep -qE "^$c=.{10,}" .env && echo "$c: configurada" || echo "$c: FALTA"; done
  grep -E "^(LLM_PROVIDER|TRANSCRIPCION_PROVIDER|VOZ_PROVIDER)=" .env
  ```

`MEDICO_CLAVE` debe decir **configurada**. `GROQ_API_KEY` solo es necesaria si `LLM_PROVIDER=groq` o
`TRANSCRIPCION_PROVIDER=groq`.

---

## 4. Instalar y arrancar

- **Windows:** `powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1`
  (es lo mismo que hacer doble clic en `iniciar.bat`).
- **Mac / Linux:** `chmod +x run.sh && ./run.sh`

**La primera vez tarda entre 5 y 15 minutos**: descarga las librerías, el modelo de Whisper y la voz Piper.
Avísale a la persona para que no cierre la ventana. Las siguientes veces arranca en segundos.

Al terminar debe aparecer `OK Web: http://localhost:8080` (Windows) o `Aplicación lista` (Mac / Linux).

---

## 5. Comprobar que quedó bien (lo hace la IA)

1. **Contenedores:** `docker compose ps` → `db`, `backend`, `frontend` y `puerta` en estado *running*; `db` y
   `backend` además *healthy*.
2. **La app responde:**
   - Windows: `Invoke-RestMethod http://localhost:8080/api/salud`
   - Mac / Linux: `curl -s http://localhost:8080/api/salud`

   Debe responder `estado: ok` y `base_datos: ok`. Sin sesión solo muestra eso: es normal, por seguridad.
3. **Pruebas automáticas** (unas 150 del servidor y 43 de la página, con la IA simulada y sin internet):
   - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 test`
   - Mac / Linux: `./run.sh test`

   Deben terminar sin fallas (`passed`).
4. **Prueba de la persona:** pídele que abra <http://localhost:8080>, entre con el usuario `medico` y su
   contraseña, cree una consulta con el identificador `HC-0500`, elija **Escribir o pegar**, pegue este texto y
   pulse **Generar borrador con IA**:

   > Paciente de cincuenta años que consulta porque ve borroso de lejos desde hace tres meses. Antecedente de
   > hipertensión arterial, sin cirugías en los ojos. Agudeza visual sin corrección ojo derecho 20/40 y ojo
   > izquierdo 20/30, con corrección ojo derecho 20/20 y ojo izquierdo 20/20. Presión intraocular ojo derecho 15 y
   > ojo izquierdo 16 milímetros de mercurio. Biomicroscopía ojo derecho córnea clara, ojo izquierdo córnea clara.
   > Fondo de ojo ojo derecho normal, ojo izquierdo normal. Impresión diagnóstica miopía en ambos ojos. Plan
   > formular gafas y control en un año.

   En la revisión deben aparecer: agudeza sin corrección OD 20/40 y OI 20/30, con corrección 20/20 en ambos ojos,
   presión OD 15 y OI 16 mmHg. Luego puede probar el micrófono con **Grabar con el micrófono**: el navegador pedirá
   permiso, y una barra le indica si se oye bien.

---

## 6. Uso diario (para explicarle a la persona)

| Quiero… | Windows | Mac / Linux |
|---|---|---|
| Abrir la app | doble clic en `iniciar.bat` | `./run.sh` |
| Abrir la app con la IA simulada | doble clic en `iniciar-demo.bat` | `LLM_PROVIDER=mock` en `.env` y `./run.sh` |
| Correr las pruebas | doble clic en `probar.bat` | `./run.sh test` |
| Apagarla (conserva los datos) | `.\run.ps1 stop` | `./run.sh stop` |
| Borrar TODAS las consultas | `.\run.ps1 reset` | `./run.sh reset` |
| Ver qué está pasando | `.\run.ps1 logs` | `./run.sh logs` |

- Dirección: <http://localhost:8080> · Usuario: `medico` · Contraseña: la de `MEDICO_CLAVE` en `.env`.
- Después de cambiar algo en `.env` hay que volver a abrir la app con `iniciar.bat` / `./run.sh`.
- El micrófono funciona en `http://localhost:8080`. Si se abre por la IP del computador (`http://192.168…`), el
  navegador lo bloquea porque no es una conexión segura.

---

## 7. Opcional: código QR que abra desde cualquier red (Tailscale, gratis)

1. La persona crea una cuenta gratis en <https://tailscale.com>, instala **Tailscale** y inicia sesión (esto lo
   hace ella).
2. En una terminal, **una sola vez**: `tailscale funnel --bg 8090`. La primera vez muestra un enlace para aprobar
   Funnel en su cuenta: debe abrirlo y aceptar. Queda encendido aunque reinicie el computador.
3. Volver a abrir la app (`iniciar.bat` o `.\run.ps1`). En Windows, el final debe decir *"Código QR: abre desde
   CUALQUIER red → https://…ts.net"*. En Mac / Linux escriba esa dirección en `.env` como
   `URL_PUBLICA=https://<equipo>.<red>.ts.net` (la muestra `tailscale funnel status`).

Por internet **solo** sale la página del paciente: la pantalla del médico, la API y Swagger responden 404.
Para apagarlo: `tailscale funnel reset`. El computador debe estar encendido con la app abierta para que el QR abra.

---

## 8. Problemas frecuentes

| Lo que aparece | Causa | Qué hacer |
|---|---|---|
| `Docker está instalado pero no está corriendo` / error en `docker info` | Docker Desktop cerrado | Abrirlo y esperar *Engine running* |
| `port is already allocated` | Otro programa usa 8080, 8000 u 8090 | Cambiar `PUERTO_WEB` / `PUERTO_API` / `PUERTO_PUERTA` en `.env` |
| El script no se ejecuta en Windows ("ejecución de scripts deshabilitada") | Política de PowerShell | Usar `powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1` o `iniciar.bat` |
| `./run.sh: Permission denied` | Se perdió el permiso al descargar | `chmod +x run.sh` |
| Pantalla de ingreso con aviso amarillo "Falta configurar la contraseña" | `MEDICO_CLAVE` vacía o con menos de 10 caracteres | Escribirla en `.env` y volver a abrir la app |
| "Usuario o contraseña incorrectos" | Clave distinta a la de `.env` | Revisar `.env` (sin espacios ni comillas). El usuario es `medico` |
| "Demasiados intentos fallidos" | 5 intentos malos | Esperar 15 minutos |
| La IA dice "Falta GROQ_API_KEY" o "rechazó la llave" | Llave vacía, mal copiada o revocada | Pegarla de nuevo o crear otra en console.groq.com |
| "El proveedor de IA no está disponible" y en el panel la causa dice `CERTIFICATE_VERIFY_FAILED` | Un **antivirus** (Kaspersky, ESET, Avast…) revisa las conexiones seguras y las reemplaza | En el antivirus, excluir `api.groq.com` y `api.elevenlabs.io` del análisis de conexiones cifradas. **Nunca** desactivar la verificación de certificados |
| "Demasiadas solicitudes" (429) | Límite gratuito de Groq por minuto | Esperar un minuto |
| Voz de ElevenLabs con error 402 | Voz de la Voice Library en plan gratis | Usar una voz predeterminada o diseñada por la persona y poner su Voice ID |
| La construcción falla descargando el modelo de Whisper o la voz | Red lenta o bloqueada | Reintentar. Para una instalación liviana: `PRECARGAR_WHISPER=false` con `TRANSCRIPCION_PROVIDER=groq`, o `PRECARGAR_VOZ=false` |
| Docker se queda sin memoria (Windows) | WSL 2 con poca RAM | Cerrar programas pesados; en Docker Desktop → Settings → Resources asignar al menos 4 GB |
| El QR avisa que "solo existe en este computador" | No se detectó la IP de la red | Volver a abrir la app, o poner `URL_PUBLICA=http://<IP-del-PC>:8080` en `.env` (la IP sale con `ipconfig`) |
| La primera transcripción local tarda | Whisper se está cargando | Esperar ~10 s; o usar Groq (sección 3.2) |

Para ver errores del servidor: `docker compose logs --tail=80 backend`. Los errores para la persona nunca
muestran detalles técnicos; cada uno trae un código corto que aparece en esos logs.

---

## 9. Cierre: qué decirle a la persona

Al terminar, resume en pocas líneas:

- La dirección (<http://localhost:8080>), el usuario `medico` y que la contraseña es la que puso en `.env`.
- Qué IA quedó configurada (Groq real o simulada), qué transcripción y qué voz.
- Cómo abrirla (`iniciar.bat` / `./run.sh`) y cómo apagarla.
- Que use **solo datos inventados**.
- Que el manual completo está en `README.md` y las decisiones técnicas en `docs/decisiones.md`.
