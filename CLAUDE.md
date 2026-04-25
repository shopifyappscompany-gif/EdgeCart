# EdgeCart — Project Memory for Claude

## What This App Is
A **public Shopify App Store app** called **EdgeCart** that adds a slide-in side cart drawer to any Shopify store. Merchants enable it via App Embeds in their theme customizer. All settings are controlled from the Shopify admin (embedded app).

**Owner:** shopifyappscompany@gmail.com  
**Shopify Org:** SwiftCartUpsell  
**App name:** EdgeCart  
**Client ID:** `b5830ef0857b056c23608b0df3eedfca`  
**Dev store:** swiftcartupsell.myshopify.com  
**Project path:** `/Users/apple/edge-cart`

---

## Tech Stack
| Layer | Tech |
|---|---|
| Framework | React Router v7 (Remix-style) |
| Shopify SDK | `@shopify/shopify-app-react-router` v1.1.x |
| UI | Shopify Polaris Web Components (`s-page`, `s-section`, `s-button`, etc.) |
| Database | SQLite via Prisma (file: `prisma/dev.sqlite`) |
| Session storage | `@shopify/shopify-app-session-storage-prisma` |
| Theme extension | Theme App Extension (app embed block) |
| Storefront cart | Shopify AJAX Cart API (`/cart.js`, `/cart/add.js`, etc.) |

---

## App Distribution
- `distribution: AppDistribution.AppStore` in `app/shopify.server.js`
- This means **full OAuth** is handled automatically by the framework
- Merchants install via Shopify App Store or direct install link

---

## Running the App
```bash
cd /Users/apple/edge-cart
shopify app dev        # starts dev with tunnel + hot reload
```
- Creates `.env` automatically with `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`
- Tunnel URL changes every session (Cloudflare tunnel, e.g. `https://xxx.trycloudflare.com`)
- App runs on `http://localhost:PORT` locally

---

## Key Files

### Backend / App Routes
| File | Route | Purpose |
|---|---|---|
| `app/shopify.server.js` | — | Shopify app config, OAuth, session storage |
| `app/db.server.js` | — | Prisma client singleton |
| `app/routes/app.jsx` | `/app` | Layout with nav (Dashboard, General Settings, Upsell, Freebie) |
| `app/routes/app._index.jsx` | `/app` | Dashboard — status badges + how-to-activate guide |
| `app/routes/app.settings.jsx` | `/app/settings` | General settings: banner, colors, header text, discount toggle |
| `app/routes/app.upsell.jsx` | `/app/upsell` | Upsell: enable, trigger type, product picker (up to 5 products) |
| `app/routes/app.freebie.jsx` | `/app/freebie` | Freebie: enable, trigger, create $0 copy product via Admin GraphQL |
| `app/routes/api.cart-settings.jsx` | `/api/cart-settings` | **Public App Proxy endpoint** — returns per-shop settings JSON to storefront JS |
| `app/routes/_index/route.jsx` | `/` | Landing page with EdgeCart branding + install form |
| `app/routes/auth.$.jsx` | `/auth/*` | OAuth handler (auto, from framework) |
| `app/routes/auth.login/route.jsx` | `/auth/login` | Manual login page |
| `app/routes/webhooks.app.uninstalled.jsx` | `/webhooks/app/uninstalled` | Deletes sessions + CartSettings on uninstall |
| `app/routes/webhooks.app.scopes_update.jsx` | `/webhooks/app/scopes_update` | Handles scope changes |
| `app/routes/webhooks.customers.data_request.jsx` | `/webhooks/customers/data_request` | GDPR — customer data request |
| `app/routes/webhooks.customers.redact.jsx` | `/webhooks/customers/redact` | GDPR — erase customer data |
| `app/routes/webhooks.shop.redact.jsx` | `/webhooks/shop/redact` | GDPR — erase all shop data |

### Theme Extension
| File | Purpose |
|---|---|
| `extensions/edge-cart/shopify.extension.toml` | Extension config (type: theme, uid preserved) |
| `extensions/edge-cart/blocks/side-cart.liquid` | App embed block — target: body, toggled in Theme Customizer > App Embeds |
| `extensions/edge-cart/assets/edge-cart.js` | Complete side cart JS engine (vanilla JS, no deps) |
| `extensions/edge-cart/assets/edge-cart.css` | Full side cart styles — slide-in drawer, all states |
| `extensions/edge-cart/locales/en.default.json` | Extension locales |

### Config Files
| File | Purpose |
|---|---|
| `shopify.app.toml` | App config — scopes: `read_products,write_products`, app proxy: `/apps/edge-cart` |
| `prisma/schema.prisma` | DB schema — `Session` + `CartSettings` models |
| `.shopify/dev-bundle/manifest.json` | CLI dev bundle cache (auto-updated by CLI each run) |
| `.shopify/project.json` | Links app to dev store `swiftcartupsell.myshopify.com` |

---

## Database Schema — CartSettings

