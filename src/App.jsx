import { useEffect, useMemo, useRef, useState } from 'react'
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
const CLEAN_START_VERSION = '2026-03-clean-start'

const LEGACY_PRODUCT_STORAGE_KEY = 'regalos_pos_products'
const LEGACY_SALES_STORAGE_KEY = 'regalos_pos_sales'
const LEGACY_CUTS_STORAGE_KEY = 'regalos_pos_cuts'
const LEGACY_CASHBOX_STORAGE_KEY = 'regalos_pos_cashbox'
const LEGACY_USERS_STORAGE_KEY = 'regalos_pos_users'
const LEGACY_SESSION_USER_KEY = 'regalos_pos_session_user'

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
  'tarjeta-debito': 'Tarjeta Debito',
  'tarjeta-credito': 'Tarjeta Credito',
  cheque: 'Cheque',
  deposito: 'Deposito',
  paypal: 'PayPal',
  credito: 'Credito',
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
  showCashier: true,
  showDate: true,
  showProductCode: true,
  autoPrint: false,
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

const readTicketSettings = () => {
  const data = readStorage(TICKET_SETTINGS_STORAGE_KEY, null)
  if (!data || typeof data !== 'object') return defaultTicketSettings

  return {
    ...defaultTicketSettings,
    ...data,
    printerWidthMm: ticketWidthOptions.includes(String(data.printerWidthMm))
      ? String(data.printerWidthMm)
      : defaultTicketSettings.printerWidthMm,
    fontScale: String(data.fontScale ?? defaultTicketSettings.fontScale),
    showCashier: data.showCashier !== false,
    showDate: data.showDate !== false,
    showProductCode: data.showProductCode !== false,
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
        currentStock: Number(item.currentStock ?? 0),
        minStock: Number(item.minStock ?? 5),
        recommendedQty: Number(item.recommendedQty ?? 0),
      }))
    : [],
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

