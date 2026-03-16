import cors from 'cors'
import Database from 'better-sqlite3'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = process.env.POS_DATA_DIR
  ? path.resolve(process.env.POS_DATA_DIR)
  : path.join(__dirname, 'data')

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const uploadsDir = path.join(dataDir, 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

const stateKeys = [
  'users',
  'products',
  'sales',
  'cuts',
  'cashBox',
  'suppliers',
  'purchaseOrders',
  'ticketSettings',
  'categorias',
  'recetas',
  'tiendaPackages',
  'tiendaCatalog',
  'ajustesProduccion',
]

const stores = Object.fromEntries(
  stateKeys.map((key) => {
    const dbPath = path.join(dataDir, `${key}.sqlite`)
    const db = new Database(dbPath)
    db.prepare(
      `CREATE TABLE IF NOT EXISTS state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json_data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ).run()

    return [
      key,
      {
        dbPath,
        readStmt: db.prepare('SELECT json_data, updated_at FROM state WHERE id = 1'),
        upsertStmt: db.prepare(
          `INSERT INTO state (id, json_data, updated_at)
           VALUES (1, @json_data, @updated_at)
           ON CONFLICT(id) DO UPDATE SET
             json_data = excluded.json_data,
             updated_at = excluded.updated_at`,
        ),
      },
    ]
  }),
)

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use('/uploads', express.static(uploadsDir))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase()
      const safeExt = ext && ext.length <= 8 ? ext : '.jpg'
      cb(null, `tienda-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
})

const readStore = (key, fallback) => {
  const store = stores[key]
  if (!store) return fallback
  const row = store.readStmt.get()
  if (!row) return fallback
  try {
    const parsed = JSON.parse(row.json_data)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

const writeStore = (key, value) => {
  const store = stores[key]
  if (!store) return
  store.upsertStmt.run({
    json_data: JSON.stringify(value),
    updated_at: new Date().toISOString(),
  })
}

const nextId = (items) => {
  const list = Array.isArray(items) ? items : []
  const max = list.reduce((acc, item) => Math.max(acc, Number(item?.id || 0)), 0)
  return max + 1
}

const normalizeText = (value) => String(value || '').trim()

const normalizeUnit = (value) => {
  const unit = normalizeText(value).toLowerCase()
  if (!unit) return ''
  if (unit === 'gramo' || unit === 'gramos') return 'g'
  if (unit === 'kilogramo' || unit === 'kilogramos') return 'kg'
  if (unit === 'mililitro' || unit === 'mililitros') return 'ml'
  if (unit === 'litro' || unit === 'litros') return 'l'
  if (unit === 'pieza' || unit === 'piezas') return 'pz'
  if (unit === 'cucharada' || unit === 'cucharadas') return 'cda'
  if (unit === 'cucharadita' || unit === 'cucharaditas') return 'cdta'
  if (unit === 'gota' || unit === 'go') return 'gotas'
  if (unit === 'tazas') return 'taza'
  if (unit === 'onza' || unit === 'onzas') return 'oz'
  return unit
}

const convertUnits = (amount, source, target) => {
  const qty = Number(amount)
  if (!Number.isFinite(qty)) return null
  const from = normalizeUnit(source)
  const to = normalizeUnit(target)
  if (!from || !to) return null
  if (from === to) return qty

  if (from === 'kg' && to === 'g') return qty * 1000
  if (from === 'g' && to === 'kg') return qty / 1000
  if (from === 'l' && to === 'ml') return qty * 1000
  if (from === 'ml' && to === 'l') return qty / 1000
  if (from === 'gotas' && to === 'ml') return qty / 20
  if (from === 'ml' && to === 'gotas') return qty * 20

  return null
}

const buildCategoryMaps = () => {
  const categorias = readStore('categorias', [])
  const byId = new Map()
  const byName = new Map()
  ;(Array.isArray(categorias) ? categorias : []).forEach((cat) => {
    const id = Number(cat?.id)
    const nombre = normalizeText(cat?.nombre)
    if (Number.isFinite(id) && id > 0) byId.set(id, nombre)
    if (nombre) byName.set(nombre.toLowerCase(), id)
  })
  return { byId, byName }
}

const enrichRecipe = (rawRecipe) => {
  const recipe = rawRecipe && typeof rawRecipe === 'object' ? rawRecipe : {}
  const { byId, byName } = buildCategoryMaps()
  const idCategoria = Number(recipe?.id_categoria)
  const categoriaPayload = normalizeText(recipe?.categoria)
  const categoria =
    categoriaPayload ||
    (Number.isFinite(idCategoria) && idCategoria > 0 ? normalizeText(byId.get(idCategoria)) : '')

  const id_categoria = Number.isFinite(idCategoria) && idCategoria > 0
    ? idCategoria
    : (categoria ? Number(byName.get(categoria.toLowerCase()) || 0) || null : null)

  return {
    ...recipe,
    categoria,
    id_categoria,
    stock: Number(recipe?.stock || 0),
    ingredientes: Array.isArray(recipe?.ingredientes) ? recipe.ingredientes : [],
  }
}

const calculateRecipeMetrics = (recipe, productsList) => {
  const products = Array.isArray(productsList) ? productsList : []
  const supplies = products.filter((item) => item?.productType === 'supply')
  const suppliesById = new Map(supplies.map((item) => [String(item?.id), item]))
  const suppliesByName = new Map(
    supplies.map((item) => [normalizeText(item?.name).toLowerCase(), item]),
  )

  const resolveSupplyFromIngredient = (ing) => {
    const byId = suppliesById.get(String(ing?.id_insumo || ''))
    if (byId) return byId
    const byName = suppliesByName.get(normalizeText(ing?.nombre).toLowerCase())
    if (byName) return byName
    return null
  }

  const ingredients = Array.isArray(recipe?.ingredientes) ? recipe.ingredientes : []
  let totalCost = 0
  let maxPieces = Number.POSITIVE_INFINITY
  const shortages = []

  ingredients.forEach((ing) => {
    const supply = resolveSupplyFromIngredient(ing)
    const requiredQty = Number(ing?.cantidad)
    if (!supply || !Number.isFinite(requiredQty) || requiredQty <= 0) {
      shortages.push({
        id_insumo: ing?.id_insumo,
        nombre: normalizeText(ing?.nombre) || 'Insumo no disponible',
        requerido: Number.isFinite(requiredQty) ? requiredQty : 0,
        disponible: 0,
      })
      maxPieces = 0
      return
    }

    const stockQty = Number(supply?.stock || 0)
    const qtyInSupplyUnit = convertUnits(requiredQty, ing?.unidad, supply?.unit)
    if (!Number.isFinite(qtyInSupplyUnit) || qtyInSupplyUnit <= 0) {
      shortages.push({
        id_insumo: ing?.id_insumo,
        nombre: normalizeText(ing?.nombre) || normalizeText(supply?.name) || 'Insumo sin unidad compatible',
        requerido: requiredQty,
        disponible: stockQty,
      })
      maxPieces = 0
      return
    }

    totalCost += Number(supply?.cost || 0) * qtyInSupplyUnit

    const piecesForSupply = Math.floor(stockQty / qtyInSupplyUnit)
    if (!Number.isFinite(piecesForSupply) || piecesForSupply < 0) {
      maxPieces = 0
    } else {
      maxPieces = Math.min(maxPieces, piecesForSupply)
    }

    if (stockQty < qtyInSupplyUnit) {
      shortages.push({
        id_insumo: ing?.id_insumo,
        nombre: normalizeText(ing?.nombre) || normalizeText(supply?.name),
        requerido: Number(qtyInSupplyUnit.toFixed(4)),
        disponible: Number(stockQty.toFixed(4)),
      })
    }
  })

  if (!Number.isFinite(maxPieces)) maxPieces = 0
  if (ingredients.length === 0) maxPieces = 0

  return {
    totalCost: Number(totalCost.toFixed(4)),
    costPerPiece: Number(totalCost.toFixed(4)),
    maxPieces: Math.max(0, Number(maxPieces) || 0),
    shortages,
  }
}

const syncRecipeProduct = (recipeInput, overrides = {}) => {
  const recipe = enrichRecipe(recipeInput)
  if (!recipe?.id) return
  const createIfMissing = Boolean(overrides?.createIfMissing)

  const products = readStore('products', [])
  const metrics = calculateRecipeMetrics(recipe, products)
  const ingredients = (Array.isArray(recipe?.ingredientes) ? recipe.ingredientes : [])
    .map((ing, idx) => ({
      id: `${recipe.id}-ing-${idx + 1}`,
      supplyProductId: String(ing?.id_insumo || '').trim(),
      quantity: String(Number(ing?.cantidad || 0) || 0),
    }))
    .filter((ing) => ing.supplyProductId && Number(ing.quantity) > 0)

  const current = Array.isArray(products) ? products : []
  const recipeId = `recipe-${recipe.id}`
  const index = current.findIndex((item) => String(item?.id) === recipeId)
  const prev = index >= 0 ? current[index] : {}

  const nextRecipeProduct = {
    id: recipeId,
    code:
      normalizeText(overrides?.code) ||
      normalizeText(prev?.code) ||
      `REC-${String(recipe.id).padStart(4, '0')}`,
    name: normalizeText(recipe?.nombre),
    brand: normalizeText(overrides?.brand) || normalizeText(prev?.brand),
    supplier: normalizeText(overrides?.supplier) || normalizeText(prev?.supplier),
    unit: normalizeText(overrides?.unit) || normalizeText(prev?.unit) || 'pz',
    productType: 'recipe',
    recipeIngredients: ingredients,
    category:
      normalizeText(overrides?.category) ||
      normalizeText(recipe?.categoria) ||
      normalizeText(prev?.category) ||
      'Recetas',
    cost: Number(metrics.costPerPiece || 0),
    price:
      overrides?.price !== undefined
        ? Number(overrides.price || 0)
        : Number(recipe?.tienda_precio_publico || recipe?.precio || prev?.price || 0),
    stock: Number(recipe?.stock || prev?.stock || 0),
    minStock:
      overrides?.minStock !== undefined
        ? Number(overrides.minStock || 0)
        : Number(prev?.minStock || 0),
    locationArea: normalizeText(prev?.locationArea),
    locationBin: normalizeText(prev?.locationBin),
    imageUrl: normalizeText(recipe?.tienda_image_url || prev?.imageUrl),
  }

  if (index >= 0 || createIfMissing) {
    const updatedProducts = [...current]
    if (index >= 0) updatedProducts[index] = { ...prev, ...nextRecipeProduct }
    else updatedProducts.unshift(nextRecipeProduct)
    writeStore('products', updatedProducts)
  }

  const recetas = readStore('recetas', [])
  const recIdx = recetas.findIndex((item) => Number(item?.id) === Number(recipe.id))
  if (recIdx >= 0) {
    const updatedRecetas = [...recetas]
    updatedRecetas[recIdx] = {
      ...updatedRecetas[recIdx],
      categoria: recipe.categoria,
      id_categoria: recipe.id_categoria,
      stock: Number(recipe?.stock || 0),
      costo_total: Number(metrics.totalCost || 0),
    }
    writeStore('recetas', updatedRecetas)
  }
}

const removeRecipeProduct = (recipeId) => {
  const products = readStore('products', [])
  const normalizedId = `recipe-${recipeId}`
  writeStore(
    'products',
    (Array.isArray(products) ? products : []).filter((item) => String(item?.id) !== normalizedId),
  )
}

const produceRecipeUnits = ({ idReceta, nombreReceta, cantidad }) => {
  const qty = Math.max(1, Math.floor(Number(cantidad) || 0))
  const recetas = readStore('recetas', [])
  const receta = (Array.isArray(recetas) ? recetas : []).find((item) => {
    if (Number(item?.id) === Number(idReceta)) return true
    if (nombreReceta && normalizeText(item?.nombre).toLowerCase() === normalizeText(nombreReceta).toLowerCase()) return true
    return false
  })
  if (!receta) {
    return { ok: false, error: 'Receta no encontrada' }
  }

  const products = readStore('products', [])
  const supplies = (Array.isArray(products) ? products : []).filter(
    (item) => item?.productType === 'supply',
  )
  const suppliesById = new Map(supplies.map((item) => [String(item?.id), item]))
  const suppliesByName = new Map(
    supplies.map((item) => [normalizeText(item?.name).toLowerCase(), item]),
  )

  const resolveSupplyFromIngredient = (ing) => {
    const byId = suppliesById.get(String(ing?.id_insumo || ''))
    if (byId) return byId
    const byName = suppliesByName.get(normalizeText(ing?.nombre).toLowerCase())
    if (byName) return byName
    return null
  }

  const requirements = []
  const ingredientes = Array.isArray(receta?.ingredientes) ? receta.ingredientes : []
  if (ingredientes.length === 0) {
    return { ok: false, error: 'La receta no tiene insumos configurados' }
  }
  for (const ing of ingredientes) {
    const supply = resolveSupplyFromIngredient(ing)
    const reqBase = Number(ing?.cantidad || 0)
    if (!supply || !Number.isFinite(reqBase) || reqBase <= 0) {
      return { ok: false, error: `Insumo inválido en receta: ${normalizeText(ing?.nombre) || 'desconocido'}` }
    }
    const reqSupplyUnit = convertUnits(reqBase * qty, ing?.unidad, supply?.unit)
    if (!Number.isFinite(reqSupplyUnit) || reqSupplyUnit <= 0) {
      return { ok: false, error: `Unidad incompatible para insumo: ${normalizeText(supply?.name)}` }
    }
    const available = Number(supply?.stock || 0)
    if (available < reqSupplyUnit) {
      return {
        ok: false,
        error: `Stock insuficiente en ${normalizeText(supply?.name)} (requiere ${reqSupplyUnit.toFixed(2)}, disponible ${available.toFixed(2)})`,
      }
    }
    requirements.push({ supplyId: String(supply.id), required: reqSupplyUnit })
  }

  const updatedProducts = (Array.isArray(products) ? [...products] : []).map((product) => {
    const req = requirements.find((item) => String(item.supplyId) === String(product?.id))
    if (req) {
      return {
        ...product,
        stock: Number((Number(product?.stock || 0) - req.required).toFixed(4)),
      }
    }
    if (String(product?.id) === `recipe-${receta.id}`) {
      return {
        ...product,
        stock: Number((Number(product?.stock || 0) + qty).toFixed(4)),
      }
    }
    return product
  })
  writeStore('products', updatedProducts)

  const updatedRecetas = recetas.map((item) =>
    Number(item?.id) === Number(receta.id)
      ? {
          ...item,
          stock: Number((Number(item?.stock || 0) + qty).toFixed(4)),
          actualizado_en: new Date().toISOString(),
        }
      : item,
  )
  writeStore('recetas', updatedRecetas)

  const recetaActualizada = updatedRecetas.find((item) => Number(item?.id) === Number(receta.id))
  if (recetaActualizada) syncRecipeProduct(recetaActualizada)

  return {
    ok: true,
    receta: recetaActualizada || receta,
    cantidad: qty,
  }
}

const revertRecipeUnits = ({ idReceta, nombreReceta, cantidad }) => {
  const qty = Math.max(1, Math.floor(Number(cantidad) || 0))
  const recetas = readStore('recetas', [])
  const receta = (Array.isArray(recetas) ? recetas : []).find((item) => {
    if (Number(item?.id) === Number(idReceta)) return true
    if (nombreReceta && normalizeText(item?.nombre).toLowerCase() === normalizeText(nombreReceta).toLowerCase()) return true
    return false
  })
  if (!receta) {
    return { ok: false, error: 'Receta no encontrada' }
  }

  const recipeStock = Number(receta?.stock || 0)
  if (recipeStock < qty) {
    return {
      ok: false,
      error: `No hay suficientes piezas para revertir (${qty}). Stock actual: ${recipeStock}`,
    }
  }

  const products = readStore('products', [])
  const supplies = (Array.isArray(products) ? products : []).filter(
    (item) => item?.productType === 'supply',
  )
  const suppliesById = new Map(supplies.map((item) => [String(item?.id), item]))
  const suppliesByName = new Map(
    supplies.map((item) => [normalizeText(item?.name).toLowerCase(), item]),
  )

  const resolveSupplyFromIngredient = (ing) => {
    const byId = suppliesById.get(String(ing?.id_insumo || ''))
    if (byId) return byId
    const byName = suppliesByName.get(normalizeText(ing?.nombre).toLowerCase())
    if (byName) return byName
    return null
  }

  const returns = []
  const ingredientes = Array.isArray(receta?.ingredientes) ? receta.ingredientes : []
  if (ingredientes.length === 0) {
    return { ok: false, error: 'La receta no tiene insumos configurados' }
  }
  for (const ing of ingredientes) {
    const supply = resolveSupplyFromIngredient(ing)
    const reqBase = Number(ing?.cantidad || 0)
    if (!supply || !Number.isFinite(reqBase) || reqBase <= 0) {
      return { ok: false, error: `Insumo inválido en receta: ${normalizeText(ing?.nombre) || 'desconocido'}` }
    }
    const returnSupplyUnit = convertUnits(reqBase * qty, ing?.unidad, supply?.unit)
    if (!Number.isFinite(returnSupplyUnit) || returnSupplyUnit <= 0) {
      return { ok: false, error: `Unidad incompatible para insumo: ${normalizeText(supply?.name)}` }
    }
    returns.push({ supplyId: String(supply.id), amount: returnSupplyUnit })
  }

  const updatedProducts = (Array.isArray(products) ? [...products] : []).map((product) => {
    const restock = returns.find((item) => String(item.supplyId) === String(product?.id))
    if (restock) {
      return {
        ...product,
        stock: Number((Number(product?.stock || 0) + restock.amount).toFixed(4)),
      }
    }
    if (String(product?.id) === `recipe-${receta.id}`) {
      return {
        ...product,
        stock: Number((Math.max(0, Number(product?.stock || 0) - qty)).toFixed(4)),
      }
    }
    return product
  })
  writeStore('products', updatedProducts)

  const updatedRecetas = recetas.map((item) =>
    Number(item?.id) === Number(receta.id)
      ? {
          ...item,
          stock: Number((Math.max(0, Number(item?.stock || 0) - qty)).toFixed(4)),
          actualizado_en: new Date().toISOString(),
        }
      : item,
  )
  writeStore('recetas', updatedRecetas)

  const recetaActualizada = updatedRecetas.find((item) => Number(item?.id) === Number(receta.id))
  if (recetaActualizada) syncRecipeProduct(recetaActualizada)

  return {
    ok: true,
    receta: recetaActualizada || receta,
    cantidad: qty,
  }
}

// ---- CHIPACTLI recipes compatibility routes ----
app.get('/categorias', (_req, res) => {
  const categorias = readStore('categorias', [])
  res.json(Array.isArray(categorias) ? categorias : [])
})

app.post('/categorias', (req, res) => {
  const nombre = normalizeText(req.body?.nombre)
  if (!nombre) {
    res.status(400).json({ error: 'Nombre requerido' })
    return
  }

  const categorias = readStore('categorias', [])
  const exists = categorias.some((item) => normalizeText(item?.nombre).toLowerCase() === nombre.toLowerCase())
  if (exists) {
    res.status(409).json({ error: 'Categoría ya existe' })
    return
  }

  const created = { id: nextId(categorias), nombre }
  const updated = [...categorias, created]
  writeStore('categorias', updated)
  res.status(201).json(created)
})

app.patch('/categorias/:id', (req, res) => {
  const id = Number(req.params.id)
  const nombre = normalizeText(req.body?.nombre)
  if (!Number.isFinite(id) || id <= 0 || !nombre) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const categorias = readStore('categorias', [])
  const updated = categorias.map((item) => (Number(item?.id) === id ? { ...item, nombre } : item))
  writeStore('categorias', updated)
  res.json({ ok: true })
})

app.delete('/categorias/:id', (req, res) => {
  const id = Number(req.params.id)
  const categorias = readStore('categorias', [])
  const updated = categorias.filter((item) => Number(item?.id) !== id)
  writeStore('categorias', updated)
  res.json({ ok: true })
})

app.get('/recetas', (req, res) => {
  const recetas = readStore('recetas', [])
  const categoria = normalizeText(req.query?.categoria)
  const archivadaRaw = req.query?.archivada ?? req.query?.archivadas
  const q = normalizeText(req.query?.q).toLowerCase()

  let list = (Array.isArray(recetas) ? recetas : []).map(enrichRecipe)
  if (categoria) {
    const categoriaId = Number(categoria)
    if (Number.isFinite(categoriaId) && categoriaId > 0) {
      list = list.filter((item) => Number(item?.id_categoria) === categoriaId)
    } else {
      list = list.filter((item) => normalizeText(item?.categoria).toLowerCase() === categoria.toLowerCase())
    }
  }
  if (archivadaRaw === '0' || archivadaRaw === '1') {
    const archivada = archivadaRaw === '1'
    list = list.filter((item) => Boolean(item?.archivada) === archivada)
  }
  if (q) {
    list = list.filter((item) => `${item?.nombre || ''} ${item?.categoria || ''}`.toLowerCase().includes(q))
  }

  res.json(list)
})

app.get('/recetas/:id', (req, res) => {
  const id = Number(req.params.id)
  const recetas = readStore('recetas', [])
  const receta = recetas.find((item) => Number(item?.id) === id)
  if (!receta) {
    res.status(404).json({ error: 'Receta no encontrada' })
    return
  }
  res.json(enrichRecipe(receta))
})

app.post('/recetas', (req, res) => {
  const recetas = readStore('recetas', [])
  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  const categoryMaps = buildCategoryMaps()
  const idCategoria = Number(payload.id_categoria)
  const categoria =
    normalizeText(payload.categoria) ||
    (Number.isFinite(idCategoria) && idCategoria > 0 ? normalizeText(categoryMaps.byId.get(idCategoria)) : '')
  const created = {
    ...payload,
    id: nextId(recetas),
    nombre: normalizeText(payload.nombre),
    id_categoria: Number.isFinite(idCategoria) && idCategoria > 0 ? idCategoria : null,
    categoria,
    stock: Number(payload.stock || 0),
    archivada: Boolean(payload.archivada),
    creado_en: new Date().toISOString(),
  }
  const updated = [created, ...recetas]
  writeStore('recetas', updated)
  syncRecipeProduct(created)
  res.status(201).json(enrichRecipe(created))
})

app.patch('/recetas/:id', (req, res) => {
  const id = Number(req.params.id)
  const recetas = readStore('recetas', [])
  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  const categoryMaps = buildCategoryMaps()
  const updated = recetas.map((item) =>
    Number(item?.id) === id
      ? {
          ...item,
          ...payload,
          nombre: payload.nombre !== undefined ? normalizeText(payload.nombre) : item.nombre,
          id_categoria:
            payload.id_categoria !== undefined
              ? (Number(payload.id_categoria) > 0 ? Number(payload.id_categoria) : null)
              : (Number(item?.id_categoria) > 0 ? Number(item.id_categoria) : null),
          categoria:
            payload.categoria !== undefined
              ? normalizeText(payload.categoria)
              : (payload.id_categoria !== undefined
                  ? normalizeText(categoryMaps.byId.get(Number(payload.id_categoria))) || normalizeText(item?.categoria)
                  : normalizeText(item?.categoria)),
          stock: payload.stock !== undefined ? Number(payload.stock || 0) : Number(item?.stock || 0),
          actualizado_en: new Date().toISOString(),
        }
      : item,
  )
  writeStore('recetas', updated)
  const receta = updated.find((item) => Number(item?.id) === id)
  if (receta) syncRecipeProduct(receta)
  res.json(receta ? enrichRecipe(receta) : { ok: true })
})

app.post('/recetas/:id/registrar-inventario', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'ID de receta inválido' })
    return
  }

  const recetas = readStore('recetas', [])
  const receta = recetas.find((item) => Number(item?.id) === id)
  if (!receta) {
    res.status(404).json({ error: 'Receta no encontrada' })
    return
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  const overrides = {
    code: normalizeText(payload.code),
    category: normalizeText(payload.category),
    price: payload.price,
    minStock: payload.minStock,
    supplier: normalizeText(payload.supplier),
    brand: normalizeText(payload.brand),
    unit: normalizeText(payload.unit),
    createIfMissing: true,
  }

  syncRecipeProduct(receta, overrides)
  const products = readStore('products', [])
  const product = (Array.isArray(products) ? products : []).find(
    (item) => String(item?.id) === `recipe-${id}`,
  )
  res.json({ ok: true, product: product || null })
})

app.patch('/recetas/:id/ficha-tienda', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'ID de receta inválido' })
    return
  }

  const recetas = readStore('recetas', [])
  const idx = recetas.findIndex((item) => Number(item?.id) === id)
  if (idx < 0) {
    res.status(404).json({ error: 'Receta no encontrada' })
    return
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  const current = recetas[idx] || {}
  const next = {
    ...current,
    tienda_image_url:
      payload.tienda_image_url !== undefined
        ? normalizeText(payload.tienda_image_url)
        : normalizeText(current.tienda_image_url),
    tienda_galeria: Array.isArray(payload.tienda_galeria)
      ? payload.tienda_galeria.map((item) => normalizeText(item)).filter(Boolean)
      : Array.isArray(current.tienda_galeria)
        ? current.tienda_galeria
        : [],
    tienda_descripcion:
      payload.tienda_descripcion !== undefined
        ? String(payload.tienda_descripcion || '')
        : String(current.tienda_descripcion || ''),
    tienda_precio_publico:
      payload.tienda_precio_publico !== undefined
        ? Number(payload.tienda_precio_publico) || 0
        : Number(current.tienda_precio_publico) || 0,
    tienda_modo_uso:
      payload.tienda_modo_uso !== undefined
        ? String(payload.tienda_modo_uso || '')
        : String(current.tienda_modo_uso || ''),
    tienda_cuidados:
      payload.tienda_cuidados !== undefined
        ? String(payload.tienda_cuidados || '')
        : String(current.tienda_cuidados || ''),
    tienda_ingredientes:
      payload.tienda_ingredientes !== undefined
        ? String(payload.tienda_ingredientes || '')
        : String(current.tienda_ingredientes || ''),
    actualizado_en: new Date().toISOString(),
  }

  const updated = [...recetas]
  updated[idx] = next
  writeStore('recetas', updated)
  syncRecipeProduct(next)
  res.json(enrichRecipe(next))
})

