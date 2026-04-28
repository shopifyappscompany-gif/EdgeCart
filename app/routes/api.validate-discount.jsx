import { authenticate } from "../shopify.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { session, admin } = await authenticate.public.appProxy(request);

    if (!session?.shop || !admin) {
      return respond({ valid: false, reason: "Unauthorized" });
    }

    const url = new URL(request.url);
    const rawCode = (url.searchParams.get("code") || "").trim();

    if (!rawCode) {
      return respond({ valid: false, reason: "No discount code provided" });
    }

    const result = await admin.graphql(
      `#graphql
      query validateDiscount($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              __typename
              title
              status
              usageLimit
              asyncUsageCount
              startsAt
              endsAt
              appliesOncePerCustomer
              minimumRequirement {
                ... on DiscountMinimumQuantity {
                  greaterThanOrEqualToQuantity
                }
                ... on DiscountMinimumSubtotal {
                  greaterThanOrEqualToSubtotal { amount currencyCode }
                }
              }
              customerGets {
                value {
                  ... on DiscountPercentage { percentage }
                  ... on DiscountAmount {
                    amount { amount currencyCode }
                    appliesOnEachItem
                  }
                }
                items {
                  ... on AllDiscountItems { allItems }
                  ... on DiscountProducts {
                    products(first: 100) { nodes { id } }
                    productVariants(first: 100) { nodes { id } }
                  }
                  ... on DiscountCollections {
                    collections(first: 50) { nodes { id } }
                  }
                }
              }
            }
            ... on DiscountCodeBxgy {
              __typename
              title
              status
              usageLimit
              asyncUsageCount
              startsAt
              endsAt
              appliesOncePerCustomer
              customerBuys {
                value {
                  ... on DiscountQuantity { quantity }
                }
                items {
                  ... on AllDiscountItems { allItems }
                  ... on DiscountProducts { products(first: 100) { nodes { id } } }
                  ... on DiscountCollections { collections(first: 50) { nodes { id } } }
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
                  ... on DiscountCollections { collections(first: 50) { nodes { id } } }
                }
              }
            }
            ... on DiscountCodeFreeShipping {
              __typename
              title
              status
              usageLimit
              asyncUsageCount
              startsAt
              endsAt
              minimumRequirement {
                ... on DiscountMinimumQuantity {
                  greaterThanOrEqualToQuantity
                }
                ... on DiscountMinimumSubtotal {
                  greaterThanOrEqualToSubtotal { amount currencyCode }
                }
              }
            }
          }
        }
      }`,
      { variables: { code: rawCode } }
    );

    const gqlJson = await result.json();
    const node = gqlJson.data?.codeDiscountNodeByCode;

    if (!node) {
      return respond({ valid: false, reason: "Discount code not found" });
    }

    const d = node.codeDiscount;
    if (!d) {
      return respond({ valid: false, reason: "Invalid discount code" });
    }

    // ── Status checks ─────────────────────────────────────────
    const now = new Date();

    if (d.status === "EXPIRED" || (d.endsAt && new Date(d.endsAt) < now)) {
      return respond({ valid: false, reason: "This discount code has expired" });
    }
    if (d.status === "SCHEDULED" || (d.startsAt && new Date(d.startsAt) > now)) {
      return respond({ valid: false, reason: "This discount code is not yet active" });
    }
    if (d.status !== "ACTIVE") {
      return respond({ valid: false, reason: "This discount code is not active" });
    }

    // ── Usage limit ───────────────────────────────────────────
    if (d.usageLimit != null && (d.asyncUsageCount ?? 0) >= d.usageLimit) {
      return respond({ valid: false, reason: "This discount code has reached its usage limit" });
    }

    // ── Normalize minimum requirement ─────────────────────────
    let minimumRequirement = null;
    if (d.minimumRequirement) {
      const mr = d.minimumRequirement;
      if (mr.greaterThanOrEqualToQuantity !== undefined) {
        minimumRequirement = {
          type: "quantity",
          quantity: parseInt(mr.greaterThanOrEqualToQuantity, 10),
        };
      } else if (mr.greaterThanOrEqualToSubtotal?.amount !== undefined) {
        minimumRequirement = {
          type: "subtotal",
          subtotal: parseFloat(mr.greaterThanOrEqualToSubtotal.amount),
          currencyCode: mr.greaterThanOrEqualToSubtotal.currencyCode || "USD",
        };
      }
    }

    // ── Build normalized discount payload ─────────────────────
    const typeName = d.__typename;
    let type = "free_shipping";
    let value = 0;
    let appliesToAll = true;
    let productIds = [];
    let variantIds = [];
    let collectionIds = [];
    let appliesOnEachItem = false;
    let description = "";

    if (typeName === "DiscountCodeBasic") {
      const val   = d.customerGets?.value;
      const items = d.customerGets?.items;

      if (val?.percentage !== undefined) {
        type  = "percentage";
        value = val.percentage; // 0–1 (e.g. 0.1 = 10%)
        description = `${Math.round(val.percentage * 100)}% off`;
      } else if (val?.amount?.amount !== undefined) {
        type             = "fixed_amount";
        value            = Math.round(parseFloat(val.amount.amount) * 100); // cents
        appliesOnEachItem = val.appliesOnEachItem ?? false;
        const amtStr = parseFloat(val.amount.amount).toFixed(2);
        description = `$${amtStr} off${appliesOnEachItem ? " each item" : ""}`;
      }

      if (items?.allItems) {
        appliesToAll = true;
        description  += " your order";
      } else if (items?.products) {
        appliesToAll = false;
        productIds   = (items.products.nodes ?? []).map((n) => n.id);
        variantIds   = (items.productVariants?.nodes ?? []).map((n) => n.id);
        description  += " on select items";
      } else if (items?.collections) {
        appliesToAll  = false;
        collectionIds = (items.collections.nodes ?? []).map((n) => n.id);
        description   += " on select collections";
      } else {
        appliesToAll = true;
        description  += " your order";
      }
    } else if (typeName === "DiscountCodeBxgy") {
      type         = "bxgy";
      appliesToAll = false;
      const buys   = d.customerBuys;
      const gets   = d.customerGets;
      const buyQty = buys?.value?.quantity;
      const getQty = gets?.value?.quantity;
      const getPct = gets?.value?.percentage;
      description  = buyQty && getQty
        ? `Buy ${buyQty} Get ${getQty}${getPct ? ` (${Math.round(getPct * 100)}% off)` : " Free"}`
        : "Buy X Get Y discount";
      const buyItems = buys?.items;
      if (buyItems?.products) {
        productIds = (buyItems.products.nodes ?? []).map((n) => n.id);
      }
    } else {
      // DiscountCodeFreeShipping
      type        = "free_shipping";
      description = "Free shipping";
    }

    return respond({
      valid: true,
      type,
      value,
      appliesToAll,
      productIds,
      variantIds,
      collectionIds,
      appliesOnEachItem,
      minimumRequirement,
      title: d.title || rawCode.toUpperCase(),
      description,
      endsAt: d.endsAt ?? null,
      usageLimit: d.usageLimit ?? null,
      asyncUsageCount: d.asyncUsageCount ?? 0,
      appliesOncePerCustomer: d.appliesOncePerCustomer ?? false,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("read_discounts")) {
      console.warn("[EdgeCart] Missing read_discounts scope — discount validation disabled");
      return respond({ valid: false, reason: "Discount validation unavailable — please contact support" });
    }
    console.error("[EdgeCart] Discount validation error:", err);
    return respond({ valid: false, reason: "Could not validate discount code. Please try again." });
  }
};
