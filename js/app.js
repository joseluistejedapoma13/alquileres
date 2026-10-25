import { MONEDA, CODIGO_PAIS } from './config.js';
import * as store from './store.js';
import {
  MESES, estadoCuenta, mesDeInquilino, hoyISO, periodoDe, esPeriodo, sumarMeses,
  nombrePeriodo, montoActual, ordenarPagos, redondear,
} from './calc.js';

const METODOS = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  ajuste: 'Descuento / ajuste',
};
const TIPOS = { cuarto: 'Cuarto', local: 'Local', departamento: 'Departamento', otro: 'Otro' };

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const vista = $('#vista');
const modal = $('#modal');
const pantallas = { carga: $('#pantalla-carga'), login: $('#pantalla-login'), app: $('#app') };

let datos = null; // { lugares, unidades, inquilinos, pagos }
let calc = null; // datos derivados (ver procesar)
let filtroLugar = leerPref('filtroLugar', '');
let busqueda = '';
let verAnteriores = false;

// ---------- Utilidades ----------

function leerPref(clave, porDefecto) {
  try { return localStorage.getItem(`pref-${clave}`) ?? porDefecto; } catch { return porDefecto; }
}
function guardarPref(clave, valor) {
  try { localStorage.setItem(`pref-${clave}`, valor); } catch { /* sin almacenamiento */ }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dinero = (n) => `${MONEDA} ${nf.format(n || 0)}`;
const suma = (lista, f) => redondear(lista.reduce((s, x) => s + (Number(f(x)) || 0), 0));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ordenNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es');
const ordenUnidad = (a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true });

function fechaCorta(f) {
  if (!f) return '';
  const [a, m, d] = f.split('-');
  const mes = MESES[Number(m) - 1].slice(0, 3);
  return a === calc.hoy.slice(0, 4) ? `${Number(d)} ${mes}` : `${Number(d)} ${mes} ${a}`;
}
function fechaLarga(f) {
  if (!f) return '';
  const [a, m, d] = f.split('-');
  return `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`;
}
const fechaHora = (iso) => (iso
  ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : '');

function listaTexto(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
}

// ---------- Datos derivados ----------

function procesar(d) {
  const hoy = hoyISO();
  const pagosPor = new Map();
  for (const p of d.pagos) {
    if (!pagosPor.has(p.inquilinoId)) pagosPor.set(p.inquilinoId, []);
    pagosPor.get(p.inquilinoId).push(p);
  }
  const lugares = new Map(d.lugares.map((l) => [l.id, l]));
  if (filtroLugar && !lugares.has(filtroLugar)) filtroLugar = '';
  return {
    hoy,
    lugares,
    unidades: new Map(d.unidades.map((u) => [u.id, u])),
    inquilinos: new Map(d.inquilinos.map((i) => [i.id, i])),
    pagosPor,
    cuentas: new Map(d.inquilinos.map((i) => [i.id, estadoCuenta(i, pagosPor.get(i.id) || [], hoy)])),
  };
}

const cuenta = (inq) => calc.cuentas.get(inq.id);
const unidadDe = (inq) => calc.unidades.get(inq.unidadId);
const lugarDe = (inq) => calc.lugares.get(unidadDe(inq)?.lugarId);
const enFiltro = (inq) => !filtroLugar || lugarDe(inq)?.id === filtroLugar;
function pagoEnFiltro(p) {
  if (!filtroLugar) return true;
  const inq = calc.inquilinos.get(p.inquilinoId);
  return !!inq && enFiltro(inq);
}
const ocupantesDe = (unidadId) => datos.inquilinos.filter((i) => i.unidadId === unidadId && cuenta(i).activo);

function ubicacion(inq) {
  const u = unidadDe(inq);
  const l = u && calc.lugares.get(u.lugarId);
  return [l?.nombre, u?.nombre].filter(Boolean).join(' · ') || 'Sin cuarto/local asignado';
}

function agruparPorLugar(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const nombre = lugarDe(f.inq)?.nombre || 'Sin lugar';
    if (!grupos.has(nombre)) grupos.set(nombre, []);
    grupos.get(nombre).push(f);
  }
  const nombreUnidad = (f) => unidadDe(f.inq)?.nombre || '';
  return [...grupos]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([nombre, fs]) => [nombre, fs.sort((a, b) => nombreUnidad(a).localeCompare(nombreUnidad(b), 'es', { numeric: true }))]);
}

// ---------- Piezas de interfaz ----------

const chip = (color, texto) => `<span class="chip chip-${color}">${esc(texto)}</span>`;

function chipEstado(c) {
  switch (c.estado) {
    case 'debe': return chip('rojo', `Debe ${dinero(c.deuda)}`);
    case 'por_vencer': return chip('ambar', 'Por vencer');
    case 'adelantado': return chip('azul', `Pagado hasta ${nombrePeriodo(c.pagadoHasta, true)}`);
    case 'finalizado': return chip('gris', 'Ya no alquila');
    default: return chip('verde', 'Al día');
  }
}

function chipMes(m) {
  switch (m.estado) {
    case 'pagado': return chip('verde', 'Pagado');
    case 'parcial': return chip('ambar', `Falta ${dinero(m.saldo)}`);
    case 'vencido': return chip('rojo', m.pagado > 0 ? `Debe ${dinero(m.saldo)}` : 'Vencido');
    default: return chip('gris', 'Pendiente');
  }
}

function textoPago(m) {
  if (m.estado === 'pagado' && m.fechaPago) {
    const d = m.diasAntes;
    const cuando = d > 0 ? `${plural(d, 'día', 'días')} antes`
      : d === 0 ? 'el día que vencía' : `${plural(-d, 'día', 'días')} tarde`;
    return `Pagó el ${fechaCorta(m.fechaPago)} · ${cuando}`;
  }
  if (m.pagado > 0) return `Abonó ${dinero(m.pagado)} · último abono ${fechaCorta(m.fechaPago)}`;
  return '';
}

function lineaPago(m) {
  const texto = textoPago(m);
  if (!texto) return '';
  const clase = m.estado !== 'pagado' ? ''
    : m.diasAntes > 0 ? 'texto-azul' : m.diasAntes < 0 ? 'texto-rojo' : 'texto-verde';
  return `<div class="fila-sub ${clase}">${esc(texto)}</div>`;
}

const encabezado = (titulo, sub = '', accion = '') => `
  <div class="encabezado">
    <div><h1>${esc(titulo)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>
    ${accion}
  </div>`;

const tarjeta = (etiqueta, valor, sub = '', color = '') => `
  <div class="tarjeta">
    <div class="tarjeta-etq">${esc(etiqueta)}</div>
    <div class="tarjeta-valor ${color ? `texto-${color}` : ''}">${esc(valor)}</div>
    ${sub ? `<div class="tarjeta-sub">${esc(sub)}</div>` : ''}
  </div>`;

const vacio = (texto, extra = '') => `<div class="vacio"><p>${esc(texto)}</p>${extra}</div>`;

const botonPago = (inquilinoId, texto = 'Registrar pago') => `
  <button class="btn btn-chico btn-primario" data-accion="pago" data-inquilino="${inquilinoId}">${esc(texto)}</button>`;

// Botón para pagar un mes concreto (solo si falta pagar algo).
const botonPagarMes = (inq, m) => (m.saldo > 0 ? `
  <button class="btn btn-chico" data-accion="pago" data-inquilino="${inq.id}" data-periodo="${m.periodo}">Pagar</button>` : '');

