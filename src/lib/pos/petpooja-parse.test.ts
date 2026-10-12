import { describe, it, expect } from "vitest";
import { parsePetpoojaPayload } from "./petpooja-parse";

/**
 * Fixtures typed from `Global API Documentation.pdf` (Apoorv pasted its
 * content into chat — the file itself is gitignored and was never copied
 * into the repo root; see plan.md section 26 build log, P0). The PDF has
 * **4** distinct sample payloads (not 5 as plan.md's build-order step P2
 * assumed before the PDF was actually read) — Basic, Discounts & Add-ons,
 * Part Payment, and Online Aggregator — the last of which is also the one
 * that spells the auth key `Token` (capital T) rather than `token`, which is
 * presumably what the plan's "plus the Token spelling" phrase meant to flag
 * as a fifth *case*, not a fifth payload. All four are used below; `OrderItem`
 * / `Tax` / `Discount` arrays are trimmed to a single representative entry
 * each since this parser never reads them anyway (section 26 decision 5: no
 * line items in v1).
 */

const basicPayload = {
  token: "",
  properties: {
    Restaurant: {
      res_name: "Integration-SakhraniRohan-Demo",
      address: "Ahmedabad",
      contact_information: "7228956676",
      restID: "cp81ghin",
    },
    Customer: {
      name: "Rohan",
      address: "Ahmedabad",
      phone: "1234567890",
      gstin: "1234678543345",
    },
    Order: {
      orderID: 114,
      customer_invoice_id: "114",
      delivery_charges: 0,
      order_type: "Dine In",
      payment_type: "Cash",
      table_no: "A18",
      no_of_persons: 0,
      discount_total: 0,
      tax_total: 0,
      round_off: "0",
      core_total: 1158,
      total: 1158,
      created_on: "2025-04-04 11:45:35",
      order_from: "POS",
      order_from_id: "",
      sub_order_type: "AC",
      packaging_charge: 0,
      status: "Success",
      comment: "",
      service_charge: 0,
      biller: "39481 (dhandapani)",
      assignee: "Roni Ghosh",
    },
    Tax: [],
    Discount: [],
    OrderItem: [
      {
        name: "Chicken Drumstick Spicy (3 Pieces)",
        itemid: 136978202,
        itemcode: "cds",
        vendoritemcode: "",
        specialnotes: "",
        price: 359,
        quantity: 1,
        total: 359,
        addon: [],
        category_name: "Chicken Meal",
        sap_code: "",
        discount: 0,
        tax: 0,
      },
    ],
  },
  event: "orderdetails",
};

const discountPayload = {
  token: "",
  properties: {
    Restaurant: {
      res_name: "Integration-SakhraniRohan-Demo",
      address: "Ahmedabad",
      contact_information: "7228956676",
      restID: "cp81ghin",
    },
    Customer: { name: "Rohan", address: "Ahmedabad", phone: "1234567890", gstin: "1234678543345" },
    Order: {
      orderID: 115,
      customer_invoice_id: "115",
      delivery_charges: 0,
      order_type: "Dine In",
      payment_type: "Card",
      table_no: "A15",
      no_of_persons: 0,
      discount_total: 253.4,
      tax_total: 0,
      round_off: "0.40",
      core_total: 1267,
      total: 1034,
      created_on: "2025-04-04 11:49:20",
      order_from: "POS",
      order_from_id: "",
      sub_order_type: "AC",
      packaging_charge: 20,
      status: "Success",
      comment: "",
      service_charge: 0,
      biller: "39481 (dhandapani)",
      assignee: "Roni Ghosh",
    },
    Tax: [],
    Discount: [{ title: "Special Discount", type: "P", rate: 20, amount: 253.4 }],
    OrderItem: [
      {
        name: "Chicken Tikka (3 Pieces)",
        itemid: 136978234,
        itemcode: "CHTK",
        vendoritemcode: "",
        specialnotes: "",
        price: 100,
        quantity: 1,
        total: 100,
        addon: [],
        category_name: "Chicken",
        sap_code: "",
        discount: 20,
        tax: 0,
      },
    ],
  },
  event: "orderdetails",
};

