export function normalizarTextoBusqueda(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function incluyeBusqueda(texto, termino) {
  const t = normalizarTextoBusqueda(termino);
  if (!t) return true;
  return normalizarTextoBusqueda(texto).includes(t);
}
