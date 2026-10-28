// Arma el aviso del día: a quién le toca pagar hoy.
// Es una función pura (no lee ni envía nada) para poder probarla en el navegador.

const nf = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// datos: { lugares, unidades, inquilinos, pagos } · hoy: 'YYYY-MM-DD' (hora de Perú)
// calc: el módulo js/calc.js · moneda: 'S/'
export function armarAviso(datos, hoy, calc, moneda) {
  const dinero = (n) => `${moneda} ${nf.format(n || 0)}`;
  const unidades = new Map(datos.unidades.map((u) => [u.id, u]));
  const lugares = new Map(datos.lugares.map((l) => [l.id, l]));
  const ubicacion = (inq) => {
    const u = unidades.get(inq.unidadId);
    const l = u && lugares.get(u.lugarId);
    return [u?.nombre, l?.nombre].filter(Boolean).join(', ');
  };

  const periodo = calc.periodoDe(hoy);
  const pagan = [];
  const yaPagaron = [];
  const deben = [];
  const proximos = [];

  for (const inq of datos.inquilinos) {
    const pagos = datos.pagos.filter((p) => p.inquilinoId === inq.id);
    const c = calc.estadoCuenta(inq, pagos, hoy);
    if (c.deuda > 0) deben.push({ inq, c });
    if (c.activo && c.proximo && c.proximo.vence > hoy) proximos.push({ inq, m: c.proximo });
    const m = calc.mesDeInquilino(inq, c, periodo);
    if (!m || m.vence !== hoy) continue;
    (m.saldo > 0 ? pagan : yaPagaron).push({ inq, m });
  }

  const porNombre = (a, b) => a.inq.nombre.localeCompare(b.inq.nombre, 'es');
  pagan.sort(porNombre);
  yaPagaron.sort(porNombre);
  proximos.sort((a, b) => a.m.vence.localeCompare(b.m.vence) || porNombre(a, b));

  const lineas = pagan.map(({ inq, m }) => {
    const falta = m.pagado > 0 ? `falta ${dinero(m.saldo)} de ${dinero(m.monto)}` : dinero(m.saldo);
    return `• ${inq.nombre} (${ubicacion(inq)}): ${falta} · ${calc.nombrePeriodo(m.periodo)}`;
  });
  if (yaPagaron.length) {
    lineas.push(`Ya pagaron este mes: ${yaPagaron.map(({ inq }) => inq.nombre).join(', ')}.`);
  }
  if (deben.length) {
    const total = deben.reduce((s, { c }) => s + c.deuda, 0);
    lineas.push(`Además deben meses anteriores: ${deben.map(({ inq }) => inq.nombre).join(', ')} (${dinero(total)}).`);
  }

  let titulo = '';
  if (pagan.length === 1) titulo = `Hoy paga ${pagan[0].inq.nombre}`;
  else if (pagan.length > 1) titulo = `Hoy pagan ${pagan.length} inquilinos`;

  return { titulo, mensaje: lineas.join('\n'), pagan, yaPagaron, deben, proximos };
}

// Mensaje para comprobar que los avisos llegan: muestra los próximos pagos.
export function armarPrueba(aviso, calc, moneda) {
  const dinero = (n) => `${moneda} ${nf.format(n || 0)}`;
  const fecha = (f) => {
    const [, m, d] = f.split('-').map(Number);
    return `${d} de ${calc.MESES[m - 1]}`;
  };
  const lineas = ['Los avisos funcionan. Cada mañana te llegará uno cuando a alguien le toque pagar.'];
  if (aviso.proximos.length) {
    lineas.push('Próximos pagos:');
    for (const { inq, m } of aviso.proximos.slice(0, 5)) {
      lineas.push(`• ${fecha(m.vence)}: ${inq.nombre} (${dinero(m.saldo)})`);
    }
  }
  if (aviso.mensaje) lineas.push('', 'Aviso de hoy:', aviso.mensaje);
  return { titulo: 'Prueba de avisos de alquiler', mensaje: lineas.join('\n') };
}