app.delete('/recetas/:id', (req, res) => {
  const id = Number(req.params.id)
  const recetas = readStore('recetas', [])
  const updated = recetas.filter((item) => Number(item?.id) !== id)
  writeStore('recetas', updated)
  removeRecipeProduct(id)
  res.json({ ok: true })
})

app.post('/recetas/archivar', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => Number(id)) : []
  const idSet = new Set(ids)
  const recetas = readStore('recetas', [])
  const updated = recetas.map((item) =>
    idSet.has(Number(item?.id)) ? { ...item, archivada: true, actualizado_en: new Date().toISOString() } : item,
  )
  writeStore('recetas', updated)
  res.json({ ok: true, total: ids.length })
})

app.post('/recetas/desarchivar', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => Number(id)) : []
  const idSet = new Set(ids)
  const recetas = readStore('recetas', [])
  const updated = recetas.map((item) =>
    idSet.has(Number(item?.id)) ? { ...item, archivada: false, actualizado_en: new Date().toISOString() } : item,
  )
  writeStore('recetas', updated)
  res.json({ ok: true, total: ids.length })
})

app.post('/recetas/calcular', (req, res) => {
  const idReceta = Number(req.body?.id_receta)
  const recetas = readStore('recetas', [])
  const receta = recetas.find((item) => Number(item?.id) === idReceta)
  const products = readStore('products', [])
  const metrics = calculateRecipeMetrics(receta || {}, products)
  res.json({
    id_receta: idReceta,
    costo_total: Number(metrics.totalCost.toFixed(2)),
    costo_por_pieza: Number(metrics.costPerPiece.toFixed(2)),
    piezas_maximas: Number(metrics.maxPieces),
    capacidad_estimada: Number(metrics.maxPieces),
    insumos_faltantes: metrics.shortages,
  })
})

