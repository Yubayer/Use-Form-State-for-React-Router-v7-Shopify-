/**
 * @fileoverview useFormState — সব feature-এর complete example with dummy data।
 *
 * এই file পড়লেই বোঝা যাবে:
 *  — hook কীভাবে setup করতে হয়
 *  — কোন option কী কাজ করে
 *  — প্রতিটা method কীভাবে use করতে হয়
 *
 * ─── এই file-এ যা যা আছে ────────────────────────────────────────────────────
 *  1.  loaderData      — server থেকে আসা dummy data
 *  2.  buildShape      — server data → clean form shape
 *  3.  schema          — Zod validation schema
 *  4.  useFormState    — hook setup with all options
 *  5.  fs.values       — live form values read
 *  6.  fs.set          — যেকোনো depth-এ value set
 *  7.  fs.get          — যেকোনো depth থেকে value read
 *  8.  fs.setMany      — batch update একটা render-এ
 *  9.  fs.merge        — partial object merge
 *  10. fs.field.*      — per-field bind, error, dirty, touch, toggle, compute, watch
 *  11. fs.list.*       — array append, remove, move, sort, bindItem (nested সহ)
 *  12. fs.object.*     — dynamic key add, update, delete
 *  13. fs.media.*      — নতুন file upload + single URL field null করা
 *  14. fs.snapshot.*   — saved baseline read, per-field revert
 *  15. fs.history.*    — undo/redo
 *  16. fs.validate.*   — manual validation trigger
 *  17. fs.dirtyFields  — সব changed field-এর map
 *  18. fs.fieldErrors  — সব error-এর raw map
 *  19. fs.touchedFields— সব touched field-এর raw map
 *  20. fs.submit / fs.reset / fs.syncAfterSave — lifecycle
 */

import { useFormState, str, bool, num, arr, obj } from "./useFormState";
import { z } from "zod";
import { useFetcher } from "react-router";

/* ════════════════════════════════════════════════════════════════════════════
 * ███ 1. DUMMY SERVER DATA
 *
 * Real app-এ এটা loader() থেকে আসে।
 * null, undefined, missing field সব থাকতে পারে — buildShape সেগুলো normalize করে।
 * ════════════════════════════════════════════════════════════════════════════ */

const loaderData = {
    id:          "prod_123",
    title:       "Handmade Leather Bag",
    description: "A beautiful handmade bag.",
    email:       "contact@store.com",
    phone:       "+8801712345678",
    price:       1200,
    stock:       50,
    isActive:    true,
    isFeatured:  false,

    // Single URL string field — null হতে পারে
    avatarUrl: "https://cdn.example.com/avatar.jpg",
    coverUrl:  null,  // ← null হলে str() দিয়ে "" হবে

    // Nested object
    address: {
        city:    "Dhaka",
        zip:     "1000",
        country: "BD",
    },
    seo: {
        title:       "Handmade Leather Bag — My Store",
        description: "Buy the best handmade leather bag.",
    },

    // Dynamic keys — কতটা key থাকবে আগে জানা নেই
    socialLinks: {
        facebook:  "https://facebook.com/mystore",
        instagram: "https://instagram.com/mystore",
    },

    // Arrays
    tags: [
        { id: "t1", name: "leather",  color: "brown" },
        { id: "t2", name: "handmade", color: "green" },
    ],

    // Nested array — section-এর ভেতরে blocks
    sections: [
        {
            id:        "s1",
            heading:   "Features",
            sortOrder: 0,
            blocks: [
                { id: "b1", type: "text",  content:  "Durable and stylish." },
                { id: "b2", type: "image", imageUrl: "https://cdn.example.com/img1.jpg" },
            ],
        },
        {
            id:        "s2",
            heading:   "Specifications",
            sortOrder: 1,
            blocks: [
                { id: "b3", type: "text", content: "Weight: 500g" },
            ],
        },
    ],

    variants: [
        { id: "v1", name: "Small",  price: 1000, stock: 20, sortOrder: 0 },
        { id: "v2", name: "Medium", price: 1200, stock: 50, sortOrder: 1 },
        { id: "v3", name: "Large",  price: 1500, stock: 10, sortOrder: 2 },
    ],

    faqItems: [
        { id: "f1", question: "Is it waterproof?", answer: "Yes!",             sortOrder: 0 },
        { id: "f2", question: "What colors?",       answer: "Brown and Black.", sortOrder: 1 },
    ],
};

/* ════════════════════════════════════════════════════════════════════════════
 * ███ 2. buildShape — server data → clean form shape
 *
 * এটা pure function — server data নিয়ে form-এর expected shape return করে।
 * Normalize helper গুলো (str, bool, num, arr, obj) এখানে use করো।
 *
 * কেন দরকার?
 *   Server থেকে null আসলে আর form-এ "" থাকলে deepEqual মিলবে না।
 *   তখন কোনো change না করলেও isDirty = true হয়ে যাবে।
 *   এই function সেটা prevent করে — সব value-কে stable shape দেয়।
 * ════════════════════════════════════════════════════════════════════════════ */

function buildShape(data) {
    return {
        // str(v) — null/undefined → ""
        // Text input এবং URL field-এর জন্য
        title:       str(data?.title),
        description: str(data?.description),
        email:       str(data?.email),
        phone:       str(data?.phone),
        avatarUrl:   str(data?.avatarUrl),  // null → ""
        coverUrl:    str(data?.coverUrl),   // null → ""

        // num(v) — null/undefined → "", number → string
        // Number input binding-এর জন্য (input সবসময় string নেয়)
        price: num(data?.price),  // 1200 → "1200"
        stock: num(data?.stock),  // 50 → "50"

        // bool(v) — null/undefined → false
        // Checkbox / toggle field-এর জন্য
        isActive:   bool(data?.isActive),
        isFeatured: bool(data?.isFeatured),

        // obj(v, fallback) — null/undefined বা non-object → fallback
        // Nested object-এর জন্য — server-এ না থাকলে fallback use হবে
        address: obj(data?.address, { city: "", zip: "", country: "" }),
        seo:     obj(data?.seo,     { title: "", description: "" }),

        // Dynamic keys — কতটা key আছে জানা নেই, {} দিয়ে safe করো
        socialLinks: obj(data?.socialLinks, {}),

        // arr(v, fallback) — null/undefined/empty → fallback (default [])
        // Array field-এর জন্য
        tags:     arr(data?.tags),
        sections: arr(data?.sections),
        variants: arr(data?.variants),
        faqItems: arr(data?.faqItems),
    };
}

