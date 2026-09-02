import { spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createRequire } from "node:module";
import "@deepseek-ai/cordis";

//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.2/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value$1) => is(type, value$1);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary$1) {
	Binary$1.is = isArrayBufferLike;
	Binary$1.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary$1.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary$1.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary$1.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary$1.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary$1.fromHex = fromHex;
})(Binary || (Binary = {}));
/** Decode a base64 string into binary data. */
const base64ToArrayBuffer = Binary.fromBase64;
/** Encode binary data as base64. */
const arrayBufferToBase64 = Binary.toBase64;
/** Decode a hex string into binary data. */
const hexToArrayBuffer = Binary.fromHex;
/** Encode binary data as hex. */
const arrayBufferToHex = Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result$1 = [];
		refs.set(source, result$1);
		source.forEach((value, index) => {
			result$1[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result$1;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a$1, b$1) => a$1.length === b$1.length && a$1.every((item, index) => deepEqual(item, b$1[index]))) ?? check(is("Date"), (a$1, b$1) => a$1.valueOf() === b$1.valueOf()) ?? check(is("RegExp"), (a$1, b$1) => a$1.source === b$1.source && a$1.flags === b$1.flags) ?? check(isArrayBufferLike, (a$1, b$1) => {
		if (a$1.byteLength !== b$1.byteLength) return false;
		const viewA = new Uint8Array(a$1);
		const viewB = new Uint8Array(b$1);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time$1) {
	Time$1.millisecond = 1;
	Time$1.second = 1e3;
	Time$1.minute = Time$1.second * 60;
	Time$1.hour = Time$1.minute * 60;
	Time$1.day = Time$1.hour * 24;
	Time$1.week = Time$1.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time$1.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time$1.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time$1.minute - offset) / 1440);
	}
	Time$1.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time$1.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time$1.minute);
	}
	Time$1.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time$1.week || 0) + (parseFloat(capture[2]) * Time$1.day || 0) + (parseFloat(capture[3]) * Time$1.hour || 0) + (parseFloat(capture[4]) * Time$1.minute || 0) + (parseFloat(capture[5]) * Time$1.second || 0);
	}
	Time$1.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time$1.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time$1.day - Time$1.hour / 2) return Math.round(ms / Time$1.day) + "d";
		else if (abs >= Time$1.hour - Time$1.minute / 2) return Math.round(ms / Time$1.hour) + "h";
		else if (abs >= Time$1.minute - Time$1.second / 2) return Math.round(ms / Time$1.minute) + "m";
		else if (abs >= Time$1.second) return Math.round(ms / Time$1.second) + "s";
		return ms + "ms";
	}
	Time$1.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time$1.toDigits = toDigits;
	function template(template$1, time = /* @__PURE__ */ new Date()) {
		return template$1.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time$1.template = template;
})(Time || (Time = {}));