function filtroLugares() {
  if (datos.lugares.length < 2) return '';
  const opciones = [['', 'Todos'], ...[...datos.lugares].sort(ordenNombre).map((l) => [l.id, l.nombre])];
  return `<div class="filtros">${opciones.map(([id, nombre]) => `
    <button class="filtro ${filtroLugar === id ? 'activo' : ''}" data-accion="filtro-lugar" data-id="${id}">${esc(nombre)}</button>`).join('')}
  </div>`;
}

function selectorMes(ruta, periodo) {
  const actual = periodoDe(calc.hoy);
  return `<div class="selector-mes">
    <a class="btn btn-icono" href="#/${ruta}/${sumarMeses(periodo, -1)}" aria-label="Mes anterior">‹</a>
    <strong>${nombrePeriodo(periodo)}</strong>
    <a class="btn btn-icono" href="#/${ruta}/${sumarMeses(periodo, 1)}" aria-label="Mes siguiente">›</a>
    ${periodo !== actual ? `<a class="enlace" href="#/${ruta}/${actual}">Ir a este mes</a>` : ''}
  </div>`;
}

function linkWhatsApp(inq, c) {
  let tel = String(inq.telefono || '').replace(/\D/g, '');
  if (!tel) return '';
  if (tel.length <= 9) tel = CODIGO_PAIS + tel;
  const meses = c.meses.filter((m) => m.vencido).map((m) => nombrePeriodo(m.periodo).toLowerCase());
  const texto = `Hola ${inq.nombre.split(' ')[0]}, te escribimos para recordarte que está pendiente `
    + `el alquiler de ${listaTexto(meses)} por ${dinero(c.deuda)}. ¡Muchas gracias!`;
  return `<a class="btn btn-chico btn-wa" href="https://wa.me/${tel}?text=${encodeURIComponent(texto)}"
    target="_blank" rel="noopener">Recordar por WhatsApp</a>`;
}

// ---------- Vistas ----------

function vistaResumen() {
  if (!datos.inquilinos.length) return bienvenida();
  const actual = periodoDe(calc.hoy);
  const filas = datos.inquilinos.filter(enFiltro)
    .map((inq) => ({ inq, c: cuenta(inq) }))
    .filter(({ c }) => c.activo || c.deuda > 0);
  const deben = filas.filter((f) => f.c.estado === 'debe').sort((a, b) => b.c.deuda - a.c.deuda);
  const porVencer = filas.filter((f) => f.c.estado === 'por_vencer')
    .sort((a, b) => a.c.proximo.vence.localeCompare(b.c.proximo.vence));
  const alDia = filas.filter((f) => f.c.estado === 'al_dia' || f.c.estado === 'adelantado')
    .sort((a, b) => ordenNombre(a.inq, b.inq));
  const pagosMes = datos.pagos.filter((p) => periodoDe(p.fecha) === actual && p.metodo !== 'ajuste' && pagoEnFiltro(p));
  const deuda = suma(deben, (f) => f.c.deuda);
  const adelantados = alDia.filter((f) => f.c.estado === 'adelantado').length;
  const mes = MESES[Number(actual.slice(5)) - 1];

  return `
    ${encabezado('Resumen', `Hoy, ${fechaLarga(calc.hoy)}`)}
    ${filtroLugares()}
    <div class="tarjetas">
      ${tarjeta('Deuda vencida', dinero(deuda), deben.length ? plural(deben.length, 'inquilino debe', 'inquilinos deben') : 'Nadie debe', deuda > 0 ? 'rojo' : 'verde')}
      ${tarjeta(`Cobrado en ${mes}`, dinero(suma(pagosMes, (p) => p.monto)), plural(pagosMes.length, 'pago recibido', 'pagos recibidos'))}
      ${tarjeta('Por cobrar este mes', dinero(suma(porVencer, (f) => f.c.porVencer)), porVencer.length ? `${porVencer.length} aún no vence` : 'Nada pendiente')}
      ${tarjeta('Adelantados', String(adelantados), adelantados ? 'Ya pagaron meses siguientes' : 'Ninguno por ahora', adelantados ? 'azul' : '')}
    </div>
    ${seccionInquilinos('Deben', deben, true)}
    ${seccionInquilinos('Por vencer este mes', porVencer, true)}
    ${seccionInquilinos('Al día', alDia)}
    ${!filas.length ? vacio('No hay inquilinos en este lugar.') : ''}
  `;
}

function seccionInquilinos(titulo, filas, conAcciones = false) {
  if (!filas.length) return '';
  return `<section class="seccion">
    <h2>${esc(titulo)} <span class="contador">${filas.length}</span></h2>
    <div class="lista">${filas.map((f) => filaResumen(f, conAcciones)).join('')}</div>
  </section>`;
}

function filaResumen({ inq, c }, conAcciones) {
  let detalle;
  if (c.estado === 'debe') {
    detalle = `Pendiente: ${c.meses.filter((m) => m.vencido).map((m) => nombrePeriodo(m.periodo, true)).join(', ')}`;
  } else if (c.estado === 'por_vencer') {
    detalle = `${dinero(c.porVencer)} vence el ${fechaCorta(c.proximo.vence)}`;
  } else {
    detalle = `${dinero(montoActual(inq, calc.hoy))} al mes · paga los días ${inq.diaPago}`;
  }
  return `<div class="fila-compuesta">
    <a class="fila fila-principal" href="#/inquilino/${inq.id}">
      <div class="fila-texto">
        <div class="fila-titulo">${esc(inq.nombre)}</div>
        <div class="fila-sub">${esc(ubicacion(inq))}</div>
        <div class="fila-sub">${esc(detalle)}</div>
      </div>
      ${chipEstado(c)}
    </a>
    ${conAcciones ? `<div class="fila-acciones">${botonPago(inq.id)}${c.estado === 'debe' ? linkWhatsApp(inq, c) : ''}</div>` : ''}
  </div>`;
}

function bienvenida() {
  return `
    ${encabezado('Bienvenido', 'Empieza en 3 pasos')}
    <ol class="pasos">
      <li class="${datos.lugares.length && datos.unidades.length ? 'hecho' : ''}">
        <strong>Agrega tus lugares</strong> (casa, edificio, galería…) y sus cuartos o locales.
        <a class="enlace" href="#/lugares">Ir a Lugares</a></li>
      <li><strong>Registra a tus inquilinos</strong> con su monto mensual y día de pago.
        <button class="enlace" data-accion="nuevo-inquilino">Nuevo inquilino</button></li>
      <li><strong>Anota cada pago</strong> con el botón «Pago». El sistema calcula solo quién debe,
        quién está al día y quién adelantó meses.</li>
    </ol>`;
}