const partPaymentPayload = {
  token: "",
  properties: {
    Restaurant: {
      res_name: "Integration-SakhraniRohan-Demo",
      address: "Ahmedabad",
      contact_information: "7228956676",
      restID: "cp81ghin",
    },
    Customer: { name: "", address: "", phone: "", gstin: "" },
    Order: {
      orderID: 116,
      customer_invoice_id: "116",
      delivery_charges: 0,
      order_type: "Dine In",
      payment_type: "Part Payment",
      table_no: "A11",
      no_of_persons: 0,
      discount_total: 0,
      tax_total: 0,
      round_off: "0",
      core_total: 987,
      total: 987,
      created_on: "2025-04-04 11:50:37",
      order_from: "POS",
      order_from_id: "",
      sub_order_type: "AC",
      packaging_charge: 0,
      status: "Success",
      comment: "",
      service_charge: 0,
      assignee: "Roni Ghosh",
      biller: "39481 (dhandapani)",
      part_payments: [
        { payment_type: "Cash", amount: 587, custome_payment_type: "" },
        { payment_type: "Card", amount: 400, custome_payment_type: "" },
      ],
    },
    Tax: [],
    Discount: [],
    OrderItem: [
      {
        name: "Chicken Drumstick Spicy (3 Pieces)",
        itemid: 136978202,
        itemcode: "cds",
        vendoritemcode: "",
        specialnotes: "",
        price: 359,
        quantity: 1,
        total: 359,
        addon: [],
        category_name: "Chicken Meal",
        sap_code: "",
        discount: 0,
        tax: 0,
      },
    ],
  },
  event: "orderdetails",
};

const aggregatorPayload = {
  Token: "f7a38b12c3e849a9b5d6027c9f83d37a4efc2b0e76f543d1a728e065f9d",
  properties: {
    Restaurant: {
      res_name: "RESTAURANT",
      address: "Kottayam\n",
      contact_information: "1234567890",
      restID: "ry9zhytgrvi",
    },
    Customer: { name: "Jithu", address: " Kottayam India", phone: "", gstin: "" },
    Order: {
      orderID: 44498,
      customer_invoice_id: "44498",
      delivery_charges: 0,
      order_type: "Delivery",
      payment_type: "Online",
      table_no: "",
      no_of_persons: 0,
      discount_total: 0,
      tax_total: 17.76,
      round_off: "0.24",
      core_total: 350,
      total: 373,
      created_on: "2026-01-19 16:42:24",
      order_from: "Zomato",
      order_from_id: "7705303460",
      sub_order_type: "Zomato",
      packaging_charge: 5,
      status: "Success",
      token_no: "81",
      comment: "please make sure that all chicken pieces are soft and please add extra gravy",
      service_charge: 0,
      biller: "Syju",
      assignee: "",
    },
    Tax: [
      { title: "CGST", type: "P", rate: 2.5, amount: 8.88 },
      { title: "SGST", type: "P", rate: 2.5, amount: 8.88 },
    ],
    Discount: [],
    OrderItem: [
      {
        name: "Kozhi Curry",
        itemid: 1284989,
        itemcode: "kozhi c",
        vendoritemcode: "",
        specialnotes: "",
        price: 350,
        quantity: 1,
        total: 350,
        addon: [],
        category_name: "KARGEEN MAIN COURSE -NON VEG",
        sap_code: "",
        discount: 0,
        tax: 17.5,
      },
    ],
  },
  event: "orderdetails",
};

function expectParsed(result: ReturnType<typeof parsePetpoojaPayload>) {
  if (result.kind !== "parsed") throw new Error(`Expected "parsed", got "${result.kind}"`);
  return result.order;
}