//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.1/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options$1 = {}) {
		return Schema.resolve(data, schema, options$1)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options$1) => new Schema(options$1));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options$1 = refs[key];
			options$1.sKey = getRef(options$1.sKey);
			options$1.inner = getRef(options$1.inner);
			options$1.list = options$1.list && options$1.list.map(getRef);
			options$1.dict = options$1.dict && mapValues(options$1.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern$1 = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern: pattern$1
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value$1, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value$1) : value$1;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role$1, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role: role$1,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date$1 = new Date(value);
		if (isNaN(+date$1)) throw new ValidationError(`invalid date "${value}"`, options);
		return date$1;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name$1, keys, format) {
	formatters[name$1] = format;
	Object.assign(Schema, { [name$1](...args) {
		const schema = new Schema({ type: name$1 });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key$1 in args[index]) {
						if (typeof args[index][key$1] !== "number") continue;
						schema.bits[key$1] = args[index][key$1];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name$1 === "object" || name$1 === "dict") schema.meta.default = {};
		else if (name$1 === "array" || name$1 === "tuple") schema.meta.default = [];
		else if (name$1 === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));

//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-timeout@0.1.1-rc.2_@deepseek-ai+cordis@4.0.1_@deepseek-ai+dsh-invariants@0.1_2yxulatypvfilrzvurumr2xwty/node_modules/@deepseek-ai/dsh-timeout/lib/index.js
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;

//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-llm@0.1.1-rc.2_@deepseek-ai+cordis@4.0.1_@deepseek-ai+dsh-attachment@0.1.1-r_x2n35l65jyhywzqyfdn334iwva/node_modules/@deepseek-ai/dsh-llm/lib/index.js
/**
* Brand a string as a {@link CallId}.
* @param id - the provider-issued (or synthesized) call id.
* @returns the same string, branded; no validation is performed.
*/
function CallId(id) {
	return id;
}
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
/** Structured codes and plain phrases that explicitly name a context bound being exceeded. */
const STRUCTURED_CONTEXT_OVERFLOW = new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
/** Request-size wording that ties "too large" directly to model context capacity. */
const TOO_LARGE_FOR_CONTEXT = new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
/** "Exceeds" wording is safe only when its object is explicitly the model context. */
const EXCEEDS_MODEL_CONTEXT = new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = Schema.object({
	initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = Schema.object({
	mode: Schema.const("normal").required(),
	maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = Schema.object({
	mode: Schema.const("always").required(),
	backoff: backoffSchema
});
/** Cordis schema embedded by each concrete provider configuration. */
const RetryPolicySchema = Schema.union([normalPolicySchema, alwaysPolicySchema]);
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");

//#endregion
//#region src/types/index.ts
const RepoId = (id) => id;
const NodeId = (id) => id;
const EdgeId = (id) => id;

//#endregion
//#region src/adapters/CodeGraphAdapter.ts
const require = createRequire(import.meta.url);
const NODE_KIND_MAP = {
	function: "function",
	method: "function",
	class: "class",
	interface: "interface",
	type_alias: "type",
	constant: "variable",
	variable: "variable",
	property: "variable",
	file: "module",
	import: "module",
	module: "module"
};
const EDGE_KIND_MAP = {
	call: "call",
	calls: "call",
	import: "import",
	imports: "import",
	extend: "extend",
	extends: "extend",
	implement: "implement",
	implements: "implement",
	contains: "dependency",
	dependency: "dependency",
	depends: "dependency"
};
function mapNodeKind(kind) {
	return NODE_KIND_MAP[kind] ?? "module";
}
function mapEdgeKind(kind) {
	return EDGE_KIND_MAP[kind] ?? "dependency";
}
/** Locate the .codegraph/codegraph.db for a workspace path. */
function resolveDbPath(workspacePath) {
	const root = workspacePath && workspacePath !== "." ? workspacePath : process.cwd();
	return join(root, ".codegraph", "codegraph.db");
}
/** Read the whole graph from a codegraph.db. Returns null when unreadable. */
function readGraphFromDb(dbPath) {
	if (!existsSync(dbPath)) return null;
	try {
		const { DatabaseSync } = require("node:sqlite");
		const db = new DatabaseSync(dbPath, { readOnly: true });
		try {
			const nodes = db.prepare("SELECT id, kind, name, file_path, start_line, signature, docstring, is_exported FROM nodes").all();
			const edges = db.prepare("SELECT id, source, target, kind, line FROM edges").all();
			return {
				nodes,
				edges
			};
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}
var CodeGraphAdapter = class {
	source = "codegraph";
	async fetchData(repoId, invoke) {
		const dbRows = readGraphFromDb(resolveDbPath(repoId));
		if (dbRows && dbRows.nodes.length > 0) return this.toAdapterResult(dbRows.nodes, dbRows.edges);
		const files = await invoke("codegraph_files", {
			path: repoId,
			format: "flat"
		});
		if (!files || typeof files !== "object") return {
			nodes: [],
			edges: [],
			source: this.source,
			timestamp: Date.now()
		};
		const rawFiles = this.extractFileList(files);
		const nodes = rawFiles.map((f, i) => ({
			id: NodeId(`file:${f.path}`),
			label: f.path.split("/").pop() ?? f.path,
			type: "module",
			filePath: f.path,
			lineNumber: 1,
			properties: {
				kind: "file",
				language: f.language ?? null,
				index: i
			}
		}));
		return {
			nodes,
			edges: [],
			source: this.source,
			timestamp: Date.now()
		};
	}
	extractFileList(files) {
		if (Array.isArray(files)) return files.flatMap((f) => {
			if (typeof f === "string") return [{ path: f }];
			const rec = f;
			if (typeof rec.path === "string") return [{
				path: rec.path,
				language: rec.language
			}];
			return [];
		});
		const obj = files;
		const inner = obj?.files ?? obj?.items;
		return Array.isArray(inner) ? this.extractFileList(inner) : [];
	}
	toAdapterResult(dbNodes, dbEdges) {
		const nodeIds = new Set(dbNodes.map((n) => n.id));
		const nodes = dbNodes.map((n) => ({
			id: NodeId(n.id),
			label: n.name,
			type: mapNodeKind(n.kind),
			filePath: n.file_path,
			lineNumber: n.start_line ?? 1,
			properties: {
				kind: n.kind,
				...n.signature ? { signature: n.signature } : {},
				...n.docstring ? { docstring: n.docstring } : {},
				exported: n.is_exported === 1
			}
		}));
		const edges = dbEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)).map((e) => ({
			id: EdgeId(String(e.id)),
			source: NodeId(e.source),
			target: NodeId(e.target),
			type: mapEdgeKind(e.kind),
			properties: e.line != null ? { line: e.line } : {}
		}));
		return {
			nodes,
			edges,
			source: this.source,
			timestamp: Date.now()
		};
	}
};

//#endregion
//#region src/adapters/LensAdapter.ts
var LensAdapter = class {
	source = "lens";
	async fetchData(repoId, invoke) {
		try {
			const raw = await invoke("lens_analyze", { repoId });
			if (!raw) return {
				nodes: [],
				edges: [],
				source: this.source,
				timestamp: Date.now()
			};
			const nodes = raw.symbols.map((s) => ({
				id: NodeId(s.id),
				label: s.name,
				type: this.mapCategory(s.category),
				filePath: s.file,
				lineNumber: s.line,
				properties: { scope: s.scope }
			}));
			const edges = raw.references.map((r) => ({
				id: EdgeId(`${r.from}->${r.to}`),
				source: NodeId(r.from),
				target: NodeId(r.to),
				type: this.mapRelation(r.relation),
				properties: {}
			}));
			return {
				nodes,
				edges,
				source: this.source,
				timestamp: Date.now()
			};
		} catch {
			return {
				nodes: [],
				edges: [],
				source: this.source,
				timestamp: Date.now()
			};
		}
	}
	mapCategory(cat) {
		const map = {
			function: "function",
			class: "class",
			variable: "variable",
			module: "module",
			interface: "interface",
			type: "type"
		};
		return map[cat] ?? "module";
	}
	mapRelation(rel) {
		const map = {
			call: "call",
			reference: "dependency",
			import: "import",
			extend: "extend",
			implement: "implement"
		};
		return map[rel] ?? "dependency";
	}
};

//#endregion
//#region src/merger/GraphDataMerger.ts
var GraphDataMerger = class {
	merge(results, repoId) {
		const nodes = new Map();
		const edges = new Map();
		for (const r of results) {
			for (const node of r.nodes) nodes.set(node.id, node);
			for (const edge of r.edges) edges.set(edge.id, edge);
		}
		return {
			nodes: Array.from(nodes.values()),
			edges: Array.from(edges.values()),
			metadata: {
				repoId: RepoId(repoId),
				timestamp: Date.now(),
				nodeCount: nodes.size,
				edgeCount: edges.size
			}
		};
	}
	applyDelta(current, delta) {
		const nodes = new Map(current.nodes.map((n) => [n.id, n]));
		const edges = new Map(current.edges.map((e) => [e.id, e]));
		for (const node of delta.nodes) {
			const existing = nodes.get(node.id);
			if (existing) nodes.set(node.id, {
				...existing,
				...node,
				properties: {
					...existing.properties,
					...node.properties
				}
			});
			else nodes.set(node.id, node);
		}
		for (const edge of delta.edges) {
			const existing = edges.get(edge.id);
			if (existing) edges.set(edge.id, {
				...existing,
				...edge,
				properties: {
					...existing.properties,
					...edge.properties
				}
			});
			else edges.set(edge.id, edge);
		}
		return {
			nodes: Array.from(nodes.values()),
			edges: Array.from(edges.values()),
			metadata: {
				...current.metadata,
				timestamp: Date.now(),
				nodeCount: nodes.size,
				edgeCount: edges.size
			}
		};
	}
};

//#endregion
//#region src/tools.ts
const codegraphAdapter = new CodeGraphAdapter();
const lensAdapter = new LensAdapter();
const merger = new GraphDataMerger();
const GRAPH_CACHE_LIMIT = 8;
const graphCache = new Map();
function cacheGraph(repoId, data) {
	graphCache.delete(repoId);
	graphCache.set(repoId, data);
	if (graphCache.size > GRAPH_CACHE_LIMIT) {
		const oldest = graphCache.keys().next().value;
		if (oldest !== void 0) graphCache.delete(oldest);
	}
}
async function fetchMergedGraph(invoke, repoId, source = "both") {
	const tasks = [];
	if (source === "codegraph" || source === "both") tasks.push(codegraphAdapter.fetchData(repoId, invoke));
	if (source === "lens" || source === "both") tasks.push(lensAdapter.fetchData(repoId, invoke));
	const settled = await Promise.allSettled(tasks);
	const results = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
	return merger.merge(results, RepoId(repoId));
}
function summarizeGraph(data) {
	const nodeByType = new Map();
	const edgeByType = new Map();
	for (const n of data.nodes) nodeByType.set(n.type, (nodeByType.get(n.type) ?? 0) + 1);
	for (const e of data.edges) edgeByType.set(e.type, (edgeByType.get(e.type) ?? 0) + 1);
	const nodeStats = [...nodeByType.entries()].map(([t, c]) => `${t}:${c}`).join(", ");
	const edgeStats = [...edgeByType.entries()].map(([t, c]) => `${t}:${c}`).join(", ");
	const topNodes = data.nodes.slice(0, 10).map((n) => `  • ${n.label} (${n.type}) @ ${n.filePath}:${n.lineNumber}`).join("\n");
	const topEdges = data.edges.slice(0, 10).map((e) => `  ${e.source} →${e.type}→ ${e.target}`).join("\n");
	return [
		`Graph: ${data.metadata.nodeCount} nodes [${nodeStats}], ${data.metadata.edgeCount} edges [${edgeStats}]`,
		topNodes ? `\nTop nodes:\n${topNodes}` : "",
		topEdges ? `\nTop edges:\n${topEdges}` : ""
	].join("");
}
function normalizeImpact(raw) {
	if (typeof raw === "string") try {
		raw = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const obj = raw;
	const list = obj.affected ?? obj.affectedNodes ?? obj.nodes;
	if (!Array.isArray(list)) return null;
	return {
		affected: list.map((it) => {
			if (typeof it === "string") return it;
			const rec = it;
			return String(rec.name ?? rec.id ?? "?");
		}),
		depth: typeof obj.depth === "number" ? obj.depth : 2
	};
}
function pickBestMatch(raw, symbolId) {
	let payload = raw;
	if (typeof payload === "string") try {
		payload = JSON.parse(payload);
	} catch {
		return null;
	}
	const items = Array.isArray(payload) ? payload : payload?.results ?? payload?.nodes;
	if (!Array.isArray(items) || items.length === 0) return null;
	const wanted = symbolId.toLowerCase();
	const best = items.find((it) => {
		const rec = it;
		return String(rec.name ?? "").toLowerCase() === wanted || rec.id === symbolId;
	});
	const chosen = best ?? items[0];
	return {
		symbolId,
		name: chosen.name ?? chosen.qualified_name ?? symbolId,
		category: chosen.kind ?? "unknown",
		file: chosen.filePath ?? chosen.file_path ?? "?",
		line: chosen.startLine ?? chosen.start_line ?? 0,
		signature: chosen.signature ?? null
	};
}
function createInvoke(ctx) {
	return async (tool, args) => {
		try {
			const result = await ctx.tools.execute({
				callId: CallId(`codegraph:${tool}`),
				name: tool,
				arguments: args,
				signal: AbortSignal.timeout(5e3)
			});
			if (result.isError) return null;
			return result.value ?? null;
		} catch {
			return null;
		}
	};
}
function renderGraphStatus(_args, value) {
	const v = value;
	const srcInfo = v.sources ? ` [codegraph:${v.sources.codegraph ? "✓" : "✗"} lens:${v.sources.lens ? "✓" : "✗"}]` : "";
	return [{
		type: "text",
		text: `Graph status: ${v.status} (${v.nodeCount} nodes, ${v.edgeCount} edges)${srcInfo}`
	}];
}
async function executeGraphStatus(args, invoke) {
	const [cgResult, lensResult] = await Promise.allSettled([codegraphAdapter.fetchData(args.repoId, invoke), lensAdapter.fetchData(args.repoId, invoke)]);
	const results = [cgResult, lensResult].filter((r) => r.status === "fulfilled").map((r) => r.value);
	const data = merger.merge(results, RepoId(args.repoId));
	return {
		status: data.nodes.length > 0 ? "ready" : "unavailable",
		nodeCount: data.metadata.nodeCount,
		edgeCount: data.metadata.edgeCount,
		sources: {
			codegraph: cgResult.status === "fulfilled" && cgResult.value.nodes.length > 0,
			lens: lensResult.status === "fulfilled" && lensResult.value.nodes.length > 0
		}
	};
}
function renderGraphData(_args, value) {
	const data = value;
	return [{
		type: "text",
		text: summarizeGraph(data)
	}];
}
async function executeGraphData(args, invoke, emitUpdate, emitData) {
	const source = args.source ?? "both";
	const fresh = await fetchMergedGraph(invoke, args.repoId, source);
	const cached = graphCache.get(args.repoId);
	const deltaSource = source === "lens" ? "lens" : "codegraph";
	const merged = cached ? merger.applyDelta(cached, {
		nodes: fresh.nodes,
		edges: fresh.edges,
		source: deltaSource,
		timestamp: fresh.metadata.timestamp
	}) : fresh;
	cacheGraph(args.repoId, merged);
	emitUpdate({
		repoId: args.repoId,
		nodeCount: merged.metadata.nodeCount,
		edgeCount: merged.metadata.edgeCount,
		timestamp: merged.metadata.timestamp
	});
	emitData({
		repoId: args.repoId,
		nodes: merged.nodes,
		edges: merged.edges,
		timestamp: merged.metadata.timestamp
	});
	return merged;
}
function renderGraphSymbol(_args, value) {
	const v = value;
	if (!v) return [{
		type: "text",
		text: "Symbol not found."
	}];
	return [{
		type: "text",
		text: `${v.name ?? v.symbolId ?? "?"} (${v.category ?? "unknown"}) @ ${v.file ?? "?"}:${v.line ?? "?"}`
	}];
}
async function executeGraphSymbol(args, invoke) {
	const raw = await invoke("codegraph_query", {
		search: args.symbolId,
		limit: 1
	});
	return pickBestMatch(raw, args.symbolId);
}
function renderGraphImpact(_args, value) {
	const v = value;
	const count = v.affected?.length ?? 0;
	const list = v.affected?.slice(0, 10).join(", ") ?? "";
	return [{
		type: "text",
		text: `Impact: ${count} symbols affected (depth ${v.depth ?? 0})${list ? `\n  ${list}` : ""}`
	}];
}
async function executeGraphImpact(args, invoke) {
	const raw = await invoke("codegraph_impact", {
		symbol: args.symbolId,
		depth: 2
	});
	const normalized = normalizeImpact(raw);
	if (normalized) return normalized;
	const lens = await invoke("lens_impact", { symbolId: args.symbolId });
	return lens ?? {
		affected: [],
		depth: 0
	};
}
const createGraphTools = (ctx) => {
	const invoke = createInvoke(ctx);
	const emitUpdate = (event) => {
		ctx.emit("codegraph/graph/updated", event);
	};
	const emitData = (event) => {
		ctx.emit("codegraph/graph/data", event);
	};
	const graphStatus = defineTool({
		name: "graph_status",
		description: "Check whether an interactive code graph is available for a repository.",
		parameters: { repoId: {
			type: "string",
			required: true,
			description: "Repository id."
		} },
		output: {
			schema: { type: "json" },
			render: renderGraphStatus
		},
		execute: (args) => executeGraphStatus(args, invoke)
	});
	const graphData = defineTool({
		name: "graph_data",
		description: "Fetch the merged code relationship graph for a repository (calls + dependencies). Uses incremental delta merge on repeat calls.",
		parameters: {
			repoId: {
				type: "string",
				required: true,
				description: "Repository id."
			},
			source: {
				type: "string",
				enum: [
					"codegraph",
					"lens",
					"both"
				],
				description: "Data source; defaults to both."
			}
		},
		output: {
			schema: { type: "json" },
			render: renderGraphData
		},
		execute: (args) => executeGraphData(args, invoke, emitUpdate, emitData)
	});
	const graphSymbol = defineTool({
		name: "graph_symbol",
		description: "Resolve the details (file path and line number) of one graph node by symbol id.",
		parameters: { symbolId: {
			type: "string",
			required: true,
			description: "Symbol id."
		} },
		output: {
			schema: { type: "json" },
			render: renderGraphSymbol
		},
		execute: (args) => executeGraphSymbol(args, invoke)
	});
	const graphImpact = defineTool({
		name: "graph_impact",
		description: "Analyze the impact of changing one symbol: which symbols are transitively affected.",
		parameters: { symbolId: {
			type: "string",
			required: true,
			description: "Symbol id to analyze."
		} },
		output: {
			schema: { type: "json" },
			render: renderGraphImpact
		},
		execute: (args) => executeGraphImpact(args, invoke)
	});
	return {
		graphStatus,
		graphData,
		graphSymbol,
		graphImpact
	};
};

//#endregion
//#region src/shared/Logger.ts
const LEVEL_ORDER = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3
};
const RING_SIZE = 200;
var LoggerImpl = class {
	buffer = [];
	listeners = new Set();
	minLevel = typeof globalThis !== "undefined" && globalThis.__CG_DEBUG ? "debug" : "info";
	log(level, scope, message, data) {
		if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
		const entry = {
			ts: Date.now(),
			level,
			scope,
			message,
			data
		};
		this.buffer.push(entry);
		if (this.buffer.length > RING_SIZE) this.buffer.splice(0, this.buffer.length - RING_SIZE);
		this.emit();
		const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
		try {
			fn(`[codegraph:${scope}] ${message}`, data ?? "");
		} catch {}
	}
	debug(scope, message, data) {
		this.log("debug", scope, message, data);
	}
	info(scope, message, data) {
		this.log("info", scope, message, data);
	}
	warn(scope, message, data) {
		this.log("warn", scope, message, data);
	}
	error(scope, message, data) {
		this.log("error", scope, message, data);
	}
	entries() {
		return this.buffer.slice();
	}
	clear() {
		this.buffer = [];
		this.emit();
	}
	subscribe(fn) {
		this.listeners.add(fn);
		fn(this.entries());
		return () => {
			this.listeners.delete(fn);
		};
	}
	emit() {
		const snapshot = this.entries();
		for (const fn of this.listeners) try {
			fn(snapshot);
		} catch {}
	}
};
const logger = new LoggerImpl();
function scoped(scope) {
	return {
		debug: (m, d) => logger.debug(scope, m, d),
		info: (m, d) => logger.info(scope, m, d),
		warn: (m, d) => logger.warn(scope, m, d),
		error: (m, d) => logger.error(scope, m, d)
	};
}

//#endregion
//#region src/generated/version.ts
const PLUGIN_VERSION = "0.1.0";

//#endregion
//#region src/index.ts
const log = scoped("host");
const name = "dsh-codegraph-visualizer";
const inject = ["tools", "webServer"];
let allowedWorkspaceRoots = [];
function isPathAllowed(path) {
	if (!path || path === ".") return true;
	const normalized = normalize(path);
	if (!isAbsolute(normalized)) return false;
	if (normalized.includes("..")) return false;
	if (allowedWorkspaceRoots.length === 0) return true;
	return allowedWorkspaceRoots.some((root) => normalized === root || normalized.startsWith(root + "\\") || normalized.startsWith(root + "/"));
}
let watchTimer = null;
let activeWatcher = null;
/** Detect the codegraph CLI on PATH (cheap, cached per apply). */
function detectCodegraphCli() {
	try {
		const cmd = process.platform === "win32" ? "codegraph.cmd" : "codegraph";
		const r = spawnSync(cmd, ["--version"], {
			encoding: "utf8",
			timeout: 3e3,
			shell: process.platform === "win32"
		});
		return r.status === 0;
	} catch (e) {
		log.warn("detectCodegraphCli failed", e);
		return false;
	}
}
function checkPrerequisites(ctx) {
	try {
		const cg = ctx.tools.get("codegraph_status") ?? ctx.tools.get("codegraph_graph") ?? ctx.tools.get("codegraph_query");
		const lens = ctx.tools.get("lens_analyze");
		return {
			codegraph: !!cg || detectCodegraphCli(),
			lens: !!lens
		};
	} catch (e) {
		log.warn("checkPrerequisites failed", e);
		return {
			codegraph: detectCodegraphCli(),
			lens: false
		};
	}
}
function apply(ctx) {
	const { graphStatus, graphData, graphSymbol, graphImpact } = createGraphTools(ctx);
	ctx.tools.register(graphStatus);
	ctx.tools.register(graphData);
	ctx.tools.register(graphSymbol);
	ctx.tools.register(graphImpact);
	let lastGraphData = null;
	let lastScanPath = null;
	let lastInitResult = null;
	let scanInFlight = null;
	const scanCache = new Map();
	const SCAN_CACHE_TTL = 3e4;
	function slimGraphData(data) {
		const slimNodes = data.nodes.map((n) => ({
			id: n.id,
			label: n.label,
			type: n.type,
			filePath: n.filePath,
			lineNumber: n.lineNumber,
			properties: n.properties?.exported === true ? { exported: true } : {}
		}));
		const slimEdges = data.edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			type: e.type,
			properties: {}
		}));
		return {
			nodes: slimNodes,
			edges: slimEdges,
			metadata: data.metadata
		};
	}
	const invokeUpstream = async (tool, args) => {
		try {
			const result = await ctx.tools.execute({
				callId: CallId(`codegraph:${tool}`),
				name: tool,
				arguments: args,
				signal: AbortSignal.timeout(5e3)
			});
			if (result.isError) return null;
			return result.value ?? null;
		} catch (e) {
			log.warn("invokeUpstream failed", {
				tool,
				error: e
			});
			return null;
		}
	};
	const sendJson = (res, code, data) => {
		res.writeHead(code, { "content-type": "application/json" });
		res.end(JSON.stringify(data));
	};
	const findWorkspacePath = () => {
		try {
			const sessions = ctx.sessions;
			if (sessions?.list) {
				const all = sessions.list();
				for (const session of all) {
					const cwd = session?.header?.cwd;
					if (cwd) return cwd;
				}
			}
		} catch {}
		return process.cwd();
	};
	const listWorkspacePaths = () => {
		try {
			const sessions = ctx.sessions;
			if (sessions?.list) {
				const all = sessions.list();
				const seen = new Set();
				const paths = [];
				for (const session of all) {
					const cwd = session?.header?.cwd;
					if (cwd && !seen.has(cwd)) {
						seen.add(cwd);
						paths.push(cwd);
					}
				}
				if (paths.length > 0) return paths;
			}
		} catch {}
		return [process.cwd()];
	};
	const readBody = (req) => {
		return new Promise((resolve, reject) => {
			let body = "";
			req.on("data", (chunk) => {
				if (chunk) body += chunk.toString();
			});
			req.on("end", () => resolve(body));
			req.on("error", reject);
		});
	};
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/codegraph/status",
		handler: (_req, res) => {
			const status = checkPrerequisites(ctx);
			sendJson(res, 200, {
				codegraph: status.codegraph,
				lens: status.lens
			});
		}
	}), "codegraph: status route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/codegraph/workspace",
		handler: (_req, res) => {
			const current = findWorkspacePath();
			const list = listWorkspacePaths();
			sendJson(res, 200, {
				path: current,
				list
			});
		}
	}), "codegraph: workspace route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/codegraph/data",
		handler: (_req, res) => {
			if (lastGraphData) sendJson(res, 200, lastGraphData);
			else sendJson(res, 200, {
				nodes: [],
				edges: [],
				metadata: {
					repoId: null,
					timestamp: 0,
					nodeCount: 0,
					edgeCount: 0
				}
			});
		}
	}), "codegraph: data route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/codegraph/scan",
		handler: async (req, res) => {
			try {
				const body = await readBody(req);
				const { path } = JSON.parse(body || "{}");
				if (path && path !== "." && !isPathAllowed(path)) {
					sendJson(res, 403, {
						success: false,
						nodes: [],
						edges: [],
						metadata: {
							repoId: null,
							timestamp: 0,
							nodeCount: 0,
							edgeCount: 0
						}
					});
					return;
				}
				const scanPath = path && path !== "." ? path : findWorkspacePath();
				lastScanPath = scanPath;
				const repoId = scanPath || `workspace-${Date.now()}`;
				const cached = scanCache.get(scanPath);
				if (cached && Date.now() - cached.timestamp < SCAN_CACHE_TTL) {
					lastGraphData = cached.data;
					sendJson(res, 200, {
						success: true,
						...cached.data
					});
					return;
				}
				if (scanInFlight) {
					const data = await scanInFlight;
					sendJson(res, 200, {
						success: true,
						...data
					});
					return;
				}
				scanInFlight = fetchMergedGraph(invokeUpstream, repoId, "both");
				try {
					const raw = await scanInFlight;
					scanInFlight = null;
					const data = slimGraphData(raw);
					lastGraphData = data;
					scanCache.set(scanPath, {
						data,
						timestamp: Date.now()
					});
					if (scanCache.size > 4) {
						const oldest = scanCache.keys().next().value;
						if (oldest !== void 0) scanCache.delete(oldest);
					}
					ctx.emit("codegraph/graph/updated", {
						repoId,
						nodeCount: data.metadata.nodeCount,
						edgeCount: data.metadata.edgeCount,
						timestamp: data.metadata.timestamp
					});
					ctx.emit("codegraph/graph/data", {
						repoId,
						nodes: data.nodes,
						edges: data.edges,
						timestamp: data.metadata.timestamp
					});
					log.info("scan completed", {
						repoId,
						nodes: data.metadata.nodeCount,
						edges: data.metadata.edgeCount
					});
					sendJson(res, 200, {
						success: true,
						...data
					});
				} catch (e) {
					scanInFlight = null;
					throw e;
				}
			} catch (e) {
				log.error("scan failed", e);
				sendJson(res, 200, {
					success: false,
					nodes: [],
					edges: [],
					metadata: {
						repoId: null,
						timestamp: 0,
						nodeCount: 0,
						edgeCount: 0
					}
				});
			}
		}
	}), "codegraph: scan route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/codegraph/init",
		handler: async (req, res) => {
			try {
				const body = await readBody(req);
				const { path } = JSON.parse(body || "{}");
				if (path && path !== "." && !isPathAllowed(path)) {
					sendJson(res, 403, {
						success: false,
						path: "",
						message: "Path not allowed",
						timestamp: Date.now()
					});
					return;
				}
				const initPath = path && path !== "." ? path : findWorkspacePath();
				log.info("init requested", { path: initPath });
				const result = await invokeUpstream("codegraph_init", {
					path: initPath,
					force: true
				});
				const success = result !== null;
				lastInitResult = {
					success,
					path: initPath,
					message: success ? "Graph initialized successfully" : "Initialization failed — is dsh-codegraph installed?",
					timestamp: Date.now()
				};
				ctx.emit("codegraph/graph/init-result", lastInitResult);
				if (success) {
					const repoId = initPath || `workspace-${Date.now()}`;
					const data = await fetchMergedGraph(invokeUpstream, repoId, "both");
					lastGraphData = data;
					ctx.emit("codegraph/graph/data", {
						repoId,
						nodes: data.nodes,
						edges: data.edges,
						timestamp: data.metadata.timestamp
					});
				}
				sendJson(res, 200, lastInitResult);
			} catch (e) {
				const errorResult = {
					success: false,
					path: "",
					message: e instanceof Error ? e.message : String(e),
					timestamp: Date.now()
				};
				lastInitResult = errorResult;
				sendJson(res, 200, errorResult);
			}
		}
	}), "codegraph: init route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/codegraph/watch",
		handler: async (req, res) => {
			try {
				const body = await readBody(req);
				const { enabled, path } = JSON.parse(body || "{}");
				if (path && path !== "." && !isPathAllowed(path)) {
					sendJson(res, 403, {
						success: false,
						message: "Path not allowed"
					});
					return;
				}
				const watchPath = path && path !== "." ? path : findWorkspacePath();
				ctx.emit("codegraph/watch/toggle", {
					enabled: !!enabled,
					path: watchPath,
					timestamp: Date.now()
				});
				sendJson(res, 200, { success: true });
			} catch (e) {
				sendJson(res, 200, {
					success: false,
					message: e instanceof Error ? e.message : String(e)
				});
			}
		}
	}), "codegraph: watch route");
	const emitPrereqStatus = () => {
		const status = checkPrerequisites(ctx);
		ctx.emit("codegraph/prerequisite/status", {
			codegraph: status.codegraph,
			lens: status.lens,
			timestamp: Date.now()
		});
		log.info("prerequisite status", status);
	};
	emitPrereqStatus();
	const prereqTimer = setTimeout(emitPrereqStatus, 3e3);
	ctx.effect(() => () => clearTimeout(prereqTimer), "codegraph: prereq re-check timer");
	ctx.on("codegraph/prerequisite/request", () => {
		emitPrereqStatus();
	});
	ctx.on("codegraph/repo/imported", (event) => {
		ctx.emit("codegraph/graph/updated", {
			repoId: event.repoId,
			nodeCount: 0,
			edgeCount: 0,
			timestamp: event.timestamp
		});
	});
	ctx.on("codegraph/repo/scanned", (event) => {
		ctx.emit("codegraph/graph/updated", {
			repoId: event.repoId,
			nodeCount: 0,
			edgeCount: 0,
			timestamp: event.timestamp
		});
	});
	const scanAndPush = async (path) => {
		log.info("scan requested", { path });
		try {
			const repoId = path || `workspace-${Date.now()}`;
			const data = await fetchMergedGraph(invokeUpstream, repoId, "both");
			ctx.emit("codegraph/graph/updated", {
				repoId,
				nodeCount: data.metadata.nodeCount,
				edgeCount: data.metadata.edgeCount,
				timestamp: data.metadata.timestamp
			});
			ctx.emit("codegraph/graph/data", {
				repoId,
				nodes: data.nodes,
				edges: data.edges,
				timestamp: data.metadata.timestamp
			});
			log.info("scan completed", {
				repoId,
				nodes: data.metadata.nodeCount,
				edges: data.metadata.edgeCount
			});
		} catch (e) {
			log.error("scan failed", e);
		}
	};
	ctx.on("codegraph/repo/request-scan", async (event) => {
		await scanAndPush(event.path);
	});
	ctx.on("codegraph/graph/init", async (event) => {
		log.info("init requested", { path: event.path });
		try {
			const result = await invokeUpstream("codegraph_init", {
				path: event.path,
				force: true
			});
			const success = result !== null;
			ctx.emit("codegraph/graph/init-result", {
				success,
				path: event.path,
				message: success ? "Graph initialized successfully" : "Initialization failed — is dsh-codegraph installed?",
				timestamp: Date.now()
			});
			if (success) await scanAndPush(event.path);
		} catch (e) {
			ctx.emit("codegraph/graph/init-result", {
				success: false,
				path: event.path,
				message: e instanceof Error ? e.message : String(e),
				timestamp: Date.now()
			});
		}
	});
	ctx.on("codegraph/watch/toggle", (event) => {
		if (activeWatcher) {
			try {
				activeWatcher.close();
			} catch {}
			activeWatcher = null;
		}
		if (watchTimer) {
			clearTimeout(watchTimer);
			watchTimer = null;
		}
		if (!event.enabled) {
			log.info("watch disabled");
			return;
		}
		log.info("watch enabled", { path: event.path });
		try {
			const watcher = watch(event.path, { recursive: true }, (_eventType, filename) => {
				if (filename && filename.includes(".codegraph")) return;
				if (filename && filename.includes("node_modules")) return;
				if (filename && filename.includes(".git")) return;
				if (watchTimer) clearTimeout(watchTimer);
				watchTimer = setTimeout(() => {
					watchTimer = null;
					log.info("file changed, syncing + re-scanning", { filename });
					invokeUpstream("codegraph_sync", { path: event.path }).then(() => scanAndPush(event.path)).catch((e) => log.error("watch re-scan failed", e));
				}, 500);
			});
			activeWatcher = watcher;
			ctx.effect(() => () => {
				try {
					watcher.close();
				} catch {}
				if (watchTimer) {
					clearTimeout(watchTimer);
					watchTimer = null;
				}
			}, "codegraph: file watcher");
		} catch (e) {
			log.error("watch setup failed", e);
		}
	});
}

//#endregion
export { PLUGIN_VERSION, apply, inject, isPathAllowed, name };
//# sourceMappingURL=index.js.map