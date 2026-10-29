// Arma el aviso del día: a quién le toca pagar hoy y quién tiene pagos atrasados.
// Es una función pura (no lee ni envía nada) para poder probarla en el navegador.

const nf = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Meses atrasados que se detallan por inquilino; si hay más se resumen en una línea.
const MAX_MESES = 6;

// datos: { lugares, unidades, inquilinos, pagos } · hoy: 'YYYY-MM-DD' (hora de Perú)
// calc: el módulo js/calc.js · moneda: 'S/'
export function armarAviso(datos, hoy, calc, moneda) {
  const dinero = (n) => `${moneda} ${nf.format(n || 0)}`;
  const fecha = (f) => {
    const [, m, d] = f.split('-').map(Number);
    return `${d} de ${calc.MESES[m - 1]}`;
  };
  const unidades = new Map(datos.unidades.map((u) => [u.id, u]));
  const lugares = new Map(datos.lugares.map((l) => [l.id, l]));
  const ubicacion = (inq) => {
    const u = unidades.get(inq.unidadId);
    const l = u && lugares.get(u.lugarId);
    return [u?.nombre, l?.nombre].filter(Boolean).join(', ');
  };
  const falta = (m) => (m.pagado > 0 ? `falta ${dinero(m.saldo)} de ${dinero(m.monto)}` : dinero(m.saldo));

  const periodo = calc.periodoDe(hoy);
  const pagan = [];
  const yaPagaron = [];
  const atrasados = [];
  const proximos = [];

  for (const inq of datos.inquilinos) {
    const pagos = datos.pagos.filter((p) => p.inquilinoId === inq.id);
    const c = calc.estadoCuenta(inq, pagos, hoy);
    if (c.deuda > 0) atrasados.push({ inq, c, meses: c.meses.filter((m) => m.vencido) });
    if (c.activo && c.proximo && c.proximo.vence > hoy) proximos.push({ inq, m: c.proximo });
    const m = calc.mesDeInquilino(inq, c, periodo);
    if (!m || m.vence !== hoy) continue;
    (m.saldo > 0 ? pagan : yaPagaron).push({ inq, m });
  }

  const porNombre = (a, b) => a.inq.nombre.localeCompare(b.inq.nombre, 'es');
  pagan.sort(porNombre);
  yaPagaron.sort(porNombre);
  proximos.sort((a, b) => a.m.vence.localeCompare(b.m.vence) || porNombre(a, b));
  // Primero quien lleva más tiempo sin pagar.
  atrasados.sort((a, b) => a.meses[0].vence.localeCompare(b.meses[0].vence) || porNombre(a, b));

  const lineas = [];
  if (pagan.length) {
    lineas.push('HOY LE TOCA PAGAR');
    for (const { inq, m } of pagan) {
      lineas.push(`• ${inq.nombre} (${ubicacion(inq)}): ${falta(m)} · ${calc.nombrePeriodo(m.periodo)}`);
    }
  }
  if (yaPagaron.length) {
    lineas.push(`Ya pagaron este mes: ${yaPagaron.map(({ inq }) => inq.nombre).join(', ')}.`);
  }
  if (atrasados.length) {
    if (lineas.length) lineas.push('');
    lineas.push('PAGOS ATRASADOS');
    for (const { inq, c, meses } of atrasados) {
      const salio = c.activo ? '' : ' · ya no vive ahí';
      const cuantos = meses.length === 1 ? '1 mes' : `${meses.length} meses`;
      lineas.push(`• ${inq.nombre} (${ubicacion(inq)}${salio}): debe ${dinero(c.deuda)} (${cuantos})`);
      for (const m of meses.slice(0, MAX_MESES)) {
        const dias = calc.diasEntre(m.vence, hoy);
        const hace = dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
        lineas.push(`   ${calc.nombrePeriodo(m.periodo)}: ${falta(m)} · venció el ${fecha(m.vence)} (${hace})`);
      }
      if (meses.length > MAX_MESES) {
        const resto = meses.slice(MAX_MESES);
        const suma = resto.reduce((s, m) => s + m.saldo, 0);
        const hasta = calc.nombrePeriodo(resto.at(-1).periodo).toLowerCase();
        lineas.push(`   y ${resto.length} meses más (hasta ${hasta}): ${dinero(suma)}`);
      }
    }
    if (atrasados.length > 1) {
      lineas.push(`Total atrasado: ${dinero(atrasados.reduce((s, { c }) => s + c.deuda, 0))}`);
    }
  }

  let titulo = '';
  if (pagan.length === 1) titulo = `Hoy paga ${pagan[0].inq.nombre}`;
  else if (pagan.length > 1) titulo = `Hoy pagan ${pagan.length} inquilinos`;
  if (titulo && atrasados.length) {
    titulo += atrasados.length === 1 ? ' · 1 atrasado' : ` · ${atrasados.length} atrasados`;
  } else if (atrasados.length === 1) {
    titulo = `Pago atrasado: ${atrasados[0].inq.nombre}`;
  } else if (atrasados.length > 1) {
    titulo = `Pagos atrasados: ${atrasados.length} inquilinos`;
  }

  return { titulo, mensaje: lineas.join('\n'), pagan, yaPagaron, atrasados, proximos };
}

// Mensaje para comprobar que los avisos llegan: muestra los próximos pagos.
export function armarPrueba(aviso, calc, moneda) {
  const dinero = (n) => `${moneda} ${nf.format(n || 0)}`;
  const fecha = (f) => {
    const [, m, d] = f.split('-').map(Number);
    return `${d} de ${calc.MESES[m - 1]}`;
  };
  const lineas = ['Los avisos funcionan. Cada mañana te llegará uno cuando a alguien le toque pagar o tenga pagos atrasados.'];
  if (aviso.proximos.length) {
    lineas.push('Próximos pagos:');
    for (const { inq, m } of aviso.proximos.slice(0, 5)) {
      lineas.push(`• ${fecha(m.vence)}: ${inq.nombre} (${dinero(m.saldo)})`);
    }
  }
  if (aviso.mensaje) lineas.push('', 'Aviso de hoy:', aviso.mensaje);
  return { titulo: 'Prueba de avisos de alquiler', mensaje: lineas.join('\n') };
}