app.get('/inventario', (req, res) => {
  const busqueda = normalizeText(req.query?.busqueda).toLowerCase()
  const products = readStore('products', [])
  const inventory = (Array.isArray(products) ? products : [])
    .filter((item) => item?.productType === 'supply')
    .filter((item) => {
      if (!busqueda) return true
      const text = `${item?.name || ''} ${item?.code || ''} ${item?.supplier || ''}`.toLowerCase()
      return text.includes(busqueda)
    })
    .map((item) => ({
      id: Number(item?.id) || item?.id,
      codigo: item?.code || '',
      nombre: item?.name || '',
      proveedor: item?.supplier || '',
      unidad: item?.unit || '',
      cantidad_total: Number(item?.stock || 0),
      cantidad_disponible: Number(item?.stock || 0),
      costo_total: Number((Number(item?.cost || 0) * Number(item?.stock || 0)).toFixed(2)),
      costo_por_unidad: Number(item?.cost || 0),
      pendiente: Boolean(item?.pending),
    }))
  res.json(inventory)
})

app.post('/inventario/agregar', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const name = normalizeText(body.nombre)
  if (!name) {
    res.status(400).json({ error: 'Nombre requerido' })
    return
  }

  const products = readStore('products', [])
  const code = normalizeText(body.codigo) || `PEND-${Date.now().toString(36).toUpperCase()}`
  const qty = Number(body.cantidad ?? 0)
  const totalCost = Number(body.costo ?? 0)
  const unitCost = qty > 0 ? totalCost / qty : 0

  const created = {
    id: Date.now(),
    code,
    name,
    brand: '',
    supplier: normalizeText(body.proveedor),
    unit: normalizeText(body.unidad),
    productType: 'supply',
    category: 'General',
    cost: Number(unitCost.toFixed(4)),
    price: Number(unitCost.toFixed(4)),
    stock: Number(qty.toFixed(2)),
    minStock: 5,
    locationArea: '',
    locationBin: '',
    imageUrl: '',
    pending: Boolean(body.pendiente),
  }

  writeStore('products', [created, ...products])
  res.status(201).json(created)
})

