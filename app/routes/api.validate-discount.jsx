import { authenticate } from "../shopify.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { session, admin } = await authenticate.public.appProxy(request);

    if (!session?.shop || !admin) {
      return new Response(JSON.stringify({ valid: false, reason: "Unauthorized" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const code = (url.searchParams.get("code") || "").trim();

    if (!code) {
      return new Response(JSON.stringify({ valid: false, reason: "No code provided" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const response = await admin.graphql(
      `#graphql
      query validateDiscount($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              status
              minimumRequirement {
                ... on DiscountMinimumQuantity {
                  greaterThanOrEqualToQuantity
                }
                ... on DiscountMinimumSubtotal {
                  greaterThanOrEqualToSubtotal {
                    amount
                    currencyCode
                  }
                }
              }
              customerGets {
                value {
                  ... on DiscountPercentage {
                    percentage
                  }
                  ... on DiscountAmount {
                    amount {
                      amount
                      currencyCode
                    }
                  }
                }
                items {
                  ... on AllDiscountItems {
                    allItems
                  }
                  ... on DiscountProducts {
                    products(first: 100) {
                      nodes { id }
                    }
                  }
                  ... on DiscountCollections {
                    collections(first: 50) {
                      nodes { id }
                    }
                  }
                }
              }
            }
            ... on DiscountCodeBxgy {
              title
              status
            }
            ... on DiscountCodeFreeShipping {
              title
              status
              minimumRequirement {
                ... on DiscountMinimumQuantity {
                  greaterThanOrEqualToQuantity
                }
                ... on DiscountMinimumSubtotal {
                  greaterThanOrEqualToSubtotal {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { code } }
    );

    const json = await response.json();
    const node = json.data?.codeDiscountNodeByCode;

    if (!node) {
      return new Response(JSON.stringify({ valid: false, reason: "Discount code not found" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const discount = node.codeDiscount;
    if (!discount) {
      return new Response(JSON.stringify({ valid: false, reason: "Invalid discount" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    if (discount.status && discount.status !== "ACTIVE") {
      return new Response(
        JSON.stringify({ valid: false, reason: "This discount is no longer active" }),
        { status: 200, headers: corsHeaders }
      );
    }

    let type = "free_shipping";
    let value = 0;
    let appliesToAll = true;
    let productIds = [];
    let minimumRequirement = null;

    // Parse minimumRequirement from basic or free shipping types
    if (discount.minimumRequirement) {
      const req = discount.minimumRequirement;
      if (req.greaterThanOrEqualToQuantity !== undefined) {
        minimumRequirement = {
          type: "quantity",
          quantity: parseInt(req.greaterThanOrEqualToQuantity, 10),
        };
      } else if (req.greaterThanOrEqualToSubtotal) {
        minimumRequirement = {
          type: "subtotal",
          subtotal: parseFloat(req.greaterThanOrEqualToSubtotal.amount),
        };
      }
    }

    if (discount.customerGets) {
      const val = discount.customerGets.value;
      if (val?.percentage !== undefined) {
        type = "percentage";
        value = val.percentage; // 0.1 = 10%
      } else if (val?.amount?.amount !== undefined) {
        type = "fixed_amount";
        value = Math.round(parseFloat(val.amount.amount) * 100); // cents
      }

      const items = discount.customerGets.items;
      if (items?.allItems) {
        appliesToAll = true;
      } else if (items?.products?.nodes?.length > 0) {
        appliesToAll = false;
        productIds = items.products.nodes.map((n) => n.id);
      } else {
        appliesToAll = true;
      }
    }

    return new Response(
      JSON.stringify({
        valid: true,
        type,
        value,
        appliesToAll,
        productIds,
        title: discount.title || code,
        minimumRequirement,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("read_discounts")) {
      console.warn("[EdgeCart] Missing read_discounts scope — discount validation disabled until app is re-authorized");
      return new Response(
        JSON.stringify({ valid: false, reason: "Discount validation unavailable — please contact support" }),
        { status: 200, headers: corsHeaders }
      );
    }
    console.error("[EdgeCart] Discount validation error:", err);
    return new Response(JSON.stringify({ valid: false, reason: "Could not validate discount" }), {
      status: 200,
      headers: corsHeaders,
    });
  }
};
