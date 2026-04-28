/**
 * POST /api/apply-discount
 *
 * Accepts the full Shopify cart + a coupon code, validates the code via
 * Shopify Admin GraphQL, calculates the exact discount server-side, and
 * returns the result — mirroring how production checkout services (GoKwik,
 * Razorpay Magic Checkout, etc.) work.
 *
 * No session cookies, no iframe tricks, no client-side math.
 * The frontend uses the returned discountAmount directly for display,
 * and passes the code to /checkout?discount=CODE for actual checkout.
 */
import { authenticate } from "../shopify.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

/* ── Route handler ───────────────────────────────────────────────────────── */

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { session, admin } = await authenticate.public.appProxy(request);

    if (!session?.shop || !admin) {
      return respond({ valid: false, reason: "Unauthorized" });
    }

    let body;
    try { body = await request.json(); } catch {
      return respond({ valid: false, reason: "Invalid request body" });
    }

    const { cart, couponCode } = body || {};
    const rawCode = (couponCode || "").trim();

    if (!rawCode) return respond({ valid: false, reason: "No discount code provided" });
    if (!cart?.items) return respond({ valid: false, reason: "Invalid cart data" });

    /* ── Step 1: validate via Shopify Admin GraphQL ── */
    const validation = await validateDiscount(admin, rawCode);
    if (!validation.valid) return respond(validation);

    /* ── Step 2: minimum requirement check against the actual cart ── */
    const mr = validation.minimumRequirement;
    if (mr) {
      if (mr.type === "quantity") {
        const itemCount = cart.items.reduce((s, i) => s + (i.quantity || 0), 0);
        if (itemCount < mr.quantity) {
          return respond({
            valid: false,
            reason: `Minimum of ${mr.quantity} item${mr.quantity !== 1 ? "s" : ""} required`,
          });
        }
      }
      if (mr.type === "subtotal") {
        const eligibleCents = getEligibleSubtotal(validation, cart);
        if (eligibleCents / 100 < mr.subtotal) {
          const fmt = formatMoney(mr.subtotal * 100, cart.currency);
          return respond({ valid: false, reason: `Minimum purchase of ${fmt} required` });
        }
      }
    }

    /* ── Step 3: calculate exact discount amount ── */
    const discountAmount = calcDiscount(validation, cart); // cents

    /* ── Step 4: product eligibility guard ── */
    if (!validation.appliesToAll
        && validation.type !== "bxgy"
        && validation.type !== "free_shipping"
        && validation.productIds?.length > 0
        && discountAmount === 0) {
      return respond({ valid: false, reason: "No eligible items in cart for this discount" });
    }

    const originalPrice = cart.original_total_price ?? cart.total_price ?? 0;
    const finalPrice    = Math.max(0, originalPrice - discountAmount);
    const currency      = cart.currency || "USD";

    let message;
    if (discountAmount > 0) {
      message = "You save " + formatMoney(discountAmount, currency) + "!";
    } else if (validation.type === "free_shipping") {
      message = "Free shipping applied!";
    } else if (validation.type === "bxgy") {
      message = validation.description || "Buy X Get Y applied!";
    } else {
      message = "Applied at checkout";
    }

    return respond({
      valid:          true,
      code:           rawCode.toUpperCase(),
      type:           validation.type,
      description:    validation.description,
      discountAmount,   // cents — use this for UI display
      originalPrice,    // cents — cart subtotal before discount
      finalPrice,       // cents — what the customer pays
      savings:          discountAmount,
      message,
      currency,
    });

  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("read_discounts")) {
      console.warn("[EdgeCart] Missing read_discounts scope");
      return respond({ valid: false, reason: "Discount validation unavailable — please contact support" });
    }
    console.error("[EdgeCart] apply-discount error:", err);
    return respond({ valid: false, reason: "Could not apply discount. Please try again." });
  }
};