/* ════════════════════════════════════════════════════════════════════════════
 * ███ 3. Zod Schema (optional)
 *
 * validate option-এর আগে run হয়।
 * Conflict হলে validate function জেতে।
 *
 * z.coerce.number() — string input ("1200") কে number-এ convert করে validate করে।
 * এটা দরকার কারণ number input-এ value সবসময় string হিসেবে আসে।
 * ════════════════════════════════════════════════════════════════════════════ */

const schema = z.object({
    // String field — min/max length
    title:       z.string().min(1, "Title required").max(100, "সর্বোচ্চ ১০০ character"),
    description: z.string().min(20, "কমপক্ষে ২০ character").max(1000, "সর্বোচ্চ ১০০০ character"),

    // Email format check
    email: z.string().email("Valid email দাও"),

    // Phone — optional, empty string allow করো
    phone: z.string().regex(/^\+?[0-9]{10,15}$/, "Valid phone number দাও").optional().or(z.literal("")),

    // Number — string input থেকে coerce করে validate
    price: z.coerce.number().positive("০ এর বেশি হতে হবে"),
    stock: z.coerce.number().min(0, "০ এর কম হবে না"),
});

/* ════════════════════════════════════════════════════════════════════════════
 * ███ 4. Component — সব feature একসাথে
 * ════════════════════════════════════════════════════════════════════════════ */