describe("parsePetpoojaPayload — the 4 PDF sample payloads", () => {
  it("parses the basic Dine In / Cash payload exactly", () => {
    const order = expectParsed(parsePetpoojaPayload(basicPayload));
    expect(order.restId).toBe("cp81ghin");
    expect(order.orderId).toBe("114");
    expect(order.invoiceNo).toBe("114");
    expect(order.businessDate).toBe("2025-04-04");
    expect(order.createdAtIst.toISOString()).toBe("2025-04-04T06:15:35.000Z"); // 11:45:35 IST - 5:30
    expect(order.orderType).toBe("Dine In");
    expect(order.subOrderType).toBe("AC");
    expect(order.orderFrom).toBe("POS");
    expect(order.aggregatorOrderId).toBeNull();
    expect(order.paymentType).toBe("Cash");
    expect(order.partPayments).toBeNull();
    expect(order.status).toBe("SUCCESS");
    expect(order.coreTotalPaise).toBe(115800);
    expect(order.discountTotalPaise).toBe(0);
    expect(order.taxTotalPaise).toBe(0);
    expect(order.packagingChargePaise).toBe(0);
    expect(order.deliveryChargePaise).toBe(0);
    expect(order.serviceChargePaise).toBe(0);
    expect(order.roundOffPaise).toBe(0);
    expect(order.totalPaise).toBe(115800);
    expect(order.flags).toEqual([]);
  });

  it("parses the discount + packaging-charge payload exactly, round_off as a decimal string", () => {
    const order = expectParsed(parsePetpoojaPayload(discountPayload));
    expect(order.orderId).toBe("115");
    expect(order.paymentType).toBe("Card");
    expect(order.coreTotalPaise).toBe(126700);
    expect(order.discountTotalPaise).toBe(25340); // 253.4 (JSON number) -> exact paise, no float drift
    expect(order.taxTotalPaise).toBe(0);
    expect(order.packagingChargePaise).toBe(2000);
    expect(order.roundOffPaise).toBe(40); // "0.40" (string)
    expect(order.totalPaise).toBe(103400);
    // Hand check from plan.md section 26: 1267 - 253.4 + 0 + 20 + 0 + 0 + 0.40 = 1034.00
    expect(order.flags).toEqual([]);
  });

  it("parses the Part Payment payload, keeping only { paymentType, amountPaise } per entry", () => {
    const order = expectParsed(parsePetpoojaPayload(partPaymentPayload));
    expect(order.orderId).toBe("116");
    expect(order.paymentType).toBe("Part Payment");
    expect(order.partPayments).toEqual([
      { paymentType: "Cash", amountPaise: 58700 },
      { paymentType: "Card", amountPaise: 40000 },
    ]);
    expect(order.coreTotalPaise).toBe(98700);
    expect(order.totalPaise).toBe(98700);
    expect(order.flags).toEqual([]);
  });

  it("parses the online aggregator (Zomato) payload exactly, ignoring the capitalized Token key", () => {
    const order = expectParsed(parsePetpoojaPayload(aggregatorPayload));
    expect(order.restId).toBe("ry9zhytgrvi");
    expect(order.orderId).toBe("44498");
    expect(order.businessDate).toBe("2026-01-19");
    expect(order.createdAtIst.toISOString()).toBe("2026-01-19T11:12:24.000Z"); // 16:42:24 IST - 5:30
    expect(order.orderType).toBe("Delivery");
    expect(order.orderFrom).toBe("Zomato");
    expect(order.subOrderType).toBe("Zomato");
    expect(order.aggregatorOrderId).toBe("7705303460");
    expect(order.paymentType).toBe("Online");
    expect(order.taxTotalPaise).toBe(1776); // 17.76
    expect(order.packagingChargePaise).toBe(500);
    expect(order.roundOffPaise).toBe(24); // "0.24"
    expect(order.coreTotalPaise).toBe(35000);
    expect(order.totalPaise).toBe(37300);
    // Hand check from plan.md section 26: 350 + 17.76 + 5 + 0.24 = 373.00
    expect(order.flags).toEqual([]);
  });

  it("never carries Customer, comment or the token/Token value into the parsed output", () => {
    for (const payload of [basicPayload, discountPayload, partPaymentPayload, aggregatorPayload]) {
      const order = expectParsed(parsePetpoojaPayload(payload));
      const serialized = JSON.stringify(order);
      expect(serialized).not.toContain("Rohan");
      expect(serialized).not.toContain("Jithu");
      expect(serialized).not.toContain("1234567890");
      expect(serialized).not.toContain("1234678543345"); // gstin
      expect(serialized).not.toContain("f7a38b12c3e849a9b5d6027c9f83d37a4efc2b0e76f543d1a728e065f9d"); // Token
      expect(serialized).not.toContain("please make sure"); // comment
      // Belt-and-braces: the type itself has no field that could hold these,
      // but assert the actual object's keys too in case that ever drifts.
      expect(Object.keys(order)).not.toContain("customer");
      expect(Object.keys(order)).not.toContain("comment");
      expect(Object.keys(order)).not.toContain("token");
    }
  });
});

describe("parsePetpoojaPayload — event filtering", () => {
  it("ignores a non-orderdetails event without failing", () => {
    const result = parsePetpoojaPayload({ ...basicPayload, event: "something_else" });
    expect(result).toEqual({ kind: "ignored_event", event: "something_else" });
  });

  it("ignores a payload with no event field at all", () => {
    const { event: _event, ...withoutEvent } = basicPayload;
    const result = parsePetpoojaPayload(withoutEvent);
    expect(result.kind).toBe("ignored_event");
  });
});

describe("parsePetpoojaPayload — status", () => {
  it("maps Cancelled to the CANCELLED status", () => {
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, status: "Cancelled" } },
    };
    const order = expectParsed(parsePetpoojaPayload(payload));
    expect(order.status).toBe("CANCELLED");
  });

  it("fails on an unrecognized status instead of guessing", () => {
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, status: "Refunded" } },
    };
    const result = parsePetpoojaPayload(payload);
    expect(result.kind).toBe("failed");
  });
});

