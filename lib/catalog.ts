import type { HotelUser, Priority } from "./types";

// The code registries the plan keeps in SupportCatalog (labels would live in lang files).

export interface Issue {
  key: string;
  label: string;
  priority: Priority;
  entity?: "reservation" | "invoice" | "channel";
  articles: string[];
}

export interface Category {
  key: string;
  icon: string;
  label: string;
  issues: Issue[];
}

export const CATEGORIES: Category[] = [
  {
    key: "bookings",
    icon: "📅",
    label: "Bookings",
    issues: [
      { key: "bookings.cannot_create", label: "Can't create a booking", priority: "urgent", entity: "reservation", articles: ["bookings/create", "bookings/availability"] },
      { key: "bookings.wrong_dates", label: "Booking shows wrong dates", priority: "normal", entity: "reservation", articles: ["bookings/amend"] },
    ],
  },
  {
    key: "channels",
    icon: "🔗",
    label: "Channels",
    issues: [
      { key: "channels.not_syncing", label: "Booking not syncing from OTA", priority: "high", entity: "channel", articles: ["channels/sync-status", "channels/resend"] },
      { key: "channels.wrong_rate", label: "Wrong rate showing on Booking.com", priority: "normal", entity: "reservation", articles: ["channels/rate-differs", "channels/resend"] },
      { key: "channels.room_unmapped", label: "Room not mapped", priority: "normal", entity: "channel", articles: ["channels/mapping"] },
    ],
  },
  {
    key: "billing",
    icon: "💶",
    label: "Billing",
    issues: [
      { key: "billing.invoice_vat", label: "Invoice VAT looks wrong", priority: "normal", entity: "invoice", articles: ["billing/vat"] },
      { key: "billing.subscription", label: "Question about my plan", priority: "low", articles: ["billing/plans"] },
    ],
  },
  {
    key: "rates",
    icon: "🏷",
    label: "Rates",
    issues: [
      { key: "rates.not_applying", label: "Rate plan not applying", priority: "high", articles: ["rates/plans"] },
      { key: "rates.seasonal", label: "How to set seasonal rates", priority: "low", articles: ["rates/seasons"] },
    ],
  },
  {
    key: "login",
    icon: "👤",
    label: "Login & users",
    issues: [
      { key: "login.colleague", label: "A colleague can't log in", priority: "normal", articles: ["users/reset"] },
      { key: "login.twofactor", label: "Reset 2FA for a colleague", priority: "normal", articles: ["users/2fa"] },
    ],
  },
  {
    key: "other",
    icon: "💬",
    label: "Other",
    issues: [{ key: "other.general", label: "Something else", priority: "normal", articles: [] }],
  },
];

export const ISSUES: Record<string, Issue & { category: string }> = Object.fromEntries(
  CATEGORIES.flatMap((c) => c.issues.map((i) => [i.key, { ...i, category: c.label }])),
);

