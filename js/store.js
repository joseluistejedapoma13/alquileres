// Acceso a los datos.
//
// Con Firebase configurado usa Firestore: los datos se comparten en tiempo real
// entre todos los que entran con una cuenta autorizada. Sin configurar,
// funciona en "modo demo" y guarda todo en este navegador.
import { firebaseConfig } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
export const COLECCIONES = ['lugares', 'unidades', 'inquilinos', 'pagos'];
export const modoDemo = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('PEGA');

let usuario = null;
let backend = null;

export const usuarioActual = () => usuario;

// eventos: { alUsuario(usuario|null), alDatos(datos), alError(error) }
export async function iniciar(eventos) {
  backend = modoDemo ? crearDemo(eventos) : await crearFirebase(eventos);
}

export const entrar = () => backend.entrar();
export const salir = () => backend.salir();

// Crea (id = null) o actualiza un documento. Devuelve su id.
export function guardar(coleccion, id, datos) {
  const ahora = new Date().toISOString();
  const firma = { email: usuario?.email || '', nombre: usuario?.nombre || '' };
  const extra = id ? { editadoEn: ahora, editadoPor: firma } : { creadoEn: ahora, creadoPor: firma };
  // JSON quita los campos undefined, que Firestore no acepta.
  return backend.guardar(coleccion, id, JSON.parse(JSON.stringify({ ...datos, ...extra })));
}

export const eliminar = (coleccion, id) => backend.eliminar(coleccion, id);

async function crearFirebase({ alUsuario, alDatos, alError }) {
  const [{ initializeApp }, fa, ff] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = fa.getAuth(app);
  // Caché local: la página abre rápido y permite registrar sin internet;
  // los cambios se suben solos cuando vuelve la conexión.
  const db = ff.initializeFirestore(app, {
    localCache: ff.persistentLocalCache({ tabManager: ff.persistentMultipleTabManager() }),
  });
  let cancelar = [];

  fa.onAuthStateChanged(auth, (u) => {
    cancelar.forEach((c) => c());
    cancelar = [];
    usuario = u ? { email: u.email, nombre: u.displayName || u.email.split('@')[0] } : null;
    alUsuario(usuario);
    if (!u) return;
    const datos = {};
    for (const col of COLECCIONES) {
      cancelar.push(ff.onSnapshot(ff.collection(db, col), (snap) => {
        datos[col] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (COLECCIONES.every((c) => datos[c])) alDatos({ ...datos });
      }, alError));
    }
  });

  return {
    entrar() {
      const proveedor = new fa.GoogleAuthProvider();
      proveedor.setCustomParameters({ prompt: 'select_account' });
      return fa.signInWithPopup(auth, proveedor);
    },
    salir: () => fa.signOut(auth),
    // No se espera la respuesta del servidor: el cambio aparece al instante
    // (y se sincroniza después si no hay internet).
    guardar(col, id, datos) {
      const ref = id ? ff.doc(db, col, id) : ff.doc(ff.collection(db, col));
      ff.setDoc(ref, datos, { merge: true }).catch(alError);
      return ref.id;
    },
    eliminar(col, id) {
      ff.deleteDoc(ff.doc(db, col, id)).catch(alError);
    },
  };
}

function crearDemo({ alUsuario, alDatos }) {
  const CLAVE = 'alquileres-demo-v1';
  const SESION = 'alquileres-demo-sesion';
  let datos = null;
  try { datos = JSON.parse(localStorage.getItem(CLAVE)); } catch { /* sin almacenamiento */ }
  if (!datos) datos = datosEjemplo();

  const avisar = () => queueMicrotask(() => alDatos(structuredClone(datos)));
  const persistir = () => {
    try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
    avisar();
  };
  const iniciarSesion = () => {
    usuario = { email: 'demo@ejemplo.com', nombre: 'Demo' };
    alUsuario(usuario);
    avisar();
  };

  let recordado = false;
  try { recordado = localStorage.getItem(SESION) === '1'; } catch { /* sin almacenamiento */ }
  queueMicrotask(() => (recordado ? iniciarSesion() : alUsuario(null)));

  return {
    entrar() {
      try { localStorage.setItem(SESION, '1'); } catch { /* sin almacenamiento */ }
      iniciarSesion();
    },
    salir() {
      try { localStorage.removeItem(SESION); } catch { /* sin almacenamiento */ }
      usuario = null;
      alUsuario(null);
    },
    guardar(col, id, d) {
      const nuevoId = id || Math.random().toString(36).slice(2, 12);
      const lista = datos[col];
      const i = lista.findIndex((x) => x.id === nuevoId);
      if (i >= 0) lista[i] = { ...lista[i], ...d };
      else lista.push({ id: nuevoId, ...d });
      persistir();
      return nuevoId;
    },
    eliminar(col, id) {
      datos[col] = datos[col].filter((x) => x.id !== id);
      persistir();
    },
  };
}