/* ── Server-side discount calculation ───────────────────────────────────── */

function getEligibleSubtotal(discount, cart) {
  if (discount.appliesToAll) {
    return cart.original_total_price ?? cart.total_price ?? 0;
  }
  return cart.items.reduce((sum, item) => {
    const pid = "gid://shopify/Product/" + (item.product_id ?? item.productId ?? "");
    const vid = "gid://shopify/ProductVariant/" + (item.variant_id ?? item.variantId ?? "");
    const eligible =
      (discount.productIds ?? []).includes(pid) ||
      (discount.variantIds ?? []).includes(vid);
    const lineTotal = item.original_line_price ?? item.originalLinePrice ?? item.line_price ?? item.linePrice ?? 0;
    return eligible ? sum + lineTotal : sum;
  }, 0);
}

function calcDiscount(discount, cart) {
  const { type, value, appliesToAll, productIds, variantIds, appliesOnEachItem } = discount;

  /* Free shipping and BXGY don't reduce the cart total (handled by Shopify at checkout) */
  if (type === "free_shipping" || type === "bxgy") return 0;

  if (type === "percentage") {
    /* value is 0–1 (e.g. 0.1 = 10%). Apply to the eligible subtotal. */
    const eligible = getEligibleSubtotal(discount, cart);
    return Math.round(eligible * value);
  }

  if (type === "fixed_amount") {
    if (appliesToAll) {
      const subtotal = cart.original_total_price ?? cart.total_price ?? 0;
      return Math.min(value, subtotal);
    }
    const eligibleItems = cart.items.filter(item => {
      const pid = "gid://shopify/Product/" + (item.product_id ?? item.productId ?? "");
      const vid = "gid://shopify/ProductVariant/" + (item.variant_id ?? item.variantId ?? "");
      return (productIds ?? []).includes(pid) || (variantIds ?? []).includes(vid);
    });
    if (appliesOnEachItem) {
      /* e.g. $5 off each eligible item */
      return eligibleItems.reduce((sum, item) => {
        const qty       = item.quantity || 1;
        const lineTotal = item.original_line_price ?? item.originalLinePrice ?? item.line_price ?? item.linePrice ?? 0;
        return sum + Math.min(value * qty, lineTotal);
      }, 0);
    }
    const eligibleSubtotal = eligibleItems.reduce((sum, item) => {
      return sum + (item.original_line_price ?? item.originalLinePrice ?? item.line_price ?? item.linePrice ?? 0);
    }, 0);
    return Math.min(value, eligibleSubtotal);
  }

  return 0;
}

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return "$" + (cents / 100).toFixed(2);
  }
}

/* ── Shopify Admin GraphQL discount validation ───────────────────────────── */