/** keywords: words people actually type ("login", "2FA") that the title may not contain. */
export const ARTICLES: Record<string, { title: string; summary: string; keywords?: string[] }> = {
  "bookings/create": { title: "Creating a booking", summary: "Pick dates, a room type and a rate, then confirm. A red date means no availability.", keywords: ["new booking", "reservation", "book", "make booking", "add booking"] },
  "bookings/availability": { title: "Why a date shows no availability", summary: "Check closed dates, minimum stay rules and room blocks on the rates calendar.", keywords: ["availability", "sold out", "closed", "red date", "min stay", "blocked"] },
  "bookings/amend": { title: "Changing booking dates", summary: "Open the booking, choose Amend stay, pick new dates and confirm the price difference.", keywords: ["amend", "change dates", "modify", "extend stay", "shorten"] },
  "channels/sync-status": { title: "Checking channel sync status", summary: "Channel Manager → Status shows the last push and any errors per channel.", keywords: ["sync", "not syncing", "ota", "channel manager", "status", "error"] },
  "channels/resend": { title: "Re-sending rates to a channel", summary: "Channel Manager → Rates → Re-send. Changes reach the OTA within about 5 minutes.", keywords: ["resend", "push", "update channel", "ota", "channel manager"] },
  "channels/rate-differs": { title: "Why a rate differs on Booking.com", summary: "Usually a markup, a currency setting or a derived rate plan on the channel side.", keywords: ["price", "markup", "wrong price", "currency", "derived", "rate"] },
  "channels/mapping": { title: "Mapping rooms to a channel", summary: "Every room type needs a matching room on the OTA before availability can sync.", keywords: ["mapping", "map", "unmapped", "room type", "channel"] },
  "billing/vat": { title: "How VAT is calculated on invoices", summary: "VAT follows the property's tax profile and each charge's tax category.", keywords: ["vat", "tax", "invoice", "charge"] },
  "billing/plans": { title: "Plans and what they include", summary: "Compare plans and upgrade from Account → Subscription.", keywords: ["plan", "subscription", "upgrade", "pricing", "billing"] },
  "rates/plans": { title: "Setting up rate plans", summary: "A rate plan needs dates, room types and to be linked to a channel.", keywords: ["rate", "rate plan", "price", "tariff"] },
  "rates/seasons": { title: "Seasonal rates", summary: "Create a season, set its dates and apply a price rule to your rate plans.", keywords: ["season", "seasonal", "summer", "winter", "peak", "rate"] },
  "users/reset": { title: "Resetting a colleague's password", summary: "Settings → Users → … → Send reset link. Superadmins only.", keywords: ["login", "log in", "sign in", "password", "locked out", "user", "access"] },
  "users/2fa": { title: "Resetting two-factor authentication", summary: "A superadmin can clear 2FA from the user's page; they enrol again at next login.", keywords: ["2fa", "two factor", "authenticator", "otp", "code", "login", "lost phone"] },
};

/** Entity pickers. Labels carry numbers and dates only, never guest names (GDPR item #4). */
export const ENTITIES: Record<string, string[]> = {
  reservation: ["R-10234 · Seaside · 12–14 Oct", "R-10251 · Seaside · 15–18 Oct", "R-10302 · City · 20–21 Oct"],
  invoice: ["INV-2026-0441", "INV-2026-0452"],
  channel: ["Booking.com", "Expedia", "Airbnb"],
};

export const RESOLUTION_CODES: Record<string, string> = {
  how_to: "How-to answered",
  config_fixed: "Configuration fixed",
  bug_reported: "Bug reported",
  billing_adjusted: "Billing adjusted",
  duplicate: "Duplicate",
  no_response: "No response",
};

export const CANNED: { title: string; body: string; topic: string | null }[] = [
  { title: "Greeting", body: "Hi {first_name}, thanks for reaching out. I'm looking at {entity_label} now.", topic: null },
  { title: "Re-send rates", body: "Hi {first_name}, please open Channel Manager → Rates and click Re-send for {entity_label}. Booking.com can take up to 5 minutes to update.", topic: "channels.wrong_rate" },
  { title: "Check sync status", body: "Could you open Channel Manager → Status and tell me what the last push for {entity_label} says?", topic: "channels.not_syncing" },
  { title: "Room mapping", body: "This room isn't mapped yet. Channel Manager → Mapping, then pick the matching Booking.com room.", topic: "channels.room_unmapped" },
  { title: "Closing", body: "Glad that's sorted, {first_name}! Anything else I can help with?", topic: null },
];

/** First-response targets per priority, demo-scale (seconds). */
export const SLA_SECONDS: Record<Priority, number> = { urgent: 60, high: 120, normal: 300, low: 600 };

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const PRIYA: HotelUser = {
  id: "ACME:17",
  name: "Priya Shah",
  firstName: "Priya",
  email: "priya@acme-hotel.test",
  role: "Front desk",
  tenantCode: "ACME",
  tenantName: "Acme Hotel",
  propertyName: "Seaside",
  locale: "en",
};

export const MARCO: HotelUser = {
  id: "BLUE:4",
  name: "Marco Rossi",
  firstName: "Marco",
  email: "marco@bluebay.test",
  role: "Manager",
  tenantCode: "BLUE",
  tenantName: "Blue Bay Resort",
  propertyName: "Main",
  locale: "it",
};
