import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`[Webhook] ${topic} for ${shop}`);

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Clean up app settings
  await db.cartSettings.deleteMany({ where: { shop } }).catch(() => {});

  return new Response(null, { status: 200 });
};