export function ProductForm() {
    const fetcher = useFetcher();

    /* ────────────────────────────────────────────────────────────────────────
     * useFormState setup — সব options সহ
     *
     * Parameter:
     *   1. loaderData   — server থেকে আসা raw data
     *   2. buildShape   — data → form shape করার pure function
     *   3. options      — validation, submit, history, debug ইত্যাদি
     * ──────────────────────────────────────────────────────────────────────── */

    const fs = useFormState(loaderData, buildShape, {

        /* ── schema ──────────────────────────────────────────────────────────
         * Zod (বা safeParse compatible) schema।
         * submit() বা validate.now() call হলে এটা আগে run হয়।
         * Shorthand: { schema } মানে { schema: schema }
         * ─────────────────────────────────────────────────────────────────── */
        schema,

        /* ── validate ────────────────────────────────────────────────────────
         * Manual validation function।
         * Schema-র পরে run হয় — conflict হলে এটা জেতে।
         * Schema-তে যা handle করা যায় না (cross-field check, async-এর পরে) সেটা এখানে।
         *
         * Receives: current form values
         * Returns:  { [dot.path]: "error message" } — empty object মানে valid
         * ─────────────────────────────────────────────────────────────────── */
        validate: (values) => {
            const errors = {};

            // Custom rule — schema-তে এটা express করা যায় না
            if (values.title === "Test Product") {
                errors.title = "এই নামে product আগে থেকেই আছে";
            }

            // Cross-field check — variant price, main price-এর দ্বিগুণ হতে পারবে না
            // Nested array-র error key: "variants.0.price", "variants.1.price"
            values.variants.forEach((v, i) => {
                if (Number(v.price) > Number(values.price) * 2) {
                    errors[`variants.${i}.price`] = "Main price-এর দ্বিগুণের বেশি হবে না";
                }
            });

            // FAQ answer minimum length check
            values.faqItems.forEach((f, i) => {
                if (f.answer && f.answer.length < 5) {
                    errors[`faqItems.${i}.answer`] = "কমপক্ষে ৫ character লিখতে হবে";
                }
            });

            return errors;
        },

        /* ── validateOnChange ────────────────────────────────────────────────
         * true  — প্রতিটা keystroke-এ validation run হবে (real-time feedback)
         * false — শুধু onBlur বা submit-এ validate হবে (default, better UX)
         *
         * Large form-এ true করলে performance hit হতে পারে।
         * ─────────────────────────────────────────────────────────────────── */
        validateOnChange: false,

        /* ── onSubmit ────────────────────────────────────────────────────────
         * Validation pass হলে submit() call করলে এটা run হয়।
         *
         * Receives:
         *   values       — current form values (clean, normalized)
         *   pendingFiles — { slotName: File[] } নতুন upload করা files
         *   removedKeys  — { urlFieldPath: true } DB-তে null করার flags
         *
         * Promise return করলে resolve/reject পর্যন্ত isSubmitting = true থাকে।
         * ─────────────────────────────────────────────────────────────────── */
        onSubmit: async (values, { pendingFiles, removedKeys }) => {
            const fd = new FormData();

            // সব form values JSON-এ পাঠাও
            fd.append("data", JSON.stringify(values));

            // Single URL field null করার flags
            // removedKeys: { "avatarUrl": true } মানে server-এ avatarUrl = null করো
            fd.append("removedMedia", JSON.stringify(removedKeys));

            // নতুন uploaded files — slot name দিয়ে আলাদা করো
            if (pendingFiles["avatar"]?.[0]) fd.append("avatar", pendingFiles["avatar"][0]);
            if (pendingFiles["cover"]?.[0])  fd.append("cover",  pendingFiles["cover"][0]);

            fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
        },

        /* ── syncOnServerDataChange ───────────────────────────────────────────
         * true  (default) — loaderData reference বদলালে form + snapshot auto re-init হয়।
         *                   Page reload বা navigation-এ fresh data আসলে automatically sync হয়।
         * false — নিজে syncAfterSave() manually call করতে চাইলে false করো।
         * ─────────────────────────────────────────────────────────────────── */
        syncOnServerDataChange: true,

        /* ── historyLimit ────────────────────────────────────────────────────
         * 0       (default) — undo/redo disabled, history রাখে না।
         * 1-100   — এতটা step পর্যন্ত undo/redo করা যাবে।
         *
         * বেশি দিলে memory বেশি লাগে। 20-50 practical range।
         * ─────────────────────────────────────────────────────────────────── */
        historyLimit: 50,

        /* ── debug ───────────────────────────────────────────────────────────
         * true  — সব state change console-এ log হবে। Development-এ কাজে লাগে।
         * false (default) — কোনো log নেই। Production-এ false রাখো।
         * ─────────────────────────────────────────────────────────────────── */
        debug: true,

        /* ── debugLabel ──────────────────────────────────────────────────────
         * Console log-এর prefix label।
         * একই page-এ একাধিক form থাকলে কোন form-এর log সেটা বোঝা যায়।
         * Example log: [ProductForm] set("title") → { ... }
         * ─────────────────────────────────────────────────────────────────── */
        debugLabel: "ProductForm",
    });

    /* ────────────────────────────────────────────────────────────────────────
     * Successful save-এর পর snapshot sync করো।
     *
     * কেন দরকার?
     *   save হওয়ার পর isDirty = false হওয়া উচিত।
     *   syncAfterSave() snapshot-কে fresh server data দিয়ে update করে।
     *   তারপর form === snapshot হয়, তাই isDirty = false।
     *
     * syncOnServerDataChange: true থাকলে loaderData বদলালে auto হয়,
     * তবে fetcher-এ directly call করলে আরো নির্ভরযোগ্য।
     * ──────────────────────────────────────────────────────────────────────── */
    // useEffect(() => {
    //     if (fetcher.state === "idle" && fetcher.data?.product) {
    //         fs.syncAfterSave(fetcher.data.product);
    //     }
    // }, [fetcher.state, fetcher.data]);

    /* ────────────────────────────────────────────────────────────────────────
     * fs.field.compute — title বদলালে seo.title auto-update করো।
     *
     * ⚠️  Component-এর top level-এ call করো — condition বা loop-এর ভেতরে না।
     *     Hook-এর নিয়ম অনুযায়ী useEffect top-level-এ থাকতে হয়।
     *
     * Parameters:
     *   1. "seo.title"     — কোন field-এ result বসবে
     *   2. computeFn       — current values নিয়ে computed value return করে
     *   3. ["title"]       — কোন field change হলে recompute হবে
     * ──────────────────────────────────────────────────────────────────────── */
    fs.field.compute(
        "seo.title",
        (values) => values.title ? `${values.title} — My Store` : "",
        ["title"]
    );

    /* ────────────────────────────────────────────────────────────────────────
     * fs.field.watch — isActive false হলে isFeatured reset করো।
     *
     * ⚠️  Component-এর top level-এ call করো।
     *
     * Use case:
     *   Product inactive হলে featured থাকার মানে নেই।
     *   isActive বদলালে এই callback run হয়।
     *
     * Parameters:
     *   1. "isActive"  — কোন field watch করবে
     *   2. callback    — (newValue, prevValue) receive করে
     * ──────────────────────────────────────────────────────────────────────── */
    fs.field.watch("isActive", (next) => {
        if (!next) fs.set("isFeatured", false);
    });

    /* ════════════════════════════════════════════════════════════════════════
     * JSX — প্রতিটা feature-এর usage
     * ════════════════════════════════════════════════════════════════════════ */

    return (
        <div>

            {/* ══════════════════════════════════════════════════════════════
              * fs.values — live form values read
              *
              * fs.values সবসময় latest form state reflect করে।
              * শুধু read করো — update করতে fs.set() use করো।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Scalar field — fs.values.title → "Handmade Leather Bag" */}
            <p>Current title: {fs.values.title}</p>

            {/* Nested field — fs.values.address.city → "Dhaka" */}
            <p>City: {fs.values.address.city}</p>

            {/* Array item field — fs.values.sections[0].heading → "Features" */}
            <p>First section: {fs.values.sections[0]?.heading}</p>

            {/* Boolean field — fs.values.isActive → true */}
            <p>Active: {String(fs.values.isActive)}</p>


            {/* ══════════════════════════════════════════════════════════════
              * fs.set — যেকোনো depth-এ value set
              *
              * Dot-path দিয়ে যেকোনো level-এ value update করো।
              * React state immutably update হয়, re-render trigger হয়।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Top-level scalar field */}
            <button onClick={() => fs.set("title", "New Title")}>
                Set title {/* fs.values.title → "New Title" */}
            </button>

            {/* Nested object field */}
            <button onClick={() => fs.set("address.city", "Chittagong")}>
                Set city {/* fs.values.address.city → "Chittagong" */}
            </button>

            {/* Deeply nested — section → block → content */}
            <button onClick={() => fs.set("sections.0.blocks.0.content", "Updated content")}>
                Set block content {/* fs.values.sections[0].blocks[0].content → "Updated content" */}
            </button>

            {/* Array item field — index দিয়ে */}
            <button onClick={() => fs.set("variants.1.price", 1300)}>
                Set medium variant price {/* fs.values.variants[1].price → 1300 */}
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.get — live form থেকে value read
              *
              * fs.values.x দিয়েও read করা যায়।
              * fs.get() কাজে লাগে যখন path dynamic বা computed।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Static path */}
            <button onClick={() => console.log(fs.get("title"))}>
                Log title {/* → "Handmade Leather Bag" */}
            </button>

            {/* Nested path */}
            <button onClick={() => console.log(fs.get("address.city"))}>
                Log city {/* → "Dhaka" */}
            </button>

            {/* Array item — index দিয়ে */}
            <button onClick={() => console.log(fs.get("variants.1.price"))}>
                Log variant 2 price {/* → "1200" */}
            </button>

            {/* Dynamic path — runtime-এ path তৈরি হয় */}
            <button onClick={() => {
                const fieldName = "title"; // runtime-এ decide হতে পারে
                console.log(fs.get(fieldName));
            }}>
                Log dynamic field
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.setMany — batch update, একটা render-এ
              *
              * আলাদা আলাদা fs.set() call করলে প্রতিটায় re-render হয়।
              * setMany একটা render-এ সব update করে — performance better।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Multiple related field একসাথে update */}
            <button onClick={() => fs.setMany([
                ["title",           "Premium Leather Bag"],
                ["seo.title",       "Premium Leather Bag — My Store"],
                ["seo.description", "Buy premium leather bags."],
            ])}>
                Update title + SEO {/* তিনটা field একটা render-এ update */}
            </button>

            {/* Product activate + price update একসাথে */}
            <button onClick={() => fs.setMany([
                ["isActive", true],
                ["price",    1500],
                ["stock",    100],
            ])}>
                Activate with new price
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.merge — partial object shallow-merge
              *
              * Object-এর কিছু field update করতে চাইলে merge use করো।
              * বাকি field গুলো unchanged থাকে।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Nested object-এর partial update */}
            <button onClick={() => fs.merge({ city: "Sylhet", zip: "3100" }, "address")}>
                Update address
                {/*
                  * address.city → "Sylhet", address.zip → "3100"
                  * address.country → "BD" (unchanged)
                  */}
            </button>

            {/* Root-এ merge — multiple top-level fields */}
            <button onClick={() => fs.merge({ isActive: true, isFeatured: true })}>
                Activate + Feature
                {/*
                  * isActive → true, isFeatured → true
                  * বাকি সব field unchanged
                  */}
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.bind — Polaris TextField-এর সব props একসাথে
              *
              * bind() return করে: { value, onChange, onBlur, error }
              * Spread করলে TextField-এ সব manually লিখতে হয় না।
              *
              * Equivalent:
              *   value={fs.values.title}
              *   onChange={v => fs.set("title", v)}
              *   onBlur={() => fs.field.touch("title")}
              *   error={fs.field.error("title")}
              * ══════════════════════════════════════════════════════════════ */}

            {/* Top-level field */}
            <TextField label="Title"       {...fs.field.bind("title")} />
            <TextField label="Description" {...fs.field.bind("description")} multiline={4} />
            <TextField label="Email"       {...fs.field.bind("email")} type="email" />
            <TextField label="Phone"       {...fs.field.bind("phone")} />

            {/* Nested object field */}
            <TextField label="SEO Title"   {...fs.field.bind("seo.title")} />
            <TextField label="City"        {...fs.field.bind("address.city")} />
            <TextField label="ZIP"         {...fs.field.bind("address.zip")} />


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.bindNumber — number input binding
              *
              * Number input-এ value সবসময় string হিসেবে আসে।
              * bindNumber() onChange-এ string → number convert করে।
              * ══════════════════════════════════════════════════════════════ */}

            {/* value="1200" (string), onChange-এ Number("1300") = 1300 store হয় */}
            <TextField label="Price" type="number" {...fs.field.bindNumber("price")} />
            <TextField label="Stock" type="number" {...fs.field.bindNumber("stock")} />


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.bindCheckbox — Polaris Checkbox binding
              *
              * bind() return করে: { checked, onChange, onBlur, error }
              * ══════════════════════════════════════════════════════════════ */}

            <Checkbox label="Active"   {...fs.field.bindCheckbox("isActive")} />
            <Checkbox label="Featured" {...fs.field.bindCheckbox("isFeatured")} />


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.toggle — boolean field flip করো
              *
              * fs.set("isActive", !fs.values.isActive) এর shortcut।
              * ══════════════════════════════════════════════════════════════ */}

            {/* true → false, false → true */}
            <button onClick={() => fs.field.toggle("isActive")}>
                Toggle active ({String(fs.values.isActive)})
            </button>

            {/* Nested boolean */}
            <button onClick={() => fs.field.toggle("seo.enabled")}>
                Toggle SEO {/* seo.enabled: false → true */}
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.increment / fs.field.decrement — numeric shortcut
              *
              * Default step = 1। Custom step দেওয়া যায়।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Default step = 1 */}
            <button onClick={() => fs.field.decrement("stock")}>-</button>
            <span>{fs.values.stock}</span>  {/* 50 → 49 */}
            <button onClick={() => fs.field.increment("stock")}>+</button>

            {/* Custom step = 100 */}
            <button onClick={() => fs.field.decrement("price", 100)}>-100</button>
            <span>{fs.values.price}</span>  {/* 1200 → 1100 */}
            <button onClick={() => fs.field.increment("price", 100)}>+100</button>

            {/* Nested field — variant-এর stock */}
            <button onClick={() => fs.field.decrement("variants.0.stock", 5)}>
                Variant 1 stock -5 {/* variants[0].stock: 20 → 15 */}
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.error — error message দেখাও
              *
              * শুধু দেখায় যদি:
              *   — field touch হয়েছে (onBlur call হয়েছে), অথবা
              *   — submit attempt হয়েছে (submitCount > 0)
              *
              * fs.field.bind() use করলে এটা automatically handle হয়।
              * Manually দরকার হলে এভাবে use করো:
              * ══════════════════════════════════════════════════════════════ */}

            {/* null হলে কিছু দেখাবে না */}
            <p style={{ color: "red" }}>{fs.field.error("title")}</p>
            <p style={{ color: "red" }}>{fs.field.error("email")}</p>
            <p style={{ color: "red" }}>{fs.field.error("variants.0.price")}</p>


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.touch / fs.field.untouch / fs.field.isTouched
              *
              * Touch = user এই field-এ interact করেছে।
              * onBlur-এ touch করো → তারপর error দেখানো শুরু হয়।
              *
              * fs.field.bind() use করলে onBlur automatically handle হয়।
              * Manually দরকার হলে:
              * ══════════════════════════════════════════════════════════════ */}

            <input
                value={fs.values.title}
                onChange={e => fs.set("title", e.target.value)}
                onBlur={() => fs.field.touch("title")}  {/* touch mark করো */}
            />
            {/* touch হলে "Edited" দেখাও */}
            {fs.field.isTouched("title") && <span>Edited</span>}

            {/* Untouch — touched mark সরাও */}
            <button onClick={() => fs.field.untouch("title")}>
                Untouch title
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.setError / fs.field.clearError / fs.field.clearAllErrors
              *
              * Server থেকে আসা error manually set করো।
              * যেমন: action থেকে validation error এলে inject করো।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Server error inject */}
            <button onClick={() => fs.field.setError("email", "এই email আগে থেকেই নেওয়া")}>
                Simulate server error {/* fs.field.error("email") → "এই email আগে থেকেই নেওয়া" */}
            </button>

            {/* একটা field-এর error clear */}
            <button onClick={() => fs.field.clearError("email")}>
                Clear email error
            </button>

            {/* সব error একসাথে clear */}
            <button onClick={() => fs.field.clearAllErrors()}>
                Clear all errors
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.field.isDirty — per-field dirty check
              *
              * এই specific field বা subtree snapshot থেকে আলাদা হয়েছে কিনা।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Scalar field */}
            {fs.field.isDirty("title") && <Badge>Title changed</Badge>}

            {/* Subtree check — address-এর যেকোনো child বদলালে true */}
            {fs.field.isDirty("address") && <Badge>Address changed</Badge>}

            {/* Array item field */}
            {fs.field.isDirty("variants.0.price") && <Badge>Variant 1 price changed</Badge>}


            {/* ══════════════════════════════════════════════════════════════
              * fs.dirtyFields — সব changed leaf field-এর map
              *
              * { "title": true, "address.city": true, "variants.0.price": true }
              * Section-level dirty count বা custom UI-তে কাজে লাগে।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Changed field-এর list দেখাও */}
            <p>Changed: {Object.keys(fs.dirtyFields).join(", ")}</p>

            {/* Section-এর কতটা field dirty */}
            <p>
                SEO dirty fields: {
                    Object.keys(fs.dirtyFields).filter(k => k.startsWith("seo.")).length
                }
            </p>


            {/* ══════════════════════════════════════════════════════════════
              * fs.fieldErrors — সব error-এর raw map
              *
              * { "title": "Required", "email": "Invalid email" }
              * fs.field.error() touch/submit check করে দেখায়।
              * fieldErrors সরাসরি দেখলে সব error পাবে — debug বা summary UI-তে।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Error summary — submit attempt-এর পরে দেখাও */}
            {fs.submitCount > 0 && Object.keys(fs.fieldErrors).length > 0 && (
                <div style={{ border: "1px solid red", padding: 8 }}>
                    <p>Please fix these errors:</p>
                    {Object.entries(fs.fieldErrors).map(([path, msg]) => (
                        <p key={path}>• {path}: {msg}</p>
                    ))}
                </div>
            )}


            {/* ══════════════════════════════════════════════════════════════
              * fs.touchedFields — সব touched field-এর raw map
              *
              * { "title": true, "email": true }
              * fs.field.isTouched() একটা field check করে।
              * touchedFields সরাসরি দেখলে সব touched field পাবে।
              * ══════════════════════════════════════════════════════════════ */}

            {/* কতটা field touch হয়েছে */}
            <p>Touched fields: {Object.keys(fs.touchedFields).length}</p>

            {/* Custom touched indicator */}
            {fs.touchedFields["email"] && <span>Email edited</span>}


            {/* ══════════════════════════════════════════════════════════════
              * fs.list — array operations যেকোনো depth-এ
              * ══════════════════════════════════════════════════════════════ */}

            {/* ── append — array-এর শেষে item add করো ─────────────────────── */}
            {/* Object item deep-clone হয়, template mutate হয় না */}
            <button onClick={() => fs.list.append("tags", { id: Date.now(), name: "", color: "blue" })}>
                Add tag {/* tags array-এর শেষে নতুন item যোগ হবে */}
            </button>

            {/* ── prepend — array-এর শুরুতে item add করো ──────────────────── */}
            <button onClick={() => fs.list.prepend("faqItems", { id: Date.now(), question: "", answer: "", sortOrder: 0 })}>
                Add FAQ at top {/* faqItems[0]-এ নতুন item আসবে */}
            </button>

            {/* ── insert — নির্দিষ্ট index-এ item insert করো ───────────────── */}
            <button onClick={() => fs.list.insert("sections", 1, { id: Date.now(), heading: "New Section", sortOrder: 1, blocks: [] })}>
                Insert section at index 1 {/* sections[1]-এ নতুন section, বাকি গুলো shift হবে */}
            </button>

            {/* ── bindItem — row-এর সব helper একসাথে ───────────────────────── */}
            {/*
              * bindItem() return করে:
              *   value    — এই item-এর current data
              *   index    — array-তে এর position
              *   isFirst  — প্রথম item কিনা
              *   isLast   — শেষ item কিনা
              *   isDirty  — এই item snapshot থেকে আলাদা হয়েছে কিনা
              *   setField — এই item-এর একটা field update করো
              *   replace  — পুরো item replace করো
              *   remove   — এই item বাদ দাও
              *   duplicate— clone করে পরে insert করো
              *   moveUp   — একটা position উপরে যাও
              *   moveDown — একটা position নিচে যাও
              */}
            {fs.values.tags.map((tag, i) => {
                const item = fs.list.bindItem("tags", i);
                return (
                    <div key={tag.id}>
                        {/* setField — এই item-এর একটা field update */}
                        <input
                            value={item.value.name}
                            onChange={e => item.setField("name", e.target.value)}
                            placeholder="Tag name"
                        />
                        <input
                            value={item.value.color}
                            onChange={e => item.setField("color", e.target.value)}
                            placeholder="Color"
                        />

                        {/* remove — এই item বাদ দাও */}
                        <button onClick={item.remove}>✕</button>

                        {/* duplicate — clone করে ঠিক পরে insert */}
                        <button onClick={item.duplicate}>Copy</button>

                        {/* moveUp/moveDown — isFirst/isLast দিয়ে disable করো */}
                        <button onClick={item.moveUp}   disabled={item.isFirst}>↑</button>
                        <button onClick={item.moveDown} disabled={item.isLast}>↓</button>

                        {/* isDirty — এই specific row change হয়েছে কিনা */}
                        {item.isDirty && <span>Changed</span>}
                    </div>
                );
            })}

            {/* ── Nested array — section-এর ভেতরে blocks ───────────────────── */}
            {/*
              * Path: "sections.0.blocks", "sections.1.blocks" — dynamic
              * si (section index) দিয়ে path build করো
              */}
            {fs.values.sections.map((section, si) => {
                const sectionItem = fs.list.bindItem("sections", si);
                return (
                    <div key={section.id}>
                        {/* Section heading update */}
                        <input
                            value={sectionItem.value.heading}
                            onChange={e => sectionItem.setField("heading", e.target.value)}
                            placeholder="Section heading"
                        />
                        <button onClick={sectionItem.remove}>Remove section</button>
                        <button onClick={sectionItem.moveUp}   disabled={sectionItem.isFirst}>↑</button>
                        <button onClick={sectionItem.moveDown} disabled={sectionItem.isLast}>↓</button>

                        {/* Nested blocks — path: "sections.{si}.blocks" */}
                        {section.blocks.map((block, bi) => {
                            // Path dynamically build হচ্ছে — যেকোনো depth-এ কাজ করে
                            const blockItem = fs.list.bindItem(`sections.${si}.blocks`, bi);
                            return (
                                <div key={block.id}>
                                    <input
                                        value={blockItem.value.content ?? ""}
                                        onChange={e => blockItem.setField("content", e.target.value)}
                                        placeholder="Block content"
                                    />
                                    <button onClick={blockItem.remove}>Remove block</button>
                                </div>
                            );
                        })}

                        {/* Nested array-তে append — path dynamic */}
                        <button onClick={() => fs.list.append(`sections.${si}.blocks`, { id: Date.now(), type: "text", content: "" })}>
                            Add block
                        </button>
                    </div>
                );
            })}

            {/* ── swap — দুটো item position exchange করো ────────────────────── */}
            <button onClick={() => fs.list.swap("variants", 0, 1)}>
                Swap variant 1 and 2 {/* variants[0] ↔ variants[1] */}
            </button>

            {/* ── move — item এক position থেকে অন্য position-এ নিয়ে যাও ─── */}
            <button onClick={() => fs.list.move("variants", 2, 0)}>
                Move variant 3 to top {/* variants[2] → variants[0], বাকি shift হবে */}
            </button>

            {/* ── sort — field দিয়ে sort করো ───────────────────────────────── */}
            <button onClick={() => fs.list.sort("variants", "price", "asc")}>
                Sort by price ↑ {/* Small(1000), Medium(1200), Large(1500) */}
            </button>
            <button onClick={() => fs.list.sort("variants", "price", "desc")}>
                Sort by price ↓ {/* Large(1500), Medium(1200), Small(1000) */}
            </button>
            <button onClick={() => fs.list.sort("variants", "name", "asc")}>
                Sort by name A→Z
            </button>

            {/* ── reorder + normalizeOrder — drag-drop-এর পরে ──────────────── */}
            {/*
              * reorder() — item সরায় (move-এর alias, drag-drop context-এ readable)
              * normalizeOrder() — sortOrder field 0,1,2... re-stamp করে
              *                    DB-তে order save করতে দরকার
              */}
            <button onClick={() => {
                fs.list.reorder("faqItems", 1, 0); // FAQ 2 → position 0
                fs.list.normalizeOrder("faqItems", "sortOrder"); // sortOrder: 0,1 re-stamp
            }}>
                Move FAQ 2 to top + fix order
            </button>

            {/* ── filter — condition match করা গুলো রাখো, বাকি বাদ ────────── */}
            <button onClick={() => fs.list.filter("tags", tag => tag.name !== "")}>
                Remove empty tags {/* name="" tags গুলো বাদ যাবে */}
            </button>
            <button onClick={() => fs.list.filter("variants", v => Number(v.stock) > 0)}>
                Remove out-of-stock variants
            </button>

            {/* ── updateWhere — condition match করা সব item-এ patch apply ──── */}
            <button onClick={() => fs.list.updateWhere(
                "variants",
                v => Number(v.stock) === 0,         // condition
                { name: "Out of Stock" }             // এই patch apply হবে
            )}>
                Mark out-of-stock variants
            </button>

            {/* ── find — condition দিয়ে item খোঁজো ─────────────────────────── */}
            <button onClick={() => {
                const medium = fs.list.find("variants", v => v.name === "Medium");
                console.log("Medium variant:", medium);
                // → { id: "v2", name: "Medium", price: 1200, stock: 50, sortOrder: 1 }
            }}>
                Find medium variant
            </button>

            {/* ── findIndex — condition দিয়ে index খোঁজো ───────────────────── */}
            <button onClick={() => {
                // id দিয়ে খুঁজে remove করো — index manually track করতে হয় না
                const idx = fs.list.findIndex("variants", v => v.id === "v2");
                console.log("Medium index:", idx); // → 1
                if (idx !== -1) fs.list.remove("variants", idx);
            }}>
                Remove medium variant by id
            </button>

            {/* ── replace — পুরো item replace করো ─────────────────────────── */}
            <button onClick={() => fs.list.replace("variants", 0, { id: "v1", name: "XS", price: 800, stock: 5, sortOrder: 0 })}>
                Replace first variant {/* variants[0] পুরোটা নতুন object দিয়ে replace */}
            </button>

            {/* ── duplicate — item clone করে ঠিক পরে insert ───────────────── */}
            <button onClick={() => fs.list.duplicate("sections", 0)}>
                Duplicate first section {/* sections[0]-এর deep clone → sections[1] */}
            </button>

            {/* ── set — পুরো array replace করো ─────────────────────────────── */}
            <button onClick={() => fs.list.set("tags", [{ id: "t_new", name: "new-tag", color: "red" }])}>
                Replace all tags {/* tags array-টাই নতুন array দিয়ে replace */}
            </button>

            {/* ── clear — array empty করো ───────────────────────────────────── */}
            <button onClick={() => fs.list.clear("tags")}>
                Clear all tags {/* tags → [] */}
            </button>
            <button onClick={() => fs.list.clear("sections.0.blocks")}>
                Clear first section blocks {/* sections[0].blocks → [] */}
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.object — dynamic key management
              *
              * Object-এ কতটা key থাকবে আগে জানা নেই — runtime-এ add/delete হয়।
              * যেমন: socialLinks, metadata, settings ইত্যাদি।
              * ══════════════════════════════════════════════════════════════ */}

            {/* ── setKey — key add বা update করো ───────────────────────────── */}
            <button onClick={() => fs.object.setKey("socialLinks", "tiktok", "https://tiktok.com/@mystore")}>
                Add TikTok {/* socialLinks.tiktok = "https://..." — নতুন key */}
            </button>
            <button onClick={() => fs.object.setKey("socialLinks", "facebook", "https://facebook.com/newpage")}>
                Update Facebook {/* socialLinks.facebook update */}
            </button>

            {/* ── deleteKey — key delete করো ────────────────────────────────── */}
            <button onClick={() => fs.object.deleteKey("socialLinks", "instagram")}>
                Remove Instagram {/* socialLinks থেকে instagram key বাদ */}
            </button>

            {/* Dynamic key list — Object.entries দিয়ে render করো */}
            {Object.entries(fs.values.socialLinks).map(([platform, url]) => (
                <div key={platform}>
                    <span>{platform}:</span>
                    {/* setKey দিয়ে value update করো */}
                    <input
                        value={url}
                        onChange={e => fs.object.setKey("socialLinks", platform, e.target.value)}
                    />
                    {/* deleteKey দিয়ে key remove করো */}
                    <button onClick={() => fs.object.deleteKey("socialLinks", platform)}>✕</button>
                </div>
            ))}

            {/* ── removeField — যেকোনো depth-এ field delete করো ───────────── */}
            {/* Object key delete (object.deleteKey-এর মতো, but any depth) */}
            <button onClick={() => fs.object.removeField("address.zip")}>
                Remove zip {/* address.zip field delete হবে */}
            </button>

            {/* Deeply nested field delete */}
            <button onClick={() => fs.object.removeField("seo.description")}>
                Remove SEO description
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.media — নতুন file upload + single URL field null করা
              *
              * দুটো আলাদা use case:
              *   1. নতুন File object stage করা (values-এ রাখা যায় না)
              *   2. Single URL string field (avatarUrl) null করা
              *
              * Image array manage করতে fs.list.remove() use করো — fs.media না।
              * ══════════════════════════════════════════════════════════════ */}

            {/* ── নতুন file upload ──────────────────────────────────────────── */}
            {/*
              * setterFor("avatar") — ImagePickerField-এর setValue prop-এ দাও।
              * User file select করলে pendingFiles["avatar"] = [File] হবে।
              * onSubmit-এ pendingFiles["avatar"][0] দিয়ে FormData-তে append করো।
              */}
            <ImagePickerField
                label="Avatar"
                value={fs.media.pendingFiles["avatar"] ?? []}  // staged files
                setValue={fs.media.setterFor("avatar")}         // file select handler
            />
            {/* File select হলে clear button দেখাও */}
            {fs.media.hasFile("avatar") && (
                <button onClick={() => fs.media.clearFiles("avatar")}>
                    Clear avatar {/* pendingFiles["avatar"] = [] */}
                </button>
            )}

            {/* নতুন cover upload */}
            <ImagePickerField
                label="Cover Photo"
                value={fs.media.pendingFiles["cover"] ?? []}
                setValue={fs.media.setterFor("cover")}
            />

            {/* ── Existing single URL field null করা ───────────────────────── */}
            {/*
              * avatarUrl = "https://cdn.example.com/avatar.jpg" — একটা string field।
              * User remove করলে:
              *   — form-এ avatarUrl = "" হয়
              *   — removedKeys["avatarUrl"] = true হয়
              * onSubmit-এ removedKeys দেখে server DB-তে avatarUrl = null করে।
              *
              * কেন শুধু fs.set("avatarUrl", "") করলে হবে না?
              *   Server জানবে না এটা ইচ্ছাকৃত null নাকি empty string।
              *   removedKeys flag সেই distinction করে।
              */}
            {fs.values.avatarUrl && !fs.media.hasRemoved("avatarUrl") && (
                <div>
                    <img src={fs.values.avatarUrl} alt="Avatar" width={80} />
                    <button onClick={() => fs.media.removeExisting("avatarUrl")}>
                        Remove avatar {/* avatarUrl = "", removedKeys["avatarUrl"] = true */}
                    </button>
                </div>
            )}

            {/* Remove করলে undo option দেখাও */}
            {fs.media.hasRemoved("avatarUrl") && (
                <button onClick={() => fs.media.undoRemove("avatarUrl")}>
                    Undo remove {/* avatarUrl snapshot থেকে restore, flag clear */}
                </button>
            )}


            {/* ══════════════════════════════════════════════════════════════
              * fs.snapshot — saved baseline read
              *
              * snapshot = last saved/synced state।
              * isDirty = current values !== snapshot।
              * ══════════════════════════════════════════════════════════════ */}

            {/* ── snapshot.get — একটা field-এর saved value পাও ────────────── */}
            {/* "Revert this field only" UI বানাতে কাজে লাগে */}
            <button onClick={() => fs.set("title", fs.snapshot.get("title"))}>
                Revert title {/* snapshot-এর "Handmade Leather Bag"-এ ফিরে যাবে */}
            </button>

            {/* Nested field revert */}
            <button onClick={() => fs.set("variants.0.price", fs.snapshot.get("variants.0.price"))}>
                Revert variant 1 price {/* snapshot-এর 1000-এ ফিরে যাবে */}
            </button>

            {/* ── snapshot.getAll — পুরো snapshot object ───────────────────── */}
            <button onClick={() => console.log(fs.snapshot.getAll())}>
                Log snapshot {/* পুরো saved state console-এ দেখো */}
            </button>

            {/* ── snapshot.isDirty — isDirty-র alias ───────────────────────── */}
            <p>Has unsaved changes: {String(fs.snapshot.isDirty)}</p>


            {/* ══════════════════════════════════════════════════════════════
              * fs.history — undo/redo
              *
              * options-এ historyLimit: 50 দেওয়া আছে, তাই active।
              * historyLimit: 0 (default) হলে এগুলো কাজ করবে না।
              * ══════════════════════════════════════════════════════════════ */}

            {/* undo — আগের state-এ ফিরে যাও */}
            <button onClick={fs.history.undo} disabled={!fs.history.canUndo}>
                ↩ Undo ({fs.history.steps} steps available)
                {/* canUndo = false হলে disabled — history empty */}
            </button>

            {/* redo — undo-র পরে আবার forward আসো */}
            <button onClick={fs.history.redo} disabled={!fs.history.canRedo}>
                ↪ Redo
                {/* canRedo = false হলে disabled — future stack empty */}
            </button>

            {/* clear — history আর future stack দুটোই clear করো */}
            <button onClick={fs.history.clear}>
                Clear history
            </button>


            {/* ══════════════════════════════════════════════════════════════
              * fs.validate — manual validation trigger
              *
              * submit() call করলে automatically validate হয়।
              * Manually trigger করতে চাইলে এগুলো use করো।
              * ══════════════════════════════════════════════════════════════ */}

            {/* ── validate.now — পুরো form validate করো ────────────────────── */}
            {/* true = valid, false = error আছে */}
            <button onClick={() => {
                const isValid = fs.validate.now();
                if (isValid) {
                    console.log("Form is valid, ready to submit");
                } else {
                    console.log("Errors:", fs.fieldErrors);
                }
            }}>
                Validate now
            </button>

            {/* ── validate.field — single field validate করো ────────────────── */}
            {/* onBlur-এ single field validate করো, error message return করে */}
            <input
                value={fs.values.email}
                onChange={e => fs.set("email", e.target.value)}
                onBlur={() => {
                    const error = fs.validate.field("email");
                    // error = "Valid email দাও" বা null
                    console.log("Email error:", error);
                }}
            />
            {/* validate.field() error state-এ set করে, তাই field.error() দিয়ে দেখানো যায় */}
            <p style={{ color: "red" }}>{fs.field.error("email")}</p>


            {/* ══════════════════════════════════════════════════════════════
              * fs.hasValidated — validation কোনোদিন run হয়েছে কিনা
              *
              * false = এখনো কোনো validation run হয়নি (submit বা validate.now)
              * true  = অন্তত একবার validation run হয়েছে
              *
              * isValid সবসময় false হওয়া থেকে prevent করে —
              * validation run-এর আগে isValid false থাকে।
              * ══════════════════════════════════════════════════════════════ */}

            {/* Validation run-এর আগে কিছু show করো না */}
            {fs.hasValidated && (
                fs.isValid
                    ? <Badge tone="success">Form is valid</Badge>
                    : <Badge tone="critical">Please fix errors</Badge>
            )}


            {/* ══════════════════════════════════════════════════════════════
              * fs.submitCount — কতবার submit attempt হয়েছে
              *
              * 0 = এখনো submit করা হয়নি।
              * >0 = অন্তত একবার submit চেষ্টা হয়েছে।
              *
              * Error visibility control করতে কাজে লাগে।
              * submitCount > 0 হলে সব error দেখাও (touched না হলেও)।
              * ══════════════════════════════════════════════════════════════ */}

            {fs.submitCount > 0 && (
                <p>Submit attempted {fs.submitCount} time(s)</p>
            )}

            {/* First submit-এর আগে error banner লুকাও */}
            {fs.submitCount > 0 && Object.keys(fs.fieldErrors).length > 0 && (
                <Banner tone="critical">Please fix the errors before saving.</Banner>
            )}


            {/* ══════════════════════════════════════════════════════════════
              * fs.isDirty / fs.isSubmitting / fs.isValid — core state
              * ══════════════════════════════════════════════════════════════ */}

            {/* isDirty — কিছু change হয়েছে কিনা */}
            {fs.isDirty && <Banner>You have unsaved changes</Banner>}


            {/* ══════════════════════════════════════════════════════════════
              * fs.submit / fs.reset / fs.syncAfterSave — lifecycle
              * ══════════════════════════════════════════════════════════════ */}

            {/* ── submit — validate → onSubmit ──────────────────────────────── */}
            {/*
              * 1. Validation run হয়
              * 2. Error থাকলে সব field touched হয়, error দেখায়, false return করে
              * 3. Valid হলে onSubmit callback call হয়
              * 4. isSubmitting = true হয়, onSubmit resolve হলে false হয়
              */}
            <button
                disabled={!fs.isDirty || fs.isSubmitting}
                onClick={fs.submit}
            >
                {fs.isSubmitting ? "Saving…" : "Save"}
            </button>

            {/* ── reset — সব change discard করো ────────────────────────────── */}
            {/*
              * values → snapshot-এ revert
              * pendingFiles, removedKeys, fieldErrors, touchedFields সব clear
              * submitCount = 0, hasValidated = false
              */}
            <button
                disabled={!fs.isDirty}
                onClick={fs.reset}
            >
                Discard changes
            </button>

            {/* ── syncAfterSave — successful save-এর পর snapshot update ──────── */}
            {/*
              * Fresh server data দিয়ে snapshot update করো।
              * তারপর form === snapshot, isDirty = false।
              *
              * Real usage:
              * useEffect(() => {
              *   if (fetcher.state === "idle" && fetcher.data?.product) {
              *     fs.syncAfterSave(fetcher.data.product);
              *   }
              * }, [fetcher.state, fetcher.data]);
              */}
            <button onClick={() => fs.syncAfterSave(loaderData)}>
                Simulate sync after save {/* demo purpose — normally fetcher.data দাও */}
            </button>

        </div>
    );
}
