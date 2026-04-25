# EdgeCart — Shopify Side Cart App

A **public Shopify app** that adds a fully-featured slide-in side cart to any store. Merchants enable it via **App Embeds** — no theme code editing required.

---

## Features

- Slide-in side cart — opens on Add to Cart or cart icon click
- Announcement banner — configurable text, background & text color
- Line items with quantity controls and remove button
- Discount code field — applied seamlessly at checkout URL
- Upsell products — triggered by cart value, quantity, or specific products
- Free gift (freebie) — animated progress bar + one-tap claim
- One-click checkout button
- Full settings UI in Shopify admin (Polaris web components)
- Works with any Shopify theme — no code editing needed

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Router v7 |
| Shopify SDK | `@shopify/shopify-app-react-router` |
| UI | Shopify Polaris Web Components (`s-*` tags) |
| Database | SQLite (dev) / PostgreSQL (production) via Prisma |
| Session storage | Prisma-backed Shopify session storage |
| Theme Extension | Shopify Theme App Extension — App Embed block |
| Storefront cart | Shopify AJAX Cart API (no extra dependencies) |

---

## Prerequisites

| Requirement | Version / Notes |
|---|---|
| Node.js | `>=20.19 <22` or `>=22.12` — check with `node -v` |
| npm | Any recent version — check with `npm -v` |
| Shopify CLI | Install with `npm install -g @shopify/cli` |
| Shopify Partner account | Create free at [partners.shopify.com](https://partners.shopify.com) |
| Shopify development store | Create one inside your Partner account |

---

## Local Development Setup

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/edge-cart.git
cd edge-cart
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a Shopify app in Partner Dashboard

1. Go to [partners.shopify.com](https://partners.shopify.com)
2. Click **Apps → Create app → Create app manually**
3. Name it **EdgeCart**
4. Note your **Client ID** and **Client Secret**

### 4. Link the app to your codebase

Run this and follow the prompts (select your org, app, and dev store):

```bash
shopify app config link
```

This auto-creates a `.env` file with your credentials. Done.

> **Or create `.env` manually:**
> ```env
> SHOPIFY_API_KEY=your_client_id
> SHOPIFY_API_SECRET=your_client_secret
> SHOPIFY_APP_URL=https://example.com
> SCOPES=read_products,write_products
> ```

### 5. Set up the database

```bash
npx prisma migrate deploy
npx prisma generate
```

Creates `prisma/dev.sqlite` with `Session` and `CartSettings` tables.

### 6. Start the dev server

```bash
shopify app dev
```

The CLI will:
- Create a secure Cloudflare tunnel automatically
- Update all URLs in your Partner Dashboard
- Print the app URL in the terminal

### 7. Install the app on your dev store

When the CLI prompts you, accept the installation. The app will open inside your Shopify admin.

### 8. Enable the side cart in your theme

1. Shopify admin → **Online Store → Themes → Customize**
2. Click **App embeds** in the left sidebar
3. Toggle on **EdgeCart SideCart**
4. Click **Save**

**The side cart is now live on your storefront.**

---

## App Settings Pages

Once installed, configure everything from the Shopify admin:

| Page | URL | What you can set |
|---|---|---|
| Dashboard | `/app` | Status overview, activation steps |
| General Settings | `/app/settings` | Header text, primary color, banner (text + colors), discount toggle |
| Upsell | `/app/upsell` | Enable, trigger type (cart value / qty / product), choose up to 5 upsell products |
| Free Gift | `/app/freebie` | Enable, trigger type, create a $0 gift product from any existing product |

---

## Project Structure

```
edge-cart/
├── app/
│   ├── shopify.server.js                    # Shopify app config, OAuth, session storage
│   ├── db.server.js                         # Prisma client singleton
│   └── routes/
│       ├── _index/                          # Public landing page (shown before install)
│       ├── app.jsx                          # Embedded app shell + navigation
│       ├── app._index.jsx                   # Dashboard
│       ├── app.settings.jsx                 # General settings
│       ├── app.upsell.jsx                   # Upsell settings
│       ├── app.freebie.jsx                  # Freebie settings
│       ├── api.cart-settings.jsx            # App Proxy endpoint → returns settings JSON to storefront
│       ├── auth.$.jsx                       # OAuth callback handler
│       ├── auth.login/                      # Manual login page
│       ├── webhooks.app.uninstalled.jsx     # Cleans up sessions + settings on uninstall
│       ├── webhooks.app.scopes_update.jsx   # Handles scope changes
│       ├── webhooks.customers.data_request.jsx  # GDPR
│       ├── webhooks.customers.redact.jsx        # GDPR
│       └── webhooks.shop.redact.jsx             # GDPR
│
├── extensions/
│   └── edge-cart/
│       ├── shopify.extension.toml           # Extension config
│       ├── blocks/
│       │   └── side-cart.liquid             # App embed block (toggled in theme customizer)
│       └── assets/
│           ├── edge-cart.js                 # Side cart engine — vanilla JS, no dependencies
│           └── edge-cart.css                # All styles — drawer, items, upsell, freebie
│
├── prisma/
│   ├── schema.prisma                        # Session + CartSettings models
│   └── migrations/                          # All DB migrations
│
├── shopify.app.toml                         # Scopes, app proxy, webhook config
├── CLAUDE.md                                # Full technical reference for AI / developers
└── README.md                                # This file
```

---

## Environment Variables

| Variable | Description | Set by |
|---|---|---|
| `SHOPIFY_API_KEY` | App Client ID from Partner Dashboard | `shopify app config link` |
| `SHOPIFY_API_SECRET` | App Client Secret | `shopify app config link` |
| `SHOPIFY_APP_URL` | Public app URL | Auto-updated by `shopify app dev` |
| `SCOPES` | `read_products,write_products` | `shopify app config link` |

> `.env` is in `.gitignore` — never commit it.

---

## How the Side Cart Works

1. Merchant configures settings in the app admin → saved to `CartSettings` in SQLite
2. Merchant enables **EdgeCart SideCart** in Theme Customizer → App Embeds
3. `side-cart.liquid` is injected into every storefront page (target: body)
4. The liquid block loads `edge-cart.js` and sets `window.EdgeCartProxy`
5. JS fetches settings from `/apps/edge-cart/api/cart-settings` (Shopify App Proxy → our server)
6. JS intercepts `<form action="/cart/add">` submissions + cart icon clicks
7. Side cart opens — shows line items, freebie progress, upsell products, discount field, checkout button

---

## GDPR Webhooks (Required for App Store Distribution)

The handlers are already built. Register the URLs **once** in:
**Partner Dashboard → Apps → EdgeCart → App setup → GDPR mandatory webhooks**

| Webhook | URL |
|---|---|
| Customer data request | `https://YOUR_PRODUCTION_URL/webhooks/customers/data_request` |
| Customer redact | `https://YOUR_PRODUCTION_URL/webhooks/customers/redact` |
| Shop redact | `https://YOUR_PRODUCTION_URL/webhooks/shop/redact` |

> Use your production URL, not the dev tunnel (it changes every session).

---

## Deploying to Production

### Option A — Fly.io (recommended)

```bash
npm install -g flyctl
fly launch          # follow prompts
fly deploy
```

### Option B — Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Add environment variables from your `.env`
3. Railway auto-detects Node and deploys

### Option C — Render / Heroku

Follow the standard Node.js deployment guide for your platform. Set all env vars listed above plus `NODE_ENV=production`.

### After deploying — push app config to Shopify

```bash
shopify app deploy
```

### Switch to PostgreSQL for production

Update `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then add `DATABASE_URL` to your hosting environment and run `npx prisma migrate deploy`.

---

## Useful Commands

```bash
shopify app dev                # Start dev server + tunnel
shopify app deploy             # Deploy config + extension to Shopify
npm run build                  # Production build
npx prisma migrate dev         # Create + apply a new migration
npx prisma migrate deploy      # Apply existing migrations (production)
npx prisma generate            # Regenerate Prisma client after schema changes
npx prisma studio              # Visual database browser
```

---

## Troubleshooting

**`These scopes are invalid - [read_metafields, write_metafields]`**
→ Those scopes don't exist in Shopify's API. The correct scopes are already in `shopify.app.toml`: `read_products,write_products`.

**`The following topic is invalid: customers/data_request`**
→ GDPR webhooks cannot be declared in `shopify.app.toml`. Register them manually in Partner Dashboard (see GDPR section above).

**Side cart not appearing on storefront**
→ Go to Themes → Customize → App embeds → toggle on **EdgeCart SideCart** → Save.

**`The table CartSettings does not exist`**
→ Run `npx prisma migrate deploy` then `npx prisma generate`.

**App asks to re-install after restarting `shopify app dev`**
→ Normal — the tunnel URL changes each session. The OAuth framework handles re-auth automatically, just click install.

**Upsell products not showing**
→ Make sure the trigger condition is met (e.g. cart value is above the minimum) and at least one upsell product is selected in `/app/upsell`.

---

## Resources

- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI reference](https://shopify.dev/docs/apps/tools/cli)
- [Theme App Extensions](https://shopify.dev/docs/apps/online-store/theme-app-extensions)
- [Shopify App Proxy](https://shopify.dev/docs/apps/build/online-store/app-proxies)
- [Prisma docs](https://www.prisma.io/docs)
- [React Router docs](https://reactrouter.com)
