import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.cartSettings.findUnique({ where: { shop: session.shop } });
  return { settings };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "createFreebieProduct") {
    const sourceTitle = String(form.get("sourceTitle") || "Free Gift");
    const sourceImageUrl = form.get("sourceImageUrl") ? String(form.get("sourceImageUrl")) : null;

    // Step 1: Create the product — also fetch inventoryItem ID for step 3
    const createRes = await admin.graphql(
      `#graphql
      mutation createFreebieProduct($input: ProductCreateInput!) {
        productCreate(product: $input) {
          product {
            id
            variants(first: 1) {
              edges { node { id } }
            }
            featuredImage { url }
          }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            title: `${sourceTitle} — Free Gift`,
            status: "ACTIVE",
            tags: ["edge-cart-freebie"],
          },
        },
      }
    );

    const createJson = await createRes.json();
    const createErrors = createJson.data?.productCreate?.userErrors;
    if (createErrors?.length) {
      return { error: createErrors[0].message };
    }

    const product = createJson.data?.productCreate?.product;
    const variantNode = product?.variants?.edges?.[0]?.node;
    const variantId = variantNode?.id;
    const productId = product?.id;
    const imageUrl = sourceImageUrl || product?.featuredImage?.url || null;

    if (!variantId || !productId) {
      return { error: "Failed to create product." };
    }

    // Step 2: Set the default variant price to $0.00 and allow selling when out of stock
    const updateRes = await admin.graphql(
      `#graphql
      mutation updateFreebieVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId,
          variants: [{ id: variantId, price: "0.00", inventoryPolicy: "CONTINUE" }],
        },
      }
    );

    const updateJson = await updateRes.json();
    const updateErrors = updateJson.data?.productVariantsBulkUpdate?.userErrors;
    if (updateErrors?.length) {
      return { error: updateErrors[0].message };
    }

    await prisma.cartSettings.upsert({
      where: { shop },
      create: { shop, freebieProductVariantId: variantId, freebieProductTitle: sourceTitle, freebieProductImageUrl: imageUrl },
      update: { freebieProductVariantId: variantId, freebieProductTitle: sourceTitle, freebieProductImageUrl: imageUrl },
    });

    return {
      success: true,
      message: "Free gift product created and saved!",
      freebieVariantId: variantId,
      freebieProductTitle: sourceTitle,
      freebieProductImageUrl: imageUrl,
    };
  }

  // Save freebie settings
  const data = {
    freebieEnabled: form.get("freebieEnabled") === "true",
    freebieTitle: String(form.get("freebieTitle") || "🎁 You've earned a free gift!"),
    freebieTriggerType: String(form.get("freebieTriggerType") || "cartValue"),
    freebieMinCartValue: parseFloat(form.get("freebieMinCartValue") || "100"),
    freebieMinQuantity: parseInt(form.get("freebieMinQuantity") || "3", 10),
    freebieTriggerProductIds: String(form.get("freebieTriggerProductIds") || "[]"),
  };

  const fvId = form.get("freebieProductVariantId");
  const fvTitle = form.get("freebieProductTitle");
  const fvImage = form.get("freebieProductImageUrl");
  data.freebieProductVariantId = fvId ? String(fvId) : null;
  data.freebieProductTitle = fvTitle ? String(fvTitle) : null;
  data.freebieProductImageUrl = fvImage ? String(fvImage) : null;

  await prisma.cartSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });

  return { success: true, message: "Freebie settings saved!" };
};

