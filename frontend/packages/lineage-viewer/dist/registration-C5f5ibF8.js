//#region src/graph/adjacency.ts
function e(e, t) {
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map();
	for (let t of e) n.set(t.id, t), r.set(t.id, []), i.set(t.id, []);
	for (let e of t) r.get(e.target)?.push(e), i.get(e.source)?.push(e);
	return {
		nodeById: n,
		incomingByNodeId: r,
		outgoingByNodeId: i
	};
}
//#endregion
//#region src/graph/cycle-detection.ts
function t(e, t) {
	let a = n(e), o = n(e), s = /* @__PURE__ */ new Set();
	for (let e of t) a.get(e.source)?.push(e.target), o.get(e.target)?.push(e.source), e.source === e.target && s.add(e.source);
	for (let e of a.values()) e.sort((e, t) => e.localeCompare(t));
	for (let e of o.values()) e.sort((e, t) => e.localeCompare(t));
	let c = r([...e].sort((e, t) => e.localeCompare(t)), a), l = /* @__PURE__ */ new Set(), u = [];
	for (let e of [...c].reverse()) {
		if (l.has(e)) continue;
		let t = i(e, o, l).sort((e, t) => e.localeCompare(t));
		(t.length > 1 || s.has(e)) && u.push(t);
	}
	return u.sort((e, t) => e.join("\0").localeCompare(t.join("\0")));
}
function n(e) {
	return new Map(e.map((e) => [e, []]));
}
function r(e, t) {
	let n = /* @__PURE__ */ new Set(), r = [];
	for (let i of e) {
		if (n.has(i)) continue;
		n.add(i);
		let e = [{
			nodeId: i,
			nextIndex: 0
		}];
		for (; e.length > 0;) {
			let i = e[e.length - 1];
			if (i === void 0) continue;
			let a = t.get(i.nodeId) ?? [];
			if (i.nextIndex < a.length) {
				let t = a[i.nextIndex];
				i.nextIndex += 1, t !== void 0 && !n.has(t) && (n.add(t), e.push({
					nodeId: t,
					nextIndex: 0
				}));
			} else r.push(i.nodeId), e.pop();
		}
	}
	return r;
}
function i(e, t, n) {
	let r = [], i = [e];
	for (n.add(e); i.length > 0;) {
		let e = i.pop();
		if (e !== void 0) {
			r.push(e);
			for (let r of t.get(e) ?? []) n.has(r) || (n.add(r), i.push(r));
		}
	}
	return r;
}
//#endregion
//#region src/schema/diagnostics.ts
var a = {
	error: 0,
	warning: 1,
	info: 2
};
function o(e) {
	return [...e].sort((e, t) => {
		let n = a[e.level] - a[t.level];
		if (n !== 0) return n;
		let r = e.code.localeCompare(t.code);
		if (r !== 0) return r;
		let i = (e.nodeId ?? "").localeCompare(t.nodeId ?? "");
		if (i !== 0) return i;
		let o = (e.edgeId ?? "").localeCompare(t.edgeId ?? "");
		return o === 0 ? e.message.localeCompare(t.message) : o;
	});
}
//#endregion
//#region src/schema/validate.ts
var s = [
	"table",
	"view",
	"field",
	"job",
	"dataset",
	"custom"
], c = [
	"default",
	"success",
	"warning",
	"error",
	"muted"
], l = [
	"lineage",
	"dependency",
	"reference",
	"custom"
], u = [
	"passthrough",
	"rename",
	"transform",
	"aggregate",
	"unknown"
];
function d(e) {
	if (typeof e != "object" || !e || Array.isArray(e)) return !1;
	let t = Reflect.getPrototypeOf(e);
	return t === Object.prototype || t === null;
}
function f(e) {
	return typeof e == "string" && s.includes(e);
}
function p(e) {
	return typeof e == "string" && c.includes(e);
}
function m(e) {
	return typeof e == "string" && l.includes(e);
}
function h(e) {
	return typeof e == "string" && u.includes(e);
}
function g(e) {
	return typeof e == "string" && e.trim().length > 0;
}
function _(e) {
	return d(e) ? e.schemaVersion !== void 0 && e.schemaVersion !== "1.0" ? [v("schemaVersion must be \"1.0\" when provided.")] : Array.isArray(e.nodes) ? Array.isArray(e.edges) ? [] : [v("edges must be an array.")] : [v("nodes must be an array.")] : [v("Input must be a plain object.")];
}
function v(e, t, n) {
	return {
		level: "error",
		code: "INVALID_GRAPH_DATA",
		message: e,
		...t === void 0 ? {} : { nodeId: t },
		...n === void 0 ? {} : { edgeId: n }
	};
}
//#endregion
//#region src/graph/normalize.ts
function y(n, r = {}) {
	let i = _(n);
	if (i.length > 0 || !d(n) || !Array.isArray(n.nodes) || !Array.isArray(n.edges)) return b(null, i);
	let a = [], s = /* @__PURE__ */ new Map();
	for (let e of n.nodes) {
		let t = x(e, a);
		if (t !== null) {
			if (s.has(t.id)) {
				a.push({
					level: "error",
					code: "DUPLICATE_NODE_ID",
					nodeId: t.id,
					message: `Duplicate node id "${t.id}"; first valid occurrence wins.`
				});
				continue;
			}
			s.set(t.id, t);
		}
	}
	let c = /* @__PURE__ */ new Map();
	for (let e of n.edges) {
		let t = w(e, s, a);
		if (t !== null) {
			if (t.source === t.target && r.showSelfLoops !== !0) {
				a.push({
					level: "warning",
					code: "SELF_LOOP_HIDDEN",
					message: `Self-loop at "${t.source}" was hidden.`,
					...t.id === void 0 ? {} : { edgeId: t.id }
				});
				continue;
			}
			if (c.has(t.key)) {
				a.push({
					level: "warning",
					code: "DUPLICATE_EDGE",
					message: `Duplicate edge "${t.key}" was removed; first valid occurrence wins.`,
					...t.id === void 0 ? {} : { edgeId: t.id }
				});
				continue;
			}
			c.set(t.key, t);
		}
	}
	let l = [...s.values()].sort(re), u = [...c.values()].sort(ie);
	l.length === 0 && a.push({
		level: "info",
		code: "EMPTY_GRAPH",
		message: "The graph contains no valid nodes."
	});
	let f = e(l, u), p = t(l.map((e) => e.id), u);
	for (let e of p) a.push({
		level: "warning",
		code: "CYCLE_DETECTED",
		nodeId: e[0] ?? "",
		message: `Cycle detected: ${e.join(", ")}.`
	});
	let m = {
		schemaVersion: "1.0",
		nodes: l,
		edges: u,
		...f,
		cycleGroups: p
	}, h = o(a);
	return h.some((e) => e.level === "error") && r.validationMode === "strict" ? b(null, h) : b(m, h);
}
function b(e, t) {
	let n = o(t);
	return {
		graph: e,
		diagnostics: n,
		hasErrors: n.some((e) => e.level === "error")
	};
}
function x(e, t) {
	if (!d(e)) return t.push(v("A node must be a plain object.")), null;
	let n = T(e.id), r = T(e.label);
	if (n === null || r === null || e.type !== void 0 && !f(e.type) || e.status !== void 0 && !p(e.status) || e.metadata !== void 0 && !d(e.metadata)) return t.push(v("A node has invalid required or typed fields.", n ?? void 0)), null;
	let i = {
		id: n,
		label: r
	};
	te(e, i, "layer"), te(e, i, "subtitle"), e.type !== void 0 && (i.type = e.type), e.status !== void 0 && (i.status = e.status);
	let a = S(e.fields, n, t);
	return a !== void 0 && (i.fields = a), e.metadata !== void 0 && (i.metadata = e.metadata), i;
}
function S(e, t, n) {
	if (e === void 0) return;
	if (!Array.isArray(e)) {
		n.push(v("Node fields must be an array when provided.", t));
		return;
	}
	let r = [], i = /* @__PURE__ */ new Set();
	for (let a of e) {
		let e = C(a, t, n);
		if (e !== null) {
			if (i.has(e.id)) {
				n.push({
					level: "error",
					code: "DUPLICATE_FIELD_ID",
					nodeId: t,
					message: `Duplicate field id "${e.id}" on node "${t}"; first valid occurrence wins.`
				});
				continue;
			}
			i.add(e.id), r.push(e);
		}
	}
	return r;
}
function C(e, t, n) {
	if (!d(e)) return n.push(v("A field must be a plain object.", t)), null;
	let r = T(e.id);
	return r === null || !D(e.label) || !D(e.dataType) || !D(e.description) ? (n.push(v("A field has invalid required or typed fields.", t)), null) : {
		id: r,
		...e.label === void 0 ? {} : { label: e.label },
		...e.dataType === void 0 ? {} : { dataType: e.dataType },
		...e.description === void 0 ? {} : { description: e.description }
	};
}
function w(e, t, n) {
	if (!d(e)) return n.push(v("An edge must be a plain object.")), n.push({
		level: "error",
		code: "MISSING_EDGE_SOURCE",
		message: "Edge source is missing or invalid."
	}), n.push({
		level: "error",
		code: "MISSING_EDGE_TARGET",
		message: "Edge target is missing or invalid."
	}), null;
	let r = T(e.source), i = T(e.target), a = E(e.id), o = e.sourceField !== void 0, s = e.targetField !== void 0, c = E(e.sourceField), l = E(e.targetField), u = o === s, f = a === null || e.label !== void 0 && typeof e.label != "string" || e.type !== void 0 && !m(e.type) || e.transformType !== void 0 && !h(e.transformType) || e.expression !== void 0 && typeof e.expression != "string" || e.metadata !== void 0 && !d(e.metadata);
	a === null && n.push(v("An edge id must be a non-empty string when provided.")), f && a !== null && n.push(v("An edge has invalid typed fields.", void 0, a)), u || n.push({
		level: "error",
		code: "UNPAIRED_FIELD_REFERENCE",
		message: "sourceField and targetField must either both be provided or both be omitted.",
		...typeof a == "string" ? { edgeId: a } : {}
	});
	let p = r !== null && t.has(r), g = i !== null && t.has(i);
	p || n.push({
		level: "error",
		code: "MISSING_EDGE_SOURCE",
		message: "Edge source is missing, invalid, or does not reference a valid node.",
		...typeof a == "string" ? { edgeId: a } : {}
	}), g || n.push({
		level: "error",
		code: "MISSING_EDGE_TARGET",
		message: "Edge target is missing, invalid, or does not reference a valid node.",
		...typeof a == "string" ? { edgeId: a } : {}
	});
	let _ = !o || typeof c == "string" && p && ee(t.get(r ?? ""), c), y = !s || typeof l == "string" && g && ee(t.get(i ?? ""), l);
	if (u && o && !_ && n.push({
		level: "error",
		code: "MISSING_SOURCE_FIELD",
		message: "Edge sourceField is missing, invalid, or does not reference its source node.",
		...typeof a == "string" ? { edgeId: a } : {}
	}), u && s && !y && n.push({
		level: "error",
		code: "MISSING_TARGET_FIELD",
		message: "Edge targetField is missing, invalid, or does not reference its target node.",
		...typeof a == "string" ? { edgeId: a } : {}
	}), r === null || i === null || f || !p || !g || !u || !_ || !y) return null;
	let b = e.type ?? "lineage", x = e.label ?? "", S = typeof c == "string" ? c : void 0, C = typeof l == "string" ? l : void 0, w = {
		source: r,
		target: i,
		type: b,
		label: x,
		key: ne(r, i, b, x, S, C)
	};
	return a !== void 0 && (w.id = a), S !== void 0 && C !== void 0 && (w.sourceField = S, w.targetField = C), e.transformType !== void 0 && (w.transformType = e.transformType), e.expression !== void 0 && (w.expression = e.expression), e.metadata !== void 0 && (w.metadata = e.metadata), w;
}
function T(e) {
	return g(e) ? e.trim() : null;
}
function E(e) {
	return e === void 0 ? void 0 : T(e);
}
function D(e) {
	return e === void 0 || typeof e == "string";
}
function ee(e, t) {
	return e?.fields?.some((e) => e.id === t) ?? !1;
}
function te(e, t, n) {
	e[n] !== void 0 && typeof e[n] == "string" && (t[n] = e[n]);
}
function ne(e, t, n, r, i, a) {
	return JSON.stringify(i === void 0 || a === void 0 ? [
		e,
		t,
		n,
		r
	] : [
		e,
		t,
		i,
		a,
		n,
		r
	]);
}
function re(e, t) {
	return e.id.localeCompare(t.id);
}
function ie(e, t) {
	return e.source.localeCompare(t.source) || e.target.localeCompare(t.target) || (e.sourceField ?? "").localeCompare(t.sourceField ?? "") || (e.targetField ?? "").localeCompare(t.targetField ?? "") || e.type.localeCompare(t.type) || e.label.localeCompare(t.label) || (e.id ?? "").localeCompare(t.id ?? "");
}
//#endregion
//#region src/graph/traversal.ts
function O(e, t) {
	return se(e, t, "incomingByNodeId", "source");
}
function ae(e, t) {
	return se(e, t, "outgoingByNodeId", "target");
}
function oe(e, t) {
	return [.../* @__PURE__ */ new Set([...O(e, t), ...ae(e, t)])].sort((e, t) => e.localeCompare(t));
}
function se(e, t, n, r) {
	if (!e.nodeById.has(t)) return [];
	let i = /* @__PURE__ */ new Set([t]), a = [t];
	for (; a.length > 0;) {
		let t = a.pop();
		if (t === void 0) continue;
		let o = e[n].get(t) ?? [];
		for (let e of o) {
			let t = e[r];
			i.has(t) || (i.add(t), a.push(t));
		}
	}
	return i.delete(t), [...i].sort((e, t) => e.localeCompare(t));
}
//#endregion
//#region src/interactions/field-traversal.ts
var ce = /* @__PURE__ */ new WeakMap();
function k(e) {
	return JSON.stringify([e.nodeId, e.fieldId]);
}
function le(e, t, n) {
	let r = k(t), i = ue(e);
	if (!i.fieldKeys.has(r)) return fe();
	let a = `${n}\u0000${r}`, o = i.results.get(a);
	if (o !== void 0) return o;
	let s = /* @__PURE__ */ new Set([r]), c = /* @__PURE__ */ new Set(), l = [r];
	for (let e = 0; e < l.length; e += 1) {
		let t = l[e], r = [...n === "downstream" ? [] : i.incoming.get(t) ?? [], ...n === "upstream" ? [] : i.outgoing.get(t) ?? []];
		for (let e of r) {
			c.add(e.key);
			let n = k({
				nodeId: e.source,
				fieldId: e.sourceField
			}), r = k({
				nodeId: e.target,
				fieldId: e.targetField
			}), i = n === t ? r : n;
			s.has(i) || (s.add(i), l.push(i));
		}
	}
	let u = {
		fieldKeys: s,
		edgeKeys: c
	};
	return i.results.set(a, u), u;
}
function ue(e) {
	let t = ce.get(e);
	if (t !== void 0) return t;
	let n = /* @__PURE__ */ new Set();
	for (let t of e.nodes) for (let e of t.fields ?? []) n.add(k({
		nodeId: t.id,
		fieldId: e.id
	}));
	let r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map();
	for (let t of e.edges) t.sourceField !== void 0 && t.targetField !== void 0 && (de(i, k({
		nodeId: t.source,
		fieldId: t.sourceField
	}), t), de(r, k({
		nodeId: t.target,
		fieldId: t.targetField
	}), t));
	let a = {
		fieldKeys: n,
		incoming: r,
		outgoing: i,
		results: /* @__PURE__ */ new Map()
	};
	return ce.set(e, a), a;
}
function de(e, t, n) {
	let r = e.get(t);
	r ? r.push(n) : e.set(t, [n]);
}
function fe() {
	return {
		fieldKeys: /* @__PURE__ */ new Set(),
		edgeKeys: /* @__PURE__ */ new Set()
	};
}
//#endregion
//#region src/interactions/highlight-state.ts
function pe(e, t, n, r = null) {
	if (e !== null && r !== null) return me(e, r, n);
	if (e === null || t === null || !e.nodeById.has(t)) return A();
	if (n === "none") return {
		...A(),
		selectedNodeId: t
	};
	let i = n === "upstream" ? O(e, t) : n === "downstream" ? ae(e, t) : oe(e, t), a = /* @__PURE__ */ new Set([t, ...i]), o = new Set(i), s = new Set(e.edges.filter((e) => a.has(e.source) && a.has(e.target)).map((e) => e.key));
	return {
		selectedNodeId: t,
		selectedFieldKey: null,
		highlightedNodeIds: o,
		dimmedNodeIds: new Set(e.nodes.map((e) => e.id).filter((e) => !a.has(e))),
		highlightedFieldKeys: /* @__PURE__ */ new Set(),
		dimmedFieldKeys: /* @__PURE__ */ new Set(),
		highlightedEdgeKeys: s,
		dimmedEdgeKeys: new Set(e.edges.filter((e) => !s.has(e.key)).map((e) => e.key))
	};
}
function me(e, t, n) {
	let r = k(t), i = n === "none" ? {
		fieldKeys: /* @__PURE__ */ new Set([r]),
		edgeKeys: /* @__PURE__ */ new Set()
	} : le(e, t, n === "connected" ? "both" : n);
	if (i.fieldKeys.size === 0) return A();
	if (n === "none") return {
		...A(),
		selectedFieldKey: r
	};
	let a = /* @__PURE__ */ new Set(), o = /* @__PURE__ */ new Set();
	for (let t of e.nodes) for (let e of t.fields ?? []) {
		let n = k({
			nodeId: t.id,
			fieldId: e.id
		});
		o.add(n), i.fieldKeys.has(n) && a.add(t.id);
	}
	return {
		selectedNodeId: null,
		selectedFieldKey: r,
		highlightedNodeIds: a,
		dimmedNodeIds: new Set(e.nodes.map((e) => e.id).filter((e) => !a.has(e))),
		highlightedFieldKeys: new Set([...i.fieldKeys].filter((e) => e !== r)),
		dimmedFieldKeys: new Set([...o].filter((e) => !i.fieldKeys.has(e))),
		highlightedEdgeKeys: i.edgeKeys,
		dimmedEdgeKeys: new Set(e.edges.filter((e) => !i.edgeKeys.has(e.key)).map((e) => e.key))
	};
}
function A() {
	return {
		selectedNodeId: null,
		selectedFieldKey: null,
		highlightedNodeIds: /* @__PURE__ */ new Set(),
		dimmedNodeIds: /* @__PURE__ */ new Set(),
		highlightedFieldKeys: /* @__PURE__ */ new Set(),
		dimmedFieldKeys: /* @__PURE__ */ new Set(),
		highlightedEdgeKeys: /* @__PURE__ */ new Set(),
		dimmedEdgeKeys: /* @__PURE__ */ new Set()
	};
}
//#endregion
//#region src/interactions/viewport-math.ts
var j = .1, M = {
	scale: 1,
	translateX: 0,
	translateY: 0
};
function he(e) {
	let t = e.filter(Te);
	if (t.length === 0) return null;
	let n = Math.min(...t.map((e) => e.x)), r = Math.min(...t.map((e) => e.y)), i = Math.max(...t.map((e) => e.x + e.width)), a = Math.max(...t.map((e) => e.y + e.height));
	return {
		x: n,
		y: r,
		width: i - n,
		height: a - r
	};
}
function N(e, t, n = 24) {
	return ge(e, t, { padding: n });
}
function ge(e, t, n = {}) {
	if (!Te(e) || !we(t)) return null;
	let r = Se(n.padding) ? n.padding : 24, i = t.width - r * 2, a = t.height - r * 2;
	if (i <= 0 || a <= 0) return null;
	let o = xe(Math.min(i / e.width, a / e.height), n);
	return P({
		scale: o,
		translateX: (t.width - e.width * o) / 2 - e.x * o,
		translateY: (t.height - e.height * o) / 2 - e.y * o
	});
}
function _e(e, t, n) {
	return P({
		...e,
		translateX: e.translateX + t,
		translateY: e.translateY + n
	});
}
function ve(e, t, n) {
	if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(n) || n <= 0) return P(e);
	let r = be(e.scale * n), i = (t.x - e.translateX) / e.scale, a = (t.y - e.translateY) / e.scale;
	return P({
		scale: r,
		translateX: t.x - i * r,
		translateY: t.y - a * r
	});
}
function ye(e, t, n) {
	return !we(t) || !Number.isFinite(n.x) || !Number.isFinite(n.y) ? null : P({
		scale: e.scale,
		translateX: t.width / 2 - n.x * e.scale,
		translateY: t.height / 2 - n.y * e.scale
	});
}
function P(e) {
	return {
		scale: be(e.scale),
		translateX: Number.isFinite(e.translateX) ? e.translateX : 0,
		translateY: Number.isFinite(e.translateY) ? e.translateY : 0
	};
}
function be(e) {
	return Math.min(4, Math.max(j, Number.isFinite(e) ? e : 1));
}
function xe(e, t) {
	let n = Math.max(j, Ce(t.minScale) ? t.minScale : j), r = Math.max(n, Math.min(4, Ce(t.maxScale) ? t.maxScale : 4));
	return Math.min(r, Math.max(n, e));
}
function Se(e) {
	return e !== void 0 && Number.isFinite(e) && e >= 0;
}
function Ce(e) {
	return e !== void 0 && Number.isFinite(e) && e > 0;
}
function we(e) {
	return Number.isFinite(e.width) && Number.isFinite(e.height) && e.width > 0 && e.height > 0;
}
function Te(e) {
	return Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.width) && Number.isFinite(e.height) && e.width > 0 && e.height > 0;
}
//#endregion
//#region src/interactions/viewport-controller.ts
var Ee = class {
	apply;
	transform = M;
	baseline = M;
	viewport = {
		width: 0,
		height: 0
	};
	scene = null;
	userInteracted = !1;
	constructor(e) {
		this.apply = e;
	}
	setScene(e, t, n) {
		this.scene = e, this.viewport = t, this.userInteracted = !1;
		let r = n && e !== null ? N(e, t) : M;
		this.baseline = r ?? M, this.setTransform(this.baseline);
	}
	resize(e, t) {
		let n = this.viewport;
		if (this.viewport = e, this.scene !== null) {
			if (!this.userInteracted && t) {
				let t = N(this.scene, e);
				t && (this.baseline = t, this.setTransform(t));
				return;
			}
			if (this.userInteracted && n.width > 0 && n.height > 0 && e.width > 0 && e.height > 0) {
				let t = (n.width / 2 - this.transform.translateX) / this.transform.scale, r = (n.height / 2 - this.transform.translateY) / this.transform.scale;
				this.setTransform({
					...this.transform,
					translateX: e.width / 2 - t * this.transform.scale,
					translateY: e.height / 2 - r * this.transform.scale
				});
			}
		}
	}
	getTransform() {
		return { ...this.transform };
	}
	fit() {
		if (this.scene) {
			let e = N(this.scene, this.viewport);
			e && this.setTransform(e);
		}
	}
	fitBounds(e, t) {
		let n = ge(e, this.viewport, t);
		n && this.setTransform(n);
	}
	reset() {
		this.scene && (this.userInteracted = !1, this.setTransform(this.baseline));
	}
	focus(e) {
		let t = ye(this.transform, this.viewport, e);
		t && (this.userInteracted = !0, this.setTransform(t));
	}
	pan(e, t) {
		this.userInteracted = !0, this.setTransform(_e(this.transform, e, t));
	}
	zoom(e, t) {
		this.userInteracted = !0, this.setTransform(ve(this.transform, e, t));
	}
	destroy() {
		this.scene = null;
	}
	setTransform(e) {
		this.transform = P(e), this.apply(this.transform);
	}
}, De = 32, F = (e, t) => e.localeCompare(t);
function Oe(e, t) {
	let n = ke(e), r = new Map(n.map((e) => [e.key, e])), i = /* @__PURE__ */ new Map();
	for (let e of n) for (let t of e.nodeIds) i.set(t, e);
	for (let t of e.edges) {
		let e = i.get(t.source), n = i.get(t.target);
		e !== void 0 && n !== void 0 && e !== n && (e.outgoing.add(n.key), n.incoming.add(e.key));
	}
	let a = Ae(n, r), o = t.direction === "TB" || t.direction === "BT", s = (e) => t.nodeHeightById?.get(e) ?? t.nodeHeight, c = (e) => o ? s(e) : t.nodeWidth, l = (e) => o ? t.nodeWidth : s(e), u = Math.max(t.nodeGap * 2, 64), d = [], f = 0, p = o ? Math.max(t.nodeHeight, ...e.nodes.map((e) => s(e.id))) : t.nodeWidth;
	for (let e of a) {
		let n = je(e), r = [], i = n.map((e) => Math.max(0, ...e.flatMap((e) => e.nodeIds.map((e) => c(e))))), a = 0;
		for (let e = 0; e < n.length; e += 1) r[e] = a, a += (i[e] ?? 0) + t.layerGap;
		p = Math.max(p, Math.max(0, a - t.layerGap));
		let o = 0;
		for (let e of n) {
			let n = 0;
			for (let a of e) {
				let e = a.nodeIds.reduce((e, t) => e + l(t), 0) + Math.max(0, a.nodeIds.length - 1) * t.nodeGap, o = 0;
				for (let e = 0; e < a.nodeIds.length; e += 1) {
					let u = a.nodeIds[e];
					if (u === void 0) continue;
					let p = c(u);
					d.push({
						id: u,
						primary: (r[a.rank] ?? 0) + ((i[a.rank] ?? p) - p) / 2,
						cross: f + n + o,
						width: t.nodeWidth,
						height: s(u),
						rank: a.rank,
						componentKey: a.key
					}), o += l(u) + t.nodeGap;
				}
				n += e + t.nodeGap;
			}
			o = Math.max(o, Math.max(0, n - t.nodeGap));
		}
		f += o + u;
	}
	let m = Math.max(o ? t.nodeWidth : t.nodeHeight, Math.max(0, f - u));
	return {
		nodes: d.sort((e, t) => F(e.id, t.id)).map((e) => Me(e, t, p)),
		width: Math.max(1, (o ? m : p) + 64),
		height: Math.max(1, (o ? p : m) + 64)
	};
}
function ke(e) {
	let t = e.cycleGroups.map((e) => [...e].sort(F)), n = new Set(t.flat());
	for (let r of e.nodes) n.has(r.id) || t.push([r.id]);
	return t.map((t) => ({
		key: t.join("\0"),
		nodeIds: t,
		cyclic: t.length > 1 || e.edges.some((e) => e.source === t[0] && e.target === t[0]),
		incoming: /* @__PURE__ */ new Set(),
		outgoing: /* @__PURE__ */ new Set(),
		rank: 0
	})).sort((e, t) => F(e.key, t.key));
}
function Ae(e, t) {
	let n = /* @__PURE__ */ new Set(), r = [];
	for (let i of e) {
		if (n.has(i.key)) continue;
		let e = [i], a = [];
		for (n.add(i.key); e.length > 0;) {
			let r = e.pop();
			if (r !== void 0) {
				a.push(r);
				for (let i of [...r.incoming, ...r.outgoing].sort(F)) {
					let r = t.get(i);
					r !== void 0 && !n.has(i) && (n.add(i), e.push(r));
				}
			}
		}
		a.sort((e, t) => F(e.key, t.key)), r.push({
			components: a,
			key: a[0]?.key ?? ""
		});
	}
	return r.sort((e, t) => F(e.key, t.key));
}
function je(e) {
	let t = new Map(e.components.map((e) => [e.key, e])), n = new Map(e.components.map((e) => [e.key, e.incoming.size])), r = e.components.filter((e) => (n.get(e.key) ?? 0) === 0).sort((e, t) => F(e.key, t.key)), i = [];
	for (; r.length > 0;) {
		let e = r.shift();
		if (e !== void 0) {
			i.push(e);
			for (let i of [...e.outgoing].sort(F)) {
				let e = (n.get(i) ?? 1) - 1;
				if (n.set(i, e), e === 0) {
					let e = t.get(i);
					e !== void 0 && (r.push(e), r.sort((e, t) => F(e.key, t.key)));
				}
			}
		}
	}
	for (let e of i) e.rank = Math.max(0, ...[...e.incoming].map((e) => (t.get(e)?.rank ?? 0) + 1));
	let a = [];
	for (let e of i) (a[e.rank] ??= []).push(e);
	for (let e of a) e.sort((e, t) => F(e.key, t.key));
	for (let e = 0; e < 4; e += 1) {
		let t = e % 2 == 0, n = /* @__PURE__ */ new Map(), r = t ? [...a.keys()] : [...a.keys()].reverse();
		for (let e of r) {
			if (t && e === 0 || !t && e === a.length - 1) continue;
			let r = a[e] ?? [];
			(a[t ? e - 1 : e + 1] ?? []).forEach((e, t) => n.set(e.key, t));
			let i = new Map(r.map((e, t) => [e.key, t]));
			r.sort((e, r) => I(e, n, t) - I(r, n, t) || (i.get(e.key) ?? 0) - (i.get(r.key) ?? 0) || F(e.key, r.key));
		}
	}
	return a;
}
function I(e, t, n) {
	let r = [...n ? e.incoming : e.outgoing].filter((e) => t.has(e));
	return r.length === 0 ? Infinity : r.reduce((e, n) => e + (t.get(n) ?? 0), 0) / r.length;
}
function Me(e, t, n) {
	let r = t.direction === "TB" || t.direction === "BT", i = t.direction === "RL" || t.direction === "BT", a = r ? e.height : e.width, o = i ? n - e.primary - a : e.primary;
	return {
		id: e.id,
		x: De + (r ? e.cross : o),
		y: De + (r ? o : e.cross),
		width: e.width,
		height: e.height,
		rank: e.rank,
		componentKey: e.componentKey
	};
}
//#endregion
//#region src/render/node-metrics.ts
var Ne = 48, Pe = 68;
function Fe(e, t) {
	return Ie(e) ? Math.max(t, R(e) + e.fields.length * 28) : t;
}
function L(e, t) {
	let n = e.fields?.findIndex((e) => e.id === t) ?? -1;
	return n < 0 ? null : R(e) + n * 28 + 14;
}
function R(e) {
	return e.subtitle === void 0 ? Ne : Pe;
}
function Ie(e) {
	return e.fields !== void 0 && e.fields.length > 0;
}
//#endregion
//#region src/render/create-render-scene.ts
var z = /* @__PURE__ */ new WeakMap(), Le = 8;
function Re(e, t) {
	let n = ze(t), r = z.get(e)?.get(n);
	if (r !== void 0) return r;
	let i = new Map(e.nodes.map((e) => [e.id, Fe(e, t.nodeHeight)])), a = Oe(e, {
		...t,
		nodeHeightById: i
	}), o = a.nodes.map((t) => ({
		...t,
		node: e.nodeById.get(t.id)
	})), s = new Map(o.map((e) => [e.id, e])), c = e.edges.flatMap((e) => {
		let n = s.get(e.source), r = s.get(e.target);
		return n === void 0 || r === void 0 ? [] : [{
			key: e.key,
			edge: e,
			...Be(n, r, e, t.direction)
		}];
	}), l = {
		width: a.width,
		height: a.height,
		nodes: o,
		edges: c
	}, u = z.get(e) ?? /* @__PURE__ */ new Map();
	return u.size >= Le && u.delete(u.keys().next().value), u.set(n, l), z.set(e, u), l;
}
function ze(e) {
	return JSON.stringify([
		e.direction,
		e.nodeWidth,
		e.nodeHeight,
		e.layerGap,
		e.nodeGap
	]);
}
function Be(e, t, n, r) {
	if (n.sourceField !== void 0 && n.targetField !== void 0) {
		let i = Ve(e, t, n.sourceField, n.targetField, r, n.key);
		if (i !== null) return i;
	}
	if (e.id === t.id) return Ge(e, r);
	let i = r === "TB" || r === "BT", a = r === "LR" || r === "TB";
	if (e.rank === t.rank) return We(e, t, i, n.key);
	if (i) {
		let n = {
			x: e.x + e.width / 2,
			y: e.y + (a ? e.height : 0)
		}, r = {
			x: t.x + t.width / 2,
			y: t.y + (a ? 0 : t.height)
		}, i = (n.y + r.y) / 2;
		return B(n, {
			x: n.x,
			y: i
		}, {
			x: r.x,
			y: i
		}, r);
	}
	let o = {
		x: e.x + (a ? e.width : 0),
		y: e.y + e.height / 2
	}, s = {
		x: t.x + (a ? 0 : t.width),
		y: t.y + t.height / 2
	}, c = (o.x + s.x) / 2;
	return B(o, {
		x: c,
		y: o.y
	}, {
		x: c,
		y: s.y
	}, s);
}
function Ve(e, t, n, r, i, a) {
	let o = L(e.node, n), s = L(t.node, r);
	if (o === null || s === null) return null;
	let c = i === "LR" || i === "TB", l = {
		x: e.x + (c ? e.width : 0),
		y: e.y + o
	}, u = {
		x: t.x + (c ? 0 : t.width),
		y: t.y + s
	};
	if (e.id === t.id) return Ue(e, l, u, c, a);
	if (e.rank === t.rank) return He(e, t, l, u, i, a);
	if (i === "TB" || i === "BT") {
		let e = (l.y + u.y) / 2;
		return B(l, {
			x: l.x,
			y: e
		}, {
			x: u.x,
			y: e
		}, u);
	}
	let d = (l.x + u.x) / 2;
	return B(l, {
		x: d,
		y: l.y
	}, {
		x: d,
		y: u.y
	}, u);
}
function He(e, t, n, r, i, a) {
	let o = i === "LR" || i === "TB", s = 28 + V(a) % 3 * 12;
	if (i === "TB" || i === "BT") {
		let i = o ? Math.max(e.y + e.height, t.y + t.height) + s : Math.min(e.y, t.y) - s;
		return B(n, {
			x: n.x,
			y: i
		}, {
			x: r.x,
			y: i
		}, r);
	}
	let c = o ? Math.max(e.x + e.width, t.x + t.width) + s : Math.min(e.x, t.x) - s;
	return B(n, {
		x: c,
		y: n.y
	}, {
		x: c,
		y: r.y
	}, r);
}
function Ue(e, t, n, r, i) {
	let a = 36 + V(i) % 3 * 10, o = r ? e.x + e.width + a : e.x - a;
	return t.y === n.y ? B(t, {
		x: o,
		y: t.y - 28
	}, {
		x: o,
		y: n.y + 28
	}, n) : B(t, {
		x: o,
		y: t.y
	}, {
		x: o,
		y: n.y
	}, n);
}
function We(e, t, n, r) {
	let i = 28 + V(r) % 3 * 12;
	if (n) {
		let n = e.x + e.width / 2, r = t.x + t.width / 2, a = Math.min(e.y, t.y) - i;
		return B({
			x: n,
			y: e.y
		}, {
			x: n,
			y: a
		}, {
			x: r,
			y: a
		}, {
			x: r,
			y: t.y
		});
	}
	let a = e.y + e.height / 2, o = t.y + t.height / 2, s = Math.min(e.x, t.x) - i;
	return B({
		x: e.x,
		y: a
	}, {
		x: s,
		y: a
	}, {
		x: s,
		y: o
	}, {
		x: t.x,
		y: o
	});
}
function Ge(e, t) {
	if (t === "TB" || t === "BT") {
		let t = e.x + e.width / 2, n = e.y;
		return B({
			x: t,
			y: n
		}, {
			x: t + 40,
			y: n - 36
		}, {
			x: t - 40,
			y: n - 36
		}, {
			x: t,
			y: n
		});
	}
	let n = e.x + e.width, r = e.y + e.height / 2;
	return B({
		x: n,
		y: r
	}, {
		x: n + 40,
		y: r - 36
	}, {
		x: n + 40,
		y: r + 36
	}, {
		x: n,
		y: r + 1
	});
}
function B(e, t, n, r) {
	let i = (i) => (e[i] + 3 * t[i] + 3 * n[i] + r[i]) / 8;
	return {
		path: `M ${e.x} ${e.y} C ${t.x} ${t.y}, ${n.x} ${n.y}, ${r.x} ${r.y}`,
		labelX: i("x"),
		labelY: i("y")
	};
}
function V(e) {
	let t = 0;
	for (let n = 0; n < e.length; n += 1) t = t * 31 + e.charCodeAt(n) >>> 0;
	return t;
}
//#endregion
//#region src/render/svg-dom.ts
var Ke = "http://www.w3.org/2000/svg";
function H(e) {
	return document.createElementNS(Ke, e);
}
//#endregion
//#region src/render/field-renderer.ts
var qe = 64, U = 16, Je = class {
	render(e, t, n) {
		let r = t.node.fields;
		if (r === void 0 || r.length === 0) return;
		let i = R(t.node), a = H("line");
		a.setAttribute("class", "field-separator"), a.setAttribute("x1", "0"), a.setAttribute("x2", String(t.width)), a.setAttribute("y1", String(i)), a.setAttribute("y2", String(i)), e.append(a);
		let o = H("g");
		o.setAttribute("class", "fields");
		for (let [a, s] of r.entries()) {
			let r = H("g");
			r.setAttribute("class", "field-row"), r.setAttribute("data-field-id", s.id);
			let c = L(t.node, s.id);
			if (c === null) continue;
			let l = H("rect");
			l.setAttribute("class", "field-hit-area"), l.setAttribute("x", "0"), l.setAttribute("y", String(i + a * 28)), l.setAttribute("width", String(t.width)), l.setAttribute("height", "28"), r.append(l);
			let u = i + a * 28 + 19, d = H("text");
			d.setAttribute("class", "field-name"), d.setAttribute("x", String(U)), d.setAttribute("y", String(u));
			let f = s.dataType === void 0 ? 0 : 72;
			if (d.setAttribute("clip-path", `url(#${Ye(e, `${n}-field-name-${a}`, U, Math.max(0, t.width - 32 - f), i + a * 28, 28)})`), d.textContent = s.label ?? s.id, r.append(d), s.dataType !== void 0) {
				let o = H("text");
				o.setAttribute("class", "field-data-type"), o.setAttribute("x", String(t.width - U)), o.setAttribute("y", String(u)), o.setAttribute("text-anchor", "end"), o.setAttribute("clip-path", `url(#${Ye(e, `${n}-field-type-${a}`, Math.max(0, t.width - U - qe), qe, i + a * 28, 28)})`), o.textContent = s.dataType, r.append(o);
			}
			let p = H("title");
			p.textContent = Ze(s), r.append(p), r.append(Xe(s.id, "left", 0, c), Xe(s.id, "right", t.width, c)), o.append(r);
		}
		e.append(o);
	}
};
function Ye(e, t, n, r, i, a) {
	let o = H("clipPath");
	o.setAttribute("id", t);
	let s = H("rect");
	return s.setAttribute("x", String(n)), s.setAttribute("y", String(i)), s.setAttribute("width", String(r)), s.setAttribute("height", String(a)), o.append(s), e.append(o), t;
}
function Xe(e, t, n, r) {
	let i = H("circle");
	return i.setAttribute("class", `field-anchor field-anchor-${t}`), i.setAttribute("data-field-id", e), i.setAttribute("data-port-side", t), i.setAttribute("cx", String(n)), i.setAttribute("cy", String(r)), i.setAttribute("r", "3.5"), i;
}
function Ze(e) {
	let t = e.label ?? e.id, n = e.dataType === void 0 ? t : `${t} (${e.dataType})`;
	return e.description === void 0 ? n : `${n}\n${e.description}`;
}
//#endregion
//#region src/render/node-renderer.ts
var Qe = class {
	idPrefix;
	fieldRenderer = new Je();
	constructor(e) {
		this.idPrefix = e;
	}
	render(e, t) {
		let n = H("g");
		n.setAttribute("class", "node"), n.setAttribute("transform", `translate(${e.x} ${e.y})`), n.setAttribute("data-node-id", e.id), e.rank !== void 0 && n.setAttribute("data-node-layer", String(e.rank)), e.node.type && n.setAttribute("data-node-type", e.node.type), e.node.status && n.setAttribute("data-node-status", e.node.status);
		let r = H("rect");
		r.setAttribute("class", "node-surface"), r.setAttribute("width", String(e.width)), r.setAttribute("height", String(e.height)), r.setAttribute("rx", "8");
		let i = `${this.idPrefix}-node-text-${t}`, a = H("clipPath");
		a.setAttribute("id", i);
		let o = H("rect");
		o.setAttribute("x", "16"), o.setAttribute("width", String(Math.max(0, e.width - 32))), o.setAttribute("height", String(e.height)), a.append(o);
		let s = H("title"), c = $e(e.node.metadata, "fullLabel") ?? e.node.label, l = $e(e.node.metadata, "fullSubtitle") ?? e.node.subtitle;
		s.textContent = l ? `${c}\n${l}` : c;
		let u = H("text");
		if (u.setAttribute("class", "node-title"), u.setAttribute("x", "16"), u.setAttribute("y", "30"), u.setAttribute("clip-path", `url(#${i})`), u.textContent = e.node.label, n.append(a, s, r, u), e.node.subtitle) {
			let t = H("text");
			t.setAttribute("class", "node-subtitle"), t.setAttribute("x", "16"), t.setAttribute("y", "52"), t.setAttribute("clip-path", `url(#${i})`), t.textContent = e.node.subtitle, n.append(t);
		}
		return this.fieldRenderer.render(n, e, `${this.idPrefix}-node-${t}`), n;
	}
};
function $e(e, t) {
	let n = e?.[t];
	return typeof n == "string" ? n : void 0;
}
//#endregion
//#region src/render/svg-renderer.ts
var et = 0, tt = class {
	svg;
	viewportGroup;
	sceneGroup;
	viewportWidth = 0;
	viewportHeight = 0;
	markerId = `lineage-viewer-arrow-${++et}`;
	nodeRenderer = new Qe(this.markerId);
	edgesGroup;
	nodesGroup;
	edgeElements = /* @__PURE__ */ new Map();
	nodeElements = /* @__PURE__ */ new Map();
	fieldElements = /* @__PURE__ */ new Map();
	interactionState = null;
	searchState = null;
	interactionDirty = !0;
	searchDirty = !0;
	destroyed = !1;
	constructor(e) {
		this.svg = H("svg"), this.svg.setAttribute("part", "svg"), this.svg.setAttribute("width", "100%"), this.svg.setAttribute("height", "100%"), this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
		let t = H("defs"), n = H("marker");
		n.setAttribute("id", this.markerId), n.setAttribute("viewBox", "0 0 10 10"), n.setAttribute("refX", "9"), n.setAttribute("refY", "5"), n.setAttribute("markerWidth", "7"), n.setAttribute("markerHeight", "7"), n.setAttribute("orient", "auto-start-reverse");
		let r = H("path");
		r.setAttribute("d", "M 0 0 L 10 5 L 0 10 z"), r.setAttribute("class", "arrow"), n.append(r), t.append(n), this.viewportGroup = H("g"), this.viewportGroup.setAttribute("class", "viewport"), this.sceneGroup = H("g"), this.sceneGroup.setAttribute("class", "scene"), this.edgesGroup = H("g"), this.edgesGroup.setAttribute("class", "edges"), this.nodesGroup = H("g"), this.nodesGroup.setAttribute("class", "nodes"), this.sceneGroup.append(this.edgesGroup, this.nodesGroup), this.viewportGroup.append(this.sceneGroup), this.svg.append(t, this.viewportGroup), e.append(this.svg);
	}
	render(e, t) {
		if (this.destroyed) return;
		this.svg.setAttribute("data-view-mode", t.viewMode);
		let n = /* @__PURE__ */ new Set();
		for (let t of e.edges) {
			n.add(t.key);
			let e = nt(t), r = this.edgeElements.get(t.key);
			r === void 0 && (r = {
				path: H("path"),
				hitArea: H("path"),
				label: null,
				signature: "",
				item: t
			}, this.edgeElements.set(t.key, r)), r.signature !== e && (it(r.path, t, this.markerId), at(r.hitArea, t), r.signature = e, r.item = t), this.edgesGroup.append(r.hitArea, r.path);
		}
		for (let [e, t] of this.edgeElements) n.has(e) || (t.hitArea.remove(), t.path.remove(), t.label?.remove(), this.edgeElements.delete(e));
		let r = /* @__PURE__ */ new Set();
		for (let [t, n] of e.nodes.entries()) {
			r.add(n.id);
			let e = rt(n), i = this.nodeElements.get(n.id);
			(i === void 0 || i.signature !== e) && (i?.group.remove(), i = {
				group: this.nodeRenderer.render(n, t),
				signature: e
			}, this.nodeElements.set(n.id, i)), this.nodesGroup.append(i.group);
		}
		for (let [e, t] of this.nodeElements) r.has(e) || (t.group.remove(), this.nodeElements.delete(e));
		this.fieldElements = st(this.nodeElements), this.interactionDirty = !0, this.searchDirty = !0, this.setEdgeLabels(t.showEdgeLabels);
	}
	clear() {
		this.edgesGroup.replaceChildren(), this.nodesGroup.replaceChildren(), this.edgeElements.clear(), this.nodeElements.clear(), this.fieldElements.clear(), this.interactionState = null, this.searchState = null, this.interactionDirty = !0, this.searchDirty = !0;
	}
	setEdgeLabels(e) {
		if (!this.destroyed) for (let t of this.edgeElements.values()) {
			if (!(e && t.item.edge.label !== "")) {
				t.label?.remove(), t.label = null;
				continue;
			}
			let n = t.label ?? ot();
			n.setAttribute("x", String(t.item.labelX)), n.setAttribute("y", String(t.item.labelY)), n.textContent = t.item.edge.label, t.label = n, this.edgesGroup.append(n);
		}
	}
	setViewportSize(e, t) {
		e > 0 && t > 0 && Number.isFinite(e) && Number.isFinite(t) && (e !== this.viewportWidth || t !== this.viewportHeight) && (this.viewportWidth = e, this.viewportHeight = t, this.svg.setAttribute("viewBox", `0 0 ${e} ${t}`));
	}
	setViewportTransform(e) {
		this.viewportGroup.setAttribute("transform", `translate(${e.translateX} ${e.translateY}) scale(${e.scale})`);
	}
	setInteractionState(e) {
		let t = this.interactionDirty ? null : this.interactionState;
		ct(this.nodeElements, t?.selectedNodeId ?? null, e.selectedNodeId), W(this.nodeElements, "highlighted", t?.highlightedNodeIds, e.highlightedNodeIds), W(this.nodeElements, "dimmed", t?.dimmedNodeIds, e.dimmedNodeIds), G(this.edgeElements, "highlighted", t?.highlightedEdgeKeys, e.highlightedEdgeKeys), G(this.edgeElements, "dimmed", t?.dimmedEdgeKeys, e.dimmedEdgeKeys), ct(this.fieldElements, t?.selectedFieldKey ?? null, e.selectedFieldKey), W(this.fieldElements, "highlighted", t?.highlightedFieldKeys, e.highlightedFieldKeys), W(this.fieldElements, "dimmed", t?.dimmedFieldKeys, e.dimmedFieldKeys), this.interactionState = e, this.interactionDirty = !1;
	}
	setSearchState(e) {
		let t = this.searchDirty ? null : this.searchState;
		W(this.nodeElements, "search-match", t?.matchedNodeIds, e.matchedNodeIds), W(this.nodeElements, "search-dimmed", t?.dimmedNodeIds, e.dimmedNodeIds), G(this.edgeElements, "search-dimmed", t?.dimmedEdgeKeys, e.dimmedEdgeKeys), W(this.fieldElements, "search-match", t?.matchedFieldKeys, e.matchedFieldKeys), W(this.fieldElements, "search-dimmed", t?.dimmedFieldKeys, e.dimmedFieldKeys), this.searchState = e, this.searchDirty = !1;
	}
	destroy() {
		this.destroyed ||= (this.clear(), this.svg.remove(), !0);
	}
};
function nt(e) {
	return JSON.stringify([
		e.path,
		e.labelX,
		e.labelY,
		e.edge.source,
		e.edge.target,
		e.edge.sourceField,
		e.edge.targetField,
		e.edge.label,
		e.edge.type,
		e.edge.transformType,
		e.edge.expression
	]);
}
function rt(e) {
	return JSON.stringify([
		e.x,
		e.y,
		e.width,
		e.height,
		e.rank,
		e.node.label,
		e.node.subtitle,
		e.node.type,
		e.node.status,
		ut(e.node.metadata, "fullLabel"),
		ut(e.node.metadata, "fullSubtitle"),
		e.node.fields?.map((e) => [
			e.id,
			e.label,
			e.dataType,
			e.description
		])
	]);
}
function it(e, t, n) {
	let r = t.edge.sourceField !== void 0 && t.edge.targetField !== void 0;
	e.setAttribute("class", r ? "edge column-edge" : "edge table-edge"), e.setAttribute("d", t.path), e.setAttribute("marker-end", `url(#${n})`), e.setAttribute("data-edge-key", t.key), e.setAttribute("data-edge-source", t.edge.source), e.setAttribute("data-edge-target", t.edge.target), lt(e, "data-edge-source-field", t.edge.sourceField), lt(e, "data-edge-target-field", t.edge.targetField);
}
function at(e, t) {
	e.setAttribute("class", "edge-hit-area"), e.setAttribute("d", t.path), e.setAttribute("data-edge-key", t.key);
}
function ot() {
	let e = H("text");
	return e.setAttribute("class", "edge-label"), e.setAttribute("dy", "-6"), e.setAttribute("text-anchor", "middle"), e;
}
function st(e) {
	let t = /* @__PURE__ */ new Map();
	for (let [n, r] of e) for (let e of r.group.querySelectorAll(".field-row")) {
		let r = e.dataset.fieldId;
		r !== void 0 && t.set(k({
			nodeId: n,
			fieldId: r
		}), e);
	}
	return t;
}
function ct(e, t, n) {
	t !== null && t !== n && q(K(e.get(t)), "selected", !1), n !== null && q(K(e.get(n)), "selected", !0);
}
function W(e, t, n, r) {
	if (n === void 0) {
		for (let [n, i] of e) q(K(i), t, r.has(n));
		return;
	}
	for (let i of n) r.has(i) || q(K(e.get(i)), t, !1);
	for (let i of r) n.has(i) || q(K(e.get(i)), t, !0);
}
function G(e, t, n, r) {
	if (n === void 0) {
		for (let [n, i] of e) q(i.path, t, r.has(n));
		return;
	}
	for (let i of n) r.has(i) || q(e.get(i)?.path, t, !1);
	for (let i of r) n.has(i) || q(e.get(i)?.path, t, !0);
}
function K(e) {
	return e instanceof Element ? e : e?.group;
}
function lt(e, t, n) {
	n === void 0 ? e.removeAttribute(t) : e.setAttribute(t, n);
}
function ut(e, t) {
	let n = e?.[t];
	return typeof n == "string" ? n : void 0;
}
function q(e, t, n) {
	e !== void 0 && (n ? e.setAttribute(`data-${t}`, "") : e.removeAttribute(`data-${t}`));
}
//#endregion
//#region src/public-api/options.ts
var dt = {
	direction: "LR",
	fitOnLoad: !0,
	readonly: !0,
	showSelfLoops: !1,
	showEdgeLabels: !1,
	validationMode: "lenient",
	nodeWidth: 180,
	nodeHeight: 72,
	layerGap: 72,
	nodeGap: 32,
	highlightMode: "connected",
	viewMode: "mixed"
};
function ft(e, t) {
	if (typeof t != "object" || !t || Array.isArray(t)) return e;
	let n = t;
	return {
		direction: pt(n.direction) ? n.direction : e.direction,
		fitOnLoad: typeof n.fitOnLoad == "boolean" ? n.fitOnLoad : e.fitOnLoad,
		readonly: typeof n.readonly == "boolean" ? n.readonly : e.readonly,
		showSelfLoops: typeof n.showSelfLoops == "boolean" ? n.showSelfLoops : e.showSelfLoops,
		showEdgeLabels: typeof n.showEdgeLabels == "boolean" ? n.showEdgeLabels : e.showEdgeLabels,
		validationMode: n.validationMode === "strict" || n.validationMode === "lenient" ? n.validationMode : e.validationMode,
		nodeWidth: J(n.nodeWidth, e.nodeWidth),
		nodeHeight: J(n.nodeHeight, e.nodeHeight),
		layerGap: J(n.layerGap, e.layerGap),
		nodeGap: J(n.nodeGap, e.nodeGap),
		highlightMode: mt(n.highlightMode) ? n.highlightMode : e.highlightMode,
		viewMode: ht(n.viewMode) ? n.viewMode : e.viewMode
	};
}
function J(e, t) {
	return typeof e == "number" && Number.isFinite(e) && e > 0 ? e : t;
}
function pt(e) {
	return e === "LR" || e === "RL" || e === "TB" || e === "BT";
}
function mt(e) {
	return e === "connected" || e === "both" || e === "upstream" || e === "downstream" || e === "none";
}
function ht(e) {
	return e === "table" || e === "column" || e === "mixed";
}
//#endregion
//#region src/search/field-search.ts
function gt(e, t = {}) {
	let n = typeof e == "string" ? {
		...t,
		query: e
	} : typeof e == "object" && e ? e : {}, r = Y(n.query), i = Y(n.dataType);
	return r === void 0 && i === void 0 ? null : {
		...r === void 0 ? {} : { query: r },
		...i === void 0 ? {} : { dataType: i }
	};
}
function _t(e, t) {
	if (e === null || t === null) return [];
	let n = t.query?.toLocaleLowerCase(), r = t.dataType?.toLocaleLowerCase(), i = [];
	for (let t of e.nodes) {
		r === void 0 && n !== void 0 && X(t.id, t.label, n) && i.push({
			kind: "table",
			nodeId: t.id
		});
		for (let e of t.fields ?? []) {
			let a = n === void 0 || X(e.id, e.label ?? e.id, n), o = r === void 0 || e.dataType?.toLocaleLowerCase() === r;
			a && o && i.push({
				kind: "field",
				nodeId: t.id,
				fieldId: e.id
			});
		}
	}
	return i;
}
function vt(e, t) {
	if (e === null) return [];
	let n = Y(t)?.toLocaleLowerCase();
	if (n === void 0) return [];
	let r = [];
	for (let t of e.nodes) {
		let e = X(t.id, t.label, n);
		for (let i of t.fields ?? []) {
			let a = i.label ?? i.id;
			(e || X(i.id, a, n) || i.dataType?.toLocaleLowerCase().includes(n)) && r.push({
				nodeId: t.id,
				fieldId: i.id,
				label: a
			});
		}
	}
	return r;
}
function Y(e) {
	if (typeof e != "string") return;
	let t = e.trim();
	return t === "" ? void 0 : t;
}
function X(e, t, n) {
	return e.toLocaleLowerCase().includes(n) || t.toLocaleLowerCase().includes(n);
}
//#endregion
//#region src/search/search-state.ts
function yt(e, t, n, r) {
	if (e === null || t === null || !r) return bt();
	let i = new Set(n.map((e) => e.nodeId)), a = new Set(n.filter((e) => e.kind === "field").map((e) => k(e))), o = n.length > 0 && a.size === 0 ? /* @__PURE__ */ new Set() : new Set(e.nodes.flatMap((e) => (e.fields ?? []).map((t) => k({
		nodeId: e.id,
		fieldId: t.id
	})).filter((e) => !a.has(e))));
	return {
		matchedNodeIds: i,
		dimmedNodeIds: new Set(t.nodes.map((e) => e.id).filter((e) => !i.has(e))),
		matchedFieldKeys: a,
		dimmedFieldKeys: o,
		dimmedEdgeKeys: new Set(t.edges.filter((e) => !i.has(e.source) || !i.has(e.target)).map((e) => e.key))
	};
}
function bt() {
	return {
		matchedNodeIds: /* @__PURE__ */ new Set(),
		dimmedNodeIds: /* @__PURE__ */ new Set(),
		matchedFieldKeys: /* @__PURE__ */ new Set(),
		dimmedFieldKeys: /* @__PURE__ */ new Set(),
		dimmedEdgeKeys: /* @__PURE__ */ new Set()
	};
}
//#endregion
//#region src/view/lineage-view.ts
var Z = /* @__PURE__ */ new WeakMap();
function xt(n, r) {
	if (r === "mixed") return n;
	let i = Z.get(n)?.get(r);
	if (i !== void 0) return i;
	let a = r === "table" ? n.nodes.map(St) : n.nodes, o = r === "table" ? Ct(n.edges) : n.edges.filter(Q), s = e(a, o), c = {
		schemaVersion: n.schemaVersion,
		nodes: a,
		edges: o,
		...s,
		cycleGroups: t(a.map((e) => e.id), o)
	}, l = Z.get(n) ?? /* @__PURE__ */ new Map();
	return l.set(r, c), Z.set(n, l), c;
}
function St(e) {
	let t = { ...e };
	return delete t.fields, t;
}
function Ct(e) {
	let t = e.filter((e) => !Q(e)), n = new Set(t.map((e) => JSON.stringify([e.source, e.target]))), r = [];
	for (let t of e) {
		if (!Q(t)) continue;
		let e = JSON.stringify([t.source, t.target]);
		n.has(e) || (n.add(e), r.push({
			source: t.source,
			target: t.target,
			key: JSON.stringify(["table-view", e]),
			type: t.type,
			label: ""
		}));
	}
	return [...t, ...r];
}
function Q(e) {
	return e.sourceField !== void 0 && e.targetField !== void 0;
}
//#endregion
//#region src/element/styles.ts
var wt = ":host { position:relative; display:block; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; --lineage-background:#fff; --lineage-node-background:#fff; --lineage-node-border:#d7dce3; --lineage-node-success-background:#f0fdf4; --lineage-node-success-border:#16a34a; --lineage-node-warning-background:#fffbeb; --lineage-node-warning-border:#d97706; --lineage-node-error-background:#fef2f2; --lineage-node-error-border:#dc2626; --lineage-node-muted-background:#f8fafc; --lineage-node-muted-border:#94a3b8; --lineage-node-selected-border:#2563eb; --lineage-node-selected-shadow:#93c5fd; --lineage-node-search-border:#ea580c; --lineage-node-text:#172033; --lineage-node-subtitle:#6b7280; --lineage-field-border:#e5e7eb; --lineage-field-text:#334155; --lineage-field-type:#64748b; --lineage-field-anchor:#64748b; --lineage-field-highlight-background:#eff6ff; --lineage-field-search-background:#fff7ed; --lineage-edge-color:#718096; --lineage-edge-highlight-color:#2563eb; --lineage-dimmed-opacity:.28; --lineage-font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif; } .root { position:relative; width:100%; height:100%; min-width:0; min-height:0; background:var(--lineage-background); overflow:hidden; } svg { position:absolute; inset:0; display:block; width:100%; height:100%; background:var(--lineage-background); font-family:var(--lineage-font-family); cursor:grab; touch-action:none; } svg[data-panning] { cursor:grabbing; } .edge-hit-area { fill:none; stroke:rgb(0 0 0 / .001); stroke-width:12; pointer-events:stroke; cursor:pointer; } .edge { fill:none; stroke:var(--lineage-edge-color); stroke-width:1.5; pointer-events:none; } .column-edge { stroke-width:1.75; } .arrow { fill:var(--lineage-edge-color); } .node { cursor:pointer; } .node > .node-surface { fill:var(--lineage-node-background); stroke:var(--lineage-node-border); filter:drop-shadow(0 1px 1px rgb(15 23 42 / 8%)); } .node[data-node-status=\"success\"] > .node-surface { fill:var(--lineage-node-success-background); stroke:var(--lineage-node-success-border); } .node[data-node-status=\"warning\"] > .node-surface { fill:var(--lineage-node-warning-background); stroke:var(--lineage-node-warning-border); } .node[data-node-status=\"error\"] > .node-surface { fill:var(--lineage-node-error-background); stroke:var(--lineage-node-error-border); } .node[data-node-status=\"muted\"] > .node-surface { fill:var(--lineage-node-muted-background); stroke:var(--lineage-node-muted-border); } .node[data-search-match] > .node-surface { stroke:var(--lineage-node-search-border); stroke-width:2.5; } .node[data-selected] > .node-surface { stroke:var(--lineage-node-selected-border); stroke-width:3; filter:drop-shadow(0 0 4px var(--lineage-node-selected-shadow)); } .node[data-highlighted] > .node-surface,.edge[data-highlighted] { stroke:var(--lineage-edge-highlight-color); } .edge[data-highlighted] { stroke-width:2.25; } .edge[data-dimmed],.node[data-dimmed],.field-row[data-dimmed],.edge[data-search-dimmed],.node[data-search-dimmed],.field-row[data-search-dimmed] { opacity:var(--lineage-dimmed-opacity); } .node-title { fill:var(--lineage-node-text); font-size:14px; font-weight:600; } .node-subtitle,.edge-label { fill:var(--lineage-node-subtitle); font-size:12px; } .field-row { cursor:pointer; } .field-hit-area { fill:transparent; } .field-row[data-search-match] > .field-hit-area { fill:var(--lineage-field-search-background); } .field-row[data-selected] > .field-hit-area,.field-row[data-highlighted] > .field-hit-area { fill:var(--lineage-field-highlight-background); } .field-row[data-selected] .field-name { fill:var(--lineage-edge-highlight-color); font-weight:600; } .field-row[data-search-match] .field-name { font-weight:600; } .field-row[data-selected] .field-anchor,.field-row[data-highlighted] .field-anchor { stroke:var(--lineage-edge-highlight-color); } .field-separator { stroke:var(--lineage-field-border); stroke-width:1; pointer-events:none; } .field-name,.field-data-type { font-size:12px; pointer-events:none; } .field-name { fill:var(--lineage-field-text); } .field-data-type { fill:var(--lineage-field-type); font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:11px; } .field-anchor { fill:var(--lineage-node-background); stroke:var(--lineage-field-anchor); stroke-width:1.5; } .edge-label { pointer-events:none; paint-order:stroke; stroke:var(--lineage-background); stroke-width:4px; stroke-linejoin:round; } .state { position:absolute; inset:0; display:grid; place-content:center; gap:8px; padding:24px; text-align:center; color:#64748b; font-family:var(--lineage-font-family); } .state[data-kind=\"invalid\"] { color:#b42318; } .state p { margin:0; } @media (prefers-reduced-motion: no-preference) { .edge,.node,.field-row { transition:opacity 120ms ease,stroke 120ms ease; } }", Tt = typeof HTMLElement > "u" ? class {} : HTMLElement, $ = class extends Tt {
	root;
	renderer = null;
	viewport = null;
	resizeObserver = null;
	state = "idle";
	graph = null;
	viewGraph = null;
	scene = null;
	diagnostics = [];
	input = null;
	resolvedOptions = dt;
	selectedId = null;
	selectedFieldRef = null;
	searchOptions = null;
	fieldSearchKeyword = null;
	currentSearchResults = [];
	initialized = !1;
	readyDispatched = !1;
	hasObservedViewport = !1;
	drag = null;
	suppressClick = !1;
	constructor() {
		super(), this.root = this.attachShadow({ mode: "open" });
	}
	get data() {
		return this.graph === null ? null : {
			schemaVersion: this.graph.schemaVersion,
			nodes: this.graph.nodes.map((e) => ({ ...e })),
			edges: this.graph.edges.map(Dt)
		};
	}
	set data(e) {
		this.setData(e);
	}
	get options() {
		return { ...this.resolvedOptions };
	}
	set options(e) {
		this.setOptions(e);
	}
	get selectedNodeId() {
		return this.state === "destroyed" ? null : this.selectedId;
	}
	get selectedField() {
		return this.state === "destroyed" || this.selectedFieldRef === null ? null : { ...this.selectedFieldRef };
	}
	get searchResults() {
		return this.state === "destroyed" ? [] : this.currentSearchResults.map((e) => ({ ...e }));
	}
	connectedCallback() {
		this.state !== "destroyed" && (this.ensureInitialized(), this.observe(), this.process(!1));
	}
	disconnectedCallback() {
		this.stopObserving(), this.renderer?.clear();
	}
	setData(e) {
		this.state !== "destroyed" && (this.input = e, this.process(!0));
	}
	setOptions(e) {
		if (this.state === "destroyed") return;
		let t = this.resolvedOptions;
		this.resolvedOptions = ft(t, e);
		let n = t.validationMode !== this.resolvedOptions.validationMode || t.showSelfLoops !== this.resolvedOptions.showSelfLoops, r = t.direction !== this.resolvedOptions.direction || t.nodeWidth !== this.resolvedOptions.nodeWidth || t.nodeHeight !== this.resolvedOptions.nodeHeight || t.layerGap !== this.resolvedOptions.layerGap || t.nodeGap !== this.resolvedOptions.nodeGap, i = t.viewMode !== this.resolvedOptions.viewMode;
		i && this.resolvedOptions.viewMode === "table" && this.updateFieldSelection(null, "api"), n ? this.process(!0) : (r || i) && this.initialized ? this.renderCurrent(!0) : t.fitOnLoad !== this.resolvedOptions.fitOnLoad && this.resolvedOptions.fitOnLoad && this.scene ? this.viewport?.setScene(Et(this.scene), this.size(), !0) : t.showEdgeLabels !== this.resolvedOptions.showEdgeLabels && this.initialized && this.renderer?.setEdgeLabels(this.resolvedOptions.showEdgeLabels), this.applyInteractionState();
	}
	getDiagnostics() {
		return [...this.diagnostics];
	}
	fitView() {
		this.state !== "destroyed" && this.viewport?.fit();
	}
	fitBounds(e, t) {
		this.state !== "destroyed" && this.viewport?.fitBounds(e, t);
	}
	fitNodes(e, t) {
		if (this.state === "destroyed" || e.length === 0) return;
		let n = e.map((e) => this.findSceneNode(e)).filter((e) => e !== void 0);
		if (n.length === 0) return;
		let r = he(n.map((e) => e));
		r && this.viewport?.fitBounds(r, t);
	}
	resetView() {
		this.state !== "destroyed" && this.viewport?.reset();
	}
	focusNode(e) {
		let t = this.findSceneNode(e);
		t && this.viewport?.focus({
			x: t.x + t.width / 2,
			y: t.y + t.height / 2
		});
	}
	focusField(e, t) {
		let n = {
			nodeId: e.trim(),
			fieldId: t.trim()
		};
		this.findField(n) !== null && this.focusNode(n.nodeId);
	}
	zoomBy(e) {
		let t = this.size();
		this.viewport?.zoom({
			x: t.width / 2,
			y: t.height / 2
		}, e);
	}
	selectNode(e) {
		let t = e.trim();
		this.graph?.nodeById.has(t) && this.updateSelection(t, "api");
	}
	selectField(e, t) {
		if (this.resolvedOptions.viewMode === "table") return;
		let n = {
			nodeId: e.trim(),
			fieldId: t.trim()
		};
		this.findField(n) !== null && this.updateFieldSelection(n, "api");
	}
	clearSelection() {
		this.updateSelection(null, "api");
	}
	search(e, t = {}) {
		return this.state === "destroyed" ? [] : (this.fieldSearchKeyword = null, this.searchOptions = gt(e, t), this.refreshSearch(), this.searchResults);
	}
	searchFields(e) {
		if (this.state === "destroyed") return [];
		let t = e.trim();
		this.searchOptions = null, this.fieldSearchKeyword = t === "" ? null : t;
		let n = vt(this.graph, t);
		this.currentSearchResults = n.map(({ nodeId: e, fieldId: t }) => ({
			kind: "field",
			nodeId: e,
			fieldId: t
		})), this.applySearchState();
		let r = n[0];
		return r !== void 0 && this.focusField(r.nodeId, r.fieldId), n.map((e) => ({ ...e }));
	}
	clearSearch() {
		this.state === "destroyed" || this.searchOptions === null && this.fieldSearchKeyword === null || (this.searchOptions = null, this.fieldSearchKeyword = null, this.currentSearchResults = [], this.applySearchState());
	}
	destroy() {
		this.state !== "destroyed" && (this.stopObserving(), this.renderer?.destroy(), this.renderer = null, this.viewport?.destroy(), this.viewport = null, this.root.replaceChildren(), this.graph = null, this.viewGraph = null, this.scene = null, this.selectedId = null, this.selectedFieldRef = null, this.searchOptions = null, this.fieldSearchKeyword = null, this.currentSearchResults = [], this.diagnostics = [], this.state = "destroyed");
	}
	ensureInitialized() {
		if (this.initialized) return;
		let e = document.createElement("style");
		e.textContent = wt;
		let t = document.createElement("div");
		t.className = "root", this.root.append(e, t), this.renderer = new tt(this.root), this.viewport = new Ee((e) => this.renderer?.setViewportTransform(e)), this.renderer.svg.addEventListener("wheel", this.onWheel, { passive: !1 }), this.renderer.svg.addEventListener("pointerdown", this.onPointerDown), this.renderer.svg.addEventListener("pointermove", this.onPointerMove), this.renderer.svg.addEventListener("pointerup", this.onPointerEnd), this.renderer.svg.addEventListener("pointercancel", this.onPointerEnd), this.renderer.svg.addEventListener("click", this.onClick), this.initialized = !0;
	}
	process(e) {
		if (this.state === "destroyed") return;
		if (this.input === null) {
			this.graph = null, this.diagnostics = [], this.state = "idle", this.clearForData(), this.refreshSearch(), this.renderCurrent(!0);
			return;
		}
		let t = y(this.input, {
			validationMode: this.resolvedOptions.validationMode,
			showSelfLoops: this.resolvedOptions.showSelfLoops
		});
		this.graph = t.graph, this.diagnostics = t.diagnostics, this.state = t.graph === null ? "invalid" : t.graph.nodes.length === 0 ? "empty" : "rendered", this.selectedId !== null && !this.graph?.nodeById.has(this.selectedId) && this.updateSelection(null, "data"), this.selectedFieldRef !== null && this.findField(this.selectedFieldRef) === null && this.updateFieldSelection(null, "data"), this.refreshSearch(), this.renderCurrent(!0), e && this.isConnected && this.emitDiagnostics(), this.dispatchReadyIfPossible();
	}
	clearForData() {
		(this.selectedId !== null || this.selectedFieldRef !== null) && this.updateSelection(null, "data");
	}
	renderCurrent(e) {
		if (!this.initialized || this.renderer === null) return;
		if (this.root.querySelector(".state")?.remove(), this.scene = null, this.viewGraph = null, this.state === "rendered" && this.graph !== null) {
			this.viewGraph = xt(this.graph, this.resolvedOptions.viewMode), this.scene = Re(this.viewGraph, this.resolvedOptions), this.renderer.render(this.scene, this.resolvedOptions);
			let t = this.size();
			this.renderer.setViewportSize(t.width, t.height), e && this.viewport?.setScene(Et(this.scene), t, this.resolvedOptions.fitOnLoad), this.applyInteractionState(), this.applySearchState();
			return;
		}
		this.renderer.clear(), this.viewport?.setScene(null, this.size(), !1);
		let t = document.createElement("div");
		t.className = "state", t.dataset.kind = this.state;
		let n = document.createElement("p");
		if (n.textContent = this.state === "empty" ? "No lineage nodes" : this.state === "invalid" ? "Unable to render lineage data" : "No lineage data", t.append(n), this.state === "invalid") {
			let e = this.diagnostics.find((e) => e.level === "error");
			if (e) {
				let n = document.createElement("p");
				n.textContent = e.message, t.append(n);
			}
		}
		this.root.append(t);
	}
	applyInteractionState() {
		this.renderer?.setInteractionState(pe(this.viewGraph, this.selectedId, this.resolvedOptions.highlightMode, this.selectedFieldRef));
	}
	refreshSearch() {
		this.currentSearchResults = this.fieldSearchKeyword === null ? _t(this.graph, this.searchOptions) : vt(this.graph, this.fieldSearchKeyword).map(({ nodeId: e, fieldId: t }) => ({
			kind: "field",
			nodeId: e,
			fieldId: t
		})), this.applySearchState();
	}
	applySearchState() {
		this.renderer?.setSearchState(yt(this.graph, this.viewGraph, this.currentSearchResults, this.searchOptions !== null || this.fieldSearchKeyword !== null));
	}
	updateSelection(e, t) {
		if (e === this.selectedId && this.selectedFieldRef === null) return;
		let n = this.selectedId, r = this.selectedFieldRef;
		this.selectedId = e, this.selectedFieldRef = null, this.applyInteractionState();
		let i = e === null ? null : this.graph?.nodeById.get(e) ?? null;
		this.emitSelectionChange(n, r, i ?? null, null, t);
	}
	updateFieldSelection(e, t) {
		if (e?.nodeId === this.selectedFieldRef?.nodeId && e?.fieldId === this.selectedFieldRef?.fieldId && this.selectedId === null) return;
		let n = this.selectedId, r = this.selectedFieldRef;
		this.selectedId = null, this.selectedFieldRef = e, this.applyInteractionState();
		let i = e === null ? null : this.findField(e);
		this.emitSelectionChange(n, r, i?.node ?? null, i?.field ?? null, t);
	}
	emitSelectionChange(e, t, n, r, i) {
		this.dispatchEvent(new CustomEvent("lineage-selection-change", {
			detail: {
				selectedNodeId: this.selectedId,
				previousSelectedNodeId: e,
				selectedField: this.selectedFieldRef === null ? null : { ...this.selectedFieldRef },
				previousSelectedField: t === null ? null : { ...t },
				node: n === null ? null : { ...n },
				field: r === null ? null : { ...r },
				source: i
			},
			bubbles: !0,
			composed: !0
		}));
	}
	findField(e) {
		let t = this.graph?.nodeById.get(e.nodeId), n = t?.fields?.find((t) => t.id === e.fieldId);
		return t && n ? {
			node: t,
			field: n
		} : null;
	}
	findSceneNode(e) {
		let t = e.trim();
		return t ? this.scene?.nodes.find((e) => e.id === t) : void 0;
	}
	onWheel = (e) => {
		if (this.state !== "rendered") return;
		e.preventDefault();
		let t = this.eventPoint(e);
		this.viewport?.zoom(t, Math.exp(-e.deltaY * .002));
	};
	onPointerDown = (e) => {
		e.button !== 0 || this.state !== "rendered" || e.target instanceof Element && e.target.closest(".node") || (this.drag = {
			pointerId: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			moved: !1
		}, this.renderer?.svg.setPointerCapture(e.pointerId), this.renderer?.svg.setAttribute("data-panning", ""));
	};
	onPointerMove = (e) => {
		if (!this.drag || e.pointerId !== this.drag.pointerId) return;
		let t = e.clientX - this.drag.x, n = e.clientY - this.drag.y;
		Math.abs(t) + Math.abs(n) > 3 && (this.drag.moved = !0), this.drag.x = e.clientX, this.drag.y = e.clientY, this.viewport?.pan(t, n);
	};
	onPointerEnd = (e) => {
		!this.drag || e.pointerId !== this.drag.pointerId || (this.suppressClick = this.drag.moved, this.renderer?.svg.hasPointerCapture(e.pointerId) && this.renderer.svg.releasePointerCapture(e.pointerId), this.drag = null, this.renderer?.svg.removeAttribute("data-panning"));
	};
	onClick = (e) => {
		if (this.suppressClick) {
			this.suppressClick = !1;
			return;
		}
		let t = (e.target instanceof Element ? e.target.closest("[data-edge-key]") : null)?.dataset.edgeKey;
		if (t !== void 0) {
			let e = this.viewGraph?.edges.find((e) => e.key === t);
			e !== void 0 && this.emitEdgeClick(e);
			return;
		}
		let n = e.target instanceof Element ? e.target.closest(".field-row") : null, r = (e.target instanceof Element ? e.target.closest(".node") : null)?.dataset.nodeId, i = n?.dataset.fieldId;
		if (r && i && this.graph) {
			let e = this.findField({
				nodeId: r,
				fieldId: i
			});
			if (!e) return;
			this.dispatchEvent(new CustomEvent("lineage-field-click", {
				detail: {
					nodeId: r,
					fieldId: i,
					node: { ...e.node },
					field: { ...e.field }
				},
				bubbles: !0,
				composed: !0
			})), this.updateFieldSelection({
				nodeId: r,
				fieldId: i
			}, "pointer");
			return;
		}
		if (r && this.graph) {
			let e = this.graph.nodeById.get(r);
			if (!e) return;
			this.dispatchEvent(new CustomEvent("lineage-node-click", {
				detail: {
					nodeId: r,
					node: { ...e }
				},
				bubbles: !0,
				composed: !0
			})), this.updateSelection(r, "pointer");
		} else this.updateSelection(null, "pointer");
	};
	emitEdgeClick(e) {
		let t = this.findField({
			nodeId: e.source,
			fieldId: e.sourceField ?? ""
		})?.field, n = this.findField({
			nodeId: e.target,
			fieldId: e.targetField ?? ""
		})?.field, r = {
			edgeKey: e.key,
			edge: Dt(e),
			source: {
				nodeId: e.source,
				fieldId: e.sourceField ?? null,
				label: e.sourceField === void 0 ? e.source : `${e.source}.${t?.label ?? e.sourceField}`
			},
			target: {
				nodeId: e.target,
				fieldId: e.targetField ?? null,
				label: e.targetField === void 0 ? e.target : `${e.target}.${n?.label ?? e.targetField}`
			},
			transformType: e.transformType ?? null,
			expression: e.expression ?? null
		};
		this.dispatchEvent(new CustomEvent("lineage-edge-click", {
			detail: r,
			bubbles: !0,
			composed: !0
		}));
	}
	eventPoint(e) {
		let t = this.renderer?.svg.getBoundingClientRect(), n = this.size();
		return t && t.width > 0 && t.height > 0 ? {
			x: (e.clientX - t.left) * n.width / t.width,
			y: (e.clientY - t.top) * n.height / t.height
		} : {
			x: 0,
			y: 0
		};
	}
	size() {
		let e = this.renderer?.svg.getBoundingClientRect();
		return {
			width: e?.width ?? 0,
			height: e?.height ?? 0
		};
	}
	observe() {
		if (this.resizeObserver || typeof ResizeObserver > "u") {
			typeof ResizeObserver > "u" && (this.hasObservedViewport = !0, this.dispatchReadyIfPossible());
			return;
		}
		this.resizeObserver = new ResizeObserver((e) => {
			let t = e[0];
			if (!t || this.state === "destroyed") return;
			let { width: n, height: r } = t.contentRect;
			this.renderer?.setViewportSize(n, r), this.viewport?.resize({
				width: n,
				height: r
			}, this.resolvedOptions.fitOnLoad), this.hasObservedViewport = n > 0 && r > 0, this.dispatchReadyIfPossible();
		}), this.resizeObserver.observe(this);
	}
	stopObserving() {
		this.resizeObserver?.disconnect(), this.resizeObserver = null;
	}
	dispatchReadyIfPossible() {
		this.readyDispatched || !this.hasObservedViewport || !this.isConnected || this.state !== "empty" && this.state !== "rendered" || (this.readyDispatched = !0, this.dispatchEvent(new CustomEvent("lineage-ready", {
			detail: {
				nodeCount: this.graph?.nodes.length ?? 0,
				edgeCount: this.graph?.edges.length ?? 0,
				state: this.state
			},
			bubbles: !0,
			composed: !0
		})));
	}
	emitDiagnostics() {
		let e = this.diagnostics.filter((e) => e.level === "error"), t = this.diagnostics.filter((e) => e.level === "warning");
		this.emit("lineage-error", e, !0), this.emit("lineage-warning", t, !1);
	}
	emit(e, t, n) {
		t.length !== 0 && this.dispatchEvent(new CustomEvent(e, {
			detail: {
				diagnostics: t.map((e) => ({ ...e })),
				hasErrors: n
			},
			bubbles: !0,
			composed: !0
		}));
	}
};
function Et(e) {
	return {
		x: 0,
		y: 0,
		width: e.width,
		height: e.height
	};
}
function Dt(e) {
	return {
		source: e.source,
		target: e.target,
		...e.id === void 0 ? {} : { id: e.id },
		...e.sourceField === void 0 ? {} : { sourceField: e.sourceField },
		...e.targetField === void 0 ? {} : { targetField: e.targetField },
		...e.label === "" ? {} : { label: e.label },
		...e.type === "lineage" ? {} : { type: e.type },
		...e.transformType === void 0 ? {} : { transformType: e.transformType },
		...e.expression === void 0 ? {} : { expression: e.expression },
		...e.metadata === void 0 ? {} : { metadata: e.metadata }
	};
}
//#endregion
//#region src/registration.ts
function Ot() {
	return typeof customElements < "u" && !customElements.get("lineage-viewer") && customElements.define("lineage-viewer", $), $;
}
//#endregion
export { $ as n, Ot as t };

//# sourceMappingURL=registration-C5f5ibF8.js.map