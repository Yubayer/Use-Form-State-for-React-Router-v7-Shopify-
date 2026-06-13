/**
 * @fileoverview useFormState — যেকোনো Shopify App form-এর জন্য generic, production-grade state hook।
 *
 * ─── এই hook যা যা handle করে ───────────────────────────────────────────────
 *  • যেকোনো shape-এর form values (scalar, object, array, deeply nested)
 *  • Dirty tracking — global (isDirty) এবং per-field (fs.field.isDirty)
 *  • File upload ও existing media manage (slot-based এবং path-based)
 *  • Validation — manual function এবং/অথবা Zod schema
 *  • Touched / blur / error state management
 *  • Async submit flow (isSubmitting auto-manage)
 *  • List sorting, reordering, drag-drop, normalization
 *  • Undo/Redo history (opt-in, historyLimit দিয়ে enable করো)
 *  • Computed/derived fields (fs.field.compute)
 *  • Field watch — side effect trigger on change (fs.field.watch)
 *  • Debug mode — console-এ সব state change log করে
 *  • Server data re-sync when loader data changes
 *
 * ─── Namespace overview ──────────────────────────────────────────────────────
 *  fs.values          → live form values
 *  fs.set / fs.get    → যেকোনো depth-এ read/write
 *  fs.field.*         → per-field operations (bind, error, dirty, touch, toggle…)
 *  fs.list.*          → array operations (append, remove, move, sort, bind…)
 *  fs.object.*        → dynamic object key management
 *  fs.media.*         → file upload + existing media management
 *  fs.snapshot.*      → saved baseline read
 *  fs.history.*       → undo/redo (historyLimit > 0 হলে active)
 *  fs.validate.*      → manual validation trigger
 *
 * @module useFormState
 *
 * ─── Minimal usage ───────────────────────────────────────────────────────────
 * @example
 * function buildShape(data) {
 *   return { title: str(data?.title), active: bool(data?.active) };
 * }
 *
 * const fs = useFormState(loaderData, buildShape);
 *
 * <TextField
 *   {...fs.field.bind("title")}
 *   label="Title"
 * />
 * <Button disabled={!fs.isDirty || fs.isSubmitting} onClick={fs.submit}>
 *   {fs.isSubmitting ? "Saving…" : "Save"}
 * </Button>
 *
 * ─── Full feature usage ──────────────────────────────────────────────────────
 * @example
 * const fs = useFormState(loaderData, buildShape, {
 *   validate: (values) => {
 *     const errors = {};
 *     if (!values.title) errors.title = "Required";
 *     values.sections.forEach((s, i) => {
 *       if (!s.heading) errors[`sections.${i}.heading`] = "Required";
 *     });
 *     return errors;
 *   },
 *   onSubmit: async (values, { pendingFiles, removedKeys }) => {
 *     const fd = new FormData();
 *     fd.append("data", JSON.stringify(values));
 *     fd.append("removedMedia", JSON.stringify(removedKeys));
 *     if (pendingFiles["cover"]?.[0]) fd.append("cover", pendingFiles["cover"][0]);
 *     fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
 *   },
 *   historyLimit: 50,
 *   debug: true,
 *   debugLabel: "ProductForm",
 * });
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";

/* ════════════════════════════════════════════════════════════════════════════
 * ███ NORMALIZE HELPERS
 * buildFormShape-এর ভেতরে use করো যাতে server data-র null/undefined
 * values stable shape পায়। এটা না করলে dirty check false positive দেবে।
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * null/undefined → `""` করে দেয়।
 * Text field-এর জন্য use করো।
 * @param {string | null | undefined} value
 * @returns {string}
 * @example
 * title: str(data?.title)  // null হলে "" হবে
 */
export const str = (value) => value ?? "";

/**
 * null/undefined → `false` করে দেয়।
 * Checkbox / toggle field-এর জন্য use করো।
 * @param {boolean | null | undefined} value
 * @returns {boolean}
 * @example
 * isActive: bool(data?.isActive)
 */
export const bool = (value) => value ?? false;

/**
 * null/undefined → `""`, number → string করে দেয়।
 * Number input binding-এর জন্য use করো।
 * @param {number | string | null | undefined} value
 * @returns {string}
 * @example
 * price: num(data?.price)  // 9.99 → "9.99", null → ""
 */
export const num = (value) => (value == null ? "" : String(value));

/**
 * Non-empty array হলে রাখে, নাহলে fallback দেয়।
 * Array field-এর জন্য use করো।
 * @template T
 * @param {T[] | null | undefined} value
 * @param {T[]} [fallback=[]]
 * @returns {T[]}
 * @example
 * tags: arr(data?.tags)              // null/[] হলে [] হবে
 * sections: arr(data?.sections, [{ heading: "", blocks: [] }])
 */
export const arr = (value, fallback = []) =>
    Array.isArray(value) && value.length > 0 ? value : fallback;

/**
 * Plain object হলে রাখে, নাহলে fallback দেয়।
 * Nested object field-এর জন্য use করো।
 * @param {Object | null | undefined} value
 * @param {Object} fallback
 * @returns {Object}
 * @example
 * address: obj(data?.address, { city: "", zip: "" })
 * seo: obj(data?.seo, { title: "", description: "" })
 */
export const obj = (value, fallback) =>
    value != null && typeof value === "object" && !Array.isArray(value)
        ? value
        : fallback;

/* ════════════════════════════════════════════════════════════════════════════
 * ███ INTERNAL UTILITIES
 * এগুলো hook-এর বাইরে export হয় না। শুধু internal কাজে লাগে।
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * যেকোনো serializable value deep clone করে।
 * structuredClone available থাকলে সেটা use করে (Node 17+, modern browsers),
 * না হলে JSON round-trip fallback।
 * @private
 */
function deepClone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

/**
 * Structural deep equality check।
 * Plain object, array, Date, NaN, null/undefined সব handle করে।
 * File object ref equality দিয়ে compare করে।
 * @private
 */
function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;
    if (typeof a !== typeof b) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof File || b instanceof File) return a === b;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
        return true;
    }
    if (typeof a === "object") {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        for (const k of aKeys) if (!deepEqual(a[k], b[k])) return false;
        return true;
    }
    if (typeof a === "number" && typeof b === "number") {
        return Number.isNaN(a) && Number.isNaN(b);
    }
    return false;
}

/**
 * Dot-path string কে segments array-তে parse করে।
 * Numeric segment গুলো number হয়ে যায় (array index-এর জন্য)।
 *   "address.city"       → ["address", "city"]
 *   "sections.0.heading" → ["sections", 0, "heading"]
 *   ["a", 0, "b"]        → ["a", 0, "b"] (already parsed, pass-through)
 * @private
 */
function parsePath(path) {
    if (Array.isArray(path)) return path;
    if (path == null || path === "") return [];
    return String(path).split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

/**
 * Dot-path দিয়ে object থেকে value read করে।
 * যেকোনো segment missing থাকলে undefined return করে।
 * @private
 */
function getAt(obj, path) {
    const segments = parsePath(path);
    let current = obj;
    for (const segment of segments) {
        if (current == null) return undefined;
        current = current[segment];
    }
    return current;
}

/**
 * Dot-path দিয়ে object-এ value immutably set করে।
 * Path-এর প্রতিটা container clone হয়, বাকি branches unchanged থাকে।
 * @private
 */
function setAt(obj, path, value) {
    const segments = parsePath(path);
    if (segments.length === 0) return value;

    const root = Array.isArray(obj) ? [...obj] : { ...obj };
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i];
        const nextKey = segments[i + 1];
        const child = current[key];
        const cloned =
            child == null
                ? typeof nextKey === "number" ? [] : {}
                : Array.isArray(child) ? [...child] : { ...child };
        current[key] = cloned;
        current = cloned;
    }
    current[segments[segments.length - 1]] = value;
    return root;
}

/**
 * Dot-path দিয়ে object থেকে key/index immutably delete করে।
 * Object হলে property remove, array হলে splice (length কমে)।
 * @private
 */
function deleteAt(obj, path) {
    const segments = parsePath(path);
    if (segments.length === 0) return obj;

    const root = Array.isArray(obj) ? [...obj] : { ...obj };
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i];
        const child = current[key];
        if (child == null) return root;
        const cloned = Array.isArray(child) ? [...child] : { ...child };
        current[key] = cloned;
        current = cloned;
    }
    const last = segments[segments.length - 1];
    if (Array.isArray(current)) current.splice(Number(last), 1);
    else delete current[last];
    return root;
}

/**
 * Path-এর array-কে একটা transform function দিয়ে immutably update করে।
 * Transform একটা shallow copy receive করে, সেটা mutate করতে পারে।
 * @private
 */
function updateArrayAt(obj, path, transform) {
    const segments = parsePath(path);
    if (segments.length === 0) {
        if (!Array.isArray(obj))
            throw new Error("useFormState: updateArrayAt — root is not an array");
        const next = [...obj];
        transform(next);
        return next;
    }
    const currentArray = getAt(obj, segments);
    if (!Array.isArray(currentArray)) {
        throw new Error(
            `useFormState: updateArrayAt — "${segments.join(".")}" is not an array`
        );
    }
    const nextArray = [...currentArray];
    transform(nextArray);
    return setAt(obj, segments, nextArray);
}

/**
 * Path input (string | array) কে stable string key-এ normalize করে।
 * fieldErrors / touchedFields map-এ key হিসেবে use হয়।
 * @private
 */
function toPathKey(path) {
    return Array.isArray(path) ? path.join(".") : String(path);
}