function vistaMes(param) {
  const periodo = esPeriodo(param) ? param : periodoDe(calc.hoy);
  const filas = datos.inquilinos.filter(enFiltro)
    .map((inq) => ({ inq, m: mesDeInquilino(inq, cuenta(inq), periodo) }))
    .filter((f) => f.m);
  const esperado = suma(filas, (f) => f.m.monto);
  const cobrado = suma(filas, (f) => f.m.pagado);
  const falta = redondear(esperado - cobrado);
  const pct = esperado ? Math.round((cobrado / esperado) * 100) : 0;
  const completos = filas.filter((f) => f.m.estado === 'pagado').length;

  return `
    ${encabezado('Por mes', 'Quién pagó cada mes y cuándo lo hizo')}
    ${selectorMes('mes', periodo)}
    ${filtroLugares()}
    ${filas.length ? `
      <div class="panel">
        <div class="cifras">
          <div><span class="etq">Cobrado</span><strong>${dinero(cobrado)}</strong></div>
          <div><span class="etq">Esperado</span><strong>${dinero(esperado)}</strong></div>
          <div><span class="etq">Falta</span><strong class="${falta > 0 ? 'texto-rojo' : 'texto-verde'}">${dinero(falta)}</strong></div>
        </div>
        <div class="barra-progreso" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.min(100, pct)}%"></div></div>
        <div class="fila-sub">${pct}% cobrado · ${completos} de ${filas.length} pagaron completo</div>
      </div>
      ${agruparPorLugar(filas).map(([nombre, fs]) => `
        <section class="seccion">
          <h2>${esc(nombre)}</h2>
          <div class="lista">${fs.map(filaMes).join('')}</div>
        </section>`).join('')}`
    : vacio('No hay inquilinos con alquiler en este mes.')}
  `;
}

function filaMes({ inq, m }) {
  const sub = [unidadDe(inq)?.nombre, dinero(m.monto), `vence ${fechaCorta(m.vence)}`].filter(Boolean).join(' · ');
  return `<div class="fila">
    <a class="fila-texto enlace-fila" href="#/inquilino/${inq.id}">
      <div class="fila-titulo">${esc(inq.nombre)}</div>
      <div class="fila-sub">${esc(sub)}</div>
      ${lineaPago(m)}
    </a>
    <div class="fila-lado">${chipMes(m)}${botonPagarMes(inq, m)}</div>
  </div>`;
}

function vistaInquilinos() {
  return `
    ${encabezado('Inquilinos', '', '<button class="btn btn-primario" data-accion="nuevo-inquilino">+ Nuevo</button>')}
    ${filtroLugares()}
    <div class="barra-busqueda">
      <input type="search" id="buscar" placeholder="Buscar por nombre o cuarto…" value="${esc(busqueda)}" autocomplete="off">
      <div class="segmentado" role="group">
        <button class="${verAnteriores ? '' : 'activo'}" data-accion="ver-anteriores" data-valor="0">Actuales</button>
        <button class="${verAnteriores ? 'activo' : ''}" data-accion="ver-anteriores" data-valor="1">Anteriores</button>
      </div>
    </div>
    <div id="lista-inquilinos">${listaInquilinos()}</div>`;
}

function listaInquilinos() {
  const q = normalizar(busqueda);
  const filas = datos.inquilinos
    .filter((i) => enFiltro(i) && cuenta(i).activo !== verAnteriores)
    .filter((i) => !q || normalizar(i.nombre).includes(q) || normalizar(ubicacion(i)).includes(q))
    .sort(ordenNombre);
  if (!filas.length) {
    return vacio(q ? 'Nadie coincide con la búsqueda.'
      : verAnteriores ? 'Aún no hay inquilinos anteriores.' : 'Aún no hay inquilinos registrados.');
  }
  return `<div class="lista">${filas.map((inq) => `
    <a class="fila fila-principal" href="#/inquilino/${inq.id}">
      <div class="fila-texto">
        <div class="fila-titulo">${esc(inq.nombre)}</div>
        <div class="fila-sub">${esc(ubicacion(inq))} · ${dinero(montoActual(inq, calc.hoy))} al mes</div>
      </div>
      ${chipEstado(cuenta(inq))}
    </a>`).join('')}</div>`;
}

function vistaInquilino(id) {
  const inq = calc.inquilinos.get(id);
  if (!inq) return vacio('Este inquilino no existe o fue eliminado.', '<a class="enlace" href="#/inquilinos">Volver a Inquilinos</a>');
  const c = cuenta(inq);
  const pagos = ordenarPagos(calc.pagosPor.get(id) || []).reverse();
  const montos = [...(inq.montos || [])].sort((a, b) => a.desde.localeCompare(b.desde));
  const tel = String(inq.telefono || '').replace(/[^\d+]/g, '');

  return `
    <a class="volver" href="#/inquilinos">‹ Inquilinos</a>
    ${encabezado(inq.nombre, ubicacion(inq), chipEstado(c))}
    <div class="acciones">
      ${botonPago(id)}
      ${c.deuda > 0 ? linkWhatsApp(inq, c) : ''}
      <button class="btn btn-chico" data-accion="editar-inquilino" data-id="${id}">Editar datos</button>
      <button class="btn btn-chico" data-accion="cambiar-monto" data-id="${id}">Cambiar monto</button>
      ${inq.fechaFin
        ? `<button class="btn btn-chico" data-accion="reactivar" data-id="${id}">Reactivar</button>`
        : `<button class="btn btn-chico" data-accion="finalizar" data-id="${id}">Terminar alquiler</button>`}
    </div>
    <div class="tarjetas">
      ${tarjeta('Deuda vencida', dinero(c.deuda), c.mesesDeuda ? plural(c.mesesDeuda, 'mes', 'meses') : 'Sin deuda', c.deuda > 0 ? 'rojo' : 'verde')}
      ${tarjeta('Pagado hasta', c.pagadoHasta ? nombrePeriodo(c.pagadoHasta) : '—',
        c.proximo ? `Próximo: ${dinero(c.proximo.saldo)} el ${fechaCorta(c.proximo.vence)}` : '', c.estado === 'adelantado' ? 'azul' : '')}
      ${tarjeta('Monto mensual', dinero(montoActual(inq, calc.hoy)), `Paga los días ${inq.diaPago}`)}
      ${tarjeta('Total pagado', dinero(c.totalPagado), c.saldoAFavor > 0 ? `A su favor: ${dinero(c.saldoAFavor)}` : plural(pagos.length, 'pago', 'pagos'))}
    </div>

    <section class="seccion">
      <h2>Mes por mes</h2>
      ${c.meses.length ? `<div class="lista">${[...c.meses].reverse().map((m) => `
        <div class="fila">
          <div class="fila-texto">
            <div class="fila-titulo">${nombrePeriodo(m.periodo)}</div>
            <div class="fila-sub">${dinero(m.monto)} · vence ${fechaCorta(m.vence)}</div>
            ${lineaPago(m)}
          </div>
          <div class="fila-lado">${chipMes(m)}${botonPagarMes(inq, m)}</div>
        </div>`).join('')}</div>`
      : vacio(`Su primer mes es ${nombrePeriodo(periodoDe(inq.fechaInicio))}.`)}
    </section>

    <section class="seccion">
      <h2>Pagos registrados <span class="contador">${pagos.length}</span></h2>
      ${pagos.length ? `<div class="lista">${pagos.map((p) => filaPago(p, false)).join('')}</div>` : vacio('Aún no tiene pagos registrados.')}
    </section>

    <section class="seccion">
      <h2>Datos</h2>
      <dl class="panel datos">
        <dt>Teléfono</dt><dd>${tel ? `<a href="tel:${esc(tel)}">${esc(inq.telefono)}</a>` : '—'}</dd>
        <dt>DNI / documento</dt><dd>${esc(inq.documento) || '—'}</dd>
        <dt>Ingresó</dt><dd>${fechaLarga(inq.fechaInicio)}</dd>
        ${inq.fechaFin ? `<dt>Salió</dt><dd>${fechaLarga(inq.fechaFin)}</dd>` : ''}
        <dt>Garantía</dt><dd>${inq.garantia ? dinero(inq.garantia) : '—'}</dd>
        ${montos.length > 1 ? `<dt>Historial de monto</dt><dd>${montos.map((m) => `${esc(dinero(m.monto))} desde ${nombrePeriodo(m.desde, true)}`).join('<br>')}</dd>` : ''}
        ${inq.notas ? `<dt>Notas</dt><dd>${esc(inq.notas)}</dd>` : ''}
      </dl>
    </section>
    <div class="zona-peligro">
      <button class="btn btn-chico btn-texto-rojo" data-accion="eliminar-inquilino" data-id="${id}">Eliminar inquilino</button>
    </div>`;
}

