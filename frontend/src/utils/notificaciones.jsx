// Sistema de Notificaciones y Alertas

export const alertas = [];
export const alertasPorClave = new Map();
export const historialAlertas = [];
export const MAX_HISTORIAL_ALERTAS = 200;
const CLAVE_TAB_ALERTAS = 'chipactli:alertas:tab';
let pestanaAlertasActual = 'activas';
let audioCtx = null;
let audioAlertaPreparado = false;

let conteoAlertas = 0;
let onEnterCerrarNotificacion = null;
let timerCerrarNotificacion = null;
const CLAVE_SONIDO_NOTIFICACION = 'chipactli_notif_sound';
let sonidoSeleccionado = 'clasico';

export const OPCIONES_SONIDO_NOTIFICACION = [
  { value: 'clasico', label: 'Clásico' },
  { value: 'suave', label: 'Suave' },
  { value: 'campana', label: 'Campana' },
  { value: 'digital', label: 'Digital' },
  { value: 'silencio', label: 'Sin sonido' }
];

function cargarSonidoSeleccionado() {
  if (typeof window === 'undefined') return;
  try {
    const guardado = String(localStorage.getItem(CLAVE_SONIDO_NOTIFICACION) || '').trim().toLowerCase();
    if (OPCIONES_SONIDO_NOTIFICACION.some((item) => item.value === guardado)) {
      sonidoSeleccionado = guardado;
    }
  } catch {
    // Ignorar errores de storage.
  }
}

function presetSonidoValido(preset) {
  const clave = String(preset || '').trim().toLowerCase();
  return OPCIONES_SONIDO_NOTIFICACION.some((item) => item.value === clave) ? clave : 'clasico';
}

export function obtenerSonidoNotificacion() {
  return sonidoSeleccionado;
}

export function configurarSonidoNotificacion(preset) {
  const clave = presetSonidoValido(preset);
  sonidoSeleccionado = clave;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(CLAVE_SONIDO_NOTIFICACION, clave);
    } catch {
      // Ignorar errores de storage.
    }
  }
  return clave;
}

cargarSonidoSeleccionado();

function cargarPestanaAlertasGuardada() {
  if (typeof window === 'undefined') return;
  try {
    const guardada = String(localStorage.getItem(CLAVE_TAB_ALERTAS) || '').trim();
    if (guardada === 'activas' || guardada === 'historial') {
      pestanaAlertasActual = guardada;
    }
  } catch {
    // Ignorar errores de storage.
  }
}

function guardarPestanaAlertasActual() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLAVE_TAB_ALERTAS, pestanaAlertasActual);
  } catch {
    // Ignorar errores de storage.
  }
}

cargarPestanaAlertasGuardada();

export function obtenerPestanaAlertasActual() {
  return pestanaAlertasActual === 'historial' ? 'historial' : 'activas';
}

export function actualizarUIAlertas() {
  const lista = document.getElementById('listaAlertas');
  const listaHistorial = document.getElementById('listaAlertasHistorial');
  const distintivo = document.getElementById('conteoAlertas');
  if (!lista || !listaHistorial || !distintivo) return;

  lista.innerHTML = '';
  listaHistorial.innerHTML = '';
  if (alertas.length === 0) {
    const item = document.createElement('div');
    item.className = 'elementoAlerta';
    item.textContent = 'Sin alertas';
    item.style.cursor = 'default';
    lista.appendChild(item);
  } else {
    alertas.forEach(alerta => {
      const item = document.createElement('div');
      item.className = `elementoAlerta${alerta.tipo ? ' ' + alerta.tipo : ''}`;
      item.innerHTML = `
        <div>${alerta.mensaje}</div>
        <div class="fechaAlerta">${formatearFechaAlerta(alerta.fecha)}</div>
      `;
      if (alerta?.destino?.hash || alerta?.destino?.page) {
        item.title = 'Abrir detalle';
      }
      item.addEventListener('click', () => {
        if (alerta?.destino) {
          try {
            window.dispatchEvent(new CustomEvent('chipactli:alerta-click', {
              detail: {
                clave: alerta.clave,
                mensaje: alerta.mensaje,
                destino: alerta.destino,
                meta: alerta.meta || null
              }
            }));
          } catch {
            // Ignorar errores de dispatch.
          }

          const hashDestino = String(alerta?.destino?.hash || '').trim();
          if (hashDestino) {
            window.location.hash = hashDestino;
          }
        }
        moverAlertaAHistorial(alerta.clave);
      });
      lista.appendChild(item);
    });
  }

  if (historialAlertas.length === 0) {
    const item = document.createElement('div');
    item.className = 'elementoAlerta';
    item.textContent = 'Historial vacio';
    item.style.cursor = 'default';
    listaHistorial.appendChild(item);
  } else {
    historialAlertas.forEach(alerta => {
      const item = document.createElement('div');
      item.className = 'elementoAlerta';
      item.innerHTML = `
        <div>${alerta.mensaje}</div>
        <div class="fechaAlerta">${formatearFechaAlerta(alerta.fecha)}</div>
      `;
      item.style.cursor = 'default';
      listaHistorial.appendChild(item);
    });
  }

  conteoAlertas = alertas.length;
  if (conteoAlertas > 0) {
    distintivo.textContent = String(conteoAlertas);
    distintivo.classList.remove('oculto');
  } else {
    distintivo.textContent = '';
    distintivo.classList.add('oculto');
  }
}

