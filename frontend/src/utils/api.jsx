import { apiUrl } from './config.jsx';

function notificarSesionInvalida(mensaje) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('chipactli:auth-invalid', {
    detail: {
      mensaje: mensaje || 'Tu sesión expiró. Inicia sesión nuevamente.'
    }
  }));
}

export async function fetchAPI(endpoint, options = {}) {
  const url = apiUrl(endpoint);
  const defaultOptions = { headers: {} };
  const config = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...(options.headers || {})
    }
  };
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const isURLParams = typeof URLSearchParams !== 'undefined' && options.body instanceof URLSearchParams;
  if (options.body && typeof options.body === 'object' && !isFormData && !isURLParams) {
    config.body = JSON.stringify(options.body);
    if (!config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/json';
    }
  }
  
  const respuesta = await fetch(url, config);
  return respuesta;
}

export async function fetchAPIJSON(endpoint, options = {}) {
  const respuesta = await fetchAPI(endpoint, options);
  if (!respuesta.ok) {
    let error = null;
    try {
      error = await respuesta.json();
    } catch {
      error = null;
    }
    const detalle = String(error?.detalle || '').trim();
    const base = error?.mensaje || error?.error || `Error HTTP ${respuesta.status}`;
    const mensajeError = detalle ? `${base}: ${detalle}` : base;
    const esAuthPublico = /\/auth\/(login|configuracion-inicial)$/i.test(endpoint);
    if (respuesta.status === 401 && !esAuthPublico) {
      notificarSesionInvalida(mensajeError);
    }
    throw new Error(mensajeError);
  }
  return await respuesta.json();
}
