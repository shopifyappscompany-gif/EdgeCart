-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CartSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "headerText" TEXT NOT NULL DEFAULT 'Your Cart',
    "primaryColor" TEXT NOT NULL DEFAULT '#000000',
    "bannerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bannerText" TEXT NOT NULL DEFAULT '🎉 Free shipping on orders over $50!',
    "bannerBgColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "bannerTextColor" TEXT NOT NULL DEFAULT '#ffffff',
    "discountEnabled" BOOLEAN NOT NULL DEFAULT true,
    "upsellEnabled" BOOLEAN NOT NULL DEFAULT false,
    "upsellTitle" TEXT NOT NULL DEFAULT 'You might also like',
    "upsellTriggerType" TEXT NOT NULL DEFAULT 'cartValue',
    "upsellMinCartValue" REAL NOT NULL DEFAULT 50,
    "upsellMinQuantity" INTEGER NOT NULL DEFAULT 2,
    "upsellProducts" TEXT NOT NULL DEFAULT '[]',
    "upsellTriggerProductIds" TEXT NOT NULL DEFAULT '[]',
    "freebieEnabled" BOOLEAN NOT NULL DEFAULT false,
    "freebieTitle" TEXT NOT NULL DEFAULT '🎁 You''ve earned a free gift!',
    "freebieTriggerType" TEXT NOT NULL DEFAULT 'cartValue',
    "freebieMinCartValue" REAL NOT NULL DEFAULT 100,
    "freebieMinQuantity" INTEGER NOT NULL DEFAULT 3,
    "freebieProductVariantId" TEXT,
    "freebieProductTitle" TEXT,
    "freebieProductImageUrl" TEXT,
    "freebieTriggerProductIds" TEXT NOT NULL DEFAULT '[]',
    "autoDiscountEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoDiscountCode" TEXT NOT NULL DEFAULT '',
    "orderNotesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "showVariantTitle" BOOLEAN NOT NULL DEFAULT true,
    "scarcityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scarcityText" TEXT NOT NULL DEFAULT '⏰ Offer ends in:',
    "scarcityMinutes" INTEGER NOT NULL DEFAULT 15,
    "scarcityBgColor" TEXT NOT NULL DEFAULT '#e53e3e',
    "scarcityTextColor" TEXT NOT NULL DEFAULT '#ffffff',
    "tieredRewardsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tieredRewards" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CartSettings" ("autoDiscountCode", "autoDiscountEnabled", "bannerBgColor", "bannerEnabled", "bannerText", "bannerTextColor", "createdAt", "discountEnabled", "enabled", "freebieEnabled", "freebieMinCartValue", "freebieMinQuantity", "freebieProductImageUrl", "freebieProductTitle", "freebieProductVariantId", "freebieTitle", "freebieTriggerProductIds", "freebieTriggerType", "headerText", "id", "orderNotesEnabled", "primaryColor", "shop", "showVariantTitle", "updatedAt", "upsellEnabled", "upsellMinCartValue", "upsellMinQuantity", "upsellProducts", "upsellTitle", "upsellTriggerProductIds", "upsellTriggerType") SELECT "autoDiscountCode", "autoDiscountEnabled", "bannerBgColor", "bannerEnabled", "bannerText", "bannerTextColor", "createdAt", "discountEnabled", "enabled", "freebieEnabled", "freebieMinCartValue", "freebieMinQuantity", "freebieProductImageUrl", "freebieProductTitle", "freebieProductVariantId", "freebieTitle", "freebieTriggerProductIds", "freebieTriggerType", "headerText", "id", "orderNotesEnabled", "primaryColor", "shop", "showVariantTitle", "updatedAt", "upsellEnabled", "upsellMinCartValue", "upsellMinQuantity", "upsellProducts", "upsellTitle", "upsellTriggerProductIds", "upsellTriggerType" FROM "CartSettings";
DROP TABLE "CartSettings";
ALTER TABLE "new_CartSettings" RENAME TO "CartSettings";
CREATE UNIQUE INDEX "CartSettings_shop_key" ON "CartSettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
