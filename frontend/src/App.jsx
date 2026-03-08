import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'
import './App.css'

const PRODUCT_STORAGE_KEY = 'pos_products'
const SALES_STORAGE_KEY = 'pos_sales'
const CUTS_STORAGE_KEY = 'pos_cuts'
const CASHBOX_STORAGE_KEY = 'pos_cashbox'
const USERS_STORAGE_KEY = 'pos_users'
const SESSION_USER_KEY = 'pos_session_user'
const DATA_VERSION_KEY = 'pos_data_version'
const TICKET_SETTINGS_STORAGE_KEY = 'pos_ticket_settings'
const SUPPLIERS_STORAGE_KEY = 'pos_suppliers'
const PURCHASE_ORDERS_STORAGE_KEY = 'pos_purchase_orders'
const CATEGORY_STORAGE_KEY = 'pos_categories'
const CLEAN_START_VERSION = '2026-03-clean-start-v2'
const ACTIVE_POS_STORAGE_KEY = 'pos_active_store'
const POS_VISIBILITY_STORAGE_KEY = 'pos_visibility'
const POS_ORDER_STORAGE_KEY = 'pos_order'
const POS_REGISTRY_STORAGE_KEY = 'pos_registry'
const POS_PRIMARY_ID_STORAGE_KEY = 'pos_primary_id'
const POS_SECURITY_STORAGE_KEY = 'pos_security'
const POS_RECYCLE_BIN_STORAGE_KEY = 'pos_recycle_bin'
const POS_RECOVERY_WINDOW_DAYS = 15

const POS_SCOPED_STORAGE_KEYS = [
  DATA_VERSION_KEY,
  PRODUCT_STORAGE_KEY,
  SALES_STORAGE_KEY,
  CUTS_STORAGE_KEY,
  CASHBOX_STORAGE_KEY,
  SUPPLIERS_STORAGE_KEY,
  PURCHASE_ORDERS_STORAGE_KEY,
  TICKET_SETTINGS_STORAGE_KEY,
  CATEGORY_STORAGE_KEY,
]

const DEFAULT_POS_REGISTRY = [{ id: 'primary', defaultName: 'POS Principal' }]

const LEGACY_PRODUCT_STORAGE_KEY = 'regalos_pos_products'
const LEGACY_SALES_STORAGE_KEY = 'regalos_pos_sales'
const LEGACY_CUTS_STORAGE_KEY = 'regalos_pos_cuts'
const LEGACY_CASHBOX_STORAGE_KEY = 'regalos_pos_cashbox'
const LEGACY_USERS_STORAGE_KEY = 'regalos_pos_users'
const LEGACY_SESSION_USER_KEY = 'regalos_pos_session_user'

const scopedStorageKey = (baseKey, posId = 'primary') =>
  posId === 'primary' ? baseKey : `${baseKey}_${posId}`

const normalizePosId = (value) => {
  if (typeof value !== 'string') return 'primary'
  const trimmed = value.trim()
  return trimmed || 'primary'
}

const resolvePosId = (value) => normalizePosId(value)

const readPosRegistry = () => {
  const raw = readStorage(POS_REGISTRY_STORAGE_KEY, null)
  const fromStorage = Array.isArray(raw)
    ? raw
        .map((item) => ({
          id: normalizePosId(item?.id),
          defaultName: String(item?.defaultName || '').trim(),
        }))
        .filter((item) => item.id)
    : []

  const byId = new Map()
  const register = (item) => {
    if (!item?.id || byId.has(item.id)) return
    byId.set(item.id, {
      id: item.id,
      defaultName: String(item.defaultName || '').trim() || `POS ${byId.size + 1}`,
    })
  }

  DEFAULT_POS_REGISTRY.forEach(register)
  fromStorage.forEach(register)

  const legacySecondaryVersion = localStorage.getItem(scopedStorageKey(DATA_VERSION_KEY, 'secondary'))
  if (legacySecondaryVersion === CLEAN_START_VERSION) {
    register({ id: 'secondary', defaultName: 'POS 2' })
  }

  return [...byId.values()]
}

const readPosVisibility = () => {
  const data = readStorage(POS_VISIBILITY_STORAGE_KEY, {})
  if (Array.isArray(data?.hiddenIds)) {
    return {
      hiddenIds: [...new Set(data.hiddenIds.map((id) => normalizePosId(id)).filter((id) => id !== 'primary'))],
    }
  }
  return {
    hiddenIds: data?.secondaryHidden ? ['secondary'] : [],
  }
}

const readPosOrder = (registryIds = ['primary']) => {
  const fallback = registryIds.length > 0 ? registryIds : ['primary']
  const data = readStorage(POS_ORDER_STORAGE_KEY, fallback)
  const base = Array.isArray(data) ? data.map((id) => normalizePosId(id)) : fallback

  const deduped = [...new Set(base.filter((id) => registryIds.includes(id)))]
  const withMissing = [...deduped, ...registryIds.filter((id) => !deduped.includes(id))]
  return withMissing.includes('primary') ? withMissing : ['primary', ...withMissing]
}

const readPrimaryPosId = () => {
  return normalizePosId(localStorage.getItem(POS_PRIMARY_ID_STORAGE_KEY))
}

const readPosSecurity = () => {
  const data = readStorage(POS_SECURITY_STORAGE_KEY, {})

  if (data?.lockById && typeof data.lockById === 'object') {
    const lockById = Object.entries(data.lockById).reduce((acc, [posId, hash]) => {
      const normalizedId = normalizePosId(posId)
      const normalizedHash = String(hash || '')
      if (normalizedHash) acc[normalizedId] = normalizedHash
      return acc
    }, {})
    return { lockById }
  }

  const lockById = {}
  if (data?.primaryLockHash) lockById.primary = String(data.primaryLockHash)
  if (data?.secondaryLockHash) lockById.secondary = String(data.secondaryLockHash)
  return {
    lockById,
  }
}

const ticketWidthOptions = ['58', '76', '80']
const providerPaymentOptions = [
  'efectivo',
  'transferencia',
  'tarjeta-debito',
  'tarjeta-credito',
  'cheque',
  'deposito',
  'paypal',
  'credito',
  'otro',
]

const paymentLabelMap = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  'tarjeta-debito': 'Tarjeta Débito',
  'tarjeta-credito': 'Tarjeta Crédito',
  cheque: 'Cheque',
  deposito: 'Depósito',
  paypal: 'PayPal',
  credito: 'Crédito',
  otro: 'Otro',
}

const defaultTicketSettings = {
  storeName: 'Sistema Punto de Venta',
  logoUrl: '',
  businessName: '',
  address: '',
  phone: '',
  rfc: '',
  footerMessage: 'Gracias por su compra',
  printerWidthMm: '80',
  fontScale: '1',
  logoThemeIntensity: '1',
  showCashier: true,
  showDate: true,
  showProductCode: true,
  useLogoTheme: true,
  digitalTicketEnabled: false,
  autoPrint: false,
}

const defaultThemePalette = {
  brand: '#0f766e',
  brandDark: '#115e59',
  accent: '#f59e0b',
  heroA: '#fff8e6',
  heroB: '#e7f8f6',
  heroBorder: '#eadfca',
}

const MASTER_USERNAME = 'usuario.maestro'
const MASTER_PASSWORD = 'Maestro#2026'

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
})

const todayISO = () => new Date().toISOString().slice(0, 10)
const API_STATE_URL = 'http://localhost:8787/api/state'

const addDaysISO = (days) => {
  const date = new Date()
  date.setDate(date.getDate() + Number(days || 0))
  return date.toISOString()
}

const splitAmount = (amount, count) => {
  if (count <= 1) return [Number(amount.toFixed(2))]
  const cents = Math.round(amount * 100)
  const base = Math.floor(cents / count)
  const remainder = cents % count
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100)
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')