function filaPago(p, conInquilino) {
  const inq = calc.inquilinos.get(p.inquilinoId);
  const mes = p.periodo ? nombrePeriodo(p.periodo) : null;
  let titulo;
  if (conInquilino) titulo = inq?.nombre || 'Inquilino eliminado';
  else titulo = mes || fechaLarga(p.fecha);
  const sub = [
    conInquilino && mes ? `Mes: ${mes}` : null,
    conInquilino || mes ? `pagó el ${fechaCorta(p.fecha)}` : null,
    conInquilino && inq ? ubicacion(inq) : null,
    METODOS[p.metodo] || p.metodo,
    p.creadoPor?.nombre ? `anotó ${p.creadoPor.nombre}` : null,
  ].filter(Boolean).join(' · ');
  return `<button class="fila fila-principal" data-accion="editar-pago" data-id="${p.id}">
    <div class="fila-texto">
      <div class="fila-titulo">${esc(titulo)}</div>
      <div class="fila-sub">${esc(sub)}</div>
      ${p.nota ? `<div class="fila-nota">${esc(p.nota)}</div>` : ''}
    </div>
    <div class="monto ${p.metodo === 'ajuste' ? 'monto-ajuste' : ''}">${dinero(p.monto)}</div>
  </button>`;
}

function vistaPagos(param) {
  const periodo = esPeriodo(param) ? param : periodoDe(calc.hoy);
  const pagos = datos.pagos
    .filter((p) => periodoDe(p.fecha) === periodo && pagoEnFiltro(p))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creadoEn || '').localeCompare(a.creadoEn || ''));
  const cobrados = pagos.filter((p) => p.metodo !== 'ajuste');
  return `
    ${encabezado('Pagos', 'Dinero recibido según la fecha en que pagaron', '<button class="btn btn-primario" data-accion="pago">+ Registrar</button>')}
    ${selectorMes('pagos', periodo)}
    ${filtroLugares()}
    <p class="resumen-linea">${plural(cobrados.length, 'pago', 'pagos')} · Total recibido: <strong>${dinero(suma(cobrados, (p) => p.monto))}</strong></p>
    ${pagos.length ? `<div class="lista">${pagos.map((p) => filaPago(p, true)).join('')}</div>` : vacio('No hay pagos registrados en este mes.')}`;
}

function vistaLugares() {
  const lugares = [...datos.lugares].sort(ordenNombre);
  return `
    ${encabezado('Lugares', 'Tus propiedades y sus cuartos o locales', '<button class="btn btn-primario" data-accion="nuevo-lugar">+ Nuevo lugar</button>')}
    ${lugares.length ? '' : vacio('Empieza agregando un lugar (por ejemplo: «Casa de Av. Grau») y luego sus cuartos o locales.')}
    ${lugares.map((l) => {
      const unidades = datos.unidades.filter((u) => u.lugarId === l.id).sort(ordenUnidad);
      const libres = unidades.filter((u) => !ocupantesDe(u.id).length).length;
      return `<section class="seccion">
        <div class="encabezado-lugar">
          <div>
            <h2>${esc(l.nombre)}</h2>
            <p class="sub">${esc([l.direccion, unidades.length ? `${plural(unidades.length, 'espacio', 'espacios')} · ${plural(libres, 'libre', 'libres')}` : ''].filter(Boolean).join(' · '))}</p>
          </div>
          <button class="btn btn-chico" data-accion="editar-lugar" data-id="${l.id}">Editar</button>
        </div>
        <div class="lista">
          ${unidades.map((u) => {
            const ocupantes = ocupantesDe(u.id);
            const detalle = ocupantes.length
              ? ocupantes.map((i) => `<a class="enlace" href="#/inquilino/${i.id}">${esc(i.nombre)}</a> · ${esc(dinero(montoActual(i, calc.hoy)))}`).join('<br>')
              : `<span class="texto-verde">Libre</span>${u.montoReferencial ? ` · ${esc(dinero(u.montoReferencial))}` : ''}`;
            return `<div class="fila">
              <div class="fila-texto">
                <div class="fila-titulo">${esc(u.nombre)} <span class="etiqueta">${esc(TIPOS[u.tipo] || u.tipo)}</span></div>
                <div class="fila-sub">${detalle}</div>
              </div>
              <button class="btn btn-chico" data-accion="editar-unidad" data-id="${u.id}">Editar</button>
            </div>`;
          }).join('')}
          <button class="fila fila-principal fila-agregar" data-accion="nueva-unidad" data-lugar="${l.id}">+ Agregar cuarto o local</button>
        </div>
      </section>`;
    }).join('')}`;
}

// ---------- Navegación ----------

const VISTAS = {
  resumen: vistaResumen,
  mes: vistaMes,
  inquilinos: vistaInquilinos,
  inquilino: vistaInquilino,
  pagos: vistaPagos,
  lugares: vistaLugares,
};

function render() {
  if (!datos) return;
  const [nombre, param] = location.hash.replace(/^#\/?/, '').split('/');
  const ruta = VISTAS[nombre] ? nombre : 'resumen';
  const cambioDeVista = vista.dataset.ruta !== `${ruta}/${param || ''}`;
  vista.dataset.ruta = `${ruta}/${param || ''}`;
  vista.innerHTML = VISTAS[ruta](param);
  const seccion = ruta === 'inquilino' ? 'inquilinos' : ruta;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('activo', a.dataset.ruta === seccion));
  if (cambioDeVista) window.scrollTo(0, 0);
}

// ---------- Ventanas (formularios) ----------

// alGuardar(datosDelFormulario) devuelve: nada = cerrar, texto = mostrar error, false = no cerrar.
function abrirModal(titulo, cuerpo, { alGuardar, alEliminar, textoGuardar = 'Guardar' } = {}) {
  modal.innerHTML = `<form class="modal-form">
    <header class="modal-cabecera">
      <h2>${esc(titulo)}</h2>
      <button type="button" class="btn-icono btn-cerrar" data-cerrar aria-label="Cerrar">×</button>
    </header>
    <div class="modal-cuerpo">${cuerpo}<p class="error" hidden></p></div>
    <footer class="modal-pie">
      ${alEliminar ? '<button type="button" class="btn btn-texto-rojo" data-eliminar>Eliminar</button>' : ''}
      <span class="espacio"></span>
      <button type="button" class="btn" data-cerrar>Cancelar</button>
      <button type="submit" class="btn btn-primario">${esc(textoGuardar)}</button>
    </footer>
  </form>`;
  const form = $('form', modal);
  const error = $('.error', form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const resultado = alGuardar(Object.fromEntries(new FormData(form)), form);
    if (typeof resultado === 'string') {
      error.textContent = resultado;
      error.hidden = false;
    } else if (resultado !== false) {
      modal.close();
    }
  });
  form.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => modal.close()));
  $('[data-eliminar]', form)?.addEventListener('click', () => {
    if (alEliminar() !== false) modal.close();
  });
  modal.showModal();
  $('.modal-cuerpo', form).scrollTop = 0;
  return form;
}

