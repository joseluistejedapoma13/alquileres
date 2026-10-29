# Mis Alquileres

Sistema web para registrar los pagos de cuartos y locales, saber quién debe y ver
quién adelantó meses. Funciona en el celular y en la computadora, y lo pueden usar
varias personas a la vez (los cambios se ven al instante en todos los equipos).

**Página web:** https://joseluistejedapoma13.github.io/alquileres/

- La página está publicada gratis en **GitHub Pages** (siempre en línea).
- Los datos se guardan en **Firebase** (base de datos gratuita de Google).
- Cada persona entra con **su cuenta de Google**. Solo los correos autorizados pueden ver o registrar.

Proyecto de Firebase: `mis-alquileres-e99e9` (plan gratuito Spark, base de datos en Santiago de Chile).

Para probar sin tocar los datos reales, abre https://joseluistejedapoma13.github.io/alquileres/?demo
(datos de ejemplo que se guardan solo en ese navegador).

### Dar acceso a otra persona (o quitárselo)

1. Entra a https://console.firebase.google.com → proyecto **mis-alquileres** → **Firestore Database** → pestaña **Reglas**.
2. En la lista de correos, agrega el correo de Google de la persona entre comillas y separado por coma:
   ```
   'tu.correo@gmail.com',
   'correo.de.tu.hermano@gmail.com',
   'correo.de.tu.mama@gmail.com'
   ```
3. Pulsa **Publicar**. En un minuto ya puede entrar con «Entrar con Google».

---

## Cómo se usa

| Sección | Para qué sirve |
| --- | --- |
| **Resumen** | Quién debe (y cuánto), quién tiene el pago por vencer, quién está al día y quién adelantó. Totales del mes. |
| **Por mes** | Elige un mes y ve cada inquilino: si pagó, **qué día pagó** y cuántos días antes o después del vencimiento. |
| **Inquilinos** | Ficha de cada inquilino: mes por mes, todos sus pagos, datos, garantía e historial de monto. |
| **Pagos** | Todos los pagos recibidos en un mes y quién los anotó. Toca un pago para corregirlo o borrarlo. |
| **Lugares** | Tus casas, edificios o galerías y sus cuartos/locales (libres u ocupados). |

### Cómo se registran los pagos (mes a mes)

- Cada inquilino genera un cobro por mes desde su **fecha de ingreso**, con vencimiento en su **día de pago**.
- Al registrar un pago **eliges el mes que está pagando**. Aparece ya marcado el mes pendiente más antiguo
  y el monto que falta de ese mes.
  - **Pago de una parte**: deja un solo mes marcado y cambia el monto. Queda como **abono** y se ve cuánto falta.
  - **Adelanto o varios meses juntos**: toca varios meses. Se guarda un pago por cada mes y el total se calcula solo.
  - No se puede poner más dinero del que falta en un mes: para adelantar, marca también los meses siguientes.
- En **Por mes** y en la ficha de cada inquilino, cada mes pendiente tiene un botón **«Pagar»** que abre el
  formulario con ese mes ya elegido.
- Si alguien adelantó meses, aparece como **«Pagado hasta …»**.
- **Deuda vencida** = meses cuyo día de pago ya pasó y no se completaron.
- **Descuento / ajuste**: úsalo para perdonar un monto (por ejemplo, si alguien sale a mitad de mes).
  Cuenta como pagado, pero no suma en «dinero recibido».
- **Cambiar monto**: si subes o bajas el alquiler, eliges desde qué mes. Los meses anteriores no cambian.
- **Terminar alquiler**: cuando alguien se muda. Se cobra hasta el mes de salida y su historial se conserva.
- La **garantía** se guarda aparte; no la registres como pago.

### Avisos al celular: quién paga hoy

Cada mañana a las **8:07 a. m.** (hora de Perú) llega un aviso a la app **ntfy** del celular
con los inquilinos a los que les toca pagar ese día y cuánto falta. Si alguien ya pagó ese mes
por adelantado no se le recuerda, y si alguien debe meses anteriores se menciona al final.
Los días en que no le toca pagar a nadie no llega nada.