```prisma
model CartSettings {
  id    String @id @default(cuid())
  shop  String @unique          // e.g. "swiftcartupsell.myshopify.com"

  // General
  enabled      Boolean @default(true)
  headerText   String  @default("Your Cart")
  primaryColor String  @default("#000000")   // checkout button + accents

  // Banner (shown at top of side cart)
  bannerEnabled   Boolean @default(true)
  bannerText      String  @default("🎉 Free shipping on orders over $50!")
  bannerBgColor   String  @default("#1a1a1a")
  bannerTextColor String  @default("#ffffff")

  // Discount code field
  discountEnabled Boolean @default(true)      // applied to checkout URL

  // Upsell
  upsellEnabled           Boolean @default(false)
  upsellTitle             String  @default("You might also like")
  upsellTriggerType       String  @default("cartValue")  // cartValue | quantity | product
  upsellMinCartValue      Float   @default(50)
  upsellMinQuantity       Int     @default(2)
  upsellProducts          String  @default("[]")          // JSON array of full product objects
  upsellTriggerProductIds String  @default("[]")          // JSON array of product GIDs

  // Freebie
  freebieEnabled           Boolean @default(false)
  freebieTitle             String  @default("🎁 You've earned a free gift!")
  freebieTriggerType       String  @default("cartValue")  // cartValue | quantity | product
  freebieMinCartValue      Float   @default(100)
  freebieMinQuantity       Int     @default(3)
  freebieProductVariantId  String?   // GID of the $0 freebie variant
  freebieProductTitle      String?
  freebieProductImageUrl   String?
  freebieTriggerProductIds String  @default("[]")
}
```

After schema changes: run `npx prisma migrate dev --name <desc>` then `npx prisma generate`

---

## How the Side Cart Works (End-to-End)

1. Merchant installs app → OAuth handled by framework → session stored in SQLite
2. Merchant configures settings in app admin (Polaris UI) → saved to `CartSettings` in SQLite
3. Merchant goes to **Themes → Customize → App embeds** → toggles on **EdgeCart SideCart** → Save
4. Storefront loads the `side-cart.liquid` block (target: body) which:
   - Injects `window.EdgeCartProxy = "/apps/edge-cart"` and `window.EdgeCartShop`
   - Loads `edge-cart.js` and `edge-cart.css` from extension assets
5. `edge-cart.js` boots:
   - Calls `/apps/edge-cart/api/cart-settings` (Shopify App Proxy → our server at `/api/cart-settings`)
   - Server reads `CartSettings` for that shop from SQLite, returns JSON
   - JS builds the side cart DOM
   - Intercepts `<form action="/cart/add">` submit events
   - Intercepts clicks on cart icon links (`a[href="/cart"]`, `.cart-icon`, etc.)
6. Customer adds product → side cart opens with:
   - Banner (if enabled)
   - Line items with qty controls + remove
   - Freebie progress bar → unlocks "Add Free Gift" button
   - Upsell products (filtered to exclude already-in-cart items)
   - Discount code field (appended to checkout URL as `?discount=CODE`)
   - Checkout button → `/checkout` or `/checkout?discount=CODE`

---

## App Proxy
- Shopify route: `swiftcartupsell.myshopify.com/apps/edge-cart/*`
- Routes to: `our-app-url/api/cart-settings` (the `*` path is passed through)
- Configured in `shopify.app.toml` under `[app_proxy]`
- Route handler: `app/routes/api.cart-settings.jsx` uses `authenticate.public.appProxy`
- Returns settings JSON with CORS headers

---

## Valid Shopify Scopes (for this app)
```
read_products,write_products
```
**DO NOT add:** `read_metafields`, `write_metafields` — these are **not valid Shopify scopes** and cause CLI errors.  
Metafield access is automatically included in product/resource scopes.

---

## GDPR Webhooks (Mandatory for App Store)
Route handlers exist in the codebase but are **NOT in `shopify.app.toml`** (CLI rejects them).  
Register manually in **Shopify Partner Dashboard → Apps → EdgeCart → App setup → GDPR webhooks**:

| Webhook | URL |
|---|---|
| Customer data request | `https://YOUR_APP_URL/webhooks/customers/data_request` |
| Customer redact | `https://YOUR_APP_URL/webhooks/customers/redact` |
| Shop redact | `https://YOUR_APP_URL/webhooks/shop/redact` |

---

## Freebie Product Flow
1. Merchant picks any product in Freebie settings → clicks "Create Free Copy"
2. App uses Admin GraphQL `productCreate` mutation to create a `$0.00` variant, status `ACTIVE`, tagged `edge-cart-freebie`
3. New variant GID stored in `CartSettings.freebieProductVariantId`
4. Storefront JS adds this variant to cart when threshold met — it has $0 price so checkout total is unaffected

---

## UI Pattern for Settings Pages
All settings pages follow this pattern:
```jsx
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.cartSettings.findUnique({ where: { shop: session.shop } });
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  await prisma.cartSettings.upsert({ where: { shop: session.shop }, create: {...}, update: {...} });
  return { success: true };
};
```
Product picker uses App Bridge: `await shopify.resourcePicker({ type: "product", multiple: N })`  
Returns `[{ id, title, handle, images, variants }]` — store as JSON string in DB.

---

## Known Issues / Watch Out For
- `OrphanedSnippet` warning in CLI — harmless, from old star-rating snippet in extension (already deleted)
- Dev tunnel URL changes every `shopify app dev` session — the manifest.json and app proxy URL auto-update
- `shopify.app.toml` `application_url` stays as `https://example.com` during dev — CLI auto-updates via `automatically_update_urls_on_dev = true`
- SQLite is fine for dev/small scale. For production public app → migrate to PostgreSQL

---

## Commands Reference
```bash
shopify app dev          # run dev server with tunnel
npm run build            # production build
npx prisma migrate dev   # apply schema changes
npx prisma generate      # regenerate Prisma client after schema change
npx prisma studio        # GUI to inspect the database
shopify app deploy       # deploy to production (after hosting setup)
```