function opcionesInquilinos(seleccionado) {
  const lista = datos.inquilinos.filter((i) => i.id === seleccionado || cuenta(i).activo || cuenta(i).deuda > 0);
  return `<option value="" disabled ${seleccionado ? '' : 'selected'}>Elige un inquilino…</option>
    ${agruparPorLugar(lista.map((inq) => ({ inq }))).map(([nombre, fs]) => `
      <optgroup label="${esc(nombre)}">${fs.map(({ inq }) => {
        const c = cuenta(inq);
        const unidad = unidadDe(inq)?.nombre;
        return `<option value="${inq.id}" ${inq.id === seleccionado ? 'selected' : ''}>${esc(inq.nombre)}${unidad ? ` — ${esc(unidad)}` : ''}${c.deuda > 0 ? ` (debe ${esc(dinero(c.deuda))})` : ''}</option>`;
      }).join('')}</optgroup>`).join('')}`;
}

// Cuenta del inquilino sin contar el pago que se está editando.
function cuentaSinPago(inq, pagoId) {
  if (!pagoId) return cuenta(inq);
  return estadoCuenta(inq, (calc.pagosPor.get(inq.id) || []).filter((p) => p.id !== pagoId), calc.hoy);
}

// Meses que se pueden pagar: desde el pendiente más antiguo hasta un año adelante.
function mesesParaPagar(inq, c, incluir = '') {
  const primero = [c.meses.find((m) => m.saldo > 0)?.periodo || c.proximo?.periodo, incluir]
    .filter(Boolean).sort()[0];
  if (!primero) return [];
  const ultimo = [sumarMeses(primero, 11), sumarMeses(periodoDe(calc.hoy), 11)].sort().at(-1);
  const lista = [];
  for (let p = primero; p <= ultimo; p = sumarMeses(p, 1)) {
    const m = mesDeInquilino(inq, c, p);
    if (!m) break;
    lista.push(m);
  }
  return lista;
}

function botonesMeses(lista, elegidos, verTodos) {
  if (!lista.length) return '<p class="meta">No hay meses por pagar.</p>';
  // Al inicio se muestran unos 6 meses; el resto con «Más meses».
  const limite = [sumarMeses(lista[0].periodo, 5), sumarMeses(periodoDe(calc.hoy), 2), ...elegidos].sort().at(-1);
  const visibles = verTodos ? lista : lista.filter((m) => m.periodo <= limite);
  const mas = visibles.length < lista.length
    ? '<button type="button" class="mes-op mes-mas" data-mas>Más meses…</button>' : '';
  return visibles.map((m) => {
    const pagado = m.saldo <= 0;
    let estado;
    let clase = '';
    if (pagado) {
      estado = 'Pagado';
      clase = 'pagado';
    } else if (m.vencido) {
      estado = m.pagado > 0 ? `Debe ${dinero(m.saldo)}` : `Vencido ${dinero(m.saldo)}`;
      clase = 'vencido';
    } else if (m.pagado > 0) {
      estado = `Falta ${dinero(m.saldo)}`;
      clase = 'parcial';
    } else {
      estado = dinero(m.saldo);
    }
    const elegido = elegidos.includes(m.periodo);
    return `<button type="button" class="mes-op ${clase} ${elegido ? 'elegido' : ''}" data-periodo="${m.periodo}"
      aria-pressed="${elegido}" ${pagado ? 'disabled' : ''}>
      <strong>${nombrePeriodo(m.periodo, true)}</strong><span>${esc(estado)}</span>
    </button>`;
  }).join('') + mas;
}

