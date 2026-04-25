/* ============================================================
   EdgeCart SideCart — Storefront JavaScript
   ============================================================ */
(function () {
  "use strict";

  /* ── Config injected by liquid ─────────────────────────── */
  var PROXY = window.EdgeCartProxy || "/apps/edge-cart";
  var SHOP  = window.EdgeCartShop  || "";

  /* ── State ─────────────────────────────────────────────── */
  var settings      = null;
  var cart          = null;
  var discountCode  = "";
  var isOpen        = false;
  var initialized   = false;
  var updatingKeys  = {};   // line keys being updated

  /* ===========================================================
     BOOT
  =========================================================== */
  function boot() {
    Promise.all([loadSettings(), loadCart()])
      .then(function (results) {
        settings = results[0];
        cart     = results[1];
        if (!settings || !settings.enabled) return;
        injectDynamicCSS();
        buildDOM();
        attachGlobalListeners();
        initialized = true;
      })
      .catch(function (err) {
        console.warn("[EdgeCart] init error:", err);
      });
  }

  /* ===========================================================
     API CALLS
  =========================================================== */
  function loadSettings() {
    return fetch(PROXY + "/api/cart-settings", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function loadCart() {
    return fetch("/cart.js", { credentials: "same-origin" })
      .then(function (r) { return r.json(); });
  }

  function cartAdd(variantId, quantity, properties) {
    return fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
      body: JSON.stringify({ id: variantId, quantity: quantity || 1, properties: properties || {} }),
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.description || "Add failed"); });
      return loadCart().then(function (c) { cart = c; });
    });
  }

  function cartChange(key, quantity) {
    return fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
      body: JSON.stringify({ id: key, quantity: quantity }),
    }).then(function (r) {
      return r.json().then(function (c) { cart = c; });
    });
  }

  /* ===========================================================
     DOM — BUILD ONCE
  =========================================================== */
  function buildDOM() {
    /* Overlay */
    var overlay = make("div", "ec-overlay");
    overlay.id  = "ec-overlay";
    on(overlay, "click", closeCart);

    /* Drawer */
    var drawer = make("div", "ec-cart");
    drawer.id  = "ec-cart";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Shopping cart");

    drawer.innerHTML = [
      '<div class="ec-inner">',
        '<div class="ec-banner" id="ec-banner"></div>',
        '<div class="ec-header">',
          '<h2 class="ec-header__title" id="ec-header-title"></h2>',
          '<button class="ec-header__close" id="ec-close" aria-label="Close cart">',
            svgClose(),
          '</button>',
        '</div>',
        '<div class="ec-body" id="ec-body"></div>',
        '<div class="ec-footer" id="ec-footer"></div>',
      '</div>',
    ].join("");

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    on(drawer, "click", handleDrawerClick);
    on(document.getElementById("ec-close"), "click", closeCart);
  }

  /* ===========================================================
     RENDER
  =========================================================== */
  function render() {
    renderBanner();
    renderHeader();
    renderBody();
    renderFooter();
    syncCartBadges();
  }

  function renderBanner() {
    var el = id("ec-banner");
    if (!el || !settings) return;
    if (settings.bannerEnabled && settings.bannerText) {
      el.textContent = settings.bannerText;
      el.style.display   = "";
      el.style.background = settings.bannerBgColor || "#1a1a1a";
      el.style.color      = settings.bannerTextColor || "#fff";
    } else {
      el.style.display = "none";
    }
  }

  function renderHeader() {
    var el = id("ec-header-title");
    if (el && settings) el.textContent = settings.headerText || "Your Cart";
  }

  function renderBody() {
    var body = id("ec-body");
    if (!body) return;

    if (!cart || cart.item_count === 0) {
      body.innerHTML = [
        '<div class="ec-empty">',
          svgCart("ec-empty__icon"),
          '<p class="ec-empty__text">Your cart is empty</p>',
          '<p class="ec-empty__sub">Add items to get started</p>',
          '<button class="ec-empty__btn" id="ec-keep-shopping">Continue Shopping</button>',
        '</div>',
      ].join("");
      on(id("ec-keep-shopping"), "click", closeCart);
      return;
    }

    body.innerHTML = '<div class="ec-items" id="ec-items">' + cart.items.map(renderItem).join("") + '</div>';
  }

  function renderItem(item) {
    var img     = (item.featured_image && item.featured_image.url) ? item.featured_image.url : (item.image || "");
    var hasDisc = item.line_price < item.original_line_price;
    var isUpd   = updatingKeys[item.key];

    return [
      '<div class="ec-item' + (isUpd ? ' ec-item--updating' : '') + '" data-key="' + esc(item.key) + '">',
        '<div class="ec-item__img">',
          img
            ? '<img src="' + esc(img) + '" alt="' + esc(item.product_title) + '" loading="lazy">'
            : '<div class="ec-item__img-placeholder"></div>',
        '</div>',
        '<div class="ec-item__body">',
          '<div class="ec-item__top">',
            '<div class="ec-item__info">',
              '<p class="ec-item__title">' + esc(item.product_title) + '</p>',
              item.variant_title && item.variant_title !== 'Default Title'
                ? '<p class="ec-item__variant">' + esc(item.variant_title) + '</p>'
                : '',
            '</div>',
            '<button class="ec-item__remove" data-action="remove" data-key="' + esc(item.key) + '" aria-label="Remove">',
              svgX(),
            '</button>',
          '</div>',
          '<div class="ec-item__bottom">',
            '<div class="ec-qty">',
              '<button class="ec-qty__btn" data-action="dec" data-key="' + esc(item.key) + '" data-qty="' + (item.quantity - 1) + '" aria-label="Decrease" ' + (item.quantity <= 1 ? 'disabled' : '') + '>−</button>',
              '<span class="ec-qty__val">' + item.quantity + '</span>',
              '<button class="ec-qty__btn" data-action="inc" data-key="' + esc(item.key) + '" data-qty="' + (item.quantity + 1) + '" aria-label="Increase">+</button>',
            '</div>',
            '<div class="ec-item__price">',
              hasDisc ? '<span class="ec-item__orig">' + money(item.original_line_price) + '</span>' : '',
              '<span class="ec-item__line' + (hasDisc ? ' ec-item__line--sale' : '') + '">' + money(item.line_price) + '</span>',
            '</div>',
          '</div>',
        '</div>',
      '</div>',
    ].join("");
  }

  function renderFooter() {
    var footer = id("ec-footer");
    if (!footer || !cart || cart.item_count === 0) {
      if (footer) footer.innerHTML = "";
      return;
    }

    var html = "";

    /* Freebie */
    if (settings.freebieEnabled) html += buildFreebieHTML();

    /* Upsell */
    if (settings.upsellEnabled) html += buildUpsellHTML();

    /* Discount */
    if (settings.discountEnabled) {
      html += [
        '<div class="ec-discount">',
          '<div class="ec-discount__wrap">',
            '<input class="ec-discount__input" id="ec-disc-input" type="text" placeholder="Discount code" value="' + esc(discountCode) + '" autocomplete="off" spellcheck="false">',
            '<button class="ec-discount__apply" id="ec-disc-apply">Apply</button>',
          '</div>',
          discountCode
            ? '<p class="ec-discount__applied">✓ "' + esc(discountCode) + '" applied at checkout</p>'
            : '',
        '</div>',
      ].join("");
    }

    /* Summary */
    html += [
      '<div class="ec-summary">',
        '<div class="ec-summary__row">',
          '<span class="ec-summary__label">Subtotal</span>',
          '<span class="ec-summary__price">' + money(cart.total_price) + '</span>',
        '</div>',
        '<p class="ec-summary__note">Taxes & shipping calculated at checkout</p>',
      '</div>',
      '<a href="' + checkoutUrl() + '" class="ec-checkout-btn" id="ec-checkout">',
        'Checkout · ' + money(cart.total_price),
      '</a>',
    ].join("");

    footer.innerHTML = html;

    /* Bind discount */
    var applyBtn = id("ec-disc-apply");
    var discInput = id("ec-disc-input");
    if (applyBtn && discInput) {
      on(applyBtn, "click", function () {
        discountCode = discInput.value.trim();
        renderFooter();
      });
      on(discInput, "keydown", function (e) {
        if (e.key === "Enter") { discountCode = discInput.value.trim(); renderFooter(); }
      });
    }
  }

  /* ── Freebie HTML ──────────────────────────────────────── */
  function buildFreebieHTML() {
    if (!settings.freebieProductVariantId) return "";

    var alreadyAdded = cart.items.some(function (i) {
      return String(i.variant_id) === extractId(settings.freebieProductVariantId);
    });

    if (alreadyAdded) {
      return '<div class="ec-freebie ec-freebie--added">✓ ' + esc(settings.freebieTitle || "Free gift added!") + '</div>';
    }

    var unlocked = checkFreebie();

    if (unlocked) {
      return [
        '<div class="ec-freebie ec-freebie--available">',
          '<div class="ec-freebie__row">',
            settings.freebieProductImageUrl
              ? '<img class="ec-freebie__img" src="' + esc(settings.freebieProductImageUrl) + '" alt="Free gift">'
              : '',
            '<div class="ec-freebie__info">',
              '<p class="ec-freebie__label">' + esc(settings.freebieTitle || "🎁 You've earned a free gift!") + '</p>',
              settings.freebieProductTitle
                ? '<p class="ec-freebie__product">' + esc(settings.freebieProductTitle) + '</p>'
                : '',
            '</div>',
          '</div>',
          '<button class="ec-freebie__add-btn" id="ec-add-freebie">Add Free Gift</button>',
        '</div>',
      ].join("");
    }

    /* Progress bar */
    var prog = freebieProgress();
    if (!prog) return "";
    return [
      '<div class="ec-freebie ec-freebie--locked">',
        '<p class="ec-freebie__msg">' + esc(prog.msg) + '</p>',
        '<div class="ec-freebie__bar-track">',
          '<div class="ec-freebie__bar-fill" style="width:' + prog.pct + '%"></div>',
        '</div>',
      '</div>',
    ].join("");
  }

  /* ── Upsell HTML ───────────────────────────────────────── */
  function buildUpsellHTML() {
    var products = settings.upsellProducts || [];
    if (!products.length) return "";
    if (!checkUpsell()) return "";

    /* Hide products already in cart */
    var cartPids = cart.items.map(function (i) { return "gid://shopify/Product/" + i.product_id; });
    var toShow   = products.filter(function (p) { return !cartPids.includes(p.id); });
    if (!toShow.length) return "";

    var rows = toShow.map(function (p) {
      var v     = p.variants && p.variants[0];
      if (!v) return "";
      var vid   = extractId(v.id);
      var price = v.price ? moneyVal(parseFloat(v.price) * 100) : "";
      var img   = p.featuredImage && p.featuredImage.url ? p.featuredImage.url : "";
      return [
        '<div class="ec-upsell__item">',
          img
            ? '<img class="ec-upsell__img" src="' + esc(img) + '" alt="' + esc(p.title) + '" loading="lazy">'
            : '<div class="ec-upsell__img-placeholder"></div>',
          '<div class="ec-upsell__info">',
            '<p class="ec-upsell__name">' + esc(p.title) + '</p>',
            price ? '<p class="ec-upsell__price">' + price + '</p>' : '',
          '</div>',
          '<button class="ec-upsell__add" data-action="upsell" data-variant="' + esc(vid) + '" aria-label="Add ' + esc(p.title) + '">+</button>',
        '</div>',
      ].join("");
    }).join("");

    if (!rows) return "";
    return [
      '<div class="ec-upsell">',
        '<p class="ec-upsell__heading">' + esc(settings.upsellTitle || "You might also like") + '</p>',
        '<div class="ec-upsell__list">' + rows + '</div>',
      '</div>',
    ].join("");
  }

  /* ===========================================================
     THRESHOLD CHECKS
  =========================================================== */
  function checkFreebie() {
    var t = settings.freebieTriggerType;
    if (t === "cartValue")  return (cart.total_price / 100) >= settings.freebieMinCartValue;
    if (t === "quantity")   return cart.item_count >= settings.freebieMinQuantity;
    if (t === "product") {
      var ids = (settings.freebieTriggerProductIds || []).map(extractId);
      return cart.items.some(function (i) { return ids.includes(String(i.product_id)); });
    }
    return false;
  }

  function freebieProgress() {
    var t = settings.freebieTriggerType;
    if (t === "cartValue") {
      var cur    = cart.total_price / 100;
      var target = settings.freebieMinCartValue;
      var rem    = Math.max(0, target - cur);
      return {
        pct: Math.min(100, Math.round((cur / target) * 100)),
        msg: rem > 0
          ? "Spend " + moneyVal(rem * 100) + " more to unlock your free gift!"
          : "",
      };
    }
    if (t === "quantity") {
      var curQ    = cart.item_count;
      var targetQ = settings.freebieMinQuantity;
      var remQ    = Math.max(0, targetQ - curQ);
      return {
        pct: Math.min(100, Math.round((curQ / targetQ) * 100)),
        msg: remQ > 0
          ? "Add " + remQ + " more item" + (remQ !== 1 ? "s" : "") + " to unlock your free gift!"
          : "",
      };
    }
    return null;
  }

  function checkUpsell() {
    var t = settings.upsellTriggerType;
    if (t === "cartValue")  return (cart.total_price / 100) >= settings.upsellMinCartValue;
    if (t === "quantity")   return cart.item_count >= settings.upsellMinQuantity;
    if (t === "product") {
      var ids = (settings.upsellTriggerProductIds || []).map(extractId);
      return cart.items.some(function (i) { return ids.includes(String(i.product_id)); });
    }
    return false;
  }

  /* ===========================================================
     OPEN / CLOSE
  =========================================================== */
  function openCart() {
    if (!initialized) return;
    render();
    isOpen = true;
    var drawer  = id("ec-cart");
    var overlay = id("ec-overlay");
    if (drawer)  drawer.classList.add("ec-cart--open");
    if (overlay) overlay.classList.add("ec-overlay--visible");
    document.body.style.overflow = "hidden";
    var closeBtn = id("ec-close");
    if (closeBtn) setTimeout(function () { closeBtn.focus(); }, 50);
  }

  function closeCart() {
    isOpen = false;
    var drawer  = id("ec-cart");
    var overlay = id("ec-overlay");
    if (drawer)  drawer.classList.remove("ec-cart--open");
    if (overlay) overlay.classList.remove("ec-overlay--visible");
    document.body.style.overflow = "";
  }

  /* ===========================================================
     EVENT LISTENERS
  =========================================================== */
  function attachGlobalListeners() {
    /* Intercept form-based Add to Cart */
    document.addEventListener("submit", function (e) {
      var form   = e.target;
      if (!form || form.tagName !== "FORM") return;
      var action = form.getAttribute("action") || "";
      if (!action.includes("/cart/add")) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      var fd  = new FormData(form);
      var vid = fd.get("id");
      var qty = parseInt(fd.get("quantity") || "1", 10);
      if (!vid) { form.submit(); return; }

      setSubmitBtnLoading(form, true);
      cartAdd(vid, qty, {})
        .then(function () { render(); openCart(); })
        .catch(function () { form.submit(); })
        .finally(function () { setSubmitBtnLoading(form, false); });
    }, true);

    /* Intercept cart icon / /cart link clicks */
    document.addEventListener("click", function (e) {
      var link = e.target.closest(
        'a[href="/cart"], a[href^="/cart?"], [data-cart-toggle], .cart-link, .header__cart, .cart-icon-bubble, [aria-label*="cart" i], [aria-label*="Cart" i]'
      );
      if (!link) return;
      /* Let checkout links through */
      if (link.href && link.href.includes("/checkout")) return;
      e.preventDefault();
      openCart();
    }, false);

    /* Escape key */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) closeCart();
    });

    /* Listen for theme custom events (some themes fire these) */
    document.addEventListener("cart:updated", function () {
      loadCart().then(function (c) { cart = c; if (isOpen) render(); });
    });
  }

  /* ── Drawer click delegation ───────────────────────────── */
  function handleDrawerClick(e) {
    /* Remove item */
    var removeBtn = e.target.closest("[data-action='remove']");
    if (removeBtn) {
      var key = removeBtn.dataset.key;
      if (key) doCartChange(key, 0);
      return;
    }

    /* Decrease qty */
    var decBtn = e.target.closest("[data-action='dec']");
    if (decBtn) {
      var k = decBtn.dataset.key;
      var q = parseInt(decBtn.dataset.qty, 10);
      if (k && q >= 0) doCartChange(k, q);
      return;
    }

    /* Increase qty */
    var incBtn = e.target.closest("[data-action='inc']");
    if (incBtn) {
      var ki = incBtn.dataset.key;
      var qi = parseInt(incBtn.dataset.qty, 10);
      if (ki) doCartChange(ki, qi);
      return;
    }

    /* Upsell add */
    var upsellBtn = e.target.closest("[data-action='upsell']");
    if (upsellBtn) {
      var vid = upsellBtn.dataset.variant;
      if (!vid) return;
      upsellBtn.disabled = true;
      upsellBtn.textContent = "✓";
      cartAdd(vid, 1, {})
        .then(function () { render(); })
        .catch(function () { upsellBtn.disabled = false; upsellBtn.textContent = "+"; });
      return;
    }

    /* Freebie add */
    var freebieBtn = e.target.closest("#ec-add-freebie");
    if (freebieBtn) {
      freebieBtn.disabled = true;
      freebieBtn.textContent = "Adding…";
      var numId = extractId(settings.freebieProductVariantId);
      cartAdd(numId, 1, { _edge_cart_freebie: "true" })
        .then(function () { render(); })
        .catch(function () { freebieBtn.disabled = false; freebieBtn.textContent = "Add Free Gift"; });
      return;
    }
  }

  /* ── Qty change with per-item loading state ────────────── */
  function doCartChange(key, qty) {
    updatingKeys[key] = true;
    renderBody();
    cartChange(key, qty)
      .then(function () {
        delete updatingKeys[key];
        render();
      })
      .catch(function () {
        delete updatingKeys[key];
        render();
      });
  }

  /* ── Set Add-to-cart button loading ────────────────────── */
  function setSubmitBtnLoading(form, loading) {
    var btn = form.querySelector('[type="submit"]');
    if (!btn) return;
    if (loading) {
      btn.dataset.ecOrig = btn.textContent;
      btn.textContent    = "Adding…";
      btn.disabled       = true;
    } else {
      btn.textContent = btn.dataset.ecOrig || btn.textContent;
      btn.disabled    = false;
    }
  }

  /* ===========================================================
     HELPERS
  =========================================================== */
  function injectDynamicCSS() {
    var style = document.createElement("style");
    style.id  = "ec-dynamic";
    style.textContent = [
      ":root{",
        "--ec-primary:" + (settings.primaryColor || "#000") + ";",
        "--ec-banner-bg:" + (settings.bannerBgColor || "#1a1a1a") + ";",
        "--ec-banner-text:" + (settings.bannerTextColor || "#fff") + ";",
      "}",
    ].join("");
    document.head.appendChild(style);
  }

  function syncCartBadges() {
    var count = (cart && cart.item_count) || 0;
    document.querySelectorAll(
      "[data-cart-count], .cart-count, #CartCount, .cart-item-count, .header__cart-bubble, .cart-bubble"
    ).forEach(function (el) {
      el.textContent = count;
      el.style.display = count > 0 ? "" : "none";
    });
  }

  function checkoutUrl() {
    return discountCode
      ? "/checkout?discount=" + encodeURIComponent(discountCode)
      : "/checkout";
  }

  function money(cents) { return moneyVal(cents); }

  function moneyVal(cents) {
    var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active)
      || (cart && cart.currency)
      || "USD";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency: currency, minimumFractionDigits: 2,
      }).format(cents / 100);
    } catch (_) {
      return "$" + (cents / 100).toFixed(2);
    }
  }

  function extractId(gid) {
    if (!gid) return String(gid);
    var s = String(gid);
    return s.includes("/") ? s.split("/").pop() : s;
  }

  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function id(elId) { return document.getElementById(elId); }
  function make(tag, cls) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }
  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

  /* ── SVG icons ─────────────────────────────────────────── */
  function svgClose() {
    return '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function svgX() {
    return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11 3L3 11M3 3l8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
  }
  function svgCart(cls) {
    return '<svg class="' + cls + '" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="2"/><path d="M18 24h28l-3.5 16H21.5L18 24z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M26 24v-4a6 6 0 0112 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  /* ===========================================================
     START
  =========================================================== */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