app.get('/tienda/admin/productos', (_req, res) => {
  const recetas = readStore('recetas', [])
  const catalog = readStore('tiendaCatalog', [])
  const byName = new Map(
    (Array.isArray(catalog) ? catalog : []).map((item) => [normalizeText(item?.nombre_receta).toLowerCase(), item]),
  )

  const products = (Array.isArray(recetas) ? recetas : []).map((receta) => {
    const nombreReceta = normalizeText(receta?.nombre)
    const fromCatalog = byName.get(nombreReceta.toLowerCase()) || {}
    const ingredientes = Array.isArray(receta?.ingredientes)
      ? receta.ingredientes.map((ing) => normalizeText(ing?.nombre)).filter(Boolean)
      : []

    return {
      id: fromCatalog?.id || Number(receta?.id) || nextId(catalog),
      nombre_receta: nombreReceta,
      categoria_nombre: normalizeText(receta?.categoria),
      tipo_producto: 'receta',
      visible_publico: Boolean(fromCatalog?.activo ?? fromCatalog?.visible_publico),
      activo: Boolean(fromCatalog?.activo ?? fromCatalog?.visible_publico),
      image_url: normalizeText(receta?.tienda_image_url || fromCatalog?.image_url),
      descripcion: String(receta?.tienda_descripcion || fromCatalog?.descripcion || ''),
      ingredientes,
      precio_venta: Number(receta?.precio || 0),
      precio_original: Number(receta?.tienda_precio_publico || receta?.precio || 0),
      variantes: [],
    }
  })

  res.json(products)
})

