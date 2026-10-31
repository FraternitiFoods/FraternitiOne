import { describe, it, expect } from "vitest";
import { rateForAmount, amountOf, finalRateOf } from "./boq-calc";

describe("rateForAmount — effective-rate precedence (plan.md section 3 'Rate rules')", () => {
  it("locked wins over rate_override and final rate", () => {
    const rate = rateForAmount({ isLocked: true, lockedRate: 500, rateOverride: 999, finalRate: 1 });
    expect(rate).toBe(500);
  });

  it("rate_override wins over final rate when not locked", () => {
    const rate = rateForAmount({ isLocked: false, lockedRate: null, rateOverride: 250, finalRate: 1000 });
    expect(rate).toBe(250);
  });

  it("falls back to final rate when not locked and no override", () => {
    const rate = rateForAmount({ isLocked: false, lockedRate: null, rateOverride: null, finalRate: 300 });
    expect(rate).toBe(300);
  });

  it("is null when nothing is set", () => {
    const rate = rateForAmount({ isLocked: false, lockedRate: null, rateOverride: null, finalRate: null });
    expect(rate).toBeNull();
  });
});

describe("Site lock freezes amounts (plan.md section 3 'Site lock' + milestone M5 acceptance check)", () => {
  it("a locked site's amount does not change after the item's final rate changes, while an unlocked site's amount follows it", () => {
    const qty = 10;
    const finalVendorId = "v1";

    // Site A locks while the item's final rate is 100 — its SiteItem.lockedRate snapshot is taken at that moment.
    const rateAtLockTime = finalRateOf(finalVendorId, [{ vendorId: finalVendorId, rate: 100 }]);
    const siteALockedRate = rateForAmount({
      isLocked: false,
      lockedRate: null,
      rateOverride: null,
      finalRate: rateAtLockTime,
    });
    expect(siteALockedRate).toBe(100);

    // Site B stays unlocked the whole time, reading the same final rate live.
    const siteBAmountBefore = amountOf(
      qty,
      rateForAmount({ isLocked: false, lockedRate: null, rateOverride: null, finalRate: rateAtLockTime })
    );
    expect(siteBAmountBefore).toBe(1000);

    // The item's final vendor rate changes after Site A is locked.
    const rateAfterChange = finalRateOf(finalVendorId, [{ vendorId: finalVendorId, rate: 250 }]);

    const siteAAmountAfter = amountOf(
      qty,
      rateForAmount({ isLocked: true, lockedRate: siteALockedRate, rateOverride: null, finalRate: rateAfterChange })
    );
    const siteBAmountAfter = amountOf(
      qty,
      rateForAmount({ isLocked: false, lockedRate: null, rateOverride: null, finalRate: rateAfterChange })
    );

    expect(siteAAmountAfter).toBe(1000); // frozen — unchanged by the rate change
    expect(siteBAmountAfter).toBe(2500); // unlocked — follows the new rate
  });
});