async function validateDiscount(admin, rawCode) {
  const result = await admin.graphql(
    `#graphql
    query validateDiscount($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            __typename
            title status usageLimit asyncUsageCount startsAt endsAt appliesOncePerCustomer
            minimumRequirement {
              ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
              ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
            }
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
              }
              items {
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts {
                  products(first: 100) { nodes { id } }
                  productVariants(first: 100) { nodes { id } }
                }
                ... on DiscountCollections { collections(first: 50) { nodes { id } } }
              }
            }
          }
          ... on DiscountCodeBxgy {
            __typename
            title status usageLimit asyncUsageCount startsAt endsAt
            customerBuys {
              value { ... on DiscountQuantity { quantity } }
              items {
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts { products(first: 100) { nodes { id } } }
              }
            }
            customerGets {
              value {
                ... on DiscountQuantity { quantity }
                ... on DiscountPercentage { percentage }
              }
              items {
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts { products(first: 100) { nodes { id } } }
              }
            }
          }
          ... on DiscountCodeFreeShipping {
            __typename
            title status usageLimit asyncUsageCount startsAt endsAt
            minimumRequirement {
              ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
              ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
            }
          }
        }
      }
    }`,
    { variables: { code: rawCode } }
  );

  const gqlJson = await result.json();
  const node    = gqlJson.data?.codeDiscountNodeByCode;
  if (!node) return { valid: false, reason: "Discount code not found" };

  const d = node.codeDiscount;
  if (!d) return { valid: false, reason: "Invalid discount code" };

  const now = new Date();
  if (d.status === "EXPIRED" || (d.endsAt && new Date(d.endsAt) < now)) {
    return { valid: false, reason: "This discount code has expired" };
  }
  if (d.status === "SCHEDULED" || (d.startsAt && new Date(d.startsAt) > now)) {
    return { valid: false, reason: "This discount code is not yet active" };
  }
  if (d.status !== "ACTIVE") {
    return { valid: false, reason: "This discount code is not active" };
  }
  if (d.usageLimit != null && (d.asyncUsageCount ?? 0) >= d.usageLimit) {
    return { valid: false, reason: "This discount code has reached its usage limit" };
  }

  let minimumRequirement = null;
  if (d.minimumRequirement) {
    const mr = d.minimumRequirement;
    if (mr.greaterThanOrEqualToQuantity !== undefined) {
      minimumRequirement = { type: "quantity", quantity: parseInt(mr.greaterThanOrEqualToQuantity, 10) };
    } else if (mr.greaterThanOrEqualToSubtotal?.amount !== undefined) {
      minimumRequirement = {
        type:     "subtotal",
        subtotal: parseFloat(mr.greaterThanOrEqualToSubtotal.amount),
      };
    }
  }

  const typeName = d.__typename;
  let type = "free_shipping", value = 0, appliesToAll = true;
  let productIds = [], variantIds = [], collectionIds = [];
  let appliesOnEachItem = false, description = "";

  if (typeName === "DiscountCodeBasic") {
    const val   = d.customerGets?.value;
    const items = d.customerGets?.items;
    if (val?.percentage !== undefined) {
      type  = "percentage";
      value = val.percentage;
      description = `${Math.round(val.percentage * 100)}% off`;
    } else if (val?.amount?.amount !== undefined) {
      type             = "fixed_amount";
      value            = Math.round(parseFloat(val.amount.amount) * 100);
      appliesOnEachItem = val.appliesOnEachItem ?? false;
      description = `${formatMoney(value, val.amount.currencyCode)} off${appliesOnEachItem ? " each item" : ""}`;
    }
    if (items?.allItems) {
      appliesToAll = true; description += " your order";
    } else if (items?.products) {
      appliesToAll = false;
      productIds   = (items.products.nodes ?? []).map(n => n.id);
      variantIds   = (items.productVariants?.nodes ?? []).map(n => n.id);
      description  += " on select items";
    } else if (items?.collections) {
      appliesToAll  = false;
      collectionIds = (items.collections.nodes ?? []).map(n => n.id);
      description   += " on select collections";
    } else {
      appliesToAll = true; description += " your order";
    }
  } else if (typeName === "DiscountCodeBxgy") {
    type = "bxgy"; appliesToAll = false;
    const buyQty = d.customerBuys?.value?.quantity;
    const getQty = d.customerGets?.value?.quantity;
    const getPct = d.customerGets?.value?.percentage;
    description  = buyQty && getQty
      ? `Buy ${buyQty} Get ${getQty}${getPct ? ` (${Math.round(getPct * 100)}% off)` : " Free"}`
      : "Buy X Get Y discount";
    if (d.customerBuys?.items?.products) {
      productIds = (d.customerBuys.items.products.nodes ?? []).map(n => n.id);
    }
  } else {
    type = "free_shipping"; description = "Free shipping";
  }

  return {
    valid: true,
    type, value, appliesToAll, productIds, variantIds, collectionIds,
    appliesOnEachItem, minimumRequirement, description,
    title: d.title || rawCode.toUpperCase(),
  };
}