app.post('/tienda/catalogo/upsert', (req, res) => {
  const recetaNombre = normalizeText(req.body?.receta_nombre)
  if (!recetaNombre) {
    res.status(400).json({ error: 'receta_nombre requerido' })
    return
  }

  const catalog = readStore('tiendaCatalog', [])
  const idx = catalog.findIndex(
    (item) => normalizeText(item?.nombre_receta).toLowerCase() === recetaNombre.toLowerCase(),
  )
  const nextItem = {
    id: idx >= 0 ? catalog[idx].id : nextId(catalog),
    nombre_receta: recetaNombre,
    visible_publico: Boolean(req.body?.activo ?? req.body?.visible_publico),
    activo: Boolean(req.body?.activo),
    image_url: normalizeText(req.body?.image_url),
    descripcion: String(req.body?.descripcion || ''),
    tipo_producto: normalizeText(req.body?.tipo_producto) || 'receta',
  }
  const updated = [...catalog]
  if (idx >= 0) updated[idx] = { ...updated[idx], ...nextItem }
  else updated.push(nextItem)
  writeStore('tiendaCatalog', updated)
  res.json(nextItem)
})

app.post('/api/uploads/tienda-imagen', upload.single('imagen'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No se recibió imagen' })
    return
  }

  const host = req.get('host') || `localhost:${process.env.PORT || 8787}`
  const protocol = req.protocol || 'http'
  const url = `${protocol}://${host}/uploads/${req.file.filename}`
  res.status(201).json({ url })
})

