import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.cartSettings.findUnique({ where: { shop } });

  return {
    shop,
    enabled: settings?.enabled ?? true,
    upsellEnabled: settings?.upsellEnabled ?? false,
    freebieEnabled: settings?.freebieEnabled ?? false,
    bannerEnabled: settings?.bannerEnabled ?? true,
    discountEnabled: settings?.discountEnabled ?? true,
  };
};

export default function Dashboard() {
  const data = useLoaderData();

  const StatusBadge = ({ active, label }) => (
    <s-badge tone={active ? "success" : "new"}>{active ? `${label}: On` : `${label}: Off`}</s-badge>
  );

  return (
    <s-page heading="EdgeCart — Side Cart">
      <s-button slot="primary-action" url="/app/settings" variant="primary">
        Configure Cart
      </s-button>

      {/* Status overview */}
      <s-section heading="App Status">
        <s-stack direction="inline" gap="base">
          <StatusBadge active={data.enabled} label="Side Cart" />
          <StatusBadge active={data.bannerEnabled} label="Banner" />
          <StatusBadge active={data.discountEnabled} label="Discount" />
          <StatusBadge active={data.upsellEnabled} label="Upsell" />
          <StatusBadge active={data.freebieEnabled} label="Freebie" />
        </s-stack>
      </s-section>

      {/* Quick links */}
      <s-section heading="Configuration">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base" align="center">
              <s-stack direction="block" gap="extraTight">
                <s-heading>General Settings</s-heading>
                <s-paragraph>Configure your side cart appearance, banner, header text and discount code section.</s-paragraph>
              </s-stack>
              <s-button url="/app/settings">Edit</s-button>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base" align="center">
              <s-stack direction="block" gap="extraTight">
                <s-heading>Upsell Products</s-heading>
                <s-paragraph>Show targeted upsell products based on cart value, quantity, or specific products in cart.</s-paragraph>
              </s-stack>
              <s-button url="/app/upsell">Edit</s-button>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base" align="center">
              <s-stack direction="block" gap="extraTight">
                <s-heading>Free Gift (Freebie)</s-heading>
                <s-paragraph>Offer a free gift when customers reach a cart value, quantity threshold, or add specific products.</s-paragraph>
              </s-stack>
              <s-button url="/app/freebie">Edit</s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* How to activate */}
      <s-section slot="aside" heading="How to Activate">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text fontWeight="bold">Step 1:</s-text> Configure your side cart settings using the links on the left.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Step 2:</s-text> Go to your Shopify admin → Online Store → Themes → Customize.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Step 3:</s-text> Click <s-text fontWeight="bold">App embeds</s-text> in the left sidebar and toggle on <s-text fontWeight="bold">EdgeCart SideCart</s-text>.
          </s-paragraph>
          <s-paragraph>
            <s-text fontWeight="bold">Step 4:</s-text> Save. The side cart is now live on your store!
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Features">
        <s-unordered-list>
          <s-list-item>Slide-in side cart on Add to Cart</s-list-item>
          <s-list-item>Custom banner with configurable text &amp; colors</s-list-item>
          <s-list-item>Quantity controls &amp; item removal</s-list-item>
          <s-list-item>Discount code field (applied at checkout)</s-list-item>
          <s-list-item>Upsell products (cart value / quantity / product triggered)</s-list-item>
          <s-list-item>Free gift with progress bar</s-list-item>
          <s-list-item>One-click checkout button</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