const TicketPreview = ({ sale, settings, isEmpty }) => {
  if (isEmpty || !sale) {
    return <p className="empty">No hay venta para mostrar en vista previa.</p>
  }

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

const readProducts = () => {
  const data = readStorageAny([PRODUCT_STORAGE_KEY, LEGACY_PRODUCT_STORAGE_KEY], [])
  if (!Array.isArray(data)) return []
  return data.map(normalizeProduct)
}

const readUsers = () => {
  const data = readStorageAny([USERS_STORAGE_KEY, LEGACY_USERS_STORAGE_KEY], [])
  if (!Array.isArray(data)) return []
  return data.map(normalizeUser)
}

const readSuppliers = () => {
  const data = readStorage(SUPPLIERS_STORAGE_KEY, [])
  if (!Array.isArray(data)) return []
  return data.map(normalizeSupplier)
}

const readPurchaseOrders = () => {
  const data = readStorage(PURCHASE_ORDERS_STORAGE_KEY, [])
  if (!Array.isArray(data)) return []
  return data.map(normalizePurchaseOrder)
}

const readCashBox = () => {
  const today = todayISO()
  const data = readStorageAny([CASHBOX_STORAGE_KEY, LEGACY_CASHBOX_STORAGE_KEY], null)

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

function App() {
  const [activeTab, setActiveTab] = useState('sales')
  const [adminSection, setAdminSection] = useState('users')
  const [userAdminTab, setUserAdminTab] = useState('users-list')
  const [userMovementsFilterUser, setUserMovementsFilterUser] = useState('')
  const [userMovementsFilterDate, setUserMovementsFilterDate] = useState(() => todayISO())
  const [users, setUsers] = useState(() => readUsers())
  const [products, setProducts] = useState(() => readProducts())
  const [suppliers, setSuppliers] = useState(() => readSuppliers())
  const [purchaseOrders, setPurchaseOrders] = useState(() => readPurchaseOrders())
  const [sales, setSales] = useState(() =>
    readStorageAny([SALES_STORAGE_KEY, LEGACY_SALES_STORAGE_KEY], []),
  )
  const [cuts, setCuts] = useState(() =>
    readStorageAny([CUTS_STORAGE_KEY, LEGACY_CUTS_STORAGE_KEY], []),
  )
  const [cart, setCart] = useState([])
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [searchTerm, setSearchTerm] = useState('')
  const [showAlerts, setShowAlerts] = useState(false)
  const [showProductModal, setShowProductModal] = useState(false)
  const [showCutModal, setShowCutModal] = useState(false)
  const [showOpenCashModal, setShowOpenCashModal] = useState(false)
  const [newProduct, setNewProduct] = useState(emptyProductForm)
  const [openCashForm, setOpenCashForm] = useState(emptyOpenCashForm)
  const [cashBox, setCashBox] = useState(() => readCashBox())
  const [now, setNow] = useState(() => new Date())
  const [newUserForm, setNewUserForm] = useState(emptyNewUserForm)
  const [newSupplierForm, setNewSupplierForm] = useState(emptySupplierForm)
  const [editingSupplierId, setEditingSupplierId] = useState('')
  const [supplierEditForm, setSupplierEditForm] = useState(emptySupplierForm)
  const [supplyOrderId, setSupplyOrderId] = useState('')
  const [supplyOrderForm, setSupplyOrderForm] = useState(emptySupplyOrderForm)
  const [inventorySearchTerm, setInventorySearchTerm] = useState('')
  const [cutForm, setCutForm] = useState({
    date: todayISO(),
    openingCash: '0',
    expenses: '0',
    countedCash: '0',
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
  const [authError, setAuthError] = useState('')
  const [currentUser, setCurrentUser] = useState(() =>
    readStorageAny([SESSION_USER_KEY, LEGACY_SESSION_USER_KEY], null),
  )
  const [scanNotice, setScanNotice] = useState('')
  const [serverMode, setServerMode] = useState('checking')
  const [ticketSettings, setTicketSettings] = useState(() => readTicketSettings())
  const [lastSaleForTicket, setLastSaleForTicket] = useState(null)

  const scanBufferRef = useRef('')
  const scanTimerRef = useRef(null)
  const scanNoticeTimerRef = useRef(null)
  const serverSyncReadyRef = useRef(false)
  const serverSyncTimerRef = useRef(null)

  useEffect(() => {
    const currentVersion = localStorage.getItem(DATA_VERSION_KEY)
    if (currentVersion === CLEAN_START_VERSION) return

    localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify([]))
    localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify([]))
    localStorage.setItem(CUTS_STORAGE_KEY, JSON.stringify([]))
    localStorage.setItem(DATA_VERSION_KEY, CLEAN_START_VERSION)

    setProducts([])
    setSales([])
    setCuts([])
    setCart([])
    setCashBox({
      isOpen: false,
      date: todayISO(),
      openingCash: 0,
      openedById: '',
      openedByName: '',
      openedAt: null,
      closedAt: null,
    })
  }, [])

  useEffect(() => {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
  }, [users])

  useEffect(() => {
    localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(products))
  }, [products])

  useEffect(() => {
    localStorage.setItem(SUPPLIERS_STORAGE_KEY, JSON.stringify(suppliers))
  }, [suppliers])

  useEffect(() => {
    localStorage.setItem(PURCHASE_ORDERS_STORAGE_KEY, JSON.stringify(purchaseOrders))
  }, [purchaseOrders])

  useEffect(() => {
    localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(sales))
  }, [sales])

  useEffect(() => {
    localStorage.setItem(CUTS_STORAGE_KEY, JSON.stringify(cuts))
  }, [cuts])

  useEffect(() => {
    localStorage.setItem(CASHBOX_STORAGE_KEY, JSON.stringify(cashBox))
  }, [cashBox])

  useEffect(() => {
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(currentUser))
  }, [currentUser])

  useEffect(() => {
    localStorage.setItem(TICKET_SETTINGS_STORAGE_KEY, JSON.stringify(ticketSettings))
  }, [ticketSettings])

  useEffect(() => {
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
          if (Array.isArray(state.sales)) setSales(state.sales)
          if (Array.isArray(state.cuts)) setCuts(state.cuts)
          if (Array.isArray(state.suppliers)) setSuppliers(state.suppliers.map(normalizeSupplier))
          if (Array.isArray(state.purchaseOrders)) {
            setPurchaseOrders(state.purchaseOrders.map(normalizePurchaseOrder))
          }
          if (state.cashBox && typeof state.cashBox === 'object') setCashBox(state.cashBox)
          if (state.ticketSettings && typeof state.ticketSettings === 'object') {
            setTicketSettings({ ...defaultTicketSettings, ...state.ticketSettings })
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
  }, [])

  useEffect(() => {
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

  useEffect(() => {
    if (!isAdmin && activeTab === 'admin') {
      setActiveTab('sales')
    }
  }, [activeTab, isAdmin])

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

  const supplierNames = useMemo(
    () => suppliers.map((supplier) => supplier.name).sort((a, b) => a.localeCompare(b, 'es-MX')),
    [suppliers],
  )

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

  const locationMap = useMemo(() => {
    return products.reduce((acc, product) => {
      const area = product.locationArea || 'Sin area'
      const bin = product.locationBin || 'Sin ubicacion'
      const key = `${area} / ${bin}`
      if (!acc[key]) acc[key] = []
      acc[key].push(product)
      return acc
    }, {})
  }, [products])

  const userMovements = useMemo(() => {
    const saleMovements = sales.map((sale) => ({
      id: `sale-${sale.id}`,
      type: 'Venta',
      dateTime: sale.dateTime,
      userId: sale.cashierId || '',
      userName: sale.cashierName || 'No registrado',
      paymentMethod: sale.paymentMethod,
      total: sale.total,
      detail: `${sale.items.length} producto(s)`,
    }))

    const cutMovements = cuts.map((cut) => ({
      id: `cut-${cut.id}`,
      type: 'Corte',
      dateTime: cut.createdAt,
      userId: cut.closedById || '',
      userName: cut.closedByName || cut.cashierName || 'No registrado',
      paymentMethod: '-',
      total: cut.totalSales,
      detail: `Cierre del dia ${cut.date}`,
    }))

    return [...saleMovements, ...cutMovements].sort(
      (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
    )
  }, [sales, cuts])

  // Filtros de movimientos de usuarios.
  const filteredUserMovements = useMemo(() => {
    return userMovements.filter((movement) => {
      const matchesUser = !userMovementsFilterUser || movement.userId === userMovementsFilterUser
      const movementDate = movement.dateTime ? movement.dateTime.slice(0, 10) : ''
      const matchesDate = !userMovementsFilterDate || movementDate === userMovementsFilterDate
      return matchesUser && matchesDate
    })
  }, [userMovements, userMovementsFilterUser, userMovementsFilterDate])

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

  const printTicket = (sale) => {
    if (!sale) return

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

    const ticketHtml = `<!doctype html>
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
    .ticket-foot { text-align: center; margin-top: 2mm; }
  </style>
</head>
<body onload="window.print(); window.close();">
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
    <footer class="ticket-foot"><p>${escapeHtml(ticketSettings.footerMessage || 'Gracias por su compra')}</p></footer>
  </article>
</body>
</html>`

    const printWindow = window.open('', '_blank', 'width=420,height=640')
    if (!printWindow) {
      setScanNotice('No se pudo abrir la ventana de impresion. Revisa el bloqueo de popups.')
      return
    }

    printWindow.document.open()
    printWindow.document.write(ticketHtml)
    printWindow.document.close()
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
      setTicketSettings((current) => ({ ...current, logoUrl: result }))
    }
    reader.readAsDataURL(file)
  }

  const clearTicketLogo = () => {
    setTicketSettings((current) => ({ ...current, logoUrl: '' }))
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
      setAuthError('Usuario o contrasena incorrectos.')
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
  }

  const logout = () => {
    setCurrentUser(null)
    setLoginForm({ username: '', password: '' })
    setShowOpenCashModal(false)
    setShowCutModal(false)
    setShowProductModal(false)
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

    setSupplyOrderForm({
      ...emptySupplyOrderForm,
      paymentMethod: suggestedMethod,
    })
  }

  const submitSupplyOrder = (event) => {
    event.preventDefault()
    if (!supplyOrderId) return

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
          creditPayments,
        }
      }),
    )

    setSupplyOrderId('')
    setSupplyOrderForm(emptySupplyOrderForm)
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

  const addProduct = (event) => {
    event.preventDefault()
    const cleanedCode = newProduct.code.trim().toUpperCase()
    const payload = {
      id: crypto.randomUUID(),
      code: cleanedCode,
      name: newProduct.name.trim(),
      brand: newProduct.brand.trim(),
      supplier: newProduct.supplier.trim(),
      category: newProduct.category,
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

    if (products.some((product) => product.code === payload.code)) return

    setProducts((current) => [payload, ...current])
    setNewProduct(emptyProductForm)
    setShowProductModal(false)
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
    if (product.stock <= 0 || !currentUser) return

    setCart((current) => {
      const found = current.find((item) => item.id === product.id)
      const qtyInCart = found?.quantity ?? 0
      if (qtyInCart >= product.stock) return current

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

    if (product.stock <= 0) {
      setScannerNotice(`Sin stock: ${product.code} ${product.name}`)
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
    const nextQty = Number(qty)
    if (nextQty <= 0 || Number.isNaN(nextQty)) {
      setCart((current) => current.filter((item) => item.id !== productId))
      return
    }

    const product = products.find((item) => item.id === productId)
    if (!product) return

    setCart((current) =>
      current.map((item) =>
        item.id === productId ? { ...item, quantity: Math.min(nextQty, product.stock) } : item,
      ),
    )
  }

  const removeFromCart = (productId) => {
    setCart((current) => current.filter((item) => item.id !== productId))
  }

  const checkout = () => {
    if (cart.length === 0 || !cashBox.isOpen || !currentUser) return

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const totalCost = cart.reduce((sum, item) => sum + item.cost * item.quantity, 0)

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
    }

    setSales((current) => [sale, ...current])
    setProducts((current) =>
      current.map((product) => {
        const inCart = cart.find((item) => item.id === product.id)
        if (!inCart) return product
        return { ...product, stock: product.stock - inCart.quantity }
      }),
    )
    setLastSaleForTicket(sale)
    setCart([])

    if (ticketSettings.autoPrint) {
      setTimeout(() => {
        printTicket(sale)
      }, 150)
    }
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
      difference: countedCash - expectedCash,
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
      notes: '',
    })
    setCart([])
    setShowCutModal(false)
  }

  const tabs = [
    { id: 'sales', label: 'Punto de Venta' },
    ...(isAdmin ? [{ id: 'admin', label: 'Administrador' }] : []),
  ]

  if (!currentUser) {
    return (
      <main className="app-shell auth-shell">
        <section className="panel auth-panel">
          <h1>Acceso al Sistema POS</h1>

          {usersWithCredentials.length === 0 && authStep === 'master' && (
            <form className="auth-form" onSubmit={handleMasterLogin}>
              <p>Primer inicio: usa el usuario maestro para configurar al duenio/administrador.</p>
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
                Contrasena maestra
                <input
                  type="password"
                  value={masterLogin.password}
                  onChange={(event) =>
                    setMasterLogin((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                />
              </label>
              <button type="submit">Validar usuario maestro</button>
            </form>
          )}

          {usersWithCredentials.length === 0 && authStep === 'owner-setup' && (
            <form className="auth-form" onSubmit={handleOwnerSetup}>
              <p>Configura al duenio/administrador. Este sera el acceso principal del sistema.</p>
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
                Contrasena
                <input
                  type="password"
                  value={ownerSetup.password}
                  onChange={(event) =>
                    setOwnerSetup((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                />
              </label>
              <button type="submit">Guardar administrador</button>
            </form>
          )}

          {usersWithCredentials.length > 0 && (
            <form className="auth-form" onSubmit={handleLogin}>
              <p>Inicia sesion para poder abrir caja y cobrar.</p>
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
                Contrasena
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                />
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
    <main className="app-shell">
      <header className="hero">
        <div className="hero-head-row">
          <p className="hero-datetime">
            {fullDateLabel} | {liveTimeLabel}
          </p>
          <div className="alert-box">
            <div className="header-actions">
              <button type="button" className="ghost-btn ghost-btn-small" onClick={logout}>
                Cerrar sesion
              </button>
              <button type="button" className="bell-button bell-button-small" onClick={() => setShowAlerts((v) => !v)}>
                <span className="bell-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="img">
                    <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-4h-1V11a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v7H5a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2Z" />
                  </svg>
                </span>
                <span className="sr-only">Alertas de inventario y pagos de credito</span>
                {alertBadgeCount > 0 && <span className="alert-badge">{alertBadgeCount}</span>}
              </button>
            </div>
            {showAlerts && (
              <div className="alert-panel">
                <h3>Alertas de inventario</h3>
                {lowStockProducts.length === 0 && <p>Sin alertas de stock.</p>}
                {lowStockProducts.map((product) => (
                  <p key={product.id}>
                    {product.code} - {product.name}: {product.stock} pzas (minimo {product.minStock})
                  </p>
                ))}

                <h3>Pagos pendientes de ordenes a credito</h3>
                {purchaseCreditNotifications.length === 0 && <p>Sin pagos pendientes por ahora.</p>}
                {purchaseCreditNotifications.map((notice) => (
                  <div key={`${notice.orderId}-${notice.paymentId}`} className="alert-payment-item">
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {ticketSettings.logoUrl && (
          <div className="hero-logo-center-wrap">
            <img src={ticketSettings.logoUrl} alt="Logo tienda" className="hero-logo" />
          </div>
        )}

        <div className="hero-brand centered-brand">
          <p className="eyebrow">Sistema POS</p>
          <h1>{ticketSettings.storeName || 'Sistema Punto de Venta'}</h1>
          <p className="datetime-line">Sesion: {currentUser.fullName} (@{currentUser.username})</p>
          <p className="meta-small">
            Servidor: {serverMode === 'online' ? 'Conectado (SQLite)' : serverMode === 'offline' ? 'Sin conexion, guardando local' : 'Verificando...'}
          </p>
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
          {[
            { id: 'users', label: 'Usuarios' },
            { id: 'ticket', label: 'Ticket' },
            { id: 'inventory', label: 'Inventario' },
            { id: 'dashboard', label: 'Resumen' },
            { id: 'analytics', label: 'Analitica' },
            { id: 'purchase-orders', label: 'Ordenes de compra' },
            { id: 'suppliers', label: 'Proveedores' },
          ].map((section) => (
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

              <aside className="cart-panel">
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
                        max={String(products.find((product) => product.id === item.id)?.stock ?? 1)}
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
                <button type="button" onClick={checkout} disabled={cart.length === 0}>
                  Confirmar cobro
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => printTicket(lastSaleForTicket || sales[0])}
                  disabled={!lastSaleForTicket && !sales[0]}
                >
                  Reimprimir ultimo ticket
                </button>
              </aside>
            </div>
          )}
        </section>
      )}

      {activeTab === 'admin' && isAdmin && adminSection === 'inventory' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Inventario General</h2>
            <button type="button" onClick={() => setShowProductModal(true)}>
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

          <div className="card location-map-card">
            <h2>Mapa de Ubicaciones</h2>
            {Object.keys(locationMap).length === 0 && (
              <p className="empty">Aun no hay ubicaciones registradas.</p>
            )}
            <div className="location-grid">
              {Object.entries(locationMap).map(([place, items]) => (
                <article key={place} className="location-box">
                  <h3>{place}</h3>
                  <p>{items.length} producto(s)</p>
                  <div className="location-items">
                    {items.map((item) => (
                      <span key={item.id}>{item.code} - {item.name}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
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
                      <td colSpan="4" className="empty">Aun no hay ventas para calcular analitica.</td>
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
            <h2>Ordenes de compra automaticas (stock {'<='} 5)</h2>
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
                          <th>Sugerido comprar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map((item) => (
                          <tr key={`${order.id}-${item.productId}`}>
                            <td>{item.code}</td>
                            <td>{item.name}</td>
                            <td>{item.currentStock}</td>
                            <td>{item.minStock}</td>
                            <td>{item.recommendedQty}</td>
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
                      <h3>Pagos de credito</h3>
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
              <p className="empty">Sin ordenes por ahora. Se crean cuando un producto llega a 5 piezas o menos.</p>
            )}
          </div>
        </section>
      )}

      {activeTab === 'admin' && isAdmin && adminSection === 'suppliers' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Proveedores</h2>
          </div>

          <form className="card modal-form" onSubmit={addSupplier}>
            <label>
              Nombre del proveedor
              <input
                value={newSupplierForm.name}
                onChange={(event) =>
                  setNewSupplierForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Nombre de contacto
              <input
                value={newSupplierForm.contactName}
                onChange={(event) =>
                  setNewSupplierForm((current) => ({ ...current, contactName: event.target.value }))
                }
              />
            </label>
            <label>
              Tipo de pago con proveedor
              <select
                value={newSupplierForm.paymentType}
                onChange={(event) =>
                  setNewSupplierForm((current) => ({ ...current, paymentType: event.target.value }))
                }
              >
                {providerPaymentOptions.map((paymentType) => (
                  <option key={paymentType} value={paymentType}>
                    {paymentLabelMap[paymentType] || paymentType}
                  </option>
                ))}
              </select>
            </label>
            {newSupplierForm.paymentType === 'transferencia' && (
              <label>
                Cuenta para transferencia
                <input
                  value={newSupplierForm.transferAccount}
                  onChange={(event) =>
                    setNewSupplierForm((current) => ({ ...current, transferAccount: event.target.value }))
                  }
                  placeholder="CLABE o numero de cuenta"
                />
              </label>
            )}
            <label>
              Telefono
              <input
                value={newSupplierForm.phone}
                onChange={(event) =>
                  setNewSupplierForm((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </label>
            <label>
              Correo
              <input
                type="email"
                value={newSupplierForm.email}
                onChange={(event) =>
                  setNewSupplierForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label>
              Direccion
              <input
                value={newSupplierForm.address}
                onChange={(event) =>
                  setNewSupplierForm((current) => ({ ...current, address: event.target.value }))
                }
              />
            </label>
            <label>
              Notas
              <textarea
                rows="2"
                value={newSupplierForm.notes}
                onChange={(event) =>
                  setNewSupplierForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </label>
            <button type="submit">Guardar proveedor</button>
          </form>

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
                    <th>Telefono</th>
                    <th>Correo</th>
                    <th>Direccion</th>
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
                      <td>{supplier.address || '-'}</td>
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
                      <td colSpan="9" className="empty">Aun no hay proveedores registrados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {editingSupplierId && (
            <form className="card modal-form" onSubmit={saveSupplierEdit}>
              <h2>Editar proveedor</h2>
              <label>
                Nombre del proveedor
                <input
                  value={supplierEditForm.name}
                  onChange={(event) =>
                    setSupplierEditForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Nombre de contacto
                <input
                  value={supplierEditForm.contactName}
                  onChange={(event) =>
                    setSupplierEditForm((current) => ({ ...current, contactName: event.target.value }))
                  }
                />
              </label>
              <label>
                Tipo de pago
                <select
                  value={supplierEditForm.paymentType}
                  onChange={(event) =>
                    setSupplierEditForm((current) => ({ ...current, paymentType: event.target.value }))
                  }
                >
                  {providerPaymentOptions.map((paymentType) => (
                    <option key={paymentType} value={paymentType}>
                      {paymentLabelMap[paymentType] || paymentType}
                    </option>
                  ))}
                </select>
              </label>
              {supplierEditForm.paymentType === 'transferencia' && (
                <label>
                  Cuenta para transferencia
                  <input
                    value={supplierEditForm.transferAccount}
                    onChange={(event) =>
                      setSupplierEditForm((current) => ({ ...current, transferAccount: event.target.value }))
                    }
                  />
                </label>
              )}
              <label>
                Telefono
                <input
                  value={supplierEditForm.phone}
                  onChange={(event) =>
                    setSupplierEditForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </label>
              <label>
                Correo
                <input
                  type="email"
                  value={supplierEditForm.email}
                  onChange={(event) =>
                    setSupplierEditForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>
              <label>
                Direccion
                <input
                  value={supplierEditForm.address}
                  onChange={(event) =>
                    setSupplierEditForm((current) => ({ ...current, address: event.target.value }))
                  }
                />
              </label>
              <label>
                Notas
                <textarea
                  rows="2"
                  value={supplierEditForm.notes}
                  onChange={(event) =>
                    setSupplierEditForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </label>
              <div className="row-actions">
                <button type="submit">Guardar cambios</button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setEditingSupplierId('')
                    setSupplierEditForm(emptySupplierForm)
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
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
                <button type="button" className="ghost-btn" onClick={clearTicketLogo}>
                  Quitar logo
                </button>
              </div>
            )}
            <label>
              Razon social o negocio
              <input
                value={ticketSettings.businessName}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, businessName: event.target.value }))
                }
              />
            </label>
            <label>
              Direccion
              <input
                value={ticketSettings.address}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, address: event.target.value }))
                }
              />
            </label>
            <label>
              Telefono
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

            <label className="check-line">
              <input
                type="checkbox"
                checked={ticketSettings.showDate}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, showDate: event.target.checked }))
                }
              />
              Mostrar fecha y hora
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={ticketSettings.showCashier}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, showCashier: event.target.checked }))
                }
              />
              Mostrar cajero
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={ticketSettings.showProductCode}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, showProductCode: event.target.checked }))
                }
              />
              Mostrar codigo de producto
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={ticketSettings.autoPrint}
                onChange={(event) =>
                  setTicketSettings((current) => ({ ...current, autoPrint: event.target.checked }))
                }
              />
              Imprimir automaticamente al cobrar
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

      {activeTab === 'admin' && isAdmin && adminSection === 'users' && (
        <section className="panel inventory-full">
          <div className="section-head">
            <h2>Administración de Usuarios</h2>
          </div>
          <nav className="tab-row admin-row" aria-label="Subsecciones de usuarios">
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
              <form className="card modal-form" onSubmit={addUser}>
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
                  <input
                    type="password"
                    value={newUserForm.password}
                    onChange={(event) =>
                      setNewUserForm((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                  />
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
                            <label className="switch-line">
                              <input
                                type="checkbox"
                                checked={user.active !== false}
                                onChange={() => toggleUserActive(user.id)}
                              />
                              <span>{user.active !== false ? 'Activo' : 'Inactivo'}</span>
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
                    value={userMovementsFilterUser || ''}
                    onChange={(event) => setUserMovementsFilterUser(event.target.value)}
                  >
                    <option value="">Todos</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>{user.fullName}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Buscar por fecha
                  <input
                    type="date"
                    value={userMovementsFilterDate || ''}
                    onChange={(event) => setUserMovementsFilterDate(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setUserMovementsFilterUser('')
                    setUserMovementsFilterDate('')
                  }}
                >
                  Limpiar filtros
                </button>
              </div>
              <div className="stack">
                {filteredUserMovements.length === 0 && <p className="empty">No hay movimientos registrados.</p>}
                {filteredUserMovements.map((movement) => (
                  <article key={movement.id} className="history-item">
                    <p>
                      <strong>{movement.type}</strong> - {new Date(movement.dateTime).toLocaleString('es-MX')}
                    </p>
                    <p>Usuario: {movement.userName}</p>
                    <p>
                      Forma de pago: {movement.paymentMethod} | Monto: {currency.format(movement.total)}
                    </p>
                    <p>{movement.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {supplyOrderId && (
        <Modal title="Surtir orden de compra" onClose={() => setSupplyOrderId('')}>
          <form className="modal-form" onSubmit={submitSupplyOrder}>
            <label>
              Metodo de pago al proveedor
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
            <label>
              Monto total de la compra
              <input
                type="number"
                step="0.01"
                min="0"
                value={supplyOrderForm.totalAmount}
                onChange={(event) =>
                  setSupplyOrderForm((current) => ({ ...current, totalAmount: event.target.value }))
                }
                required
              />
            </label>

            {supplyOrderForm.paymentMethod === 'credito' && (
              <>
                <label>
                  Tipo de credito
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

            <button type="submit">Confirmar surtido</button>
          </form>
        </Modal>
      )}

      {showProductModal && (
        <Modal title="Nuevo producto" onClose={() => setShowProductModal(false)}>
          <form className="modal-form" onSubmit={addProduct}>
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
            <label>
              Categoria
              <select
                value={newProduct.category}
                onChange={(event) => setNewProduct((c) => ({ ...c, category: event.target.value }))}
              >
                <option value="General">General</option>
                <option value="Escolar">Escolar</option>
                <option value="Oficina">Oficina</option>
              </select>
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
            <button type="submit">Guardar producto</button>
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
