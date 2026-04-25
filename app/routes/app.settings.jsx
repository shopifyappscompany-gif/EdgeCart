import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await prisma.cartSettings.findUnique({ where: { shop } });
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();

  const data = {
    enabled: form.get("enabled") === "true",
    headerText: String(form.get("headerText") || "Your Cart"),
    primaryColor: String(form.get("primaryColor") || "#000000"),
    bannerEnabled: form.get("bannerEnabled") === "true",
    bannerText: String(form.get("bannerText") || "🎉 Free shipping on orders over $50!"),
    bannerBgColor: String(form.get("bannerBgColor") || "#1a1a1a"),
    bannerTextColor: String(form.get("bannerTextColor") || "#ffffff"),
    discountEnabled: form.get("discountEnabled") === "true",
    updatedAt: new Date(),
  };

  await prisma.cartSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });

  return { success: true };
};

export default function GeneralSettings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";

  const s = settings || {};

  const [enabled, setEnabled] = useState(s.enabled ?? true);
  const [headerText, setHeaderText] = useState(s.headerText ?? "Your Cart");
  const [primaryColor, setPrimaryColor] = useState(s.primaryColor ?? "#000000");
  const [bannerEnabled, setBannerEnabled] = useState(s.bannerEnabled ?? true);
  const [bannerText, setBannerText] = useState(s.bannerText ?? "🎉 Free shipping on orders over $50!");
  const [bannerBgColor, setBannerBgColor] = useState(s.bannerBgColor ?? "#1a1a1a");
  const [bannerTextColor, setBannerTextColor] = useState(s.bannerTextColor ?? "#ffffff");
  const [discountEnabled, setDiscountEnabled] = useState(s.discountEnabled ?? true);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Settings saved!");
    }
  }, [fetcher.data]);

  function handleSubmit(e) {
    e.preventDefault();
    fetcher.submit(
      {
        enabled: String(enabled),
        headerText,
        primaryColor,
        bannerEnabled: String(bannerEnabled),
        bannerText,
        bannerBgColor,
        bannerTextColor,
        discountEnabled: String(discountEnabled),
      },
      { method: "POST" }
    );
  }

  return (
    <s-page heading="General Settings">
      <s-button slot="primary-action" onClick={handleSubmit} variant="primary" loading={saving ? true : undefined}>
        Save Settings
      </s-button>

      {/* Side Cart Toggle */}
      <s-section heading="Side Cart">
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <strong style={{ fontSize: 14 }}>Enable Side Cart</strong>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666" }}>
                When enabled, customers see a slide-in cart drawer instead of being redirected to /cart.
              </p>
            </div>
            <label style={toggleWrap}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ display: "none" }} />
              <span style={{ ...toggleTrack, background: enabled ? "#008060" : "#ccc" }}>
                <span style={{ ...toggleThumb, transform: enabled ? "translateX(20px)" : "translateX(2px)" }} />
              </span>
            </label>
          </div>

          <div>
            <label style={labelStyle}>Cart Header Text</label>
            <input
              type="text"
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              style={inputStyle}
              placeholder="Your Cart"
            />
          </div>

          <div>
            <label style={labelStyle}>Primary / Checkout Button Color</label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ width: 44, height: 44, border: "1.5px solid #e0e0e0", borderRadius: 8, cursor: "pointer", padding: 2 }}
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ ...inputStyle, width: 120 }}
                placeholder="#000000"
              />
            </div>
            <p style={helpText}>Used for checkout button, upsell add buttons, and accents.</p>
          </div>
        </s-stack>
      </s-section>

      {/* Banner */}
      <s-section heading="Announcement Banner">
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <strong style={{ fontSize: 14 }}>Show Banner</strong>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666" }}>
                Display a promotional banner at the top of the side cart.
              </p>
            </div>
            <label style={toggleWrap}>
              <input type="checkbox" checked={bannerEnabled} onChange={(e) => setBannerEnabled(e.target.checked)} style={{ display: "none" }} />
              <span style={{ ...toggleTrack, background: bannerEnabled ? "#008060" : "#ccc" }}>
                <span style={{ ...toggleThumb, transform: bannerEnabled ? "translateX(20px)" : "translateX(2px)" }} />
              </span>
            </label>
          </div>

          {bannerEnabled && (
            <>
              {/* Live preview */}
              <div style={{ padding: "12px 16px", background: bannerBgColor, color: bannerTextColor, borderRadius: 8, textAlign: "center", fontSize: 14, fontWeight: 500 }}>
                {bannerText || "Banner preview"}
              </div>

              <div>
                <label style={labelStyle}>Banner Text</label>
                <input
                  type="text"
                  value={bannerText}
                  onChange={(e) => setBannerText(e.target.value)}
                  style={inputStyle}
                  placeholder="🎉 Free shipping on orders over $50!"
                />
              </div>

              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div>
                  <label style={labelStyle}>Background Color</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="color" value={bannerBgColor} onChange={(e) => setBannerBgColor(e.target.value)}
                      style={{ width: 44, height: 44, border: "1.5px solid #e0e0e0", borderRadius: 8, cursor: "pointer", padding: 2 }} />
                    <input type="text" value={bannerBgColor} onChange={(e) => setBannerBgColor(e.target.value)}
                      style={{ ...inputStyle, width: 110 }} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Text Color</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="color" value={bannerTextColor} onChange={(e) => setBannerTextColor(e.target.value)}
                      style={{ width: 44, height: 44, border: "1.5px solid #e0e0e0", borderRadius: 8, cursor: "pointer", padding: 2 }} />
                    <input type="text" value={bannerTextColor} onChange={(e) => setBannerTextColor(e.target.value)}
                      style={{ ...inputStyle, width: 110 }} />
                  </div>
                </div>
              </div>
            </>
          )}
        </s-stack>
      </s-section>

      {/* Discount */}
      <s-section heading="Discount Code">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <strong style={{ fontSize: 14 }}>Show Discount Code Field</strong>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666" }}>
              Allow customers to enter a manual discount code. Applied at checkout.
            </p>
          </div>
          <label style={toggleWrap}>
            <input type="checkbox" checked={discountEnabled} onChange={(e) => setDiscountEnabled(e.target.checked)} style={{ display: "none" }} />
            <span style={{ ...toggleTrack, background: discountEnabled ? "#008060" : "#ccc" }}>
              <span style={{ ...toggleThumb, transform: discountEnabled ? "translateX(20px)" : "translateX(2px)" }} />
            </span>
          </label>
        </div>
      </s-section>

      <s-section slot="aside" heading="About This Page">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Control the overall appearance of the EdgeCart side cart drawer — the header, colors, promotional banner, and discount field visibility.
          </s-paragraph>
          <s-paragraph>
            Don't forget to enable the app embed in your theme:
            <br />
            Online Store → Themes → Customize → App embeds → EdgeCart SideCart
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

// Styles
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 6 };
const helpText = { margin: "6px 0 0", fontSize: 12, color: "#888" };
const inputStyle = {
  width: "100%", padding: "9px 12px", border: "1.5px solid #e0e0e0", borderRadius: 8,
  fontSize: 14, color: "#111", outline: "none", boxSizing: "border-box", background: "#fafafa",
};
const toggleWrap = { display: "inline-flex", cursor: "pointer", flexShrink: 0 };
const toggleTrack = {
  display: "inline-flex", width: 44, height: 24, borderRadius: 12, padding: 2, transition: "background 0.2s",
  alignItems: "center", position: "relative",
};
const toggleThumb = {
  width: 20, height: 20, borderRadius: "50%", background: "#fff",
  boxShadow: "0 1px 4px rgba(0,0,0,0.25)", transition: "transform 0.2s", display: "block",
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
