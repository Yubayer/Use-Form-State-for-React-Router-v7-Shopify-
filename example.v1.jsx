/**
 * @fileoverview useFormState — Polaris Web Components দিয়ে complete example।
 *
 * ─── Important: Polaris Web Components vs Polaris React ──────────────────────
 *  এটা Shopify-এর নতুন Web Components API (2025-10+)।
 *  Component names `s-` prefix দিয়ে শুরু হয়: s-text-field, s-button ইত্যাদি।
 *  Import করতে হয় না — polaris.js script tag থেকে auto-load হয়।
 *
 *  root.tsx-এ এই script tag add করতে হবে:
 *  <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
 *
 *  TypeScript types:
 *  npm install @shopify/polaris-types
 *
 * ─── Web Component event handling (JSX-এ) ───────────────────────────────────
 *  Polaris Web Components-এ events camelCase JSX prop হিসেবে আসে:
 *    onChange  → s-text-field, s-checkbox, s-drop-zone
 *    onClick   → s-button
 *    onBlur    → s-text-field
 *
 *  event.currentTarget দিয়ে element access করো:
 *    onChange={(e) => fs.set("title", e.currentTarget.value)}
 *
 * ─── fs.field.bind() Web Components-এ কাজ করে না ───────────────────────────
 *  Polaris React-এ bind() spread করা যেত।
 *  Web Components-এ prop names আলাদা — manually লিখতে হবে।
 *
 * ─── এই file-এ যা যা আছে ────────────────────────────────────────────────────
 *  1.  loaderData       — server থেকে আসা dummy data
 *  2.  buildShape       — server data → clean form shape
 *  3.  schema           — Zod validation schema
 *  4.  useFormState     — hook setup with all options
 *  5.  fs.values        — live form values read
 *  6.  fs.set/get/setMany/merge — general value ops
 *  7.  fs.field.*       — per-field error, dirty, touch, toggle, compute, watch
 *  8.  fs.list.*        — array operations with bindItem
 *  9.  fs.object.*      — dynamic key management
 *  10. fs.media.*       — file upload (s-drop-zone) + single URL null করা
 *  11. fs.snapshot.*    — saved baseline
 *  12. fs.history.*     — undo/redo
 *  13. fs.validate.*    — manual validation
 *  14. Lifecycle        — submit, reset, syncAfterSave
 */

import { useFormState, str, bool, num, arr, obj } from "./useFormState";
import { z } from "zod";
import { useFetcher } from "react-router";

/* ════════════════════════════════════════════════════════════════════════════
 * ███ 1. DUMMY SERVER DATA
 *
 * Real app-এ loader() থেকে আসে।
 * null, undefined, missing field সব থাকতে পারে।
 * ════════════════════════════════════════════════════════════════════════════ */

const loaderData = {
    // ── Scalar fields ─────────────────────────────────────────────────────
    id:          "prod_123",            // DB primary key — form-এ show করা হয় না, submit-এ পাঠানো হয়
    title:       "Handmade Leather Bag",// string — buildShape-এ str() দিয়ে normalize হবে
    description: "A beautiful handmade bag crafted with care.", // string
    email:       "contact@store.com",   // string — Zod schema-তে email format validate হবে
    phone:       "+8801712345678",      // string — regex দিয়ে validate হবে
    price:       1200,                  // number — buildShape-এ num() দিয়ে "1200" string হবে
    stock:       50,                    // number — num() দিয়ে "50" string হবে
    isActive:    true,                  // boolean — buildShape-এ bool() দিয়ে normalize হবে
    isFeatured:  false,                 // boolean

    // ── Single URL string fields ───────────────────────────────────────────
    // এগুলো form-এ preview দেখাতে use হয়।
    // User remove করলে fs.media.removeExisting() call করতে হয়।
    // null আসতে পারে — str() দিয়ে "" হবে।
    avatarUrl: "https://cdn.example.com/avatar.jpg", // server-এ already আছে
    coverUrl:  null,                                  // এখনো upload হয়নি

    // ── Nested objects ─────────────────────────────────────────────────────
    // buildShape-এ obj() দিয়ে normalize করা হবে।
    // server-এ null আসলে fallback object use হবে।
    address: { city: "Dhaka", zip: "1000", country: "BD" },
    seo:     { title: "Handmade Leather Bag — My Store", description: "Buy the best." },

    // ── Dynamic key object ─────────────────────────────────────────────────
    // কতটা key থাকবে আগে জানা নেই — runtime-এ add/delete হয়।
    // fs.object.setKey() / fs.object.deleteKey() দিয়ে manage করা হবে।
    socialLinks: {
        facebook:  "https://facebook.com/mystore",
        instagram: "https://instagram.com/mystore",
    },

    // ── Simple array ───────────────────────────────────────────────────────
    // buildShape-এ arr() দিয়ে normalize হবে।
    // fs.list.* দিয়ে manage করা হবে।
    tags: [
        { id: "t1", name: "leather",  color: "brown" },
        { id: "t2", name: "handmade", color: "green" },
    ],

    // ── Nested array — section → blocks ────────────────────────────────────
    // দুই level deep: sections array, প্রতিটা section-এর ভেতরে blocks array।
    // sortOrder — drag-drop reorder-এর পর DB-তে এই field save হয়।
    // fs.list.bindItem("sections", si) + fs.list.bindItem(`sections.${si}.blocks`, bi)
    sections: [
        {
            id: "s1", heading: "Features", sortOrder: 0,
            blocks: [
                { id: "b1", type: "text",  content:  "Durable and stylish." },
                { id: "b2", type: "image", imageUrl: "https://cdn.example.com/img1.jpg" },
            ],
        },
        {
            id: "s2", heading: "Specifications", sortOrder: 1,
            blocks: [
                { id: "b3", type: "text", content: "Weight: 500g" },
            ],
        },
    ],

    // ── Variants array ─────────────────────────────────────────────────────
    // sort, filter, updateWhere, findIndex সব এই array-তে দেখানো হবে।
    variants: [
        { id: "v1", name: "Small",  price: 1000, stock: 20, sortOrder: 0 },
        { id: "v2", name: "Medium", price: 1200, stock: 50, sortOrder: 1 },
        { id: "v3", name: "Large",  price: 1500, stock: 10, sortOrder: 2 },
    ],

    // ── FAQ array ──────────────────────────────────────────────────────────
    // reorder + normalizeOrder pattern দেখানো হবে।
    faqItems: [
        { id: "f1", question: "Is it waterproof?", answer: "Yes!",             sortOrder: 0 },
        { id: "f2", question: "What colors?",       answer: "Brown and Black.", sortOrder: 1 },
    ],

    // ── Images array ───────────────────────────────────────────────────────
    // Product-এর existing images — server-এ already আছে।
    // প্রতিটা item: { id, url, altText, sortOrder }
    //
    // কীভাবে manage করা হবে:
    //   existing image remove → fs.list.remove() — array থেকে বাদ যায়
    //   existing image reorder → fs.list.bindItem().moveUp/moveDown
    //   existing image altText update → fs.list.bindItem().setField("altText", v)
    //   নতুন image upload → fs.media (pendingFiles["newImages"])
    //
    // ⚠️  fs.media.removeExisting() এখানে use হয় না।
    //     সেটা single URL string field-এর জন্য (avatarUrl, coverUrl)।
    //     Image array manage করতে সবসময় fs.list use করো।
    images: [
        { id: "img1", url: "https://cdn.example.com/product-1.jpg", altText: "Front view",  sortOrder: 0 },
        { id: "img2", url: "https://cdn.example.com/product-2.jpg", altText: "Side view",   sortOrder: 1 },
        { id: "img3", url: "https://cdn.example.com/product-3.jpg", altText: "Detail view", sortOrder: 2 },
    ],
};

/* ════════════════════════════════════════════════════════════════════════════
 * ███ 2. buildShape — server data → clean form shape
 *
 * Normalize helper গুলো use করো:
 *   str()  — null/undefined → ""
 *   num()  — null/undefined → "", number → string
 *   bool() — null/undefined → false
 *   obj()  — null/undefined → fallback object
 *   arr()  — null/undefined → fallback array (default [])
 *
 * এটা না করলে null vs "" dirty check false positive দেবে।
 * ════════════════════════════════════════════════════════════════════════════ */

function buildShape(data) {
    return {
        // str(v) — null/undefined → ""
        // Server-এ null আসলে form-এ "" হবে — dirty check সঠিক থাকবে।
        // "" vs null হলে deepEqual fail করে isDirty = true হয়ে যেত।
        title:       str(data?.title),
        description: str(data?.description),
        email:       str(data?.email),
        phone:       str(data?.phone),
        avatarUrl:   str(data?.avatarUrl),  // null → "" — preview conditionally দেখানো হবে
        coverUrl:    str(data?.coverUrl),   // null → "" — এখনো upload হয়নি

        // num(v) — null/undefined → "", number → string
        // s-number-field ও s-money-field সবসময় string value নেয়।
        // Submit-এর সময় server-এ number হিসেবে পাঠানো যাবে।
        price: num(data?.price),   // 1200 → "1200"
        stock: num(data?.stock),   // 50 → "50"

        // bool(v) — null/undefined → false
        // s-checkbox-এর checked prop সবসময় boolean চায়।
        isActive:   bool(data?.isActive),
        isFeatured: bool(data?.isFeatured),

        // obj(v, fallback) — null/undefined বা non-object → fallback
        // Server-এ address না থাকলে fallback use হবে।
        // এতে form-এ address.city, address.zip সবসময় defined থাকবে।
        address: obj(data?.address,    { city: "", zip: "", country: "" }),
        seo:     obj(data?.seo,        { title: "", description: "" }),

        // Dynamic key object — কতটা key আছে জানা নেই
        // {} fallback দাও যাতে Object.entries() কাজ করে
        socialLinks: obj(data?.socialLinks, {}),

        // arr(v, fallback) — null/undefined/empty → []
        // .map() call করতে গেলে array হওয়া দরকার।
        // Server-এ null আসলে [] হবে, crash হবে না।
        tags:     arr(data?.tags),
        sections: arr(data?.sections),
        variants: arr(data?.variants),
        faqItems: arr(data?.faqItems),

        // images — existing product images array।
        // প্রতিটা item: { id, url, altText, sortOrder }
        // Server-এ null বা missing হলে [] হবে।
        images: arr(data?.images),
    };
}