app.get('/tienda/admin/paquetes', (_req, res) => {
  const packages = readStore('tiendaPackages', [])
  res.json(Array.isArray(packages) ? packages : [])
})

app.post('/tienda/admin/paquetes', (req, res) => {
  const packages = readStore('tiendaPackages', [])
  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  const created = {
    ...payload,
    id: nextId(packages),
    nombre: normalizeText(payload.nombre) || `Paquete ${nextId(packages)}`,
  }
  const updated = [created, ...packages]
  writeStore('tiendaPackages', updated)
  res.status(201).json(created)
})

app.get('/tienda/admin/paquetes/:id', (req, res) => {
  const id = Number(req.params.id)
  const packages = readStore('tiendaPackages', [])
  const item = packages.find((pkg) => Number(pkg?.id) === id)
  if (!item) {
    res.status(404).json({ error: 'Paquete no encontrado' })
    return
  }
  res.json(item)
})

app.patch('/tienda/admin/paquetes/:id', (req, res) => {
  const id = Number(req.params.id)
  const packages = readStore('tiendaPackages', [])
  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  const updated = packages.map((item) => (Number(item?.id) === id ? { ...item, ...payload } : item))
  writeStore('tiendaPackages', updated)
  res.json(updated.find((item) => Number(item?.id) === id) || { ok: true })
})

