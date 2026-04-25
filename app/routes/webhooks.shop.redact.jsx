import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR mandatory — erase all shop data after uninstall (48h delay by Shopify)
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[GDPR] ${topic} for ${shop}`);

  // Delete all app data stored for this shop
  await db.cartSettings.deleteMany({ where: { shop } }).catch(() => {});
  await db.session.deleteMany({ where: { shop } }).catch(() => {});

  return new Response(null, { status: 200 });
};
