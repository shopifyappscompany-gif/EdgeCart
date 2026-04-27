/* ============================================================
   EdgeCart SideCart — Storefront JavaScript
   ============================================================ */
(function () {
  "use strict";

  /* ── Config injected by liquid ─────────────────────────── */
  var PROXY = window.EdgeCartProxy || "/apps/edge-cart";
  var SHOP  = window.EdgeCartShop  || "";

  /* ── State ─────────────────────────────────────────────── */
  var settings              = null;
  var cart                  = null;
  var discountCode          = "";
  var appliedDiscount       = null;
  var discountLoading       = false;
  var discountError         = "";
  var orderNote             = "";
  var freebieToastTimer     = null;
  var isOpen                = false;
  var initialized           = false;
  var updatingKeys          = {};
  var freebieAutoSync       = false;
  var freebieRetryAt        = 0;
  var ecHandlingAdd         = false;
  var scarcityTimer         = null;
  var autoApplied           = false;
  var autoDiscountDismissed = false;
  var offersData            = {};
  var offersLoaded          = false;
  var offersOpen            = false;

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
        initAutoDiscount();
        syncFreebie();
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
    ecHandlingAdd = true;
    return fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
      body: JSON.stringify({ id: variantId, quantity: quantity || 1, properties: properties || {} }),
    }).then(function (r) {
      ecHandlingAdd = false;
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.description || "Add failed"); });
      return loadCart().then(function (c) { cart = c; document.dispatchEvent(new CustomEvent("cart:updated")); });
    }).catch(function (err) {
      ecHandlingAdd = false;
      throw err;
    });
  }

  function cartChange(key, quantity) {
    return fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
      body: JSON.stringify({ id: key, quantity: quantity }),
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.description || "Change failed"); });
      return r.json().then(function (c) { cart = c; document.dispatchEvent(new CustomEvent("cart:updated")); });
    });
  }

  function cartUpdateNote(note) {
    return fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
      body: JSON.stringify({ note: note }),
    }).then(function (r) { return r.json(); });
  }

  /* ===========================================================
     AUTO DISCOUNT
  =========================================================== */
  function initAutoDiscount() {
    if (!settings || !settings.autoDiscountEnabled) return;
    if (autoDiscountDismissed) return;

    var mode = settings.autoDiscountMode || "exact";

    if (mode === "exact" && settings.autoDiscountCode) {
      applyAutoDiscount(settings.autoDiscountCode);
    } else if ((mode === "max" || mode === "min") && settings.configuredDiscounts && settings.configuredDiscounts.length) {
      loadOffersAndPickBest(settings.configuredDiscounts, mode);
    }
  }

  function applyAutoDiscount(code) {
    if (autoDiscountDismissed) return;
    return fetch(PROXY + "/api/validate-discount?code=" + encodeURIComponent(code), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { valid: false }; })
      .then(function (data) {
        if (data.valid && checkEligibility(data)) {
          discountCode    = code;
          appliedDiscount = data;
          autoApplied     = true;
          discountError   = "";
          if (isOpen) renderFooter();
        }
      })
      .catch(function () {});
  }

  function loadOffersAndPickBest(codes, mode) {
    if (autoDiscountDismissed) return;
    Promise.all(codes.map(function (code) {
      if (offersData[code] !== undefined) return Promise.resolve({ code: code, data: offersData[code] });
      return fetch(PROXY + "/api/validate-discount?code=" + encodeURIComponent(code), { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : { valid: false }; })
        .then(function (d) { offersData[code] = d; return { code: code, data: d }; })
        .catch(function () { return { code: code, data: { valid: false } }; });
    })).then(function (results) {
      if (autoDiscountDismissed) return;
      var eligible = results.filter(function (r) { return r.data.valid && checkEligibility(r.data); });
      if (!eligible.length) return;
      var withAmounts = eligible.map(function (r) {
        return { code: r.code, data: r.data, amount: computeDiscountAmountForData(r.data) };
      });
      var chosen;
      if (mode === "max") {
        chosen = withAmounts.reduce(function (best, cur) { return cur.amount > best.amount ? cur : best; });
      } else {
        chosen = withAmounts.reduce(function (best, cur) { return cur.amount < best.amount ? cur : best; });
      }
      offersLoaded    = true;
      discountCode    = chosen.code;
      appliedDiscount = chosen.data;
      autoApplied     = true;
      discountError   = "";
      if (isOpen) renderFooter();
    });
  }

  function loadOffersData(codes) {
    if (offersLoaded) return;
    var uncached = codes.filter(function (c) { return offersData[c] === undefined; });
    if (!uncached.length) { offersLoaded = true; if (isOpen) renderFooter(); return; }
    Promise.all(uncached.map(function (code) {
      return fetch(PROXY + "/api/validate-discount?code=" + encodeURIComponent(code), { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : { valid: false }; })
        .then(function (d) { offersData[code] = d; })
        .catch(function () { offersData[code] = { valid: false }; });
    })).then(function () {
      offersLoaded = true;
      if (isOpen) renderFooter();
    });
  }

  function checkEligibility(data) {
    if (!cart || !data) return false;
    var req = data.minimumRequirement;
    if (!req) return true;
    if (req.type === "subtotal") {
      var total = cart.items.reduce(function (sum, item) { return sum + item.line_price; }, 0);
      return total >= req.subtotal * 100;
    }
    if (req.type === "quantity") {
      return cart.item_count >= req.quantity;
    }
    return true;
  }

  function computeDiscountAmountForData(d) {
    if (!cart || !d) return 0;
    if (d.type === "percentage") {
      if (d.appliesToAll) return Math.round(cart.total_price * d.value);
      var base = cart.items.reduce(function (sum, item) {
        var pid = "gid://shopify/Product/" + item.product_id;
        return (d.productIds && d.productIds.indexOf(pid) !== -1) ? sum + item.line_price : sum;
      }, 0);
      return Math.round(base * d.value);
    }
    if (d.type === "fixed_amount") return Math.min(d.value, cart.total_price);
    return 0;
  }

  function removeDiscount() {
    if (autoApplied) autoDiscountDismissed = true;
    discountCode    = "";
    appliedDiscount = null;
    discountError   = "";
    autoApplied     = false;
    if (isOpen) renderFooter();
  }

  /* ── Manual discount validation ────────────────────────── */
  function validateDiscount(code) {
    if (!code) {
      appliedDiscount = null;
      discountError   = "";
      discountCode    = "";
      autoApplied     = false;
      if (isOpen) renderFooter();
      return Promise.resolve(null);
    }
    discountLoading = true;
    discountError   = "";
    if (isOpen) renderFooter();

    return fetch(PROXY + "/api/validate-discount?code=" + encodeURIComponent(code), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { valid: false, reason: "Server error" }; })
      .then(function (data) {
        discountLoading = false;
        if (data.valid) {
          discountCode    = code;
          appliedDiscount = data;
          autoApplied     = false;
          if (!checkEligibility(data)) {
            var req = data.minimumRequirement;
            if (req && req.type === "subtotal") {
              discountError = "Note: Minimum purchase of " + moneyVal(req.subtotal * 100) + " required at checkout";
            } else if (req && req.type === "quantity") {
              discountError = "Note: Requires " + req.quantity + " or more items to apply at checkout";
            } else {
              discountError = "";
            }
          } else {
            discountError = "";
          }
        } else {
          discountCode    = "";
          appliedDiscount = null;
          discountError   = data.reason || "Invalid discount code";
        }
        if (isOpen) renderFooter();
        return data;
      })
      .catch(function () {
        discountLoading = false;
        appliedDiscount = null;
        discountError   = "Could not validate discount";
        if (isOpen) renderFooter();
        return null;
      });
  }

  function calculateDiscountAmount() {
    return computeDiscountAmountForData(appliedDiscount);
  }

  /* ===========================================================
     DOM BUILDING
  =========================================================== */
  function buildDOM() {
    var overlay = make("div", "ec-overlay");
    overlay.id  = "ec-overlay";
    on(overlay, "click", closeCart);

    var drawer = make("div", "ec-cart");
    drawer.id  = "ec-cart";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Shopping cart");

    drawer.innerHTML = [
      '<div class="ec-inner">',
        '<div class="ec-freebie-toast" id="ec-freebie-toast" aria-live="polite"></div>',
        '<div class="ec-banner" id="ec-banner"></div>',
        '<div class="ec-scarcity" id="ec-scarcity" style="display:none"></div>',
        '<div class="ec-rewards" id="ec-rewards" style="display:none"></div>',
        '<div class="ec-header">',
          '<h2 class="ec-header__title" id="ec-header-title"></h2>',
          '<button class="ec-header__close" id="ec-close" aria-label="Close cart">',
            svgClose(),
          "</button>",
        "</div>",
        '<div class="ec-body" id="ec-body"></div>',
        '<div class="ec-footer" id="ec-footer"></div>',
      "</div>",
    ].join("");

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    on(drawer, "click", handleDrawerClick);
    on(id("ec-close"), "click", closeCart);
  }

  /* ===========================================================
     RENDER
  =========================================================== */
  function render() {
    renderBanner();
    renderScarcity();
    renderRewards();
    renderHeader();
    renderBody();
    renderFooter();
    syncCartBadges();
  }

  function renderBanner() {
    var el = id("ec-banner");
    if (!el || !settings) return;
    if (settings.bannerEnabled && settings.bannerText) {
      el.textContent      = settings.bannerText;
      el.style.display    = "";
      el.style.background = settings.bannerBgColor || "#1a1a1a";
      el.style.color      = settings.bannerTextColor || "#fff";
    } else {
      el.style.display = "none";
    }
  }

  /* ── Scarcity countdown ─────────────────────────────────── */
  function renderScarcity() {
    var el = id("ec-scarcity");
    if (!el || !settings || !settings.scarcityEnabled) {
      if (el) el.style.display = "none";
      return;
    }
    el.style.display    = "";
    el.style.background = settings.scarcityBgColor || "#e53e3e";
    el.style.color      = settings.scarcityTextColor || "#fff";

    var storageKey = "ec_timer_" + SHOP;
    var stored     = sessionStorage.getItem(storageKey);
    var endTime;

    if (stored) {
      endTime = parseInt(stored, 10);
    } else {
      endTime = Date.now() + (settings.scarcityMinutes || 15) * 60 * 1000;
      sessionStorage.setItem(storageKey, String(endTime));
    }

    function tick() {
      var remaining = Math.max(0, endTime - Date.now());
      var totalSec  = Math.floor(remaining / 1000);
      var h = Math.floor(totalSec / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;
      var timeStr = h > 0
        ? pad(h) + ":" + pad(m) + ":" + pad(s)
        : pad(m) + ":" + pad(s);

      el.innerHTML = [
        '<span class="ec-scarcity__text">' + esc(settings.scarcityText || "⏰ Offer ends in:") + "</span>",
        '<span class="ec-scarcity__clock">' + (remaining > 0 ? timeStr : "EXPIRED") + "</span>",
      ].join(" ");
    }

    tick();
    if (scarcityTimer) clearInterval(scarcityTimer);
    scarcityTimer = setInterval(tick, 1000);
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  /* ── Tiered rewards ─────────────────────────────────────── */
  function renderRewards() {
    var el = id("ec-rewards");
    if (!el || !settings || !settings.tieredRewardsEnabled) {
      if (el) el.style.display = "none";
      return;
    }

    var tiers = settings.tieredRewards || [];
    if (!tiers.length) { el.style.display = "none"; return; }

    tiers = tiers.slice().sort(function (a, b) { return a.threshold - b.threshold; });
    el.style.display = "";

    var cartValue  = cart ? (cart.total_price / 100) : 0;
    var cartQty    = cart ? cart.item_count : 0;
    var maxTier    = tiers[tiers.length - 1];
    var maxVal     = maxTier.threshold;
    var useQty     = tiers[0].thresholdType === "quantity";
    var currentVal = useQty ? cartQty : cartValue;

    var nextTier = null;
    for (var i = 0; i < tiers.length; i++) {
      if (currentVal < tiers[i].threshold) { nextTier = tiers[i]; break; }
    }

    var statusMsg;
    if (!nextTier) {
      statusMsg = "🎉 All rewards unlocked!";
    } else {
      var rem    = nextTier.threshold - currentVal;
      var remFmt = useQty
        ? Math.ceil(rem) + " item" + (Math.ceil(rem) !== 1 ? "s" : "")
        : money(Math.max(0, rem) * 100);
      var rewardName = nextTier.unlockedLabel || nextTier.label || "next reward";
      statusMsg = "Add " + remFmt + " more to unlock: " + rewardName;
    }

    var fillPct = maxVal > 0 ? Math.min(100, Math.round((currentVal / maxVal) * 100)) : 100;

    var milestonesHTML = tiers.map(function (tier) {
      var unlocked = currentVal >= tier.threshold;
      var pct      = maxVal > 0 ? Math.round((tier.threshold / maxVal) * 100) : 100;
      var threshFmt = useQty
        ? tier.threshold + (tier.threshold === 1 ? " item" : " items")
        : money(tier.threshold * 100);
      var milLabel  = tier.unlockedLabel || threshFmt;
      return [
        '<div class="ec-rewards__milestone' + (unlocked ? " ec-rewards__milestone--done" : "") + '" style="left:' + pct + '%">',
          '<div class="ec-rewards__dot">' + (unlocked ? "✓" : "") + "</div>",
          '<span class="ec-rewards__mlabel">' + esc(milLabel) + "</span>",
        "</div>",
      ].join("");
    }).join("");

    el.innerHTML = [
      '<div class="ec-rewards__inner">',
        '<p class="ec-rewards__status">' + esc(statusMsg) + "</p>",
        '<div class="ec-rewards__track">',
          '<div class="ec-rewards__fill" style="width:' + fillPct + '%"></div>',
          milestonesHTML,
        "</div>",
      "</div>",
    ].join("");
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
        "</div>",
      ].join("");
      on(id("ec-keep-shopping"), "click", closeCart);
      return;
    }

    body.innerHTML = '<div class="ec-items" id="ec-items">' + cart.items.map(renderItem).join("") + "</div>";
  }

  function isFreebieItem(item) {
    if (!settings || !settings.freebieProductVariantId) return false;
    var numId = extractId(settings.freebieProductVariantId);
    return String(item.variant_id) === numId ||
      (item.properties && item.properties._edge_cart_freebie === "true");
  }

  function renderItem(item) {
    var freebie = isFreebieItem(item);
    var img = (item.featured_image && item.featured_image.url)
      ? item.featured_image.url
      : (item.image || (freebie ? (settings.freebieProductImageUrl || "") : ""));
    var hasDisc = item.line_price < item.original_line_price;
    var isUpd   = updatingKeys[item.key];
    var showVar = settings.showVariantTitle !== false;

    return [
      '<div class="ec-item' + (isUpd ? " ec-item--updating" : "") + (freebie ? " ec-item--freebie" : "") + '" data-key="' + esc(item.key) + '">',
        '<div class="ec-item__img">',
          img
            ? '<img src="' + esc(img) + '" alt="' + esc(item.product_title) + '" loading="lazy">'
            : '<div class="ec-item__img-placeholder"></div>',
        "</div>",
        '<div class="ec-item__body">',
          '<div class="ec-item__top">',
            '<div class="ec-item__info">',
              '<p class="ec-item__title">' + esc(item.product_title) + "</p>",
              showVar && item.variant_title && item.variant_title !== "Default Title"
                ? '<p class="ec-item__variant">' + esc(item.variant_title) + "</p>"
                : "",
            "</div>",
            freebie
              ? '<span class="ec-item__free-badge">FREE</span>'
              : '<button class="ec-item__remove" data-action="remove" data-key="' + esc(item.key) + '" aria-label="Remove">' + svgX() + "</button>",
          "</div>",
          '<div class="ec-item__bottom">',
            freebie
              ? '<span class="ec-item__gift-label">🎁 Free Gift</span>'
              : [
                '<div class="ec-qty">',
                  '<button class="ec-qty__btn" data-action="dec" data-key="' + esc(item.key) + '" data-qty="' + (item.quantity - 1) + '" aria-label="Decrease"' + (item.quantity <= 1 ? " disabled" : "") + ">−</button>",
                  '<span class="ec-qty__val">' + item.quantity + "</span>",
                  '<button class="ec-qty__btn" data-action="inc" data-key="' + esc(item.key) + '" data-qty="' + (item.quantity + 1) + '" aria-label="Increase">+</button>',
                "</div>",
              ].join(""),
            '<div class="ec-item__price">',
              freebie
                ? '<span class="ec-item__line ec-item__line--free">$0.00</span>'
                : [
                  hasDisc ? '<span class="ec-item__orig">' + money(item.original_line_price) + "</span>" : "",
                  '<span class="ec-item__line' + (hasDisc ? " ec-item__line--sale" : "") + '">' + money(item.line_price) + "</span>",
                ].join(""),
            "</div>",
          "</div>",
        "</div>",
      "</div>",
    ].join("");
  }

  /* ── Footer ─────────────────────────────────────────────── */
  function renderFooter() {
    var footer = id("ec-footer");
    if (!footer || !cart || cart.item_count === 0) {
      if (footer) footer.innerHTML = "";
      return;
    }

    var savings    = calculateDiscountAmount();
    var subtotal   = cart.total_price;
    var finalTotal = Math.max(0, subtotal - savings);
    var html       = "";

    if (settings.freebieEnabled) html += buildFreebieHTML();
    if (settings.upsellEnabled)  html += buildUpsellHTML();
    if (settings.offersEnabled)  html += buildOffersHTML();

    /* ── Discount code field ─ */
    if (settings.discountEnabled) {
      var isApplied = !!(appliedDiscount && discountCode);
      html += [
        '<div class="ec-discount">',
          '<div class="ec-discount__wrap">',
            '<input class="ec-discount__input" id="ec-disc-input" type="text"',
              ' placeholder="Discount code" value="' + esc(discountCode) + '"',
              ' autocomplete="off" spellcheck="false"' + (discountLoading || isApplied ? " disabled" : "") + ">",
            isApplied
              ? '<button class="ec-discount__remove" id="ec-disc-remove" title="Remove discount" aria-label="Remove discount">&times;</button>'
              : '<button class="ec-discount__apply" id="ec-disc-apply"' + (discountLoading ? " disabled" : "") + ">" + (discountLoading ? "Checking…" : "Apply") + "</button>",
          "</div>",
          discountLoading
            ? '<p class="ec-discount__status ec-discount__status--checking">Validating…</p>'
            : isApplied && savings > 0
              ? '<p class="ec-discount__status ec-discount__status--applied">✓ "' + esc(discountCode) + '" — you save ' + money(savings) + "!" + (autoApplied ? ' <span class="ec-discount__auto-tag">Auto</span>' : "") + "</p>"
              : isApplied
                ? '<p class="ec-discount__status ec-discount__status--applied">✓ "' + esc(discountCode) + '" applied at checkout' + (autoApplied ? ' <span class="ec-discount__auto-tag">Auto</span>' : "") + "</p>"
                : discountError
                  ? '<p class="ec-discount__status ec-discount__status--error">✗ ' + esc(discountError) + "</p>"
                  : "",
        "</div>",
      ].join("");
    }

    /* ── Order notes ─ */
    if (settings.orderNotesEnabled) {
      html += [
        '<div class="ec-notes">',
          '<label class="ec-notes__label" for="ec-note-input">Order Notes</label>',
          '<textarea class="ec-notes__textarea" id="ec-note-input" rows="2" placeholder="Add a note to your order…">',
            esc(orderNote),
          "</textarea>",
        "</div>",
      ].join("");
    }

    /* ── Summary ─ */
    html += [
      '<div class="ec-summary">',
        savings > 0 ? [
          '<div class="ec-summary__row">',
            '<span class="ec-summary__label">Subtotal</span>',
            '<span class="ec-summary__price ec-summary__price--struck">' + money(subtotal) + "</span>",
          "</div>",
          '<div class="ec-summary__row ec-summary__row--savings">',
            '<span class="ec-summary__label">Discount (' + esc(discountCode) + ")</span>",
            '<span class="ec-summary__savings">−' + money(savings) + "</span>",
          "</div>",
          '<div class="ec-summary__row">',
            '<span class="ec-summary__label ec-summary__label--total">Total</span>',
            '<span class="ec-summary__price">' + money(finalTotal) + "</span>",
          "</div>",
        ].join("") : [
          '<div class="ec-summary__row">',
            '<span class="ec-summary__label">Subtotal</span>',
            '<span class="ec-summary__price">' + money(subtotal) + "</span>",
          "</div>",
        ].join(""),
        '<p class="ec-summary__note">Taxes & shipping calculated at checkout</p>',
      "</div>",
      '<button class="ec-checkout-btn" id="ec-checkout">Checkout \xb7 ' + money(finalTotal) + "</button>",
    ].join("");

    footer.innerHTML = html;

    /* Bind discount apply */
    var applyBtn  = id("ec-disc-apply");
    var removeBtn = id("ec-disc-remove");
    var discInput = id("ec-disc-input");
    if (applyBtn && discInput) {
      on(applyBtn, "click", function () { validateDiscount(discInput.value.trim()); });
      on(discInput, "keydown", function (e) { if (e.key === "Enter") validateDiscount(discInput.value.trim()); });
    }
    if (removeBtn) {
      on(removeBtn, "click", function () { removeDiscount(); });
    }

    /* Bind offers toggle */
    var offersToggle = id("ec-offers-toggle");
    if (offersToggle) {
      on(offersToggle, "click", function () {
        offersOpen = !offersOpen;
        var panel = id("ec-offers-panel");
        if (panel) panel.style.display = offersOpen ? "" : "none";
        offersToggle.classList.toggle("ec-offers__toggle--open", offersOpen);
      });
    }

    /* Bind order note */
    var noteInput = id("ec-note-input");
    if (noteInput) {
      on(noteInput, "input", function () { orderNote = noteInput.value; });
    }

    /* Bind checkout */
    var checkoutBtn = id("ec-checkout");
    if (checkoutBtn) on(checkoutBtn, "click", handleCheckout);
  }

  /* ── View Offers HTML ──────────────────────────────────── */
  function buildOffersHTML() {
    var codes = settings.configuredDiscounts || [];
    if (!codes.length) return "";

    if (!offersLoaded) loadOffersData(codes);

    var itemsHTML = codes.map(function (code) {
      var data     = offersData[code];
      var desc     = "";
      var eligible = false;

      if (data && data.valid) {
        eligible = checkEligibility(data);
        if (data.type === "percentage") desc = Math.round(data.value * 100) + "% off";
        else if (data.type === "fixed_amount") desc = money(data.value) + " off";
        else if (data.type === "free_shipping") desc = "Free shipping";

        var req = data.minimumRequirement;
        if (req && req.type === "subtotal") desc += " \xb7 min. " + moneyVal(req.subtotal * 100);
        else if (req && req.type === "quantity") desc += " \xb7 min. " + req.quantity + " items";
      }

      var isActive = discountCode === code;
      return [
        '<div class="ec-offers__item">',
          '<div class="ec-offers__info">',
            '<span class="ec-offers__code">' + esc(code) + "</span>",
            desc ? '<span class="ec-offers__desc">' + esc(desc) + "</span>" : "",
            data && !data.valid
              ? '<span class="ec-offers__ineligible">Code not valid</span>'
              : !eligible && data && data.valid
                ? "<span class=\"ec-offers__ineligible\">Cart doesn’t meet minimum</span>"
                : "",
          "</div>",
          '<button class="ec-offers__apply-btn' + (isActive ? " ec-offers__apply-btn--active" : "") + '"',
            ' data-action="apply-offer" data-code="' + esc(code) + '"',
            isActive ? " disabled" : "",
          ">",
            isActive ? "✓ Applied" : "Apply",
          "</button>",
        "</div>",
      ].join("");
    }).join("");

    return [
      '<div class="ec-offers">',
        '<button class="ec-offers__toggle' + (offersOpen ? " ec-offers__toggle--open" : "") + '" id="ec-offers-toggle">',
          "<span>🏷 View Offers (" + codes.length + ")</span>",
          '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 5l5 5 5-5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        "</button>",
        '<div class="ec-offers__panel" id="ec-offers-panel"' + (offersOpen ? "" : ' style="display:none"') + ">",
          '<div class="ec-offers__list">' + itemsHTML + "</div>",
        "</div>",
      "</div>",
    ].join("");
  }

  /* ── Freebie HTML ──────────────────────────────────────── */
  function buildFreebieHTML() {
    if (!settings.freebieProductVariantId) return "";

    var numId    = extractId(settings.freebieProductVariantId);
    var inCart   = cart.items.some(function (i) { return String(i.variant_id) === numId; });
    var unlocked = checkFreebie();

    if (inCart) return "";

    if (unlocked) {
      if (!freebieAutoSync && Date.now() >= freebieRetryAt) syncFreebie();
      return "";
    }

    var prog = freebieProgress();
    if (!prog || !prog.msg) return "";
    return [
      '<div class="ec-freebie ec-freebie--locked">',
        '<p class="ec-freebie__msg">' + esc(prog.msg) + "</p>",
        '<div class="ec-freebie__bar-track">',
          '<div class="ec-freebie__bar-fill" style="width:' + prog.pct + '%"></div>',
        "</div>",
      "</div>",
    ].join("");
  }

  /* ── Upsell HTML ───────────────────────────────────────── */
  function buildUpsellHTML() {
    var products = settings.upsellProducts || [];
    if (!products.length || !checkUpsell()) return "";

    var cartPids = cart.items.map(function (i) { return "gid://shopify/Product/" + i.product_id; });
    var toShow   = products.filter(function (p) { return cartPids.indexOf(p.id) === -1; });
    if (!toShow.length) return "";

    var rows = toShow.map(function (p) {
      var v   = p.variants && p.variants[0];
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
            '<p class="ec-upsell__name">' + esc(p.title) + "</p>",
            price ? '<p class="ec-upsell__price">' + price + "</p>" : "",
          "</div>",
          '<button class="ec-upsell__add" data-action="upsell" data-variant="' + esc(vid) + '" aria-label="Add ' + esc(p.title) + '">+</button>',
        "</div>",
      ].join("");
    }).join("");

    if (!rows) return "";
    return [
      '<div class="ec-upsell">',
        '<p class="ec-upsell__heading">' + esc(settings.upsellTitle || "You might also like") + "</p>",
        '<div class="ec-upsell__list">' + rows + "</div>",
      "</div>",
    ].join("");
  }

  /* ===========================================================
     CHECKOUT
  =========================================================== */
  function handleCheckout() {
    var btn = id("ec-checkout");
    if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
    function go() { window.location.href = checkoutUrl(); }
    if (settings.orderNotesEnabled && orderNote.trim()) {
      cartUpdateNote(orderNote.trim()).then(go).catch(go);
    } else {
      go();
    }
  }

  /* ── Freebie toast ─────────────────────────────────────── */
  function showFreebieToast() {
    var toast = id("ec-freebie-toast");
    if (!toast) return;
    toast.textContent = settings.freebieTitle || "🎁 Free gift added to your cart!";
    toast.classList.add("ec-freebie-toast--visible");
    if (freebieToastTimer) clearTimeout(freebieToastTimer);
    freebieToastTimer = setTimeout(function () {
      toast.classList.remove("ec-freebie-toast--visible");
      freebieToastTimer = null;
    }, 3500);

    if (settings.freebieConfettiEnabled !== false) launchConfetti();
  }

  /* ── Confetti ──────────────────────────────────────────── */
  function launchConfetti() {
    var canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483646;";
    document.body.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    var colors    = ["#f59e0b","#22c55e","#3b82f6","#ec4899","#8b5cf6","#ef4444","#06b6d4"];
    var particles = [];
    for (var i = 0; i < 90; i++) {
      particles.push({
        x: Math.random() * canvas.width, y: -20 - Math.random() * 120,
        w: 7 + Math.random() * 8, h: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 4, vy: 2.5 + Math.random() * 4,
        rot: Math.random() * 360, rotV: (Math.random() - 0.5) * 7, opacity: 1,
      });
    }

    var start = Date.now(), duration = 2800;
    function frame() {
      var elapsed = Date.now() - start;
      if (elapsed > duration) { canvas.remove(); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var fadeStart = duration - 600;
      particles.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.rotV; p.vy += 0.09;
        if (elapsed > fadeStart) p.opacity = Math.max(0, 1 - (elapsed - fadeStart) / 600);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
        ctx.globalAlpha = p.opacity; ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ── Freebie auto-sync ─────────────────────────────────── */
  function syncFreebie() {
    if (freebieAutoSync) return;
    if (!settings || !settings.freebieEnabled || !settings.freebieProductVariantId) return;
    if (!cart) return;

    var numId       = extractId(settings.freebieProductVariantId);
    var freebieItem = cart.items.find(function (i) { return String(i.variant_id) === numId; });
    var realItems   = cart.items.filter(function (i) { return String(i.variant_id) !== numId; });

    if (!freebieItem && realItems.length === 0) return;

    var unlocked = checkFreebie();

    if (unlocked && !freebieItem) {
      if (Date.now() < freebieRetryAt) return;
      freebieAutoSync = true;
      cartAdd(numId, 1, { _edge_cart_freebie: "true" })
        .then(function () {
          freebieAutoSync = false;
          freebieRetryAt  = 0;
          showFreebieToast();
          syncFreebie();
          if (isOpen) render();
          syncCartBadges();
        })
        .catch(function (err) {
          freebieAutoSync = false;
          freebieRetryAt  = 0;
          console.warn("[EdgeCart] Freebie auto-add failed:", err.message || err);
        });

    } else if (!unlocked && freebieItem) {
      freebieAutoSync = true;
      cartChange(freebieItem.key, 0)
        .then(function () {
          freebieAutoSync = false;
          freebieRetryAt  = 0;
          syncFreebie();
          if (isOpen) render();
          syncCartBadges();
        })
        .catch(function (err) {
          freebieAutoSync = false;
          console.warn("[EdgeCart] Freebie auto-remove failed:", err.message || err);
        });
    }
  }

  /* ===========================================================
     THRESHOLD CHECKS
  =========================================================== */
  function checkFreebie() {
    if (!cart) return false;
    var t   = settings.freebieTriggerType;
    var fid = settings.freebieProductVariantId ? extractId(settings.freebieProductVariantId) : null;

    if (t === "cartValue") {
      var realTotal = cart.items.reduce(function (sum, i) {
        return String(i.variant_id) === fid ? sum : sum + i.line_price;
      }, 0);
      return (realTotal / 100) >= settings.freebieMinCartValue;
    }
    if (t === "quantity") {
      var realQty = cart.items.reduce(function (sum, i) {
        return String(i.variant_id) === fid ? sum : sum + i.quantity;
      }, 0);
      return realQty >= settings.freebieMinQuantity;
    }
    if (t === "product") {
      var ids = (settings.freebieTriggerProductIds || []).map(extractId);
      return cart.items.some(function (i) {
        return String(i.variant_id) !== fid && ids.indexOf(String(i.product_id)) !== -1;
      });
    }
    return false;
  }

  function freebieProgress() {
    if (!cart) return null;
    var t   = settings.freebieTriggerType;
    var fid = settings.freebieProductVariantId ? extractId(settings.freebieProductVariantId) : null;

    if (t === "cartValue") {
      var cur    = cart.items.reduce(function (sum, i) {
        return String(i.variant_id) === fid ? sum : sum + i.line_price;
      }, 0) / 100;
      var target = settings.freebieMinCartValue;
      var rem    = Math.max(0, target - cur);
      return {
        pct: Math.min(100, Math.round((cur / target) * 100)),
        msg: rem > 0 ? "Spend " + moneyVal(rem * 100) + " more to unlock your free gift!" : "",
      };
    }
    if (t === "quantity") {
      var curQ    = cart.items.reduce(function (sum, i) {
        return String(i.variant_id) === fid ? sum : sum + i.quantity;
      }, 0);
      var targetQ = settings.freebieMinQuantity;
      var remQ    = Math.max(0, targetQ - curQ);
      return {
        pct: Math.min(100, Math.round((curQ / targetQ) * 100)),
        msg: remQ > 0 ? "Add " + remQ + " more item" + (remQ !== 1 ? "s" : "") + " to unlock your free gift!" : "",
      };
    }
    return null;
  }

  function checkUpsell() {
    if (!cart) return false;
    var t = settings.upsellTriggerType;
    if (t === "cartValue")  return (cart.total_price / 100) >= settings.upsellMinCartValue;
    if (t === "quantity")   return cart.item_count >= settings.upsellMinQuantity;
    if (t === "product") {
      var ids = (settings.upsellTriggerProductIds || []).map(extractId);
      return cart.items.some(function (i) { return ids.indexOf(String(i.product_id)) !== -1; });
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
    syncFreebie();
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
    if (scarcityTimer) { clearInterval(scarcityTimer); scarcityTimer = null; }
  }

  /* ===========================================================
     EVENT LISTENERS
  =========================================================== */
  function attachGlobalListeners() {
    /* Intercept fetch-based add-to-cart */
    var _origFetch = window.fetch;
    window.fetch = function (input, init) {
      var promise = _origFetch.call(this, input, init);
      if (!ecHandlingAdd && initialized) {
        var url = typeof input === "string" ? input : (input && input.url) ? input.url : "";
        if (url && url.includes("/cart/add")) {
          promise.then(function (res) {
            if (res && res.ok) {
              setTimeout(function () {
                loadCart().then(function (c) { cart = c; render(); openCart(); syncFreebie(); });
              }, 50);
            }
          }).catch(function () {});
        }
      }
      return promise;
    };

    /* Intercept XHR-based add-to-cart */
    var _xhrOpen = XMLHttpRequest.prototype.open;
    var _xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._ecUrl = String(url || "");
      return _xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (!ecHandlingAdd && initialized && this._ecUrl && this._ecUrl.includes("/cart/add")) {
        var xhr = this;
        xhr.addEventListener("load", function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            setTimeout(function () {
              loadCart().then(function (c) { cart = c; render(); openCart(); syncFreebie(); });
            }, 50);
          }
        }, { once: true });
      }
      return _xhrSend.apply(this, arguments);
    };

    /* Intercept form-based add-to-cart */
    document.addEventListener("submit", function (e) {
      var form = e.target;
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
        .then(function () { render(); openCart(); syncFreebie(); })
        .catch(function () { form.submit(); })
        .finally(function () { setSubmitBtnLoading(form, false); });
    }, true);

    /* Cart icon clicks */
    document.addEventListener("click", function (e) {
      if (e.target.closest("#ec-cart")) return;
      var link = e.target.closest(
        'a[href="/cart"], a[href^="/cart?"], [data-cart-toggle], .cart-link, .header__cart, .cart-icon-bubble'
      );
      if (!link) return;
      e.preventDefault();
      openCart();
    }, false);

    /* Escape key */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) closeCart();
    });

    /* Theme cart events */
    document.addEventListener("cart:updated", function () {
      loadCart().then(function (c) {
        cart = c;
        offersLoaded = false;
        if (isOpen) render();
        syncFreebie();
      });
    });
    document.addEventListener("theme:cart:add", function () {
      loadCart().then(function (c) { cart = c; render(); openCart(); syncFreebie(); });
    });
    document.addEventListener("cart:refresh", function () {
      loadCart().then(function (c) { cart = c; if (isOpen) render(); syncFreebie(); });
    });
  }

  /* ── Drawer click delegation ───────────────────────────── */
  function handleDrawerClick(e) {
    var removeBtn = e.target.closest("[data-action='remove']");
    if (removeBtn) { doCartChange(removeBtn.dataset.key, 0); return; }

    var decBtn = e.target.closest("[data-action='dec']");
    if (decBtn) {
      var q = parseInt(decBtn.dataset.qty, 10);
      if (decBtn.dataset.key && q >= 0) doCartChange(decBtn.dataset.key, q);
      return;
    }

    var incBtn = e.target.closest("[data-action='inc']");
    if (incBtn) {
      var qi = parseInt(incBtn.dataset.qty, 10);
      if (incBtn.dataset.key) doCartChange(incBtn.dataset.key, qi);
      return;
    }

    var upsellBtn = e.target.closest("[data-action='upsell']");
    if (upsellBtn) {
      var vid = upsellBtn.dataset.variant;
      if (!vid) return;
      upsellBtn.disabled    = true;
      upsellBtn.textContent = "✓";
      cartAdd(vid, 1, {})
        .then(function () { render(); syncFreebie(); })
        .catch(function () { upsellBtn.disabled = false; upsellBtn.textContent = "+"; });
      return;
    }

    var offerBtn = e.target.closest("[data-action='apply-offer']");
    if (offerBtn) {
      var code = offerBtn.dataset.code;
      if (!code || discountCode === code || discountLoading) return;
      offerBtn.disabled    = true;
      offerBtn.textContent = "Applying…";
      validateDiscount(code);
      return;
    }
  }

  function doCartChange(key, qty) {
    updatingKeys[key] = true;
    renderBody();
    cartChange(key, qty)
      .then(function () {
        delete updatingKeys[key];
        offersLoaded = false;
        render();
        syncFreebie();
      })
      .catch(function () { delete updatingKeys[key]; render(); });
  }

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
        "--ec-primary:"        + (settings.primaryColor      || "#000") + ";",
        "--ec-banner-bg:"      + (settings.bannerBgColor     || "#1a1a1a") + ";",
        "--ec-banner-text:"    + (settings.bannerTextColor   || "#fff") + ";",
        "--ec-scarcity-bg:"    + (settings.scarcityBgColor   || "#e53e3e") + ";",
        "--ec-scarcity-text:"  + (settings.scarcityTextColor || "#fff") + ";",
      "}",
    ].join("");
    document.head.appendChild(style);
  }

  function syncCartBadges() {
    var count = (cart && cart.item_count) || 0;
    document.querySelectorAll(
      "[data-cart-count], .cart-count, #CartCount, .cart-item-count, .header__cart-bubble, .cart-bubble"
    ).forEach(function (el) {
      el.textContent   = count;
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
    if (!gid) return "";
    var s = String(gid);
    return s.includes("/") ? s.split("/").pop() : s;
  }

  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function id(elId) { return document.getElementById(elId); }
  function make(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
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
