# Sistema Punto de Venta

Proyecto separado por carpetas:

- `frontend/`: app React + Vite.
- `backend/`: API Express + SQLite.

## Instalacion

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

## Comandos principales (desde la raiz)

```bash
npm run dev
npm run server
npm run dev:full
npm run build
```

## Base de datos

El backend usa SQLite en `backend/data/` con bases separadas por modulo:

- `users.sqlite`
- `products.sqlite`
- `sales.sqlite`
- `cuts.sqlite`
- `cashBox.sqlite`
- `suppliers.sqlite`
- `purchaseOrders.sqlite`
- `ticketSettings.sqlite`