// Datos de ejemplo para el modo demo, con fechas relativas a hoy.
function datosEjemplo() {
  const hoy = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  const fecha = (mesesAtras, dia) => {
    if (mesesAtras === 0) dia = Math.min(dia, hoy.getDate());
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - mesesAtras, dia);
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  };
  const periodo = (mesesAtras) => fecha(mesesAtras, 1).slice(0, 7);
  const firma = { email: 'demo@ejemplo.com', nombre: 'Demo' };
  let n = 0;
  const pago = (inquilinoId, monto, f, metodo = 'efectivo', nota = '') => ({
    id: `p${++n}`, inquilinoId, monto, fecha: f, metodo, nota,
    creadoEn: `${f}T12:00:00.000Z`, creadoPor: firma,
  });

  return {
    lugares: [
      { id: 'l1', nombre: 'Casa Av. Los Olivos', direccion: 'Av. Los Olivos 123' },
      { id: 'l2', nombre: 'Galería Jr. Lima', direccion: 'Jr. Lima 456' },
    ],
    unidades: [
      { id: 'u1', lugarId: 'l1', nombre: 'Cuarto 1', tipo: 'cuarto', montoReferencial: 450 },
      { id: 'u2', lugarId: 'l1', nombre: 'Cuarto 2', tipo: 'cuarto', montoReferencial: 400 },
      { id: 'u3', lugarId: 'l1', nombre: 'Cuarto 3', tipo: 'cuarto', montoReferencial: 400 },
      { id: 'u4', lugarId: 'l2', nombre: 'Local 1', tipo: 'local', montoReferencial: 1200 },
      { id: 'u5', lugarId: 'l2', nombre: 'Local 2', tipo: 'local', montoReferencial: 900 },
    ],
    inquilinos: [
      { id: 'i1', nombre: 'María Quispe', unidadId: 'u1', telefono: '987654321', documento: '45678912',
        fechaInicio: fecha(5, 1), fechaFin: null, diaPago: 5, montos: [{ desde: periodo(5), monto: 450 }], garantia: 450, notas: '' },
      { id: 'i2', nombre: 'Carlos Ramos', unidadId: 'u2', telefono: '912345678', documento: '41234567',
        fechaInicio: fecha(4, 10), fechaFin: null, diaPago: 10, montos: [{ desde: periodo(4), monto: 400 }], garantia: 400, notas: '' },
      { id: 'i3', nombre: 'Rosa Mamani', unidadId: 'u4', telefono: '956789123', documento: '40987654',
        fechaInicio: fecha(6, 1), fechaFin: null, diaPago: 1,
        montos: [{ desde: periodo(6), monto: 1100 }, { desde: periodo(2), monto: 1200 }], garantia: 2200, notas: 'Venta de abarrotes' },
      { id: 'i4', nombre: 'Pedro Huamán', unidadId: 'u5', telefono: '934567812', documento: '43216789',
        fechaInicio: fecha(3, 15), fechaFin: null, diaPago: 15, montos: [{ desde: periodo(3), monto: 900 }], garantia: 900, notas: '' },
      { id: 'i5', nombre: 'Luis Condori', unidadId: 'u3', telefono: '', documento: '',
        fechaInicio: fecha(10, 1), fechaFin: fecha(4, 28), diaPago: 1, montos: [{ desde: periodo(10), monto: 380 }], garantia: null, notas: '' },
    ],
    pagos: [
      ...[5, 4, 3, 2, 1, 0].map((m) => pago('i1', 450, fecha(m, 3), m % 2 ? 'yape' : 'efectivo')),
      pago('i2', 400, fecha(4, 9)),
      pago('i2', 400, fecha(3, 12), 'yape'),
      ...[6, 5, 4, 3].map((m) => pago('i3', 1100, fecha(m, 1), 'transferencia')),
      ...[2, 1].map((m) => pago('i3', 1200, fecha(m, 1), 'transferencia')),
      pago('i3', 3600, fecha(0, 1), 'transferencia', 'Adelantó 3 meses'),
      pago('i4', 900, fecha(3, 14)),
      pago('i4', 900, fecha(2, 20), 'efectivo', 'Pagó tarde'),
      pago('i4', 900, fecha(1, 15), 'plin'),
      pago('i4', 400, fecha(0, 10), 'efectivo', 'A cuenta'),
      ...[10, 9, 8, 7, 6, 5, 4].map((m) => pago('i5', 380, fecha(m, 2))),
    ],
  };
}
