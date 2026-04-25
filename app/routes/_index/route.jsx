import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export default function Index() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <div className={styles.logo}>🛒</div>
        <h1 className={styles.heading}>EdgeCart</h1>
        <p className={styles.tagline}>
          Slide-in side cart with upsells, free gifts &amp; discount codes —
          controlled entirely from your Shopify admin.
        </p>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <div className={styles.inputWrap}>
              <label className={styles.label} htmlFor="shop">
                Your store domain
              </label>
              <input
                id="shop"
                className={styles.input}
                type="text"
                name="shop"
                placeholder="your-store.myshopify.com"
                autoComplete="off"
                required
              />
            </div>
            <button className={styles.button} type="submit">
              Install EdgeCart →
            </button>
          </Form>
        )}

        <div className={styles.features}>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>⚡</span>
            <strong>Instant Side Cart</strong>
            <p>Opens on Add to Cart — no page redirects</p>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>🎯</span>
            <strong>Smart Upsells</strong>
            <p>Trigger by cart value, quantity, or products</p>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>🎁</span>
            <strong>Free Gift Engine</strong>
            <p>Progress bar + one-tap claim for customers</p>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>🏷️</span>
            <strong>Discount Codes</strong>
            <p>Applied seamlessly at checkout</p>
          </div>
        </div>
      </div>
    </div>
  );
}