/**
 * Object-এর সব leaf path গুলো collect করে একটা flat array-তে।
 * touchAllFields এবং dirtyFields-এ use হয়।
 * @private
 */
function collectLeafPaths(node, prefix = "") {
    const result = [];
    if (
        node == null ||
        typeof node !== "object" ||
        node instanceof Date ||
        node instanceof File
    ) {
        if (prefix) result.push(prefix);
        return result;
    }
    if (Array.isArray(node)) {
        if (node.length === 0 && prefix) result.push(prefix);
        node.forEach((item, i) =>
            result.push(...collectLeafPaths(item, prefix ? `${prefix}.${i}` : String(i)))
        );
        return result;
    }
    const keys = Object.keys(node);
    if (keys.length === 0 && prefix) result.push(prefix);
    for (const k of keys) {
        result.push(...collectLeafPaths(node[k], prefix ? `${prefix}.${k}` : k));
    }
    return result;
}

/* ════════════════════════════════════════════════════════════════════════════
 * ███ JSDOC TYPEDEFS
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {string | Array<string|number>} Path
 * Dot-path string অথবা segment array।
 * @example
 * "title"
 * "address.city"
 * "sections.0.blocks.2.content"
 * ["sections", 0, "blocks", 2, "content"]
 */

/**
 * @typedef {"asc" | "desc"} SortDirection
 * Sort direction। default "asc"।
 */

/**
 * @typedef {Object} SubmitContext
 * onSubmit callback-এ second argument হিসেবে আসে।
 * @property {{ [slotName: string]: File[] }} pendingFiles
 *   Staged files — slot name দিয়ে indexed।
 * @property {{ [urlFieldPath: string]: true }} removedKeys
 *   Existing media যেগুলো user remove করেছে — DB-তে null করতে হবে।
 */

/**
 * @typedef {Object} UseFormStateOptions
 *
 * @property {function(Object): Record<string, string>} [validate]
 *   Sync validator। form values receive করে, error map return করে।
 *   Empty object মানে valid।
 *   @example
 *   validate: (values) => {
 *     const errors = {};
 *     if (!values.title) errors.title = "Required";
 *     if (!values.email) errors.email = "Invalid email";
 *     return errors;
 *   }
 *
 * @property {{ safeParse: function }} [schema]
 *   Zod (বা compatible) schema। validate-এর আগে run করে।
 *   Conflict হলে validate জেতে।
 *   @example
 *   schema: z.object({ title: z.string().min(1), price: z.number().positive() })
 *
 * @property {boolean} [validateOnChange=false]
 *   প্রতিটা value change-এ validation run করবে কিনা।
 *   Default false — blur বা submit-এ validate করা better UX।
 *
 * @property {function(Object, SubmitContext): (void|Promise<void>)} [onSubmit]
 *   Validation pass হলে submit() call করলে এটা run হয়।
 *   Promise return করলে resolve/reject পর্যন্ত isSubmitting = true।
 *
 * @property {boolean} [syncOnServerDataChange=true]
 *   true হলে serverData reference বদলালে form + snapshot auto re-init হয়।
 *   false করো যদি syncAfterSave নিজে manage করতে চাও।
 *
 * @property {number} [historyLimit=0]
 *   Undo/redo history কতটা step রাখবে।
 *   0 = disabled। 20-100 practical range।
 *
 * @property {boolean} [debug=false]
 *   true হলে সব state change console-এ log করবে।
 *   Production-এ false রাখো।
 *
 * @property {string} [debugLabel="useFormState"]
 *   Debug log-এর prefix label।
 */

/* ════════════════════════════════════════════════════════════════════════════
 * ███ THE HOOK
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Generic form state hook — যেকোনো Shopify App form-এ use করা যাবে।
 *
 * @param {Object} serverData
 *   Loader থেকে আসা raw server data। null/undefined হতে পারে।
 *
 * @param {function(Object): Object} buildFormShape
 *   Pure function — server data → clean form shape।
 *   Module-level বা useCallback-এ define করো।
 *   @example
 *   function buildShape(data) {
 *     return {
 *       title: str(data?.title),
 *       price: num(data?.price),
 *       isActive: bool(data?.isActive),
 *       tags: arr(data?.tags),
 *       address: obj(data?.address, { city: "", zip: "" }),
 *     };
 *   }
 *
 * @param {UseFormStateOptions} [options={}]
 *
 * @returns {FormStateHandle} fs object — সব namespace সহ।
 */