function modalPago({ inquilinoId = '', pagoId = null, periodo = '' } = {}) {
  const pago = pagoId ? datos.pagos.find((p) => p.id === pagoId) : null;
  if (pagoId && !pago) return toast('Ese pago ya no existe.', 'error');
  if (!datos.inquilinos.length) {
    toast('Primero registra a un inquilino.');
    location.hash = '#/inquilinos';
    return;
  }
  const seleccionado = pago?.inquilinoId || inquilinoId;
  const metodo = pago?.metodo || 'efectivo';

  const form = abrirModal(pago ? 'Editar pago' : 'Registrar pago', `
    <label class="campo"><span>Inquilino</span>
      <select name="inquilinoId" required>${opcionesInquilinos(seleccionado)}</select></label>
    <div class="campo">
      <span>${pago ? 'Mes que paga' : 'Mes que paga · toca uno o varios'}</span>
      <div class="meses-pago" id="meses-pago"></div>
    </div>
    <div class="campos-2">
      <label class="campo"><span id="etq-monto">Monto (${esc(MONEDA)})</span>
        <input name="monto" type="number" inputmode="decimal" min="0.01" step="0.01" required></label>
      <label class="campo"><span>Fecha en que pagó</span>
        <input name="fecha" type="date" required value="${pago?.fecha || calc.hoy}"></label>
    </div>
    <label class="campo"><span>Forma de pago</span>
      <select name="metodo">${Object.entries(METODOS).map(([k, v]) => `<option value="${k}" ${metodo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="campo"><span>Nota (opcional)</span>
      <input name="nota" value="${esc(pago?.nota)}" placeholder="Ej.: N° de operación, pagó su hermano…" autocomplete="off"></label>
    <div class="previa" id="previa"></div>
    ${pago ? `<p class="meta">Anotado por ${esc(pago.creadoPor?.nombre || '—')} el ${esc(fechaHora(pago.creadoEn))}${pago.editadoPor ? ` · editado por ${esc(pago.editadoPor.nombre)} el ${esc(fechaHora(pago.editadoEn))}` : ''}</p>` : ''}`, {
    textoGuardar: pago ? 'Guardar cambios' : 'Registrar pago',
    alGuardar(d) {
      if (!elegidos.length) return 'Elige el mes que está pagando.';
      const base = { inquilinoId: d.inquilinoId, fecha: d.fecha, metodo: d.metodo, nota: d.nota.trim() };
      const nombre = calc.inquilinos.get(d.inquilinoId)?.nombre || '';
      if (elegidos.length === 1) {
        const m = disponibles.get(elegidos[0]);
        const monto = redondear(Number(d.monto));
        if (!(monto > 0)) return 'El monto debe ser mayor a cero.';
        if (monto > m.saldo + 0.005) {
          return `El monto es mayor a lo que falta de ${nombrePeriodo(m.periodo)} (${dinero(m.saldo)}). Para adelantar, elige también los meses siguientes.`;
        }
        store.guardar('pagos', pagoId, { ...base, periodo: m.periodo, monto });
        toast(pago ? 'Pago actualizado' : `${nombre}: ${nombrePeriodo(m.periodo)} — ${dinero(monto)} registrado`);
        return;
      }
      // Varios meses: un pago por cada mes, por lo que falta de cada uno.
      for (const p of [...elegidos].sort()) {
        store.guardar('pagos', null, { ...base, periodo: p, monto: disponibles.get(p).saldo });
      }
      toast(`${nombre}: ${elegidos.length} meses — ${dinero(suma(elegidos, (p) => disponibles.get(p).saldo))} registrado`);
    },
    alEliminar: pago && (() => {
      const mes = pago.periodo ? ` de ${nombrePeriodo(pago.periodo)}` : '';
      if (!confirm(`¿Eliminar el pago${mes} de ${dinero(pago.monto)} (${fechaLarga(pago.fecha)})?`)) return false;
      store.eliminar('pagos', pagoId);
      toast('Pago eliminado');
    }),
  });

  const caja = $('#meses-pago', form);
  const { monto } = form.elements;
  let disponibles = new Map();
  let elegidos = [];
  let verTodos = false;

  const actualizar = (reiniciarMonto) => {
    caja.innerHTML = disponibles.size ? botonesMeses([...disponibles.values()], elegidos, verTodos)
      : '<p class="meta">Primero elige el inquilino.</p>';
    const lista = elegidos.map((p) => disponibles.get(p));
    if (lista.length > 1) {
      monto.readOnly = true;
      monto.value = suma(lista, (m) => m.saldo);
      $('#etq-monto', form).textContent = `Total de ${lista.length} meses (${MONEDA})`;
    } else {
      monto.readOnly = false;
      if (reiniciarMonto) monto.value = lista[0]?.saldo ?? '';
      $('#etq-monto', form).textContent = `Monto (${MONEDA})`;
    }
    mostrarPrevia(form, pago, lista);
  };

  const cargarInquilino = (primeraVez) => {
    const inq = calc.inquilinos.get(form.elements.inquilinoId.value);
    if (!inq) {
      disponibles = new Map();
      elegidos = [];
      actualizar(true);
      return;
    }
    const c = cuentaSinPago(inq, pagoId);
    const inicial = primeraVez ? (pago?.periodo || periodo) : '';
    disponibles = new Map(mesesParaPagar(inq, c, inicial).map((m) => [m.periodo, m]));
    const porDefecto = [...disponibles.values()].find((m) => m.saldo > 0)?.periodo;
    elegidos = [disponibles.get(inicial)?.saldo > 0 ? inicial : porDefecto].filter(Boolean);
    actualizar(true);
    if (primeraVez && pago) monto.value = pago.monto;
    if (primeraVez) mostrarPrevia(form, pago, elegidos.map((p) => disponibles.get(p)));
  };

  caja.addEventListener('click', (e) => {
    const boton = e.target.closest('.mes-op');
    if (!boton || boton.disabled) return;
    if (boton.hasAttribute('data-mas')) {
      verTodos = true;
      actualizar(false);
      return;
    }
    const p = boton.dataset.periodo;
    if (pago) elegidos = [p];
    else if (elegidos.includes(p)) elegidos = elegidos.filter((x) => x !== p);
    else elegidos = [...elegidos, p].sort();
    actualizar(true);
  });
  form.elements.inquilinoId.addEventListener('change', () => cargarInquilino(false));
  form.addEventListener('input', (e) => {
    if (e.target.name === 'monto' || e.target.name === 'fecha') {
      mostrarPrevia(form, pago, elegidos.map((p) => disponibles.get(p)));
    }
  });
  cargarInquilino(true);
}

// Resume lo que quedará registrado antes de guardar.
function mostrarPrevia(form, pagoEditado, lista) {
  const caja = $('#previa', form);
  const inq = calc.inquilinos.get(form.elements.inquilinoId.value);
  const fecha = form.elements.fecha.value;
  const monto = redondear(Number(form.elements.monto.value));
  if (!inq || !lista.length || !fecha || !(monto > 0)) {
    caja.innerHTML = '';
    return;
  }
  const nuevos = lista.length === 1
    ? [{ id: '__nuevo0', periodo: lista[0].periodo, monto, fecha }]
    : lista.map((m, i) => ({ id: `__nuevo${i}`, periodo: m.periodo, monto: m.saldo, fecha }));
  const otros = (calc.pagosPor.get(inq.id) || []).filter((p) => p.id !== pagoEditado?.id);
  const c = estadoCuenta(inq, [...otros, ...nuevos], calc.hoy);

  if (lista.length === 1 && monto > lista[0].saldo + 0.005) {
    caja.innerHTML = `<span class="texto-rojo">El monto es mayor a lo que falta de ${nombrePeriodo(lista[0].periodo)}
      (${esc(dinero(lista[0].saldo))}). Para adelantar, elige también los meses siguientes.</span>`;
    return;
  }
  const items = nuevos.map((n) => {
    const m = c.meses.find((x) => x.periodo === n.periodo);
    return `<li><strong>${nombrePeriodo(n.periodo)}</strong>: ${esc(dinero(n.monto))} — ${
      m && m.saldo > 0 ? `<span class="texto-ambar">quedará faltando ${esc(dinero(m.saldo))}</span>` : '<span class="texto-verde">queda pagado</span>'}</li>`;
  });

  let despues;
  if (c.deuda > 0) {
    const pendientes = c.meses.filter((m) => m.vencido).map((m) => nombrePeriodo(m.periodo, true));
    despues = `<span class="texto-rojo">Seguirá debiendo ${esc(dinero(c.deuda))} (${esc(pendientes.join(', '))})</span>`;
  } else if (c.pagadoHasta) {
    despues = `Quedará <strong>pagado hasta ${nombrePeriodo(c.pagadoHasta)}</strong>`;
  } else {
    despues = 'Sin deuda';
  }

  caja.innerHTML = `<div class="previa-titulo">Se registrará:</div>
    <ul>${items.join('')}</ul>
    <div class="previa-despues">${despues}</div>`;
}

function opcionesUnidades(seleccionada, excluirInquilino) {
  const grupos = [...datos.lugares].sort(ordenNombre).map((l) => {
    const unidades = datos.unidades.filter((u) => u.lugarId === l.id).sort(ordenUnidad);
    if (!unidades.length) return '';
    return `<optgroup label="${esc(l.nombre)}">${unidades.map((u) => {
      const ocupantes = ocupantesDe(u.id).filter((i) => i.id !== excluirInquilino);
      const estado = ocupantes.length ? `ocupado: ${ocupantes.map((i) => i.nombre).join(', ')}` : 'libre';
      return `<option value="${u.id}" data-monto="${u.montoReferencial ?? ''}" ${u.id === seleccionada ? 'selected' : ''}>${esc(u.nombre)} (${esc(estado)})</option>`;
    }).join('')}</optgroup>`;
  }).join('');
  return `<option value="" disabled ${seleccionada ? '' : 'selected'}>Elige…</option>${grupos}`;
}

function modalInquilino(id = null) {
  const inq = id ? calc.inquilinos.get(id) : null;
  if (!datos.unidades.length) {
    toast('Primero agrega un lugar y sus cuartos o locales.');
    location.hash = '#/lugares';
    return;
  }
  const form = abrirModal(inq ? 'Editar inquilino' : 'Nuevo inquilino', `
    <label class="campo"><span>Nombre completo</span>
      <input name="nombre" required value="${esc(inq?.nombre)}" autocomplete="off"></label>
    <label class="campo"><span>Cuarto o local</span>
      <select name="unidadId" required>${opcionesUnidades(inq?.unidadId, id)}</select></label>
    <div class="campos-2">
      <label class="campo"><span>Celular / WhatsApp</span>
        <input name="telefono" type="tel" inputmode="tel" value="${esc(inq?.telefono)}" autocomplete="off"></label>
      <label class="campo"><span>DNI / documento</span>
        <input name="documento" value="${esc(inq?.documento)}" autocomplete="off"></label>
    </div>
    <div class="campos-2">
      <label class="campo"><span>Fecha de ingreso</span>
        <input name="fechaInicio" type="date" required value="${inq?.fechaInicio || calc.hoy}"></label>
      <label class="campo"><span>Día de pago de cada mes</span>
        <input name="diaPago" type="number" inputmode="numeric" min="1" max="31" required value="${inq?.diaPago || Number(calc.hoy.slice(8))}"></label>
    </div>
    ${inq ? '' : `<label class="campo"><span>Monto mensual (${esc(MONEDA)})</span>
      <input name="monto" type="number" inputmode="decimal" min="0" step="0.01" required></label>`}
    <label class="campo"><span>Garantía (${esc(MONEDA)}, opcional)</span>
      <input name="garantia" type="number" inputmode="decimal" min="0" step="0.01" value="${inq?.garantia ?? ''}"></label>
    <label class="campo"><span>Notas (opcional)</span>
      <textarea name="notas" rows="2">${esc(inq?.notas)}</textarea></label>
    ${inq ? '<p class="meta">Para cambiar el monto mensual usa el botón «Cambiar monto» en su ficha.</p>'
      : '<p class="meta">La garantía se guarda aparte y no cuenta como pago de alquiler.</p>'}`, {
    textoGuardar: inq ? 'Guardar cambios' : 'Registrar inquilino',
    alGuardar(d) {
      if (inq?.fechaFin && d.fechaInicio > inq.fechaFin) return 'La fecha de ingreso no puede ser posterior a la de salida.';
      const otros = ocupantesDe(d.unidadId).filter((i) => i.id !== id);
      if (otros.length && inq?.unidadId !== d.unidadId) {
        const unidad = calc.unidades.get(d.unidadId);
        if (!confirm(`${unidad.nombre} ya está ocupado por ${otros.map((i) => i.nombre).join(', ')}. ¿Registrar de todas formas?`)) return false;
      }
      const base = {
        nombre: d.nombre.trim(),
        unidadId: d.unidadId,
        telefono: d.telefono.trim(),
        documento: d.documento.trim(),
        fechaInicio: d.fechaInicio,
        diaPago: Number(d.diaPago),
        garantia: d.garantia ? Number(d.garantia) : null,
        notas: d.notas.trim(),
      };
      if (!inq) {
        base.montos = [{ desde: periodoDe(d.fechaInicio), monto: Number(d.monto) }];
        base.fechaFin = null;
      } else {
        // Si se adelanta la fecha de ingreso, el primer monto rige desde el nuevo inicio.
        const montos = [...(inq.montos || [])].sort((a, b) => a.desde.localeCompare(b.desde));
        if (montos[0] && montos[0].desde > periodoDe(d.fechaInicio)) {
          montos[0] = { ...montos[0], desde: periodoDe(d.fechaInicio) };
          base.montos = montos;
        }
      }
      const nuevoId = store.guardar('inquilinos', id, base);
      toast(inq ? 'Datos actualizados' : `${base.nombre} registrado`);
      if (!inq) location.hash = `#/inquilino/${nuevoId}`;
    },
  });

  if (!inq) {
    // Sugerencias: el monto del cuarto elegido y el día de pago según la fecha de ingreso.
    const { unidadId, monto, fechaInicio, diaPago } = form.elements;
    let diaTocado = false;
    diaPago.addEventListener('input', () => { diaTocado = true; });
    unidadId.addEventListener('change', () => {
      const sugerido = unidadId.selectedOptions[0]?.dataset.monto;
      if (sugerido && !monto.value) monto.value = sugerido;
    });
    fechaInicio.addEventListener('change', () => {
      if (!diaTocado && fechaInicio.value) diaPago.value = Number(fechaInicio.value.slice(8));
    });
  }
}