const rgbToHex = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`

const mixHex = (hexA, hexB, ratio) => {
  const a = hexA.replace('#', '')
  const b = hexB.replace('#', '')
  const r = clamp(ratio, 0, 1)

  const aR = parseInt(a.slice(0, 2), 16)
  const aG = parseInt(a.slice(2, 4), 16)
  const aB = parseInt(a.slice(4, 6), 16)
  const bR = parseInt(b.slice(0, 2), 16)
  const bG = parseInt(b.slice(2, 4), 16)
  const bB = parseInt(b.slice(4, 6), 16)

  return rgbToHex(aR * (1 - r) + bR * r, aG * (1 - r) + bG * r, aB * (1 - r) + bB * r)
}

const rgbToHsl = (r, g, b) => {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0)
  else if (max === gg) h = (bb - rr) / d + 2
  else h = (rr - gg) / d + 4

  return { h: h / 6, s, l }
}

const emptyProductForm = {
  code: '',
  name: '',
  brand: '',
  supplier: '',
  category: 'General',
  cost: '',
  price: '',
  stock: '',
  minStock: '5',
  locationArea: '',
  locationBin: '',
  imageUrl: '',
}

const emptyOpenCashForm = {
  openingCash: '0',
}

const emptyNewUserForm = {
  fullName: '',
  username: '',
  password: '',
  role: 'cashier',
}

const emptySupplierForm = {
  name: '',
  contactName: '',
  paymentType: 'efectivo',
  transferAccount: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
}

const emptySupplyOrderForm = {
  paymentMethod: 'efectivo',
  totalAmount: '',
  creditMode: 'single',
  singleDueDays: '30',
  firstPaymentDays: '15',
  installmentCount: '3',
  daysBetweenPayments: '30',
}

const createManualOrderLine = () => ({
  id: crypto.randomUUID(),
  entryType: 'existing',
  productId: '',
  manualCode: '',
  manualName: '',
  manualCategory: 'General',
  manualSuggestedPrice: '',
  quantity: '1',
})

const hashPassword = (value) => {
  try {
    return btoa(unescape(encodeURIComponent(value)))
  } catch {
    return value
  }
}

const readStorage = (key, fallback) => {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

const readStorageAny = (keys, fallback) => {
  for (const key of keys) {
    try {
      const value = localStorage.getItem(key)
      if (value !== null) return JSON.parse(value)
    } catch {
      // Ignore parsing issues and continue with next key.
    }
  }
  return fallback
}

const purgeExpiredPosBinEntries = (entries) => {
  const nowMs = Date.now()
  return entries.filter((entry) => {
    const purgeAtMs = new Date(entry?.purgeAt || 0).getTime()
    return Number.isFinite(purgeAtMs) && purgeAtMs > nowMs
  })
}

const readPosRecycleBin = () => {
  const data = readStorage(POS_RECYCLE_BIN_STORAGE_KEY, [])
  if (!Array.isArray(data)) return []

  const normalized = data
    .map((entry) => ({
      id: normalizePosId(entry?.id),
      defaultName: String(entry?.defaultName || '').trim() || 'POS eliminado',
      removedAt: String(entry?.removedAt || ''),
      purgeAt: String(entry?.purgeAt || ''),
      hiddenBefore: Boolean(entry?.hiddenBefore),
      orderIndex: Number(entry?.orderIndex ?? -1),
      wasPrimary: Boolean(entry?.wasPrimary),
      lockHash: String(entry?.lockHash || ''),
      storage: entry?.storage && typeof entry.storage === 'object' ? entry.storage : {},
    }))
    .filter((entry) => entry.id && entry.id !== 'primary')

  return purgeExpiredPosBinEntries(normalized)
}

const readTicketSettings = (posId = 'primary') => {
  const data = readStorage(scopedStorageKey(TICKET_SETTINGS_STORAGE_KEY, posId), null)
  return normalizeTicketSettings(data)
}

const normalizeTicketSettings = (raw) => {
  const data = raw && typeof raw === 'object' ? raw : {}
  const intensityValue = Number(data.logoThemeIntensity ?? defaultTicketSettings.logoThemeIntensity)
  const normalizedIntensity = Number.isFinite(intensityValue)
    ? String(clamp(intensityValue, 0.7, 1.8))
    : defaultTicketSettings.logoThemeIntensity

  return {
    ...defaultTicketSettings,
    ...data,
    storeName: String(data.storeName ?? defaultTicketSettings.storeName),
    logoUrl: String(data.logoUrl ?? defaultTicketSettings.logoUrl),
    businessName: String(data.businessName ?? defaultTicketSettings.businessName),
    address: String(data.address ?? defaultTicketSettings.address),
    phone: String(data.phone ?? defaultTicketSettings.phone),
    rfc: String(data.rfc ?? defaultTicketSettings.rfc),
    footerMessage: String(data.footerMessage ?? defaultTicketSettings.footerMessage),
    printerWidthMm: ticketWidthOptions.includes(String(data.printerWidthMm))
      ? String(data.printerWidthMm)
      : defaultTicketSettings.printerWidthMm,
    fontScale: String(data.fontScale ?? defaultTicketSettings.fontScale),
    logoThemeIntensity: normalizedIntensity,
    showCashier: data.showCashier !== false,
    showDate: data.showDate !== false,
    showProductCode: data.showProductCode !== false,
    useLogoTheme: data.useLogoTheme !== false,
    digitalTicketEnabled: Boolean(data.digitalTicketEnabled),
    autoPrint: Boolean(data.autoPrint),
  }
}

const normalizeSupplier = (raw, index) => ({
  id: raw.id ?? crypto.randomUUID(),
  name: String(raw.name ?? `Proveedor ${index + 1}`).trim(),
  contactName: String(raw.contactName ?? '').trim(),
  paymentType: providerPaymentOptions.includes(String(raw.paymentType))
    ? String(raw.paymentType)
    : 'efectivo',
  transferAccount: String(raw.transferAccount ?? '').trim(),
  phone: String(raw.phone ?? '').trim(),
  email: String(raw.email ?? '').trim(),
  address: String(raw.address ?? '').trim(),
  notes: String(raw.notes ?? '').trim(),
  createdAt: raw.createdAt ?? new Date().toISOString(),
})

const normalizePurchaseOrder = (raw, index) => ({
  id: raw.id ?? `OC-${index + 1}`,
  supplierName: String(raw.supplierName ?? 'Sin proveedor').trim(),
  createdAt: raw.createdAt ?? new Date().toISOString(),
  status:
    raw.status === 'closed'
      ? 'closed'
      : raw.status === 'cancelled'
        ? 'cancelled'
        : raw.status === 'supplied'
          ? 'supplied'
          : 'open',
  autoGenerated: raw.autoGenerated !== false,
  suppliedAt: raw.suppliedAt ?? null,
  supplyPayment: raw.supplyPayment
    ? {
        paymentMethod: String(raw.supplyPayment.paymentMethod ?? 'efectivo'),
        totalAmount: Number(raw.supplyPayment.totalAmount ?? 0),
        creditMode: String(raw.supplyPayment.creditMode ?? 'single'),
      }
    : null,
  creditPayments: Array.isArray(raw.creditPayments)
    ? raw.creditPayments.map((payment, paymentIndex) => ({
        id: String(payment.id ?? `${raw.id}-payment-${paymentIndex}`),
        amount: Number(payment.amount ?? 0),
        dueDate: payment.dueDate ?? new Date().toISOString(),
        status: payment.status === 'paid' ? 'paid' : 'pending',
        paidAt: payment.paidAt ?? null,
        number: Number(payment.number ?? paymentIndex + 1),
        total: Number(payment.total ?? 1),
      }))
    : [],
  items: Array.isArray(raw.items)
    ? raw.items.map((item, itemIndex) => ({
        productId: String(item.productId ?? `${raw.id}-item-${itemIndex}`),
        code: String(item.code ?? '').trim(),
        name: String(item.name ?? '').trim(),
        isManualProduct: Boolean(item.isManualProduct),
        manualCategory: String(item.manualCategory ?? 'General').trim(),
        manualSuggestedPrice: Number(item.manualSuggestedPrice ?? 0),
        currentStock: Number(item.currentStock ?? 0),
        minStock: Number(item.minStock ?? 5),
        recommendedQty: Number(item.recommendedQty ?? item.orderedQty ?? 0),
        orderedQty: Number(item.orderedQty ?? item.recommendedQty ?? 0),
        suppliedQty: Number(item.suppliedQty ?? 0),
        suppliedCostTotal: Number(item.suppliedCostTotal ?? 0),
        suppliedUnitCost: Number(item.suppliedUnitCost ?? 0),
      }))
    : [],
})

const normalizeSale = (raw) => ({
  ...raw,
  deliveryStatus: raw.deliveryStatus === 'pending' ? 'pending' : 'completed',
  pendingDeliveryCode: String(raw.pendingDeliveryCode ?? '').trim(),
  pendingItems: Array.isArray(raw.pendingItems)
    ? raw.pendingItems.map((item) => ({
        code: String(item.code ?? '').trim(),
        name: String(item.name ?? '').trim(),
        quantity: Number(item.quantity ?? 0),
      }))
    : [],
  deliveredAt: raw.deliveredAt ?? null,
})

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const paymentMethodText = (method) => {
  if (method === 'tarjeta') return 'Tarjeta'
  if (method === 'transferencia') return 'Transferencia'
  return 'Efectivo'
}

const TicketPreview = ({ sale, settings, isEmpty, hidePendingNotice = false, barcodeDataUrl = '' }) => {
  if (isEmpty || !sale) {
    return <p className="empty">No hay venta para mostrar en vista previa.</p>
  }

  const showPending = sale.deliveryStatus === 'pending' && !hidePendingNotice

  return (
    <article className="ticket-paper" style={{ width: `${settings.printerWidthMm}mm` }}>
      <header className="ticket-head">
        {settings.logoUrl && (
          <img src={settings.logoUrl} alt="Logo negocio" className="ticket-logo" />
        )}
        <strong>{settings.storeName || 'Sistema Punto de Venta'}</strong>
        {settings.businessName && <span>{settings.businessName}</span>}
        {settings.address && <span>{settings.address}</span>}
        {(settings.phone || settings.rfc) && (
          <span>
            {settings.phone ? `Tel: ${settings.phone}` : ''}
            {settings.phone && settings.rfc ? ' | ' : ''}
            {settings.rfc ? `RFC: ${settings.rfc}` : ''}
          </span>
        )}
      </header>

      <div className="ticket-divider" />

      {settings.showDate && <p>Fecha: {new Date(sale.dateTime).toLocaleString('es-MX')}</p>}
      <p>Folio: {sale.id.slice(0, 8).toUpperCase()}</p>
      {settings.showCashier && <p>Cajero: {sale.cashierName || 'No registrado'}</p>}
      <p>Pago: {paymentMethodText(sale.paymentMethod)}</p>

      <div className="ticket-divider" />

      {sale.items.map((item, index) => (
        <div key={`${sale.id}-${item.id}-${index}`} className="ticket-item">
          <p className="ticket-item-title">
            {settings.showProductCode ? `${item.code} ` : ''}
            {item.name}
          </p>
          <p className="ticket-item-row">
            <span>
              {item.quantity} x {currency.format(item.price)}
            </span>
            <strong>{currency.format(item.quantity * item.price)}</strong>
          </p>
        </div>
      ))}

      <div className="ticket-divider" />

      <p className="ticket-total">
        <span>TOTAL</span>
        <strong>{currency.format(sale.total)}</strong>
      </p>

      {showPending && (
        <>
          <div className="ticket-divider" />
          <p className="ticket-pending-note">PENDIENTE POR ENTREGAR</p>
          {barcodeDataUrl && <img src={barcodeDataUrl} alt="Codigo barras pendiente" className="ticket-barcode" />}
          {sale.pendingDeliveryCode && <p className="ticket-code-label">{sale.pendingDeliveryCode}</p>}
        </>
      )}

      <footer className="ticket-foot">
        <p>{settings.footerMessage || 'Gracias por su compra'}</p>
      </footer>
    </article>
  )
}

const normalizeProduct = (raw, index) => ({
  id: raw.id ?? crypto.randomUUID(),
  code: String(raw.code ?? `P${index + 1}`).trim().toUpperCase(),
  name: String(raw.name ?? '').trim(),
  brand: String(raw.brand ?? '').trim(),
  supplier: String(raw.supplier ?? '').trim(),
  category: String(raw.category ?? 'General').trim(),
  cost: Number(raw.cost ?? 0),
  price: Number(raw.price ?? 0),
  stock: Number(raw.stock ?? 0),
  minStock: Number(raw.minStock ?? 5),
  locationArea: String(raw.locationArea ?? '').trim(),
  locationBin: String(raw.locationBin ?? '').trim(),
  imageUrl: String(raw.imageUrl ?? '').trim(),
})

const normalizeUser = (raw, index) => ({
  id: raw.id ?? crypto.randomUUID(),
  fullName: String(raw.fullName ?? raw.name ?? `Usuario ${index + 1}`).trim(),
  username: String(raw.username ?? '').trim().toLowerCase(),
  passwordHash: String(raw.passwordHash ?? ''),
  passwordLegacy: String(raw.password ?? ''),
  role: raw.role === 'admin' ? 'admin' : 'cashier',
  active: raw.active !== false,
  createdAt: raw.createdAt ?? new Date().toISOString(),
})

const readProducts = (posId = 'primary') => {
  const keys =
    posId === 'primary'
      ? [PRODUCT_STORAGE_KEY, LEGACY_PRODUCT_STORAGE_KEY]
      : [scopedStorageKey(PRODUCT_STORAGE_KEY, posId)]
  const data = readStorageAny(keys, [])
  if (!Array.isArray(data)) return []
  return data.map(normalizeProduct)
}

const readUsers = () => {
  const data = readStorageAny([USERS_STORAGE_KEY, LEGACY_USERS_STORAGE_KEY], [])
  if (!Array.isArray(data)) return []
  return data.map(normalizeUser)
}

const readSuppliers = (posId = 'primary') => {
  const data = readStorage(scopedStorageKey(SUPPLIERS_STORAGE_KEY, posId), [])
  if (!Array.isArray(data)) return []
  return data.map(normalizeSupplier)
}

const readPurchaseOrders = (posId = 'primary') => {
  const data = readStorage(scopedStorageKey(PURCHASE_ORDERS_STORAGE_KEY, posId), [])
  if (!Array.isArray(data)) return []
  return data.map(normalizePurchaseOrder)
}

const readCategories = (posId = 'primary') => {
  const data = readStorage(scopedStorageKey(CATEGORY_STORAGE_KEY, posId), [])
  if (!Array.isArray(data)) return ['General']

  const cleaned = [...new Set(data.map((item) => String(item || '').trim()).filter(Boolean))]
  return cleaned.length > 0 ? cleaned : ['General']
}

const readCashBox = (posId = 'primary') => {
  const today = todayISO()
  const keys =
    posId === 'primary'
      ? [CASHBOX_STORAGE_KEY, LEGACY_CASHBOX_STORAGE_KEY]
      : [scopedStorageKey(CASHBOX_STORAGE_KEY, posId)]
  const data = readStorageAny(keys, null)

  if (!data || data.date !== today) {
    return {
      isOpen: false,
      date: today,
      openingCash: 0,
      openedById: '',
      openedByName: '',
      openedAt: null,
      closedAt: null,
    }
  }

  return {
    isOpen: Boolean(data.isOpen),
    date: data.date,
    openingCash: Number(data.openingCash ?? 0),
    openedById: String(data.openedById ?? ''),
    openedByName: String(data.openedByName ?? ''),
    openedAt: data.openedAt ?? null,
    closedAt: data.closedAt ?? null,
  }
}

const Modal = ({ title, onClose, children }) => (
  <div className="modal-backdrop" role="dialog" aria-modal="true">
    <div className="modal-card">
      <div className="modal-header">
        <h2>{title}</h2>
        <button type="button" className="ghost-btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </div>
  </div>
)

const EyeToggleIcon = ({ visible }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 5C7.45 5 3.59 7.82 2 12c1.59 4.18 5.45 7 10 7s8.41-2.82 10-7c-1.59-4.18-5.45-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
    <circle cx="12" cy="12" r="2.3" />
    {visible ? null : <path d="M4 4 20 20" stroke="currentColor" strokeWidth="2" fill="none" />}
  </svg>
)

function App() {
  const [posRegistry, setPosRegistry] = useState(() => readPosRegistry())
  const [activePosId, setActivePosId] = useState(() =>
    resolvePosId(localStorage.getItem(ACTIVE_POS_STORAGE_KEY)),
  )
  const [posVisibility, setPosVisibility] = useState(() => readPosVisibility())
  const [posOrder, setPosOrder] = useState(() => readPosOrder(readPosRegistry().map((item) => item.id)))
  const [primaryPosId, setPrimaryPosId] = useState(() => readPrimaryPosId())
  const [posSecurity, setPosSecurity] = useState(() => readPosSecurity())
  const [deletedPosBin, setDeletedPosBin] = useState(() => readPosRecycleBin())
  const [activeTab, setActiveTab] = useState('sales')
  const [adminSection, setAdminSection] = useState('users')
  const [userAdminTab, setUserAdminTab] = useState('users-list')
  const [userMovementsFilterUser, setUserMovementsFilterUser] = useState('')
  const [userMovementsFilterPos, setUserMovementsFilterPos] = useState('')
  const [userMovementsFilterDate, setUserMovementsFilterDate] = useState(() => todayISO())
  const [users, setUsers] = useState(() => readUsers())
  const [products, setProducts] = useState(() => readProducts(activePosId))
  const [suppliers, setSuppliers] = useState(() => readSuppliers(activePosId))
  const [purchaseOrders, setPurchaseOrders] = useState(() => readPurchaseOrders(activePosId))
  const [categories, setCategories] = useState(() => readCategories(activePosId))
  const [newCategoryName, setNewCategoryName] = useState('')
  const [sales, setSales] = useState(() =>
    readStorageAny(
      activePosId === 'primary'
        ? [SALES_STORAGE_KEY, LEGACY_SALES_STORAGE_KEY]
        : [scopedStorageKey(SALES_STORAGE_KEY, activePosId)],
      [],
    ).map(normalizeSale),
  )
  const [cuts, setCuts] = useState(() =>
    readStorageAny(
      activePosId === 'primary'
        ? [CUTS_STORAGE_KEY, LEGACY_CUTS_STORAGE_KEY]
        : [scopedStorageKey(CUTS_STORAGE_KEY, activePosId)],
      [],
    ),
  )
  const [cart, setCart] = useState([])
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [searchTerm, setSearchTerm] = useState('')
  const [showAlerts, setShowAlerts] = useState(false)
  const [showProductModal, setShowProductModal] = useState(false)
  const [showCutModal, setShowCutModal] = useState(false)
  const [showOpenCashModal, setShowOpenCashModal] = useState(false)
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [showManualOrderModal, setShowManualOrderModal] = useState(false)
  const [showTicketDeliveryModal, setShowTicketDeliveryModal] = useState(false)
  const [showDigitalTicketModal, setShowDigitalTicketModal] = useState(false)
  const [showPendingTicketModal, setShowPendingTicketModal] = useState(false)
  const [showPosPickerModal, setShowPosPickerModal] = useState(false)
  const [pendingPosUnlockId, setPendingPosUnlockId] = useState('')
  const [posUnlockPassword, setPosUnlockPassword] = useState('')
  const [posUnlockError, setPosUnlockError] = useState('')
  const [newPosLockPassword, setNewPosLockPassword] = useState('')
  const [showNewPosLockPassword, setShowNewPosLockPassword] = useState(false)
  const [securityEditorPosId, setSecurityEditorPosId] = useState('')
  const [showPosUnlockPassword, setShowPosUnlockPassword] = useState(false)
  const [shouldPromptPosPicker, setShouldPromptPosPicker] = useState(false)
  const [appMessageModal, setAppMessageModal] = useState(null)
  const [newProduct, setNewProduct] = useState(emptyProductForm)
  const [editingProductId, setEditingProductId] = useState('')
  const [digitalTicketSale, setDigitalTicketSale] = useState(null)
  const [digitalTicketHidePending, setDigitalTicketHidePending] = useState(false)
  const [digitalTicketQrDataUrl, setDigitalTicketQrDataUrl] = useState('')
  const [digitalTicketBarcodeDataUrl, setDigitalTicketBarcodeDataUrl] = useState('')
  const [digitalTicketShareUrl, setDigitalTicketShareUrl] = useState('')
  const [ticketDeliveryRequest, setTicketDeliveryRequest] = useState(null)
  const [pendingTicketSearchCode, setPendingTicketSearchCode] = useState('')
  const [pendingTicketMatchId, setPendingTicketMatchId] = useState('')
  const [openCashForm, setOpenCashForm] = useState(emptyOpenCashForm)
  const [cashBox, setCashBox] = useState(() => readCashBox(activePosId))
  const [now, setNow] = useState(() => new Date())
  const [newUserForm, setNewUserForm] = useState(emptyNewUserForm)
  const [newSupplierForm, setNewSupplierForm] = useState(emptySupplierForm)
  const [supplierAddressSuggestions, setSupplierAddressSuggestions] = useState([])
  const [supplierAddressLoading, setSupplierAddressLoading] = useState(false)
  const [editingSupplierId, setEditingSupplierId] = useState('')
  const [supplierEditForm, setSupplierEditForm] = useState(emptySupplierForm)
  const [supplyOrderId, setSupplyOrderId] = useState('')
  const [supplyOrderForm, setSupplyOrderForm] = useState(emptySupplyOrderForm)
  const [supplyOrderItems, setSupplyOrderItems] = useState([])
  const [manualOrderForm, setManualOrderForm] = useState({
    supplierName: '',
    items: [createManualOrderLine()],
  })
  const [inventorySearchTerm, setInventorySearchTerm] = useState('')
  const [cutForm, setCutForm] = useState({
    date: todayISO(),
    openingCash: '0',
    expenses: '0',
    countedCash: '0',
    shortagePaid: '0',
    shortagePaidLabel: 'Pagado',
    notes: '',
  })

  const [authStep, setAuthStep] = useState(() => {
    const initialUsers = readUsers()
    const valid = initialUsers.filter((user) => user.username && (user.passwordHash || user.passwordLegacy))
    return valid.length === 0 ? 'master' : 'login'
  })
  const [masterLogin, setMasterLogin] = useState({ username: '', password: '' })
  const [ownerSetup, setOwnerSetup] = useState({ fullName: '', username: '', password: '' })
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState({
    master: false,
    owner: false,
    login: false,
    userCreate: false,
  })
  const [authError, setAuthError] = useState('')
  const [currentUser, setCurrentUser] = useState(() =>
    readStorageAny([SESSION_USER_KEY, LEGACY_SESSION_USER_KEY], null),
  )
  const [scanNotice, setScanNotice] = useState('')
  const [serverMode, setServerMode] = useState('checking')
  const [ticketSettings, setTicketSettings] = useState(() => readTicketSettings(activePosId))
  const [lastSaleForTicket, setLastSaleForTicket] = useState(null)
  const [logoThemePalette, setLogoThemePalette] = useState(defaultThemePalette)

  const scanBufferRef = useRef('')
  const scanTimerRef = useRef(null)
  const scanNoticeTimerRef = useRef(null)
  const serverSyncReadyRef = useRef(false)
  const serverSyncTimerRef = useRef(null)
  const autoDownloadedTicketRef = useRef('')
  const pendingFulfillButtonRef = useRef(null)

  const posRegistryIds = useMemo(() => posRegistry.map((item) => item.id), [posRegistry])

  useEffect(() => {
    localStorage.setItem(ACTIVE_POS_STORAGE_KEY, activePosId)
  }, [activePosId])

  useEffect(() => {
    localStorage.setItem(POS_REGISTRY_STORAGE_KEY, JSON.stringify(posRegistry))
  }, [posRegistry])

  useEffect(() => {
    localStorage.setItem(POS_VISIBILITY_STORAGE_KEY, JSON.stringify(posVisibility))
  }, [posVisibility])

  useEffect(() => {
    localStorage.setItem(POS_ORDER_STORAGE_KEY, JSON.stringify(posOrder))
  }, [posOrder])

  useEffect(() => {
    localStorage.setItem(POS_PRIMARY_ID_STORAGE_KEY, primaryPosId)
  }, [primaryPosId])

  useEffect(() => {
    localStorage.setItem(POS_SECURITY_STORAGE_KEY, JSON.stringify(posSecurity))
  }, [posSecurity])

  useEffect(() => {
    const filtered = purgeExpiredPosBinEntries(deletedPosBin)
    if (filtered.length !== deletedPosBin.length) {
      setDeletedPosBin(filtered)
      return
    }
    localStorage.setItem(POS_RECYCLE_BIN_STORAGE_KEY, JSON.stringify(filtered))
  }, [deletedPosBin])

  useEffect(() => {
    const filtered = purgeExpiredPosBinEntries(deletedPosBin)
    if (filtered.length !== deletedPosBin.length) {
      setDeletedPosBin(filtered)
    }
  }, [deletedPosBin, now])

  useEffect(() => {
    if (!posRegistryIds.includes(activePosId)) {
      setActivePosId('primary')
    }
  }, [activePosId, posRegistryIds])

  useEffect(() => {
    if (!posRegistryIds.includes(primaryPosId)) {
      setPrimaryPosId('primary')
    }
  }, [posRegistryIds, primaryPosId])

  useEffect(() => {
    if (!appMessageModal) return

    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAppMessageModal((current) => {
          if (!current) return current
          current.resolve(false)
          return null
        })
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        setAppMessageModal((current) => {
          if (!current) return current
          current.resolve(true)
          return null
        })
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [appMessageModal])

  useEffect(() => {
    setPosOrder(readPosOrder(posRegistryIds.length > 0 ? posRegistryIds : ['primary']))
  }, [posRegistryIds])

  useEffect(() => {
    const dataVersionKey = scopedStorageKey(DATA_VERSION_KEY, activePosId)
    const currentVersion = localStorage.getItem(dataVersionKey)
    if (currentVersion === CLEAN_START_VERSION) return

    localStorage.setItem(scopedStorageKey(PRODUCT_STORAGE_KEY, activePosId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(SALES_STORAGE_KEY, activePosId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(CUTS_STORAGE_KEY, activePosId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(SUPPLIERS_STORAGE_KEY, activePosId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(PURCHASE_ORDERS_STORAGE_KEY, activePosId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(CATEGORY_STORAGE_KEY, activePosId), JSON.stringify(['General']))
    localStorage.setItem(
      scopedStorageKey(CASHBOX_STORAGE_KEY, activePosId),
      JSON.stringify({
        isOpen: false,
        date: todayISO(),
        openingCash: 0,
        openedById: '',
        openedByName: '',
        openedAt: null,
        closedAt: null,
      }),
    )
    localStorage.setItem(
      scopedStorageKey(TICKET_SETTINGS_STORAGE_KEY, activePosId),
      JSON.stringify(defaultTicketSettings),
    )
    localStorage.setItem(dataVersionKey, CLEAN_START_VERSION)

    if (activePosId === 'primary') {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify([]))
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(null))
      localStorage.setItem(POS_REGISTRY_STORAGE_KEY, JSON.stringify(DEFAULT_POS_REGISTRY))
      localStorage.setItem(POS_VISIBILITY_STORAGE_KEY, JSON.stringify({ hiddenIds: [] }))
      localStorage.setItem(POS_ORDER_STORAGE_KEY, JSON.stringify(['primary']))
      localStorage.setItem(POS_PRIMARY_ID_STORAGE_KEY, 'primary')
      localStorage.setItem(POS_SECURITY_STORAGE_KEY, JSON.stringify({ lockById: {} }))
      localStorage.setItem(POS_RECYCLE_BIN_STORAGE_KEY, JSON.stringify([]))
      setPosRegistry(DEFAULT_POS_REGISTRY)
      setPrimaryPosId('primary')
      setPosVisibility({ hiddenIds: [] })
      setPosOrder(['primary'])
      setPosSecurity({ lockById: {} })
      setDeletedPosBin([])
    }
  }, [activePosId])

  useEffect(() => {
    const loadedUsers = readUsers()
    const loadedProducts = readProducts(activePosId)
    const loadedCategories = readCategories(activePosId)
    const loadedSuppliers = readSuppliers(activePosId)
    const loadedPurchaseOrders = readPurchaseOrders(activePosId)
    const loadedSales = readStorageAny(
      activePosId === 'primary'
        ? [SALES_STORAGE_KEY, LEGACY_SALES_STORAGE_KEY]
        : [scopedStorageKey(SALES_STORAGE_KEY, activePosId)],
      [],
    )
    const loadedCuts = readStorageAny(
      activePosId === 'primary'
        ? [CUTS_STORAGE_KEY, LEGACY_CUTS_STORAGE_KEY]
        : [scopedStorageKey(CUTS_STORAGE_KEY, activePosId)],
      [],
    )
    const loadedSessionUser = readStorageAny([SESSION_USER_KEY, LEGACY_SESSION_USER_KEY], null)

    setUsers(loadedUsers)
    setProducts(loadedProducts)
    setCategories(loadedCategories)
    setSuppliers(loadedSuppliers)
    setPurchaseOrders(loadedPurchaseOrders)
    setSales(Array.isArray(loadedSales) ? loadedSales.map(normalizeSale) : [])
    setCuts(Array.isArray(loadedCuts) ? loadedCuts : [])
    setCashBox(readCashBox(activePosId))
    setTicketSettings(readTicketSettings(activePosId))
    setCurrentUser(loadedSessionUser)
    setPosRegistry(readPosRegistry())
    setPrimaryPosId(readPrimaryPosId())
    setPosVisibility(readPosVisibility())
    setPosOrder(readPosOrder(readPosRegistry().map((item) => item.id)))
    setPosSecurity(readPosSecurity())
    setDeletedPosBin(readPosRecycleBin())
    setCart([])
    setSearchTerm('')
    setPaymentMethod('efectivo')
    setShowAlerts(false)
    setShowCutModal(false)
    setShowOpenCashModal(false)
    setShowProductModal(false)
    setShowSupplierModal(false)
    setShowManualOrderModal(false)
    setShowDigitalTicketModal(false)
    setShowPendingTicketModal(false)
    setShowTicketDeliveryModal(false)
    setTicketDeliveryRequest(null)
    setPendingTicketSearchCode('')
    setPendingTicketMatchId('')
    setLastSaleForTicket(null)
    setActiveTab('sales')
    setAdminSection(activePosId === primaryPosId ? 'users' : 'ticket')

    const validUsers = loadedUsers.filter((user) => user.username && (user.passwordHash || user.passwordLegacy))
    setAuthStep(validUsers.length === 0 ? 'master' : 'login')
    setMasterLogin({ username: '', password: '' })
    setOwnerSetup({ fullName: '', username: '', password: '' })
    setLoginForm({ username: '', password: '' })
    setAuthError('')

    setCutForm({
      date: todayISO(),
      openingCash: '0',
      expenses: '0',
      countedCash: '0',
      shortagePaid: '0',
      shortagePaidLabel: 'Pagado',
      notes: '',
    })
    setNewCategoryName('')
  }, [activePosId, primaryPosId])

  useEffect(() => {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
    localStorage.setItem(scopedStorageKey(PRODUCT_STORAGE_KEY, activePosId), JSON.stringify(products))
    localStorage.setItem(scopedStorageKey(SUPPLIERS_STORAGE_KEY, activePosId), JSON.stringify(suppliers))
    localStorage.setItem(
      scopedStorageKey(PURCHASE_ORDERS_STORAGE_KEY, activePosId),
      JSON.stringify(purchaseOrders),
    )
    localStorage.setItem(scopedStorageKey(SALES_STORAGE_KEY, activePosId), JSON.stringify(sales))
    localStorage.setItem(scopedStorageKey(CUTS_STORAGE_KEY, activePosId), JSON.stringify(cuts))
    localStorage.setItem(scopedStorageKey(CASHBOX_STORAGE_KEY, activePosId), JSON.stringify(cashBox))
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(currentUser))
    localStorage.setItem(
      scopedStorageKey(TICKET_SETTINGS_STORAGE_KEY, activePosId),
      JSON.stringify(ticketSettings),
    )
    localStorage.setItem(scopedStorageKey(CATEGORY_STORAGE_KEY, activePosId), JSON.stringify(categories))
  }, [
    activePosId,
    cashBox,
    categories,
    currentUser,
    cuts,
    products,
    purchaseOrders,
    sales,
    suppliers,
    ticketSettings,
    users,
  ])

  useEffect(() => {
    if (!ticketSettings.useLogoTheme) {
      setLogoThemePalette(defaultThemePalette)
      return
    }

    const logoUrl = ticketSettings.logoUrl
    if (!logoUrl) {
      setLogoThemePalette(defaultThemePalette)
      return
    }

    let cancelled = false
    const image = new Image()

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('No canvas context')

        const size = 48
        canvas.width = size
        canvas.height = size
        ctx.drawImage(image, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)

        const bins = new Map()
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3]
          if (alpha < 140) continue

          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]

          const { s, l } = rgbToHsl(r, g, b)
          if (l > 0.95 || l < 0.1) continue

          const qr = Math.round(r / 24) * 24
          const qg = Math.round(g / 24) * 24
          const qb = Math.round(b / 24) * 24
          const key = `${qr},${qg},${qb}`
          const score = (s + 0.12) * (1 - Math.abs(l - 0.52))

          bins.set(key, (bins.get(key) || 0) + score)
        }

        const sorted = [...bins.entries()].sort((a, b) => b[1] - a[1])
        const primary = sorted[0]?.[0]
          ? sorted[0][0].split(',').map((n) => Number(n))
          : [15, 118, 110]
        const secondary = sorted[1]?.[0]
          ? sorted[1][0].split(',').map((n) => Number(n))
          : primary

        const intensity = clamp(Number(ticketSettings.logoThemeIntensity) || 1, 0.7, 1.8)
        const brandBase = rgbToHex(primary[0], primary[1], primary[2])
        const brand = mixHex(brandBase, '#000000', clamp(0.08 + (intensity - 1) * 0.1, 0.03, 0.2))
        const brandDark = mixHex(brand, '#000000', clamp(0.34 + (intensity - 1) * 0.14, 0.24, 0.52))
        const accentBase = rgbToHex(secondary[0], secondary[1], secondary[2])
        const accent = mixHex(accentBase, brand, clamp(0.2 + (intensity - 1) * 0.22, 0.08, 0.5))

        const palette = {
          brand,
          brandDark,
          accent,
          heroA: mixHex(brand, '#ffffff', clamp(0.78 - (intensity - 1) * 0.22, 0.52, 0.88)),
          heroB: mixHex(accent, '#ffffff', clamp(0.72 - (intensity - 1) * 0.26, 0.46, 0.86)),
          heroBorder: mixHex(brand, '#ffffff', clamp(0.6 - (intensity - 1) * 0.16, 0.38, 0.74)),
        }

        if (!cancelled) setLogoThemePalette(palette)
      } catch {
        if (!cancelled) setLogoThemePalette(defaultThemePalette)
      }
    }

    image.onerror = () => {
      if (!cancelled) setLogoThemePalette(defaultThemePalette)
    }

    image.src = logoUrl

    return () => {
      cancelled = true
    }
  }, [ticketSettings.logoThemeIntensity, ticketSettings.logoUrl, ticketSettings.useLogoTheme])

  const appThemeStyle = useMemo(
    () => ({
      '--brand': logoThemePalette.brand,
      '--brand-dark': logoThemePalette.brandDark,
      '--accent': logoThemePalette.accent,
      '--hero-a': logoThemePalette.heroA,
      '--hero-b': logoThemePalette.heroB,
      '--hero-border': logoThemePalette.heroBorder,
    }),
    [logoThemePalette],
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ticketId = params.get('ticketId')
    const autoDownload = params.get('autodownload') === '1'
    const hidePendingNotice = params.get('hidePending') === '1'
    if (!ticketId || !autoDownload) return
    if (autoDownloadedTicketRef.current === ticketId) return

    const sale = sales.find((item) => item.id === ticketId)
    if (!sale) return

    autoDownloadedTicketRef.current = ticketId
    downloadTicketPdf(sale, undefined, { hidePendingNotice })
  }, [sales])

  useEffect(() => {
    if (activePosId !== 'primary') {
      setServerMode('offline')
      return
    }

    let cancelled = false

    const loadServerState = async () => {
      try {
        const response = await fetch(API_STATE_URL)
        if (!response.ok) throw new Error('No server state')

        const payload = await response.json()
        const state = payload?.state

        if (!cancelled && state && typeof state === 'object') {
          if (Array.isArray(state.users)) setUsers(state.users.map(normalizeUser))
          if (Array.isArray(state.products)) setProducts(state.products.map(normalizeProduct))
          if (Array.isArray(state.sales)) setSales(state.sales.map(normalizeSale))
          if (Array.isArray(state.cuts)) setCuts(state.cuts)
          if (Array.isArray(state.suppliers)) setSuppliers(state.suppliers.map(normalizeSupplier))
          if (Array.isArray(state.purchaseOrders)) {
            setPurchaseOrders(state.purchaseOrders.map(normalizePurchaseOrder))
          }
          if (state.cashBox && typeof state.cashBox === 'object') setCashBox(state.cashBox)
          if (state.ticketSettings && typeof state.ticketSettings === 'object') {
            setTicketSettings(normalizeTicketSettings(state.ticketSettings))
          }
        }

        if (!cancelled) {
          setServerMode('online')
          serverSyncReadyRef.current = true
        }
      } catch {
        if (!cancelled) {
          setServerMode('offline')
        }
      }
    }

    loadServerState()
    return () => {
      cancelled = true
    }
  }, [activePosId])

  useEffect(() => {
    if (activePosId !== 'primary') return
    if (serverMode !== 'online' || !serverSyncReadyRef.current) return

    if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current)

    serverSyncTimerRef.current = setTimeout(async () => {
      try {
        await fetch(API_STATE_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: {
              users,
              products,
              sales,
              cuts,
              cashBox,
              suppliers,
              purchaseOrders,
              ticketSettings,
            },
          }),
        })
      } catch {
        setServerMode('offline')
      }
    }, 500)

    return () => {
      if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current)
    }
  }, [
    activePosId,
    cashBox,
    cuts,
    products,
    purchaseOrders,
    sales,
    serverMode,
    suppliers,
    ticketSettings,
    users,
  ])

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const today = todayISO()
    if (cashBox.date === today) return

    setCashBox({
      isOpen: false,
      date: today,
      openingCash: 0,
      openedById: '',
      openedByName: '',
      openedAt: null,
      closedAt: null,
    })
    setCutForm({
      date: today,
      openingCash: '0',
      expenses: '0',
      countedCash: '0',
      shortagePaid: '0',
      shortagePaidLabel: 'Pagado',
      notes: '',
    })
    setCart([])
  }, [cashBox.date, now])

  useEffect(() => {
    setCart((current) =>
      current
        .map((item) => {
          const product = products.find((productItem) => productItem.id === item.id)
          if (!product || product.stock <= 0) return null
          return { ...item, quantity: Math.min(item.quantity, product.stock) }
        })
        .filter(Boolean),
    )
  }, [products])

  useEffect(() => {
    if (!currentUser) return
    const stillExists = users.find((user) => user.id === currentUser.id)
    if (!stillExists) {
      setCurrentUser(null)
      return
    }
    if (stillExists.active === false) {
      setCurrentUser(null)
      setAuthError('Tu usuario está desactivado. Solicita activación al administrador.')
      return
    }
    if (
      stillExists.fullName !== currentUser.fullName ||
      stillExists.username !== currentUser.username ||
      stillExists.role !== currentUser.role ||
      stillExists.active !== currentUser.active
    ) {
      setCurrentUser(stillExists)
    }
  }, [users, currentUser])

  const isAdmin = currentUser?.role === 'admin'
  const canManageUsers = activePosId === primaryPosId
  const canManagePosControl = activePosId === primaryPosId
  const orderedPosIds = useMemo(() => {
    const ordered = [...new Set(posOrder.filter((id) => posRegistryIds.includes(id)))]
    const withMissing = [...ordered, ...posRegistryIds.filter((id) => !ordered.includes(id))]
    return withMissing.includes('primary') ? withMissing : ['primary', ...withMissing]
  }, [posOrder, posRegistryIds])
  const visiblePosIds = useMemo(() => {
    const hidden = new Set(posVisibility.hiddenIds || [])
    const filtered = orderedPosIds.filter((id) => id === 'primary' || !hidden.has(id))
    return filtered.includes('primary') ? filtered : ['primary', ...filtered]
  }, [orderedPosIds, posVisibility.hiddenIds])

  const getPosDisplayName = (posId) => {
    const settings = readTicketSettings(posId)
    const configured = String(settings.storeName || '').trim()
    if (configured) return configured
    const index = orderedPosIds.findIndex((id) => id === posId)
    if (posId === 'primary') return 'POS Principal'
    return `POS ${index + 1}`
  }

  const getPosLogo = (posId) => String(readTicketSettings(posId).logoUrl || '').trim()

  const switchTargetPosId = visiblePosIds.find((id) => id !== activePosId) || null
  const switchTargetName = switchTargetPosId ? getPosDisplayName(switchTargetPosId) : ''
  const switchTargetLogo = switchTargetPosId ? getPosLogo(switchTargetPosId) : ''

  const recycleBinItems = useMemo(
    () =>
      deletedPosBin
        .map((item) => {
          const msLeft = new Date(item.purgeAt).getTime() - Date.now()
          const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)))
          return { ...item, daysLeft }
        })
        .sort((a, b) => new Date(b.removedAt).getTime() - new Date(a.removedAt).getTime()),
    [deletedPosBin, now],
  )

  const adminSections = useMemo(
    () => [
      ...(canManageUsers ? [{ id: 'users', label: 'Usuarios' }] : []),
      ...(canManagePosControl ? [{ id: 'pos-control', label: 'Control POS' }] : []),
      { id: 'ticket', label: 'Ticket' },
      { id: 'inventory', label: 'Inventario' },
      { id: 'dashboard', label: 'Resumen' },
      { id: 'analytics', label: 'Analítica' },
      { id: 'purchase-orders', label: 'Órdenes de compra' },
      { id: 'suppliers', label: 'Proveedores' },
    ],
    [canManagePosControl, canManageUsers],
  )

  useEffect(() => {
    if (!isAdmin && activeTab === 'admin') {
      setActiveTab('sales')
    }
  }, [activeTab, isAdmin])

  useEffect(() => {
    if (!isAdmin || activeTab !== 'admin') return
    const exists = adminSections.some((section) => section.id === adminSection)
    if (!exists) {
      setAdminSection(adminSections[0]?.id || 'ticket')
    }
  }, [activeTab, adminSection, adminSections, isAdmin])

  useEffect(() => {
    if (!currentUser || !shouldPromptPosPicker) return
    if (visiblePosIds.length <= 1) {
      setShouldPromptPosPicker(false)
      return
    }
    setShowPosPickerModal(true)
  }, [currentUser, shouldPromptPosPicker, visiblePosIds])

  const usersWithCredentials = useMemo(
    () => users.filter((user) => user.username && (user.passwordHash || user.passwordLegacy)),
    [users],
  )

  useEffect(() => {
    const cleaned = users.filter((user) => user.username && (user.passwordHash || user.passwordLegacy))
    if (cleaned.length !== users.length) {
      setUsers(cleaned)
      return
    }

    if (cleaned.length === 0) {
      setCurrentUser(null)
      setAuthStep('master')
    }
  }, [users])

  const metrics = useMemo(() => {
    const stockValueCost = products.reduce((sum, item) => sum + item.cost * item.stock, 0)
    const stockValueSale = products.reduce((sum, item) => sum + item.price * item.stock, 0)
    const grossSales = sales.reduce((sum, sale) => sum + sale.total, 0)
    const totalCostOfSales = sales.reduce((sum, sale) => sum + sale.totalCost, 0)
    const netProfit = grossSales - totalCostOfSales
    const totalInvestment = stockValueCost + totalCostOfSales

    return {
      stockValueCost,
      stockValueSale,
      grossSales,
      totalCostOfSales,
      netProfit,
      totalInvestment,
    }
  }, [products, sales])

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  )

  const filteredProducts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return []

    return products.filter((product) => {
      const searchable = `${product.code} ${product.name} ${product.brand} ${product.supplier} ${product.category} ${product.locationArea} ${product.locationBin}`.toLowerCase()
      return searchable.includes(query)
    })
  }, [products, searchTerm])

  const hasSearchQuery = searchTerm.trim().length > 0

  const lowStockProducts = useMemo(
    () => products.filter((product) => product.stock <= product.minStock),
    [products],
  )

  const purchaseCreditNotifications = useMemo(() => {
    const pending = []

    purchaseOrders.forEach((order) => {
      if (order.status !== 'supplied') return
      if (order.supplyPayment?.paymentMethod !== 'credito') return

      const nextPending = [...order.creditPayments]
        .filter((payment) => payment.status === 'pending')
        .sort((a, b) => a.number - b.number)[0]

      if (!nextPending) return

      pending.push({
        orderId: order.id,
        paymentId: nextPending.id,
        supplierName: order.supplierName,
        dueDate: nextPending.dueDate,
        amount: nextPending.amount,
        number: nextPending.number,
        total: nextPending.total,
      })
    })

    return pending.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  }, [purchaseOrders])

  const alertBadgeCount = lowStockProducts.length + purchaseCreditNotifications.length

  const salesAnalytics = useMemo(() => {
    const totalTickets = sales.length
    const totalRevenue = sales.reduce((sum, sale) => sum + sale.total, 0)
    const totalItems = sales.reduce(
      (sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    )

    const byProduct = {}
    sales.forEach((sale) => {
      sale.items.forEach((item) => {
        const key = item.id || `${item.code}-${item.name}`
        if (!byProduct[key]) {
          byProduct[key] = {
            key,
            code: item.code,
            name: item.name,
            quantity: 0,
            revenue: 0,
          }
        }
        byProduct[key].quantity += item.quantity
        byProduct[key].revenue += item.quantity * item.price
      })
    })

    const bestSellers = Object.values(byProduct)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 15)

    return {
      totalTickets,
      averageTicket: totalTickets > 0 ? totalRevenue / totalTickets : 0,
      averageItemsPerTicket: totalTickets > 0 ? totalItems / totalTickets : 0,
      totalItems,
      bestSellers,
    }
  }, [sales])

  const supplierMap = useMemo(() => {
    const map = {}
    suppliers.forEach((supplier) => {
      map[supplier.name.toLowerCase()] = supplier
    })
    return map
  }, [suppliers])

  useEffect(() => {
    const fromProducts = products
      .map((item) => String(item.category || '').trim())
      .filter(Boolean)
    setCategories((current) => {
      const merged = [...new Set(['General', ...current, ...fromProducts])]
      return merged
    })
  }, [products])

  const registerCategory = (rawCategory) => {
    const category = String(rawCategory || '').trim()
    if (!category) return false

    setCategories((current) => {
      const exists = current.some((item) => item.toLowerCase() === category.toLowerCase())
      if (exists) return current
      return [...current, category]
    })
    return true
  }

  const addCategoryManually = () => {
    const source = String(newCategoryName || '').trim() || String(newProduct.category || '').trim()
    const added = registerCategory(source)
    if (!added) return
    setNewProduct((current) => ({ ...current, category: source }))
    setNewCategoryName('')
  }

  const cutPreview = useMemo(() => {
    if (!cashBox.isOpen) {
      return {
        expectedCash: 0,
        shortageAmount: 0,
      }
    }

    const openingCash = Number(cashBox.openingCash) || 0
    const expenses = Number(cutForm.expenses) || 0
    const countedCash = Number(cutForm.countedCash) || 0
    const salesOfDay = sales.filter((sale) => sale.date === cashBox.date)
    const cashSales = salesOfDay
      .filter((sale) => sale.paymentMethod === 'efectivo')
      .reduce((sum, sale) => sum + sale.total, 0)
    const expectedCash = openingCash + cashSales - expenses
    const shortageAmount = Math.max(0, expectedCash - countedCash)

    return {
      expectedCash,
      shortageAmount,
    }
  }, [cashBox.date, cashBox.isOpen, cashBox.openingCash, cutForm.countedCash, cutForm.expenses, sales])

  const switchPos = () => {
    if (!switchTargetPosId) return

    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
    localStorage.setItem(scopedStorageKey(PRODUCT_STORAGE_KEY, activePosId), JSON.stringify(products))
    localStorage.setItem(scopedStorageKey(SUPPLIERS_STORAGE_KEY, activePosId), JSON.stringify(suppliers))
    localStorage.setItem(
      scopedStorageKey(PURCHASE_ORDERS_STORAGE_KEY, activePosId),
      JSON.stringify(purchaseOrders),
    )
    localStorage.setItem(scopedStorageKey(SALES_STORAGE_KEY, activePosId), JSON.stringify(sales))
    localStorage.setItem(scopedStorageKey(CUTS_STORAGE_KEY, activePosId), JSON.stringify(cuts))
    localStorage.setItem(scopedStorageKey(CASHBOX_STORAGE_KEY, activePosId), JSON.stringify(cashBox))
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(currentUser))
    localStorage.setItem(
      scopedStorageKey(TICKET_SETTINGS_STORAGE_KEY, activePosId),
      JSON.stringify(ticketSettings),
    )
    localStorage.setItem(scopedStorageKey(CATEGORY_STORAGE_KEY, activePosId), JSON.stringify(categories))
    requestOpenPos(switchTargetPosId)
  }

  const initializePosData = (posId, nextStoreName = '') => {
    localStorage.setItem(scopedStorageKey(DATA_VERSION_KEY, posId), CLEAN_START_VERSION)
    localStorage.setItem(scopedStorageKey(PRODUCT_STORAGE_KEY, posId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(SALES_STORAGE_KEY, posId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(CUTS_STORAGE_KEY, posId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(SUPPLIERS_STORAGE_KEY, posId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(PURCHASE_ORDERS_STORAGE_KEY, posId), JSON.stringify([]))
    localStorage.setItem(scopedStorageKey(CATEGORY_STORAGE_KEY, posId), JSON.stringify(['General']))
    localStorage.setItem(
      scopedStorageKey(CASHBOX_STORAGE_KEY, posId),
      JSON.stringify({
        isOpen: false,
        date: todayISO(),
        openingCash: 0,
        openedById: '',
        openedByName: '',
        openedAt: null,
        closedAt: null,
      }),
    )
    localStorage.setItem(
      scopedStorageKey(TICKET_SETTINGS_STORAGE_KEY, posId),
      JSON.stringify({
        ...defaultTicketSettings,
        storeName: nextStoreName || defaultTicketSettings.storeName,
      }),
    )
  }

  const createPos = () => {
    const currentIds = new Set(posRegistryIds)
    let posId = `pos-${Date.now().toString(36)}`
    while (currentIds.has(posId)) {
      posId = `pos-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`
    }
    const nextIndex = posRegistry.length + 1
    const nextStoreName = `POS ${nextIndex}`

    initializePosData(posId, nextStoreName)
    setPosRegistry((current) => [...current, { id: posId, defaultName: nextStoreName }])
    setPosVisibility((current) => ({
      ...current,
      hiddenIds: (current.hiddenIds || []).filter((id) => id !== posId),
    }))
    setPosOrder((current) => [...new Set([...current, posId])])
    setShowPosPickerModal(true)
    requestOpenPos(posId)
  }

  const askForConfirmation = (title, message) =>
    new Promise((resolve) => {
      setAppMessageModal({
        title,
        message,
        resolve,
      })
    })

  const removePos = async (posId) => {
    if (!posId || posId === 'primary') return
    if (!posRegistryIds.includes(posId)) return

    const posName = getPosDisplayName(posId)
    const confirmed = await askForConfirmation(
      'Confirmar eliminación',
      `¿Eliminar ${posName}? Se moverá a la papelera y podrás recuperarlo durante ${POS_RECOVERY_WINDOW_DAYS} días.`,
    )
    if (!confirmed) return

    const removedAt = new Date().toISOString()
    const purgeAt = new Date(Date.now() + POS_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const snapshot = {
      id: posId,
      defaultName: posRegistry.find((item) => item.id === posId)?.defaultName || posName,
      removedAt,
      purgeAt,
      hiddenBefore: (posVisibility.hiddenIds || []).includes(posId),
      orderIndex: posOrder.indexOf(posId),
      wasPrimary: primaryPosId === posId,
      lockHash: getPosLockHash(posId),
      storage: POS_SCOPED_STORAGE_KEYS.reduce((acc, key) => {
        acc[key] = localStorage.getItem(scopedStorageKey(key, posId))
        return acc
      }, {}),
    }

    setDeletedPosBin((current) => [snapshot, ...current.filter((item) => item.id !== posId)])

    localStorage.removeItem(scopedStorageKey(DATA_VERSION_KEY, posId))
    localStorage.removeItem(scopedStorageKey(PRODUCT_STORAGE_KEY, posId))
    localStorage.removeItem(scopedStorageKey(SALES_STORAGE_KEY, posId))
    localStorage.removeItem(scopedStorageKey(CUTS_STORAGE_KEY, posId))
    localStorage.removeItem(scopedStorageKey(CASHBOX_STORAGE_KEY, posId))
    localStorage.removeItem(scopedStorageKey(SUPPLIERS_STORAGE_KEY, posId))
    localStorage.removeItem(scopedStorageKey(PURCHASE_ORDERS_STORAGE_KEY, posId))
    localStorage.removeItem(scopedStorageKey(TICKET_SETTINGS_STORAGE_KEY, posId))
    localStorage.removeItem(scopedStorageKey(CATEGORY_STORAGE_KEY, posId))

    setPosRegistry((current) => current.filter((item) => item.id !== posId))
    setPosVisibility((current) => ({
      ...current,
      hiddenIds: (current.hiddenIds || []).filter((id) => id !== posId),
    }))
    setPosOrder((current) => current.filter((id) => id !== posId))
    setPosSecurity((current) => {
      const next = { ...(current.lockById || {}) }
      delete next[posId]
      return { lockById: next }
    })

    if (primaryPosId === posId) {
      setPrimaryPosId('primary')
    }
    if (activePosId === posId) {
      setActivePosId('primary')
      setActiveTab('sales')
    }
  }

  const restoreDeletedPos = (posId) => {
    const entry = deletedPosBin.find((item) => item.id === posId)
    if (!entry) return
    if (posRegistryIds.includes(posId)) {
      setDeletedPosBin((current) => current.filter((item) => item.id !== posId))
      return
    }

    Object.entries(entry.storage || {}).forEach(([baseKey, rawValue]) => {
      const storageKey = scopedStorageKey(baseKey, posId)
      if (rawValue === null || rawValue === undefined) {
        localStorage.removeItem(storageKey)
        return
      }
      localStorage.setItem(storageKey, String(rawValue))
    })

    setPosRegistry((current) => [...current, { id: posId, defaultName: entry.defaultName || `POS ${current.length + 1}` }])
    setPosOrder((current) => {
      const cleaned = current.filter((id) => id !== posId)
      const index = Number(entry.orderIndex)
      if (!Number.isFinite(index) || index < 0 || index >= cleaned.length) {
        return [...cleaned, posId]
      }
      const next = [...cleaned]
      next.splice(index, 0, posId)
      return next
    })
    setPosVisibility((current) => {
      const hiddenIds = new Set(current.hiddenIds || [])
      if (entry.hiddenBefore) hiddenIds.add(posId)
      else hiddenIds.delete(posId)
      return { ...current, hiddenIds: [...hiddenIds] }
    })
    if (entry.lockHash) {
      setPosSecurity((current) => ({
        lockById: {
          ...(current.lockById || {}),
          [posId]: entry.lockHash,
        },
      }))
    }
    if (entry.wasPrimary) {
      setPrimaryPosId(posId)
    }

    setDeletedPosBin((current) => current.filter((item) => item.id !== posId))
  }

  const togglePosVisibility = (posId) => {
    if (!posId || posId === 'primary') return
    setPosVisibility((current) => {
      const hiddenIds = new Set(current.hiddenIds || [])
      const nextHidden = !hiddenIds.has(posId)
      if (nextHidden) hiddenIds.add(posId)
      else hiddenIds.delete(posId)
      if (nextHidden && activePosId === posId) {
        setActivePosId('primary')
        setActiveTab('sales')
      }
      return { ...current, hiddenIds: [...hiddenIds] }
    })
  }

  const movePos = (posId, direction) => {
    if (!posId) return
    setPosOrder((current) => {
      const index = current.indexOf(posId)
      if (index < 0) return current
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next
    })
  }

  const transferPrimaryPos = (targetPosId) => {
    if (!targetPosId || targetPosId === primaryPosId) return
    if (!posRegistryIds.includes(targetPosId)) return
    setPrimaryPosId(targetPosId)
    setActiveTab('admin')
    setAdminSection(targetPosId === activePosId ? 'users' : 'ticket')
  }

  const getPosLockHash = (posId) => String(posSecurity.lockById?.[posId] || '')

  const setPosLockHash = (posId, hash) => {
    setPosSecurity((current) => ({
      lockById: {
        ...(current.lockById || {}),
        [posId]: String(hash || ''),
      },
    }))
  }

  const clearPosLock = (posId) => {
    setPosLockHash(posId, '')
  }

  const openPosSecurityEditor = (posId) => {
    if (!posId) return
    setSecurityEditorPosId(posId)
    setNewPosLockPassword('')
    setShowNewPosLockPassword(false)
  }

  const closePosSecurityEditor = () => {
    setSecurityEditorPosId('')
    setNewPosLockPassword('')
    setShowNewPosLockPassword(false)
  }

  const savePosLock = (posId) => {
    const password = String(newPosLockPassword || '').trim()
    if (!password) return
    setPosLockHash(posId, hashPassword(password))
    closePosSecurityEditor()
  }

  const openPosDirectly = (posId) => {
    if (!posId || posId === activePosId) {
      setShowPosPickerModal(false)
      setShouldPromptPosPicker(false)
      return
    }
    setActivePosId(posId)
    setShowPosPickerModal(false)
    setPendingPosUnlockId('')
    setPosUnlockPassword('')
    setPosUnlockError('')
    setShouldPromptPosPicker(false)
  }

  const requestOpenPos = (posId) => {
    const lockHash = getPosLockHash(posId)
    if (!lockHash) {
      openPosDirectly(posId)
      return
    }

    setShowPosPickerModal(true)
    setPendingPosUnlockId(posId)
    setPosUnlockPassword('')
    setPosUnlockError('')
  }

  const confirmPosUnlock = (event) => {
    event.preventDefault()
    if (!pendingPosUnlockId) return

    const lockHash = getPosLockHash(pendingPosUnlockId)
    if (!lockHash) {
      openPosDirectly(pendingPosUnlockId)
      return
    }

    if (hashPassword(posUnlockPassword) !== lockHash) {
      setPosUnlockError('Contraseña incorrecta para ese POS.')
      return
    }

    openPosDirectly(pendingPosUnlockId)
  }

  const supplierNames = useMemo(
    () => suppliers.map((supplier) => supplier.name).sort((a, b) => a.localeCompare(b, 'es-MX')),
    [suppliers],
  )

  const manualOrderProductOptions = useMemo(() => {
    const selectedSupplier = manualOrderForm.supplierName.trim().toLowerCase()
    const list = selectedSupplier
      ? products.filter((product) => (product.supplier || '').trim().toLowerCase() === selectedSupplier)
      : products

    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'es-MX'))
  }, [manualOrderForm.supplierName, products])

  const selectedSupplyOrder = useMemo(
    () => purchaseOrders.find((order) => order.id === supplyOrderId) ?? null,
    [purchaseOrders, supplyOrderId],
  )

  const invalidSupplyLineCount = useMemo(
    () =>
      supplyOrderItems.filter((item) => {
        const quantity = Number(item.quantity) || 0
        const totalCost = Number(item.totalCost) || 0
        return quantity <= 0 || totalCost <= 0
      }).length,
    [supplyOrderItems],
  )

  const pendingTicketMatch = useMemo(() => {
    const code = pendingTicketSearchCode.trim().toUpperCase()
    if (!code) return null

    return (
      sales.find(
        (sale) =>
          sale.deliveryStatus === 'pending' &&
          String(sale.pendingDeliveryCode || '').trim().toUpperCase() === code,
      ) ?? null
    )
  }, [pendingTicketSearchCode, sales])

  useEffect(() => {
    if (!showPendingTicketModal || !pendingTicketMatch) return

    const timer = setTimeout(() => {
      pendingFulfillButtonRef.current?.focus()
    }, 0)

    return () => clearTimeout(timer)
  }, [pendingTicketMatch, showPendingTicketModal])

  const groupedInventory = useMemo(() => {
    const query = inventorySearchTerm.trim().toLowerCase()
    const filtered = products.filter((product) => {
      if (!query) return true
      const searchable = `${product.code} ${product.name} ${product.supplier}`.toLowerCase()
      return searchable.includes(query)
    })

    const sorted = [...filtered].sort((a, b) => {
      const supplierCompare = (a.supplier || 'Sin proveedor').localeCompare(
        b.supplier || 'Sin proveedor',
        'es-MX',
      )
      if (supplierCompare !== 0) return supplierCompare
      return a.name.localeCompare(b.name, 'es-MX')
    })

    return sorted.reduce((acc, product) => {
      const supplierName = product.supplier || 'Sin proveedor'
      if (!acc[supplierName]) acc[supplierName] = []
      acc[supplierName].push(product)
      return acc
    }, {})
  }, [inventorySearchTerm, products])

  useEffect(() => {
    const productsToOrder = products.filter((product) => product.stock <= 5)
    if (productsToOrder.length === 0) return

    setPurchaseOrders((current) => {
      const openOrders = current.filter((order) => order.status === 'open')
      const productIdsInOpenOrders = new Set(
        openOrders.flatMap((order) => order.items.map((item) => item.productId)),
      )

      const pendingBySupplier = productsToOrder
        .filter((product) => !productIdsInOpenOrders.has(product.id))
        .reduce((acc, product) => {
          const supplierName = product.supplier?.trim() || 'Sin proveedor'
          if (!acc[supplierName]) acc[supplierName] = []
          const desiredStock = Math.max(product.minStock * 2, 10)
          acc[supplierName].push({
            productId: product.id,
            code: product.code,
            name: product.name,
            currentStock: product.stock,
            minStock: product.minStock,
            recommendedQty: Math.max(desiredStock - product.stock, 1),
            orderedQty: Math.max(desiredStock - product.stock, 1),
            suppliedQty: 0,
            suppliedCostTotal: 0,
            suppliedUnitCost: 0,
          })
          return acc
        }, {})

      const newOrders = Object.entries(pendingBySupplier).map(([supplierName, items]) => ({
        id: crypto.randomUUID(),
        supplierName,
        createdAt: new Date().toISOString(),
        status: 'open',
        autoGenerated: true,
        items,
      }))

      if (newOrders.length === 0) return current
      return [...newOrders, ...current]
    })
  }, [products])

  useEffect(() => {
    if (!supplyOrderId) return
    const total = supplyOrderItems.reduce((sum, item) => sum + (Number(item.totalCost) || 0), 0)
    setSupplyOrderForm((current) => ({
      ...current,
      totalAmount: total > 0 ? total.toFixed(2) : '',
    }))
  }, [supplyOrderId, supplyOrderItems])

  const fullDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(now),
    [now],
  )

  const liveTimeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(now),
    [now],
  )

  const userMovements = useMemo(() => {
    const allPosMovements = orderedPosIds.flatMap((posId) => {
      const posName = getPosDisplayName(posId)
      const rawSales =
        posId === activePosId
          ? sales
          : readStorageAny(
              posId === 'primary'
                ? [SALES_STORAGE_KEY, LEGACY_SALES_STORAGE_KEY]
                : [scopedStorageKey(SALES_STORAGE_KEY, posId)],
              [],
            )
      const rawCuts =
        posId === activePosId
          ? cuts
          : readStorageAny(
              posId === 'primary'
                ? [CUTS_STORAGE_KEY, LEGACY_CUTS_STORAGE_KEY]
                : [scopedStorageKey(CUTS_STORAGE_KEY, posId)],
              [],
            )

      const salesList = Array.isArray(rawSales) ? rawSales.map(normalizeSale) : []
      const cutsList = Array.isArray(rawCuts) ? rawCuts : []

      const saleMovements = salesList.map((sale) => ({
        id: `sale-${posId}-${sale.id}`,
        type: 'Venta',
        dateTime: sale.dateTime,
        userId: sale.cashierId || '',
        userName: sale.cashierName || 'No registrado',
        posId,
        posName,
        paymentMethod: sale.paymentMethod,
        total: sale.total,
        detail: `${sale.items.length} producto(s)`,
      }))

      const cutMovements = cutsList.map((cut) => ({
        id: `cut-${posId}-${cut.id}`,
        type: 'Corte',
        dateTime: cut.createdAt,
        userId: cut.closedById || '',
        userName: cut.closedByName || cut.cashierName || 'No registrado',
        posId,
        posName,
        paymentMethod: '-',
        total: cut.totalSales,
        detail: `Cierre del dia ${cut.date}`,
      }))

      return [...saleMovements, ...cutMovements]
    })

    return allPosMovements.sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
  }, [activePosId, cuts, orderedPosIds, sales])

  const filteredUserMovements = useMemo(() => {
    return userMovements.filter((movement) => {
      const matchesUser = !userMovementsFilterUser || movement.userId === userMovementsFilterUser
      const matchesPos = !userMovementsFilterPos || movement.posId === userMovementsFilterPos
      const movementDate = movement.dateTime ? movement.dateTime.slice(0, 10) : ''
      const matchesDate = !userMovementsFilterDate || movementDate === userMovementsFilterDate
      return matchesUser && matchesPos && matchesDate
    })
  }, [userMovements, userMovementsFilterDate, userMovementsFilterPos, userMovementsFilterUser])

  const previewSale = useMemo(() => {
    if (lastSaleForTicket) return lastSaleForTicket
    if (sales[0]) return sales[0]

    return {
      id: 'prev-demo-001',
      dateTime: new Date().toISOString(),
      paymentMethod: 'efectivo',
      cashierName: currentUser?.fullName || 'Usuario demo',
      items: [
        { id: 'demo-1', code: 'P001', name: 'Producto ejemplo', quantity: 1, price: 35 },
        { id: 'demo-2', code: 'P002', name: 'Segundo producto', quantity: 2, price: 12.5 },
      ],
      total: 60,
    }
  }, [currentUser?.fullName, lastSaleForTicket, sales])

  const createBarcodeDataUrl = async (text) => {
    const value = String(text ?? '').trim()
    if (!value) return ''

    try {
      const canvas = document.createElement('canvas')
      JsBarcode(canvas, value, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        width: 1.5,
        height: 44,
      })
      return canvas.toDataURL('image/png')
    } catch {
      return ''
    }
  }

  const printTicket = async (sale, options = {}) => {
    if (!sale) return

    const ticketHtml = await buildTicketHtml(sale, true, options)

    const printWindow = window.open('', '_blank', 'width=420,height=640')
    if (!printWindow) {
      setScanNotice('No se pudo abrir la ventana de impresion. Revisa el bloqueo de popups.')
      return
    }

    printWindow.document.open()
    printWindow.document.write(ticketHtml)
    printWindow.document.close()
  }

  const buildTicketHtml = async (sale, printOnLoad, options = {}) => {
    const hidePendingNotice = Boolean(options.hidePendingNotice)
    const showPending = sale.deliveryStatus === 'pending' && !hidePendingNotice
    const barcodeDataUrl = showPending ? await createBarcodeDataUrl(sale.pendingDeliveryCode) : ''

    const widthMm = ticketSettings.printerWidthMm
    const fontScale = Math.max(0.85, Number(ticketSettings.fontScale) || 1)
    const saleDate = new Date(sale.dateTime).toLocaleString('es-MX')
    const itemsMarkup = sale.items
      .map((item) => {
        const lineTotal = currency.format(item.quantity * item.price)
        const lineUnit = currency.format(item.price)
        const code = ticketSettings.showProductCode && item.code ? `${escapeHtml(item.code)} ` : ''
        return `<div class="ticket-item"><p class="ticket-item-title">${code}${escapeHtml(item.name)}</p><p class="ticket-item-row"><span>${item.quantity} x ${lineUnit}</span><strong>${lineTotal}</strong></p></div>`
      })
      .join('')

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Ticket ${escapeHtml(sale.id)}</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Courier New', monospace; background: #fff; }
    .ticket-paper { width: ${widthMm}mm; margin: 0 auto; padding: 3mm; font-size: ${fontScale}rem; color: #000; }
    .ticket-head { text-align: center; display: grid; gap: 1mm; }
    .ticket-logo { width: 20mm; max-height: 20mm; object-fit: contain; margin: 0 auto 1mm; }
    .ticket-head strong { font-size: 1.1em; }
    .ticket-divider { border-top: 1px dashed #000; margin: 2mm 0; }
    .ticket-paper p { margin: 0 0 1mm; }
    .ticket-item { margin-bottom: 1mm; }
    .ticket-item-title { word-break: break-word; }
    .ticket-item-row { display: flex; justify-content: space-between; gap: 2mm; }
    .ticket-total { display: flex; justify-content: space-between; font-weight: 700; margin-top: 1.5mm; }
    .ticket-pending-note { text-align: center; font-weight: 700; color: #b91c1c; }
    .ticket-barcode { width: 100%; max-height: 15mm; object-fit: contain; margin-top: 1mm; }
    .ticket-code-label { text-align: center; letter-spacing: 0.09em; font-size: 0.9em; margin-top: 0.8mm; }
    .ticket-foot { text-align: center; margin-top: 2mm; }
  </style>
</head>
<body${printOnLoad ? ' onload="window.print(); window.close();"' : ''}>
  <article class="ticket-paper">
    <header class="ticket-head">
      ${ticketSettings.logoUrl ? `<img src="${escapeHtml(ticketSettings.logoUrl)}" alt="Logo" class="ticket-logo" />` : ''}
      <strong>${escapeHtml(ticketSettings.storeName || 'Sistema Punto de Venta')}</strong>
      ${ticketSettings.businessName ? `<span>${escapeHtml(ticketSettings.businessName)}</span>` : ''}
      ${ticketSettings.address ? `<span>${escapeHtml(ticketSettings.address)}</span>` : ''}
      ${ticketSettings.phone || ticketSettings.rfc ? `<span>${ticketSettings.phone ? `Tel: ${escapeHtml(ticketSettings.phone)}` : ''}${ticketSettings.phone && ticketSettings.rfc ? ' | ' : ''}${ticketSettings.rfc ? `RFC: ${escapeHtml(ticketSettings.rfc)}` : ''}</span>` : ''}
    </header>

    <div class="ticket-divider"></div>
    ${ticketSettings.showDate ? `<p>Fecha: ${saleDate}</p>` : ''}
    <p>Folio: ${escapeHtml(sale.id.slice(0, 8).toUpperCase())}</p>
    ${ticketSettings.showCashier ? `<p>Cajero: ${escapeHtml(sale.cashierName || 'No registrado')}</p>` : ''}
    <p>Pago: ${paymentMethodText(sale.paymentMethod)}</p>

    <div class="ticket-divider"></div>
    ${itemsMarkup}

    <div class="ticket-divider"></div>
    <p class="ticket-total"><span>TOTAL</span><strong>${currency.format(sale.total)}</strong></p>
    ${showPending ? `<div class="ticket-divider"></div><p class="ticket-pending-note">PENDIENTE POR ENTREGAR</p>${barcodeDataUrl ? `<img src="${barcodeDataUrl}" alt="Codigo pendiente" class="ticket-barcode" />` : ''}${sale.pendingDeliveryCode ? `<p class="ticket-code-label">${escapeHtml(sale.pendingDeliveryCode)}</p>` : ''}` : ''}
    <footer class="ticket-foot"><p>${escapeHtml(ticketSettings.footerMessage || 'Gracias por su compra')}</p></footer>
  </article>
</body>
</html>`
  }

  const buildTicketPdf = async (sale, options = {}) => {
    const hidePendingNotice = Boolean(options.hidePendingNotice)
    const showPending = sale.deliveryStatus === 'pending' && !hidePendingNotice

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const marginLeft = 12
    const marginRight = 12
    const maxWidth = 210 - marginLeft - marginRight
    const lineGap = 5
    let y = 12

    const ensureSpace = (height = lineGap) => {
      if (y + height <= 285) return
      doc.addPage()
      y = 12
    }

    const addLine = (text, options = {}) => {
      const { bold = false, center = false } = options
      const value = String(text ?? '')
      const lines = doc.splitTextToSize(value, maxWidth)
      lines.forEach((line) => {
        ensureSpace()
        doc.setFont('courier', bold ? 'bold' : 'normal')
        if (center) {
          doc.text(line, 105, y, { align: 'center' })
        } else {
          doc.text(line, marginLeft, y)
        }
        y += lineGap
      })
    }

    const addDivider = () => {
      ensureSpace()
      doc.setDrawColor(120)
      doc.line(marginLeft, y - 2, 210 - marginRight, y - 2)
    }

    addLine(ticketSettings.storeName || 'Sistema Punto de Venta', { bold: true, center: true })
    if (ticketSettings.businessName) addLine(ticketSettings.businessName, { center: true })
    if (ticketSettings.address) addLine(ticketSettings.address, { center: true })
    if (ticketSettings.phone || ticketSettings.rfc) {
      const contact = `${ticketSettings.phone ? `Tel: ${ticketSettings.phone}` : ''}${ticketSettings.phone && ticketSettings.rfc ? ' | ' : ''}${ticketSettings.rfc ? `RFC: ${ticketSettings.rfc}` : ''}`
      addLine(contact, { center: true })
    }

    addDivider()
    if (ticketSettings.showDate) addLine(`Fecha: ${new Date(sale.dateTime).toLocaleString('es-MX')}`)
    addLine(`Folio: ${sale.id.slice(0, 8).toUpperCase()}`)
    if (ticketSettings.showCashier) addLine(`Cajero: ${sale.cashierName || 'No registrado'}`)
    addLine(`Pago: ${paymentMethodText(sale.paymentMethod)}`)
    addDivider()

    sale.items.forEach((item) => {
      const code = ticketSettings.showProductCode && item.code ? `${item.code} ` : ''
      addLine(`${code}${item.name}`)
      addLine(`${item.quantity} x ${currency.format(item.price)}    ${currency.format(item.quantity * item.price)}`)
    })

    addDivider()
    addLine(`TOTAL: ${currency.format(sale.total)}`, { bold: true })

    if (showPending) {
      addDivider()
      addLine('PENDIENTE POR ENTREGAR', { bold: true, center: true })
      const barcodeDataUrl = await createBarcodeDataUrl(sale.pendingDeliveryCode)
      if (barcodeDataUrl) {
        ensureSpace(22)
        doc.addImage(barcodeDataUrl, 'PNG', marginLeft + 18, y, maxWidth - 36, 16)
        y += 18
      }
      if (sale.pendingDeliveryCode) {
        addLine(sale.pendingDeliveryCode, { center: true })
      }
    }

    addLine(ticketSettings.footerMessage || 'Gracias por su compra', { center: true })

    return doc
  }

  const downloadTicketPdf = async (sale, filename, options = {}) => {
    if (!sale) return
    const doc = await buildTicketPdf(sale, options)
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename || `ticket-${sale.id.slice(0, 8).toUpperCase()}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const buildTicketShareUrl = (saleId, hidePendingNotice) => {
    const url = new URL(window.location.href)
    url.searchParams.set('ticketId', saleId)
    url.searchParams.set('autodownload', '1')
    if (hidePendingNotice) {
      url.searchParams.set('hidePending', '1')
    } else {
      url.searchParams.delete('hidePending')
    }
    return url.toString()
  }

  const openDigitalTicket = (sale, options = {}) => {
    if (!sale) return
    const hidePendingNotice = Boolean(options.hidePendingNotice)
    const shareUrl = buildTicketShareUrl(sale.id, hidePendingNotice)

    setDigitalTicketSale(sale)
    setDigitalTicketHidePending(hidePendingNotice)
    setDigitalTicketShareUrl(shareUrl)
    setDigitalTicketQrDataUrl('')
    setDigitalTicketBarcodeDataUrl('')

    if (sale.deliveryStatus === 'pending' && !hidePendingNotice) {
      createBarcodeDataUrl(sale.pendingDeliveryCode).then((dataUrl) => {
        setDigitalTicketBarcodeDataUrl(dataUrl)
      })
    }

    QRCode.toDataURL(shareUrl, {
      width: 260,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        setDigitalTicketQrDataUrl(dataUrl)
      })
      .catch(() => {
        setDigitalTicketQrDataUrl('')
      })

    setShowDigitalTicketModal(true)
  }

  const closeDigitalTicketModal = () => {
    setShowDigitalTicketModal(false)
    setDigitalTicketSale(null)
    setDigitalTicketHidePending(false)
    setDigitalTicketQrDataUrl('')
    setDigitalTicketBarcodeDataUrl('')
    setDigitalTicketShareUrl('')
  }

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setNewProduct((current) => ({ ...current, imageUrl: result }))
    }
    reader.readAsDataURL(file)
  }

  const handleTicketLogoUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setTicketSettings((current) => ({ ...current, logoUrl: result, useLogoTheme: true }))
    }
    reader.readAsDataURL(file)
  }

  const clearTicketLogo = () => {
    setTicketSettings((current) => ({ ...current, logoUrl: '', useLogoTheme: true }))
  }

  const restoreDefaultThemeColors = () => {
    setTicketSettings((current) => ({ ...current, useLogoTheme: false }))
  }

  const applyLogoThemeColors = () => {
    setTicketSettings((current) => ({ ...current, useLogoTheme: true }))
  }

  const setScannerNotice = (text) => {
    setScanNotice(text)
    if (scanNoticeTimerRef.current) clearTimeout(scanNoticeTimerRef.current)
    scanNoticeTimerRef.current = setTimeout(() => {
      setScanNotice('')
    }, 1800)
  }

  const handleMasterLogin = (event) => {
    event.preventDefault()
    setAuthError('')

    if (
      masterLogin.username.trim().toLowerCase() !== MASTER_USERNAME ||
      masterLogin.password !== MASTER_PASSWORD
    ) {
      setAuthError('Credenciales maestras incorrectas.')
      return
    }

    setAuthStep('owner-setup')
    setMasterLogin({ username: '', password: '' })
  }

  const handleOwnerSetup = (event) => {
    event.preventDefault()
    setAuthError('')

    const fullName = ownerSetup.fullName.trim()
    const username = ownerSetup.username.trim().toLowerCase()
    const password = ownerSetup.password

    if (!fullName || !username || !password) {
      setAuthError('Completa todos los datos del administrador.')
      return
    }

    const owner = {
      id: crypto.randomUUID(),
      fullName,
      username,
      passwordHash: hashPassword(password),
      passwordLegacy: '',
      role: 'admin',
      active: true,
      createdAt: new Date().toISOString(),
    }

    setUsers([owner])
    setCurrentUser(owner)
    setShouldPromptPosPicker(true)
    setAuthStep('login')
    setOwnerSetup({ fullName: '', username: '', password: '' })
  }

  const handleLogin = (event) => {
    event.preventDefault()
    setAuthError('')

    const username = loginForm.username.trim().toLowerCase()
    const password = loginForm.password
    const found = usersWithCredentials.find((user) => {
      if (user.username !== username) return false
      const hashedInput = hashPassword(password)
      return user.passwordHash === hashedInput || user.passwordLegacy === password
    })

    if (!found) {
      setAuthError('Usuario o contraseña incorrectos.')
      return
    }

    if (found.active === false) {
      setAuthError('Este usuario está desactivado. Contacta al administrador.')
      return
    }

    if (!found.passwordHash) {
      const upgraded = {
        ...found,
        passwordHash: hashPassword(password),
        passwordLegacy: '',
      }
      setUsers((current) => current.map((user) => (user.id === found.id ? upgraded : user)))
      setCurrentUser(upgraded)
    } else {
      setCurrentUser(found)
    }

    setLoginForm({ username: '', password: '' })
    setShouldPromptPosPicker(true)
  }

  const logout = () => {
    setCurrentUser(null)
    setLoginForm({ username: '', password: '' })
    setShowOpenCashModal(false)
    setShowCutModal(false)
    setShowProductModal(false)
    setEditingProductId('')
    setShowSupplierModal(false)
    setShowTicketDeliveryModal(false)
    setTicketDeliveryRequest(null)
    setShowPendingTicketModal(false)
    setPendingTicketSearchCode('')
    setPendingTicketMatchId('')
    setShowPosPickerModal(false)
    setPendingPosUnlockId('')
    setPosUnlockPassword('')
    setPosUnlockError('')
    closeDigitalTicketModal()
    setEditingSupplierId('')
  }

  const openCreateProductModal = () => {
    setEditingProductId('')
    setNewProduct(emptyProductForm)
    setShowProductModal(true)
  }

  const openEditProductModal = (product) => {
    setEditingProductId(product.id)
    setNewProduct({
      code: product.code,
      name: product.name,
      brand: product.brand,
      supplier: product.supplier,
      category: product.category,
      cost: String(product.cost),
      price: String(product.price),
      stock: String(product.stock),
      minStock: String(product.minStock),
      locationArea: product.locationArea,
      locationBin: product.locationBin,
      imageUrl: product.imageUrl,
    })
    setShowProductModal(true)
  }

  const closeProductModal = () => {
    setShowProductModal(false)
    setEditingProductId('')
    setNewProduct(emptyProductForm)
  }

  const closeSupplierModal = () => {
    setShowSupplierModal(false)
    setEditingSupplierId('')
    setSupplierAddressSuggestions([])
    setSupplierAddressLoading(false)
    setNewSupplierForm(emptySupplierForm)
    setSupplierEditForm(emptySupplierForm)
  }

  const addUser = (event) => {
    event.preventDefault()
    if (!isAdmin) return

    const payload = {
      id: crypto.randomUUID(),
      fullName: newUserForm.fullName.trim(),
      username: newUserForm.username.trim().toLowerCase(),
      passwordHash: hashPassword(newUserForm.password),
      passwordLegacy: '',
      role: newUserForm.role,
      active: true,
      createdAt: new Date().toISOString(),
    }

    if (!payload.fullName || !payload.username || !newUserForm.password) return
    if (users.some((user) => user.username === payload.username)) return

    setUsers((current) => [payload, ...current])
    setNewUserForm(emptyNewUserForm)
  }

  const toggleUserActive = (userId) => {
    if (!isAdmin) return

    setUsers((current) => {
      const target = current.find((user) => user.id === userId)
      if (!target) return current

      const nextActive = target.active === false

      // Evita dejar el sistema sin administradores activos.
      if (!nextActive && target.role === 'admin') {
        const activeAdminCount = current.filter(
          (user) => user.role === 'admin' && user.active !== false,
        ).length
        if (activeAdminCount <= 1) return current
      }

      return current.map((user) =>
        user.id === userId ? { ...user, active: nextActive } : user,
      )
    })
  }

  const addSupplier = (event) => {
    event.preventDefault()
    if (!isAdmin) return

    const payload = {
      id: crypto.randomUUID(),
      name: newSupplierForm.name.trim(),
      contactName: newSupplierForm.contactName.trim(),
      paymentType: newSupplierForm.paymentType,
      transferAccount:
        newSupplierForm.paymentType === 'transferencia'
          ? newSupplierForm.transferAccount.trim()
          : '',
      phone: newSupplierForm.phone.trim(),
      email: newSupplierForm.email.trim(),
      address: newSupplierForm.address.trim(),
      notes: newSupplierForm.notes.trim(),
      createdAt: new Date().toISOString(),
    }

    if (!payload.name) return
    if (suppliers.some((supplier) => supplier.name.toLowerCase() === payload.name.toLowerCase())) return

    setSuppliers((current) => [payload, ...current])
    setNewSupplierForm(emptySupplierForm)
    setSupplierAddressSuggestions([])
    setShowSupplierModal(false)
  }

  const searchSupplierAddress = async () => {
    const sourceForm = editingSupplierId ? supplierEditForm : newSupplierForm
    const query = sourceForm.address.trim()
    if (!query) return

    setSupplierAddressLoading(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        setSupplierAddressSuggestions([])
        return
      }

      const results = await response.json()
      if (!Array.isArray(results)) {
        setSupplierAddressSuggestions([])
        return
      }

      setSupplierAddressSuggestions(
        results.map((item, index) => ({
          id: String(item.place_id ?? index),
          label: String(item.display_name ?? ''),
        })),
      )
    } catch {
      setSupplierAddressSuggestions([])
    } finally {
      setSupplierAddressLoading(false)
    }
  }

  const applySupplierAddressSuggestion = (address) => {
    if (editingSupplierId) {
      setSupplierEditForm((current) => ({ ...current, address }))
    } else {
      setNewSupplierForm((current) => ({ ...current, address }))
    }
    setSupplierAddressSuggestions([])
  }

  const startEditSupplier = (supplier) => {
    setEditingSupplierId(supplier.id)
    setSupplierEditForm({
      name: supplier.name,
      contactName: supplier.contactName,
      paymentType: supplier.paymentType || 'efectivo',
      transferAccount: supplier.transferAccount || '',
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      notes: supplier.notes,
    })
    setSupplierAddressSuggestions([])
    setShowSupplierModal(true)
  }

  const saveSupplierEdit = (event) => {
    event.preventDefault()
    if (!editingSupplierId) return

    const normalizedName = supplierEditForm.name.trim()
    if (!normalizedName) return

    const payload = {
      ...supplierEditForm,
      name: normalizedName,
      contactName: supplierEditForm.contactName.trim(),
      transferAccount:
        supplierEditForm.paymentType === 'transferencia' ? supplierEditForm.transferAccount.trim() : '',
      phone: supplierEditForm.phone.trim(),
      email: supplierEditForm.email.trim(),
      address: supplierEditForm.address.trim(),
      notes: supplierEditForm.notes.trim(),
    }

    const currentSupplier = suppliers.find((supplier) => supplier.id === editingSupplierId)
    if (!currentSupplier) return

    setSuppliers((current) =>
      current.map((supplier) => (supplier.id === editingSupplierId ? { ...supplier, ...payload } : supplier)),
    )

    // Keep products linked to renamed supplier.
    if (currentSupplier.name !== payload.name) {
      setProducts((current) =>
        current.map((product) =>
          product.supplier === currentSupplier.name ? { ...product, supplier: payload.name } : product,
        ),
      )
    }

    setEditingSupplierId('')
    setSupplierEditForm(emptySupplierForm)
    setSupplierAddressSuggestions([])
    setShowSupplierModal(false)
  }

  const deleteSupplier = (supplierId) => {
    const supplier = suppliers.find((item) => item.id === supplierId)
    if (!supplier) return

    setSuppliers((current) => current.filter((item) => item.id !== supplierId))
    setProducts((current) =>
      current.map((product) =>
        product.supplier === supplier.name ? { ...product, supplier: '' } : product,
      ),
    )

    if (editingSupplierId === supplierId) {
      setEditingSupplierId('')
      setSupplierEditForm(emptySupplierForm)
      setShowSupplierModal(false)
    }
  }

  const updatePurchaseOrderStatus = (orderId, status) => {
    setPurchaseOrders((current) =>
      current.map((order) => (order.id === orderId ? { ...order, status } : order)),
    )
  }

  const startSupplyOrder = (order) => {
    setSupplyOrderId(order.id)

    const supplier = supplierMap[order.supplierName.toLowerCase()]
    const suggestedMethod = supplier?.paymentType || 'efectivo'

    const initialItems = order.items.map((item) => ({
      productId: item.productId,
      code: item.code,
      name: item.name,
      quantity: String(Math.max(Number(item.orderedQty ?? item.recommendedQty ?? 0), 0)),
      totalCost: '',
    }))

    setSupplyOrderItems(initialItems)

    setSupplyOrderForm({
      ...emptySupplyOrderForm,
      paymentMethod: suggestedMethod,
    })
  }

  const closeSupplyOrderModal = () => {
    setSupplyOrderId('')
    setSupplyOrderForm(emptySupplyOrderForm)
    setSupplyOrderItems([])
  }

  const updateSupplyOrderItem = (productId, field, value) => {
    setSupplyOrderItems((current) =>
      current.map((item) => (item.productId === productId ? { ...item, [field]: value } : item)),
    )
  }

  const openManualOrderModal = () => {
    setManualOrderForm({
      supplierName: supplierNames[0] || 'Sin proveedor',
      items: [createManualOrderLine()],
    })
    setShowManualOrderModal(true)
  }

  const closeManualOrderModal = () => {
    setShowManualOrderModal(false)
    setManualOrderForm({
      supplierName: '',
      items: [createManualOrderLine()],
    })
  }

  const addManualOrderLine = () => {
    setManualOrderForm((current) => ({
      ...current,
      items: [...current.items, createManualOrderLine()],
    }))
  }

  const removeManualOrderLine = (lineId) => {
    setManualOrderForm((current) => {
      const remaining = current.items.filter((line) => line.id !== lineId)
      return {
        ...current,
        items: remaining.length > 0 ? remaining : [createManualOrderLine()],
      }
    })
  }

  const updateManualOrderLine = (lineId, field, value) => {
    setManualOrderForm((current) => ({
      ...current,
      items: current.items.map((line) => (line.id === lineId ? { ...line, [field]: value } : line)),
    }))
  }

  const submitManualPurchaseOrder = (event) => {
    event.preventDefault()
    if (!isAdmin) return

    const supplierName = manualOrderForm.supplierName.trim()
    if (!supplierName) return

    const aggregated = manualOrderForm.items.reduce((acc, line) => {
      if (line.entryType !== 'existing') return acc

      const productId = line.productId
      const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0))
      if (!productId || quantity <= 0) return acc

      const product = products.find((item) => item.id === productId)
      if (!product) return acc

      if (!acc[productId]) {
        acc[productId] = { product, quantity }
      } else {
        acc[productId].quantity += quantity
      }

      return acc
    }, {})

    const existingItems = Object.values(aggregated).map(({ product, quantity }) => ({
      productId: product.id,
      code: product.code,
      name: product.name,
      isManualProduct: false,
      currentStock: product.stock,
      minStock: product.minStock,
      recommendedQty: quantity,
      orderedQty: quantity,
      suppliedQty: 0,
      suppliedCostTotal: 0,
      suppliedUnitCost: 0,
    }))

    const manualItems = manualOrderForm.items
      .map((line) => {
        if (line.entryType !== 'manual') return null

        const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0))
        const manualName = line.manualName.trim()
        if (!manualName || quantity <= 0) return null

        const manualCode = line.manualCode.trim().toUpperCase()
        const manualCategory = line.manualCategory || 'General'
        const manualSuggestedPrice = Math.max(0, Number(line.manualSuggestedPrice) || 0)
        return {
          productId: `manual-${line.id}`,
          code: manualCode || `MAN-${line.id.slice(0, 6).toUpperCase()}`,
          name: manualName,
          isManualProduct: true,
          manualCategory,
          manualSuggestedPrice,
          currentStock: 0,
          minStock: 5,
          recommendedQty: quantity,
          orderedQty: quantity,
          suppliedQty: 0,
          suppliedCostTotal: 0,
          suppliedUnitCost: 0,
        }
      })
      .filter(Boolean)

    const items = [...existingItems, ...manualItems]

    if (items.length === 0) return

    const newOrder = {
      id: crypto.randomUUID(),
      supplierName,
      createdAt: new Date().toISOString(),
      status: 'open',
      autoGenerated: false,
      suppliedAt: null,
      supplyPayment: null,
      creditPayments: [],
      items,
    }

    setPurchaseOrders((current) => [newOrder, ...current])
    closeManualOrderModal()
  }

  const submitSupplyOrder = (event) => {
    event.preventDefault()
    if (!supplyOrderId) return
    if (invalidSupplyLineCount > 0) return

    const sourceOrder = purchaseOrders.find((order) => order.id === supplyOrderId)
    if (!sourceOrder) return

    const orderItemMap = sourceOrder.items.reduce((acc, item) => {
      acc[item.productId] = item
      return acc
    }, {})

    const suppliedItems = supplyOrderItems
      .map((item) => {
        const quantity = Math.max(0, Number(item.quantity) || 0)
        const totalCost = Math.max(0, Number(item.totalCost) || 0)
        const unitCost = quantity > 0 ? totalCost / quantity : 0
        return {
          productId: item.productId,
          quantity,
          totalCost,
          unitCost,
        }
      })
      .filter((item) => item.quantity > 0)

    if (suppliedItems.length === 0) return

    const totalAmount = Number(supplyOrderForm.totalAmount)
    if (Number.isNaN(totalAmount) || totalAmount <= 0) return

    let creditPayments = []
    if (supplyOrderForm.paymentMethod === 'credito') {
      if (supplyOrderForm.creditMode === 'single') {
        creditPayments = [
          {
            id: crypto.randomUUID(),
            amount: Number(totalAmount.toFixed(2)),
            dueDate: addDaysISO(supplyOrderForm.singleDueDays),
            status: 'pending',
            paidAt: null,
            number: 1,
            total: 1,
          },
        ]
      } else {
        const count = Math.max(2, Number(supplyOrderForm.installmentCount) || 2)
        const amountParts = splitAmount(totalAmount, count)
        const firstDays = Math.max(0, Number(supplyOrderForm.firstPaymentDays) || 0)
        const eachDays = Math.max(1, Number(supplyOrderForm.daysBetweenPayments) || 30)

        creditPayments = amountParts.map((amount, index) => ({
          id: crypto.randomUUID(),
          amount,
          dueDate: addDaysISO(firstDays + index * eachDays),
          status: 'pending',
          paidAt: null,
          number: index + 1,
          total: amountParts.length,
        }))
      }
    }

    const suppliedByProductId = suppliedItems.reduce((acc, item) => {
      acc[item.productId] = item
      return acc
    }, {})

    setProducts((current) => {
      const existingById = current.reduce((acc, product) => {
        acc[product.id] = product
        return acc
      }, {})

      const existingCodeSet = new Set(current.map((product) => product.code.toUpperCase()))
      const newProducts = []

      const ensureUniqueCode = (baseCode) => {
        const normalized = String(baseCode || '').trim().toUpperCase()
        if (normalized && !existingCodeSet.has(normalized)) {
          existingCodeSet.add(normalized)
          return normalized
        }

        let attempt = 1
        let candidate = `${normalized || 'MANUAL'}-${attempt}`
        while (existingCodeSet.has(candidate)) {
          attempt += 1
          candidate = `${normalized || 'MANUAL'}-${attempt}`
        }
        existingCodeSet.add(candidate)
        return candidate
      }

      Object.entries(suppliedByProductId).forEach(([productId, supplied]) => {
        if (existingById[productId]) return

        const item = orderItemMap[productId]
        const unitCost = Number(supplied.unitCost || 0)
        const code = ensureUniqueCode(item?.code)
        const estimatedPrice = Number((unitCost > 0 ? unitCost * 1.35 : 0).toFixed(2))
        const manualSuggestedPrice = Number(item?.manualSuggestedPrice || 0)

        const createdProduct = {
          id: productId,
          code,
          name: item?.name || 'Producto nuevo',
          brand: '',
          supplier: sourceOrder.supplierName,
          category: item?.manualCategory || 'General',
          cost: Number(unitCost.toFixed(2)),
          price: Number((manualSuggestedPrice > 0 ? manualSuggestedPrice : estimatedPrice).toFixed(2)),
          stock: 0,
          minStock: Number(item?.minStock ?? 5),
          locationArea: '',
          locationBin: '',
          imageUrl: '',
        }

        newProducts.push(createdProduct)
        existingById[productId] = createdProduct
      })

      return [...current, ...newProducts].map((product) => {
        const supplied = suppliedByProductId[product.id]
        if (!supplied) return product

        const previousStock = Number(product.stock) || 0
        const previousCost = Number(product.cost) || 0
        const newStock = previousStock + supplied.quantity
        const weightedCost =
          newStock > 0
            ? (previousCost * previousStock + supplied.unitCost * supplied.quantity) / newStock
            : previousCost

        return {
          ...product,
          stock: Number(newStock.toFixed(2)),
          cost: Number(weightedCost.toFixed(2)),
        }
      })
    })

    setPurchaseOrders((current) =>
      current.map((order) => {
        if (order.id !== supplyOrderId) return order
        return {
          ...order,
          status: 'supplied',
          suppliedAt: new Date().toISOString(),
          supplyPayment: {
            paymentMethod: supplyOrderForm.paymentMethod,
            totalAmount,
            creditMode: supplyOrderForm.creditMode,
          },
          items: order.items.map((item) => {
            const supplied = suppliedByProductId[item.productId]
            if (!supplied) return item

            return {
              ...item,
              currentStock: Number((Number(item.currentStock || 0) + supplied.quantity).toFixed(2)),
              suppliedQty: Number(supplied.quantity.toFixed(2)),
              suppliedCostTotal: Number(supplied.totalCost.toFixed(2)),
              suppliedUnitCost: Number(supplied.unitCost.toFixed(2)),
            }
          }),
          creditPayments,
        }
      }),
    )

    closeSupplyOrderModal()
    setShowAlerts(true)
  }

  const confirmCreditPayment = (orderId, paymentId) => {
    setPurchaseOrders((current) =>
      current.map((order) => {
        if (order.id !== orderId) return order

        const creditPayments = order.creditPayments.map((payment) =>
          payment.id === paymentId
            ? { ...payment, status: 'paid', paidAt: new Date().toISOString() }
            : payment,
        )

        const hasPending = creditPayments.some((payment) => payment.status === 'pending')

        return {
          ...order,
          status: hasPending ? 'supplied' : 'closed',
          creditPayments,
        }
      }),
    )
  }

  const saveProduct = (event) => {
    event.preventDefault()
    const cleanedCode = newProduct.code.trim().toUpperCase()
    const cleanedCategory = String(newProduct.category || '').trim() || 'General'
    const payload = {
      id: editingProductId || crypto.randomUUID(),
      code: cleanedCode,
      name: newProduct.name.trim(),
      brand: newProduct.brand.trim(),
      supplier: newProduct.supplier.trim(),
      category: cleanedCategory,
      cost: Number(newProduct.cost),
      price: Number(newProduct.price),
      stock: Number(newProduct.stock),
      minStock: Number(newProduct.minStock),
      locationArea: newProduct.locationArea.trim(),
      locationBin: newProduct.locationBin.trim(),
      imageUrl: newProduct.imageUrl.trim(),
    }

    if (
      !payload.code ||
      !payload.name ||
      payload.cost <= 0 ||
      payload.price <= 0 ||
      payload.stock < 0 ||
      payload.minStock < 0
    ) {
      return
    }

    if (products.some((product) => product.code === payload.code && product.id !== payload.id)) return

    registerCategory(cleanedCategory)

    if (editingProductId) {
      setProducts((current) => current.map((product) => (product.id === editingProductId ? payload : product)))
    } else {
      setProducts((current) => [payload, ...current])
    }

    closeProductModal()
  }

  const openCashRegister = (event) => {
    event.preventDefault()
    if (!currentUser) return

    const amount = Number(openCashForm.openingCash)
    if (Number.isNaN(amount) || amount < 0) return

    const today = todayISO()
    setCashBox({
      isOpen: true,
      date: today,
      openingCash: amount,
      openedById: currentUser.id,
      openedByName: currentUser.fullName,
      openedAt: new Date().toISOString(),
      closedAt: null,
    })
    setCutForm((current) => ({
      ...current,
      date: today,
      openingCash: String(amount),
    }))
    setOpenCashForm(emptyOpenCashForm)
    setShowOpenCashModal(false)
  }

  const openCutModal = () => {
    if (!cashBox.isOpen) return

    setCutForm((current) => ({
      ...current,
      date: cashBox.date,
      openingCash: String(cashBox.openingCash),
    }))
    setShowCutModal(true)
  }

  const addToCart = (product) => {
    if (!currentUser) return

    setCart((current) => {
      const found = current.find((item) => item.id === product.id)

      if (found) {
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        )
      }
      return [...current, { ...product, quantity: 1 }]
    })

    setSearchTerm('')
  }

  const processScannedCode = (rawCode) => {
    const code = rawCode.trim().toUpperCase()
    if (!code) return
    if (!cashBox.isOpen || activeTab !== 'sales' || !currentUser) return

    const product = products.find((item) => item.code.toUpperCase() === code)
    if (!product) {
      setScannerNotice(`Codigo no encontrado: ${code}`)
      return
    }

    addToCart(product)
    setScannerNotice(`Escaneado: ${product.code} ${product.name}`)
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!currentUser || !cashBox.isOpen || activeTab !== 'sales') return
      if (event.ctrlKey || event.altKey || event.metaKey) return

      const target = event.target
      const tagName = target?.tagName?.toLowerCase?.() ?? ''
      const isEditable =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target?.isContentEditable

      if (isEditable) return

      if (event.key === 'Enter') {
        if (scanBufferRef.current) {
          processScannedCode(scanBufferRef.current)
          scanBufferRef.current = ''
          if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
        }
        return
      }

      if (event.key.length !== 1) return

      scanBufferRef.current += event.key
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)

      // Los escaneres envian la cadena muy rapido; al detectar pausa corta se procesa automaticamente.
      scanTimerRef.current = setTimeout(() => {
        processScannedCode(scanBufferRef.current)
        scanBufferRef.current = ''
      }, 80)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      if (scanNoticeTimerRef.current) clearTimeout(scanNoticeTimerRef.current)
    }
  }, [activeTab, cashBox.isOpen, currentUser, products])

  const updateCartQty = (productId, qty) => {
    // Permite editar el campo sin borrar el articulo al limpiar temporalmente el input.
    if (qty === '') {
      return
    }

    const parsedQty = Number(qty)
    if (Number.isNaN(parsedQty)) return

    const nextQty = Math.max(1, Math.floor(parsedQty))
    setCart((current) =>
      current.map((item) => (item.id === productId ? { ...item, quantity: nextQty } : item)),
    )
  }

  const removeFromCart = (productId) => {
    setCart((current) => current.filter((item) => item.id !== productId))
  }

  const checkout = () => {
    if (cart.length === 0 || !cashBox.isOpen || !currentUser) return

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const totalCost = cart.reduce((sum, item) => sum + item.cost * item.quantity, 0)

    const pendingItems = cart
      .map((item) => {
        const product = products.find((productItem) => productItem.id === item.id)
        const available = Math.max(Number(product?.stock ?? 0), 0)
        const pendingQty = Math.max(item.quantity - available, 0)
        if (pendingQty <= 0) return null

        return {
          code: item.code,
          name: item.name,
          quantity: pendingQty,
        }
      })
      .filter(Boolean)

    const pendingDeliveryCode = pendingItems.length > 0 ? `PD-${crypto.randomUUID().slice(0, 8).toUpperCase()}` : ''

    const sale = {
      id: crypto.randomUUID(),
      dateTime: new Date().toISOString(),
      date: todayISO(),
      paymentMethod,
      cashierId: currentUser.id,
      cashierName: currentUser.fullName,
      items: cart.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        cost: item.cost,
      })),
      total,
      totalCost,
      profit: total - totalCost,
      deliveryStatus: pendingItems.length > 0 ? 'pending' : 'completed',
      pendingDeliveryCode,
      pendingItems,
      deliveredAt: null,
    }

    setSales((current) => [normalizeSale(sale), ...current])
    setProducts((current) =>
      current.map((product) => {
        const inCart = cart.find((item) => item.id === product.id)
        if (!inCart) return product
        return { ...product, stock: product.stock - inCart.quantity }
      }),
    )
    setLastSaleForTicket(sale)
    setCart([])

    const normalizedSale = normalizeSale(sale)
    if (ticketSettings.digitalTicketEnabled) {
      setTicketDeliveryRequest({ sale: normalizedSale, hidePendingNotice: false })
      setShowTicketDeliveryModal(true)
    } else {
      printTicket(normalizedSale, { hidePendingNotice: false })
    }
  }

  const closeTicketDeliveryModal = () => {
    setShowTicketDeliveryModal(false)
    setTicketDeliveryRequest(null)
  }

  const handleTicketDeliveryChoice = (mode) => {
    const request = ticketDeliveryRequest
    const sale = request?.sale
    setShowTicketDeliveryModal(false)
    setTicketDeliveryRequest(null)
    if (!sale) return

    if (mode === 'digital') {
      if (!ticketSettings.digitalTicketEnabled) {
        printTicket(sale, { hidePendingNotice: Boolean(request?.hidePendingNotice) })
        return
      }
      openDigitalTicket(sale, { hidePendingNotice: Boolean(request?.hidePendingNotice) })
      return
    }

    if (mode === 'print') {
      printTicket(sale, { hidePendingNotice: Boolean(request?.hidePendingNotice) })
    }
  }

  const openPendingTicketModal = () => {
    setPendingTicketSearchCode('')
    setPendingTicketMatchId('')
    setShowPendingTicketModal(true)
  }

  const closePendingTicketModal = () => {
    setShowPendingTicketModal(false)
    setPendingTicketSearchCode('')
    setPendingTicketMatchId('')
  }

  const applyPendingTicketFromCode = () => {
    const code = pendingTicketSearchCode.trim().toUpperCase()
    if (!code) return

    const found = sales.find(
      (sale) =>
        sale.deliveryStatus === 'pending' &&
        String(sale.pendingDeliveryCode || '').trim().toUpperCase() === code,
    )

    setPendingTicketMatchId(found?.id || '')
  }

  const fulfillPendingTicket = () => {
    const matchId = pendingTicketMatchId || pendingTicketMatch?.id || ''
    const sale = sales.find((item) => item.id === matchId)
    if (!sale || sale.deliveryStatus !== 'pending') return

    const updatedSale = {
      ...sale,
      deliveryStatus: 'completed',
      deliveredAt: new Date().toISOString(),
    }

    setSales((current) =>
      current.map((item) => (item.id === sale.id ? normalizeSale(updatedSale) : item)),
    )

    const normalizedSale = normalizeSale(updatedSale)
    if (ticketSettings.digitalTicketEnabled) {
      setTicketDeliveryRequest({ sale: normalizedSale, hidePendingNotice: true })
      setShowTicketDeliveryModal(true)
    } else {
      printTicket(normalizedSale, { hidePendingNotice: true })
    }
    closePendingTicketModal()
  }

  const saveDailyCut = (event) => {
    event.preventDefault()
    if (!cashBox.isOpen || !currentUser) return

    const openingCash = Number(cashBox.openingCash)
    const expenses = Number(cutForm.expenses)
    const countedCash = Number(cutForm.countedCash)
    const salesOfDay = sales.filter((sale) => sale.date === cashBox.date)
    const cashSales = salesOfDay
      .filter((sale) => sale.paymentMethod === 'efectivo')
      .reduce((sum, sale) => sum + sale.total, 0)
    const totalSales = salesOfDay.reduce((sum, sale) => sum + sale.total, 0)
    const totalCost = salesOfDay.reduce((sum, sale) => sum + sale.totalCost, 0)
    const expectedCash = openingCash + cashSales - expenses
    const difference = countedCash - expectedCash
    const shortageAmount = Math.max(0, -difference)
    const shortagePaid = shortageAmount > 0 ? Math.min(shortageAmount, Math.max(0, Number(cutForm.shortagePaid) || 0)) : 0
    const shortagePaidLabel =
      shortageAmount > 0
        ? String(cutForm.shortagePaidLabel || '').trim() || 'Pagado'
        : ''

    const cut = {
      id: crypto.randomUUID(),
      date: cashBox.date,
      createdAt: new Date().toISOString(),
      openingCash,
      openedById: cashBox.openedById,
      openedByName: cashBox.openedByName,
      closedById: currentUser.id,
      closedByName: currentUser.fullName,
      expenses,
      countedCash,
      expectedCash,
      difference,
      shortagePaid,
      shortagePaidLabel,
      totalSales,
      totalCost,
      profit: totalSales - totalCost,
      salesCount: salesOfDay.length,
      notes: cutForm.notes.trim(),
    }

    setCuts((current) => [cut, ...current])
    setCashBox({
      isOpen: false,
      date: todayISO(),
      openingCash: 0,
      openedById: '',
      openedByName: '',
      openedAt: null,
      closedAt: new Date().toISOString(),
    })
    setCutForm({
      date: todayISO(),
      openingCash: '0',
      expenses: '0',
      countedCash: '0',
      shortagePaid: '0',
      shortagePaidLabel: 'Pagado',
      notes: '',
    })
    setCart([])
    setShowCutModal(false)
  }

  const tabs = [
    { id: 'sales', label: 'Punto de Venta' },
    ...(isAdmin ? [{ id: 'admin', label: 'Administrador' }] : []),
  ]

  const isEditingSupplier = Boolean(editingSupplierId)
  const supplierModalForm = isEditingSupplier ? supplierEditForm : newSupplierForm

  if (!currentUser) {
    return (
      <main className="app-shell auth-shell" style={appThemeStyle}>
        <section className="panel auth-panel">
          <p className="auth-badge">Sistema Punto de Venta</p>
          <h1>Bienvenido</h1>
          <p className="auth-subtitle">Ingresa tus credenciales para continuar.</p>

          {usersWithCredentials.length === 0 && authStep === 'master' && (
            <form className="auth-form auth-form-pro" onSubmit={handleMasterLogin}>
              <p>Primer inicio: usa el usuario maestro para configurar al dueño/administrador.</p>
              <p className="meta-small">
                Usuario maestro: <strong>{MASTER_USERNAME}</strong>
              </p>
              <label>
                Usuario maestro
                <input
                  value={masterLogin.username}
                  onChange={(event) =>
                    setMasterLogin((current) => ({ ...current, username: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Contraseña maestra
                <div className="password-field">
                  <input
                    type={showPassword.master ? 'text' : 'password'}
                    value={masterLogin.password}
                    onChange={(event) =>
                      setMasterLogin((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((current) => ({ ...current, master: !current.master }))}
                    aria-label={showPassword.master ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    <EyeToggleIcon visible={showPassword.master} />
                  </button>
                </div>
              </label>
              <button type="submit">Validar usuario maestro</button>
            </form>
          )}

          {usersWithCredentials.length === 0 && authStep === 'owner-setup' && (
            <form className="auth-form auth-form-pro" onSubmit={handleOwnerSetup}>
              <p>Configura al dueño/administrador. Este será el acceso principal del sistema.</p>
              <label>
                Nombre completo
                <input
                  value={ownerSetup.fullName}
                  onChange={(event) =>
                    setOwnerSetup((current) => ({ ...current, fullName: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Usuario
                <input
                  value={ownerSetup.username}
                  onChange={(event) =>
                    setOwnerSetup((current) => ({ ...current, username: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Contraseña
                <div className="password-field">
                  <input
                    type={showPassword.owner ? 'text' : 'password'}
                    value={ownerSetup.password}
                    onChange={(event) =>
                      setOwnerSetup((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((current) => ({ ...current, owner: !current.owner }))}
                    aria-label={showPassword.owner ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    <EyeToggleIcon visible={showPassword.owner} />
                  </button>
                </div>
              </label>
              <button type="submit">Guardar administrador</button>
            </form>
          )}

          {usersWithCredentials.length > 0 && (
            <form className="auth-form auth-form-pro" onSubmit={handleLogin}>
              <p>Inicia sesión para poder abrir caja y cobrar.</p>
              <label>
                Usuario
                <input
                  value={loginForm.username}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, username: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Contraseña
                <div className="password-field">
                  <input
                    type={showPassword.login ? 'text' : 'password'}
                    value={loginForm.password}
                    onChange={(event) =>
                      setLoginForm((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((current) => ({ ...current, login: !current.login }))}
                    aria-label={showPassword.login ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    <EyeToggleIcon visible={showPassword.login} />
                  </button>
                </div>
              </label>
              <button type="submit">Entrar</button>
            </form>
          )}

          {authError && <p className="empty">{authError}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell" style={appThemeStyle}>
      <header className="hero">
        <div className="hero-head-row">
          <p className="hero-datetime">
            {fullDateLabel} | {liveTimeLabel}
          </p>
          <div className="alert-box">
            <div className="header-actions">
              {switchTargetPosId && (
                <button
                  type="button"
                  className="pos-switch-btn"
                  onClick={switchPos}
                  title={`Cambiar a ${switchTargetName}`}
                >
                  {switchTargetLogo ? (
                    <img src={switchTargetLogo} alt={switchTargetName} className="pos-switch-logo" />
                  ) : (
                    <span className="pos-switch-fallback">POS</span>
                  )}
                  <span className="pos-switch-name">{switchTargetName}</span>
                </button>
              )}
              <div className="session-actions">
                <button type="button" className="ghost-btn ghost-btn-small" onClick={logout}>
                  Cerrar sesión
                </button>
              </div>
              <button
                type="button"
                className="bell-button bell-button-small"
                onClick={() => {
                  if (alertBadgeCount === 0) {
                    setShowAlerts(false)
                    return
                  }
                  setShowAlerts((v) => !v)
                }}
              >
                <span className="bell-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="img">
                    <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-4h-1V11a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v7H5a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2Z" />
                  </svg>
                </span>
                <span className="sr-only">Alertas de inventario y pagos de crédito</span>
                {alertBadgeCount > 0 && <span className="alert-badge">{alertBadgeCount}</span>}
              </button>
            </div>
            {showAlerts && (
              <div className="alert-panel">
                {lowStockProducts.length > 0 && (
                  <section>
                    <h3>Stock bajo</h3>
                    <div className="stack">
                      {lowStockProducts.map((product) => (
                        <article key={product.id} className="alert-payment-item">
                          <p>
                            <strong>{product.code}</strong> {product.name}
                          </p>
                          <p>
                            {product.stock} pzas | Minimo {product.minStock}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                {purchaseCreditNotifications.length > 0 && (
                  <section>
                    <h3>Pagos a crédito</h3>
                    <div className="stack">
                      {purchaseCreditNotifications.map((notice) => (
                        <article key={`${notice.orderId}-${notice.paymentId}`} className="alert-payment-item">
                          <p>
                            OC {notice.orderId.slice(0, 8).toUpperCase()} | {notice.supplierName}
                          </p>
                          <p>
                            Pago {notice.number}/{notice.total}: {currency.format(notice.amount)}
                          </p>
                          <p>Vence: {new Date(notice.dueDate).toLocaleDateString('es-MX')}</p>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => confirmCreditPayment(notice.orderId, notice.paymentId)}
                          >
                            Confirmar pago
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={ticketSettings.logoUrl ? 'hero-main' : 'hero-main hero-main-no-logo'}>
          {ticketSettings.logoUrl && (
            <div className="hero-logo-center-wrap">
              <img src={ticketSettings.logoUrl} alt="Logo tienda" className="hero-logo" />
            </div>
          )}

          <div className="hero-brand centered-brand">
          <p className="eyebrow">Sistema POS</p>
          <h1>{ticketSettings.storeName || 'Sistema Punto de Venta'}</h1>
          <p className="datetime-line">Sesión: {currentUser.fullName} (@{currentUser.username})</p>
          </div>
        </div>
      </header>

      <nav className="tab-row" aria-label="Secciones">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'tab tab-active' : 'tab'}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'admin' && isAdmin && (
        <nav className="tab-row admin-row" aria-label="Subsecciones de administrador">
          {adminSections.map((section) => (
            <button
              key={section.id}
              className={adminSection === section.id ? 'tab tab-active' : 'tab'}
              onClick={() => setAdminSection(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>
      )}

      {activeTab === 'sales' && (
        <section className="panel">
          {!cashBox.isOpen ? (
            <div className="cash-closed">
              <h2>Caja cerrada</h2>
              <p>Para iniciar el dia, abre la caja y registra el fondo inicial.</p>
              <button type="button" onClick={() => setShowOpenCashModal(true)}>
                Abrir caja
              </button>
            </div>
          ) : (
            <div className="pos-layout">
              <div>
                <div className="section-head">
                  <div>
                    <h2>Productos Disponibles</h2>
                    <p className="meta-small">Caja abierta con fondo {currency.format(cashBox.openingCash)}</p>
                    <p className="meta-small">Abierta por: {cashBox.openedByName || 'No definido'}</p>
                    <p className="meta-small">Escanea el codigo de barras para agregar automatico.</p>
                    {scanNotice && <p className="meta-small">{scanNotice}</p>}
                  </div>
                  <button type="button" className="ghost-btn" onClick={openCutModal}>
                    Hacer corte y cerrar dia
                  </button>
                </div>

                <label>
                  Buscar por codigo o palabra
                  <input
                    placeholder="Ejemplo: P001 o cuaderno"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    onPaste={(event) => {
                      const pasted = event.clipboardData.getData('text').trim()
                      if (!pasted) return

                      const codes = pasted
                        .split(/[\s,;]+/)
                        .map((code) => code.trim())
                        .filter(Boolean)

                      if (codes.length === 0) return

                      event.preventDefault()
                      codes.forEach((code) => processScannedCode(code))
                      setSearchTerm('')
                    }}
                  />
                </label>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Codigo</th>
                        <th>Producto</th>
                        <th>Marca</th>
                        <th>Stock</th>
                        <th>Precio Venta</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {!hasSearchQuery && (
                        <tr>
                          <td colSpan="6" className="empty">Escribe en el buscador para mostrar productos.</td>
                        </tr>
                      )}
                      {hasSearchQuery &&
                        filteredProducts.map((product) => (
                          <tr key={product.id}>
                            <td>{product.code}</td>
                            <td>{product.name}</td>
                            <td>{product.brand || '-'}</td>
                            <td>{product.stock}</td>
                            <td>{currency.format(product.price)}</td>
                            <td>
                              <button type="button" onClick={() => addToCart(product)}>
                                Agregar
                              </button>
                            </td>
                          </tr>
                        ))}
                      {hasSearchQuery && filteredProducts.length === 0 && (
                        <tr>
                          <td colSpan="6" className="empty">No hay coincidencias en inventario.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="cart-panel pos-side-panel">
                <h2>Carrito y Cobro</h2>
                <p className="meta-small">Cobrando como: {currentUser.fullName}</p>
                <label>
                  Metodo de pago
                  <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </label>

                {cart.length === 0 && <p className="empty">Sin productos en carrito.</p>}

                {cart.map((item) => (
                  <div key={item.id} className="cart-item">
                    <div>
                      <strong>{item.code} - {item.name}</strong>
                      <p>{currency.format(item.price)} c/u</p>
                      <p className="meta-small">{item.brand || 'Sin marca'}</p>
                      <p className="meta-small">
                        Ubicacion: {item.locationArea || 'Sin area'} / {item.locationBin || 'Sin ubicacion'}
                      </p>
                    </div>
                    <div className="cart-actions">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(event) => updateCartQty(item.id, event.target.value)}
                      />
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={() => removeFromCart(item.id)}
                        aria-label={`Eliminar ${item.name} del carrito`}
                      >
                        X
                      </button>
                    </div>
                  </div>
                ))}

                <p className="total">Total a cobrar: {currency.format(cartTotal)}</p>
                <div className="pos-ticket-actions">
                  <button type="button" className="pos-action-btn" onClick={checkout} disabled={cart.length === 0}>
                    Confirmar cobro
                  </button>
                  <button type="button" className="ghost-btn pos-action-btn" onClick={openPendingTicketModal}>
                    Surtir ticket pendiente
                  </button>
                  <button
                    type="button"
                    className="ghost-btn pos-action-btn"
                    onClick={() => printTicket(lastSaleForTicket || sales[0])}
                    disabled={!lastSaleForTicket && !sales[0]}
                  >
                    Reimprimir ultimo ticket
                  </button>
                </div>
              </aside>
            </div>
          )}
        </section>
      )}

      {activeTab === 'admin' && isAdmin && adminSection === 'inventory' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Inventario General</h2>
            <button type="button" onClick={openCreateProductModal}>
              Agregar producto
            </button>
          </div>

          <label>
            Buscar en inventario por codigo, nombre o proveedor
            <input
              placeholder="Ejemplo: P001, cuaderno o proveedor"
              value={inventorySearchTerm}
              onChange={(event) => setInventorySearchTerm(event.target.value)}
            />
          </label>

          <div className="stack">
            {Object.entries(groupedInventory).map(([supplierName, items]) => (
              <article key={supplierName} className="card">
                <h3>{supplierName}</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Foto</th>
                        <th>Codigo</th>
                        <th>Producto</th>
                        <th>Marca</th>
                        <th>Categoria</th>
                        <th>Costo</th>
                        <th>Venta</th>
                        <th>Stock</th>
                        <th>Minimo</th>
                        <th>Ubicacion</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((product) => (
                        <tr key={product.id}>
                          <td>
                            {product.imageUrl ? (
                              <img src={product.imageUrl} alt={product.name} className="thumb" />
                            ) : (
                              <span className="meta-small">Sin foto</span>
                            )}
                          </td>
                          <td>{product.code}</td>
                          <td>{product.name}</td>
                          <td>{product.brand || '-'}</td>
                          <td>{product.category}</td>
                          <td>{currency.format(product.cost)}</td>
                          <td>{currency.format(product.price)}</td>
                          <td>{product.stock}</td>
                          <td>{product.minStock}</td>
                          <td>{(product.locationArea || 'Sin area') + ' / ' + (product.locationBin || 'Sin ubicacion')}</td>
                          <td>
                            <button
                              type="button"
                              className="ghost-btn"
                              onClick={() => openEditProductModal(product)}
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
            {Object.keys(groupedInventory).length === 0 && (
              <p className="empty">No hay productos que coincidan con la busqueda.</p>
            )}
          </div>
        </section>
      )}

      {activeTab === 'admin' && isAdmin && adminSection === 'dashboard' && (
        <section className="panel">
          <div className="grid-metrics">
            <article className="metric-card">
              <h2>Inversion Total</h2>
              <p>{currency.format(metrics.totalInvestment)}</p>
            </article>
            <article className="metric-card">
              <h2>Ventas Acumuladas</h2>
              <p>{currency.format(metrics.grossSales)}</p>
            </article>
            <article className="metric-card">
              <h2>Ganancia Neta</h2>
              <p>{currency.format(metrics.netProfit)}</p>
            </article>
            <article className="metric-card">
              <h2>Inventario a Costo</h2>
              <p>{currency.format(metrics.stockValueCost)}</p>
            </article>
            <article className="metric-card">
              <h2>Inventario a Precio Venta</h2>
              <p>{currency.format(metrics.stockValueSale)}</p>
            </article>
          </div>

          <div className="history-layout in-summary">
            <div className="card">
              <h2>Historial de Ventas</h2>
              <div className="stack">
                {sales.slice(0, 10).map((sale) => (
                  <article key={sale.id} className="history-item">
                    <p>
                      <strong>{new Date(sale.dateTime).toLocaleString('es-MX')}</strong>
                    </p>
                    <p>
                      Cajero: <strong>{sale.cashierName || 'No registrado'}</strong> | Pago: {sale.paymentMethod}
                    </p>
                    <p>
                      {sale.items.length} productos - Total {currency.format(sale.total)} - Ganancia {currency.format(sale.profit)}
                    </p>
                    <div className="sale-items">
                      {sale.items.map((item) => (
                        <span key={`${sale.id}-${item.id}`}>
                          {item.code} {item.name} x{item.quantity} ({currency.format(item.price)})
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
                {sales.length === 0 && <p className="empty">Todavia no hay ventas registradas.</p>}
              </div>
            </div>

            <div className="card">
              <h2>Historial de Cortes</h2>
              <div className="stack">
                {cuts.map((cut) => (
                  <article key={cut.id} className="history-item">
                    <p>
                      <strong>{cut.date}</strong> - Ventas {cut.salesCount}
                    </p>
                    <p>
                      Apertura: {cut.openedByName || 'No registrado'} | Cierre: {cut.closedByName || 'No registrado'}
                    </p>
                    <p>
                      Total vendido {currency.format(cut.totalSales)} | Ganancia {currency.format(cut.profit)}
                    </p>
                    <p>
                      Gastos {currency.format(cut.expenses || 0)} |{' '}
                      {Number(cut.shortagePaid || 0) > 0
                        ? `${cut.shortagePaidLabel || 'Pagado'} ${currency.format(cut.shortagePaid || 0)}`
                        : 'Sin faltante'}
                    </p>
                    <p>
                      Esperado {currency.format(cut.expectedCash)} | Diferencia {currency.format(cut.difference)}
                    </p>
                  </article>
                ))}
                {cuts.length === 0 && <p className="empty">No hay cortes guardados.</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'admin' && isAdmin && adminSection === 'analytics' && (
        <section className="panel inventory-full">
          <div className="grid-metrics">
            <article className="metric-card">
              <h2>Ticket Promedio</h2>
              <p>{currency.format(salesAnalytics.averageTicket)}</p>
            </article>
            <article className="metric-card">
              <h2>Articulos por Ticket</h2>
              <p>{salesAnalytics.averageItemsPerTicket.toFixed(2)}</p>
            </article>
            <article className="metric-card">
              <h2>Tickets Totales</h2>
              <p>{salesAnalytics.totalTickets}</p>
            </article>
            <article className="metric-card">
              <h2>Articulos Vendidos</h2>
              <p>{salesAnalytics.totalItems}</p>
            </article>
          </div>

          <div className="card">
            <h2>Productos mas vendidos</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Producto</th>
                    <th>Cantidad vendida</th>
                    <th>Ingresos</th>
                  </tr>
                </thead>
                <tbody>
                  {salesAnalytics.bestSellers.map((item) => (
                    <tr key={item.key}>
                      <td>{item.code || '-'}</td>
                      <td>{item.name}</td>
                      <td>{item.quantity}</td>
                      <td>{currency.format(item.revenue)}</td>
                    </tr>
                  ))}
                  {salesAnalytics.bestSellers.length === 0 && (
                    <tr>
                      <td colSpan="4" className="empty">Aún no hay ventas para calcular analítica.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'admin' && isAdmin && adminSection === 'purchase-orders' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Órdenes de compra</h2>
            <button type="button" onClick={openManualOrderModal}>
              Agregar orden manual
            </button>
          </div>

          <div className="stack">
            {purchaseOrders.map((order) => {
              const supplierInfo = supplierMap[order.supplierName.toLowerCase()]
              return (
                <article key={order.id} className="card history-item">
                  <p>
                    <strong>OC:</strong> {order.id.slice(0, 8).toUpperCase()} | <strong>Proveedor:</strong>{' '}
                    {order.supplierName}
                  </p>
                  <p className="meta-small">Tipo: {order.autoGenerated ? 'Automatica' : 'Manual'}</p>
                  <p>
                    Estado:{' '}
                    <strong>
                      {order.status === 'open'
                        ? 'Abierta'
                        : order.status === 'supplied'
                          ? 'Surtida'
                          : order.status === 'closed'
                            ? 'Cerrada'
                            : 'Cancelada'}
                    </strong>{' '}
                    | Fecha: {new Date(order.createdAt).toLocaleString('es-MX')}
                  </p>
                  {order.suppliedAt && (
                    <p className="meta-small">
                      Surtida: {new Date(order.suppliedAt).toLocaleString('es-MX')} | Metodo de pago:{' '}
                      {paymentLabelMap[order.supplyPayment?.paymentMethod] || order.supplyPayment?.paymentMethod}
                      {order.supplyPayment?.totalAmount
                        ? ` | Total: ${currency.format(order.supplyPayment.totalAmount)}`
                        : ''}
                    </p>
                  )}
                  {supplierInfo && (
                    <p className="meta-small">
                      Contacto: {supplierInfo.contactName || 'N/D'} | Tel: {supplierInfo.phone || 'N/D'} | Correo:{' '}
                      {supplierInfo.email || 'N/D'}
                    </p>
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Codigo</th>
                          <th>Producto</th>
                          <th>Stock actual</th>
                          <th>Minimo</th>
                          <th>Piezas solicitadas</th>
                          <th>Piezas surtidas</th>
                          <th>Costo por pieza</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map((item) => (
                          <tr key={`${order.id}-${item.productId}`}>
                            <td>{item.code}</td>
                            <td>{item.name}</td>
                            <td>{item.currentStock}</td>
                            <td>{item.minStock}</td>
                            <td>{item.orderedQty || item.recommendedQty}</td>
                            <td>{item.suppliedQty > 0 ? item.suppliedQty : '-'}</td>
                            <td>{item.suppliedUnitCost > 0 ? currency.format(item.suppliedUnitCost) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {order.status === 'open' && (
                    <div className="row-actions">
                      <button type="button" onClick={() => startSupplyOrder(order)}>
                        Surtir orden
                      </button>
                      <button type="button" onClick={() => updatePurchaseOrderStatus(order.id, 'closed')}>
                        Marcar cerrada
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => updatePurchaseOrderStatus(order.id, 'cancelled')}
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                  {order.status === 'supplied' && order.supplyPayment?.paymentMethod === 'credito' && (
                    <div className="card">
                      <h3>Pagos de crédito</h3>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Pago</th>
                              <th>Monto</th>
                              <th>Vence</th>
                              <th>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.creditPayments.map((payment) => (
                              <tr key={payment.id}>
                                <td>
                                  {payment.number}/{payment.total}
                                </td>
                                <td>{currency.format(payment.amount)}</td>
                                <td>{new Date(payment.dueDate).toLocaleDateString('es-MX')}</td>
                                <td>{payment.status === 'paid' ? 'Pagado' : 'Pendiente'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
            {purchaseOrders.length === 0 && (
              <p className="empty">Sin órdenes por ahora. Puedes crear manuales o se generan automáticas con stock bajo.</p>
            )}
          </div>
        </section>
      )}

      {activeTab === 'admin' && isAdmin && adminSection === 'suppliers' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Proveedores</h2>
            <button
              type="button"
              onClick={() => {
                setEditingSupplierId('')
                setNewSupplierForm(emptySupplierForm)
                setSupplierEditForm(emptySupplierForm)
                setSupplierAddressSuggestions([])
                setShowSupplierModal(true)
              }}
            >
              Agregar nuevo proveedor
            </button>
          </div>

          <div className="card">
            <h2>Lista de proveedores</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Contacto</th>
                    <th>Pago</th>
                    <th>Cuenta transferencia</th>
                    <th>Teléfono</th>
                    <th>Correo</th>
                    <th>Dirección</th>
                    <th>Notas</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {[...suppliers]
                    .sort((a, b) => a.name.localeCompare(b.name, 'es-MX'))
                    .map((supplier) => (
                    <tr key={supplier.id}>
                      <td>{supplier.name}</td>
                      <td>{supplier.contactName || '-'}</td>
                      <td>{paymentLabelMap[supplier.paymentType] || supplier.paymentType}</td>
                      <td>{supplier.transferAccount || '-'}</td>
                      <td>{supplier.phone || '-'}</td>
                      <td>{supplier.email || '-'}</td>
                      <td>
                        {supplier.address ? (
                          <div className="address-links">
                            <span>{supplier.address}</span>
                            <div className="row-actions">
                              <a
                                className="ghost-btn link-btn"
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(supplier.address)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Google Maps
                              </a>
                              <a
                                className="ghost-btn link-btn"
                                href={`https://waze.com/ul?q=${encodeURIComponent(supplier.address)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Waze
                              </a>
                              <a
                                className="ghost-btn link-btn"
                                href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(supplier.address)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                OpenStreetMap
                              </a>
                            </div>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>{supplier.notes || '-'}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="ghost-btn" onClick={() => startEditSupplier(supplier)}>
                            Editar
                          </button>
                          <button type="button" onClick={() => deleteSupplier(supplier.id)}>
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {suppliers.length === 0 && (
                    <tr>
                      <td colSpan="9" className="empty">Aún no hay proveedores registrados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'admin' && isAdmin && canManagePosControl && adminSection === 'pos-control' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Control POS</h2>
            <button type="button" onClick={createPos}>
              Crear nuevo POS
            </button>
          </div>

          <div className="pos-control-grid">
            {orderedPosIds.map((posId, index) => {
              const isPrimary = posId === 'primary'
              const isHidden = (posVisibility.hiddenIds || []).includes(posId)
              const isCurrentPrimary = primaryPosId === posId

              return (
                <article key={posId} className="card history-item pos-card">
                  <p>
                    <strong>{getPosDisplayName(posId)}</strong>
                  </p>
                  <p className="meta-small">
                    {isPrimary ? 'Principal' : 'Secundario'} | {isHidden ? 'Oculto' : 'Visible'} | Orden #{index + 1}
                  </p>
                  <div className="row-actions">
                    <button type="button" className="ghost-btn" onClick={() => requestOpenPos(posId)}>
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => openPosSecurityEditor(posId)}
                    >
                      {getPosLockHash(posId) ? 'Seguridad: Activa' : 'Seguridad'}
                    </button>
                    {!isPrimary && (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => togglePosVisibility(posId)}
                      >
                        {isHidden ? 'Mostrar' : 'Ocultar'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => movePos(posId, 'up')}
                    >
                      Subir
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => movePos(posId, 'down')}
                    >
                      Bajar
                    </button>
                    {isCurrentPrimary ? (
                      <span className="meta-small pos-chip">Principal actual</span>
                    ) : (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => transferPrimaryPos(posId)}
                      >
                        Hacer principal
                      </button>
                    )}
                    {!isPrimary && (
                      <button type="button" onClick={() => removePos(posId)}>
                        Eliminar
                      </button>
                    )}
                  </div>
                </article>
              )
            })}

          </div>

          <div className="card history-item" style={{ marginTop: '0.65rem' }}>
            <p>
              <strong>Papelera de POS</strong>
            </p>
            {recycleBinItems.length === 0 ? (
              <p className="meta-small">Sin POS eliminados. Los eliminados se pueden recuperar durante 15 días.</p>
            ) : (
              <div className="stack">
                {recycleBinItems.map((item) => (
                  <article key={item.id} className="alert-payment-item">
                    <p>
                      <strong>{item.defaultName || item.id}</strong>
                    </p>
                    <p className="meta-small">Recuperable por {item.daysLeft} día(s) más.</p>
                    <div className="row-actions">
                      <button type="button" className="ghost-btn" onClick={() => restoreDeletedPos(item.id)}>
                        Recuperar POS
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'admin' && isAdmin && adminSection === 'ticket' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Administrador de Ticket</h2>
          </div>

          <form className="card modal-form" onSubmit={(event) => event.preventDefault()}>
            <label>
              Nombre principal del ticket
              <input
                value={ticketSettings.storeName}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, storeName: event.target.value }))
                }
                placeholder="Sistema Punto de Venta"
              />
            </label>
            <label>
              Subir logo
              <input type="file" accept="image/*" onChange={handleTicketLogoUpload} />
            </label>
            {ticketSettings.logoUrl && (
              <div className="ticket-logo-preview-wrap">
                <img src={ticketSettings.logoUrl} alt="Vista previa logo" className="ticket-logo-preview" />
                <div className="theme-actions-row">
                  <button type="button" className="ghost-btn" onClick={clearTicketLogo}>
                    Quitar logo
                  </button>
                  <button type="button" className="ghost-btn" onClick={restoreDefaultThemeColors}>
                    Restaurar colores por defecto
                  </button>
                  {!ticketSettings.useLogoTheme && (
                    <button type="button" onClick={applyLogoThemeColors}>
                      Volver a colores del logo
                    </button>
                  )}
                </div>
              </div>
            )}
            <label>
              Razón social o negocio
              <input
                value={ticketSettings.businessName}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, businessName: event.target.value }))
                }
              />
            </label>
            <label>
              Dirección
              <input
                value={ticketSettings.address}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, address: event.target.value }))
                }
              />
            </label>
            <label>
              Teléfono
              <input
                value={ticketSettings.phone}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </label>
            <label>
              RFC
              <input
                value={ticketSettings.rfc}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, rfc: event.target.value }))
                }
              />
            </label>
            <label>
              Mensaje final
              <input
                value={ticketSettings.footerMessage}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, footerMessage: event.target.value }))
                }
              />
            </label>
            <label>
              Ancho de papel (mm)
              <select
                value={ticketSettings.printerWidthMm}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, printerWidthMm: event.target.value }))
                }
              >
                {ticketWidthOptions.map((width) => (
                  <option key={width} value={width}>
                    {width} mm
                  </option>
                ))}
              </select>
            </label>
            <label>
              Escala de fuente
              <input
                type="number"
                min="0.85"
                max="1.2"
                step="0.05"
                value={ticketSettings.fontScale}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, fontScale: event.target.value }))
                }
              />
            </label>
            <label>
              Intensidad de color del logo ({Math.round((Number(ticketSettings.logoThemeIntensity) || 1) * 100)}%)
              <input
                type="range"
                min="0.7"
                max="1.8"
                step="0.05"
                value={ticketSettings.logoThemeIntensity}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, logoThemeIntensity: event.target.value }))
                }
              />
            </label>
            <div className="theme-intensity-row">
              <span className="meta-small">Presets:</span>
              <button
                type="button"
                className={Math.abs((Number(ticketSettings.logoThemeIntensity) || 1) - 0.85) < 0.01 ? 'tab tab-active' : 'tab'}
                onClick={() => setTicketSettings((current) => ({ ...current, logoThemeIntensity: '0.85' }))}
              >
                Suave
              </button>
              <button
                type="button"
                className={Math.abs((Number(ticketSettings.logoThemeIntensity) || 1) - 1) < 0.01 ? 'tab tab-active' : 'tab'}
                onClick={() => setTicketSettings((current) => ({ ...current, logoThemeIntensity: '1' }))}
              >
                Normal
              </button>
              <button
                type="button"
                className={Math.abs((Number(ticketSettings.logoThemeIntensity) || 1) - 1.4) < 0.01 ? 'tab tab-active' : 'tab'}
                onClick={() => setTicketSettings((current) => ({ ...current, logoThemeIntensity: '1.4' }))}
              >
                Vibrante
              </button>
            </div>

            <label className="switch-line">
              <span>Mostrar fecha y hora</span>
              <span className="switch-control">
                <input
                  type="checkbox"
                  checked={ticketSettings.showDate}
                  onChange={(event) =>
                    setTicketSettings((current) => ({ ...current, showDate: event.target.checked }))
                  }
                />
                <span className="switch-slider" />
              </span>
            </label>
            <label className="switch-line">
              <span>Mostrar cajero</span>
              <span className="switch-control">
                <input
                  type="checkbox"
                  checked={ticketSettings.showCashier}
                  onChange={(event) =>
                    setTicketSettings((current) => ({ ...current, showCashier: event.target.checked }))
                  }
                />
                <span className="switch-slider" />
              </span>
            </label>
            <label className="switch-line">
              <span>Mostrar codigo de producto</span>
              <span className="switch-control">
                <input
                  type="checkbox"
                  checked={ticketSettings.showProductCode}
                  onChange={(event) =>
                    setTicketSettings((current) => ({ ...current, showProductCode: event.target.checked }))
                  }
                />
                <span className="switch-slider" />
              </span>
            </label>
            <label className="switch-line">
              <span>Ticket digital</span>
              <span className="switch-control">
                <input
                  type="checkbox"
                  checked={ticketSettings.digitalTicketEnabled}
                  onChange={(event) =>
                    setTicketSettings((current) => ({ ...current, digitalTicketEnabled: event.target.checked }))
                  }
                />
                <span className="switch-slider" />
              </span>
            </label>
            <label className="switch-line">
              <span>Imprimir automaticamente al cobrar</span>
              <span className="switch-control">
                <input
                  type="checkbox"
                  checked={ticketSettings.autoPrint}
                  onChange={(event) =>
                    setTicketSettings((current) => ({ ...current, autoPrint: event.target.checked }))
                  }
                />
                <span className="switch-slider" />
              </span>
            </label>
          </form>

          <div className="card">
            <div className="section-head">
              <h2>Vista previa de ticket</h2>
              <button type="button" onClick={() => printTicket(previewSale)}>
                Imprimir ticket de prueba
              </button>
            </div>

            <p className="meta-small">
              Ajusta los mm segun tu impresora termica. La impresion usa el cuadro de impresion del
              navegador para ser compatible con la mayoria de impresoras instaladas.
            </p>

            <div className="ticket-preview-wrap" style={{ fontSize: `${Number(ticketSettings.fontScale) || 1}rem` }}>
              <TicketPreview sale={previewSale} settings={ticketSettings} isEmpty={false} />
            </div>
          </div>
        </section>
      )}

      {activeTab === 'admin' && isAdmin && canManageUsers && adminSection === 'users' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Administracion de Usuarios</h2>
          </div>

          <nav className="tab-row admin-row user-management-tabs" aria-label="Pestanas de administracion de usuarios">
            <button
              className={userAdminTab === 'users-list' ? 'tab tab-active' : 'tab'}
              onClick={() => setUserAdminTab('users-list')}
              type="button"
            >
              Usuarios
            </button>
            <button
              className={userAdminTab === 'user-movements' ? 'tab tab-active' : 'tab'}
              onClick={() => setUserAdminTab('user-movements')}
              type="button"
            >
              Movimientos
            </button>
          </nav>

          {userAdminTab === 'users-list' && (
            <>
              <form className="card modal-form user-create-form" onSubmit={addUser}>
                <label>
                  Nombre completo
                  <input
                    value={newUserForm.fullName}
                    onChange={(event) =>
                      setNewUserForm((current) => ({ ...current, fullName: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Usuario
                  <input
                    value={newUserForm.username}
                    onChange={(event) =>
                      setNewUserForm((current) => ({ ...current, username: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Contraseña
                  <div className="password-field">
                    <input
                      type={showPassword.userCreate ? 'text' : 'password'}
                      value={newUserForm.password}
                      onChange={(event) =>
                        setNewUserForm((current) => ({ ...current, password: event.target.value }))
                      }
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() =>
                        setShowPassword((current) => ({ ...current, userCreate: !current.userCreate }))
                      }
                      aria-label={showPassword.userCreate ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      <EyeToggleIcon visible={showPassword.userCreate} />
                    </button>
                  </div>
                </label>
                <label>
                  Rol
                  <select
                    value={newUserForm.role}
                    onChange={(event) =>
                      setNewUserForm((current) => ({ ...current, role: event.target.value }))
                    }
                  >
                    <option value="cashier">Cajero</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
                <button type="submit">Crear usuario</button>
              </form>

              <div className="card">
                <h2>Usuarios registrados</h2>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Usuario</th>
                        <th>Rol</th>
                        <th>Alta</th>
                        <th>Activo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>{user.fullName}</td>
                          <td>{user.username}</td>
                          <td>{user.role === 'admin' ? 'Administrador' : 'Cajero'}</td>
                          <td>{new Date(user.createdAt).toLocaleDateString('es-MX')}</td>
                          <td>
                            <label className="switch-line user-switch-line">
                              <span>{user.active !== false ? 'Activo' : 'Inactivo'}</span>
                              <span className="switch-control">
                                <input
                                  type="checkbox"
                                  checked={user.active !== false}
                                  onChange={() => toggleUserActive(user.id)}
                                />
                                <span className="switch-slider" />
                              </span>
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {userAdminTab === 'user-movements' && (
            <div className="card">
              <h2>Movimientos de usuarios</h2>
              <div className="filter-row">
                <label>
                  Filtrar por usuario
                  <select
                    value={userMovementsFilterUser}
                    onChange={(event) => setUserMovementsFilterUser(event.target.value)}
                  >
                    <option value="">Todos</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Filtrar por POS
                  <select
                    value={userMovementsFilterPos}
                    onChange={(event) => setUserMovementsFilterPos(event.target.value)}
                  >
                    <option value="">Todos los POS</option>
                    {orderedPosIds.map((posId) => (
                      <option key={posId} value={posId}>
                        {getPosDisplayName(posId)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Buscar por fecha
                  <input
                    type="date"
                    value={userMovementsFilterDate}
                    onChange={(event) => setUserMovementsFilterDate(event.target.value)}
                  />
                </label>

                <div className="filter-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      setUserMovementsFilterUser('')
                      setUserMovementsFilterPos('')
                      setUserMovementsFilterDate(todayISO())
                    }}
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      setUserMovementsFilterUser('')
                      setUserMovementsFilterPos('')
                      setUserMovementsFilterDate('')
                    }}
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              <div className="stack">
                {filteredUserMovements.map((movement) => (
                  <article key={movement.id} className="history-item">
                    <p>
                      <strong>{movement.type}</strong> - {new Date(movement.dateTime).toLocaleString('es-MX')}
                    </p>
                    <p>Usuario: {movement.userName}</p>
                    <p>POS: {movement.posName}</p>
                    <p>
                      Forma de pago: {movement.paymentMethod} | Monto: {currency.format(movement.total)}
                    </p>
                    <p>{movement.detail}</p>
                  </article>
                ))}
                {filteredUserMovements.length === 0 && (
                  <p className="empty">No hay movimientos para el filtro seleccionado.</p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {showManualOrderModal && (
        <Modal title="Agregar orden de compra manual" onClose={closeManualOrderModal}>
          <form className="modal-form manual-order-form" onSubmit={submitManualPurchaseOrder}>
            <label className="manual-order-supplier">
              Proveedor
              <select
                value={manualOrderForm.supplierName}
                onChange={(event) =>
                  setManualOrderForm((current) => ({ ...current, supplierName: event.target.value }))
                }
                required
              >
                <option value="Sin proveedor">Sin proveedor</option>
                {supplierNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <div className="table-wrap manual-order-table-wrap">
              <table className="manual-order-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Piezas</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {manualOrderForm.items.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <select
                          value={line.entryType === 'manual' ? '__manual__' : line.productId}
                          onChange={(event) => {
                            const value = event.target.value
                            if (value === '__manual__') {
                              setManualOrderForm((current) => ({
                                ...current,
                                items: current.items.map((currentLine) =>
                                  currentLine.id === line.id
                                    ? { ...currentLine, entryType: 'manual', productId: '' }
                                    : currentLine,
                                ),
                              }))
                              return
                            }

                            setManualOrderForm((current) => ({
                              ...current,
                              items: current.items.map((currentLine) =>
                                currentLine.id === line.id
                                  ? {
                                      ...currentLine,
                                      entryType: 'existing',
                                      productId: value,
                                      manualCode: '',
                                      manualName: '',
                                      manualCategory: 'General',
                                      manualSuggestedPrice: '',
                                    }
                                  : currentLine,
                              ),
                            }))
                          }}
                        >
                          <option value="">Selecciona producto</option>
                          <option value="__manual__">Producto nuevo (manual)</option>
                          {manualOrderProductOptions.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.code} - {product.name}
                            </option>
                          ))}
                        </select>

                        {line.entryType === 'manual' && (
                          <div className="manual-order-new-fields">
                            <input
                              placeholder="Codigo nuevo"
                              value={line.manualCode}
                              onChange={(event) =>
                                updateManualOrderLine(line.id, 'manualCode', event.target.value.toUpperCase())
                              }
                            />
                            <input
                              placeholder="Nombre del producto"
                              value={line.manualName}
                              onChange={(event) =>
                                updateManualOrderLine(line.id, 'manualName', event.target.value)
                              }
                              required
                            />
                            <select
                              value={line.manualCategory || 'General'}
                              onChange={(event) =>
                                updateManualOrderLine(line.id, 'manualCategory', event.target.value)
                              }
                            >
                              {categories.map((category) => (
                                <option key={category} value={category}>
                                  {category}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Precio sugerido"
                              value={line.manualSuggestedPrice}
                              onChange={(event) =>
                                updateManualOrderLine(line.id, 'manualSuggestedPrice', event.target.value)
                              }
                            />
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={line.quantity}
                          onChange={(event) =>
                            updateManualOrderLine(line.id, 'quantity', event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <button type="button" className="ghost-btn" onClick={() => removeManualOrderLine(line.id)}>
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row-actions manual-order-actions">
              <button type="button" className="ghost-btn" onClick={addManualOrderLine}>
                Agregar producto
              </button>
              <button type="submit">Guardar orden manual</button>
            </div>
          </form>
        </Modal>
      )}

      {supplyOrderId && (
        <Modal title="Surtir orden de compra" onClose={closeSupplyOrderModal}>
          <form className="modal-form supply-order-form" onSubmit={submitSupplyOrder}>
            <div className="table-wrap supply-order-table-wrap">
              <table className="supply-order-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Piezas a surtir *</th>
                    <th>Costo total *</th>
                    <th>Costo por pieza</th>
                  </tr>
                </thead>
                <tbody>
                  {supplyOrderItems.map((item) => {
                    const quantity = Number(item.quantity) || 0
                    const totalCost = Number(item.totalCost) || 0
                    const unitCost = quantity > 0 ? totalCost / quantity : 0

                    return (
                      <tr key={`${selectedSupplyOrder?.id || 'supply'}-${item.productId}`}>
                        <td>
                          {item.code} {item.name}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={item.quantity}
                            onChange={(event) =>
                              updateSupplyOrderItem(item.productId, 'quantity', event.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.totalCost}
                            onChange={(event) =>
                              updateSupplyOrderItem(item.productId, 'totalCost', event.target.value)
                            }
                          />
                        </td>
                        <td>{quantity > 0 ? currency.format(unitCost) : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="supply-order-meta">
              <p className="meta-small">
                Total calculado: <strong>{currency.format(Number(supplyOrderForm.totalAmount || 0))}</strong>
              </p>
            </div>

            <label className="supply-order-payment">
              Metodo de pago al proveedor *
              <select
                value={supplyOrderForm.paymentMethod}
                onChange={(event) =>
                  setSupplyOrderForm((current) => ({ ...current, paymentMethod: event.target.value }))
                }
              >
                {providerPaymentOptions.map((paymentType) => (
                  <option key={paymentType} value={paymentType}>
                    {paymentLabelMap[paymentType] || paymentType}
                  </option>
                ))}
              </select>
            </label>

            {supplyOrderForm.paymentMethod === 'credito' && (
              <>
                <label>
                  Tipo de crédito
                  <select
                    value={supplyOrderForm.creditMode}
                    onChange={(event) =>
                      setSupplyOrderForm((current) => ({ ...current, creditMode: event.target.value }))
                    }
                  >
                    <option value="single">Un solo pago</option>
                    <option value="installments">Varios pagos</option>
                  </select>
                </label>

                {supplyOrderForm.creditMode === 'single' && (
                  <label>
                    Dias para liquidar
                    <input
                      type="number"
                      min="0"
                      value={supplyOrderForm.singleDueDays}
                      onChange={(event) =>
                        setSupplyOrderForm((current) => ({ ...current, singleDueDays: event.target.value }))
                      }
                    />
                  </label>
                )}

                {supplyOrderForm.creditMode === 'installments' && (
                  <>
                    <label>
                      Dias para primer pago
                      <input
                        type="number"
                        min="0"
                        value={supplyOrderForm.firstPaymentDays}
                        onChange={(event) =>
                          setSupplyOrderForm((current) => ({ ...current, firstPaymentDays: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Cantidad de pagos
                      <input
                        type="number"
                        min="2"
                        value={supplyOrderForm.installmentCount}
                        onChange={(event) =>
                          setSupplyOrderForm((current) => ({ ...current, installmentCount: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Dias entre pagos
                      <input
                        type="number"
                        min="1"
                        value={supplyOrderForm.daysBetweenPayments}
                        onChange={(event) =>
                          setSupplyOrderForm((current) => ({ ...current, daysBetweenPayments: event.target.value }))
                        }
                      />
                    </label>
                  </>
                )}
              </>
            )}

            <button type="submit" disabled={invalidSupplyLineCount > 0 || supplyOrderItems.length === 0}>
              Confirmar surtido
            </button>
          </form>
        </Modal>
      )}

      {showSupplierModal && (
        <Modal
          title={isEditingSupplier ? 'Editar proveedor' : 'Agregar nuevo proveedor'}
          onClose={closeSupplierModal}
        >
          <form className="modal-form" onSubmit={isEditingSupplier ? saveSupplierEdit : addSupplier}>
            <label>
              Nombre del proveedor
              <input
                value={supplierModalForm.name}
                onChange={(event) => {
                  const value = event.target.value
                  if (isEditingSupplier) {
                    setSupplierEditForm((current) => ({ ...current, name: value }))
                  } else {
                    setNewSupplierForm((current) => ({ ...current, name: value }))
                  }
                }}
                required
              />
            </label>
            <label>
              Nombre de contacto
              <input
                value={supplierModalForm.contactName}
                onChange={(event) => {
                  const value = event.target.value
                  if (isEditingSupplier) {
                    setSupplierEditForm((current) => ({ ...current, contactName: value }))
                  } else {
                    setNewSupplierForm((current) => ({ ...current, contactName: value }))
                  }
                }}
              />
            </label>
            <label>
              Tipo de pago con proveedor
              <select
                value={supplierModalForm.paymentType}
                onChange={(event) => {
                  const value = event.target.value
                  if (isEditingSupplier) {
                    setSupplierEditForm((current) => ({ ...current, paymentType: value }))
                  } else {
                    setNewSupplierForm((current) => ({ ...current, paymentType: value }))
                  }
                }}
              >
                {providerPaymentOptions.map((paymentType) => (
                  <option key={paymentType} value={paymentType}>
                    {paymentLabelMap[paymentType] || paymentType}
                  </option>
                ))}
              </select>
            </label>
            {supplierModalForm.paymentType === 'transferencia' && (
              <label>
                Cuenta para transferencia
                <input
                  value={supplierModalForm.transferAccount}
                  onChange={(event) => {
                    const value = event.target.value
                    if (isEditingSupplier) {
                      setSupplierEditForm((current) => ({ ...current, transferAccount: value }))
                    } else {
                      setNewSupplierForm((current) => ({ ...current, transferAccount: value }))
                    }
                  }}
                  placeholder="CLABE o numero de cuenta"
                />
              </label>
            )}
            <label>
              Teléfono
              <input
                value={supplierModalForm.phone}
                onChange={(event) => {
                  const value = event.target.value
                  if (isEditingSupplier) {
                    setSupplierEditForm((current) => ({ ...current, phone: value }))
                  } else {
                    setNewSupplierForm((current) => ({ ...current, phone: value }))
                  }
                }}
              />
            </label>
            <label>
              Correo
              <input
                type="email"
                value={supplierModalForm.email}
                onChange={(event) => {
                  const value = event.target.value
                  if (isEditingSupplier) {
                    setSupplierEditForm((current) => ({ ...current, email: value }))
                  } else {
                    setNewSupplierForm((current) => ({ ...current, email: value }))
                  }
                }}
              />
            </label>
            <label>
              Dirección
              <input
                value={supplierModalForm.address}
                onChange={(event) => {
                  const value = event.target.value
                  if (isEditingSupplier) {
                    setSupplierEditForm((current) => ({ ...current, address: value }))
                  } else {
                    setNewSupplierForm((current) => ({ ...current, address: value }))
                  }
                }}
                placeholder="Escribe una dirección y luego pulsa Buscar"
              />
            </label>
            <div className="row-actions">
              <button type="button" className="ghost-btn" onClick={searchSupplierAddress}>
                {supplierAddressLoading ? 'Buscando...' : 'Buscar dirección exacta (OpenStreetMap)'}
              </button>
            </div>
            {supplierAddressSuggestions.length > 0 && (
              <div className="address-suggestions">
                {supplierAddressSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className="ghost-btn suggestion-btn"
                    onClick={() => applySupplierAddressSuggestion(suggestion.label)}
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            )}
            <label>
              Notas
              <textarea
                rows="2"
                value={supplierModalForm.notes}
                onChange={(event) => {
                  const value = event.target.value
                  if (isEditingSupplier) {
                    setSupplierEditForm((current) => ({ ...current, notes: value }))
                  } else {
                    setNewSupplierForm((current) => ({ ...current, notes: value }))
                  }
                }}
              />
            </label>
            <button type="submit">{isEditingSupplier ? 'Guardar cambios' : 'Guardar proveedor'}</button>
          </form>
        </Modal>
      )}

      {showTicketDeliveryModal && (
        <Modal title="Entrega de ticket" onClose={closeTicketDeliveryModal}>
          <div className="card">
            <p className="meta-small">Elige como entregar el ticket al cliente:</p>
            {ticketDeliveryRequest?.sale?.pendingDeliveryCode && (
              <p className="meta-small">
                Codigo ticket: <strong>{ticketDeliveryRequest.sale.pendingDeliveryCode}</strong>
              </p>
            )}
            <div className="row-actions">
              <button type="button" onClick={() => handleTicketDeliveryChoice('print')}>
                Mandar a imprimir
              </button>
              {ticketSettings.digitalTicketEnabled && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => handleTicketDeliveryChoice('digital')}
                >
                  Ticket digital
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {showPendingTicketModal && (
        <Modal title="Surtir ticket pendiente" onClose={closePendingTicketModal}>
          <div className="stack">
            <label>
              Codigo del ticket pendiente
              <input
                placeholder="Ejemplo: PD-ABC12345"
                value={pendingTicketSearchCode}
                onChange={(event) => {
                  setPendingTicketSearchCode(event.target.value.toUpperCase())
                  setPendingTicketMatchId('')
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  applyPendingTicketFromCode()
                }}
              />
            </label>
            <div className="row-actions">
              <button type="button" onClick={applyPendingTicketFromCode}>
                Buscar ticket pendiente
              </button>
            </div>

            {pendingTicketMatch && (
              <div className="card">
                <p>
                  <strong>Folio:</strong> {pendingTicketMatch.id.slice(0, 8).toUpperCase()}
                </p>
                <p>
                  <strong>Codigo:</strong> {pendingTicketMatch.pendingDeliveryCode}
                </p>
                <p>
                  <strong>Fecha original:</strong> {new Date(pendingTicketMatch.dateTime).toLocaleString('es-MX')}
                </p>
                <p>
                  <strong>Pendiente:</strong>{' '}
                  {pendingTicketMatch.pendingItems
                    .map((item) => `${item.code} ${item.name} x${item.quantity}`)
                    .join(', ')}
                </p>
                <div className="row-actions">
                  <button type="button" ref={pendingFulfillButtonRef} onClick={fulfillPendingTicket}>
                    Surtir ticket y entregar
                  </button>
                </div>
              </div>
            )}

            {!pendingTicketMatch && pendingTicketSearchCode && (
              <p className="empty">No se encontro ticket pendiente con ese codigo.</p>
            )}
          </div>
        </Modal>
      )}

      {showDigitalTicketModal && digitalTicketSale && (
        <Modal title="Ticket digital" onClose={closeDigitalTicketModal}>
          <div className="stack">
            <div className="digital-ticket-share card">
              <h3>Escanea para descargar en celular</h3>
              {digitalTicketQrDataUrl ? (
                <img src={digitalTicketQrDataUrl} alt="QR ticket digital" className="digital-ticket-qr" />
              ) : (
                <p className="meta-small">Generando QR...</p>
              )}
              <p className="meta-small">Al abrir el enlace desde el celular se descarga el ticket en PDF.</p>
              {digitalTicketShareUrl && (
                <a className="ghost-btn link-btn" href={digitalTicketShareUrl} target="_blank" rel="noreferrer">
                  Abrir enlace del ticket
                </a>
              )}
            </div>

            <div className="ticket-preview-wrap" style={{ fontSize: `${Number(ticketSettings.fontScale) || 1}rem` }}>
              <TicketPreview
                sale={digitalTicketSale}
                settings={ticketSettings}
                isEmpty={false}
                hidePendingNotice={digitalTicketHidePending}
                barcodeDataUrl={digitalTicketHidePending ? '' : digitalTicketBarcodeDataUrl}
              />
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() =>
                  downloadTicketPdf(digitalTicketSale, undefined, {
                    hidePendingNotice: digitalTicketHidePending,
                  })
                }
              >
                Descargar ticket en PDF
              </button>
              <button
                type="button"
                onClick={() => printTicket(digitalTicketSale, { hidePendingNotice: digitalTicketHidePending })}
              >
                Imprimir ticket
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showPosPickerModal && (
        <Modal title="Selecciona el POS" onClose={() => setShowPosPickerModal(false)}>
          <div className="pos-picker-grid">
            {visiblePosIds.map((posId) => {
              const name = getPosDisplayName(posId)
              const logo = getPosLogo(posId)
              const isLocked = Boolean(getPosLockHash(posId))
              const isCurrent = posId === activePosId

              return (
                <button
                  key={posId}
                  type="button"
                  className={isCurrent ? 'pos-picker-card pos-picker-card-active' : 'pos-picker-card'}
                  onClick={() => requestOpenPos(posId)}
                >
                  {logo ? (
                    <img src={logo} alt={name} className="pos-picker-logo" />
                  ) : (
                    <span className="pos-picker-logo pos-picker-fallback">POS</span>
                  )}
                  <span>{name}</span>
                  {isLocked && <small>Protegido</small>}
                </button>
              )
            })}
          </div>

          {pendingPosUnlockId && (
            <form className="card modal-form" onSubmit={confirmPosUnlock}>
              <label>
                Contraseña del POS
                <div className="password-field">
                  <input
                    type={showPosUnlockPassword ? 'text' : 'password'}
                    value={posUnlockPassword}
                    onChange={(event) => setPosUnlockPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPosUnlockPassword((v) => !v)}
                    aria-label={showPosUnlockPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    <EyeToggleIcon visible={showPosUnlockPassword} />
                  </button>
                </div>
              </label>
              {posUnlockError && <p className="empty">{posUnlockError}</p>}
              <button type="submit">Abrir POS</button>
            </form>
          )}
        </Modal>
      )}

      {securityEditorPosId && (
        <Modal
          title={`Seguridad: ${getPosDisplayName(securityEditorPosId)}`}
          onClose={closePosSecurityEditor}
        >
          <form
            className="card modal-form"
            onSubmit={(event) => {
              event.preventDefault()
              savePosLock(securityEditorPosId)
            }}
          >
            <label>
              Contraseña del POS
              <div className="password-field">
                <input
                  type={showNewPosLockPassword ? 'text' : 'password'}
                  value={newPosLockPassword}
                  onChange={(event) => setNewPosLockPassword(event.target.value)}
                  placeholder="Define o cambia contraseña"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowNewPosLockPassword((v) => !v)}
                  aria-label={showNewPosLockPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  <EyeToggleIcon visible={showNewPosLockPassword} />
                </button>
              </div>
            </label>

            <div className="row-actions">
              <button type="submit" className="ghost-btn">
                Guardar bloqueo
              </button>
              <button
                type="button"
                onClick={() => {
                  clearPosLock(securityEditorPosId)
                  closePosSecurityEditor()
                }}
              >
                Quitar bloqueo
              </button>
            </div>
          </form>
        </Modal>
      )}

      {appMessageModal && (
        <Modal
          title={appMessageModal.title || 'Mensaje'}
          onClose={() => {
            appMessageModal.resolve(false)
            setAppMessageModal(null)
          }}
        >
          <div className="card">
            <p>{appMessageModal.message}</p>
            <div className="row-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  appMessageModal.resolve(false)
                  setAppMessageModal(null)
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  appMessageModal.resolve(true)
                  setAppMessageModal(null)
                }}
              >
                Aceptar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showProductModal && (
        <Modal title={editingProductId ? 'Editar producto' : 'Nuevo producto'} onClose={closeProductModal}>
          <form className="modal-form" onSubmit={saveProduct}>
            <label>
              Codigo unico
              <input
                value={newProduct.code}
                onChange={(event) => setNewProduct((c) => ({ ...c, code: event.target.value.toUpperCase() }))}
                placeholder="Ejemplo: P001"
                required
              />
            </label>
            <label>
              Nombre
              <input
                value={newProduct.name}
                onChange={(event) => setNewProduct((c) => ({ ...c, name: event.target.value }))}
                required
              />
            </label>
            <label>
              Marca
              <input
                value={newProduct.brand}
                onChange={(event) => setNewProduct((c) => ({ ...c, brand: event.target.value }))}
              />
            </label>
            <label>
              Proveedor
              <select
                value={newProduct.supplier}
                onChange={(event) => setNewProduct((c) => ({ ...c, supplier: event.target.value }))}
              >
                <option value="">Sin proveedor</option>
                {supplierNames.map((supplierName) => (
                  <option key={supplierName} value={supplierName}>
                    {supplierName}
                  </option>
                ))}
              </select>
            </label>
            <label className="modal-span-full">
              Categoria
              <div className="row-actions">
                <input
                  list="product-category-options"
                  value={newProduct.category}
                  onChange={(event) => setNewProduct((c) => ({ ...c, category: event.target.value }))}
                  placeholder="Escribe o selecciona categoria"
                />
                <button type="button" className="ghost-btn" onClick={addCategoryManually}>
                  Guardar categoria
                </button>
              </div>
              <datalist id="product-category-options">
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              <div className="row-actions">
                <input
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="Nueva categoria manual"
                />
              </div>
            </label>
            <label>
              Costo
              <input
                type="number"
                min="0"
                step="0.01"
                value={newProduct.cost}
                onChange={(event) => setNewProduct((c) => ({ ...c, cost: event.target.value }))}
                required
              />
            </label>
            <label>
              Precio de venta
              <input
                type="number"
                min="0"
                step="0.01"
                value={newProduct.price}
                onChange={(event) => setNewProduct((c) => ({ ...c, price: event.target.value }))}
                required
              />
            </label>
            <label>
              Stock inicial
              <input
                type="number"
                min="0"
                value={newProduct.stock}
                onChange={(event) => setNewProduct((c) => ({ ...c, stock: event.target.value }))}
                required
              />
            </label>
            <label>
              Stock minimo
              <input
                type="number"
                min="0"
                value={newProduct.minStock}
                onChange={(event) => setNewProduct((c) => ({ ...c, minStock: event.target.value }))}
                required
              />
            </label>
            <label>
              Area
              <input
                value={newProduct.locationArea}
                onChange={(event) => setNewProduct((c) => ({ ...c, locationArea: event.target.value }))}
              />
            </label>
            <label>
              Ubicacion exacta
              <input
                value={newProduct.locationBin}
                onChange={(event) => setNewProduct((c) => ({ ...c, locationBin: event.target.value }))}
              />
            </label>
            <label>
              Subir foto
              <input type="file" accept="image/*" onChange={handleImageUpload} />
            </label>
            {newProduct.imageUrl && <img src={newProduct.imageUrl} alt="Vista previa" className="product-preview" />}
            <button type="submit">{editingProductId ? 'Guardar cambios' : 'Guardar producto'}</button>
          </form>
        </Modal>
      )}

      {showCutModal && (
        <Modal title="Corte diario" onClose={() => setShowCutModal(false)}>
          <form className="modal-form" onSubmit={saveDailyCut}>
            <label>
              Fecha del corte
              <input type="date" value={cutForm.date} disabled required />
            </label>
            <label>
              Caja inicial
              <input type="number" step="0.01" value={cutForm.openingCash} disabled />
            </label>
            <label>
              Gastos del dia
              <input
                type="number"
                step="0.01"
                value={cutForm.expenses}
                onChange={(event) => setCutForm((c) => ({ ...c, expenses: event.target.value }))}
              />
            </label>
            <label>
              Efectivo contado al cierre
              <input
                type="number"
                step="0.01"
                value={cutForm.countedCash}
                onChange={(event) => setCutForm((c) => ({ ...c, countedCash: event.target.value }))}
              />
            </label>
            {cutPreview.shortageAmount > 0 && (
              <>
                <p className="meta-small">
                  Faltante detectado: <strong>{currency.format(cutPreview.shortageAmount)}</strong>
                </p>
                <label>
                  Leyenda del pago
                  <input
                    value={cutForm.shortagePaidLabel}
                    onChange={(event) =>
                      setCutForm((c) => ({ ...c, shortagePaidLabel: event.target.value }))
                    }
                    placeholder="Pagado"
                  />
                </label>
                <label>
                  Monto pagado del faltante
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={cutPreview.shortageAmount}
                    value={cutForm.shortagePaid}
                    onChange={(event) => setCutForm((c) => ({ ...c, shortagePaid: event.target.value }))}
                  />
                </label>
              </>
            )}
            <label>
              Notas
              <textarea
                rows="3"
                value={cutForm.notes}
                onChange={(event) => setCutForm((c) => ({ ...c, notes: event.target.value }))}
              />
            </label>
            <button type="submit">Guardar corte</button>
          </form>
        </Modal>
      )}

      {showOpenCashModal && (
        <Modal title="Abrir caja" onClose={() => setShowOpenCashModal(false)}>
          <form className="modal-form" onSubmit={openCashRegister}>
            <p className="meta-small">Usuario actual: {currentUser.fullName}</p>
            <label>
              Fondo inicial de caja
              <input
                type="number"
                step="0.01"
                min="0"
                value={openCashForm.openingCash}
                onChange={(event) =>
                  setOpenCashForm((current) => ({ ...current, openingCash: event.target.value }))
                }
                required
              />
            </label>
            <button type="submit">Confirmar apertura</button>
          </form>
        </Modal>
      )}
    </main>
  )
}

export default App