/* ════════════════════════════════════════════════════════════════════════════
 * ███ 3. Zod Schema (optional)
 *
 * submit() বা validate.now() call হলে আগে এটা run হয়।
 * তারপর validate function run হয় — conflict হলে validate জেতে।
 * z.coerce.number() — string input ("1200") → number convert করে validate করে।
 * ════════════════════════════════════════════════════════════════════════════ */

const schema = z.object({
    title:       z.string().min(1, "Title required").max(100, "সর্বোচ্চ ১০০ character"),
    description: z.string().min(20, "কমপক্ষে ২০ character").max(1000, "সর্বোচ্চ ১০০০ character"),
    email:       z.string().email("Valid email দাও"),
    phone:       z.string().regex(/^\+?[0-9]{10,15}$/, "Valid phone number দাও").or(z.literal("")),
    price:       z.coerce.number().positive("০ এর বেশি হতে হবে"),
    stock:       z.coerce.number().min(0, "০ এর কম হবে না"),
});

/* ════════════════════════════════════════════════════════════════════════════
 * ███ 4. Component
 * ════════════════════════════════════════════════════════════════════════════ */

export function ProductForm() {
    const fetcher = useFetcher();

    /* ────────────────────────────────────────────────────────────────────────
     * useFormState setup — সব options সহ
     *
     * Parameter:
     *   1. loaderData  — server থেকে আসা raw data (null/undefined হতে পারে)
     *   2. buildShape  — data → form shape করার pure function
     *   3. options     — validation, submit, history, debug ইত্যাদি
     * ──────────────────────────────────────────────────────────────────────── */

    const fs = useFormState(loaderData, buildShape, {

        // ── schema ────────────────────────────────────────────────────────────
        // Zod schema — submit() বা validate.now() call হলে সবার আগে run হয়।
        // safeParse() use করে — throw করে না, error object return করে।
        // Shorthand: { schema } মানে { schema: schema }
        schema,

        // ── validate ──────────────────────────────────────────────────────────
        // Manual validate function — schema-র পরে run হয়।
        // Schema-তে express করা যায় না এমন rule এখানে লিখো:
        //   — cross-field validation (একটা field অন্যটার উপর নির্ভর করে)
        //   — conditional rule (active হলে price required)
        //   — custom business logic
        // Conflict হলে এই function-এর error জেতে।
        // Receives: current form values
        // Returns:  { "dot.path": "error message" } — empty = valid
        validate: (values) => {
            const errors = {};

            // Custom rule — schema-তে express করা যায় না
            if (values.title === "Test Product") {
                errors.title = "এই নামে product আগে থেকেই আছে";
            }

            // Cross-field check — variant price, main price-এর দ্বিগুণ হতে পারবে না
            // Nested array error key: "variants.0.price", "variants.1.price"
            values.variants.forEach((v, i) => {
                if (Number(v.price) > Number(values.price) * 2) {
                    errors[`variants.${i}.price`] = "Main price-এর দ্বিগুণের বেশি হবে না";
                }
            });

            // Nested array item-level validation
            values.faqItems.forEach((f, i) => {
                if (f.answer && f.answer.length < 5) {
                    errors[`faqItems.${i}.answer`] = "কমপক্ষে ৫ character লিখতে হবে";
                }
            });

            return errors;
        },

        // ── validateOnChange ──────────────────────────────────────────────────
        // false (default) — শুধু onBlur বা submit-এ validate হয়। Better UX।
        // true  — প্রতি keystroke-এ validation run হয়। Real-time feedback।
        //         Large form বা complex schema-তে performance hit হতে পারে।
        validateOnChange: false,

        // ── onSubmit ──────────────────────────────────────────────────────────
        // Validation pass হলে submit() call করলে এটা run হয়।
        // isSubmitting = true হয়, await শেষ হলে false হয়।
        //
        // Receives:
        //   values       — current form values (normalized, clean)
        //   pendingFiles — { slotName: File[] } নতুন upload করা files
        //                  values-এ serialize হয় না তাই আলাদা আসে
        //   removedKeys  — { urlFieldPath: true } DB-তে null করার flags
        //                  fs.media.removeExisting() call হলে এখানে আসে
        onSubmit: async (values, { pendingFiles, removedKeys }) => {
            const fd = new FormData();

            // সব form values JSON-এ পাঠাও
            fd.append("data", JSON.stringify(values));

            // removedKeys: { "avatarUrl": true } মানে server-এ avatarUrl = null করো
            // Server এই flag দেখে DB-তে null করবে
            fd.append("removedMedia", JSON.stringify(removedKeys));

            // Single file — avatar slot থেকে প্রথম file নাও
            if (pendingFiles["avatar"]?.[0]) fd.append("avatar", pendingFiles["avatar"][0]);
            if (pendingFiles["cover"]?.[0])  fd.append("cover",  pendingFiles["cover"][0]);

            // Multiple files — gallery slot থেকে সব file নাও
            // Server-এ `gallery_0`, `gallery_1` key দিয়ে parse করো
            (pendingFiles["gallery"] ?? []).forEach((file, i) => {
                fd.append(`gallery_${i}`, file);
            });

            // New product images — pendingFiles["newImages"]
            // values.images — remaining existing images (server এটা দেখে কোনগুলো রাখবে)
            // Server flow:
            //   1. values.images-এ যেগুলো নেই সেগুলো delete করো
            //   2. pendingFiles["newImages"] গুলো upload করে DB-তে save করো
            (pendingFiles["newImages"] ?? []).forEach((file, i) => {
                fd.append(`newImages_${i}`, file);
            });

            fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
        },

        // ── syncOnServerDataChange ────────────────────────────────────────────
        // true  (default) — loaderData reference বদলালে form + snapshot auto re-init।
        //                   Page reload বা navigation-এ fresh data আসলে automatically sync।
        // false — নিজে syncAfterSave() manually call করতে চাইলে।
        syncOnServerDataChange: true,

        // ── historyLimit ──────────────────────────────────────────────────────
        // 0 (default) — undo/redo disabled, history রাখে না, extra memory নেই।
        // 50          — সর্বোচ্চ ৫০ step undo/redo করা যাবে।
        //               বেশি দিলে memory বেশি লাগে। 20-50 practical range।
        historyLimit: 50,

        // ── debug ─────────────────────────────────────────────────────────────
        // true  — সব state change console-এ log হবে। Development-এ কাজে লাগে।
        //         Console output: [ProductForm] set("title") → { ...newValues }
        // false (default) — কোনো log নেই। Production-এ false রাখো।
        debug: true,

        // ── debugLabel ────────────────────────────────────────────────────────
        // Console log-এর prefix label।
        // একই page-এ একাধিক form থাকলে কোন form-এর log সেটা বোঝা যাবে।
        debugLabel: "ProductForm",
    });

    /* ────────────────────────────────────────────────────────────────────────
     * Successful save-এর পর snapshot sync করো।
     * isDirty = false হবে।
     * ──────────────────────────────────────────────────────────────────────── */
    // useEffect(() => {
    //     if (fetcher.state === "idle" && fetcher.data?.product) {
    //         fs.syncAfterSave(fetcher.data.product);
    //     }
    // }, [fetcher.state, fetcher.data]);

    /* ────────────────────────────────────────────────────────────────────────
     * fs.field.compute — title বদলালে seo.title auto-update করো।
     *
     * কীভাবে কাজ করে:
     *   deps (["title"]) array-এর values watch করে।
     *   title বদলালে computeFn(values) run হয়।
     *   Result "seo.title" field-এ automatically set হয়।
     *
     * ⚠️  Component-এর top level-এ call করো।
     *     React-এর hook rule — condition বা loop-এর ভেতরে call করা যাবে না।
     *     ভেতরে useEffect আছে তাই এই নিয়ম apply হয়।
     *
     * Parameters:
     *   1. "seo.title"  — computed value কোন field-এ বসবে
     *   2. computeFn    — values নিয়ে computed value return করে
     *   3. ["title"]    — কোন field বদলালে recompute হবে
     * ──────────────────────────────────────────────────────────────────────── */
    fs.field.compute(
        "seo.title",
        (values) => values.title ? `${values.title} — My Store` : "",
        ["title"]
        // title: "Handmade Leather Bag" → seo.title: "Handmade Leather Bag — My Store"
        // title: "" → seo.title: ""
    );

    /* ────────────────────────────────────────────────────────────────────────
     * fs.field.watch — isActive false হলে isFeatured auto-reset করো।
     *
     * কীভাবে কাজ করে:
     *   "isActive" field watch করে।
     *   বদলালে callback(newValue, prevValue) call হয়।
     *   Side effect run করো — এখানে isFeatured reset।
     *
     * ⚠️  Component-এর top level-এ call করো।
     *     ভেতরে useEffect আছে — hook rule apply হয়।
     *
     * Parameters:
     *   1. "isActive"  — কোন field watch করবে
     *   2. callback    — (newValue, prevValue) receive করে
     * ──────────────────────────────────────────────────────────────────────── */
    fs.field.watch("isActive", (next, prev) => {
        // isActive: true → false হলে featured reset করো
        // featured product inactive থাকার মানে নেই
        if (!next && prev) fs.set("isFeatured", false);
    });

    /* ════════════════════════════════════════════════════════════════════════
     * JSX — Polaris Web Components দিয়ে
     * ════════════════════════════════════════════════════════════════════════ */

    return (
        // ── s-page — main page wrapper ────────────────────────────────────────
        // heading    — page-এর title, Shopify admin-এ দেখায়
        // Slots:
        //   slot="primary-action"    — page header-এর right-এ primary button
        //   slot="secondary-actions" — primary-র পাশে secondary buttons
        //   slot="breadcrumb-actions"— back navigation (s-link only)
        //   children (default)       — main page content
        <s-page heading="Edit Product">

            {/* ── primary-action slot ────────────────────────────────────────
              * Page header-এ right-এ দেখায়।
              * শুধু variant="primary" button accept করে।
              *
              * loading  — true হলে spinner দেখায়, button disabled হয়
              * disabled — isDirty=false হলে কিছু change হয়নি, save করার দরকার নেই
              * ──────────────────────────────────────────────────────────────── */}
            <s-button
                slot="primary-action"
                variant="primary"
                loading={fs.isSubmitting}
                disabled={!fs.isDirty || fs.isSubmitting}
                onClick={fs.submit}
                // fs.submit — validate করে, pass হলে onSubmit call করে
            >
                {fs.isSubmitting ? "Saving…" : "Save"}
            </s-button>

            {/* ── secondary-actions slot ─────────────────────────────────────
              * Discard — সব change বাদ দিয়ে snapshot-এ revert করো।
              * isDirty = false হলে disable — কিছু change হয়নি।
              * ──────────────────────────────────────────────────────────────── */}
            <s-button
                slot="secondary-actions"
                variant="secondary"
                disabled={!fs.isDirty}
                onClick={fs.reset}
                // fs.reset — values → savedSnapshot, সব error/touched clear
            >
                Discard
            </s-button>


            {/* ── Unsaved changes banner ─────────────────────────────────────
              * fs.isDirty = true হলে user-কে জানাও যে unsaved change আছে।
              * Page ছেড়ে যাওয়ার আগে save বা discard করতে বলো।
              * tone="warning" — হলুদ রঙ, সতর্কতা বোঝায়
              * ──────────────────────────────────────────────────────────────── */}
            {fs.isDirty && (
                <s-banner tone="warning" heading="Unsaved changes">
                    You have unsaved changes. Save or discard before leaving.
                </s-banner>
            )}

            {/* ── Submit error banner ────────────────────────────────────────
              * submit attempt হয়েছে কিন্তু validation error আছে।
              * submitCount > 0 — অন্তত একবার submit চেষ্টা হয়েছে।
              * সব error একসাথে list করো যাতে user সব দেখতে পায়।
              * tone="critical" — লাল রঙ, সমস্যা বোঝায়
              * ──────────────────────────────────────────────────────────────── */}
            {fs.submitCount > 0 && Object.keys(fs.fieldErrors).length > 0 && (
                <s-banner tone="critical" heading="Please fix the errors below">
                    {/* fs.fieldErrors — { "dot.path": "error message" } raw map */}
                    {Object.entries(fs.fieldErrors).map(([path, msg]) => (
                        <p key={path}>• {msg}</p>
                    ))}
                </s-banner>
            )}


            {/* ══════════════════════════════════════════════════════════════
              * s-section — related fields group করো
              *
              * heading — section-এর title
              * Children — যেকোনো Polaris Web Component রাখা যায়।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Basic Information">

                {/* ── fs.field.isDirty — per-field dirty indicator ──────────
                  * title field snapshot থেকে আলাদা হলে banner দেখাও।
                  * subtree check-ও করে: fs.field.isDirty("address") — address-এর
                  * যেকোনো child বদলালে true।
                  * ──────────────────────────────────────────────────────── */}
                {fs.field.isDirty("title") && (
                    <s-banner tone="info">Title has been changed</s-banner>
                )}

                {/* ── s-text-field — single line text input ──────────────────
                  *
                  * Props:
                  *   label    — field label (required)
                  *   value    — current value — fs.values থেকে নাও
                  *   onChange — e.currentTarget.value দিয়ে fs.set() call করো
                  *   onBlur   — fs.field.touch() call করো
                  *              touch হলে error দেখানো শুরু হয়
                  *   error    — fs.field.error() — touched হলে বা submit হলে দেখায়
                  *              null হলে undefined দাও — empty string হলে empty error দেখায়
                  *
                  * ⚠️  Polaris Web Components-এ fs.field.bind() spread হয় না।
                  *     Polaris React-এ {...fs.field.bind("title")} করা যেত।
                  *     Web Components-এ prop names আলাদা, manually লিখতে হবে।
                  * ──────────────────────────────────────────────────────── */}
                <s-text-field
                    label="Title"
                    value={fs.values.title}
                    onChange={(e) => fs.set("title", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("title")}
                    error={fs.field.error("title") ?? undefined}
                />

                {/* ── s-text-area — multiline text input ─────────────────────
                  * Description-এর মতো long text-এর জন্য।
                  * s-text-field-এর মতোই — শুধু component name আলাদা।
                  * ──────────────────────────────────────────────────────── */}
                <s-text-area
                    label="Description"
                    value={fs.values.description}
                    onChange={(e) => fs.set("description", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("description")}
                    error={fs.field.error("description") ?? undefined}
                />

                {/* ── s-email-field — email input ─────────────────────────────
                  * Built-in email format validation আছে browser level-এ।
                  * Zod schema-তেও email validate হচ্ছে।
                  *
                  * onBlur-এ fs.validate.field("email") call করা হচ্ছে।
                  * এতে blur হওয়ার সাথে সাথে single field validate হয়
                  * এবং error immediately দেখায় — submit-এর জন্য অপেক্ষা করতে হয় না।
                  * ──────────────────────────────────────────────────────── */}
                <s-email-field
                    label="Email"
                    value={fs.values.email}
                    onChange={(e) => fs.set("email", e.currentTarget.value)}
                    onBlur={() => {
                        fs.field.touch("email");          // touched mark করো
                        fs.validate.field("email");       // single field validate — error immediately
                    }}
                    error={fs.field.error("email") ?? undefined}
                />

                {/* ── s-text-field — phone ──────────────────────────────────
                  * Phone-এর জন্য specific type নেই।
                  * Zod schema-তে regex দিয়ে validate হচ্ছে।
                  * ──────────────────────────────────────────────────────── */}
                <s-text-field
                    label="Phone"
                    value={fs.values.phone}
                    onChange={(e) => fs.set("phone", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("phone")}
                    error={fs.field.error("phone") ?? undefined}
                />

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Pricing & Inventory
              *
              * price, stock — buildShape-এ num() দিয়ে string হয়েছে।
              * s-money-field ও s-number-field string value নেয়।
              * Zod schema-তে z.coerce.number() দিয়ে string → number convert হয়।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Pricing & Inventory">

                {/* ── s-money-field — monetary value input ───────────────────
                  * Currency formatting built-in আছে।
                  * value string হিসেবে দিতে হয় (num() দিয়ে normalize হয়েছে)।
                  * onChange-এ string আসে — Zod schema coerce করে validate করবে।
                  * ──────────────────────────────────────────────────────── */}
                <s-money-field
                    label="Price"
                    value={fs.values.price}
                    onChange={(e) => fs.set("price", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("price")}
                    error={fs.field.error("price") ?? undefined}
                />

                {/* ── s-number-field — numeric input ─────────────────────────
                  * Number validation built-in আছে (non-numeric type করতে দেয় না)।
                  * value string হিসেবে দিতে হয়।
                  * ──────────────────────────────────────────────────────── */}
                <s-number-field
                    label="Stock"
                    value={fs.values.stock}
                    onChange={(e) => fs.set("stock", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("stock")}
                    error={fs.field.error("stock") ?? undefined}
                />

                {/* ── fs.field.increment / fs.field.decrement — numeric shortcut
                  *
                  * fs.set("stock", Number(fs.values.stock) + 1) এর shortcut।
                  * step parameter দিয়ে custom step দেওয়া যায়।
                  *
                  * ⚠️  stock string হিসেবে store আছে।
                  *     hook ভেতরে Number() convert করে add করে।
                  * ──────────────────────────────────────────────────────── */}
                <s-button-group>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.field.decrement("stock")}        // stock - 1
                        disabled={Number(fs.values.stock) <= 0}            // 0 এর নিচে যাবে না
                    >
                        − 1
                    </s-button>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.field.decrement("stock", 10)}    // stock - 10
                        disabled={Number(fs.values.stock) < 10}
                    >
                        − 10
                    </s-button>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.field.increment("stock")}        // stock + 1
                    >
                        + 1
                    </s-button>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.field.increment("stock", 10)}    // stock + 10
                    >
                        + 10
                    </s-button>
                </s-button-group>

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Status — boolean fields
              *
              * s-checkbox — checked/unchecked toggle।
              * fs.field.toggle — button দিয়ে boolean flip করার shortcut।
              * fs.field.watch — isActive false হলে isFeatured auto-reset।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Status">

                {/* ── s-checkbox — boolean field ─────────────────────────────
                  *
                  * Props:
                  *   checked  — boolean value (fs.values.isActive)
                  *              string দিলে কাজ করবে না — bool() দিয়ে normalize জরুরি
                  *   onChange — e.currentTarget.checked → boolean
                  *   details  — checkbox-এর নিচে helper text দেখায়
                  *   disabled — true হলে click করা যাবে না
                  * ──────────────────────────────────────────────────────── */}
                <s-checkbox
                    label="Active"
                    checked={fs.values.isActive}
                    onChange={(e) => fs.set("isActive", e.currentTarget.checked)}
                    details="Active products are visible in the store"
                    // details prop — checkbox-এর নিচে ছোট help text দেখায়
                />

                <s-checkbox
                    label="Featured"
                    checked={fs.values.isFeatured}
                    onChange={(e) => fs.set("isFeatured", e.currentTarget.checked)}
                    disabled={!fs.values.isActive}
                    // isActive false হলে disabled — fs.field.watch() auto-reset করে
                    details={!fs.values.isActive ? "Activate product first" : "Show in featured section"}
                    // details — condition-এ আলাদা message দেখাও
                />

                {/* ── fs.field.toggle — boolean flip shortcut ────────────────
                  * fs.set("isActive", !fs.values.isActive) এর shortcut।
                  * Checkbox-এর alternative pattern — button দিয়ে toggle।
                  * ──────────────────────────────────────────────────────── */}
                <s-button
                    variant="secondary"
                    onClick={() => fs.field.toggle("isActive")}
                    // isActive: true → false, false → true
                >
                    {fs.values.isActive ? "Deactivate" : "Activate"}
                </s-button>

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Address — nested object field
              *
              * fs.set("address.city", value) — dot-path দিয়ে nested field update।
              * fs.merge({ city, zip }, "address") — একসাথে multiple field update।
              * fs.field.isDirty("address") — subtree dirty check।
              * fs.snapshot.get("address") — saved snapshot থেকে restore।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Address">

                {/* ── Nested field — dot-path দিয়ে ───────────────────────────
                  * "address.city" — address object-এর city property।
                  * fs.set("address.city", value) → address.city update হয়,
                  * address.zip ও address.country unchanged থাকে।
                  * ──────────────────────────────────────────────────────── */}
                <s-text-field
                    label="City"
                    value={fs.values.address.city}
                    onChange={(e) => fs.set("address.city", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("address.city")}
                    error={fs.field.error("address.city") ?? undefined}
                />

                <s-text-field
                    label="ZIP"
                    value={fs.values.address.zip}
                    onChange={(e) => fs.set("address.zip", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("address.zip")}
                    error={fs.field.error("address.zip") ?? undefined}
                />

                {/* ── fs.merge — address-এর multiple fields একসাথে update ──
                  * fs.set() আলাদা করলে দুটো render হয়।
                  * fs.merge() একটা render-এ করে।
                  * "address" path-এ { city, zip } shallow-merge হয়।
                  * address.country unchanged থাকে।
                  * ──────────────────────────────────────────────────────── */}
                <s-button
                    variant="secondary"
                    onClick={() => fs.merge({ city: "Chittagong", zip: "4000" }, "address")}
                    // address.city → "Chittagong", address.zip → "4000"
                    // address.country → "BD" (unchanged)
                >
                    Set Chittagong address
                </s-button>

                {/* ── fs.field.isDirty + fs.snapshot.get — per-field revert ──
                  * address subtree-এর যেকোনো child বদলালে isDirty = true।
                  * snapshot থেকে পুরো address restore করো।
                  * ──────────────────────────────────────────────────────── */}
                {fs.field.isDirty("address") && (
                    <s-button
                        variant="tertiary"
                        onClick={() => fs.set("address", fs.snapshot.get("address"))}
                        // snapshot-এর { city: "Dhaka", zip: "1000", country: "BD" }-এ ফিরে যাবে
                    >
                        Revert address
                    </s-button>
                )}

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * SEO — nested object + fs.setMany batch update
              *
              * seo.title — fs.field.compute দিয়ে title থেকে auto-generate হয়।
              *             User manually edit করলে compute override হয় না।
              *             (compute শুধু title বদলালে run হয়)
              *
              * fs.setMany — title + seo.title + seo.description একটা render-এ।
              *              আলাদা fs.set() করলে তিনটা re-render হতো।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="SEO">

                {/* seo.title — fs.field.compute দিয়ে title থেকে auto-generate হয়।
                  * User এটা manually edit করতে পারবে — override হবে না।
                  * title field watch করে — title বদলালে এটা update হয়। */}
                <s-text-field
                    label="SEO Title"
                    value={fs.values.seo.title}
                    onChange={(e) => fs.set("seo.title", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("seo.title")}
                    error={fs.field.error("seo.title") ?? undefined}
                />

                <s-text-area
                    label="SEO Description"
                    value={fs.values.seo.description}
                    onChange={(e) => fs.set("seo.description", e.currentTarget.value)}
                    onBlur={() => fs.field.touch("seo.description")}
                    error={fs.field.error("seo.description") ?? undefined}
                />

                {/* ── fs.setMany — batch update একটা render-এ ──────────────
                  * তিনটা field আলাদা fs.set() করলে তিনটা re-render হতো।
                  * setMany একটা functional update-এ সব apply করে — একটা render।
                  * ──────────────────────────────────────────────────────── */}
                <s-button
                    variant="secondary"
                    onClick={() => fs.setMany([
                        ["title",           "Premium Leather Bag"],
                        ["seo.title",       "Premium Leather Bag — My Store"],
                        ["seo.description", "Buy premium leather bags."],
                        // তিনটা field একটা render-এ update হবে
                    ])}
                >
                    Apply preset SEO
                </s-button>

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Social Links — fs.object দিয়ে dynamic key management
              *
              * socialLinks = { facebook: "...", instagram: "..." }
              * কতটা key থাকবে আগে জানা নেই — runtime-এ add/delete হয়।
              *
              * fs.object.setKey(parentPath, key, value) — key add বা update
              * fs.object.deleteKey(parentPath, key)     — key remove
              *
              * Object.entries() দিয়ে render করো — key list dynamic।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Social Links">

                {/* Dynamic keys — Object.entries দিয়ে render ─────────────────
                  * প্রতিটা [platform, url] pair render হয়।
                  * platform = "facebook", url = "https://facebook.com/mystore"
                  * ──────────────────────────────────────────────────────── */}
                {Object.entries(fs.values.socialLinks).map(([platform, url]) => (
                    <div key={platform} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>

                        {/* ── s-url-field — URL validation built-in ─────────
                          * label — platform নাম capitalize করে দেখাও
                          * onChange — fs.object.setKey() দিয়ে value update
                          *            platform key-টা unchanged থাকে
                          * ──────────────────────────────────────────────── */}
                        <s-url-field
                            label={platform.charAt(0).toUpperCase() + platform.slice(1)}
                            value={url}
                            onChange={(e) => fs.object.setKey("socialLinks", platform, e.currentTarget.value)}
                            // socialLinks.facebook = "new url"
                            onBlur={() => fs.field.touch(`socialLinks.${platform}`)}
                            error={fs.field.error(`socialLinks.${platform}`) ?? undefined}
                        />

                        {/* ── fs.object.deleteKey — key remove ──────────────
                          * socialLinks থেকে এই platform key বাদ দাও।
                          * Object.entries re-render-এ এটা আর দেখাবে না।
                          * ──────────────────────────────────────────────── */}
                        <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() => fs.object.deleteKey("socialLinks", platform)}
                        >
                            Remove
                        </s-button>
                    </div>
                ))}

                {/* ── নতুন platform key add করো ─────────────────────────────
                  * fs.object.setKey() — key exist না করলে add হয়,
                  *                      exist করলে value update হয়।
                  * "" দিয়ে empty value add করো — user পরে URL type করবে।
                  * ──────────────────────────────────────────────────────── */}
                <s-button-group>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.object.setKey("socialLinks", "tiktok", "")}
                        // socialLinks.tiktok = "" — নতুন key add হবে
                    >
                        + TikTok
                    </s-button>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.object.setKey("socialLinks", "twitter", "")}
                    >
                        + Twitter/X
                    </s-button>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.object.setKey("socialLinks", "youtube", "")}
                    >
                        + YouTube
                    </s-button>
                </s-button-group>

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Tags — fs.list দিয়ে simple array manage
              *
              * fs.list.bindItem(path, index) — row-এর সব helper একসাথে পাও:
              *   item.value    — এই index-এর current data { id, name, color }
              *   item.index    — array-তে position
              *   item.isFirst  — প্রথম item কিনা (moveUp disable করতে)
              *   item.isLast   — শেষ item কিনা (moveDown disable করতে)
              *   item.isDirty  — এই row snapshot থেকে আলাদা হয়েছে কিনা
              *   item.setField — এই item-এর একটা field update
              *   item.remove   — এই item বাদ দাও (array shrink হয়)
              *   item.duplicate— clone করে ঠিক পরে insert
              *   item.moveUp   — একটা position উপরে
              *   item.moveDown — একটা position নিচে
              *   item.replace  — পুরো item replace
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Tags">

                {fs.values.tags.map((tag, i) => {
                    // bindItem — এই row-এর সব helper একসাথে পাও
                    const item = fs.list.bindItem("tags", i);
                    return (
                        <div key={tag.id} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>

                            {/* ── item.setField — এই item-এর একটা field update ──
                              * fs.list.setField("tags", i, "name", value) এর shortcut।
                              * শুধু এই item-এর name update হয় — বাকি items unchanged।
                              * ──────────────────────────────────────────────── */}
                            <s-text-field
                                label="Tag name"
                                value={item.value.name}
                                onChange={(e) => item.setField("name", e.target.value)}
                            />

                            <s-text-field
                                label="Color"
                                value={item.value.color}
                                onChange={(e) => item.setField("color", e.target.value)}
                            />

                            {/* ── item.isDirty — এই row change হয়েছে কিনা ────
                              * Snapshot-এর এই index-এর item-এর সাথে compare।
                              * Changed indicator দেখাও।
                              * ──────────────────────────────────────────────── */}
                            {item.isDirty && (
                                <s-badge tone="warning">Changed</s-badge>
                            )}

                            {/* ── moveUp / moveDown — reorder ───────────────────
                              * item.isFirst = true হলে moveUp disable।
                              * item.isLast  = true হলে moveDown disable।
                              * ──────────────────────────────────────────────── */}
                            <s-button
                                variant="tertiary"
                                onClick={item.moveUp}
                                disabled={item.isFirst}   // প্রথম item উপরে যেতে পারবে না
                                icon="arrow-up"
                            />
                            <s-button
                                variant="tertiary"
                                onClick={item.moveDown}
                                disabled={item.isLast}    // শেষ item নিচে যেতে পারবে না
                                icon="arrow-down"
                            />

                            {/* ── item.duplicate — clone করে পরে insert ────────
                              * এই item-এর deep clone তৈরি করে ঠিক পরে insert।
                              * Original unchanged থাকে।
                              * ──────────────────────────────────────────────── */}
                            <s-button variant="tertiary" onClick={item.duplicate}>
                                Copy
                            </s-button>

                            {/* ── item.remove — array থেকে বাদ দাও ────────────
                              * index-এ splice হয়, array length কমে।
                              * বাকি items-এর index shift হয়।
                              * ──────────────────────────────────────────────── */}
                            <s-button
                                variant="tertiary"
                                tone="critical"
                                onClick={item.remove}
                                icon="delete"
                            />
                        </div>
                    );
                })}

                <s-button-group>
                    {/* ── fs.list.append — শেষে add ─────────────────────────
                      * Object item deep-clone হয় — template mutate হয় না।
                      * id: Date.now() — temp unique id (server save-এ real id আসবে)
                      * ──────────────────────────────────────────────────── */}
                    <s-button
                        variant="secondary"
                        onClick={() => fs.list.append("tags", { id: Date.now(), name: "", color: "blue" })}
                    >
                        Add tag
                    </s-button>

                    {/* ── fs.list.filter — condition match করা গুলো রাখো ────
                      * name="" tags বাদ দাও।
                      * tag => tag.name !== "" — predicate function
                      * Match করে না এমন গুলো remove হয়।
                      * ──────────────────────────────────────────────────── */}
                    <s-button
                        variant="tertiary"
                        onClick={() => fs.list.filter("tags", tag => tag.name !== "")}
                    >
                        Remove empty tags
                    </s-button>

                    {/* ── fs.list.clear — পুরো array [] করে দাও ────────────── */}
                    <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => fs.list.clear("tags")}
                    >
                        Clear all tags
                    </s-button>
                </s-button-group>

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Variants — array sort, filter, updateWhere, find, findIndex
              *
              * fs.list.sort(path, field, direction) — field দিয়ে sort
              * fs.list.filter(path, predicate)      — condition-এ filter
              * fs.list.updateWhere(path, pred, patch) — bulk update
              * fs.list.find(path, predicate)        — item খোঁজো
              * fs.list.findIndex(path, predicate)   — index খোঁজো
              * fs.list.swap(path, i, j)             — দুটো item swap
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Variants">

                <s-button-group>
                    {/* ── fs.list.sort — field দিয়ে sort ──────────────────────
                      * "asc"  — ascending (ছোট থেকে বড়)
                      * "desc" — descending (বড় থেকে ছোট)
                      * ──────────────────────────────────────────────────── */}
                    <s-button
                        variant="secondary"
                        onClick={() => fs.list.sort("variants", "price", "asc")}
                        // Small(1000), Medium(1200), Large(1500)
                    >
                        Sort by price ↑
                    </s-button>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.list.sort("variants", "price", "desc")}
                        // Large(1500), Medium(1200), Small(1000)
                    >
                        Sort by price ↓
                    </s-button>
                    <s-button
                        variant="secondary"
                        onClick={() => fs.list.sort("variants", "name", "asc")}
                        // Large, Medium, Small (alphabetical)
                    >
                        Sort by name A→Z
                    </s-button>

                    {/* ── fs.list.swap — দুটো item position exchange ──────────
                      * variants[0] ↔ variants[1]
                      * ──────────────────────────────────────────────────── */}
                    <s-button
                        variant="secondary"
                        onClick={() => fs.list.swap("variants", 0, 1)}
                        // Small ↔ Medium
                    >
                        Swap first two
                    </s-button>

                    {/* ── fs.list.filter — condition-এ filter ─────────────────
                      * stock <= 0 variants বাদ দাও।
                      * predicate false return করলে সেই item বাদ যায়।
                      * ──────────────────────────────────────────────────── */}
                    <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => fs.list.filter("variants", v => Number(v.stock) > 0)}
                        // stock = 0 variants array থেকে বাদ যাবে
                    >
                        Remove out-of-stock
                    </s-button>

                    {/* ── fs.list.updateWhere — condition-এ bulk update ────────
                      * out-of-stock variants-এর name suffix add করো।
                      * predicate match করা সব item-এ patch apply হয়।
                      * ──────────────────────────────────────────────────── */}
                    <s-button
                        variant="tertiary"
                        onClick={() => fs.list.updateWhere(
                            "variants",
                            v => Number(v.stock) === 0,        // condition
                            { name: "Out of Stock" }           // এই patch apply হবে
                        )}
                    >
                        Mark out-of-stock
                    </s-button>

                    {/* ── fs.list.find + fs.list.findIndex ────────────────────
                      * id দিয়ে item খোঁজো — index manually track করতে হয় না।
                      * ──────────────────────────────────────────────────── */}
                    <s-button
                        variant="tertiary"
                        onClick={() => {
                            // id দিয়ে index খোঁজো
                            const idx = fs.list.findIndex("variants", v => v.id === "v2");
                            // → 1 (Medium variant-এর index)
                            if (idx !== -1) {
                                fs.list.remove("variants", idx);
                                // Medium variant বাদ যাবে
                            }
                        }}
                    >
                        Remove Medium by id
                    </s-button>

                    <s-button
                        variant="tertiary"
                        onClick={() => {
                            // item object return করে — index না
                            const medium = fs.list.find("variants", v => v.name === "Medium");
                            console.log("Medium:", medium);
                            // → { id: "v2", name: "Medium", price: 1200, ... }
                        }}
                    >
                        Find Medium (log)
                    </s-button>
                </s-button-group>

                {/* Variants list — bindItem দিয়ে row manage */}
                {fs.values.variants.map((variant, i) => {
                    const item = fs.list.bindItem("variants", i);
                    return (
                        <div key={variant.id} style={{ border: "1px solid #ccc", padding: "12px", marginBottom: "8px" }}>

                            {/* item.value.name — এই variant-এর current name */}
                            <s-text-field
                                label="Name"
                                value={item.value.name}
                                onChange={(e) => item.setField("name", e.target.value)}
                            />

                            {/* cross-field validation error — variants.i.price */}
                            <s-money-field
                                label="Price"
                                value={item.value.price}
                                onChange={(e) => item.setField("price", e.currentTarget.value)}
                                error={fs.field.error(`variants.${i}.price`) ?? undefined}
                                // validate function-এ: variants.0.price, variants.1.price
                            />

                            <s-number-field
                                label="Stock"
                                value={item.value.stock}
                                onChange={(e) => item.setField("stock", e.currentTarget.value)}
                            />

                            {/* এই specific variant dirty হলে indicator */}
                            {item.isDirty && <s-badge tone="warning">Modified</s-badge>}

                            <s-button-group>
                                <s-button variant="tertiary" onClick={item.moveUp}   disabled={item.isFirst}>↑</s-button>
                                <s-button variant="tertiary" onClick={item.moveDown} disabled={item.isLast}>↓</s-button>
                                {/* duplicate — clone করে পরে insert */}
                                <s-button variant="tertiary" onClick={item.duplicate}>Duplicate</s-button>
                                <s-button variant="tertiary" tone="critical" onClick={item.remove}>Remove</s-button>
                            </s-button-group>
                        </div>
                    );
                })}

                {/* ── fs.list.append — শেষে নতুন variant add ─────────────────
                  * sortOrder: variants.length — শেষে position assign করো
                  * ──────────────────────────────────────────────────────── */}
                <s-button
                    variant="secondary"
                    onClick={() => fs.list.append("variants", {
                        id: Date.now(),
                        name: "",
                        price: 0,
                        stock: 0,
                        sortOrder: fs.values.variants.length,
                    })}
                >
                    Add variant
                </s-button>

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Sections — nested array (section → blocks)
              *
              * দুই level deep array:
              *   sections[0].blocks[0] → path: "sections.0.blocks.0"
              *
              * Path dynamically build করো:
              *   section level: fs.list.bindItem("sections", si)
              *   block level:   fs.list.bindItem(`sections.${si}.blocks`, bi)
              *
              * যতটা deep হোক, dot-path pattern একই।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Content Sections">

                {fs.values.sections.map((section, si) => {
                    // si = section index (0, 1, 2...)
                    const sectionItem = fs.list.bindItem("sections", si);
                    return (
                        <div key={section.id} style={{ border: "1px solid #e0e0e0", padding: "16px", marginBottom: "12px" }}>

                            {/* Section heading — sectionItem.setField দিয়ে update */}
                            <s-text-field
                                label="Section heading"
                                value={sectionItem.value.heading}
                                onChange={(e) => sectionItem.setField("heading", e.target.value)}
                                // fs.list.setField("sections", si, "heading", value) এর shortcut
                            />

                            <s-button-group>
                                <s-button variant="tertiary" onClick={sectionItem.moveUp}   disabled={sectionItem.isFirst}>↑</s-button>
                                <s-button variant="tertiary" onClick={sectionItem.moveDown} disabled={sectionItem.isLast}>↓</s-button>
                                {/* সম্পূর্ণ section deep-clone করে পরে insert */}
                                <s-button variant="tertiary" onClick={sectionItem.duplicate}>Duplicate section</s-button>
                                <s-button variant="tertiary" tone="critical" onClick={sectionItem.remove}>Remove section</s-button>
                            </s-button-group>

                            {/* ── Nested blocks ─────────────────────────────────
                              * Path: `sections.${si}.blocks`
                              * si = 0 হলে: "sections.0.blocks"
                              * si = 1 হলে: "sections.1.blocks"
                              *
                              * bindItem-ও dynamic path নেয়:
                              * fs.list.bindItem(`sections.${si}.blocks`, bi)
                              * ──────────────────────────────────────────────── */}
                            {section.blocks.map((block, bi) => {
                                // bi = block index এই section-এর ভেতরে
                                // Path: "sections.0.blocks.0", "sections.0.blocks.1"...
                                const blockItem = fs.list.bindItem(`sections.${si}.blocks`, bi);
                                return (
                                    <div key={block.id} style={{ marginLeft: "16px", marginTop: "8px" }}>
                                        <s-text-area
                                            label={`Block ${bi + 1} content`}
                                            value={blockItem.value.content ?? ""}
                                            onChange={(e) => blockItem.setField("content", e.target.value)}
                                        />
                                        {/* block remove — এই section-এর blocks array থেকে */}
                                        <s-button
                                            variant="tertiary"
                                            tone="critical"
                                            onClick={blockItem.remove}
                                        >
                                            Remove block
                                        </s-button>
                                    </div>
                                );
                            })}

                            {/* ── fs.list.append nested — এই section-এ block add ──
                              * Path dynamically build: `sections.${si}.blocks`
                              * ──────────────────────────────────────────────── */}
                            <s-button
                                variant="tertiary"
                                onClick={() => fs.list.append(
                                    `sections.${si}.blocks`,
                                    { id: Date.now(), type: "text", content: "" }
                                    // এই নির্দিষ্ট section-এর blocks-এ append
                                )}
                            >
                                + Add block
                            </s-button>

                        </div>
                    );
                })}

                {/* নতুন section append — empty blocks array সহ */}
                <s-button
                    variant="secondary"
                    onClick={() => fs.list.append("sections", {
                        id: Date.now(),
                        heading: "New Section",
                        sortOrder: fs.values.sections.length,
                        blocks: [],   // empty blocks array — পরে add করা যাবে
                    })}
                >
                    Add section
                </s-button>

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * FAQ — reorder + normalizeOrder pattern
              *
              * fs.list.reorder(path, from, to) — item সরায় (move-এর alias)
              * fs.list.normalizeOrder(path, field) — sortOrder re-stamp করে
              *
              * Drag-drop pattern:
              *   1. reorder() — visual order change করো
              *   2. normalizeOrder() — sortOrder: 0,1,2... re-assign করো
              *   3. Submit-এ server sortOrder দেখে DB-তে order save করে
              *
              * fs.list.prepend — শুরুতে add (append-এর বিপরীত)
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="FAQ">

                {fs.values.faqItems.map((faq, i) => {
                    const item = fs.list.bindItem("faqItems", i);
                    return (
                        <div key={faq.id} style={{ border: "1px solid #e0e0e0", padding: "12px", marginBottom: "8px" }}>

                            <s-text-field
                                label="Question"
                                value={item.value.question}
                                onChange={(e) => item.setField("question", e.target.value)}
                            />

                            {/* faqItems.i.answer — validate function-এ validate হচ্ছে */}
                            <s-text-area
                                label="Answer"
                                value={item.value.answer}
                                onChange={(e) => item.setField("answer", e.target.value)}
                                error={fs.field.error(`faqItems.${i}.answer`) ?? undefined}
                            />

                            <s-button-group>
                                {/* ── reorder + normalizeOrder — drag-drop pattern ──
                                  * reorder() — i থেকে i-1 position-এ move করো
                                  * normalizeOrder() — sortOrder: 0,1,2... re-stamp
                                  * DB-তে sortOrder দিয়ে order save হবে
                                  * ──────────────────────────────────────────────── */}
                                <s-button
                                    variant="tertiary"
                                    onClick={() => {
                                        fs.list.reorder("faqItems", i, i - 1);
                                        // faqItems[i] → faqItems[i-1] position
                                        fs.list.normalizeOrder("faqItems", "sortOrder");
                                        // sortOrder: 0,1,2... re-assign
                                    }}
                                    disabled={item.isFirst}
                                >
                                    ↑ Move up
                                </s-button>
                                <s-button
                                    variant="tertiary"
                                    onClick={() => {
                                        fs.list.reorder("faqItems", i, i + 1);
                                        fs.list.normalizeOrder("faqItems", "sortOrder");
                                    }}
                                    disabled={item.isLast}
                                >
                                    Move down ↓
                                </s-button>
                                <s-button variant="tertiary" tone="critical" onClick={item.remove}>
                                    Remove
                                </s-button>
                            </s-button-group>

                        </div>
                    );
                })}

                {/* ── fs.list.prepend — শুরুতে add ───────────────────────────
                  * append() — শেষে add।
                  * prepend() — শুরুতে add — faqItems[0] হয়ে যাবে।
                  * normalizeOrder() call করো sortOrder fix করতে।
                  * ──────────────────────────────────────────────────────── */}
                <s-button
                    variant="secondary"
                    onClick={() => {
                        fs.list.prepend("faqItems", {
                            id: Date.now(),
                            question: "",
                            answer: "",
                            sortOrder: 0,
                        });
                        fs.list.normalizeOrder("faqItems", "sortOrder");
                        // নতুন item sortOrder=0, বাকি গুলো 1,2,3...
                    }}
                >
                    Add FAQ at top
                </s-button>

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Media — fs.media দিয়ে file upload + single URL null করা
              *
              * fs.media তিনটা কাজ করে:
              *   A) Single file upload — avatar, cover (একটাই থাকবে)
              *   B) Multiple file upload — gallery (একাধিক)
              *   C) Existing single URL string field null করা
              *
              * কেন values-এ File রাখা যায় না?
              *   File object serialize হয় না — JSON.stringify করলে হারিয়ে যায়।
              *   তাই pendingFiles-এ আলাদা রাখা হয়।
              *   onSubmit-এ pendingFiles থেকে FormData-তে append করো।
              *
              * ⚠️  Image array manage করতে fs.list use করো — fs.media না।
              *     fs.media শুধু single URL string field-এর জন্য।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Media">

                {/* ── A) Single file upload — avatar ───────────────────────────
                  *
                  * s-drop-zone properties (doc থেকে):
                  *   label              — field label (required)
                  *   accept             — comma-separated MIME types বা file extensions
                  *                        "image/jpeg,image/png" বা ".jpg,.png"
                  *   multiple           — false = single file, true = multiple files
                  *   accessibilityLabel — screen reader-এর জন্য descriptive label
                  *   error              — validation error message
                  *
                  * s-drop-zone events:
                  *   onChange     — file select বা drop হলে fire হয়
                  *                  e.currentTarget.files = FileList (array-like)
                  *                  Array.from() দিয়ে File[] convert করো
                  *   onDropRejected — accept-এ নেই এমন file drop করলে fire হয়
                  *
                  * fs.media.setterFor("avatar") — pendingFiles["avatar"] = files set করে
                  * fs.media.hasFile("avatar")   — staged file আছে কিনা
                  * fs.media.getFiles("avatar")  — File[] পাও
                  * fs.media.clearFiles("avatar")— staged files discard
                  * ──────────────────────────────────────────────────────── */}
                <s-drop-zone
                    label="Avatar"
                    accept="image/jpeg,image/png,image/webp"
                    multiple={false}
                    // multiple={false} — একটার বেশি select বা drop করতে দেবে না
                    accessibilityLabel="Upload avatar image — JPG, PNG, or WebP only"
                    error={fs.field.error("avatar") ?? undefined}
                    onChange={(e) => {
                        // e.currentTarget.files = FileList — Array-like object
                        // Array.from() দিয়ে File[] convert করো
                        const files = Array.from(e.currentTarget.files ?? []);
                        if (files.length > 0) {
                            // setterFor("avatar") return করে একটা function
                            // সেই function-এ File[] দিলে pendingFiles["avatar"] = files হয়
                            fs.media.setterFor("avatar")(files);
                        }
                    }}
                    onDropRejected={() => {
                        // accept-এ নেই এমন file drag করলে এটা fire হয়
                        // manually error set করো
                        fs.field.setError("avatar", "Only JPG, PNG, WebP allowed");
                    }}
                />

                {/* ── Single file preview ────────────────────────────────────
                  * File select হলে local preview দেখাও।
                  * URL.createObjectURL(file) — browser-এ local temp URL বানায়।
                  *
                  * ⚠️  Real app-এ useMemo বা useEffect-এ URL বানাও।
                  *     প্রতি render-এ নতুন object URL create হলে memory leak হতে পারে।
                  * ──────────────────────────────────────────────────────── */}
                {fs.media.hasFile("avatar") && (() => {
                    // fs.media.getFiles("avatar")[0] — প্রথম (একমাত্র) staged File
                    const file = fs.media.getFiles("avatar")[0];
                    return (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                            <img
                                src={URL.createObjectURL(file)}
                                alt={file.name}
                                width={60}
                                height={60}
                                style={{ objectFit: "cover", borderRadius: "4px" }}
                            />
                            <div>
                                <p>{file.name}</p>
                                <p>{(file.size / 1024).toFixed(1)} KB</p>
                            </div>
                            {/* fs.media.clearFiles — staged file বাদ দাও */}
                            <s-button
                                variant="tertiary"
                                tone="critical"
                                onClick={() => fs.media.clearFiles("avatar")}
                                // pendingFiles["avatar"] = []
                            >
                                Remove
                            </s-button>
                        </div>
                    );
                })()}


                {/* ── C) Existing avatarUrl null করা ───────────────────────────
                  *
                  * avatarUrl = "https://cdn.example.com/avatar.jpg" — server-এ আছে।
                  * User remove করতে চাইলে শুধু fs.set("avatarUrl", "") করলে হবে না।
                  *
                  * কেন fs.media.removeExisting() দরকার?
                  *   fs.set("avatarUrl", "") — form-এ URL clear হয়।
                  *   কিন্তু server জানে না: user ইচ্ছাকৃত remove করেছে
                  *   নাকি form submit-এ field empty ছিল।
                  *   removeExisting() দুটো কাজ করে:
                  *     1. form-এ avatarUrl = "" (preview hide হয়)
                  *     2. removedKeys["avatarUrl"] = true (server flag)
                  *   onSubmit-এ server removedKeys দেখে DB-তে null করে।
                  *
                  * fs.media.hasRemoved("avatarUrl") — remove করা হয়েছে কিনা
                  * fs.media.undoRemove("avatarUrl") — snapshot থেকে restore, flag clear
                  * ──────────────────────────────────────────────────────── */}
                {/* avatarUrl আছে এবং remove করা হয়নি — preview দেখাও */}
                {fs.values.avatarUrl && !fs.media.hasRemoved("avatarUrl") && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                        {/* server থেকে আসা existing image preview */}
                        <img
                            src={fs.values.avatarUrl}
                            alt="Current avatar"
                            width={60}
                            height={60}
                            style={{ objectFit: "cover", borderRadius: "4px" }}
                        />
                        <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() => fs.media.removeExisting("avatarUrl")}
                            // avatarUrl = "", removedKeys["avatarUrl"] = true
                        >
                            Remove current avatar
                        </s-button>
                    </div>
                )}

                {/* Remove করা হলে undo option দেখাও */}
                {fs.media.hasRemoved("avatarUrl") && (
                    // tone="warning" — সতর্কতা: save করলে DB-তে null হবে
                    <s-banner tone="warning" heading="Avatar will be removed on save">
                        <s-button
                            slot="secondary-actions"
                            variant="secondary"
                            onClick={() => fs.media.undoRemove("avatarUrl")}
                            // avatarUrl snapshot থেকে restore হবে, removedKeys flag clear হবে
                        >
                            Undo
                        </s-button>
                    </s-banner>
                )}


                {/* ── B) Multiple file upload — gallery ────────────────────────
                  *
                  * multiple={true} — একাধিক file একসাথে select বা drop করা যাবে।
                  *
                  * নতুন files existing staged files-এর সাথে merge করো:
                  *   const existing = fs.media.getFiles("gallery");
                  *   fs.media.setterFor("gallery")([...existing, ...newFiles]);
                  *
                  * Replace করলে: fs.media.setterFor("gallery")(newFiles) — আগেরগুলো হারাবে।
                  * Merge করলে: [...existing, ...newFiles] — সব রাখো।
                  * ──────────────────────────────────────────────────────── */}
                <s-drop-zone
                    label="Gallery Images"
                    accept="image/jpeg,image/png,image/webp"
                    multiple={true}
                    // multiple={true} — একাধিক file select বা drop করা যাবে
                    accessibilityLabel="Upload gallery images — drag and drop multiple files or click to browse"
                    onChange={(e) => {
                        const newFiles = Array.from(e.currentTarget.files ?? []);
                        if (newFiles.length > 0) {
                            // আগের staged files রাখো, নতুন files merge করো
                            const existing = fs.media.getFiles("gallery");
                            fs.media.setterFor("gallery")([...existing, ...newFiles]);
                            // pendingFiles["gallery"] = [...existing, ...newFiles]
                        }
                    }}
                />

                {/* Selected gallery files list — প্রতিটা আলাদাভাবে remove করা যাবে */}
                {fs.media.hasFile("gallery") && (
                    <div style={{ marginTop: "8px" }}>
                        {/* কতটা file staged আছে */}
                        <p>{fs.media.getFiles("gallery").length} image(s) selected</p>

                        {fs.media.getFiles("gallery").map((file, i) => (
                            <div key={`${file.name}-${i}`} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
                                {/* Local preview */}
                                <img
                                    src={URL.createObjectURL(file)}
                                    alt={file.name}
                                    width={40}
                                    height={40}
                                    style={{ objectFit: "cover", borderRadius: "4px" }}
                                />
                                <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>

                                {/* এই specific file বাদ দাও — বাকি গুলো রাখো */}
                                <s-button
                                    variant="tertiary"
                                    tone="critical"
                                    onClick={() => {
                                        const currentFiles = fs.media.getFiles("gallery");
                                        // i-তম file বাদ দিয়ে বাকি সব রাখো
                                        fs.media.setterFor("gallery")(
                                            currentFiles.filter((_, idx) => idx !== i)
                                        );
                                    }}
                                >
                                    ✕
                                </s-button>
                            </div>
                        ))}

                        {/* সব staged gallery files একসাথে clear */}
                        <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() => fs.media.clearFiles("gallery")}
                            // pendingFiles["gallery"] = []
                        >
                            Clear all selected images
                        </s-button>
                    </div>
                )}


                {/* ══════════════════════════════════════════════════════════
                  * Product Images — existing images array manage
                  *
                  * এটা fs.media ব্যবহার করে না।
                  * Existing images একটা array — { id, url, altText, sortOrder }
                  * fs.list দিয়ে manage করা হয়:
                  *   remove  → fs.list.remove() বা item.remove()
                  *   reorder → item.moveUp() / item.moveDown()
                  *   update  → item.setField("altText", value)
                  *
                  * নতুন image upload → আলাদা s-drop-zone, pendingFiles["newImages"]
                  *
                  * onSubmit-এ:
                  *   values.images — remaining existing images (server update করবে)
                  *   pendingFiles["newImages"] — নতুন files upload করতে হবে
                  * ════════════════════════════════════════════════════════ */}

                {/* ── Existing images list ─────────────────────────────────── */}
                {fs.values.images.length > 0 && (
                    <div style={{ marginTop: "16px" }}>
                        <p style={{ fontWeight: "bold", marginBottom: "8px" }}>
                            Product Images ({fs.values.images.length})
                            {/* images array dirty হলে indicator */}
                            {fs.field.isDirty("images") && (
                                <s-badge tone="warning" style={{ marginLeft: "8px" }}>Changed</s-badge>
                            )}
                        </p>

                        {fs.values.images.map((image, i) => {
                            // bindItem — এই image row-এর সব helper
                            const item = fs.list.bindItem("images", i);
                            return (
                                <div
                                    key={image.id}
                                    style={{
                                        display: "flex",
                                        gap: "12px",
                                        alignItems: "center",
                                        padding: "8px",
                                        border: "1px solid #e0e0e0",
                                        borderRadius: "4px",
                                        marginBottom: "8px",
                                        // dirty row — light highlight
                                        background: item.isDirty ? "#fffbeb" : "transparent",
                                    }}
                                >
                                    {/* Existing image preview — server URL */}
                                    <img
                                        src={item.value.url}
                                        alt={item.value.altText || "Product image"}
                                        width={64}
                                        height={64}
                                        style={{ objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                                    />

                                    {/* ── altText update — item.setField ────────────
                                      * fs.list.setField("images", i, "altText", v) shortcut।
                                      * SEO ও accessibility-র জন্য important।
                                      * ──────────────────────────────────────────── */}
                                    <s-text-field
                                        label="Alt text"
                                        value={item.value.altText}
                                        onChange={(e) => item.setField("altText", e.currentTarget.value)}
                                        // SEO ও accessibility-র জন্য descriptive text দাও
                                    />

                                    {/* Dirty indicator — এই row change হয়েছে */}
                                    {item.isDirty && (
                                        <s-badge tone="warning">Modified</s-badge>
                                    )}

                                    {/* Position info */}
                                    <span style={{ color: "#666", fontSize: "12px", whiteSpace: "nowrap" }}>
                                        {item.index + 1} / {fs.values.images.length}
                                    </span>

                                    {/* ── Reorder buttons ────────────────────────────
                                      * moveUp / moveDown — item.isFirst/isLast দিয়ে disable।
                                      * Reorder-এর পর normalizeOrder call করো sortOrder fix করতে।
                                      * ──────────────────────────────────────────── */}
                                    <s-button-group>
                                        <s-button
                                            variant="tertiary"
                                            onClick={() => {
                                                item.moveUp();
                                                fs.list.normalizeOrder("images", "sortOrder");
                                                // images[i] ↑ + sortOrder: 0,1,2... re-stamp
                                            }}
                                            disabled={item.isFirst}
                                            icon="arrow-up"
                                        />
                                        <s-button
                                            variant="tertiary"
                                            onClick={() => {
                                                item.moveDown();
                                                fs.list.normalizeOrder("images", "sortOrder");
                                            }}
                                            disabled={item.isLast}
                                            icon="arrow-down"
                                        />

                                        {/* ── item.remove — array থেকে বাদ দাও ────────
                                          * Submit-এ values.images-এ এটা থাকবে না।
                                          * Server বুঝবে এই image delete করতে হবে।
                                          * ──────────────────────────────────────────── */}
                                        <s-button
                                            variant="tertiary"
                                            tone="critical"
                                            onClick={item.remove}
                                            icon="delete"
                                            // ⚠️  fs.media.removeExisting() না —
                                            //     সেটা single URL field-এর জন্য।
                                            //     Array item remove করতে সবসময় item.remove()।
                                        />
                                    </s-button-group>
                                </div>
                            );
                        })}

                        {/* ── Bulk actions ──────────────────────────────────────
                          * sort — sortOrder field দিয়ে ascending sort
                          * clear — সব existing images বাদ দাও (submit-এ server delete করবে)
                          * ──────────────────────────────────────────────────── */}
                        <s-button-group>
                            <s-button
                                variant="secondary"
                                onClick={() => {
                                    fs.list.sort("images", "sortOrder", "asc");
                                    // sortOrder ascending sort — original order
                                }}
                            >
                                Reset order
                            </s-button>
                            <s-button
                                variant="tertiary"
                                tone="critical"
                                onClick={() => fs.list.clear("images")}
                                // images = [] — submit-এ server সব delete করবে
                            >
                                Remove all images
                            </s-button>
                        </s-button-group>
                    </div>
                )}

                {/* ── New images upload — pendingFiles["newImages"] ───────────
                  *
                  * Existing images manage করা হয় fs.list দিয়ে (উপরে)।
                  * নতুন images upload করতে s-drop-zone use করো।
                  *
                  * onSubmit-এ:
                  *   values.images    — remaining existing images (server DB update)
                  *   pendingFiles["newImages"] — নতুন File[] (S3/Cloudflare-এ upload)
                  *
                  * Server flow:
                  *   1. values.images দেখে কোন existing images রাখতে হবে
                  *   2. removedImages = originalImages - values.images (delete করো)
                  *   3. pendingFiles["newImages"] upload করো, URL পাও, DB-তে save করো
                  * ──────────────────────────────────────────────────────── */}
                <s-drop-zone
                    label="Add New Images"
                    accept="image/jpeg,image/png,image/webp"
                    multiple={true}
                    // multiple={true} — একাধিক new image একসাথে select করা যাবে
                    accessibilityLabel="Upload new product images — drag and drop or click to browse"
                    onChange={(e) => {
                        const newFiles = Array.from(e.currentTarget.files ?? []);
                        if (newFiles.length > 0) {
                            // আগের new images staged files রাখো, নতুন গুলো merge করো
                            const existing = fs.media.getFiles("newImages");
                            fs.media.setterFor("newImages")([...existing, ...newFiles]);
                            // pendingFiles["newImages"] = [...existing, ...newFiles]
                        }
                    }}
                    onDropRejected={() => {
                        fs.field.setError("newImages", "Only JPG, PNG, WebP allowed");
                    }}
                    error={fs.field.error("newImages") ?? undefined}
                />

                {/* Staged new images preview */}
                {fs.media.hasFile("newImages") && (
                    <div style={{ marginTop: "8px" }}>
                        <p style={{ fontWeight: "bold" }}>
                            New images to upload ({fs.media.getFiles("newImages").length})
                        </p>

                        {fs.media.getFiles("newImages").map((file, i) => (
                            <div
                                key={`${file.name}-${i}`}
                                style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}
                            >
                                {/* Local preview — URL.createObjectURL দিয়ে */}
                                <img
                                    src={URL.createObjectURL(file)}
                                    alt={file.name}
                                    width={48}
                                    height={48}
                                    style={{ objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                                />
                                <div style={{ flex: 1 }}>
                                    <p style={{ margin: 0 }}>{file.name}</p>
                                    <p style={{ margin: 0, color: "#666", fontSize: "12px" }}>
                                        {(file.size / 1024).toFixed(1)} KB
                                    </p>
                                </div>
                                {/* এই specific staged file বাদ দাও */}
                                <s-button
                                    variant="tertiary"
                                    tone="critical"
                                    onClick={() => {
                                        const currentFiles = fs.media.getFiles("newImages");
                                        fs.media.setterFor("newImages")(
                                            currentFiles.filter((_, idx) => idx !== i)
                                        );
                                    }}
                                >
                                    ✕
                                </s-button>
                            </div>
                        ))}

                        {/* সব new staged images clear */}
                        <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() => fs.media.clearFiles("newImages")}
                        >
                            Clear all new images
                        </s-button>
                    </div>
                )}

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Debug — Snapshot, History, Validate, State inspection
              *
              * এই section-এ যা যা দেখানো হচ্ছে:
              *   fs.snapshot.get()    — একটা field-এর saved value
              *   fs.snapshot.getAll() — পুরো snapshot
              *   fs.snapshot.isDirty  — isDirty-র alias
              *   fs.history.undo/redo — undo/redo (historyLimit: 50)
              *   fs.history.canUndo   — undo করা যাবে কিনা
              *   fs.history.canRedo   — redo করা যাবে কিনা
              *   fs.history.steps     — কতটা undo step available
              *   fs.history.clear     — history wipe
              *   fs.validate.now()    — manually পুরো form validate
              *   fs.hasValidated      — কোনোদিন validation run হয়েছে কিনা
              *   fs.isValid           — valid কিনা (hasValidated + no errors)
              *   fs.dirtyFields       — সব changed field-এর map
              *   fs.touchedFields     — সব touched field-এর map
              *   fs.submitCount       — কতবার submit attempt হয়েছে
              * ══════════════════════════════════════════════════════════════ */}
            <s-section heading="Debug — Snapshot & History">

                {/* ── fs.snapshot.get — একটা field-এর saved value ───────────
                  * "Revert this field only" UI বানাতে কাজে লাগে।
                  * title dirty হলেই revert option দেখাও।
                  * ──────────────────────────────────────────────────────── */}
                <s-button
                    variant="tertiary"
                    onClick={() => fs.set("title", fs.snapshot.get("title"))}
                    disabled={!fs.field.isDirty("title")}
                    // snapshot-এর "Handmade Leather Bag"-এ ফিরে যাবে
                >
                    Revert title to "{fs.snapshot.get("title")}"
                </s-button>

                {/* ── fs.snapshot.getAll — পুরো snapshot object ─────────────
                  * Debug-এ console-এ দেখো।
                  * ──────────────────────────────────────────────────────── */}
                <s-button
                    variant="tertiary"
                    onClick={() => console.log("Snapshot:", fs.snapshot.getAll())}
                >
                    Log snapshot
                </s-button>

                {/* ── fs.snapshot.isDirty — isDirty-র alias ─────────────────
                  * fs.isDirty এবং fs.snapshot.isDirty একই জিনিস।
                  * ──────────────────────────────────────────────────────── */}
                <p>Has unsaved changes: {String(fs.snapshot.isDirty)}</p>

                {/* ── fs.history — undo/redo ──────────────────────────────────
                  * historyLimit: 50 দেওয়া আছে তাই active।
                  * historyLimit: 0 (default) হলে canUndo/canRedo সবসময় false।
                  *
                  * canUndo = history stack-এ কিছু আছে কিনা
                  * canRedo = future stack-এ কিছু আছে কিনা (undo-র পরে)
                  * steps   = কতটা undo step available
                  * ──────────────────────────────────────────────────────── */}
                <s-button-group>
                    <s-button
                        variant="secondary"
                        onClick={fs.history.undo}
                        disabled={!fs.history.canUndo}
                        icon="undo"
                        // canUndo = false হলে disabled — history empty
                    >
                        Undo ({fs.history.steps} steps)
                    </s-button>
                    <s-button
                        variant="secondary"
                        onClick={fs.history.redo}
                        disabled={!fs.history.canRedo}
                        icon="redo"
                        // canRedo = false হলে disabled — future stack empty
                    >
                        Redo
                    </s-button>
                    {/* ── fs.history.clear — history ও future stack দুটোই clear */}
                    <s-button
                        variant="tertiary"
                        onClick={fs.history.clear}
                    >
                        Clear history
                    </s-button>
                </s-button-group>

                {/* ── fs.validate.now — manually পুরো form validate ─────────
                  * submit() না করে validation result দেখতে চাইলে।
                  * true = valid, false = error আছে।
                  * ──────────────────────────────────────────────────────── */}
                <s-button
                    variant="secondary"
                    onClick={() => {
                        const isValid = fs.validate.now();
                        console.log("Form valid:", isValid);
                        console.log("Errors:", fs.fieldErrors);
                    }}
                >
                    Validate now
                </s-button>

                {/* ── fs.hasValidated — কোনোদিন validation run হয়েছে কিনা ──
                  * false = এখনো submit বা validate.now() call হয়নি।
                  * true  = অন্তত একবার validation run হয়েছে।
                  *
                  * fs.isValid — hasValidated=true এবং কোনো error নেই।
                  * hasValidated=false হলে isValid সবসময় false।
                  * ──────────────────────────────────────────────────────── */}
                {fs.hasValidated && (
                    <s-badge tone={fs.isValid ? "success" : "critical"}>
                        {fs.isValid ? "Form valid ✓" : "Has errors ✗"}
                    </s-badge>
                )}

                {/* ── fs.dirtyFields — সব changed leaf field-এর map ─────────
                  * { "title": true, "address.city": true, "variants.0.price": true }
                  * ──────────────────────────────────────────────────────── */}
                {Object.keys(fs.dirtyFields).length > 0 && (
                    <p>Changed fields: {Object.keys(fs.dirtyFields).join(", ")}</p>
                )}

                {/* ── fs.touchedFields — user interact করা fields ───────────
                  * { "title": true, "email": true }
                  * onBlur call হলে touch হয়।
                  * ──────────────────────────────────────────────────────── */}
                {Object.keys(fs.touchedFields).length > 0 && (
                    <p>Touched fields: {Object.keys(fs.touchedFields).join(", ")}</p>
                )}

                {/* ── fs.submitCount — কতবার submit attempt হয়েছে ───────────
                  * 0 = এখনো কোনো submit হয়নি।
                  * >0 = অন্তত একবার submit চেষ্টা হয়েছে।
                  * Error visibility control-এ কাজে লাগে।
                  * ──────────────────────────────────────────────────────── */}
                {fs.submitCount > 0 && (
                    <p>Submit attempted {fs.submitCount} time(s)</p>
                )}

            </s-section>


            {/* ══════════════════════════════════════════════════════════════
              * Bottom action bar — Save / Discard / Sync
              *
              * Page header-এ already Save/Discard আছে (slot="primary-action")।
              * Long form-এ bottom-এও রাখা ভালো — scroll করতে হয় না।
              * ══════════════════════════════════════════════════════════════ */}
            <s-section>
                <s-button-group>

                    {/* ── fs.submit — validate → onSubmit ─────────────────────
                      * কাজের ধাপ:
                      *   1. submitCount + 1
                      *   2. Validation run (schema + validate)
                      *   3. Error থাকলে: সব field touched, error দেখায়, false return
                      *   4. Valid হলে: onSubmit callback call হয়
                      *   5. isSubmitting = true, await শেষে false
                      *
                      * loading={true} হলে button disabled হয় + spinner দেখায়।
                      * isDirty=false হলে কিছু change হয়নি — save করার দরকার নেই।
                      * ──────────────────────────────────────────────────────── */}
                    <s-button
                        variant="primary"
                        loading={fs.isSubmitting}
                        disabled={!fs.isDirty || fs.isSubmitting}
                        onClick={fs.submit}
                    >
                        {fs.isSubmitting ? "Saving…" : "Save changes"}
                    </s-button>

                    {/* ── fs.reset — সব change discard, snapshot-এ revert ──────
                      * values       → savedSnapshot
                      * pendingFiles → {}
                      * removedKeys  → {}
                      * fieldErrors  → {}
                      * touchedFields→ {}
                      * submitCount  → 0
                      * hasValidated → false
                      * history/future stack → clear
                      * ──────────────────────────────────────────────────────── */}
                    <s-button
                        variant="secondary"
                        disabled={!fs.isDirty}
                        onClick={fs.reset}
                        // isDirty = false হলে কিছু change হয়নি — discard করার দরকার নেই
                    >
                        Discard changes
                    </s-button>

                    {/* ── fs.syncAfterSave — successful save-এর পর snapshot update
                      *
                      * Real usage (useEffect-এ):
                      *   useEffect(() => {
                      *     if (fetcher.state === "idle" && fetcher.data?.product) {
                      *       fs.syncAfterSave(fetcher.data.product);
                      *       // snapshot = fresh server data
                      *       // isDirty = false হবে
                      *     }
                      *   }, [fetcher.state, fetcher.data]);
                      *
                      * Demo-তে loaderData দিয়ে simulate করা হচ্ছে।
                      * ──────────────────────────────────────────────────────── */}
                    <s-button
                        variant="tertiary"
                        onClick={() => fs.syncAfterSave(loaderData)}
                        // Real app-এ এখানে fetcher.data.product দাও
                    >
                        Simulate sync (demo)
                    </s-button>

                </s-button-group>
            </s-section>

        </s-page>
    );
}