function modalMonto(id) {
  const inq = calc.inquilinos.get(id);
  if (!inq) return;
  const actual = periodoDe(calc.hoy);
  const historial = [...(inq.montos || [])].sort((a, b) => a.desde.localeCompare(b.desde));
  const opciones = [];
  for (let p = periodoDe(inq.fechaInicio); p <= sumarMeses(actual, 12); p = sumarMeses(p, 1)) opciones.push(p);
  const porDefecto = opciones.includes(sumarMeses(actual, 1)) ? sumarMeses(actual, 1) : opciones[0];

  abrirModal('Cambiar monto mensual', `
    <p>${esc(inq.nombre)} paga actualmente <strong>${esc(dinero(montoActual(inq, calc.hoy)))}</strong> al mes.</p>
    <div class="campos-2">
      <label class="campo"><span>Nuevo monto (${esc(MONEDA)})</span>
        <input name="monto" type="number" inputmode="decimal" min="0" step="0.01" required></label>
      <label class="campo"><span>A partir de</span>
        <select name="desde">${opciones.map((p) => `<option value="${p}" ${p === porDefecto ? 'selected' : ''}>${nombrePeriodo(p)}</option>`).join('')}</select></label>
    </div>
    <p class="meta">Los meses anteriores conservan su monto.
      Historial: ${historial.map((m) => `${esc(dinero(m.monto))} desde ${nombrePeriodo(m.desde, true)}`).join(' → ')}</p>`, {
    alGuardar(d) {
      const montos = historial.filter((m) => m.desde !== d.desde)
        .concat({ desde: d.desde, monto: Number(d.monto) })
        .sort((a, b) => a.desde.localeCompare(b.desde));
      store.guardar('inquilinos', id, { montos });
      toast('Monto actualizado');
    },
  });
}

function modalFinalizar(id) {
  const inq = calc.inquilinos.get(id);
  if (!inq) return;
  abrirModal('Terminar alquiler', `
    <p><strong>${esc(inq.nombre)}</strong> deja ${esc(ubicacion(inq))}.</p>
    <label class="campo"><span>Fecha de salida</span>
      <input type="date" name="fechaFin" required value="${calc.hoy}" min="${inq.fechaInicio}"></label>
    <p class="meta">Se cobra hasta el mes de salida (incluido). Si queda debiendo, seguirá apareciendo en «Deben».
      Si se va a mitad de mes y no corresponde cobrar el mes completo, registra un pago con forma «Descuento / ajuste».</p>`, {
    textoGuardar: 'Terminar alquiler',
    alGuardar(d) {
      store.guardar('inquilinos', id, { fechaFin: d.fechaFin });
      toast('Alquiler terminado');
    },
  });
}

function reactivar(id) {
  const inq = calc.inquilinos.get(id);
  if (!inq || !confirm(`¿Reactivar a ${inq.nombre}? Se le volverán a cobrar los meses desde su salida.`)) return;
  store.guardar('inquilinos', id, { fechaFin: null });
  toast(`${inq.nombre} reactivado`);
}

function eliminarInquilino(id) {
  const inq = calc.inquilinos.get(id);
  if (!inq) return;
  const pagos = calc.pagosPor.get(id) || [];
  const mensaje = pagos.length
    ? `¿Eliminar a ${inq.nombre} y sus ${pagos.length} pagos registrados? Esto no se puede deshacer.\n\nSi solo se mudó, usa «Terminar alquiler» para conservar su historial.`
    : `¿Eliminar a ${inq.nombre}?`;
  if (!confirm(mensaje)) return;
  pagos.forEach((p) => store.eliminar('pagos', p.id));
  store.eliminar('inquilinos', id);
  location.hash = '#/inquilinos';
  toast('Inquilino eliminado');
}