describe("parsePetpoojaPayload — malformed / missing fields never guess, always FAILED", () => {
  it("fails on a missing restID", () => {
    const payload = {
      ...basicPayload,
      properties: {
        ...basicPayload.properties,
        Restaurant: { ...basicPayload.properties.Restaurant, restID: "" },
      },
    };
    const result = parsePetpoojaPayload(payload);
    expect(result).toMatchObject({ kind: "failed" });
  });

  it("fails on a missing orderID", () => {
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, orderID: "" } },
    };
    expect(parsePetpoojaPayload(payload).kind).toBe("failed");
  });

  it("fails on a garbage created_on string", () => {
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, created_on: "not a date" } },
    };
    expect(parsePetpoojaPayload(payload).kind).toBe("failed");
  });

  it("fails on a created_on with an impossible calendar date (Feb 30)", () => {
    const payload = {
      ...basicPayload,
      properties: {
        ...basicPayload.properties,
        Order: { ...basicPayload.properties.Order, created_on: "2025-02-30 10:00:00" },
      },
    };
    expect(parsePetpoojaPayload(payload).kind).toBe("failed");
  });

  it("fails on a non-numeric core_total instead of defaulting to 0", () => {
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, core_total: "not-a-number" } },
    };
    expect(parsePetpoojaPayload(payload).kind).toBe("failed");
  });

  it("fails on a round_off with more than 2 decimal places", () => {
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, round_off: "0.4019" } },
    };
    expect(parsePetpoojaPayload(payload).kind).toBe("failed");
  });

  it("accepts a negative round_off (the one signed field) but rejects a negative core_total", () => {
    const negativeRoundOff = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, round_off: "-0.40" } },
    };
    const order = expectParsed(parsePetpoojaPayload(negativeRoundOff));
    expect(order.roundOffPaise).toBe(-40);

    const negativeCoreTotal = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, core_total: -1158 } },
    };
    expect(parsePetpoojaPayload(negativeCoreTotal).kind).toBe("failed");
  });

  it("fails on a part_payments entry missing its amount", () => {
    const payload = {
      ...partPaymentPayload,
      properties: {
        ...partPaymentPayload.properties,
        Order: {
          ...partPaymentPayload.properties.Order,
          part_payments: [{ payment_type: "Cash", custome_payment_type: "" }],
        },
      },
    };
    expect(parsePetpoojaPayload(payload).kind).toBe("failed");
  });

  it("fails on a payload that isn't a JSON object", () => {
    expect(parsePetpoojaPayload("just a string").kind).toBe("failed");
    expect(parsePetpoojaPayload(null).kind).toBe("failed");
    expect(parsePetpoojaPayload([1, 2, 3]).kind).toBe("failed");
  });
});

describe("parsePetpoojaPayload — TOTAL_MISMATCH flag", () => {
  it("does not flag a difference of exactly ₹1 (the tolerance boundary)", () => {
    // Basic payload's formula already totals exactly 1158; push `total` ₹1 off.
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, total: 1159 } },
    };
    const order = expectParsed(parsePetpoojaPayload(payload));
    expect(order.flags).toEqual([]);
  });

  it("flags TOTAL_MISMATCH once the difference exceeds ₹1", () => {
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, total: 1159.01 } },
    };
    const order = expectParsed(parsePetpoojaPayload(payload));
    expect(order.flags).toContain("TOTAL_MISMATCH");
  });

  it("does not reject the bill — TOTAL_MISMATCH is a flag, not a FAILED event", () => {
    const payload = {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, total: 5000 } },
    };
    const result = parsePetpoojaPayload(payload);
    expect(result.kind).toBe("parsed");
  });
});

describe("parsePetpoojaPayload — businessDate future-clock guard", () => {
  // `now` fixed at 2026-01-19T12:00:00Z = 2026-01-19T17:30:00 IST, so "today"
  // IST is 2026-01-19 and "tomorrow" IST is 2026-01-20.
  const now = new Date("2026-01-19T12:00:00.000Z");

  function withCreatedOn(createdOn: string) {
    return {
      ...basicPayload,
      properties: { ...basicPayload.properties, Order: { ...basicPayload.properties.Order, created_on: createdOn } },
    };
  }

  it("accepts a businessDate of today IST", () => {
    const result = parsePetpoojaPayload(withCreatedOn("2026-01-19 23:00:00"), { now });
    expect(result.kind).toBe("parsed");
  });

  it("accepts a businessDate exactly 1 day in the future IST", () => {
    const result = parsePetpoojaPayload(withCreatedOn("2026-01-20 00:30:00"), { now });
    expect(result.kind).toBe("parsed");
  });

  it("fails a businessDate more than 1 day in the future IST (wrong clock)", () => {
    const result = parsePetpoojaPayload(withCreatedOn("2026-01-21 00:30:00"), { now });
    expect(result.kind).toBe("failed");
  });
});