export function agregarAlerta(clave, mensaje, tipo = '', opciones = {}) {
  const destino = opciones?.destino || null;
  const meta = opciones?.meta || null;
  if (alertasPorClave.has(clave)) {
    const alertaExistente = alertasPorClave.get(clave);
    alertaExistente.mensaje = mensaje;
    alertaExistente.tipo = tipo;
    alertaExistente.destino = destino;
    alertaExistente.meta = meta;
    if (!alertaExistente.fecha) {
      alertaExistente.fecha = new Date().toISOString();
    }
  } else {
    const nueva = { clave, mensaje, tipo, destino, meta, fecha: new Date().toISOString() };
    alertas.unshift(nueva);
    alertasPorClave.set(clave, nueva);
    prepararAudioAlerta();
    reproducirSonidoAlerta();
  }
  actualizarUIAlertas();
}

export function removerAlertaPorClave(clave) {
  if (!alertasPorClave.has(clave)) return;
  const alerta = alertasPorClave.get(clave);
  const idx = alertas.indexOf(alerta);
  if (idx >= 0) alertas.splice(idx, 1);
  alertasPorClave.delete(clave);
  actualizarUIAlertas();
}

export function moverAlertaAHistorial(clave) {
  if (!alertasPorClave.has(clave)) return;
  const alerta = alertasPorClave.get(clave);
  const idx = alertas.indexOf(alerta);
  if (idx >= 0) alertas.splice(idx, 1);
  alertasPorClave.delete(clave);
  historialAlertas.unshift({
    mensaje: alerta.mensaje,
    fecha: new Date().toISOString()
  });
  if (historialAlertas.length > MAX_HISTORIAL_ALERTAS) {
    historialAlertas.pop();
  }
  actualizarUIAlertas();
  cambiarPestanaAlertas('historial');
}

export function cambiarPestanaAlertas(pestana) {
  pestanaAlertasActual = pestana === 'historial' ? 'historial' : 'activas';
  guardarPestanaAlertasActual();
  const tabActivas = document.getElementById('tabAlertasActivas');
  const tabHistorial = document.getElementById('tabAlertasHistorial');
  const listaActivas = document.getElementById('listaAlertas');
  const listaHistorial = document.getElementById('listaAlertasHistorial');
  if (!tabActivas || !tabHistorial || !listaActivas || !listaHistorial) return;

  if (pestana === 'historial') {
    tabHistorial.classList.add('activa');
    tabActivas.classList.remove('activa');
    listaHistorial.classList.remove('oculto');
    listaActivas.classList.add('oculto');
  } else {
    tabActivas.classList.add('activa');
    tabHistorial.classList.remove('activa');
    listaActivas.classList.remove('oculto');
    listaHistorial.classList.add('oculto');
  }
}

export function formatearFechaAlerta(fechaISO) {
  if (!fechaISO) return '';
  return new Date(fechaISO).toLocaleString();
}

export function prepararAudioAlerta() {
  if (audioAlertaPreparado) return;
  audioAlertaPreparado = true;
  document.addEventListener(
    'click',
    () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    },
    { once: true }
  );
}

export function reproducirSonidoAlerta(preset = '') {
  try {
    const tono = preset
      ? presetSonidoValido(preset)
      : presetSonidoValido(sonidoSeleccionado);
    if (tono === 'silencio') return;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const ahora = audioCtx.currentTime;
    const ganancia = audioCtx.createGain();
    ganancia.gain.setValueAtTime(0.0001, ahora);
    ganancia.gain.exponentialRampToValueAtTime(0.18, ahora + 0.02);
    ganancia.gain.exponentialRampToValueAtTime(0.001, ahora + 0.6);
    ganancia.connect(audioCtx.destination);

    const tocar = (tipo, frecuenciaInicio, frecuenciaFin, inicio, fin) => {
      const osc = audioCtx.createOscillator();
      osc.type = tipo;
      osc.frequency.setValueAtTime(frecuenciaInicio, ahora + inicio);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, frecuenciaFin), ahora + fin);
      osc.connect(ganancia);
      osc.start(ahora + inicio);
      osc.stop(ahora + fin);
    };

    if (tono === 'suave') {
      tocar('sine', 520, 420, 0, 0.42);
      tocar('sine', 640, 540, 0.12, 0.52);
      return;
    }

    if (tono === 'campana') {
      tocar('triangle', 880, 660, 0, 0.28);
      tocar('triangle', 1180, 900, 0.2, 0.5);
      return;
    }

    if (tono === 'digital') {
      tocar('square', 880, 840, 0, 0.1);
      tocar('square', 660, 620, 0.14, 0.24);
      tocar('square', 980, 930, 0.28, 0.4);
      return;
    }

    tocar('triangle', 440, 330, 0, 0.35);
    tocar('sine', 660, 520, 0.1, 0.55);
  } catch (e) {
    // Silenciar errores de audio en navegadores con restricciones
  }
}