function modalLugar(id = null) {
  const l = id ? calc.lugares.get(id) : null;
  abrirModal(l ? 'Editar lugar' : 'Nuevo lugar', `
    <label class="campo"><span>Nombre</span>
      <input name="nombre" required placeholder="Ej.: Casa de Av. Grau" value="${esc(l?.nombre)}" autocomplete="off"></label>
    <label class="campo"><span>Dirección (opcional)</span>
      <input name="direccion" value="${esc(l?.direccion)}" autocomplete="off"></label>
    <label class="campo"><span>Notas (opcional)</span>
      <textarea name="notas" rows="2">${esc(l?.notas)}</textarea></label>`, {
    alGuardar(d) {
      const nuevoId = store.guardar('lugares', id, { nombre: d.nombre.trim(), direccion: d.direccion.trim(), notas: d.notas.trim() });
      toast(l ? 'Lugar actualizado' : 'Lugar agregado. Ahora agrega sus cuartos o locales.');
      if (!l) setTimeout(() => modalUnidad({ lugarId: nuevoId }), 50);
    },
    alEliminar: l && (() => {
      if (datos.unidades.some((u) => u.lugarId === id)) {
        alert('Primero elimina o mueve los cuartos y locales de este lugar.');
        return false;
      }
      if (!confirm(`¿Eliminar «${l.nombre}»?`)) return false;
      store.eliminar('lugares', id);
      toast('Lugar eliminado');
    }),
  });
}

function modalUnidad({ id = null, lugarId = '' }) {
  const u = id ? calc.unidades.get(id) : null;
  const lugar = u?.lugarId || lugarId;
  const tipo = u?.tipo || 'cuarto';
  abrirModal(u ? 'Editar cuarto o local' : 'Nuevo cuarto o local', `
    <label class="campo"><span>Lugar</span>
      <select name="lugarId" required>${[...datos.lugares].sort(ordenNombre).map((l) => `<option value="${l.id}" ${l.id === lugar ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>
    <div class="campos-2">
      <label class="campo"><span>Nombre</span>
        <input name="nombre" required placeholder="Ej.: Cuarto 3, Local A" value="${esc(u?.nombre)}" autocomplete="off"></label>
      <label class="campo"><span>Tipo</span>
        <select name="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="campo"><span>Precio de referencia (${esc(MONEDA)}, opcional)</span>
      <input name="montoReferencial" type="number" inputmode="decimal" min="0" step="0.01" value="${u?.montoReferencial ?? ''}"></label>`, {
    textoGuardar: u ? 'Guardar cambios' : 'Agregar',
    alGuardar(d) {
      store.guardar('unidades', id, {
        lugarId: d.lugarId,
        nombre: d.nombre.trim(),
        tipo: d.tipo,
        montoReferencial: d.montoReferencial ? Number(d.montoReferencial) : null,
      });
      toast(u ? 'Cambios guardados' : `${d.nombre.trim()} agregado`);
    },
    alEliminar: u && (() => {
      const usados = datos.inquilinos.filter((i) => i.unidadId === id);
      if (usados.length) {
        alert(`No se puede eliminar porque tiene inquilinos registrados (${usados.map((i) => i.nombre).join(', ')}). Cámbialos de cuarto primero.`);
        return false;
      }
      if (!confirm(`¿Eliminar «${u.nombre}»?`)) return false;
      store.eliminar('unidades', id);
      toast('Eliminado');
    }),
  });
}

// ---------- Avisos ----------

let temporizadorToast;
function toast(mensaje, tipo = '') {
  const t = $('#toast');
  t.textContent = mensaje;
  t.className = `toast visible ${tipo}`;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => { t.className = 'toast'; }, 3500);
}

function mostrar(nombre) {
  for (const [clave, el] of Object.entries(pantallas)) el.hidden = clave !== nombre;
}

function errorLogin(mensaje) {
  const el = $('#login-error');
  el.textContent = mensaje;
  el.hidden = !mensaje;
}

// ---------- Eventos ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  const { accion, id, inquilino, lugar, valor, periodo } = el.dataset;
  switch (accion) {
    case 'pago': modalPago({ inquilinoId: inquilino, periodo }); break;
    case 'editar-pago': modalPago({ pagoId: id }); break;
    case 'nuevo-inquilino': modalInquilino(); break;
    case 'editar-inquilino': modalInquilino(id); break;
    case 'cambiar-monto': modalMonto(id); break;
    case 'finalizar': modalFinalizar(id); break;
    case 'reactivar': reactivar(id); break;
    case 'eliminar-inquilino': eliminarInquilino(id); break;
    case 'nuevo-lugar': modalLugar(); break;
    case 'editar-lugar': modalLugar(id); break;
    case 'nueva-unidad': modalUnidad({ lugarId: lugar }); break;
    case 'editar-unidad': modalUnidad({ id }); break;
    case 'filtro-lugar':
      filtroLugar = id;
      guardarPref('filtroLugar', id);
      render();
      break;
    case 'ver-anteriores':
      verAnteriores = valor === '1';
      render();
      break;
    case 'salir': store.salir(); break;
    default: break;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'buscar') return;
  busqueda = e.target.value;
  $('#lista-inquilinos').innerHTML = listaInquilinos();
});

window.addEventListener('hashchange', render);

// Si la página quedó abierta de un día para otro, recalcula al volver.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && datos && hoyISO() !== calc.hoy) {
    calc = procesar(datos);
    render();
  }
});

$('#btn-entrar').addEventListener('click', async () => {
  errorLogin('');
  try {
    await store.entrar();
  } catch (err) {
    const mensajes = {
      'auth/popup-closed-by-user': '',
      'auth/cancelled-popup-request': '',
      'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo otra vez.',
      'auth/unauthorized-domain': 'Esta dirección web no está autorizada en Firebase (revisa el paso «Dominios autorizados» del README).',
      'auth/network-request-failed': 'Sin conexión a internet. Inténtalo otra vez.',
    };
    errorLogin(err.code in mensajes ? mensajes[err.code] : `No se pudo entrar: ${err.message}`);
  }
});

if (store.modoDemo) {
  $('#login-demo').hidden = false;
  $('#aviso-demo').hidden = false;
  $('#btn-entrar-texto').textContent = 'Entrar a la demo';
}

store.iniciar({
  alUsuario(usuario) {
    datos = null;
    if (!usuario) {
      modal.close();
      mostrar('login');
      return;
    }
    $('#usuario-nombre').textContent = usuario.nombre;
    mostrar('carga');
  },
  alDatos(nuevos) {
    datos = nuevos;
    calc = procesar(nuevos);
    if (pantallas.app.hidden) mostrar('app');
    render();
  },
  alError(err) {
    console.error(err);
    if (err.code === 'permission-denied') {
      if (!datos) {
        // No pudo ni leer: el correo no está en la lista de acceso.
        const correo = store.usuarioActual()?.email;
        if (!correo) return;
        store.salir();
        errorLogin(`La cuenta ${correo} no tiene permiso para usar el sistema. Pide que agreguen tu correo a la lista de acceso.`);
      } else {
        toast('No tienes permiso para guardar este cambio.', 'error');
      }
      return;
    }
    toast(`Ocurrió un error: ${err.message}`, 'error');
  },
}).catch((err) => {
  console.error(err);
  mostrar('login');
  errorLogin('No se pudo cargar el sistema. Revisa tu conexión a internet y recarga la página.');
});