app.delete('/tienda/admin/paquetes/:id', (req, res) => {
  const id = Number(req.params.id)
  const packages = readStore('tiendaPackages', [])
  writeStore(
    'tiendaPackages',
    packages.filter((item) => Number(item?.id) !== id),
  )
  res.json({ ok: true })
})

app.get('/api/recetas/ajustes-produccion', (_req, res) => {
  const settings = readStore('ajustesProduccion', {
    factor_costo_produccion: 1.15,
    factor_precio_venta: 1.4,
  })
  res.json(settings)
})

app.put('/api/recetas/ajustes-produccion', (req, res) => {
  const payload = {
    factor_costo_produccion: Number(req.body?.factor_costo_produccion) || 1.15,
    factor_precio_venta: Number(req.body?.factor_precio_venta) || 1.4,
  }
  writeStore('ajustesProduccion', payload)
  res.json(payload)
})

app.post('/produccion', (_req, res) => {
  const body = _req.body && typeof _req.body === 'object' ? _req.body : {}
  const result = produceRecipeUnits({
    idReceta: body.id_receta,
    nombreReceta: body.nombre_receta,
    cantidad: body.cantidad,
  })

  if (!result.ok) {
    res.status(400).json({ error: result.error || 'No se pudo registrar producción' })
    return
  }

  res.json({
    ok: true,
    id_receta: Number(result.receta?.id),
    nombre_receta: normalizeText(result.receta?.nombre),
    cantidad: result.cantidad,
    stock_receta: Number(result.receta?.stock || 0),
  })
})