- Lo ejecuta GitHub (repositorio privado `alquileres-avisos`), así que funciona con la laptop apagada.
- GitHub lee los datos **sin ninguna clave**: se identifica ante Google (federación de identidades `github`)
  como la cuenta `avisos-alquileres`, que solo tiene permiso de **lectura**. Solo el repositorio
  `alquileres-avisos` puede usarla.
- Para recibirlos: instala **ntfy** (Play Store / App Store), pulsa **+** y suscríbete al canal
  que está guardado en el repositorio privado (el nombre del canal es secreto: compártelo solo con la familia).
- Para mandar un aviso de prueba: repositorio `alquileres-avisos` → **Actions** → **Avisos de pago** → **Run workflow**.

### Instalarla en el celular

Abre la página en el celular → menú del navegador → **«Agregar a la pantalla de inicio»**.
Queda como una aplicación más.

---

## Configuración inicial (ya está hecha; queda como referencia)

### 1. Crear el proyecto de Firebase

1. Entra a https://console.firebase.google.com con tu cuenta de Google.
2. **Crear un proyecto** → nombre: `mis-alquileres` → puedes desactivar Google Analytics → **Crear proyecto**.

### 2. Registrar la página web

1. En la página principal del proyecto, pulsa el ícono **`</>`** (Web).
2. Apodo: `web`. **No** marques Firebase Hosting. Pulsa **Registrar app**.
3. Aparecerá un bloque `const firebaseConfig = { apiKey: "...", ... }`. **Cópialo**.

### 3. Activar el inicio de sesión con Google

1. Menú izquierdo → **Compilación / Build → Authentication** → **Comenzar**.
2. Pestaña **Método de acceso** → **Google** → **Habilitar** → elige tu correo de asistencia → **Guardar**.
3. Pestaña **Configuración** → **Dominios autorizados** → **Agregar dominio** →
   escribe `joseluistejedapoma13.github.io` → **Agregar**.

### 4. Crear la base de datos

1. Menú izquierdo → **Compilación / Build → Firestore Database** → **Crear base de datos**.
2. Edición **Standard**. Ubicación: `southamerica-west1 (Santiago)` (la más cercana a Perú).
3. Elige **Iniciar en modo de producción** → **Crear**.
4. Pestaña **Reglas**: borra todo y pega el contenido del archivo [`firestore.rules`](firestore.rules).
   **Cambia los 3 correos** por el tuyo, el de tu hermano y el de tu mamá (cuentas de Google). Pulsa **Publicar**.

### 5. Conectar la página con Firebase

Edita el archivo [`js/config.js`](js/config.js) y reemplaza el bloque `firebaseConfig` con el que copiaste en el paso 2.
Se puede hacer desde github.com: abre el archivo → ícono del lápiz → pega → **Commit changes**.
En 1–2 minutos la página se actualiza sola.

> Los datos de configuración de Firebase no son secretos: la seguridad la dan las reglas del paso 4.

### 6. Compartir

Envía el enlace https://joseluistejedapoma13.github.io/alquileres/ a tu hermano y a tu mamá.
Cada uno entra con **«Entrar con Google»** usando el correo que pusiste en las reglas.

---

## Detalles técnicos

- Página estática (HTML, CSS y JavaScript sin compilación) publicada con GitHub Pages desde la rama `main`.
- Firebase Authentication (Google) + Cloud Firestore con caché local: abre rápido y permite anotar pagos sin internet;
  se sincroniza al volver la conexión.
- Colecciones: `lugares`, `unidades` (cuartos/locales), `inquilinos`, `pagos`. Cada registro guarda quién lo creó o editó y cuándo.
- El plan gratuito de Firebase (Spark) alcanza de sobra para uso familiar.
- Archivos: `index.html`, `css/estilos.css`, `js/app.js` (pantallas), `js/calc.js` (cálculo de deudas y adelantos),
  `js/store.js` (datos), `js/config.js` (configuración), `firestore.rules` (permisos).
