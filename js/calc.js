// Cálculo de la cuenta de cada inquilino.
//
// Cada mes desde que entró genera un cobro (su monto mensual). Los pagos se
// aplican por orden de fecha al mes más antiguo que falte pagar; si sobra
// dinero pasa al mes siguiente. Así un pago grande queda como adelanto de los
// meses que vienen, y un pago chico queda como abono del mes pendiente.

const EPS = 0.005;

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const dos = (n) => String(n).padStart(2, '0');
export const redondear = (n) => Math.round(n * 100) / 100;

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// "2026-10-24" -> "2026-10"
export const periodoDe = (fecha) => fecha.slice(0, 7);
export const esPeriodo = (p) => /^\d{4}-\d{2}$/.test(p || '');

export function sumarMeses(periodo, n) {
  const [a, m] = periodo.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${dos((total % 12) + 1)}`;
}

export function nombrePeriodo(periodo, corto = false) {
  const [a, m] = periodo.split('-').map(Number);
  const mes = MESES[m - 1];
  return corto ? `${mes.slice(0, 3)} ${a}` : `${mes[0].toUpperCase()}${mes.slice(1)} ${a}`;
}

function diasDelMes(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

export function fechaVencimiento(periodo, diaPago) {
  const dia = Math.min(Math.max(1, Number(diaPago) || 1), diasDelMes(periodo));
  return `${periodo}-${dos(dia)}`;
}

const partes = (f) => {
  const [a, m, d] = f.split('-').map(Number);
  return [a, m - 1, d];
};

// Días de a hasta b (positivo si b es posterior a a).
export function diasEntre(a, b) {
  return Math.round((Date.UTC(...partes(b)) - Date.UTC(...partes(a))) / 86400000);
}

// montos: [{ desde: 'YYYY-MM', monto }] — el último cambio vigente en ese mes.
export function montoDelMes(montos, periodo) {
  const lista = [...(montos || [])].sort((x, y) => x.desde.localeCompare(y.desde));
  let monto = lista[0]?.monto ?? 0;
  for (const m of lista) if (m.desde <= periodo) monto = m.monto;
  return Number(monto) || 0;
}

export const montoActual = (inq, hoy = hoyISO()) => montoDelMes(inq.montos, periodoDe(hoy));

export function ordenarPagos(pagos) {
  return [...pagos].sort((a, b) => a.fecha.localeCompare(b.fecha)
    || (a.creadoEn || '').localeCompare(b.creadoEn || ''));
}

export function estadoCuenta(inq, pagosInq, hoy = hoyISO()) {
  const actual = periodoDe(hoy);
  const inicio = periodoDe(inq.fechaInicio);
  const fin = inq.fechaFin ? periodoDe(inq.fechaFin) : null;
  // Se cobra hasta el mes actual (o hasta el mes de salida si ya se fue).
  const ultimoCobro = fin && fin < actual ? fin : actual;

  const cola = ordenarPagos(pagosInq).map((p) => ({ ...p, resto: Number(p.monto) || 0 }));
  let i = 0;
  const meses = [];

  for (let p = inicio; meses.length < 600; p = sumarMeses(p, 1)) {
    while (i < cola.length && cola[i].resto <= EPS) i++;
    if (fin && p > fin) break;
    // Después del mes actual solo se generan meses si hay dinero adelantado.
    if (p > ultimoCobro && i >= cola.length) break;
    const monto = montoDelMes(inq.montos, p);
    if (p > ultimoCobro && monto <= 0) break;

    const mes = {
      periodo: p, monto, pagado: 0, aplicaciones: [], fechaCompleto: null,
      vence: fechaVencimiento(p, inq.diaPago),
    };
    let falta = monto;
    while (falta > EPS && i < cola.length) {
      const pago = cola[i];
      const usar = Math.min(falta, pago.resto);
      pago.resto -= usar;
      falta -= usar;
      mes.pagado += usar;
      mes.aplicaciones.push({ pagoId: pago.id, fecha: pago.fecha, monto: redondear(usar) });
      if (pago.resto <= EPS) i++;
      if (falta <= EPS) mes.fechaCompleto = pago.fecha;
    }
    mes.pagado = redondear(mes.pagado);
    mes.saldo = redondear(Math.max(0, monto - mes.pagado));
    meses.push(mes);
  }

  for (const m of meses) {
    m.vencido = m.saldo > EPS && hoy > m.vence;
    if (m.saldo <= EPS) m.estado = 'pagado';
    else if (m.vencido) m.estado = 'vencido';
    else m.estado = m.pagado > EPS ? 'parcial' : 'pendiente';
    m.fechaPago = m.fechaCompleto || m.aplicaciones.at(-1)?.fecha || null;
    // Positivo: pagó esos días antes del vencimiento. Negativo: pagó tarde.
    m.diasAntes = m.fechaPago ? diasEntre(m.fechaPago, m.vence) : null;
  }

  const vencidos = meses.filter((m) => m.vencido);
  const deuda = redondear(vencidos.reduce((s, m) => s + m.saldo, 0));
  const mesActual = meses.find((m) => m.periodo === actual);
  const porVencer = mesActual && !mesActual.vencido ? mesActual.saldo : 0;

  let pagadoHasta = null;
  for (const m of meses) {
    if (m.saldo > EPS) break;
    pagadoHasta = m.periodo;
  }

  let proximo = meses.find((m) => m.saldo > EPS) || null;
  if (!proximo) {
    const p = meses.length ? sumarMeses(meses.at(-1).periodo, 1) : inicio;
    if (!fin || p <= fin) {
      const monto = montoDelMes(inq.montos, p);
      proximo = { periodo: p, monto, saldo: monto, vence: fechaVencimiento(p, inq.diaPago) };
    }
  }

  const activo = !inq.fechaFin || inq.fechaFin >= hoy;
  let estado;
  if (deuda > EPS) estado = 'debe';
  else if (!activo) estado = 'finalizado';
  else if (pagadoHasta && pagadoHasta > actual) estado = 'adelantado';
  else if (porVencer > EPS) estado = 'por_vencer';
  else estado = 'al_dia';

  return {
    meses,
    deuda,
    mesesDeuda: vencidos.length,
    porVencer,
    pagadoHasta,
    proximo,
    saldoAFavor: redondear(cola.reduce((s, p) => s + Math.max(0, p.resto), 0)),
    totalPagado: redondear(cola.reduce((s, p) => s + (Number(p.monto) || 0), 0)),
    activo,
    estado,
  };
}

// Situación de un inquilino en un mes concreto (null si no vivía ahí ese mes).
export function mesDeInquilino(inq, cuenta, periodo) {
  const inicio = periodoDe(inq.fechaInicio);
  const fin = inq.fechaFin ? periodoDe(inq.fechaFin) : null;
  if (periodo < inicio || (fin && periodo > fin)) return null;
  const mes = cuenta.meses.find((m) => m.periodo === periodo);
  if (mes) return mes;
  const monto = montoDelMes(inq.montos, periodo);
  return {
    periodo, monto, pagado: 0, saldo: monto, aplicaciones: [], estado: 'pendiente',
    vence: fechaVencimiento(periodo, inq.diaPago), fechaPago: null, diasAntes: null, vencido: false,
  };
}