app.post('/produccion/revertir', (_req, res) => {
  const body = _req.body && typeof _req.body === 'object' ? _req.body : {}
  const result = revertRecipeUnits({
    idReceta: body.id_receta,
    nombreReceta: body.nombre_receta,
    cantidad: body.cantidad,
  })

  if (!result.ok) {
    res.status(400).json({ error: result.error || 'No se pudo revertir producción' })
    return
  }

  res.json({
    ok: true,
    id_receta: Number(result.receta?.id),
    nombre_receta: normalizeText(result.receta?.nombre),
    cantidad: result.cantidad,
    stock_receta: Number(result.receta?.stock || 0),
  })
})

app.post('/produccion/paquete', (_req, res) => {
  const body = _req.body && typeof _req.body === 'object' ? _req.body : {}
  const cantidadPaquetes = Math.max(1, Math.floor(Number(body.cantidad_paquetes) || 0))
  const items = Array.isArray(body.items) ? body.items : []

  if (!items.length) {
    res.status(400).json({ error: 'El paquete no contiene recetas' })
    return
  }

  let totalProducciones = 0
  let totalPiezas = 0
  for (const item of items) {
    const recetaNombre = normalizeText(item?.receta_nombre)
    const piezasPorPaquete = Math.max(1, Math.floor(Number(item?.cantidad) || 0))
    const piezasTotales = piezasPorPaquete * cantidadPaquetes

    const result = produceRecipeUnits({
      idReceta: null,
      nombreReceta: recetaNombre,
      cantidad: piezasTotales,
    })
    if (!result.ok) {
      res.status(400).json({ error: result.error || `No se pudo producir receta ${recetaNombre}` })
      return
    }
    totalProducciones += 1
    totalPiezas += piezasTotales
  }

  res.json({
    ok: true,
    total_producciones: totalProducciones,
    total_piezas: totalPiezas,
  })
})

app.get('/api/health', (_req, res) => {
  const dbFiles = Object.fromEntries(
    Object.entries(stores).map(([key, store]) => [key, store.dbPath]),
  )
  res.json({ ok: true, dbFiles })
})

app.get('/api/state', (_req, res) => {
  const state = {}
  let latestUpdate = null

  for (const [key, store] of Object.entries(stores)) {
    const row = store.readStmt.get()
    if (!row) continue

    try {
      state[key] = JSON.parse(row.json_data)
      if (!latestUpdate || row.updated_at > latestUpdate) {
        latestUpdate = row.updated_at
      }
    } catch {
      state[key] = null
    }
  }

  res.json({
    state: Object.keys(state).length > 0 ? state : null,
    updatedAt: latestUpdate,
  })
})

app.put('/api/state', (req, res) => {
  const payload = req.body
  if (!payload || typeof payload !== 'object' || typeof payload.state !== 'object') {
    res.status(400).json({ error: 'Payload invalido. Se esperaba { state: {...} }.' })
    return
  }

  const updatedAt = new Date().toISOString()

  for (const [key, value] of Object.entries(payload.state)) {
    const store = stores[key]
    if (!store) continue

    store.upsertStmt.run({
      json_data: JSON.stringify(value),
      updated_at: updatedAt,
    })
  }

  res.json({ ok: true, updatedAt })
})

const port = Number(process.env.PORT || 8787)
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`POS backend escuchando en http://localhost:${port}`)
})
