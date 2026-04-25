import { authenticate } from "../shopify.server";

// GDPR mandatory — erase customer data
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[GDPR] ${topic} for ${shop}`, payload);
  // EdgeCart stores no personal customer data — nothing to erase.
  return new Response(null, { status: 200 });
};