export function notificacionesNativasDisponibles() {
  return typeof window !== 'undefined' && typeof window.Notification !== 'undefined';
}

export function obtenerPermisoNotificacionesNativas() {
  if (!notificacionesNativasDisponibles()) return 'unsupported';
  return Notification.permission || 'default';
}

export async function solicitarPermisoNotificacionesNativas() {
  if (!notificacionesNativasDisponibles()) return 'unsupported';
  try {
    const permiso = await Notification.requestPermission();
    return permiso || 'default';
  } catch {
    return 'default';
  }
}

export async function mostrarNotificacionNativa({
  titulo = 'CHIPACTLI',
  mensaje = '',
  tag = '',
  datos = null,
  sonido = ''
} = {}) {
  if (obtenerPermisoNotificacionesNativas() !== 'granted') return false;

  const options = {
    body: String(mensaje || '').trim(),
    tag: String(tag || '').trim() || undefined,
    data: datos || undefined,
    icon: '/images/logo.png',
    badge: '/images/logo.png'
  };

  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registro = await navigator.serviceWorker.getRegistration();
      if (registro && typeof registro.showNotification === 'function') {
        await registro.showNotification(String(titulo || 'CHIPACTLI'), options);
      } else {
        new Notification(String(titulo || 'CHIPACTLI'), options);
      }
    } else {
      new Notification(String(titulo || 'CHIPACTLI'), options);
    }
    reproducirSonidoAlerta(sonido || sonidoSeleccionado);
    return true;
  } catch {
    return false;
  }
}

export function mostrarNotificacion(mensaje, tipo = 'exito') {
  const modal = document.getElementById('modalNotificacion');
  const fondo = document.getElementById('fondoNotificacion');
  const titulo = document.getElementById('tituloNotificacion');
  const textoMensaje = document.getElementById('mensajeNotificacion');
  
  if (!modal || !fondo || !titulo || !textoMensaje) return;
  
  modal.className = `modalNotificacion ${tipo}`;
  
  if (tipo === 'exito') {
    titulo.textContent = '✅ Éxito';
  } else if (tipo === 'error') {
    titulo.textContent = '❌ Error';
  } else if (tipo === 'advertencia') {
    titulo.textContent = '⚠️ Advertencia';
  }
  
  textoMensaje.textContent = mensaje;
  modal.classList.remove('toast-hiding');
  modal.style.display = 'flex';
  if (fondo) fondo.style.display = 'none';

  if (onEnterCerrarNotificacion) {
    document.removeEventListener('keydown', onEnterCerrarNotificacion);
  }

  onEnterCerrarNotificacion = (event) => {
    if (event.key === 'Enter' && modal.style.display !== 'none') {
      event.preventDefault();
      cerrarNotificacion({ animada: true });
    }
  };

  document.addEventListener('keydown', onEnterCerrarNotificacion);

  if (timerCerrarNotificacion) {
    clearTimeout(timerCerrarNotificacion);
    timerCerrarNotificacion = null;
  }

  timerCerrarNotificacion = setTimeout(() => {
    cerrarNotificacion({ animada: true });
  }, 1450);
}

export function cerrarNotificacion(opciones = {}) {
  const modal = document.getElementById('modalNotificacion');
  const fondo = document.getElementById('fondoNotificacion');
  const animada = Boolean(opciones?.animada);

  if (timerCerrarNotificacion) {
    clearTimeout(timerCerrarNotificacion);
    timerCerrarNotificacion = null;
  }

  if (modal) {
    if (animada && modal.style.display !== 'none') {
      modal.classList.add('toast-hiding');
      setTimeout(() => {
        if (!modal.classList.contains('toast-hiding')) return;
        modal.style.display = 'none';
        modal.classList.remove('toast-hiding');
      }, 170);
    } else {
      modal.style.display = 'none';
      modal.classList.remove('toast-hiding');
    }
  }
  if (fondo) fondo.style.display = 'none';

  if (onEnterCerrarNotificacion) {
    document.removeEventListener('keydown', onEnterCerrarNotificacion);
    onEnterCerrarNotificacion = null;
  }
}
