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
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();

  const data = {
    upsellEnabled: form.get("upsellEnabled") === "true",
    upsellTitle: String(form.get("upsellTitle") || "You might also like"),
    upsellTriggerType: String(form.get("upsellTriggerType") || "cartValue"),
    upsellMinCartValue: parseFloat(form.get("upsellMinCartValue") || "50"),
    upsellMinQuantity: parseInt(form.get("upsellMinQuantity") || "2", 10),
    upsellProducts: String(form.get("upsellProducts") || "[]"),
    upsellTriggerProductIds: String(form.get("upsellTriggerProductIds") || "[]"),
  };

  await prisma.cartSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });

  return { success: true };
};

export default function UpsellSettings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";
  const s = settings || {};

  const [enabled, setEnabled] = useState(s.upsellEnabled ?? false);
  const [title, setTitle] = useState(s.upsellTitle ?? "You might also like");
  const [triggerType, setTriggerType] = useState(s.upsellTriggerType ?? "cartValue");
  const [minCartValue, setMinCartValue] = useState(s.upsellMinCartValue ?? 50);
  const [minQty, setMinQty] = useState(s.upsellMinQuantity ?? 2);
  const [upsellProducts, setUpsellProducts] = useState(() => safeJSON(s.upsellProducts, []));
  const [triggerProducts, setTriggerProducts] = useState(() => safeJSON(s.upsellTriggerProductIds, []));

  useEffect(() => {
    if (fetcher.data?.success) shopify.toast.show("Upsell settings saved!");
  }, [fetcher.data]);

  async function pickUpsellProducts() {
    const selected = await shopify.resourcePicker({ type: "product", multiple: 5, action: "select" });
    if (selected && selected.length > 0) {
      const mapped = selected.map((p) => ({
        id: p.id,
        title: p.title,
        handle: p.handle,
        featuredImage: p.images?.[0] ? { url: p.images[0].originalSrc || p.images[0].src } : null,
        variants: (p.variants || []).slice(0, 1).map((v) => ({
          id: v.id,
          title: v.displayName || v.title,
          price: v.price,
        })),
      }));
      setUpsellProducts(mapped);
    }
  }

  async function pickTriggerProducts() {
    const selected = await shopify.resourcePicker({ type: "product", multiple: 10, action: "select" });
    if (selected && selected.length > 0) {
      const mapped = selected.map((p) => ({ id: p.id, title: p.title }));
      setTriggerProducts(mapped);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    fetcher.submit(
      {
        upsellEnabled: String(enabled),
        upsellTitle: title,
        upsellTriggerType: triggerType,
        upsellMinCartValue: String(minCartValue),
        upsellMinQuantity: String(minQty),
        upsellProducts: JSON.stringify(upsellProducts),
        upsellTriggerProductIds: JSON.stringify(triggerProducts),
      },
      { method: "POST" }
    );
  }

  return (
    <s-page heading="Upsell Settings">
      <s-button slot="primary-action" onClick={handleSubmit} variant="primary" loading={saving ? true : undefined}>
        Save Upsell Settings
      </s-button>

      {/* Enable toggle */}
      <s-section heading="Upsell Feature">
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <strong style={{ fontSize: 14 }}>Enable Upsell</strong>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666" }}>
                Show targeted product recommendations inside the side cart.
              </p>
            </div>
            <ToggleSwitch value={enabled} onChange={setEnabled} />
          </div>

          {enabled && (
            <div>
              <label style={labelStyle}>Section Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={inputStyle}
                placeholder="You might also like"
              />
            </div>
          )}
        </s-stack>
      </s-section>

      {/* Trigger condition */}
      {enabled && (
        <s-section heading="Show Upsell When…">
          <s-stack direction="block" gap="base">
            <div>
              <label style={labelStyle}>Trigger Condition</label>
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} style={selectStyle}>
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
                <p style={helpText}>Show upsell when cart subtotal ≥ this value.</p>
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
                <p style={helpText}>Show upsell when cart has at least this many items.</p>
              </div>
            )}

            {triggerType === "product" && (
              <div>
                <label style={labelStyle}>Trigger Products</label>
                <p style={{ ...helpText, marginBottom: 10 }}>
                  Upsell appears only when one of these products is in the cart.
                </p>
                <button type="button" onClick={pickTriggerProducts} style={pickerBtn}>
                  + Select Trigger Products
                </button>
                {triggerProducts.length > 0 && (
                  <ProductChips products={triggerProducts} onRemove={(id) => setTriggerProducts(triggerProducts.filter((p) => p.id !== id))} />
                )}
              </div>
            )}
          </s-stack>
        </s-section>
      )}

      {/* Product selection */}
      {enabled && (
        <s-section heading="Upsell Products to Display">
          <s-stack direction="block" gap="base">
            <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
              Select up to 5 products to show as upsell recommendations. Only products not already in the cart are shown.
            </p>
            <button type="button" onClick={pickUpsellProducts} style={pickerBtn}>
              + Select Upsell Products
            </button>

            {upsellProducts.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                {upsellProducts.map((p) => (
                  <div key={p.id} style={productCard}>
                    {p.featuredImage?.url && (
                      <img src={p.featuredImage.url} alt={p.title} style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{p.title}</p>
                      {p.variants?.[0]?.price && (
                        <p style={{ margin: "2px 0 0", fontSize: 13, color: "#666" }}>${p.variants[0].price}</p>
                      )}
                    </div>
                    <button type="button" onClick={() => setUpsellProducts(upsellProducts.filter((x) => x.id !== p.id))} style={removeBtn}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="How Upsell Works">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            When the trigger condition is met, a "You might also like" section appears at the bottom of the side cart.
          </s-paragraph>
          <s-paragraph>
            Customers can add upsell items with one tap. Products already in the cart are automatically hidden.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Tip:</s-text> Use complementary or frequently-bought-together products for best results.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function ToggleSwitch({ value, onChange }) {
  return (
    <label style={{ display: "inline-flex", cursor: "pointer", flexShrink: 0 }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} style={{ display: "none" }} />
      <span style={{ display: "inline-flex", width: 44, height: 24, borderRadius: 12, padding: 2, background: value ? "#008060" : "#ccc", transition: "background 0.2s", alignItems: "center" }}>
        <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.25)", transition: "transform 0.2s", transform: value ? "translateX(20px)" : "translateX(2px)", display: "block" }} />
      </span>
    </label>
  );
}

function ProductChips({ products, onRemove }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {products.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#f0f4ff", borderRadius: 20, fontSize: 13, fontWeight: 500 }}>
          {p.title}
          <button type="button" onClick={() => onRemove(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666", padding: 0, fontSize: 14 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 6 };
const helpText = { margin: "6px 0 0", fontSize: 12, color: "#888" };
const inputStyle = {
  width: "100%", padding: "9px 12px", border: "1.5px solid #e0e0e0", borderRadius: 8,
  fontSize: 14, color: "#111", outline: "none", boxSizing: "border-box", background: "#fafafa",
};
const selectStyle = {
  width: "100%", padding: "9px 12px", border: "1.5px solid #e0e0e0", borderRadius: 8,
  fontSize: 14, color: "#111", background: "#fafafa", outline: "none", cursor: "pointer",
};
const pickerBtn = {
  padding: "9px 16px", border: "1.5px dashed #008060", borderRadius: 8,
  background: "#f0faf5", color: "#008060", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const productCard = {
  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
  border: "1.5px solid #e8e8e8", borderRadius: 10, background: "#fafafa",
};
const removeBtn = {
  background: "none", border: "none", cursor: "pointer", color: "#bbb", fontSize: 16,
  padding: "4px 6px", borderRadius: 6, transition: "color 0.15s",
};

function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