export default function FreebieSettings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";
  const s = settings || {};

  const [enabled, setEnabled] = useState(s.freebieEnabled ?? false);
  const [title, setTitle] = useState(s.freebieTitle ?? "🎁 You've earned a free gift!");
  const [triggerType, setTriggerType] = useState(s.freebieTriggerType ?? "cartValue");
  const [minCartValue, setMinCartValue] = useState(s.freebieMinCartValue ?? 100);
  const [minQty, setMinQty] = useState(s.freebieMinQuantity ?? 3);
  const [triggerProducts, setTriggerProducts] = useState(() => safeJSON(s.freebieTriggerProductIds, []));
  const [freebieVariantId, setFreebieVariantId] = useState(s.freebieProductVariantId ?? "");
  const [freebieProductTitle, setFreebieProductTitle] = useState(s.freebieProductTitle ?? "");
  const [freebieProductImage, setFreebieProductImage] = useState(s.freebieProductImageUrl ?? "");
  const [creating, setCreating] = useState(false);

  /* Sync state when React Router revalidates the loader after an action */
  useEffect(() => {
    setEnabled(s.freebieEnabled ?? false);
    setTitle(s.freebieTitle ?? "🎁 You've earned a free gift!");
    setTriggerType(s.freebieTriggerType ?? "cartValue");
    setMinCartValue(s.freebieMinCartValue ?? 100);
    setMinQty(s.freebieMinQuantity ?? 3);
    setTriggerProducts(safeJSON(s.freebieTriggerProductIds, []));
    setFreebieVariantId(s.freebieProductVariantId ?? "");
    setFreebieProductTitle(s.freebieProductTitle ?? "");
    setFreebieProductImage(s.freebieProductImageUrl ?? "");
  }, [settings]);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(fetcher.data.message || "Saved!");
      if (fetcher.data.freebieVariantId) {
        setFreebieVariantId(fetcher.data.freebieVariantId);
        setFreebieProductTitle(fetcher.data.freebieProductTitle || "");
        setFreebieProductImage(fetcher.data.freebieProductImageUrl || "");
      }
      setCreating(false);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
      setCreating(false);
    }
  }, [fetcher.data]);

  async function pickAndCreateFreebieProduct() {
    const selected = await shopify.resourcePicker({ type: "product", multiple: false, action: "select" });
    if (!selected || !selected.length) return;
    const p = selected[0];
    setCreating(true);
    fetcher.submit(
      {
        intent: "createFreebieProduct",
        sourceTitle: p.title,
        sourceImageUrl: p.images?.[0]?.originalSrc || p.images?.[0]?.src || "",
      },
      { method: "POST" }
    );
  }

  async function pickTriggerProducts() {
    const selected = await shopify.resourcePicker({ type: "product", multiple: 10, action: "select" });
    if (selected && selected.length > 0) {
      setTriggerProducts(selected.map((p) => ({ id: p.id, title: p.title })));
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    fetcher.submit(
      {
        freebieEnabled: String(enabled),
        freebieTitle: title,
        freebieTriggerType: triggerType,
        freebieMinCartValue: String(minCartValue),
        freebieMinQuantity: String(minQty),
        freebieTriggerProductIds: JSON.stringify(triggerProducts),
        freebieProductVariantId: freebieVariantId,
        freebieProductTitle: freebieProductTitle,
        freebieProductImageUrl: freebieProductImage,
      },
      { method: "POST" }
    );
  }

  const hasFreebieProduct = !!freebieVariantId;

  return (
    <s-page heading="Free Gift (Freebie) Settings">
      <s-button
        slot="primary-action"
        onClick={handleSubmit}
        variant="primary"
        loading={saving && !creating ? true : undefined}
      >
        Save Freebie Settings
      </s-button>

      {/* Enable toggle */}
      <s-section heading="Free Gift Feature">
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <strong style={{ fontSize: 14 }}>Enable Free Gift</strong>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666" }}>
                Offer a free product when customers reach a spending or quantity threshold.
              </p>
            </div>
            <ToggleSwitch value={enabled} onChange={setEnabled} />
          </div>

          {enabled && (
            <div>
              <label style={labelStyle}>Gift Banner Text</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={inputStyle}
                placeholder="🎁 You've earned a free gift!"
              />
              <p style={helpText}>Shown inside the side cart when the gift is unlocked.</p>
            </div>
          )}
        </s-stack>
      </s-section>

      {/* Trigger condition */}
      {enabled && (
        <s-section heading="Unlock Gift When…">
          <s-stack direction="block" gap="base">
            <div>
              <label style={labelStyle}>Trigger Condition</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value)}
                style={selectStyle}
              >
                <option value="cartValue">Cart value reaches a minimum amount</option>
                <option value="quantity">Cart contains minimum number of items</option>
                <option value="product">Cart contains specific products</option>
              </select>
            </div>

            {triggerType === "cartValue" && (
              <div>
                <label style={labelStyle}>Minimum Cart Value ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minCartValue}
                  onChange={(e) => setMinCartValue(e.target.value)}
                  style={{ ...inputStyle, width: 160 }}
                />
                <p style={helpText}>Show gift progress bar below this; unlock above it.</p>
              </div>
            )}

            {triggerType === "quantity" && (
              <div>
                <label style={labelStyle}>Minimum Item Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={minQty}
                  onChange={(e) => setMinQty(e.target.value)}
                  style={{ ...inputStyle, width: 120 }}
                />
                <p style={helpText}>Unlock free gift when cart has at least this many items.</p>
              </div>
            )}

            {triggerType === "product" && (
              <div>
                <label style={labelStyle}>Trigger Products</label>
                <p style={{ ...helpText, marginBottom: 10 }}>
                  Unlock gift only when one of these products is in cart.
                </p>
                <button type="button" onClick={pickTriggerProducts} style={pickerBtn}>
                  + Select Trigger Products
                </button>
                {triggerProducts.length > 0 && (
                  <ProductChips
                    products={triggerProducts}
                    onRemove={(id) => setTriggerProducts(triggerProducts.filter((p) => p.id !== id))}
                  />
                )}
              </div>
            )}
          </s-stack>
        </s-section>
      )}

      {/* Free gift product selection */}
      {enabled && (
        <s-section heading="Free Gift Product">
          <s-stack direction="block" gap="base">
            {creating ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "#555" }}>
                <p style={{ margin: 0, fontSize: 14 }}>Creating free gift product on Shopify…</p>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#999" }}>This takes a few seconds.</p>
              </div>
            ) : hasFreebieProduct ? (
              <div style={productCard}>
                {freebieProductImage && (
                  <img
                    src={freebieProductImage}
                    alt={freebieProductTitle}
                    style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{freebieProductTitle}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#008060", fontWeight: 600 }}>
                    ✓ Free gift product ready ($0.00)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFreebieVariantId("");
                    setFreebieProductTitle("");
                    setFreebieProductImage("");
                  }}
                  style={removeBtn}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
                  Select any product from your store. EdgeCart will automatically create a{" "}
                  <strong>$0.00 copy</strong> of it that gets added to customers' carts as the free gift.
                </p>
                <button type="button" onClick={pickAndCreateFreebieProduct} style={pickerBtn}>
                  + Select Free Gift Product
                </button>
              </>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Free Gift Tips">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            The free gift creates a{" "}
            <s-text fontWeight="bold">progress bar</s-text> in the side cart showing customers how
            close they are to unlocking the reward.
          </s-paragraph>
          <s-paragraph>
            Once unlocked, a one-tap{" "}
            <s-text fontWeight="bold">"Add Free Gift"</s-text> button appears.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Tip:</s-text> Set the threshold slightly above your average
            order value to encourage higher spending.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function ToggleSwitch({ value, onChange }) {
  return (
    <label style={{ display: "inline-flex", cursor: "pointer", flexShrink: 0 }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ display: "none" }}
      />
      <span
        style={{
          display: "inline-flex",
          width: 44,
          height: 24,
          borderRadius: 12,
          padding: 2,
          background: value ? "#008060" : "#ccc",
          transition: "background 0.2s",
          alignItems: "center",
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
            transition: "transform 0.2s",
            transform: value ? "translateX(20px)" : "translateX(2px)",
            display: "block",
          }}
        />
      </span>
    </label>
  );
}

function ProductChips({ products, onRemove }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {products.map((p) => (
        <div
          key={p.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            background: "#f0f4ff",
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {p.title}
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#666", padding: 0, fontSize: 14 }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 6 };
const helpText = { margin: "6px 0 0", fontSize: 12, color: "#888" };
const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1.5px solid #e0e0e0",
  borderRadius: 8,
  fontSize: 14,
  color: "#111",
  outline: "none",
  boxSizing: "border-box",
  background: "#fafafa",
};
const selectStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1.5px solid #e0e0e0",
  borderRadius: 8,
  fontSize: 14,
  color: "#111",
  background: "#fafafa",
  outline: "none",
  cursor: "pointer",
};
const pickerBtn = {
  padding: "9px 16px",
  border: "1.5px dashed #008060",
  borderRadius: 8,
  background: "#f0faf5",
  color: "#008060",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const productCard = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  border: "1.5px solid #e8e8e8",
  borderRadius: 10,
  background: "#fafafa",
};
const removeBtn = {
  background: "none",
  border: "1px solid #ddd",
  cursor: "pointer",
  color: "#555",
  fontSize: 13,
  padding: "6px 10px",
  borderRadius: 6,
  fontWeight: 500,
};

function safeJSON(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
