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
    offersEnabled: form.get("offersEnabled") === "true",
    configuredDiscounts: String(form.get("configuredDiscounts") || "[]"),
    autoDiscountEnabled: form.get("autoDiscountEnabled") === "true",
    autoDiscountMode: String(form.get("autoDiscountMode") || "exact"),
    autoDiscountCode: String(form.get("autoDiscountCode") || ""),
  };

  await prisma.cartSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });

  return { success: true };
};

export default function DiscountSettings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";
  const s = settings || {};

  const [offersEnabled, setOffersEnabled] = useState(s.offersEnabled ?? false);
  const [configuredDiscounts, setConfiguredDiscounts] = useState(() =>
    safeJSON(s.configuredDiscounts, [])
  );
  const [newCode, setNewCode] = useState("");
  const [autoEnabled, setAutoEnabled] = useState(s.autoDiscountEnabled ?? false);
  const [autoMode, setAutoMode] = useState(s.autoDiscountMode ?? "exact");
  const [autoCode, setAutoCode] = useState(s.autoDiscountCode ?? "");

  useEffect(() => {
    setOffersEnabled(s.offersEnabled ?? false);
    setConfiguredDiscounts(safeJSON(s.configuredDiscounts, []));
    setAutoEnabled(s.autoDiscountEnabled ?? false);
    setAutoMode(s.autoDiscountMode ?? "exact");
    setAutoCode(s.autoDiscountCode ?? "");
  }, [settings]);

  useEffect(() => {
    if (fetcher.data?.success) shopify.toast.show("Discount settings saved!");
  }, [fetcher.data]);

  function addCode() {
    const code = newCode.trim().toUpperCase();
    if (!code || configuredDiscounts.includes(code)) return;
    setConfiguredDiscounts([...configuredDiscounts, code]);
    setNewCode("");
  }

  function removeCode(code) {
    setConfiguredDiscounts(configuredDiscounts.filter((c) => c !== code));
  }

  function handleSubmit(e) {
    e.preventDefault();
    fetcher.submit(
      {
        offersEnabled: String(offersEnabled),
        configuredDiscounts: JSON.stringify(configuredDiscounts),
        autoDiscountEnabled: String(autoEnabled),
        autoDiscountMode: autoMode,
        autoDiscountCode: autoCode,
      },
      { method: "POST" }
    );
  }

  return (
    <s-page heading="Discount Settings">
      <s-button
        slot="primary-action"
        onClick={handleSubmit}
        variant="primary"
        loading={saving ? true : undefined}
      >
        Save
      </s-button>

      {/* View Offers */}
      <s-section heading="View Offers Panel">
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <strong style={{ fontSize: 14 }}>Enable View Offers</strong>
              <p style={helpText}>
                Show a collapsible "View Offers" section in the cart. Customers see all configured
                discount codes and can apply any with one click.
              </p>
            </div>
            <ToggleSwitch value={offersEnabled} onChange={setOffersEnabled} />
          </div>

          {offersEnabled && (
            <>
              <div>
                <label style={labelStyle}>Add Discount Codes</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCode();
                      }
                    }}
                    placeholder="e.g. SAVE10"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button type="button" onClick={addCode} style={addBtnStyle}>
                    + Add
                  </button>
                </div>
                <p style={helpText}>
                  Enter codes exactly as created in{" "}
                  <strong>Shopify Admin → Discounts</strong>. Customers see a description of
                  the discount and minimum requirements, if any.
                </p>
              </div>

              {configuredDiscounts.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {configuredDiscounts.map((code) => (
                    <div key={code} style={codeRowStyle}>
                      <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>
                        {code}
                      </span>
                      <button type="button" onClick={() => removeCode(code)} style={removeBtnStyle}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "#999", margin: 0 }}>
                  No discount codes added yet.
                </p>
              )}
            </>
          )}
        </s-stack>
      </s-section>

      {/* Auto-Apply */}
      <s-section heading="Auto-Apply Discount">
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <strong style={{ fontSize: 14 }}>Auto-Apply a Discount</strong>
              <p style={helpText}>
                Automatically pre-apply a discount when customers open the cart. They can remove
                it or type a different code at any time.
              </p>
            </div>
            <ToggleSwitch value={autoEnabled} onChange={setAutoEnabled} />
          </div>

          {autoEnabled && (
            <>
              <div>
                <label style={labelStyle}>Auto-Apply Mode</label>
                <select
                  value={autoMode}
                  onChange={(e) => setAutoMode(e.target.value)}
                  style={selectStyle}
                >
                  <option value="exact">Exact code — apply one specific code</option>
                  <option value="max">Best discount — apply the code with the highest savings</option>
                  <option value="min">Minimum discount — apply the code with the lowest savings</option>
                </select>
                {(autoMode === "max" || autoMode === "min") && (
                  <p style={helpText}>
                    Uses the discount codes from the <strong>View Offers</strong> list above. Make
                    sure at least one code is added.
                  </p>
                )}
              </div>

              {autoMode === "exact" && (
                <div>
                  <label style={labelStyle}>Code to Auto-Apply</label>
                  <input
                    type="text"
                    value={autoCode}
                    onChange={(e) => setAutoCode(e.target.value.toUpperCase())}
                    placeholder="e.g. WELCOME10"
                    style={{ ...inputStyle, width: 260 }}
                  />
                  <p style={helpText}>
                    Pre-filled in the discount field when the cart opens. Customers can remove or
                    override it.
                  </p>
                </div>
              )}
            </>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How Discounts Work">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text fontWeight="bold">View Offers</s-text> shows a panel inside the cart listing
            your configured codes. Each code shows the discount type and any minimum requirement.
            Customers click Apply to validate and use the code.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Auto-Apply</s-text> silently applies the best matching code
            when the cart opens. If mode is <s-text fontWeight="bold">Best discount</s-text> or{" "}
            <s-text fontWeight="bold">Minimum discount</s-text>, it checks all codes in your View
            Offers list and picks accordingly.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Manual entry</s-text> is always available — customers can
            type any code in the discount field. EdgeCart validates it against Shopify including
            minimum purchase and product requirements.
          </s-paragraph>
          <s-paragraph>
            Create discount codes first in{" "}
            <s-text fontWeight="bold">Shopify Admin → Discounts</s-text>.
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
  fontFamily: "inherit",
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
const addBtnStyle = {
  padding: "9px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
};
const codeRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  border: "1.5px solid #e8e8e8",
  borderRadius: 8,
  background: "#fafafa",
};
const removeBtnStyle = {
  background: "none",
  border: "1px solid #ddd",
  cursor: "pointer",
  color: "#666",
  fontSize: 12,
  padding: "5px 10px",
  borderRadius: 6,
  fontWeight: 500,
  fontFamily: "inherit",
};

function safeJSON(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