export function useFormState(serverData, buildFormShape, options = {}) {
    const {
        validate,
        schema,
        validateOnChange = false,
        onSubmit,
        syncOnServerDataChange = true,
        historyLimit = 0,
        debug = false,
        debugLabel = "useFormState",
    } = options;

    // ── Stable refs: callback গুলো ref-এ রাখো যাতে memo/callback re-create না হয় ──
    const buildFormShapeRef = useRef(buildFormShape);
    const validateRef       = useRef(validate);
    const schemaRef         = useRef(schema);
    const onSubmitRef       = useRef(onSubmit);
    buildFormShapeRef.current = buildFormShape;
    validateRef.current       = validate;
    schemaRef.current         = schema;
    onSubmitRef.current       = onSubmit;

    // ── Debug helper ──────────────────────────────────────────────────────────
    const log = useCallback(
        (action, payload) => {
            if (!debug) return;
            console.log(`[${debugLabel}] ${action}`, payload ?? "");
        },
        [debug, debugLabel]
    );

    // ── Core state ────────────────────────────────────────────────────────────
    const initialShape = () => buildFormShape(serverData);
    const [values,           setValues]           = useState(initialShape);
    const [savedSnapshot,    setSavedSnapshot]    = useState(initialShape);
    const [pendingFiles,     setPendingFiles]     = useState({});  // { slotName: File[] }
    const [removedKeys,      setRemovedKeys]      = useState({});  // { urlFieldPath: true }
    const [fieldErrors,      setFieldErrors]      = useState({});
    const [touchedFields,    setTouchedFields]    = useState({});
    const [isSubmitting,     setIsSubmitting]     = useState(false);
    const [submitCount,      setSubmitCount]      = useState(0);
    const [hasValidated,     setHasValidated]     = useState(false);

    // History state (historyLimit > 0 হলেই meaningful)
    const [history,    setHistory]    = useState([]);  // past snapshots
    const [future,     setFuture]     = useState([]);  // redo stack

    // Latest values সবসময় ref-এ রাখো — callback-এ stale closure এড়াতে
    const latestValuesRef = useRef(values);
    latestValuesRef.current = values;

    const savedSnapshotRef = useRef(savedSnapshot);
    savedSnapshotRef.current = savedSnapshot;

    // ── Server data re-sync ───────────────────────────────────────────────────
    const prevServerDataRef = useRef(serverData);
    useEffect(() => {
        if (!syncOnServerDataChange) return;
        if (serverData === prevServerDataRef.current) return;
        prevServerDataRef.current = serverData;
        const freshShape = buildFormShapeRef.current(serverData);
        log("syncOnServerDataChange", freshShape);
        setValues(freshShape);
        setSavedSnapshot(freshShape);
        setPendingFiles({});
        setRemovedKeys({});
        setFieldErrors({});
        setTouchedFields({});
        setSubmitCount(0);
        setHasValidated(false);
        setHistory([]);
        setFuture([]);
    }, [serverData, syncOnServerDataChange, log]);

    // ── History push helper ───────────────────────────────────────────────────
    // প্রতিটা form update-এর আগে current values history-তে push করে
    const pushHistory = useCallback(
        (prevValues) => {
            if (historyLimit <= 0) return;
            setHistory((h) => {
                const next = [prevValues, ...h].slice(0, historyLimit);
                return next;
            });
            setFuture([]); // নতুন change হলে redo stack clear
        },
        [historyLimit]
    );

    // ── Core form updater ─────────────────────────────────────────────────────
    // সব setter এই function দিয়ে form update করে
    const applyUpdate = useCallback(
        (updater, actionLabel) => {
            setValues((prev) => {
                pushHistory(prev);
                const next =
                    typeof updater === "function" ? updater(prev) : updater;
                if (actionLabel) log(actionLabel, next);
                return next;
            });
        },
        [pushHistory, log]
    );

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ VALIDATION CORE
     * ────────────────────────────────────────────────────────────────────────── */

    // Schema + validate একসাথে run করে। Pure — state mutate করে না।
    const runValidationPure = useCallback((formValues) => {
        let errors = {};

        // Zod schema (optional)
        const activeSchema = schemaRef.current;
        if (activeSchema?.safeParse) {
            const result = activeSchema.safeParse(formValues);
            if (!result.success) {
                for (const issue of result.error.issues) {
                    const key = issue.path.join(".");
                    if (!errors[key]) errors[key] = issue.message;
                }
            }
        }

        // Manual validate function (optional) — conflict হলে এটা জেতে
        const validateFn = validateRef.current;
        if (typeof validateFn === "function") {
            const manualErrors = validateFn(formValues) || {};
            errors = { ...errors, ...manualErrors };
        }

        return errors;
    }, []);

    // validateOnChange: effect-এ রাখো, setState-এর ভেতরে call করা নিষেধ
    useEffect(() => {
        if (!validateOnChange) return;
        const errors = runValidationPure(values);
        setFieldErrors(errors);
        setHasValidated(true);
    }, [values, validateOnChange, runValidationPure]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ DERIVED STATE
     * ────────────────────────────────────────────────────────────────────────── */

    /**
     * true যদি form, snapshot থেকে আলাদা হয় বা pending files/removed media থাকে।
     */
    const isDirty = useMemo(() => {
        if (Object.values(pendingFiles).some((fl) => fl?.length > 0)) return true;
        if (Object.values(removedKeys).some(Boolean)) return true;
        return !deepEqual(values, savedSnapshot);
    }, [values, savedSnapshot, pendingFiles, removedKeys]);

    /**
     * true শুধু যদি অন্তত একবার validation run হয়েছে এবং কোনো error নেই।
     */
    const isValid = useMemo(
        () => hasValidated && Object.keys(fieldErrors).length === 0,
        [hasValidated, fieldErrors]
    );

    /**
     * প্রতিটা changed leaf path-এর map: { "dot.path": true }।
     * Section-level dirty count করতে কাজে লাগে।
     */
    const dirtyFieldsMap = useMemo(() => {
        const result = {};
        function walkDiff(curr, snap, prefix) {
            if (
                curr == null ||
                typeof curr !== "object" ||
                curr instanceof Date ||
                curr instanceof File
            ) {
                if (!deepEqual(curr, snap)) result[prefix] = true;
                return;
            }
            for (const key of Object.keys(curr)) {
                const childPath = prefix ? `${prefix}.${key}` : key;
                walkDiff(curr[key], snap?.[key], childPath);
            }
        }
        walkDiff(values, savedSnapshot, "");
        return result;
    }, [values, savedSnapshot]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ CORE OPS — fs.set, fs.get, fs.setMany, fs.merge
     * ────────────────────────────────────────────────────────────────────────── */

    /**
     * যেকোনো depth-এ value set করো।
     * @param {Path} path - dot-path অথবা segment array
     * @param {*} value - নতুন value
     * @example
     * fs.set("title", "Hello")
     * fs.set("address.city", "Dhaka")
     * fs.set("sections.0.blocks.2.content", "Updated text")
     */
    const set = useCallback(
        (path, value) => {
            applyUpdate((prev) => setAt(prev, path, value), `set("${path}")`);
        },
        [applyUpdate]
    );

    /**
     * যেকোনো depth থেকে live form value read করো।
     * @param {Path} path
     * @returns {*} value অথবা undefined (path missing হলে)
     * @example
     * const title = fs.get("title");
     * const city  = fs.get("address.city");
     */
    const get = useCallback(
        (path) => getAt(latestValuesRef.current, path),
        []
    );

    /**
     * একটা render-এ multiple fields একসাথে update করো।
     * @param {Array<[Path, *]>} pairs - [path, value] tuple-এর array
     * @example
     * fs.setMany([
     *   ["title", "Hello"],
     *   ["slug", "hello"],
     *   ["seo.title", "Hello — My Store"],
     * ]);
     */
    const setMany = useCallback(
        (pairs) => {
            applyUpdate((prev) => {
                let next = prev;
                for (const [path, value] of pairs) next = setAt(next, path, value);
                return next;
            }, "setMany");
        },
        [applyUpdate]
    );

    /**
     * একটা path-এ partial object merge করো (shallow)।
     * path না দিলে root-এ merge হয়।
     * @param {Object} patch - merge করার object
     * @param {Path} [path] - কোথায় merge করবে (default: root)
     * @example
     * fs.merge({ city: "Dhaka", zip: "1000" }, "address")
     * fs.merge({ title: "New", slug: "new" })  // root-এ
     */
    const merge = useCallback(
        (patch, path) => {
            applyUpdate((prev) => {
                const segments = parsePath(path);
                if (segments.length === 0) return { ...prev, ...patch };
                const current = getAt(prev, segments) || {};
                return setAt(prev, segments, { ...current, ...patch });
            }, `merge("${path ?? "root"}")`);
        },
        [applyUpdate]
    );

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ fs.field — per-field operations
     * ────────────────────────────────────────────────────────────────────────── */

    // ── Touch management ──────────────────────────────────────────────────────

    const touchField = useCallback((path) => {
        const key = toPathKey(path);
        setTouchedFields((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    }, []);

    const untouchField = useCallback((path) => {
        const key = toPathKey(path);
        setTouchedFields((prev) => {
            if (!prev[key]) return prev;
            const { [key]: _, ...rest } = prev;
            return rest;
        });
    }, []);

    const touchAllFields = useCallback(() => {
        const allTouched = {};
        collectLeafPaths(latestValuesRef.current).forEach((p) => {
            allTouched[p] = true;
        });
        setTouchedFields(allTouched);
    }, []);

    // ── Error management ──────────────────────────────────────────────────────

    const setFieldError = useCallback((path, message) => {
        setFieldErrors((prev) => ({ ...prev, [toPathKey(path)]: message }));
    }, []);

    const clearFieldError = useCallback((path) => {
        const key = toPathKey(path);
        setFieldErrors((prev) => {
            if (!prev[key]) return prev;
            const { [key]: _, ...rest } = prev;
            return rest;
        });
    }, []);

    const clearAllErrors = useCallback(() => setFieldErrors({}), []);

    // ── field namespace object ────────────────────────────────────────────────

    const field = useMemo(() => ({
        /**
         * Polaris TextField-এর জন্য সব props একসাথে দেয়।
         * value, onChange, onBlur, error — সব বাঁধা থাকে।
         * @param {Path} path
         * @returns {{ value: string, onChange: function, onBlur: function, error: string|null }}
         * @example
         * <TextField label="Title" {...fs.field.bind("title")} />
         * <TextField label="City"  {...fs.field.bind("address.city")} />
         */
        bind: (path) => ({
            value: getAt(latestValuesRef.current, path) ?? "",
            onChange: (value) => set(path, value),
            onBlur: () => touchField(path),
            error: (() => {
                const key = toPathKey(path);
                if (!fieldErrors[key]) return null;
                if (submitCount > 0 || touchedFields[key]) return fieldErrors[key];
                return null;
            })(),
        }),

        /**
         * Polaris Checkbox-এর জন্য props দেয়।
         * @param {Path} path
         * @returns {{ checked: boolean, onChange: function, onBlur: function, error: string|null }}
         * @example
         * <Checkbox label="Active" {...fs.field.bindCheckbox("isActive")} />
         */
        bindCheckbox: (path) => ({
            checked: !!(getAt(latestValuesRef.current, path)),
            onChange: (checked) => set(path, checked),
            onBlur: () => touchField(path),
            error: (() => {
                const key = toPathKey(path);
                if (!fieldErrors[key]) return null;
                if (submitCount > 0 || touchedFields[key]) return fieldErrors[key];
                return null;
            })(),
        }),

        /**
         * Number input-এর জন্য props দেয়।
         * value string হিসেবে আসে, onChange-এ number-এ convert হয়।
         * @param {Path} path
         * @returns {{ value: string, onChange: function, onBlur: function, error: string|null }}
         * @example
         * <TextField type="number" label="Price" {...fs.field.bindNumber("price")} />
         */
        bindNumber: (path) => ({
            value: String(getAt(latestValuesRef.current, path) ?? ""),
            onChange: (value) => set(path, value === "" ? "" : Number(value)),
            onBlur: () => touchField(path),
            error: (() => {
                const key = toPathKey(path);
                if (!fieldErrors[key]) return null;
                if (submitCount > 0 || touchedFields[key]) return fieldErrors[key];
                return null;
            })(),
        }),

        /**
         * Error message দেয় — শুধুমাত্র field touched হলে বা submit attempt হলে।
         * @param {Path} path
         * @returns {string | null}
         * @example
         * <TextField error={fs.field.error("title")} />
         */
        error: (path) => {
            const key = toPathKey(path);
            if (!fieldErrors[key]) return null;
            if (submitCount > 0 || touchedFields[key]) return fieldErrors[key];
            return null;
        },

        /**
         * এই field snapshot থেকে আলাদা হয়েছে কিনা।
         * @param {Path} path
         * @returns {boolean}
         * @example
         * const isTitleDirty = fs.field.isDirty("title");
         * const isAddressDirty = fs.field.isDirty("address"); // subtree check
         */
        isDirty: (path) =>
            !deepEqual(
                getAt(latestValuesRef.current, path),
                getAt(savedSnapshotRef.current, path)
            ),

        /**
         * Field touched হয়েছে কিনা।
         * @param {Path} path
         * @returns {boolean}
         */
        isTouched: (path) => !!touchedFields[toPathKey(path)],

        /**
         * Field-কে touched mark করো (onBlur-এ call করো)।
         * @param {Path} path
         * @example
         * <TextField onBlur={() => fs.field.touch("title")} />
         */
        touch: touchField,

        /**
         * Field-এর touched mark সরিয়ে দাও।
         * @param {Path} path
         */
        untouch: untouchField,

        /**
         * সব leaf field touched mark করো।
         * Submit fail হলে auto-call হয়, manually-ও call করা যায়।
         */
        touchAll: touchAllFields,

        /**
         * Server error manually set করো।
         * @param {Path} path
         * @param {string} message
         * @example
         * fs.field.setError("email", "Already taken");
         */
        setError: setFieldError,

        /**
         * একটা field-এর error clear করো।
         * @param {Path} path
         */
        clearError: clearFieldError,

        /** সব error একসাথে clear করো। */
        clearAllErrors,

        /**
         * Boolean field toggle করো।
         * @param {Path} path
         * @example
         * fs.field.toggle("isActive")
         * fs.field.toggle("settings.notifications.email")
         */
        toggle: (path) => {
            applyUpdate(
                (prev) => setAt(prev, path, !getAt(prev, path)),
                `field.toggle("${path}")`
            );
        },

        /**
         * Numeric field increment করো।
         * @param {Path} path
         * @param {number} [step=1]
         * @example
         * fs.field.increment("stock")        // stock + 1
         * fs.field.increment("stock", 5)     // stock + 5
         * fs.field.increment("variants.0.stock")
         */
        increment: (path, step = 1) => {
            applyUpdate(
                (prev) => setAt(prev, path, (Number(getAt(prev, path)) || 0) + step),
                `field.increment("${path}", ${step})`
            );
        },

        /**
         * Numeric field decrement করো।
         * @param {Path} path
         * @param {number} [step=1]
         * @example
         * fs.field.decrement("stock")        // stock - 1
         * fs.field.decrement("price", 0.5)
         */
        decrement: (path, step = 1) => {
            applyUpdate(
                (prev) => setAt(prev, path, (Number(getAt(prev, path)) || 0) - step),
                `field.decrement("${path}", ${step})`
            );
        },

        /**
         * Computed/derived field — dependency বদলালে auto-update হয়।
         * useEffect-এ wrap করা আছে, তাই render-এ call করো।
         *
         * ⚠️ Component-এর top level-এ call করো, condition/loop-এ না।
         *
         * @param {Path} path - কোন field-এ result set হবে
         * @param {function(Object): *} computeFn - values receive করে result return করে
         * @param {Path[]} deps - কোন path গুলো watch করবে
         * @example
         * // title থেকে slug auto-generate
         * fs.field.compute("slug", (values) =>
         *   values.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
         * , ["title"]);
         *
         * // items থেকে total calculate
         * fs.field.compute("totalPrice", (values) =>
         *   values.items.reduce((sum, item) => sum + item.price * item.qty, 0)
         * , ["items"]);
         */
        // eslint-disable-next-line react-hooks/rules-of-hooks
        compute: (path, computeFn, deps) => {
            // deps-এর current values নিয়ে dependency array বানাও
            // eslint-disable-next-line react-hooks/rules-of-hooks
            const depValues = deps?.map((d) => getAt(latestValuesRef.current, d));
            // eslint-disable-next-line react-hooks/rules-of-hooks
            useEffect(() => {
                const computed = computeFn(latestValuesRef.current);
                const current = getAt(latestValuesRef.current, path);
                if (!deepEqual(computed, current)) {
                    set(path, computed);
                }
                // depValues array spread করা হচ্ছে dependency হিসেবে
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, depValues ?? [values]);
        },

        /**
         * Field change হলে side effect run করো।
         * useEffect-এ wrap করা আছে।
         *
         * ⚠️ Component-এর top level-এ call করো।
         *
         * @param {Path} path - কোন field watch করবে
         * @param {function(*, *): void} callback - (newValue, prevValue) receive করে
         * @example
         * // type বদলালে related fields reset করো
         * fs.field.watch("type", (newType, prevType) => {
         *   if (newType !== prevType) {
         *     fs.set("content", "");
         *     fs.set("mediaUrl", "");
         *   }
         * });
         */
        // eslint-disable-next-line react-hooks/rules-of-hooks
        watch: (path, callback) => {
            const currentValue = getAt(latestValuesRef.current, path);
            // eslint-disable-next-line react-hooks/rules-of-hooks
            const prevRef = useRef(currentValue);
            // eslint-disable-next-line react-hooks/rules-of-hooks
            useEffect(() => {
                const next = getAt(latestValuesRef.current, path);
                if (!deepEqual(next, prevRef.current)) {
                    callback(next, prevRef.current);
                    prevRef.current = next;
                }
            });
        },

        /** সব dirty field-এর map: { "dot.path": true } */
        get dirtyMap() { return dirtyFieldsMap; },
    }), [
        fieldErrors, touchedFields, submitCount,
        set, touchField, untouchField, touchAllFields,
        setFieldError, clearFieldError, clearAllErrors,
        applyUpdate, dirtyFieldsMap, values,
    ]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ fs.list — array operations যেকোনো depth-এ
     * ────────────────────────────────────────────────────────────────────────── */

    const list = useMemo(() => ({
        /**
         * Array-এর শেষে item append করো। Object হলে deep-clone হয়।
         * @param {Path} listPath
         * @param {*} item
         * @example
         * fs.list.append("tags", { name: "", color: "blue" })
         * fs.list.append("sections.0.blocks", { type: "text", content: "" })
         */
        append: (listPath, item) => {
            const safeItem = item != null && typeof item === "object" ? deepClone(item) : item;
            applyUpdate(
                (prev) => updateArrayAt(prev, listPath, (arr) => arr.push(safeItem)),
                `list.append("${listPath}")`
            );
        },

        /**
         * Array-এর শুরুতে item prepend করো।
         * @param {Path} listPath
         * @param {*} item
         * @example
         * fs.list.prepend("notifications", { message: "", read: false })
         */
        prepend: (listPath, item) => {
            const safeItem = item != null && typeof item === "object" ? deepClone(item) : item;
            applyUpdate(
                (prev) => updateArrayAt(prev, listPath, (arr) => arr.unshift(safeItem)),
                `list.prepend("${listPath}")`
            );
        },

        /**
         * নির্দিষ্ট index-এ item insert করো।
         * @param {Path} listPath
         * @param {number} index
         * @param {*} item
         * @example
         * fs.list.insert("sections", 2, { heading: "New Section", blocks: [] })
         */
        insert: (listPath, index, item) => {
            const safeItem = item != null && typeof item === "object" ? deepClone(item) : item;
            applyUpdate(
                (prev) => updateArrayAt(prev, listPath, (arr) => arr.splice(index, 0, safeItem)),
                `list.insert("${listPath}", ${index})`
            );
        },

        /**
         * Index দিয়ে item remove করো।
         * @param {Path} listPath
         * @param {number} index
         * @example
         * fs.list.remove("sections", 1)
         * fs.list.remove("sections.0.blocks", 2)
         */
        remove: (listPath, index) => {
            applyUpdate(
                (prev) => updateArrayAt(prev, listPath, (arr) => arr.splice(index, 1)),
                `list.remove("${listPath}", ${index})`
            );
        },

        /**
         * List item-এর একটা field update করো।
         * @param {Path} listPath
         * @param {number} index
         * @param {string} fieldName
         * @param {*} value
         * @example
         * fs.list.setField("sections", 0, "heading", "Introduction")
         * fs.list.setField("variants", 2, "price", 99.99)
         */
        setField: (listPath, index, fieldName, value) => {
            const segments = parsePath(listPath);
            applyUpdate(
                (prev) => setAt(prev, [...segments, index, fieldName], value),
                `list.setField("${listPath}", ${index}, "${fieldName}")`
            );
        },

        /**
         * পুরো item replace করো।
         * @param {Path} listPath
         * @param {number} index
         * @param {*} newItem
         * @example
         * fs.list.replace("sections", 0, { heading: "Updated", blocks: [] })
         */
        replace: (listPath, index, newItem) => {
            const segments = parsePath(listPath);
            applyUpdate(
                (prev) => setAt(prev, [...segments, index], newItem),
                `list.replace("${listPath}", ${index})`
            );
        },

        /**
         * Item-কে deep-clone করে ঠিক পরে insert করো।
         * @param {Path} listPath
         * @param {number} index
         * @example
         * fs.list.duplicate("sections", 1)  // sections[1]-এর clone sections[2] হবে
         */
        duplicate: (listPath, index) => {
            applyUpdate(
                (prev) =>
                    updateArrayAt(prev, listPath, (arr) =>
                        arr.splice(index + 1, 0, deepClone(arr[index]))
                    ),
                `list.duplicate("${listPath}", ${index})`
            );
        },

        /**
         * Item from → to সরাও (drag-drop reorder)।
         * @param {Path} listPath
         * @param {number} fromIndex
         * @param {number} toIndex
         * @example
         * fs.list.move("sections", 3, 0)  // section 3 → শুরুতে
         */
        move: (listPath, fromIndex, toIndex) => {
            applyUpdate(
                (prev) =>
                    updateArrayAt(prev, listPath, (arr) => {
                        const [item] = arr.splice(fromIndex, 1);
                        arr.splice(toIndex, 0, item);
                    }),
                `list.move("${listPath}", ${fromIndex} → ${toIndex})`
            );
        },

        /**
         * দুটো item swap করো।
         * @param {Path} listPath
         * @param {number} indexA
         * @param {number} indexB
         * @example
         * fs.list.swap("tags", 0, 1)
         */
        swap: (listPath, indexA, indexB) => {
            applyUpdate(
                (prev) =>
                    updateArrayAt(prev, listPath, (arr) => {
                        [arr[indexA], arr[indexB]] = [arr[indexB], arr[indexA]];
                    }),
                `list.swap("${listPath}", ${indexA}, ${indexB})`
            );
        },

        /**
         * Drag-drop reorder-এর semantic alias (move-এর মতোই কাজ করে)।
         * @param {Path} listPath
         * @param {number} fromIndex
         * @param {number} toIndex
         * @example
         * function handleDragEnd({ active, over }) {
         *   const from = items.findIndex(i => i.id === active.id);
         *   const to   = items.findIndex(i => i.id === over.id);
         *   fs.list.reorder("faqItems", from, to);
         *   fs.list.normalizeOrder("faqItems", "sortOrder");
         * }
         */
        reorder: (listPath, fromIndex, toIndex) => {
            applyUpdate(
                (prev) =>
                    updateArrayAt(prev, listPath, (arr) => {
                        const [item] = arr.splice(fromIndex, 1);
                        arr.splice(toIndex, 0, item);
                    }),
                `list.reorder("${listPath}", ${fromIndex} → ${toIndex})`
            );
        },

        /**
         * Field দিয়ে sort করো।
         * @param {Path} listPath
         * @param {string | null} [sortKey=null] - কোন field দিয়ে sort (null = primitive array)
         * @param {SortDirection} [direction="asc"]
         * @example
         * fs.list.sort("faqItems", "sortOrder")
         * fs.list.sort("products", "title", "desc")
         * fs.list.sort("tags", null, "asc")  // primitive array
         */
        sort: (listPath, sortKey = null, direction = "asc") => {
            applyUpdate(
                (prev) =>
                    updateArrayAt(prev, listPath, (arr) => {
                        arr.sort((a, b) => {
                            const av = sortKey != null ? a?.[sortKey] : a;
                            const bv = sortKey != null ? b?.[sortKey] : b;

                            if (av == null && bv == null) return 0;
                            if (av == null) return 1;
                            if (bv == null) return -1;

                            let cmp = 0;
                            if (typeof av === "number" && typeof bv === "number") {
                                cmp = av - bv;
                            } else if (typeof av === "boolean" && typeof bv === "boolean") {
                                cmp = av === bv ? 0 : av ? 1 : -1;
                            } else {
                                const da = new Date(av), db = new Date(bv);
                                if (
                                    !isNaN(da) && !isNaN(db) &&
                                    typeof av === "string" && typeof bv === "string"
                                ) {
                                    cmp = da.getTime() - db.getTime();
                                } else {
                                    cmp = String(av).localeCompare(String(bv), undefined, {
                                        sensitivity: "base",
                                    });
                                }
                            }
                            return direction === "desc" ? -cmp : cmp;
                        });
                    }),
                `list.sort("${listPath}", "${sortKey}", "${direction}")`
            );
        },

        /**
         * Reorder বা sort-এর পর order field গুলো 0,1,2… re-stamp করো।
         * @param {Path} listPath
         * @param {string} orderField - প্রতি item-এর কোন field update হবে
         * @param {{ startAt?: number }} [options]
         * @example
         * fs.list.reorder("faqItems", from, to);
         * fs.list.normalizeOrder("faqItems", "sortOrder");
         * // faqItems[0].sortOrder === 0, faqItems[1].sortOrder === 1, …
         */
        normalizeOrder: (listPath, orderField, { startAt = 0 } = {}) => {
            applyUpdate(
                (prev) =>
                    updateArrayAt(prev, listPath, (arr) => {
                        arr.forEach((item, i) => {
                            if (item && typeof item === "object") {
                                item[orderField] = startAt + i;
                            }
                        });
                    }),
                `list.normalizeOrder("${listPath}", "${orderField}")`
            );
        },

        /**
         * Condition match করা items রাখো, বাকি সরিয়ে দাও।
         * @param {Path} listPath
         * @param {function(*): boolean} predicate
         * @example
         * fs.list.filter("tags", tag => tag.active)           // inactive বাদ
         * fs.list.filter("sections", s => s.type !== "empty") // empty বাদ
         */
        filter: (listPath, predicate) => {
            applyUpdate(
                (prev) => {
                    const currentArr = getAt(prev, listPath) ?? [];
                    return setAt(prev, listPath, currentArr.filter(predicate));
                },
                `list.filter("${listPath}")`
            );
        },

        /**
         * Condition match করা সব item-এ patch apply করো।
         * @param {Path} listPath
         * @param {function(*): boolean} predicate
         * @param {Object} patch - merge করার fields
         * @example
         * // id match করা item-এর heading update করো
         * fs.list.updateWhere("sections", s => s.id === "abc", { heading: "New" });
         *
         * // সব active tag-এর color বদলাও
         * fs.list.updateWhere("tags", t => t.active, { color: "green" });
         */
        updateWhere: (listPath, predicate, patch) => {
            applyUpdate(
                (prev) => {
                    const currentArr = getAt(prev, listPath) ?? [];
                    const updated = currentArr.map((item) =>
                        predicate(item) ? { ...item, ...patch } : item
                    );
                    return setAt(prev, listPath, updated);
                },
                `list.updateWhere("${listPath}")`
            );
        },

        /**
         * Condition দিয়ে item খোঁজো।
         * @param {Path} listPath
         * @param {function(*): boolean} predicate
         * @returns {* | undefined}
         * @example
         * const section = fs.list.find("sections", s => s.id === "abc");
         */
        find: (listPath, predicate) => {
            const currentArr = getAt(latestValuesRef.current, listPath) ?? [];
            return currentArr.find(predicate);
        },

        /**
         * Condition দিয়ে item-এর index খোঁজো।
         * @param {Path} listPath
         * @param {function(*): boolean} predicate
         * @returns {number} index অথবা -1
         * @example
         * const idx = fs.list.findIndex("sections", s => s.id === "abc");
         * fs.list.remove("sections", idx);
         */
        findIndex: (listPath, predicate) => {
            const currentArr = getAt(latestValuesRef.current, listPath) ?? [];
            return currentArr.findIndex(predicate);
        },

        /**
         * পুরো array replace করো।
         * @param {Path} listPath
         * @param {Array} newArray
         * @example
         * fs.list.set("tags", [{ name: "New", color: "red" }])
         */
        set: (listPath, newArray) => {
            applyUpdate(
                (prev) => setAt(prev, listPath, newArray),
                `list.set("${listPath}")`
            );
        },

        /**
         * Array empty করো।
         * @param {Path} listPath
         * @example
         * fs.list.clear("tags")
         * fs.list.clear("sections.0.blocks")
         */
        clear: (listPath) => {
            applyUpdate(
                (prev) => setAt(prev, listPath, []),
                `list.clear("${listPath}")`
            );
        },

        /**
         * List row-এর জন্য সব helper একসাথে পাও।
         * Row component-এ spread করো।
         * @param {Path} listPath
         * @param {number} index
         * @returns {{
         *   value: Object,
         *   index: number,
         *   isFirst: boolean,
         *   isLast: boolean,
         *   isDirty: boolean,
         *   setField: function,
         *   replace: function,
         *   remove: function,
         *   duplicate: function,
         *   moveUp: function,
         *   moveDown: function,
         * }}
         * @example
         * {fs.values.sections.map((section, i) => (
         *   <SectionRow key={section.id} {...fs.list.bindItem("sections", i)} />
         * ))}
         *
         * // SectionRow ভেতরে:
         * function SectionRow({ value, index, isFirst, isLast, setField, remove, moveUp }) {
         *   return (
         *     <div>
         *       <TextField
         *         value={value.heading}
         *         onChange={v => setField("heading", v)}
         *       />
         *       <Button onClick={remove} disabled={isFirst && isLast}>Remove</Button>
         *       <Button onClick={moveUp} disabled={isFirst}>↑</Button>
         *     </div>
         *   );
         * }
         */
        bindItem: (listPath, index) => {
            const currentArr = getAt(latestValuesRef.current, listPath) ?? [];
            const item = currentArr[index];
            const snapshotArr = getAt(savedSnapshotRef.current, listPath) ?? [];
            const isItemDirty = !deepEqual(item, snapshotArr[index]);

            return {
                value: item,
                index,
                isFirst: index === 0,
                isLast: index === currentArr.length - 1,
                isDirty: isItemDirty,
                setField: (fieldName, value) => {
                    const segments = parsePath(listPath);
                    applyUpdate(
                        (prev) => setAt(prev, [...segments, index, fieldName], value),
                        `list.bindItem("${listPath}", ${index}).setField("${fieldName}")`
                    );
                },
                replace: (newItem) => {
                    const segments = parsePath(listPath);
                    applyUpdate(
                        (prev) => setAt(prev, [...segments, index], newItem),
                        `list.bindItem("${listPath}", ${index}).replace`
                    );
                },
                remove: () => {
                    applyUpdate(
                        (prev) => updateArrayAt(prev, listPath, (arr) => arr.splice(index, 1)),
                        `list.bindItem("${listPath}", ${index}).remove`
                    );
                },
                duplicate: () => {
                    applyUpdate(
                        (prev) =>
                            updateArrayAt(prev, listPath, (arr) =>
                                arr.splice(index + 1, 0, deepClone(arr[index]))
                            ),
                        `list.bindItem("${listPath}", ${index}).duplicate`
                    );
                },
                moveUp: () => {
                    if (index === 0) return;
                    applyUpdate(
                        (prev) =>
                            updateArrayAt(prev, listPath, (arr) => {
                                const [item] = arr.splice(index, 1);
                                arr.splice(index - 1, 0, item);
                            }),
                        `list.bindItem("${listPath}", ${index}).moveUp`
                    );
                },
                moveDown: () => {
                    if (index === currentArr.length - 1) return;
                    applyUpdate(
                        (prev) =>
                            updateArrayAt(prev, listPath, (arr) => {
                                const [item] = arr.splice(index, 1);
                                arr.splice(index + 1, 0, item);
                            }),
                        `list.bindItem("${listPath}", ${index}).moveDown`
                    );
                },
            };
        },
    }), [applyUpdate, values]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ fs.object — dynamic object key management
     * ────────────────────────────────────────────────────────────────────────── */

    const object = useMemo(() => ({
        /**
         * Object-এ dynamic key set বা update করো।
         * @param {Path} parentPath - parent object-এর path
         * @param {string} key
         * @param {*} value
         * @example
         * fs.object.setKey("socialLinks", "tiktok", "https://tiktok.com/@me")
         * fs.object.setKey("metadata", "color", "#FF0000")
         */
        setKey: (parentPath, key, value) => {
            const segments = parsePath(parentPath);
            applyUpdate(
                (prev) => setAt(prev, [...segments, key], value),
                `object.setKey("${parentPath}", "${key}")`
            );
        },

        /**
         * Object থেকে dynamic key delete করো।
         * @param {Path} parentPath
         * @param {string} key
         * @example
         * fs.object.deleteKey("socialLinks", "twitter")
         */
        deleteKey: (parentPath, key) => {
            const segments = parsePath(parentPath);
            applyUpdate(
                (prev) => deleteAt(prev, [...segments, key]),
                `object.deleteKey("${parentPath}", "${key}")`
            );
        },

        /**
         * যেকোনো depth-এ একটা field বা array index delete করো।
         * @param {Path} path
         * @example
         * fs.object.removeField("address.geo.lat")
         * fs.object.removeField("sections.0.blocks.2")
         */
        removeField: (path) => {
            applyUpdate(
                (prev) => deleteAt(prev, path),
                `object.removeField("${path}")`
            );
        },
    }), [applyUpdate]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ fs.media — file upload + existing media management
     * ────────────────────────────────────────────────────────────────────────── */

    const media = useMemo(() => ({
        /**
         * Staged files — slot name দিয়ে indexed।
         * onSubmit-এ pendingFiles হিসেবে পাবে।
         * @type {{ [slotName: string]: File[] }}
         */
        pendingFiles,

        /**
         * Remove করা existing media keys।
         * onSubmit-এ removedKeys হিসেবে পাবে — DB-তে null করতে ব্যবহার করো।
         * @type {{ [urlFieldPath: string]: true }}
         */
        removedKeys,

        /**
         * ImagePickerField-এর জন্য setter factory।
         * Return করা function-টা setValue prop-এ দাও।
         * @param {string} slotName
         * @returns {function(File[]): void}
         * @example
         * <ImagePickerField
         *   value={fs.media.pendingFiles["avatar"] ?? []}
         *   setValue={fs.media.setterFor("avatar")}
         * />
         */
        setterFor: (slotName) => (fileList) => {
            log(`media.setterFor("${slotName}")`, fileList);
            setPendingFiles((prev) => ({ ...prev, [slotName]: fileList }));
        },

        /**
         * Directly file set করো (programmatic use)।
         * @param {string} slotName
         * @param {File[]} fileList
         * @example
         * fs.media.setFile("avatar", [selectedFile])
         * fs.media.setFile("sections.0.image", [file])  // path-based
         */
        setFile: (slotName, fileList) => {
            log(`media.setFile("${slotName}")`, fileList);
            setPendingFiles((prev) => ({ ...prev, [slotName]: fileList }));
        },

        /**
         * Slot-এর pending files পাও।
         * @param {string} slotName
         * @returns {File[]}
         * @example
         * const files = fs.media.getFiles("avatar");
         * if (files[0]) { ... }
         */
        getFiles: (slotName) => pendingFiles[slotName] ?? [],

        /**
         * Slot-এ file আছে কিনা।
         * @param {string} slotName
         * @returns {boolean}
         * @example
         * if (fs.media.hasFile("avatar")) { ... }
         */
        hasFile: (slotName) => !!(pendingFiles[slotName]?.length),

        /**
         * Slot-এর staged files clear করো।
         * @param {string} slotName
         * @example
         * fs.media.clearFiles("avatar")
         */
        clearFiles: (slotName) => {
            log(`media.clearFiles("${slotName}")`);
            setPendingFiles((prev) => ({ ...prev, [slotName]: [] }));
        },

        /**
         * Existing media remove করো।
         * Form-এ URL field clear হয়, removedKeys-এ flag set হয়।
         * onSubmit-এ removedKeys দেখে DB-তে null করো।
         * @param {Path} urlFieldPath - form-এ URL store হওয়া field-এর path
         * @example
         * <ImagePickerField
         *   previewUrl={fs.values.avatarUrl}
         *   onRemove={() => fs.media.removeExisting("avatarUrl")}
         * />
         *
         * // Nested:
         * fs.media.removeExisting("sections.0.imageUrl")
         */
        removeExisting: (urlFieldPath) => {
            const key = toPathKey(urlFieldPath);
            log(`media.removeExisting("${key}")`);
            applyUpdate(
                (prev) => setAt(prev, urlFieldPath, ""),
                `media.removeExisting("${key}")`
            );
            setRemovedKeys((prev) => ({ ...prev, [key]: true }));
        },

        /**
         * removeExisting undo করো। Snapshot থেকে URL restore হয়, flag clear হয়।
         * @param {Path} urlFieldPath
         * @example
         * fs.media.undoRemove("avatarUrl")
         */
        undoRemove: (urlFieldPath) => {
            const key = toPathKey(urlFieldPath);
            const restored = getAt(savedSnapshotRef.current, urlFieldPath) ?? "";
            log(`media.undoRemove("${key}")`, restored);
            applyUpdate(
                (prev) => setAt(prev, urlFieldPath, restored),
                `media.undoRemove("${key}")`
            );
            setRemovedKeys((prev) => {
                const { [key]: _, ...rest } = prev;
                return rest;
            });
        },

        /**
         * এই URL field remove করা হয়েছে কিনা।
         * @param {Path} urlFieldPath
         * @returns {boolean}
         * @example
         * {fs.media.hasRemoved("avatarUrl") && (
         *   <Button onClick={() => fs.media.undoRemove("avatarUrl")}>Undo</Button>
         * )}
         */
        hasRemoved: (urlFieldPath) => !!removedKeys[toPathKey(urlFieldPath)],
    }), [pendingFiles, removedKeys, applyUpdate, log]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ fs.snapshot — saved baseline read
     * ────────────────────────────────────────────────────────────────────────── */

    const snapshot = useMemo(() => ({
        /**
         * Saved snapshot থেকে একটা field read করো।
         * "Revert this field" UI বানাতে কাজে লাগে।
         * @param {Path} path
         * @returns {*}
         * @example
         * const originalTitle = fs.snapshot.get("title");
         * <Button onClick={() => fs.set("title", originalTitle)}>Revert</Button>
         */
        get: (path) => getAt(savedSnapshotRef.current, path),

        /**
         * পুরো saved snapshot পাও।
         * @returns {Object}
         */
        getAll: () => savedSnapshotRef.current,

        /** Snapshot থেকে current values আলাদা কিনা (isDirty-র alias)। */
        get isDirty() { return isDirty; },
    }), [isDirty]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ fs.history — undo/redo (historyLimit > 0 হলে active)
     * ────────────────────────────────────────────────────────────────────────── */

    const historyApi = useMemo(() => ({
        /**
         * আগের state-এ ফিরে যাও।
         * @example
         * <Button onClick={fs.history.undo} disabled={!fs.history.canUndo}>Undo</Button>
         */
        undo: () => {
            if (history.length === 0) return;
            const [prev, ...rest] = history;
            setFuture((f) => [latestValuesRef.current, ...f]);
            setValues(prev);
            setHistory(rest);
            log("history.undo", prev);
        },

        /**
         * Undo-র পরে forward আসো।
         * @example
         * <Button onClick={fs.history.redo} disabled={!fs.history.canRedo}>Redo</Button>
         */
        redo: () => {
            if (future.length === 0) return;
            const [next, ...rest] = future;
            setHistory((h) => [latestValuesRef.current, ...h]);
            setValues(next);
            setFuture(rest);
            log("history.redo", next);
        },

        /** Undo করা যাবে কিনা। @type {boolean} */
        canUndo: history.length > 0,

        /** Redo করা যাবে কিনা। @type {boolean} */
        canRedo: future.length > 0,

        /** History ও future stack দুটোই clear করো। */
        clear: () => {
            setHistory([]);
            setFuture([]);
            log("history.clear");
        },

        /** History-তে কতটা step আছে। @type {number} */
        steps: history.length,
    }), [history, future, log]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ fs.validate — manual validation trigger
     * ────────────────────────────────────────────────────────────────────────── */

    const validate = useMemo(() => ({
        /**
         * পুরো form validate করো এবং result return করো।
         * @returns {boolean} true = valid
         * @example
         * const isValid = fs.validate.now();
         * if (isValid) { ... }
         */
        now: () => {
            const errors = runValidationPure(latestValuesRef.current);
            setFieldErrors(errors);
            setHasValidated(true);
            log("validate.now", errors);
            return Object.keys(errors).length === 0;
        },

        /**
         * একটা field validate করো।
         * onBlur-এ দেরিতে error দেখাতে কাজে লাগে।
         * @param {Path} path
         * @returns {string | null} error message অথবা null
         * @example
         * <TextField onBlur={() => fs.validate.field("email")} />
         */
        field: (path) => {
            const errors = runValidationPure(latestValuesRef.current);
            const key = toPathKey(path);
            const message = errors[key] ?? null;
            if (message) {
                setFieldErrors((prev) => ({ ...prev, [key]: message }));
            } else {
                setFieldErrors((prev) => {
                    if (!prev[key]) return prev;
                    const { [key]: _, ...rest } = prev;
                    return rest;
                });
            }
            setHasValidated(true);
            return message;
        },
    }), [runValidationPure, log]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ SUBMIT / RESET / SYNC
     * ────────────────────────────────────────────────────────────────────────── */

    /**
     * Validate করো, pass হলে onSubmit run করো।
     * Fail হলে সব field touched হয়ে যায় — error visible হয়।
     * @returns {Promise<boolean>} true = onSubmit ran successfully
     * @example
     * <Button onClick={fs.submit}>Save</Button>
     */
    const submit = useCallback(async () => {
        setSubmitCount((c) => c + 1);
        const currentValues = latestValuesRef.current;
        const errors = runValidationPure(currentValues);
        setFieldErrors(errors);
        setHasValidated(true);
        log("submit — validation", errors);

        if (Object.keys(errors).length > 0) {
            touchAllFields();
            return false;
        }

        const handler = onSubmitRef.current;
        if (!handler) return true;

        try {
            setIsSubmitting(true);
            await handler(currentValues, { pendingFiles, removedKeys });
            log("submit — success");
            return true;
        } finally {
            setIsSubmitting(false);
        }
    }, [pendingFiles, removedKeys, runValidationPure, touchAllFields, log]);

    /**
     * সব unsaved change discard করো — snapshot-এ revert হয়।
     * Pending files, removed flags, errors, touched state সব clear হয়।
     * @example
     * <Button onClick={fs.reset} disabled={!fs.isDirty}>Discard</Button>
     */
    const reset = useCallback(() => {
        log("reset");
        setValues(savedSnapshotRef.current);
        setPendingFiles({});
        setRemovedKeys({});
        setFieldErrors({});
        setTouchedFields({});
        setSubmitCount(0);
        setHasValidated(false);
        setHistory([]);
        setFuture([]);
    }, [log]);

    /**
     * Successful save-এর পর call করো।
     * Snapshot fresh server data দিয়ে update হয়, isDirty = false হয়।
     * @param {Object} freshServerData - server-এর latest data
     * @example
     * // fetcher.data বদলালে sync করো
     * useEffect(() => {
     *   if (fetcher.data?.product) {
     *     fs.syncAfterSave(fetcher.data.product);
     *   }
     * }, [fetcher.data]);
     */
    const syncAfterSave = useCallback((freshServerData) => {
        const freshShape = buildFormShapeRef.current(freshServerData);
        log("syncAfterSave", freshShape);
        setSavedSnapshot(freshShape);
        setValues(freshShape);
        setPendingFiles({});
        setRemovedKeys({});
        setFieldErrors({});
        setTouchedFields({});
        setSubmitCount(0);
        setHasValidated(false);
        setHistory([]);
        setFuture([]);
    }, [log]);

    /* ──────────────────────────────────────────────────────────────────────────
     * ███ RETURN
     * ────────────────────────────────────────────────────────────────────────── */

    return {
        /* ═══════════════════════════════════════════════════════════════════
         * CORE STATE
         * ═══════════════════════════════════════════════════════════════════ */

        /**
         * Live form values — সব edit এখানে reflect হয়।
         * জুধু read করো, update করতে fs.set() use করো।
         * @type {Object}
         * @example
         * <TextField value={fs.values.title} />
         * <p>{fs.values.address.city}</p>
         * {fs.values.sections.map((s, i) => <div key={i}>{s.heading}</div>)}
         */
        values,

        /**
         * true যদি form, snapshot থেকে আলাদা হয় অথবা pending file/removed media থাকে।
         * Save/Discard button disable করতে use করো।
         * @type {boolean}
         * @example
         * <Button disabled={!fs.isDirty}>Save</Button>
         * <Button disabled={!fs.isDirty} onClick={fs.reset}>Discard</Button>
         */
        isDirty,

        /**
         * true যখন onSubmit handler await করছে।
         * Button loading state দেখাতে use করো।
         * @type {boolean}
         * @example
         * <Button loading={fs.isSubmitting} onClick={fs.submit}>
         *   {fs.isSubmitting ? "Saving…" : "Save"}
         * </Button>
         */
        isSubmitting,

        /**
         * true শুধু যদি অন্তত একবার validation run হয়েছে এবং কোনো error নেই।
         * Validation run-এর আগে সবসময় false — false positive এড়ায়।
         * @type {boolean}
         * @example
         * <Button disabled={!fs.isValid} onClick={fs.submit}>Publish</Button>
         * {fs.isValid && <Badge>Ready to save</Badge>}
         */
        isValid,

        /**
         * কতবার submit() call হয়েছে।
         * 0 মানে এখনো কোনো submit attempt হয়নি।
         * Error visibility logic-এ কাজে লাগে।
         * @type {number}
         * @example
         * // প্রথম submit-এর আগে error দেখাবে না
         * const showErrors = fs.submitCount > 0;
         */
        submitCount,

        /**
         * true যদি অন্তত একবার validation run হয়েছে।
         * (validateNow, submit, বা validateOnChange যেকোনোটাতে)
         * @type {boolean}
         * @example
         * {fs.hasValidated && <Banner>Form checked</Banner>}
         */
        hasValidated,

        /**
         * Changed leaf field-এর map — { "dot.path": true }।
         * Section বা row-level dirty count করতে কাজে লাগে।
         * @type {Record<string, true>}
         * @example
         * // কোন fields বদলেছে দেখো
         * console.log(fs.dirtyFields); // { "title": true, "address.city": true }
         *
         * // Section-এর কতটা field dirty
         * const count = sectionFields.filter(f => fs.dirtyFields[`section.${f}`]).length;
         */
        dirtyFields: dirtyFieldsMap,

        /**
         * সব field-এর current error map — { "dot.path": "error message" }।
         * Custom error UI বানাতে বা server error inject করতে কাজে লাগে।
         * সাধারণ use-এ fs.field.error() use করো — সেটা touch/submit check করে।
         * @type {Record<string, string>}
         * @example
         * // সব error একসাথে দেখো (debug বা summary UI)
         * Object.entries(fs.fieldErrors).forEach(([path, msg]) => console.log(path, msg));
         *
         * // Server থেকে আসা errors bulk inject করো
         * useEffect(() => {
         *   if (actionData?.errors) {
         *     Object.entries(actionData.errors).forEach(([path, msg]) =>
         *       fs.field.setError(path, msg)
         *     );
         *   }
         * }, [actionData]);
         */
        fieldErrors,

        /**
         * User যে fields touch করেছে তার map — { "dot.path": true }।
         * Custom touched-based UI বানাতে কাজে লাগে।
         * সাধারণ use-এ fs.field.isTouched() use করো।
         * @type {Record<string, true>}
         * @example
         * // কোন fields user interact করেছে
         * console.log(fs.touchedFields); // { "title": true, "email": true }
         *
         * // Custom touched indicator
         * {fs.touchedFields["title"] && <span>Edited</span>}
         */
        touchedFields,

        /* ═══════════════════════════════════════════════════════════════════
         * GENERAL VALUE OPS
         * ═══════════════════════════════════════════════════════════════════ */

        /**
         * যেকোনো depth-এ value set করো।
         * @type {function(path: Path, value: *): void}
         * @example
         * fs.set("title", "Hello World")
         * fs.set("isActive", true)
         * fs.set("price", 99.99)
         * fs.set("address.city", "Dhaka")
         * fs.set("sections.0.heading", "Introduction")
         * fs.set("sections.0.blocks.2.content", "Updated text")
         */
        set,

        /**
         * Live form থেকে যেকোনো depth-এ value read করো।
         * @type {function(path: Path): *}
         * @example
         * const title = fs.get("title")
         * const city  = fs.get("address.city")
         * const block = fs.get("sections.0.blocks.2")
         */
        get,

        /**
         * একটা render-এ multiple fields batch update করো।
         * প্রতিটা আলাদা set() call করলে multiple re-render হয় — setMany একটা render-এ করে।
         * @type {function(pairs: Array<[Path, *]>): void}
         * @example
         * // title বদলালে slug auto-sync করো
         * fs.setMany([
         *   ["title", "New Title"],
         *   ["slug", "new-title"],
         *   ["seo.title", "New Title — My Store"],
         * ])
         */
        setMany,

        /**
         * Path-এ partial object shallow-merge করো।
         * Path না দিলে root-এ merge হয়।
         * @type {function(patch: Object, path?: Path): void}
         * @example
         * // Nested object partially update করো
         * fs.merge({ city: "Dhaka", zip: "1000" }, "address")
         *
         * // Root-এ merge (multiple top-level fields একসাথে)
         * fs.merge({ title: "Hello", isActive: true })
         */
        merge,

        /* ═══════════════════════════════════════════════════════════════════
         * NAMESPACES
         * ═══════════════════════════════════════════════════════════════════ */

        /**
         * Per-field operations।
         *
         * fs.field.bind(path)            → TextField-এর সব props একসাথে
         * fs.field.bindCheckbox(path)    → Checkbox-এর সব props
         * fs.field.bindNumber(path)      → Number input-এর সব props
         * fs.field.error(path)           → error message (touched হলে দেখায়)
         * fs.field.isDirty(path)         → এই field dirty কিনা
         * fs.field.isTouched(path)       → এই field touch হয়েছে কিনা
         * fs.field.touch(path)           → touched mark করো (onBlur-এ)
         * fs.field.untouch(path)         → touched mark সরাও
         * fs.field.touchAll()            → সব leaf touched করো
         * fs.field.setError(path, msg)   → server error set করো
         * fs.field.clearError(path)      → একটা error clear করো
         * fs.field.clearAllErrors()      → সব error clear করো
         * fs.field.toggle(path)          → boolean flip করো
         * fs.field.increment(path, step) → number বাড়াও
         * fs.field.decrement(path, step) → number কমাও
         * fs.field.compute(path, fn, deps) → derived field auto-update
         * fs.field.watch(path, callback)   → change-এ side effect
         * fs.field.dirtyMap              → { "path": true } সব dirty field
         *
         * @example
         * // সবচেয়ে common use — একটা line-এ field bind করো
         * <TextField label="Title" {...fs.field.bind("title")} />
         * <TextField label="City"  {...fs.field.bind("address.city")} />
         * <Checkbox  label="Active" {...fs.field.bindCheckbox("isActive")} />
         * <TextField label="Price" type="number" {...fs.field.bindNumber("price")} />
         *
         * // Boolean toggle
         * <Button onClick={() => fs.field.toggle("isActive")}>Toggle</Button>
         *
         * // Stock management
         * <Button onClick={() => fs.field.increment("stock")}>+</Button>
         * <Button onClick={() => fs.field.decrement("stock")}>-</Button>
         *
         * // Title থেকে slug auto-generate (component top-level-এ call করো)
         * fs.field.compute("slug", v => v.title.toLowerCase().replace(/\s+/g, "-"), ["title"])
         *
         * // Type বদলালে related fields reset (component top-level-এ)
         * fs.field.watch("type", (next, prev) => {
         *   if (next !== prev) fs.set("content", "")
         * })
         */
        field,

        /**
         * Array operations — যেকোনো depth-এ।
         *
         * fs.list.append(path, item)              → শেষে add
         * fs.list.prepend(path, item)             → শুরুতে add
         * fs.list.insert(path, index, item)       → index-এ insert
         * fs.list.remove(path, index)             → index দিয়ে remove
         * fs.list.setField(path, i, field, value) → একটা field update
         * fs.list.replace(path, index, item)      → পুরো item replace
         * fs.list.duplicate(path, index)          → clone করে পরে বসাও
         * fs.list.move(path, from, to)            → reposition
         * fs.list.swap(path, i, j)                → দুটো swap
         * fs.list.reorder(path, from, to)         → drag-drop alias of move
         * fs.list.sort(path, field, direction)    → field দিয়ে sort
         * fs.list.normalizeOrder(path, field)     → 0,1,2… re-stamp
         * fs.list.filter(path, predicate)         → condition-এ filter
         * fs.list.updateWhere(path, pred, patch)  → condition-এ bulk update
         * fs.list.find(path, predicate)           → item খোঁজো
         * fs.list.findIndex(path, predicate)      → index খোঁজো
         * fs.list.set(path, array)                → পুরো array replace
         * fs.list.clear(path)                     → [] করে দাও
         * fs.list.bindItem(path, index)           → row-এর সব helper একসাথে
         *
         * @example
         * // Section add/remove
         * fs.list.append("sections", { heading: "", blocks: [] })
         * fs.list.remove("sections", 1)
         *
         * // Nested array (section-এর ভেতরে block)
         * fs.list.append("sections.0.blocks", { type: "text", content: "" })
         * fs.list.remove("sections.0.blocks", 2)
         *
         * // Row-এর একটা field update
         * fs.list.setField("sections", 0, "heading", "Introduction")
         *
         * // Drag-drop reorder
         * fs.list.reorder("faqItems", fromIndex, toIndex)
         * fs.list.normalizeOrder("faqItems", "sortOrder")
         *
         * // Row component-এ bind করো
         * {fs.values.sections.map((s, i) => (
         *   <SectionRow key={s.id} {...fs.list.bindItem("sections", i)} />
         * ))}
         */
        list,

        /**
         * Dynamic object key management।
         *
         * fs.object.setKey(parentPath, key, value) → key add বা update
         * fs.object.deleteKey(parentPath, key)      → key delete
         * fs.object.removeField(path)               → যেকোনো depth-এ field delete
         *
         * @example
         * // Dynamic social links manage করো
         * fs.object.setKey("socialLinks", "tiktok", "https://tiktok.com/@me")
         * fs.object.setKey("socialLinks", "instagram", "https://instagram.com/me")
         * fs.object.deleteKey("socialLinks", "twitter")
         *
         * // Nested field delete করো
         * fs.object.removeField("address.geo.lat")
         * fs.object.removeField("sections.0.blocks.2")
         */
        object,

        /**
         * File upload এবং existing media management।
         *
         * fs.media.pendingFiles              → { slotName: File[] } staged files
         * fs.media.removedKeys               → { urlFieldPath: true } removed flags
         * fs.media.setterFor(slot)           → ImagePicker setter factory
         * fs.media.setFile(slot, files)      → programmatically file set
         * fs.media.getFiles(slot)            → File[] পাও
         * fs.media.hasFile(slot)             → file আছে কিনা
         * fs.media.clearFiles(slot)          → staged files discard
         * fs.media.removeExisting(urlPath)   → preview clear + DB null flag
         * fs.media.undoRemove(urlPath)       → snapshot থেকে restore
         * fs.media.hasRemoved(urlPath)       → remove করা হয়েছে কিনা
         *
         * @example
         * // Simple image upload
         * <ImagePickerField
         *   value={fs.media.pendingFiles["avatar"] ?? []}
         *   setValue={fs.media.setterFor("avatar")}
         *   previewUrl={fs.values.avatarUrl}
         *   onRemove={() => fs.media.removeExisting("avatarUrl")}
         * />
         *
         * // Undo remove button
         * {fs.media.hasRemoved("avatarUrl") && (
         *   <Button onClick={() => fs.media.undoRemove("avatarUrl")}>Undo</Button>
         * )}
         *
         * // List item-এর ভেতরে image (path-based)
         * <ImagePickerField
         *   value={fs.media.pendingFiles["sections.0.image"] ?? []}
         *   setValue={fs.media.setterFor("sections.0.image")}
         *   previewUrl={fs.values.sections[0].imageUrl}
         *   onRemove={() => fs.media.removeExisting("sections.0.imageUrl")}
         * />
         *
         * // onSubmit-এ files handle করো
         * onSubmit: async (values, { pendingFiles, removedKeys }) => {
         *   const fd = new FormData()
         *   fd.append("data", JSON.stringify(values))
         *   fd.append("removedMedia", JSON.stringify(removedKeys))
         *   if (pendingFiles["avatar"]?.[0]) fd.append("avatar", pendingFiles["avatar"][0])
         *   fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" })
         * }
         */
        media,

        /**
         * Saved baseline (snapshot) read করো।
         *
         * fs.snapshot.get(path)  → একটা field-এর saved value
         * fs.snapshot.getAll()   → পুরো snapshot object
         * fs.snapshot.isDirty    → isDirty-র alias
         *
         * @example
         * // একটা field revert করো
         * const originalTitle = fs.snapshot.get("title")
         * <Button onClick={() => fs.set("title", originalTitle)}>Revert title</Button>
         *
         * // পুরো snapshot দেখো (debug)
         * console.log(fs.snapshot.getAll())
         */
        snapshot,

        /**
         * Undo/redo — historyLimit > 0 হলে active।
         * options-এ historyLimit: 50 দিলে enable হবে।
         *
         * fs.history.undo()    → আগের state
         * fs.history.redo()    → undo-র পরে forward
         * fs.history.canUndo   → boolean
         * fs.history.canRedo   → boolean
         * fs.history.clear()   → history wipe
         * fs.history.steps     → কতটা step আছে
         *
         * @example
         * // Enable করো
         * const fs = useFormState(data, buildShape, { historyLimit: 50 })
         *
         * // Undo/Redo buttons
         * <Button onClick={fs.history.undo} disabled={!fs.history.canUndo}>↩ Undo</Button>
         * <Button onClick={fs.history.redo} disabled={!fs.history.canRedo}>↪ Redo</Button>
         */
        history: historyApi,

        /**
         * Manual validation trigger।
         *
         * fs.validate.now()       → পুরো form validate করো → boolean
         * fs.validate.field(path) → একটা field validate করো → string | null
         *
         * @example
         * // Save-এর আগে manually check করো
         * const isValid = fs.validate.now()
         * if (!isValid) return
         *
         * // onBlur-এ single field validate করো
         * <TextField
         *   onBlur={() => fs.validate.field("email")}
         *   error={fs.field.error("email")}
         * />
         */
        validate,

        /* ═══════════════════════════════════════════════════════════════════
         * LIFECYCLE
         * ═══════════════════════════════════════════════════════════════════ */

        /**
         * Validate করো, pass হলে onSubmit run করো।
         * Fail হলে সব field touched হয় — সব error visible হয়।
         * @type {function(): Promise<boolean>}
         * @example
         * // Basic
         * <Button onClick={fs.submit}>Save</Button>
         *
         * // Disabled state সহ
         * <Button
         *   disabled={!fs.isDirty || fs.isSubmitting}
         *   loading={fs.isSubmitting}
         *   onClick={fs.submit}
         * >
         *   {fs.isSubmitting ? "Saving…" : "Save"}
         * </Button>
         */
        submit,

        /**
         * সব unsaved change discard করো — snapshot-এ revert হয়।
         * Pending files, removed flags, errors, touched সব clear হয়।
         * @type {function(): void}
         * @example
         * <Button onClick={fs.reset} disabled={!fs.isDirty}>Discard changes</Button>
         */
        reset,

        /**
         * Successful save-এর পর fresh server data দিয়ে snapshot update করো।
         * এরপর isDirty = false হয়।
         * @type {function(freshServerData: Object): void}
         * @example
         * // fetcher response আসলে sync করো
         * useEffect(() => {
         *   if (fetcher.state === "idle" && fetcher.data?.product) {
         *     fs.syncAfterSave(fetcher.data.product)
         *   }
         * }, [fetcher.state, fetcher.data])
         */
        syncAfterSave,
    };
}
