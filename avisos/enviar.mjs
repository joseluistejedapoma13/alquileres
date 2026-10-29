// Envía al celular (app ntfy) el aviso de quién paga hoy y quién tiene pagos atrasados.
// Lo ejecuta GitHub Actions cada mañana desde el repositorio privado
// "alquileres-avisos"; no necesita que la laptop esté prendida.
//
// Acceso a los datos: GitHub se identifica ante Google sin clave (federación de
// identidades) como la cuenta de servicio de solo lectura "avisos-alquileres".
//
// Variables de entorno:
//   NTFY_TOPIC   nombre del canal de ntfy al que están suscritos los celulares
//   FIREBASE_SA  (opcional) clave JSON de una cuenta de servicio, en lugar de la federación
//   PRUEBA=1     envía un aviso de prueba aunque hoy no haya nada que avisar
//   HOY          fecha a usar (YYYY-MM-DD), solo para probar
import { readFile } from 'node:fs/promises';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { armarAviso, armarPrueba } from './aviso.mjs';

const PAGINA = 'https://joseluistejedapoma13.github.io/alquileres/#/mes';

// Usa los mismos archivos que la página (cálculo y moneda).
async function cargar(ruta) {
  const fuente = await readFile(new URL(ruta, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(fuente).toString('base64')}`);
}
const calc = await cargar('../js/calc.js');
const { MONEDA, firebaseConfig } = await cargar('../js/config.js');

const hoy = process.env.HOY
  || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

if (!process.env.NTFY_TOPIC) throw new Error('Falta el secreto NTFY_TOPIC en el repositorio de avisos.');

initializeApp({
  credential: process.env.FIREBASE_SA ? cert(JSON.parse(process.env.FIREBASE_SA)) : applicationDefault(),
  projectId: firebaseConfig.projectId,
});
const db = getFirestore();
const leer = async (coleccion) => (await db.collection(coleccion).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const [lugares, unidades, inquilinos, pagos] = await Promise.all(
  ['lugares', 'unidades', 'inquilinos', 'pagos'].map(leer),
);

const aviso = armarAviso({ lugares, unidades, inquilinos, pagos }, hoy, calc, MONEDA);
const enviar = process.env.PRUEBA ? armarPrueba(aviso, calc, MONEDA) : aviso;

// En el registro no se escriben nombres ni montos.
console.log(`${hoy}: ${aviso.pagan.length} pagan hoy, ${aviso.yaPagaron.length} ya pagaron, ${aviso.atrasados.length} con pagos atrasados.`);

if (!enviar.titulo) {
  console.log('Hoy no le toca pagar a nadie y nadie está atrasado: no se envía aviso.');
} else {
  const respuesta = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: process.env.NTFY_TOPIC,
      title: enviar.titulo,
      message: enviar.mensaje,
      tags: aviso.atrasados.length ? ['moneybag', 'warning'] : ['moneybag'],
      priority: 4,
      click: PAGINA,
    }),
  });
  if (!respuesta.ok) throw new Error(`ntfy respondió ${respuesta.status}`);
  console.log('Aviso enviado.');
}
