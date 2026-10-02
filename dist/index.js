import { API, AST, BOOTSTRAP, CACHE, DIFF_ENGINE, EDGES_AGGREGATION, ERROR_CODES, ERROR_MESSAGES, EdgeId, FILE_OUTLINE, HEALTH_SCORE, MCP, NodeId, PATH_FINDER, RepoId, SYMBOL_AST, TOOL_MESSAGES, TREE_SITTER, VALIDATION, WATCHER, inferLayerFromPath, safeNumber, safeString, scoped } from "./layerUtils-pEdT0G0J.js";
import { FILTERED_EDGE_KINDS, closeAllDbConnections, countEdgesInDb, isNoisePath, mapEdgeKind, mapNodeKind, readEdgesForNodesFromDb, readEdgesFromDb, readFileOutlineFromDb, readNodeChildrenFromDb, readSymbolASTFromDb, readTopLevelNodesFromDb, resolveDbPath } from "./CodeGraphAdapter-SshDynt-.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import path, { isAbsolute, join, normalize, sep } from "node:path";
import { platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { mkdirSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

//#region src/shared/AliasMapper.ts
const NODE_TYPE_ALIASES = {
	func: "function",
	fn: "function",
	method: "function",
	cls: "class",
	mod: "module",
	file: "module",
	pkg: "module",
	package: "module",
	iface: "interface",
	typ: "type",
	enum: "type",
	const: "variable",
	var: "variable",
	let: "variable"
};
const EDGE_TYPE_ALIASES = {
	calls: "call",
	invoke: "call",
	invokes: "call",
	imports: "import",
	import_from: "import",
	extends: "extend",
	inherits: "extend",
	inherit: "extend",
	implements: "implement",
	implements_interface: "implement",
	depends: "dependency",
	depends_on: "dependency",
	uses: "dependency",
	contains_node: "contains",
	owns: "contains",
	has: "contains",
	assoc: "association",
	related: "association",
	aggregates: "aggregation",
	aggregate: "aggregation",
	composes: "composition",
	compose: "composition"
};
const VALID_NODE_TYPES = new Set([
	"function",
	"class",
	"variable",
	"module",
	"interface",
	"type"
]);
const VALID_EDGE_TYPES = new Set([
	"call",
	"import",
	"extend",
	"implement",
	"dependency",
	"contains",
	"association",
	"aggregation",
	"composition"
]);
function normalizeNodeType(type) {
	if (typeof type !== "string") return null;
	if (VALID_NODE_TYPES.has(type)) return type;
	const alias = NODE_TYPE_ALIASES[type];
	if (alias) return alias;
	return null;
}
function normalizeEdgeType(type) {
	if (typeof type !== "string") return null;
	if (VALID_EDGE_TYPES.has(type)) return type;
	const alias = EDGE_TYPE_ALIASES[type];
	if (alias) return alias;
	return null;
}

//#endregion
//#region src/shared/GraphValidator.ts
const log$13 = scoped("validator");
function sanitizeNode(raw) {
	if (raw === null || raw === void 0) return null;
	if (typeof raw !== "object") return null;
	const node = raw;
	if (node.tags === null || node.tags === void 0) node.tags = [];
	if (node.properties === null || node.properties === void 0) node.properties = {};
	if (node.type && typeof node.type === "string") node.type = node.type.toLowerCase();
	if (node.direction && typeof node.direction === "string") node.direction = node.direction.toLowerCase();
	return node;
}
function sanitizeEdge(raw) {
	if (raw === null || raw === void 0) return null;
	if (typeof raw !== "object") return null;
	const edge = raw;
	if (edge.properties === null || edge.properties === void 0) edge.properties = {};
	if (edge.type && typeof edge.type === "string") edge.type = edge.type.toLowerCase();
	if (edge.direction && typeof edge.direction === "string") edge.direction = edge.direction.toLowerCase();
	return edge;
}
function autoFixNode(raw, issues, path$1) {
	const id = raw.id;
	if (typeof id !== "string" || id.length === 0) {
		issues.push({
			level: "dropped",
			category: "node",
			message: "missing or invalid id",
			path: path$1
		});
		return null;
	}
	const label = typeof raw.label === "string" ? raw.label : raw.name ?? id;
	if (raw.label !== label) issues.push({
		level: "auto-corrected",
		category: "node",
		message: `label missing, using id/name: ${label}`,
		path: `${path$1}.label`
	});
	let type = normalizeNodeType(raw.type);
	if (!type) {
		type = "function";
		issues.push({
			level: "auto-corrected",
			category: "node",
			message: `unknown type "${raw.type}", defaulting to "function"`,
			path: `${path$1}.type`
		});
	}
	const filePath = typeof raw.filePath === "string" ? raw.filePath : typeof raw.file === "string" ? raw.file : "";
	if (raw.filePath !== filePath) issues.push({
		level: "auto-corrected",
		category: "node",
		message: "filePath missing, defaulting to empty",
		path: `${path$1}.filePath`
	});
	const lineNumber = typeof raw.lineNumber === "number" && !Number.isNaN(raw.lineNumber) ? raw.lineNumber : typeof raw.line === "number" && !Number.isNaN(raw.line) ? raw.line : void 0;
	const properties = raw.properties && typeof raw.properties === "object" ? raw.properties : {};
	const parentId = typeof raw.parentId === "string" && raw.parentId.length > 0 ? raw.parentId : void 0;
	const summary = typeof raw.summary === "string" ? raw.summary : void 0;
	const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [];
	const complexity = raw.complexity === "simple" || raw.complexity === "moderate" || raw.complexity === "complex" ? raw.complexity : void 0;
	const layer = typeof raw.layer === "string" ? raw.layer : void 0;
	const node = {
		id,
		label,
		type,
		filePath,
		properties,
		tags
	};
	if (lineNumber !== void 0) node.lineNumber = lineNumber;
	if (parentId !== void 0) node.parentId = parentId;
	if (summary !== void 0) node.summary = summary;
	if (complexity !== void 0) node.complexity = complexity;
	if (layer !== void 0) node.layer = layer;
	return node;
}
function autoFixEdge(raw, issues, path$1) {
	const id = raw.id;
	if (typeof id !== "string" || id.length === 0) {
		issues.push({
			level: "dropped",
			category: "edge",
			message: "missing or invalid id",
			path: path$1
		});
		return null;
	}
	const source = raw.source ?? raw.from;
	if (typeof source !== "string" || source.length === 0) {
		issues.push({
			level: "dropped",
			category: "edge",
			message: "missing or invalid source",
			path: path$1
		});
		return null;
	}
	const target = raw.target ?? raw.to;
	if (typeof target !== "string" || target.length === 0) {
		issues.push({
			level: "dropped",
			category: "edge",
			message: "missing or invalid target",
			path: path$1
		});
		return null;
	}
	let type = normalizeEdgeType(raw.type);
	if (!type) {
		type = "association";
		issues.push({
			level: "auto-corrected",
			category: "edge",
			message: `unknown type "${raw.type}", defaulting to "association"`,
			path: `${path$1}.type`
		});
	}
	const direction = raw.direction === "forward" || raw.direction === "backward" || raw.direction === "bidirectional" ? raw.direction : "forward";
	if (raw.direction !== direction && raw.direction !== void 0) issues.push({
		level: "auto-corrected",
		category: "edge",
		message: `invalid direction "${raw.direction}", defaulting to "forward"`,
		path: `${path$1}.direction`
	});
	let weight = typeof raw.weight === "number" && !Number.isNaN(raw.weight) ? raw.weight : 1;
	if (weight < 0) {
		weight = 0;
		issues.push({
			level: "auto-corrected",
			category: "edge",
			message: "weight clamped to 0",
			path: `${path$1}.weight`
		});
	}
	if (weight > 1) {
		weight = 1;
		issues.push({
			level: "auto-corrected",
			category: "edge",
			message: "weight clamped to 1",
			path: `${path$1}.weight`
		});
	}
	const properties = raw.properties && typeof raw.properties === "object" ? raw.properties : {};
	const edge = {
		id,
		source,
		target,
		type,
		direction,
		weight,
		properties
	};
	return edge;
}
function processRawInput(raw) {
	if (raw === null || raw === void 0 || typeof raw !== "object") return {
		data: {
			nodes: [],
			edges: [],
			metadata: {
				repoId: "",
				timestamp: 0,
				nodeCount: 0,
				edgeCount: 0
			}
		},
		issues: [{
			level: "fatal",
			category: "data",
			message: "input is null or not an object",
			path: "root"
		}]
	};
	const root = raw;
	const issues = [];
	const rawNodes = Array.isArray(root.nodes) ? root.nodes : [];
	const rawEdges = Array.isArray(root.edges) ? root.edges : [];
	const sanitizedNodes = rawNodes.map((n) => sanitizeNode(n)).filter((n) => n !== null);
	const sanitizedEdges = rawEdges.map((e) => sanitizeEdge(e)).filter((e) => e !== null);
	const fixedNodes = [];
	for (const sanitizedNode of sanitizedNodes) {
		const fixed = autoFixNode(sanitizedNode, issues, `node[${fixedNodes.length}]`);
		if (fixed) fixedNodes.push(fixed);
	}
	const fixedEdges = [];
	for (const sanitizedEdge of sanitizedEdges) {
		const fixed = autoFixEdge(sanitizedEdge, issues, `edge[${fixedEdges.length}]`);
		if (fixed) fixedEdges.push(fixed);
	}
	return {
		fixedNodes,
		fixedEdges,
		issues,
		root
	};
}
function buildDefaultMetadata(root, nodeCount, edgeCount) {
	return root.metadata && typeof root.metadata === "object" ? root.metadata : {
		repoId: "",
		timestamp: Date.now(),
		nodeCount,
		edgeCount
	};
}
function sanitizeGraphData(raw) {
	const processed = processRawInput(raw);
	if ("data" in processed) return processed;
	const { fixedNodes, fixedEdges, issues, root } = processed;
	const metadata = buildDefaultMetadata(root, fixedNodes.length, fixedEdges.length);
	const data = {
		nodes: fixedNodes,
		edges: fixedEdges,
		metadata: {
			...metadata,
			nodeCount: fixedNodes.length,
			edgeCount: fixedEdges.length
		}
	};
	return {
		data,
		issues
	};
}

//#endregion
//#region src/merger/GraphDataMerger.ts
var GraphDataMerger = class {
	merge(results, repoId) {
		const nodes = new Map();
		const edges = new Map();
		for (const r of results) {
			for (const node of r.nodes) {
				const existing = nodes.get(node.id);
				if (existing) nodes.set(node.id, {
					...existing,
					...node,
					properties: {
						...existing.properties,
						...node.properties,
						__source: r.source
					}
				});
				else nodes.set(node.id, {
					...node,
					properties: {
						...node.properties,
						__source: r.source
					}
				});
			}
			for (const edge of r.edges) {
				const existing = edges.get(edge.id);
				if (existing) edges.set(edge.id, {
					...existing,
					...edge,
					properties: {
						...existing.properties,
						...edge.properties,
						__source: r.source
					}
				});
				else edges.set(edge.id, {
					...edge,
					properties: {
						...edge.properties,
						__source: r.source
					}
				});
			}
		}
		const rawData = {
			nodes: Array.from(nodes.values()),
			edges: Array.from(edges.values()),
			metadata: {
				repoId,
				timestamp: Date.now(),
				nodeCount: nodes.size,
				edgeCount: edges.size
			}
		};
		const { data, issues } = sanitizeGraphData(rawData);
		if (issues.length > 0) {
			const dropped = issues.filter((i) => i.level === "dropped").length;
			const autoCorrected = issues.filter((i) => i.level === "auto-corrected").length;
			if (dropped > 0 || autoCorrected > 0) {
				data.metadata.nodeCount = data.nodes.length;
				data.metadata.edgeCount = data.edges.length;
			}
		}
		return data;
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
//#region src/shared/analysis/modulePath.ts
function normalizeFilePath(filePath) {
	return filePath.replace(/^(file|import):/, "");
}
function extractModulePath(filePath, maxDepth) {
	const rawPath = normalizeFilePath(filePath);
	const parts = rawPath.split(/[\\/]/);
	const dirParts = parts.length > 1 ? parts.slice(0, -1) : [rawPath];
	return dirParts.length > maxDepth ? dirParts.slice(0, maxDepth).join("/") : dirParts.join("/");
}
function buildModuleMap(nodes, maxDepth) {
	const moduleOfNode = new Map();
	for (const node of nodes) moduleOfNode.set(node.id, extractModulePath(node.filePath, maxDepth));
	return moduleOfNode;
}

//#endregion
//#region src/shared/analysis/AdjacencyList.ts
function buildForwardAdjacency(edges) {
	const map = new Map();
	for (const edge of edges) {
		const list = map.get(edge.source);
		if (list) list.push(edge.target);
		else map.set(edge.source, [edge.target]);
	}
	return map;
}
function buildBackwardAdjacency(edges) {
	const map = new Map();
	for (const edge of edges) {
		const list = map.get(edge.target);
		if (list) list.push(edge.source);
		else map.set(edge.target, [edge.source]);
	}
	return map;
}
function buildFilteredForwardAdjacency(edges, edgeTypes) {
	const map = new Map();
	for (const edge of edges) {
		if (!edgeTypes.includes(edge.type)) continue;
		const list = map.get(edge.source);
		if (list) list.push(edge.target);
		else map.set(edge.source, [edge.target]);
	}
	return map;
}

//#endregion
//#region src/shared/analysis/HealthScorer.ts
const EDGE_WEIGHTS = {
	call: 1,
	extend: .8,
	implement: .7,
	import: .5,
	dependency: .3,
	contains: 0,
	association: .6,
	aggregation: .5,
	composition: .7
};
const DEFAULT_MAX_MODULE_DEPTH = HEALTH_SCORE.DEFAULT_MAX_MODULE_DEPTH;
var HealthScorer = class HealthScorer {
	maxModuleDepth;
	constructor(maxModuleDepth) {
		this.maxModuleDepth = maxModuleDepth ?? DEFAULT_MAX_MODULE_DEPTH;
	}
	calculate(nodes, edges) {
		if (nodes.length === 0) return {
			coupling: 0,
			cohesion: 0,
			cyclicDependencyRate: 0,
			modularity: 0,
			overall: 0
		};
		const moduleOfNode = buildModuleMap(nodes, this.maxModuleDepth);
		const coupling = this.calculateCoupling(edges, moduleOfNode);
		const cohesion = this.calculateCohesion(nodes, edges, moduleOfNode);
		const cyclicDependencyRate = this.calculateCyclicDependencyRate(edges);
		const modularity = this.calculateModularity(nodes, edges, moduleOfNode);
		const overall = Math.round(coupling * HEALTH_SCORE.WEIGHT_COUPLING + cohesion * HEALTH_SCORE.WEIGHT_COHESION + cyclicDependencyRate * HEALTH_SCORE.WEIGHT_CYCLIC + modularity * HEALTH_SCORE.WEIGHT_MODULARITY);
		return {
			coupling,
			cohesion,
			cyclicDependencyRate,
			modularity,
			overall
		};
	}
	getDimensions(score) {
		return [
			{
				name: "coupling",
				score: score.coupling,
				description: "Lower inter-module coupling is better"
			},
			{
				name: "cohesion",
				score: score.cohesion,
				description: "Higher intra-module cohesion is better"
			},
			{
				name: "cyclicDependencyRate",
				score: score.cyclicDependencyRate,
				description: "Fewer circular dependencies is better"
			},
			{
				name: "modularity",
				score: score.modularity,
				description: "Better module separation is better"
			}
		];
	}
	static findOrphanNodes(nodes, edges) {
		const connectedIds = new Set();
		for (const edge of edges) {
			connectedIds.add(edge.source);
			connectedIds.add(edge.target);
		}
		return nodes.filter((n) => !connectedIds.has(n.id));
	}
	static findLeafNodes(nodes, edges) {
		const degreeMap = new Map();
		for (const edge of edges) {
			degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
			degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
		}
		return nodes.filter((n) => (degreeMap.get(n.id) ?? 0) === 1);
	}
	static findHubNodes(nodes, edges, threshold = 10) {
		const degreeMap = new Map();
		for (const edge of edges) {
			degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
			degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
		}
		return nodes.filter((n) => (degreeMap.get(n.id) ?? 0) >= threshold).sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0));
	}
	static calculateOrphanRate(nodes, edges) {
		if (nodes.length === 0) return 0;
		const orphans = HealthScorer.findOrphanNodes(nodes, edges);
		return orphans.length / nodes.length;
	}
	calculateCoupling(edges, moduleOfNode) {
		if (edges.length === 0) return 100;
		const efferent = new Map();
		const afferent = new Map();
		for (const edge of edges) {
			if (EDGE_WEIGHTS[edge.type] === 0) continue;
			const srcModule = moduleOfNode.get(edge.source);
			const tgtModule = moduleOfNode.get(edge.target);
			if (!srcModule || !tgtModule || srcModule === tgtModule) continue;
			let eff = efferent.get(srcModule);
			if (!eff) {
				eff = new Set();
				efferent.set(srcModule, eff);
			}
			eff.add(tgtModule);
			let aff = afferent.get(tgtModule);
			if (!aff) {
				aff = new Set();
				afferent.set(tgtModule, aff);
			}
			aff.add(srcModule);
		}
		const modules = new Set();
		for (const m of moduleOfNode.values()) modules.add(m);
		if (modules.size <= 1) return 100;
		let totalInstability = 0;
		for (const mod of modules) {
			const ce = efferent.get(mod)?.size ?? 0;
			const ca = afferent.get(mod)?.size ?? 0;
			const instability = ce + ca === 0 ? 0 : ce / (ce + ca);
			totalInstability += instability;
		}
		if (modules.size === 0) return 100;
		const avgInstability = totalInstability / modules.size;
		return Math.round(Math.max(0, 100 - avgInstability * 100));
	}
	calculateCohesion(nodes, edges, moduleOfNode) {
		const moduleStats = new Map();
		const ensure = (m) => {
			let stats = moduleStats.get(m);
			if (!stats) {
				stats = {
					internal: 0,
					total: 0,
					nodeCount: 0
				};
				moduleStats.set(m, stats);
			}
			return stats;
		};
		for (const node of nodes) {
			const mod = moduleOfNode.get(node.id);
			if (mod) ensure(mod).nodeCount++;
		}
		for (const edge of edges) {
			if (EDGE_WEIGHTS[edge.type] === 0) continue;
			const srcModule = moduleOfNode.get(edge.source);
			const tgtModule = moduleOfNode.get(edge.target);
			if (!srcModule && !tgtModule) continue;
			if (srcModule && tgtModule && srcModule === tgtModule) {
				const stats = ensure(srcModule);
				stats.total++;
				stats.internal++;
			} else {
				if (srcModule) ensure(srcModule).total++;
				if (tgtModule) ensure(tgtModule).total++;
			}
		}
		if (moduleStats.size === 0) return 50;
		let weightedCohesion = 0;
		let totalNodes = 0;
		for (const stats of moduleStats.values()) {
			if (stats.nodeCount === 0) continue;
			const cohesionRatio = stats.total > 0 ? stats.internal / stats.total : 0;
			weightedCohesion += cohesionRatio * stats.nodeCount;
			totalNodes += stats.nodeCount;
		}
		if (totalNodes === 0) return 50;
		return Math.round(weightedCohesion / totalNodes * 100);
	}
	calculateCyclicDependencyRate(edges) {
		const cycleEdgeTypes = [
			"call",
			"extend",
			"implement",
			"import"
		];
		const adjacency = buildFilteredForwardAdjacency(edges, cycleEdgeTypes);
		const nodeIds = new Set();
		for (const edge of edges) {
			if (!cycleEdgeTypes.includes(edge.type)) continue;
			nodeIds.add(edge.source);
			nodeIds.add(edge.target);
		}
		if (nodeIds.size === 0) return 100;
		const sccs = this.tarjanSCC(adjacency, nodeIds);
		let cycleNodeCount = 0;
		for (const scc of sccs) if (scc.length > 1) cycleNodeCount += scc.length;
		else if (scc.length === 1) {
			const id = scc[0];
			const neighbors = adjacency.get(id);
			if (neighbors && neighbors.includes(id)) cycleNodeCount++;
		}
		const cycleRate = cycleNodeCount / nodeIds.size;
		return Math.round(Math.max(0, 100 - cycleRate * 100));
	}
	calculateModularity(nodes, edges, moduleOfNode) {
		if (nodes.length === 0) return 0;
		const modules = new Set();
		for (const m of moduleOfNode.values()) modules.add(m);
		if (modules.size <= 1) return 50;
		const moduleSizes = new Map();
		for (const m of moduleOfNode.values()) moduleSizes.set(m, (moduleSizes.get(m) ?? 0) + 1);
		const avgSize = nodes.length / modules.size;
		let sizeVariance = 0;
		for (const size of moduleSizes.values()) sizeVariance += (size - avgSize) ** 2;
		sizeVariance /= modules.size;
		const cv = Math.sqrt(sizeVariance) / Math.max(1, avgSize);
		const balanceScore = Math.max(0, 100 - cv * 50);
		let internalEdges = 0;
		let totalRelevantEdges = 0;
		for (const edge of edges) {
			if (EDGE_WEIGHTS[edge.type] === 0) continue;
			const srcModule = moduleOfNode.get(edge.source);
			const tgtModule = moduleOfNode.get(edge.target);
			if (!srcModule || !tgtModule) continue;
			totalRelevantEdges++;
			if (srcModule === tgtModule) internalEdges++;
		}
		if (totalRelevantEdges === 0) return Math.round(balanceScore);
		const internalRatio = internalEdges / totalRelevantEdges;
		const expectedRatio = 1 / modules.size;
		const modularityQ = internalRatio - expectedRatio;
		const separationScore = Math.max(0, Math.min(100, modularityQ * 100 * modules.size + 50));
		return Math.round((balanceScore + separationScore) / 2);
	}
	tarjanSCC(adjacency, nodeIds) {
		let index$1 = 0;
		const indices = new Map();
		const lowLinks = new Map();
		const onStack = new Set();
		const stack = [];
		const sccs = [];
		for (const startId of nodeIds) {
			if (indices.has(startId)) continue;
			const callStack = [];
			callStack.push({
				v: startId,
				neighborIdx: 0,
				neighbors: adjacency.get(startId) ?? []
			});
			while (callStack.length > 0) {
				const frame = callStack[callStack.length - 1];
				const v = frame.v;
				if (frame.neighborIdx === 0) {
					indices.set(v, index$1);
					lowLinks.set(v, index$1);
					index$1++;
					stack.push(v);
					onStack.add(v);
				}
				if (frame.neighborIdx < frame.neighbors.length) {
					const w = frame.neighbors[frame.neighborIdx];
					frame.neighborIdx++;
					if (!indices.has(w)) callStack.push({
						v: w,
						neighborIdx: 0,
						neighbors: adjacency.get(w) ?? []
					});
					else if (onStack.has(w)) lowLinks.set(v, Math.min(lowLinks.get(v), indices.get(w)));
				} else {
					if (lowLinks.get(v) === indices.get(v)) {
						const scc = [];
						let w;
						do {
							w = stack.pop();
							onStack.delete(w);
							scc.push(w);
						} while (w !== v);
						sccs.push(scc);
					}
					callStack.pop();
					if (callStack.length > 0) {
						const parentFrame = callStack[callStack.length - 1];
						lowLinks.set(parentFrame.v, Math.min(lowLinks.get(parentFrame.v), lowLinks.get(v)));
					}
				}
			}
		}
		return sccs;
	}
};

//#endregion
//#region src/shared/analysis/CycleDFS.ts
const MAX_CYCLES_DEFAULT = 1e3;
function detectCyclesDFS(adjacency, maxCycles = MAX_CYCLES_DEFAULT) {
	const visited = new Set();
	const inStack = new Set();
	const cycles = [];
	const seenCycleKeys = new Set();
	const enter = (start) => {
		const path$1 = [];
		const pathIndex = new Map();
		const frames = [{
			id: start,
			neighbors: adjacency.get(start) ?? [],
			next: 0
		}];
		visited.add(start);
		inStack.add(start);
		path$1.push(start);
		pathIndex.set(start, 0);
		while (frames.length > 0) {
			if (cycles.length >= maxCycles) return;
			const frame = frames[frames.length - 1];
			if (frame.next >= frame.neighbors.length) {
				inStack.delete(frame.id);
				path$1.pop();
				pathIndex.delete(frame.id);
				frames.pop();
				continue;
			}
			const target = frame.neighbors[frame.next++];
			if (inStack.has(target)) {
				const cycleStart = pathIndex.get(target);
				if (cycleStart !== void 0) {
					const cycleNodes = path$1.slice(cycleStart);
					const cycleKey = [...cycleNodes, target].sort().join("|");
					if (!seenCycleKeys.has(cycleKey)) {
						seenCycleKeys.add(cycleKey);
						cycles.push([...cycleNodes, target]);
						if (cycles.length >= maxCycles) return;
					}
				}
			} else if (!visited.has(target)) {
				visited.add(target);
				inStack.add(target);
				path$1.push(target);
				pathIndex.set(target, path$1.length - 1);
				frames.push({
					id: target,
					neighbors: adjacency.get(target) ?? [],
					next: 0
				});
			}
		}
	};
	for (const id of adjacency.keys()) {
		if (cycles.length >= maxCycles) break;
		if (!visited.has(id)) enter(id);
	}
	return cycles;
}

//#endregion
//#region src/shared/analysis/RuleEngine.ts
var RuleEngine = class {
	detectors = new Map();
	constructor() {
		this.registerDetector("forbidden-edge", new ForbiddenEdgeDetector());
		this.registerDetector("max-indegree", new MaxIndegreeDetector());
		this.registerDetector("max-outdegree", new MaxOutdegreeDetector());
		this.registerDetector("required-edge", new RequiredEdgeDetector());
		this.registerDetector("cross-layer-call", new CrossLayerCallDetector());
	}
	registerDetector(type, detector) {
		this.detectors.set(type, detector);
	}
	check(rules, nodes, edges) {
		const violations = [];
		for (const rule of rules) {
			if (!rule.enabled) continue;
			const detector = this.detectors.get(rule.type);
			if (detector) violations.push(...detector.detect(rule, nodes, edges));
		}
		return violations;
	}
};
var ForbiddenEdgeDetector = class {
	detect(rule, _nodes, edges) {
		const violations = [];
		const edgeTypes = rule.params.edgeTypes ?? [
			"call",
			"import",
			"dependency"
		];
		const adjacency = buildFilteredForwardAdjacency(edges, edgeTypes);
		const cycles = detectCyclesDFS(adjacency);
		for (const cycle of cycles) {
			const cycleKey = cycle.sort().join("→");
			const firstNode = cycle[0] ?? "";
			violations.push({
				ruleId: rule.id,
				nodeId: NodeId(firstNode),
				message: `Circular dependency detected involving: ${cycleKey}`,
				severity: rule.severity
			});
		}
		return violations;
	}
};
var MaxIndegreeDetector = class {
	detect(rule, _nodes, edges) {
		const violations = [];
		const threshold = rule.params.threshold ?? 10;
		const indegree = new Map();
		for (const edge of edges) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
		for (const [nodeId, count] of indegree) if (count > threshold) violations.push({
			ruleId: rule.id,
			nodeId: NodeId(nodeId),
			message: `Node ${nodeId} has indegree ${count} (max ${threshold})`,
			severity: rule.severity
		});
		return violations;
	}
};
var MaxOutdegreeDetector = class {
	detect(rule, _nodes, edges) {
		const violations = [];
		const threshold = rule.params.threshold ?? 15;
		const outdegree = new Map();
		for (const edge of edges) outdegree.set(edge.source, (outdegree.get(edge.source) ?? 0) + 1);
		for (const [nodeId, count] of outdegree) if (count > threshold) violations.push({
			ruleId: rule.id,
			nodeId: NodeId(nodeId),
			message: `Node ${nodeId} has outdegree ${count} (max ${threshold})`,
			severity: rule.severity
		});
		return violations;
	}
};
var RequiredEdgeDetector = class {
	detect(rule, nodes, edges) {
		const violations = [];
		const requiredType = rule.params.edgeType ?? "call";
		const sourceType = rule.params.sourceType ?? void 0;
		const targetType = rule.params.targetType ?? void 0;
		const nodeMap = new Map();
		for (const n of nodes) nodeMap.set(n.id, n);
		const hasEdge = new Set();
		for (const edge of edges) {
			if (edge.type !== requiredType) continue;
			if (sourceType) {
				const src = nodeMap.get(edge.source);
				if (!src || src.type !== sourceType) continue;
			}
			if (targetType) {
				const tgt = nodeMap.get(edge.target);
				if (!tgt || tgt.type !== targetType) continue;
			}
			hasEdge.add(edge.source);
		}
		for (const n of nodes) {
			if (sourceType && n.type !== sourceType) continue;
			if (!hasEdge.has(n.id)) violations.push({
				ruleId: rule.id,
				nodeId: NodeId(n.id),
				message: `Node ${n.label} is missing required ${requiredType} edge`,
				severity: rule.severity
			});
		}
		return violations;
	}
};
var CrossLayerCallDetector = class {
	detect(rule, nodes, edges) {
		const violations = [];
		const layerMap = rule.params.layers ?? {};
		const callType = rule.params.edgeType ?? "call";
		if (Object.keys(layerMap).length === 0) return violations;
		const nodeLayer = new Map();
		for (const n of nodes) for (const [layerName, patterns] of Object.entries(layerMap)) if (patterns.some((p) => {
			const seg = n.filePath.split(/[\\/]/);
			return seg.indexOf(p) >= 0 || n.label === p;
		})) {
			nodeLayer.set(n.id, layerName);
			break;
		}
		const forbiddenPairs = new Set();
		for (const [srcLayer, tgtLayers] of Object.entries(layerMap)) for (const tgtLayer of tgtLayers) forbiddenPairs.add(`${srcLayer}->${tgtLayer}`);
		for (const edge of edges) {
			if (edge.type !== callType) continue;
			const srcLayer = nodeLayer.get(edge.source);
			const tgtLayer = nodeLayer.get(edge.target);
			if (!srcLayer || !tgtLayer) continue;
			if (forbiddenPairs.has(`${srcLayer}->${tgtLayer}`)) violations.push({
				ruleId: rule.id,
				edgeId: EdgeId(edge.id),
				message: `Cross-layer call from ${srcLayer} to ${tgtLayer}`,
				severity: rule.severity
			});
		}
		return violations;
	}
};

//#endregion
//#region src/shared/analysis/GraphBFS.ts
function bfsShortestPath(adjacency, source, target, maxNodes) {
	if (source === target) return {
		path: [source],
		length: 0,
		truncated: false
	};
	const visited = new Set([source]);
	const predecessor = new Map();
	const queue = [source];
	let head = 0;
	while (head < queue.length) {
		if (visited.size > maxNodes) return {
			path: [],
			length: 0,
			truncated: true
		};
		const id = queue[head++];
		if (id === target) {
			const path$1 = [];
			let cur = id;
			while (cur !== void 0) {
				path$1.unshift(cur);
				cur = predecessor.get(cur);
			}
			return {
				path: path$1,
				length: path$1.length - 1,
				truncated: false
			};
		}
		const neighbors = adjacency.get(id) ?? [];
		for (const next of neighbors) if (!visited.has(next)) {
			visited.add(next);
			predecessor.set(next, id);
			queue.push(next);
		}
	}
	return null;
}
function bfsFrontierExpansion(reverseAdjacency, startNode, depth, maxResults) {
	const impacted = new Set();
	let frontier = new Set([startNode]);
	for (let d = 0; d < depth && impacted.size < maxResults; d++) {
		const nextFrontier = new Set();
		for (const id of frontier) {
			if (impacted.size >= maxResults) break;
			const sources = reverseAdjacency.get(id) ?? [];
			for (const src of sources) {
				if (impacted.size >= maxResults) break;
				if (!impacted.has(src)) {
					impacted.add(src);
					nextFrontier.add(src);
				}
			}
		}
		frontier = nextFrontier;
	}
	return {
		impacted: Array.from(impacted),
		count: impacted.size,
		truncated: impacted.size >= maxResults
	};
}

//#endregion
//#region src/graphUtils.ts
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
function renderGraphStatus(_args, value) {
	const v = value;
	const srcInfo = v.sources ? ` [codegraph:${v.sources.codegraph ? "✓" : "✗"} lens:${v.sources.lens ? "✓" : "✗"}]` : "";
	return [{
		type: "text",
		text: `Graph status: ${v.status} (${v.nodeCount} nodes, ${v.edgeCount} edges)${srcInfo}`
	}];
}
function renderGraphData(_args, value) {
	const data = value;
	return [{
		type: "text",
		text: summarizeGraph(data)
	}];
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
function renderGraphImpact(_args, value) {
	const v = value;
	const count = v.affected?.length ?? 0;
	const list = v.affected?.slice(0, 10).join(", ") ?? "";
	return [{
		type: "text",
		text: `Impact: ${count} symbols affected (depth ${v.depth ?? 0})${list ? `\n  ${list}` : ""}`
	}];
}

//#endregion
//#region src/tools.ts
const log$12 = scoped("tools");
function toJsonValue(value) {
	return JSON.parse(JSON.stringify(value));
}
const GRAPH_CACHE_LIMIT = CACHE.GRAPH_CACHE_LIMIT;
async function createGraphToolDeps() {
	const [{ CodeGraphAdapter: CGA }, { LensAdapter: LA }] = await Promise.all([import("./CodeGraphAdapter-BoiExSfA.js"), import("./LensAdapter-BfMLy2m0.js")]);
	return {
		codegraphAdapter: new CGA(),
		lensAdapter: new LA(),
		merger: new GraphDataMerger()
	};
}
function cacheGraph(cache, repoId, data) {
	cache.delete(repoId);
	cache.set(repoId, data);
	if (cache.size > GRAPH_CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest !== void 0) cache.delete(oldest);
	}
}
async function fetchMergedGraph(invoke, repoId, source = "both", deps) {
	const d = deps ?? await createGraphToolDeps();
	const tasks = [];
	if (source === "codegraph" || source === "both" || source === "auto") tasks.push(d.codegraphAdapter.fetchData(repoId, invoke));
	if (source === "lens" || source === "both" || source === "auto") tasks.push(d.lensAdapter.fetchData(repoId, invoke));
	const settled = await Promise.allSettled(tasks);
	const results = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
	const merged = d.merger.merge(results, RepoId(repoId));
	if (source === "auto" && merged.nodes.length === 0) log$12.info("fetchMergedGraph: auto mode — external sources returned empty, built-in analysis always available");
	return merged;
}
function createInvoke(ctx, requestTimeout = API.INVOKE_DEFAULT_TIMEOUT_MS, apiCompat) {
	return async (tool, args) => {
		let resolvedName = tool;
		if (apiCompat) {
			const mapped = apiCompat.getAvailableToolNameFor(ctx, tool);
			if (mapped) resolvedName = mapped;
		}
		try {
			const result = await ctx.tools.execute({
				callId: ToolCallId(`codegraph:${resolvedName}`),
				name: resolvedName,
				arguments: args,
				signal: AbortSignal.timeout(requestTimeout)
			});
			if (result.isError) return null;
			return result.value ?? null;
		} catch (e) {
			log$12.warn("createInvoke: tool execution failed", {
				tool: resolvedName,
				error: e
			});
			return null;
		}
	};
}
async function executeGraphStatus(args, invoke, deps) {
	const [cgResult, lensResult] = await Promise.allSettled([deps.codegraphAdapter.fetchData(args.repoId, invoke), deps.lensAdapter.fetchData(args.repoId, invoke)]);
	const results = [cgResult, lensResult].filter((r) => r.status === "fulfilled").map((r) => r.value);
	const data = deps.merger.merge(results, RepoId(args.repoId));
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
async function executeGraphData(args, invoke, emitUpdate, emitData, graphCache, deps) {
	const source = args.source ?? "both";
	const fresh = await fetchMergedGraph(invoke, args.repoId, source, deps);
	const cached = graphCache.get(args.repoId);
	const merged = cached ? deps.merger.applyDelta(cached, {
		nodes: fresh.nodes,
		edges: fresh.edges,
		source: source === "both" ? "codegraph" : source,
		timestamp: fresh.metadata.timestamp
	}) : fresh;
	cacheGraph(graphCache, args.repoId, merged);
	emitUpdate({
		repoId: RepoId(args.repoId),
		nodeCount: merged.metadata.nodeCount,
		edgeCount: merged.metadata.edgeCount,
		timestamp: merged.metadata.timestamp
	});
	emitData({
		repoId: RepoId(args.repoId),
		nodes: merged.nodes,
		edges: merged.edges,
		timestamp: merged.metadata.timestamp
	});
	return toJsonValue(merged);
}
async function executeGraphSymbol(args, invoke) {
	const raw = await invoke("codegraph_query", {
		search: args.symbolId,
		limit: 1
	});
	return toJsonValue(pickBestMatch(raw, args.symbolId));
}
async function executeGraphImpact(args, invoke) {
	const raw = await invoke("codegraph_impact", {
		symbol: args.symbolId,
		depth: 2
	});
	const normalized = normalizeImpact(raw);
	if (normalized) return toJsonValue(normalized);
	const lens = await invoke("lens_impact", { symbolId: args.symbolId });
	return toJsonValue(lens ?? {
		affected: [],
		depth: 0
	});
}
const createGraphTools = async (ctx, options = {}) => {
	const invoke = createInvoke(ctx, options.requestTimeout, options.apiCompat);
	const graphCache = new Map();
	const deps = await createGraphToolDeps();
	const emitUpdate = (event) => {
		ctx.emit("codegraph-visualizer/graph/updated", event);
	};
	const emitData = (event) => {
		ctx.emit("codegraph-visualizer/graph/data", event);
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
		presentCall: (args) => {
			const a = args;
			return {
				card: "generic",
				title: "Check graph status",
				kind: "other",
				rawInput: { repoId: a.repoId }
			};
		},
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "Graph status failed" : "Graph status"
		}),
		execute: (args) => executeGraphStatus(args, invoke, deps)
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
					"both",
					"auto"
				],
				description: "Data source; defaults to both. Use auto for graceful degradation to built-in analysis."
			}
		},
		output: {
			schema: { type: "json" },
			render: renderGraphData
		},
		presentCall: (args) => {
			const a = args;
			return {
				card: "generic",
				title: "Fetch code graph",
				kind: "fetch",
				rawInput: {
					repoId: a.repoId,
					source: a.source ?? "both"
				}
			};
		},
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "Graph fetch failed" : "Code graph fetched"
		}),
		execute: (args) => executeGraphData(args, invoke, emitUpdate, emitData, graphCache, deps)
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
		presentCall: (args) => {
			const a = args;
			return {
				card: "generic",
				title: "Resolve symbol",
				kind: "search",
				rawInput: { symbolId: a.symbolId }
			};
		},
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "Symbol resolution failed" : "Symbol resolved"
		}),
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
		presentCall: (args) => {
			const a = args;
			return {
				card: "generic",
				title: "Analyze impact",
				kind: "search",
				rawInput: { symbolId: a.symbolId }
			};
		},
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "Impact analysis failed" : "Impact analyzed"
		}),
		execute: (args) => executeGraphImpact(args, invoke)
	});
	const graphPathFind = defineTool({
		name: "graph_path_find",
		description: "Find the shortest call path between two symbols in the code graph.",
		parameters: {
			repoId: {
				type: "string",
				required: true,
				description: "Repository id."
			},
			sourceSymbol: {
				type: "string",
				required: true,
				description: "Source symbol id."
			},
			targetSymbol: {
				type: "string",
				required: true,
				description: "Target symbol id."
			}
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => {
				const v = value;
				if (!v || !v.path || v.path.length === 0) {
					if (v?.truncated) return [{
						type: "text",
						text: TOOL_MESSAGES.GRAPH_TOO_LARGE_FOR_PATH?.en ?? "Graph too large"
					}];
					return [{
						type: "text",
						text: TOOL_MESSAGES.NO_PATH_FOUND?.en ?? "No path found"
					}];
				}
				return [{
					type: "text",
					text: `${TOOL_MESSAGES.PATH_FOUND?.en ?? "Path found"} (${v.length} ${TOOL_MESSAGES.HOPS?.en ?? "hops"}): ${v.path.join(" → ")}`
				}];
			}
		},
		presentCall: (args) => {
			const a = args;
			return {
				card: "generic",
				title: "Find call path",
				kind: "search",
				rawInput: {
					from: a.sourceSymbol,
					to: a.targetSymbol
				}
			};
		},
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "Path search failed" : "Call path"
		}),
		execute: async (args) => {
			const a = args;
			const data = await fetchMergedGraph(invoke, a.repoId);
			const nodeIds = new Set(data.nodes.map((n) => n.id));
			if (!nodeIds.has(NodeId(a.sourceSymbol)) || !nodeIds.has(NodeId(a.targetSymbol))) return null;
			if (data.nodes.length > PATH_FINDER.MAX_NODES_FOR_BFS) return toJsonValue({
				path: [],
				length: 0,
				truncated: true
			});
			const adjacency = buildForwardAdjacency(data.edges);
			const result = bfsShortestPath(adjacency, a.sourceSymbol, a.targetSymbol, data.nodes.length);
			if (!result) return null;
			return toJsonValue({
				path: result.path,
				length: result.length
			});
		}
	});
	const graphHealth = defineTool({
		name: "graph_health",
		description: "Calculate architecture health score (coupling, cohesion, cyclic dependency rate, modularity).",
		parameters: { repoId: {
			type: "string",
			required: true,
			description: "Repository id."
		} },
		output: {
			schema: { type: "json" },
			render: (_args, value) => {
				const v = value;
				if (!v) return [{
					type: "text",
					text: TOOL_MESSAGES.INSUFFICIENT_DATA?.en ?? "Insufficient data"
				}];
				return [{
					type: "text",
					text: `Architecture Health: ${v.overall}/100\n  Coupling: ${v.coupling}/100\n  Cohesion: ${v.cohesion}/100\n  Cyclic Dep Rate: ${v.cyclicDependencyRate}/100\n  Modularity: ${v.modularity}/100`
				}];
			}
		},
		presentCall: (args) => {
			const a = args;
			return {
				card: "generic",
				title: "Calculate health score",
				kind: "other",
				rawInput: { repoId: a.repoId }
			};
		},
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "Health scoring failed" : "Health score"
		}),
		execute: async (args) => {
			const a = args;
			const data = await fetchMergedGraph(invoke, a.repoId);
			if (data.nodes.length === 0) return null;
			const scorer = new HealthScorer();
			const score = scorer.calculate(data.nodes, data.edges);
			return toJsonValue(score);
		}
	});
	const graphRulesCheck = defineTool({
		name: "graph_rules_check",
		description: "Check code graph against architecture rules (max indegree, max outdegree, circular dependencies).",
		parameters: {
			repoId: {
				type: "string",
				required: true,
				description: "Repository id."
			},
			maxIndegree: {
				type: "number",
				description: "Maximum allowed indegree per node. Default: 10."
			},
			maxOutdegree: {
				type: "number",
				description: "Maximum allowed outdegree per node. Default: 15."
			}
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => {
				const v = value;
				if (!v || v.length === 0) return [{
					type: "text",
					text: TOOL_MESSAGES.NO_VIOLATIONS?.en ?? "No violations"
				}];
				const lines = v.slice(0, 20).map((r) => `  [${r.severity}] ${r.message}`);
				return [{
					type: "text",
					text: `${v.length} ${TOOL_MESSAGES.RULE_VIOLATIONS?.en ?? "rule violations:"}\n${lines.join("\n")}`
				}];
			}
		},
		presentCall: (args) => {
			const a = args;
			return {
				card: "generic",
				title: "Check architecture rules",
				kind: "other",
				rawInput: {
					repoId: a.repoId,
					maxIndegree: a.maxIndegree ?? 10,
					maxOutdegree: a.maxOutdegree ?? 15
				}
			};
		},
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "Rules check failed" : "Rules checked"
		}),
		execute: async (args) => {
			const a = args;
			const data = await fetchMergedGraph(invoke, a.repoId, "both", deps);
			if (data.nodes.length === 0) return null;
			const maxIn = a.maxIndegree ?? 10;
			const maxOut = a.maxOutdegree ?? 15;
			const rules = [{
				id: "max-indegree",
				name: "Max Indegree",
				type: "max-indegree",
				params: { threshold: maxIn },
				severity: "warning",
				enabled: true
			}, {
				id: "max-outdegree",
				name: "Max Outdegree",
				type: "max-outdegree",
				params: { threshold: maxOut },
				severity: "warning",
				enabled: true
			}];
			const engine = new RuleEngine();
			const violations = engine.check(rules, data.nodes, data.edges);
			return toJsonValue(violations);
		}
	});
	const graphFocus = defineTool({
		name: "graph_focus",
		description: "Get the neighborhood (1-hop neighbors) of a symbol in the code graph.",
		parameters: {
			repoId: {
				type: "string",
				required: true,
				description: "Repository id."
			},
			symbolId: {
				type: "string",
				required: true,
				description: "Symbol id to focus on."
			}
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => {
				const v = value;
				if (!v) return [{
					type: "text",
					text: "Symbol not found in graph."
				}];
				return [{
					type: "text",
					text: `Focus on ${v.symbolId}: ${v.neighbors?.length ?? 0} direct neighbors\n  ${v.neighbors?.slice(0, 15).join(", ") ?? ""}`
				}];
			}
		},
		presentCall: (args) => {
			const a = args;
			return {
				card: "generic",
				title: "Focus on symbol",
				kind: "search",
				rawInput: { symbolId: a.symbolId }
			};
		},
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "Focus failed" : "Symbol neighborhood"
		}),
		execute: async (args) => {
			const a = args;
			const data = await fetchMergedGraph(invoke, a.repoId);
			const nodeIds = new Set(data.nodes.map((n) => n.id));
			if (!nodeIds.has(NodeId(a.symbolId))) return null;
			const neighbors = new Set();
			for (const edge of data.edges) {
				if (edge.source === a.symbolId) neighbors.add(edge.target);
				if (edge.target === a.symbolId) neighbors.add(edge.source);
			}
			return toJsonValue({
				symbolId: a.symbolId,
				neighbors: [...neighbors]
			});
		}
	});
	return {
		graphStatus,
		graphData,
		graphSymbol,
		graphImpact,
		graphPathFind,
		graphHealth,
		graphRulesCheck,
		graphFocus,
		dispose: () => graphCache.clear()
	};
};

//#endregion
//#region src/generated/version.ts
const PLUGIN_VERSION = "0.2.0";

//#endregion
//#region src/host/config.ts
const VALID_DATA_SOURCES = new Set([
	"auto",
	"codegraph",
	"lens",
	"tree-sitter",
	"dependency"
]);
const ORIGIN_PATTERN = /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/;
const DEFAULT_CONFIG = {
	dataSource: "auto",
	requestTimeout: 15e3,
	scanCacheTtl: 3e4,
	scanCacheLimit: 4,
	maxBodyBytes: 1024 * 1024,
	prerequisiteRetryDelay: 3e3,
	watchDebounce: 500,
	maxNodes: 5e5,
	allowedOrigins: ["http://localhost:3080"],
	panelMinHeight: 240,
	panelDefaultHeight: 600
};
function resolveConfig(userConfig) {
	const config = {
		...DEFAULT_CONFIG,
		...userConfig
	};
	const errors = [];
	if (!VALID_DATA_SOURCES.has(config.dataSource)) errors.push(`dataSource must be auto|codegraph|lens|tree-sitter, got ${String(config.dataSource)}`);
	for (const origin of config.allowedOrigins) if (!ORIGIN_PATTERN.test(origin)) errors.push(`allowedOrigins contains invalid origin: ${origin} (expected http(s)://host[:port])`);
	const positiveFields = [
		["requestTimeout", config.requestTimeout],
		["scanCacheTtl", config.scanCacheTtl],
		["scanCacheLimit", config.scanCacheLimit],
		["maxBodyBytes", config.maxBodyBytes],
		["prerequisiteRetryDelay", config.prerequisiteRetryDelay],
		["watchDebounce", config.watchDebounce],
		["maxNodes", config.maxNodes],
		["panelMinHeight", config.panelMinHeight],
		["panelDefaultHeight", config.panelDefaultHeight]
	];
	for (const [field, value] of positiveFields) if (!Number.isFinite(value) || value <= 0) errors.push(`${field} must be a positive finite number, got ${String(value)}`);
	if (config.panelDefaultHeight < config.panelMinHeight) errors.push(`panelDefaultHeight (${config.panelDefaultHeight}) must be >= panelMinHeight (${config.panelMinHeight})`);
	if (errors.length > 0) throw new Error(`${ERROR_CODES.INVALID_CONFIG}: ${errors.join("; ")}`);
	return config;
}

//#endregion
//#region src/host/security.ts
const isCaseInsensitive = platform() === "win32";
function normalizeForComparison(p) {
	const n = normalize(p);
	return isCaseInsensitive ? n.toLowerCase() : n;
}
var SecurityManager = class {
	allowedWorkspaceRoots = [];
	setAllowedWorkspaceRoots(roots) {
		this.allowedWorkspaceRoots = roots.map((r) => normalizeForComparison(r));
	}
	isPathAllowed(path$1) {
		if (!path$1) return false;
		const normalized = normalize(path$1);
		if (normalized.includes("..")) return false;
		if (!isAbsolute(normalized)) return false;
		if (this.allowedWorkspaceRoots.length === 0) return false;
		const cmpPath = normalizeForComparison(normalized);
		return this.allowedWorkspaceRoots.some((root) => cmpPath === root || cmpPath.startsWith(root + sep));
	}
	reset() {
		this.allowedWorkspaceRoots = [];
	}
};
function createSecurityManager() {
	return new SecurityManager();
}

//#endregion
//#region src/host/prerequisites.ts
const log$11 = scoped("host");
const execFileAsync = promisify(execFile);
function checkPrerequisites(ctx, apiCompat) {
	try {
		let cg = null;
		if (apiCompat) {
			const toolName = apiCompat.getAvailableToolName(ctx, "codegraphStatus");
			if (toolName) cg = ctx.tools.get(toolName);
		} else cg = ctx.tools.get("codegraph_status") ?? ctx.tools.get("codegraph_graph") ?? ctx.tools.get("codegraph_query");
		let lens = null;
		if (apiCompat) {
			const lensName = apiCompat.getAvailableToolName(ctx, "lensAnalyze");
			if (lensName) lens = ctx.tools.get(lensName);
		} else lens = ctx.tools.get("lens_analyze");
		return {
			codegraph: !!cg,
			lens: !!lens,
			builtin: true
		};
	} catch (e) {
		log$11.warn("checkPrerequisites failed", e);
		return {
			codegraph: false,
			lens: false,
			builtin: true
		};
	}
}
function getSessions(ctx) {
	return ctx.sessions;
}
function getWorkspaceRegistry(ctx) {
	return ctx.workspaceRegistry;
}
function extractWorkspacePaths(ctx) {
	try {
		const wsr = getWorkspaceRegistry(ctx);
		if (wsr?.list) {
			const workspaces = wsr.list();
			const paths = workspaces.map((w) => w.path).filter((p) => !!p);
			if (paths.length > 0) return paths;
		}
	} catch (e) {
		log$11.warn("extractWorkspacePaths: workspaceRegistry failed", e);
	}
	try {
		const sessions = getSessions(ctx);
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
	} catch (e) {
		log$11.warn("extractWorkspacePaths: sessions failed", e);
	}
	return [process.cwd()];
}
function findWorkspacePath(ctx) {
	try {
		const wsr = getWorkspaceRegistry(ctx);
		if (wsr?.list) {
			const workspaces = wsr.list();
			if (workspaces.length > 0 && workspaces[0]?.path) return workspaces[0].path;
		}
	} catch (e) {
		log$11.warn("findWorkspacePath: workspaceRegistry failed", e);
	}
	try {
		const sessions = getSessions(ctx);
		if (sessions?.list) {
			const all = sessions.list();
			for (const session of all) {
				const cwd = session?.header?.cwd;
				if (cwd) return cwd;
			}
		}
	} catch (e) {
		log$11.warn("findWorkspacePath: sessions failed", e);
	}
	return process.cwd();
}

//#endregion
//#region src/adapters/TreeSitterAdapter.ts
const log$10 = scoped("tree-sitter-adapter");
const SUPPORTED_LANGUAGES = [
	"typescript",
	"javascript",
	"python",
	"java",
	"rust",
	"go"
];
const FILE_EXTENSIONS = {
	".ts": "typescript",
	".tsx": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".java": "java",
	".rs": "rust",
	".go": "go"
};
const FUNCTION_NODE_TYPES = new Set([
	"function_declaration",
	"function_definition",
	"method_declaration",
	"method_definition",
	"arrow_function"
]);
const CLASS_NODE_TYPES = new Set([
	"class_declaration",
	"class_definition",
	"struct_declaration",
	"interface_declaration"
]);
const VARIABLE_NODE_TYPES = new Set([
	"variable_declaration",
	"const_declaration",
	"let_declaration",
	"assignment"
]);
const IMPORT_NODE_TYPES = new Set([
	"import_statement",
	"import_declaration",
	"use_declaration"
]);
const COMMENT_NODE_TYPES = new Set([
	"comment",
	"line_comment",
	"block_comment"
]);
const TODO_PATTERNS = /\b(TODO|FIXME|HACK|XXX|BUG)\b/g;
var TreeSitterAdapter = class TreeSitterAdapter {
	source = "tree-sitter";
	parser = null;
	loadedLanguages = new Set();
	currentLanguage = null;
	initAttempts = 0;
	static MAX_INIT_ATTEMPTS = 3;
	async init() {
		if (this.parser) return;
		if (this.initAttempts >= TreeSitterAdapter.MAX_INIT_ATTEMPTS) {
			log$10.warn(`TreeSitter init skipped after ${this.initAttempts} failed attempts`);
			return;
		}
		this.initAttempts++;
		try {
			const { Parser } = await import("web-tree-sitter");
			await Parser.init();
			this.parser = new Parser();
			this.initAttempts = 0;
			log$10.info("TreeSitter parser initialized");
		} catch (e) {
			log$10.warn(`Failed to init TreeSitter (attempt ${this.initAttempts}/${TreeSitterAdapter.MAX_INIT_ATTEMPTS})`, e);
		}
	}
	isAvailable() {
		return this.parser !== null;
	}
	getSupportedLanguages() {
		return SUPPORTED_LANGUAGES;
	}
	detectLanguage(filePath) {
		for (const [ext, lang] of Object.entries(FILE_EXTENSIONS)) if (filePath.endsWith(ext)) return lang;
		return null;
	}
	async ensureLanguageLoaded(language) {
		if (!this.parser) return false;
		if (this.loadedLanguages.has(language)) return true;
		try {
			const langModule = await this.loadLanguageWasm(language);
			if (this.currentLanguage) try {
				this.currentLanguage.delete?.();
			} catch (e) {
				log$10.debug("old language cleanup failed", { error: e });
			}
			const parser = this.parser;
			if (!parser) return false;
			parser.setLanguage(langModule);
			this.currentLanguage = langModule;
			this.loadedLanguages.add(language);
			return true;
		} catch (e) {
			log$10.warn(`Failed to load language: ${language}`, e);
			return false;
		}
	}
	async parseFile(filePath, content) {
		if (!this.parser) {
			await this.init();
			if (!this.parser) return {
				nodes: [],
				edges: [],
				source: "tree-sitter",
				timestamp: Date.now(),
				error: "Parser not initialized"
			};
		}
		const language = this.detectLanguage(filePath);
		if (!language) return {
			nodes: [],
			edges: [],
			source: "tree-sitter",
			timestamp: Date.now(),
			error: `Unsupported file: ${filePath}`
		};
		if (!await this.ensureLanguageLoaded(language)) return {
			nodes: [],
			edges: [],
			source: "tree-sitter",
			timestamp: Date.now(),
			error: `Failed to load ${language}`
		};
		try {
			const tree = this.parser.parse(content);
			const { nodes, edges } = this.extractSymbols(tree.rootNode, filePath);
			tree.delete();
			return {
				nodes,
				edges,
				source: "tree-sitter",
				timestamp: Date.now()
			};
		} catch (e) {
			log$10.warn("parseFile failed", {
				filePath,
				error: e
			});
			return {
				nodes: [],
				edges: [],
				source: "tree-sitter",
				timestamp: Date.now(),
				error: String(e)
			};
		}
	}
	async batchScan(files) {
		if (!this.parser) {
			await this.init();
			if (!this.parser) return {
				nodes: [],
				edges: [],
				source: "tree-sitter",
				timestamp: Date.now(),
				error: "Parser not initialized"
			};
		}
		const allNodes = [];
		const allEdges = [];
		const errors = [];
		for (let i = 0; i < files.length; i += TREE_SITTER.BATCH_SIZE) {
			const batch = files.slice(i, i + TREE_SITTER.BATCH_SIZE);
			const results = await Promise.all(batch.map(async (file) => {
				const language = this.detectLanguage(file.filePath);
				if (!language) return null;
				if (!await this.ensureLanguageLoaded(language)) return null;
				try {
					const tree = this.parser.parse(file.content);
					const { nodes, edges } = this.extractSymbols(tree.rootNode, file.filePath);
					tree.delete();
					return {
						nodes,
						edges
					};
				} catch (e) {
					errors.push(`${file.filePath}: ${String(e)}`);
					return null;
				}
			}));
			for (const result of results) if (result) {
				allNodes.push(...result.nodes);
				allEdges.push(...result.edges);
			}
		}
		log$10.info(`batchScan: ${files.length} files, ${allNodes.length} nodes, ${allEdges.length} edges, ${errors.length} errors`);
		return {
			nodes: allNodes,
			edges: allEdges,
			source: "tree-sitter",
			timestamp: Date.now(),
			...errors.length > 0 ? { error: errors.join("; ") } : {}
		};
	}
	async loadLanguageWasm(language) {
		const wasmFile = `tree-sitter-${language}.wasm`;
		const { Language } = await import("web-tree-sitter");
		const candidates = [];
		if (typeof process !== "undefined" && process.versions?.node) try {
			const { getWasmPath } = await import("tree-sitter-wasm");
			const absPath = getWasmPath(language);
			candidates.push(absPath);
		} catch (e) {
			log$10.debug("tree-sitter-wasm not available", { error: e });
		}
		const doc = globalThis.document;
		if (doc && doc.baseURI) {
			try {
				candidates.push(new URL(`plugins/dsh-codegraph-visualizer/${wasmFile}`, doc.baseURI).href);
			} catch (e) {
				log$10.debug("URL resolution fallback", { error: e });
			}
			try {
				candidates.push(new URL(`node_modules/web-tree-sitter/dist/${wasmFile}`, doc.baseURI).href);
			} catch (e) {
				log$10.debug("URL resolution fallback", { error: e });
			}
			try {
				candidates.push(new URL(wasmFile, doc.baseURI).href);
			} catch (e) {
				log$10.debug("URL resolution fallback", { error: e });
			}
		}
		candidates.push(wasmFile);
		for (const path$1 of candidates) try {
			return await Language.load(path$1);
		} catch (e) {
			log$10.debug("candidate path failed", {
				path: path$1,
				error: e
			});
		}
		throw new Error(`Cannot load ${wasmFile} from any candidate path`);
	}
	extractSymbols(rootNode, filePath) {
		const nodes = [];
		const edges = [];
		const visited = new Set();
		const nodeMap = new Map();
		const extractName = (node) => {
			const nameNode = node.childForFieldName?.("name") || node.children?.find((c) => c.type === "identifier" || c.type === "property_identifier");
			return nameNode ? nameNode.text : `<${node.type}>`;
		};
		const makeId = (node, label) => `${filePath}:${label}:${node.startPosition.row}`;
		const walk = (rootNode$1) => {
			const stack = [{
				node: rootNode$1,
				parentId: void 0
			}];
			while (stack.length > 0) {
				const { node, parentId } = stack.pop();
				if (!node) continue;
				const nodeType = node.type;
				let graphType = null;
				if (FUNCTION_NODE_TYPES.has(nodeType)) graphType = "function";
				else if (CLASS_NODE_TYPES.has(nodeType)) graphType = "class";
				else if (VARIABLE_NODE_TYPES.has(nodeType)) graphType = "variable";
				else if (IMPORT_NODE_TYPES.has(nodeType)) graphType = "module";
				let currentParentId = parentId;
				if (graphType) {
					const label = extractName(node);
					const id = makeId(node, label);
					if (!visited.has(id)) {
						visited.add(id);
						const graphNode = {
							id: NodeId(id),
							label,
							type: graphType,
							filePath,
							lineNumber: node.startPosition.row + 1,
							properties: {
								source: "tree-sitter",
								nodeType
							},
							...parentId ? { parentId: NodeId(parentId) } : {},
							layer: inferLayerFromPath(filePath)
						};
						nodes.push(graphNode);
						nodeMap.set(id, graphNode);
						if (parentId) edges.push({
							id: EdgeId(`tsedge:${parentId}->${id}`),
							source: NodeId(parentId),
							target: NodeId(id),
							type: "contains",
							properties: {}
						});
					}
					currentParentId = id;
				}
				if (COMMENT_NODE_TYPES.has(nodeType)) {
					const text$1 = node.text;
					const matches = text$1.match(TODO_PATTERNS);
					if (matches && parentId) {
						const parentNode = nodeMap.get(parentId);
						if (parentNode) {
							const hasTodo = matches.some((m) => m === "TODO");
							const hasFixme = matches.some((m) => m === "FIXME");
							const existingTags = parentNode.tags ?? [];
							const newTags = [];
							if (hasTodo && !existingTags.includes("todo")) newTags.push("todo");
							if (hasFixme && !existingTags.includes("fixme")) newTags.push("fixme");
							if (newTags.length > 0) parentNode.tags = [...existingTags, ...newTags];
							const existingTodoCount = parentNode.properties.todoCount ?? 0;
							const existingFixmeCount = parentNode.properties.fixmeCount ?? 0;
							if (hasTodo) parentNode.properties.todoCount = existingTodoCount + 1;
							if (hasFixme) parentNode.properties.fixmeCount = existingFixmeCount + 1;
							parentNode.properties.hasTodoFixme = true;
						}
					}
				}
				for (let i = (node.childCount || 0) - 1; i >= 0; i--) {
					const child = node.child(i);
					if (child) stack.push({
						node: child,
						parentId: currentParentId
					});
				}
			}
		};
		walk(rootNode);
		return {
			nodes,
			edges
		};
	}
	async parseToAst(filePath, content) {
		if (!this.parser) {
			await this.init();
			if (!this.parser) {
				log$10.warn("parseToAst: parser not initialized after init()");
				return null;
			}
		}
		const language = this.detectLanguage(filePath);
		if (!language) {
			log$10.warn(`parseToAst: unsupported file extension: ${filePath}`);
			return null;
		}
		if (!await this.ensureLanguageLoaded(language)) {
			log$10.warn(`parseToAst: failed to load language ${language}`);
			return null;
		}
		try {
			const tree = this.parser.parse(content);
			const astRoot = this.convertToAstNode(tree.rootNode);
			tree.delete();
			return astRoot;
		} catch (e) {
			log$10.warn(`parseToAst: parse failed for ${filePath}:`, e);
			return null;
		}
	}
	convertToAstNode(rootNode) {
		const result = {
			type: rootNode.type,
			text: rootNode.text,
			startPosition: {
				row: rootNode.startPosition.row,
				column: rootNode.startPosition.column
			},
			endPosition: {
				row: rootNode.endPosition.row,
				column: rootNode.endPosition.column
			},
			children: []
		};
		const stack = [];
		for (let i = (rootNode.childCount || 0) - 1; i >= 0; i--) {
			const child = rootNode.child(i);
			if (child) stack.push({
				tsNode: child,
				astParent: result
			});
		}
		while (stack.length > 0) {
			const { tsNode, astParent } = stack.pop();
			const astNode = {
				type: tsNode.type,
				text: tsNode.text,
				startPosition: {
					row: tsNode.startPosition.row,
					column: tsNode.startPosition.column
				},
				endPosition: {
					row: tsNode.endPosition.row,
					column: tsNode.endPosition.column
				},
				children: []
			};
			astParent.children.push(astNode);
			for (let i = (tsNode.childCount || 0) - 1; i >= 0; i--) {
				const child = tsNode.child(i);
				if (child) stack.push({
					tsNode: child,
					astParent: astNode
				});
			}
		}
		return result;
	}
	destroy() {
		this.parser?.delete();
		this.parser = null;
		this.currentLanguage = null;
		this.loadedLanguages.clear();
		this.initAttempts = 0;
	}
};

//#endregion
//#region src/host/RateLimiter.ts
const RATE_LIMIT_WINDOW_MS = API.RATE_LIMIT_WINDOW_MS;
const RATE_LIMIT_DEFAULT = API.RATE_LIMIT_DEFAULT;
const RATE_LIMIT_HEAVY = API.RATE_LIMIT_HEAVY;
const RATE_LIMIT_MAP_MAX = API.RATE_LIMIT_MAP_MAX;
const HEAVY_ENDPOINTS = new Set([
	"/api/v1/codegraph/scan",
	"/api/v1/codegraph/init",
	"/api/v1/codegraph/diff",
	"/api/v1/codegraph/ast",
	"/api/v1/codegraph/tree-sitter"
]);
function createRateLimiter() {
	const rateLimitMap = new Map();
	let lastCleanup = Date.now();
	function check(ip, routePath) {
		const key = `${ip}:${routePath}`;
		const limit = HEAVY_ENDPOINTS.has(routePath) ? RATE_LIMIT_HEAVY : RATE_LIMIT_DEFAULT;
		const now = Date.now();
		if (now - lastCleanup > RATE_LIMIT_WINDOW_MS) {
			for (const [k, b] of rateLimitMap) if (now > b.resetTime) rateLimitMap.delete(k);
			lastCleanup = now;
		}
		if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
			const oldestKey = rateLimitMap.keys().next().value;
			if (oldestKey !== void 0) rateLimitMap.delete(oldestKey);
		}
		const bucket = rateLimitMap.get(key);
		if (!bucket || now > bucket.resetTime) {
			rateLimitMap.set(key, {
				count: 1,
				resetTime: now + RATE_LIMIT_WINDOW_MS
			});
			return true;
		}
		if (bucket.count >= limit) return false;
		bucket.count++;
		return true;
	}
	function reset() {
		rateLimitMap.clear();
		lastCleanup = Date.now();
	}
	return {
		check,
		reset
	};
}

//#endregion
//#region src/host/HttpHelpers.ts
const log$9 = scoped("host");
function getClientIp(req) {
	const socketAddr = req.socket?.remoteAddress;
	return socketAddr ?? "unknown";
}
function readBody(req, maxBodyBytes) {
	return new Promise((resolve, reject) => {
		let body = "";
		let totalBytes = 0;
		req.on("data", (chunk) => {
			if (!chunk) return;
			totalBytes += chunk.length;
			if (totalBytes > maxBodyBytes) {
				req.destroy();
				reject(new Error(ERROR_CODES.BODY_TOO_LARGE));
				return;
			}
			body += chunk.toString();
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}
function parseJsonBody(body) {
	const parsed = JSON.parse(body || "{}");
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(ERROR_CODES.INVALID_JSON_BODY);
	return parsed;
}
function extractStringField(obj, field, maxLength) {
	const v = obj[field];
	if (typeof v !== "string") return void 0;
	if (v.includes("\0")) return void 0;
	if (maxLength !== void 0 && v.length > maxLength) return void 0;
	return v;
}
function extractBooleanField(obj, field) {
	const v = obj[field];
	return typeof v === "boolean" ? v : void 0;
}
const GIT_REF_PATTERN = /^(?!.*\.\.)[a-zA-Z0-9._/-]+$/;
function isSafeGitRef(ref) {
	return GIT_REF_PATTERN.test(ref);
}
async function validatePathRealpath(scanPath, securityManager) {
	try {
		const realPath = await fs.realpath(scanPath);
		return securityManager.isPathAllowed(realPath);
	} catch (e) {
		log$9.warn("validatePathRealpath failed", e);
		return false;
	}
}
function buildCorsHeaders(req, config) {
	const headers = {
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "content-type, if-none-match",
		"access-control-max-age": "86400",
		"vary": "Origin"
	};
	if (config.origins.length > 0) {
		const reqOrigin = req?.headers?.["origin"];
		if (typeof reqOrigin === "string" && config.origins.includes(reqOrigin)) headers["access-control-allow-origin"] = reqOrigin;
	}
	return headers;
}
function handleCorsPreflight(req, res, config) {
	if (req.method !== "OPTIONS") return false;
	const headers = buildCorsHeaders(req, config);
	res.writeHead(204, headers);
	res.end();
	return true;
}
function sendJson(res, code, data, req, config) {
	const headers = {
		"content-type": "application/json",
		...buildCorsHeaders(req, config)
	};
	res.writeHead(code, headers);
	res.end(JSON.stringify(data));
}
function sendError(res, httpCode, errorCode, req, config, detail) {
	const baseMessage = ERROR_MESSAGES[errorCode]?.en ?? errorCode;
	const message = detail ? `${baseMessage}: ${detail}` : baseMessage;
	sendJson(res, httpCode, {
		success: false,
		error: errorCode,
		message
	}, req, config);
}
function requireMethod(req, res, method, config) {
	if (req.method === method) return true;
	sendError(res, 405, "METHOD_NOT_ALLOWED", req, config, `${req.method} not allowed; expected ${method}`);
	return false;
}
function checkRate(req, res, routePath, rateLimiter, config) {
	if (!rateLimiter.check(getClientIp(req), routePath)) {
		sendError(res, 429, "RATE_LIMIT_EXCEEDED", req, config);
		return false;
	}
	return true;
}
function logRequest(req, routePath) {
	log$9.info("request", {
		method: req.method,
		path: routePath,
		ip: getClientIp(req)
	});
}

//#endregion
//#region src/host/routes/shared.ts
const log$8 = scoped("host");
function withRouteMiddleware(method, routePath, corsConfig, rateLimiter, handler) {
	return async (req, res) => {
		if (handleCorsPreflight(req, res, corsConfig)) return;
		if (!requireMethod(req, res, method, corsConfig)) return;
		logRequest(req, routePath);
		if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
		await handler(req, res);
	};
}
async function resolveWorkspaceFromRequest(req, ctx, deps) {
	try {
		const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
		const wsParam = url.searchParams.get("workspace");
		if (wsParam && wsParam !== "." && deps.securityManager.isPathAllowed(wsParam)) {
			if (await validatePathRealpath(wsParam, deps.securityManager)) return wsParam;
		}
	} catch {}
	return findWorkspacePath(ctx);
}
async function resolveAndValidatePath(pathInput, ctx, deps, req, res, corsConfig) {
	if (pathInput && pathInput !== "." && !deps.securityManager.isPathAllowed(pathInput)) {
		sendError(res, 403, ERROR_CODES.PATH_NOT_ALLOWED, req, corsConfig);
		return null;
	}
	const resolved = pathInput && pathInput !== "." ? pathInput : findWorkspacePath(ctx);
	if (resolved && resolved !== "." && !deps.securityManager.isPathAllowed(resolved)) {
		sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
		return null;
	}
	if (resolved && resolved !== "." && !await validatePathRealpath(resolved, deps.securityManager)) {
		sendError(res, 403, ERROR_CODES.SYMLINK_ESCAPE, req, corsConfig);
		return null;
	}
	return resolved;
}
async function resolveAndValidateRelativePath(relativePath, ctx, deps, req, res, corsConfig) {
	const workspacePath = findWorkspacePath(ctx);
	if (!workspacePath) {
		sendError(res, 400, ERROR_CODES.NO_WORKSPACE_PATH, req, corsConfig);
		return null;
	}
	const fullPath = path.resolve(workspacePath, relativePath);
	const normalizedWorkspace = path.normalize(workspacePath);
	if (!fullPath.startsWith(normalizedWorkspace + path.sep) && fullPath !== normalizedWorkspace) {
		sendError(res, 403, ERROR_CODES.PATH_OUTSIDE_WORKSPACE, req, corsConfig);
		return null;
	}
	if (!await validatePathRealpath(fullPath, deps.securityManager)) {
		sendError(res, 403, ERROR_CODES.SYMLINK_ESCAPE, req, corsConfig);
		return null;
	}
	return fullPath;
}
async function validateWorkspacePath(ctx, deps) {
	const workspacePath = findWorkspacePath(ctx);
	if (!workspacePath) return null;
	if (!deps.securityManager.isPathAllowed(workspacePath)) return "__denied__";
	if (!await validatePathRealpath(workspacePath, deps.securityManager)) return "__denied__";
	return workspacePath;
}
function checkEtag(req, res, corsConfig, serverEtag) {
	const ifNoneMatch = req.headers["if-none-match"];
	if (!ifNoneMatch) return false;
	const clientEtag = String(ifNoneMatch);
	if (clientEtag !== serverEtag) return false;
	const corsHeaders = buildCorsHeaders(req, corsConfig);
	corsHeaders["etag"] = serverEtag;
	res.writeHead(304, corsHeaders);
	res.end();
	return true;
}
function returnIfEtagMatch(req, res, corsConfig, deps) {
	const cachedData = deps.getLastGraphData();
	return !!cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp));
}
function slimGraphData(data, maxNodes) {
	const cap = maxNodes;
	const truncated = data.nodes.length > cap;
	let selectedNodes;
	if (truncated) {
		const degreeMap = new Map();
		for (const n of data.nodes) degreeMap.set(n.id, 0);
		for (const e of data.edges) {
			if (e.source === e.target) continue;
			const s = degreeMap.get(e.source);
			const t = degreeMap.get(e.target);
			if (s !== void 0) degreeMap.set(e.source, s + 1);
			if (t !== void 0) degreeMap.set(e.target, t + 1);
		}
		const sorted = [...data.nodes].sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0));
		selectedNodes = sorted.slice(0, cap);
	} else selectedNodes = data.nodes;
	const slimNodes = selectedNodes.map((n) => ({
		id: NodeId(n.id),
		label: n.label,
		type: n.type,
		filePath: n.filePath,
		lineNumber: n.lineNumber,
		properties: n.properties ?? {},
		...n.parentId ? { parentId: NodeId(n.parentId) } : {},
		...n.layer ? { layer: n.layer } : {}
	}));
	const allowedIds = new Set(slimNodes.map((n) => n.id));
	const slimEdges = data.edges.filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target) && e.source !== e.target).map((e) => ({
		id: EdgeId(e.id),
		source: NodeId(e.source),
		target: NodeId(e.target),
		type: e.type,
		properties: e.properties ?? {}
	}));
	return {
		nodes: slimNodes,
		edges: slimEdges,
		metadata: {
			...data.metadata,
			truncated,
			nodeCount: slimNodes.length,
			edgeCount: slimEdges.length,
			totalNodeCount: data.metadata.totalNodeCount ?? data.nodes.length,
			totalEdgeCount: data.metadata.totalEdgeCount ?? data.edges.length
		}
	};
}
function createInvokeUpstream(ctx, config, apiCompat) {
	return createInvoke(ctx, config.requestTimeout, apiCompat);
}
function registerService(deps) {
	const { ctx, config } = deps;
	const invokeUpstream = deps.invokeUpstream ?? createInvokeUpstream(ctx, config);
	ctx.effect(() => {
		const service = {
			getCurrentGraph: () => deps.getLastGraphData(),
			getGraphData: async (repoId) => {
				try {
					const raw = await fetchMergedGraph(invokeUpstream, repoId, "both");
					return slimGraphData(raw, config.maxNodes);
				} catch (e) {
					log$8.warn("getGraphData failed", e);
					return null;
				}
			},
			getSymbolDetail: async (symbolId) => {
				const result = await invokeUpstream("codegraph_query", {
					search: symbolId,
					limit: 1
				});
				if (result && typeof result === "object") return result;
				return null;
			},
			getImpactAnalysis: async (symbolId) => {
				const result = await invokeUpstream("codegraph_impact", {
					symbol: symbolId,
					depth: 2
				});
				if (result && typeof result === "object" && "affected" in result) return result;
				return null;
			},
			onGraphUpdate: (callback) => {
				return ctx.on("codegraph-visualizer/graph/data", (event) => {
					callback({
						nodes: event.nodes,
						edges: event.edges,
						metadata: {
							repoId: RepoId(event.repoId),
							timestamp: event.timestamp,
							nodeCount: event.nodes.length,
							edgeCount: event.edges.length
						}
					});
				});
			}
		};
		return ctx.provide("graphVisualizer", service);
	}, "codegraph: service registration");
}
function triggerBackgroundBuild(deps, invokeUpstream, workspacePath) {
	const existing = deps.getScanInFlight(workspacePath);
	if (existing) return;
	const cached = deps.getScanCache().get(workspacePath);
	if (cached && Date.now() - cached.timestamp < deps.config.scanCacheTtl) return;
	const repoId = workspacePath || `workspace-${Date.now()}`;
	const flags = deps.featureFlags;
	let scanPromise;
	if (flags && flags.incrementalBootstrap && deps.apiCompat) {
		const bootstrapTool = deps.apiCompat.getAvailableToolName(deps.ctx, "codegraphBootstrap");
		if (bootstrapTool) scanPromise = invokeUpstream(bootstrapTool, { path: workspacePath }).then(() => fetchMergedGraph(invokeUpstream, repoId, "both")).then((raw) => slimGraphData(raw, deps.config.maxNodes));
		else scanPromise = fetchMergedGraph(invokeUpstream, repoId, "both").then((raw) => slimGraphData(raw, deps.config.maxNodes));
	} else scanPromise = fetchMergedGraph(invokeUpstream, repoId, "both").then((raw) => slimGraphData(raw, deps.config.maxNodes));
	deps.setScanInFlight(workspacePath, scanPromise);
	scanPromise.then((data) => {
		deps.setLastGraphData(data);
		deps.getScanCache().set(workspacePath, {
			data,
			timestamp: Date.now()
		});
		if (deps.graphRepo?.isReady()) try {
			const hash = `${data.metadata.nodeCount}:${data.metadata.edgeCount}:${data.metadata.timestamp}`;
			const serialized = Buffer.from(JSON.stringify({
				nodes: data.nodes,
				edges: data.edges,
				metadata: data.metadata
			}), "utf-8");
			deps.graphRepo.saveSnapshot(repoId, hash, data.metadata.nodeCount, data.metadata.edgeCount, serialized);
		} catch (e) {
			log$8.warn("snapshot save failed", e);
		}
		const { ctx } = deps;
		ctx.emit("codegraph-visualizer/graph/updated", {
			repoId: RepoId(repoId),
			nodeCount: data.metadata.nodeCount,
			edgeCount: data.metadata.edgeCount,
			timestamp: data.metadata.timestamp
		});
		ctx.emit("codegraph-visualizer/graph/data", {
			repoId: RepoId(repoId),
			nodes: data.nodes,
			edges: data.edges,
			timestamp: data.metadata.timestamp
		});
		log$8.info("background build completed", {
			repoId,
			nodes: data.metadata.nodeCount,
			edges: data.metadata.edgeCount
		});
	}).catch((e) => {
		log$8.error("background build failed", e);
	}).finally(() => {
		deps.setScanInFlight(workspacePath, null);
	});
}

//#endregion
//#region src/host/routes/statusRoutes.ts
function registerStatusRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/status";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, (req, res) => {
			const status = checkPrerequisites(ctx);
			sendJson(res, 200, {
				codegraph: status.codegraph,
				lens: status.lens,
				builtin: status.builtin
			}, req, corsConfig);
		})
	}), "codegraph: status route");
}
function registerHealthRoute(rc) {
	const { deps, corsConfig } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/health";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rc.rateLimiter, (req, res) => {
			try {
				const status = checkPrerequisites(ctx);
				const mem = process.memoryUsage();
				const hasGraphData = deps.getLastGraphData() !== null;
				const healthy = status.codegraph || status.lens || status.builtin;
				sendJson(res, healthy ? 200 : 503, {
					status: healthy ? "healthy" : "degraded",
					codegraph: status.codegraph,
					lens: status.lens,
					builtin: status.builtin,
					hasGraphData,
					uptime: process.uptime(),
					memory: {
						rss: mem.rss,
						heapUsed: mem.heapUsed,
						heapTotal: mem.heapTotal
					},
					timestamp: Date.now()
				}, req, corsConfig);
			} catch (e) {
				sendJson(res, 503, {
					status: "unhealthy",
					error: e instanceof Error ? e.message : String(e),
					timestamp: Date.now()
				}, req, corsConfig);
			}
		})
	}), "codegraph: health route");
}
function registerWorkspaceRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/workspace";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, (req, res) => {
			const current = findWorkspacePath(ctx);
			const list = extractWorkspacePaths(ctx);
			sendJson(res, 200, {
				path: current,
				list
			}, req, corsConfig);
		})
	}), "codegraph: workspace route");
}

//#endregion
//#region src/host/DbMapper.ts
function mapDbNodesToGraphNodes(dbNodes, parentId) {
	return dbNodes.filter((n) => n.name && n.file_path && !isNoisePath(n.file_path)).map((n) => ({
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
		},
		...parentId ? { parentId: NodeId(parentId) } : {},
		layer: inferLayerFromPath(n.file_path)
	}));
}
function mapDbEdgesToGraphEdges(dbEdges) {
	return dbEdges.map((e) => ({
		id: EdgeId(String(e.id)),
		source: NodeId(e.source),
		target: NodeId(e.target),
		type: mapEdgeKind(e.kind),
		properties: e.line !== null && e.line !== void 0 ? { line: e.line } : {}
	}));
}

//#endregion
//#region src/host/routes/dataRoutes.ts
let _indexCacheFor = null;
let _indexCache = null;
function getGraphIndex(data) {
	if (_indexCacheFor === data && _indexCache) return _indexCache;
	_indexCacheFor = data;
	const parentIdToChildren = new Map();
	const filePathToNodeIds = new Map();
	const nodeIdToFilePath = new Map();
	const rootNodes = [];
	for (const n of data.nodes) {
		if (n.parentId) {
			const siblings = parentIdToChildren.get(n.parentId);
			if (siblings) siblings.push(n);
			else parentIdToChildren.set(n.parentId, [n]);
		} else rootNodes.push(n);
		const fp = n.filePath;
		if (fp) {
			const ids = filePathToNodeIds.get(fp);
			if (ids) ids.add(n.id);
			else filePathToNodeIds.set(fp, new Set([n.id]));
		}
		nodeIdToFilePath.set(n.id, n.filePath);
	}
	for (const children of parentIdToChildren.values()) children.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	_indexCache = {
		parentIdToChildren,
		filePathToNodeIds,
		nodeIdToFilePath,
		rootNodes
	};
	return _indexCache;
}
function registerDataRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/data";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, (req, res) => {
			if (returnIfEtagMatch(req, res, corsConfig, deps)) return;
			const lastGraphData = deps.getLastGraphData();
			if (lastGraphData) {
				const payload = JSON.stringify(lastGraphData);
				if (payload.length > API.DATA_RESPONSE_MAX_BYTES) {
					const slimmed = slimGraphData(lastGraphData, API.DATA_RESPONSE_SLIM_NODES);
					const slimPayload = JSON.stringify(slimmed);
					const dataHeaders = buildCorsHeaders(req, corsConfig);
					dataHeaders["content-type"] = "application/json";
					dataHeaders["etag"] = String(lastGraphData.metadata.timestamp);
					dataHeaders["x-truncated"] = "1";
					res.writeHead(200, dataHeaders);
					res.end(slimPayload);
				} else {
					const dataHeaders = buildCorsHeaders(req, corsConfig);
					dataHeaders["content-type"] = "application/json";
					dataHeaders["etag"] = String(lastGraphData.metadata.timestamp);
					res.writeHead(200, dataHeaders);
					res.end(payload);
				}
			} else sendJson(res, 200, {
				nodes: [],
				edges: [],
				metadata: {
					repoId: RepoId("empty"),
					timestamp: 0,
					nodeCount: 0,
					edgeCount: 0
				}
			}, req, corsConfig);
		})
	}), "codegraph: data route");
}
function registerBootstrapRoute(rc) {
	const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/bootstrap";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, async (req, res) => {
			const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
			if (returnIfEtagMatch(req, res, corsConfig, deps)) return;
			if (workspacePath) {
				const dbPath = resolveDbPath(workspacePath);
				const dbResult = readTopLevelNodesFromDb(dbPath, BOOTSTRAP.TOP_LEVEL_NODE_LIMIT);
				if (dbResult && dbResult.nodes.length > 0) {
					const topLevelNodes = mapDbNodesToGraphNodes(dbResult.nodes);
					const topLevelIds = new Set(topLevelNodes.map((n) => n.id));
					const dbEdges = readEdgesForNodesFromDb(dbPath, [...topLevelIds]);
					const rootEdges = mapDbEdgesToGraphEdges(dbEdges);
					sendJson(res, 200, {
						rootNodes: topLevelNodes,
						topLevelNodes,
						topLevelTotal: dbResult.total,
						edges: rootEdges,
						indexStatus: "ready",
						metadata: {
							repoId: RepoId(workspacePath),
							timestamp: Date.now(),
							totalNodeCount: dbResult.total,
							totalEdgeCount: countEdgesInDb(dbPath)
						}
					}, req, corsConfig);
					return;
				}
			}
			const lastGraphData = deps.getLastGraphData();
			if (lastGraphData && lastGraphData.nodes.length > 0) {
				const allRootNodes = getGraphIndex(lastGraphData).rootNodes;
				const topLevelNodes = allRootNodes.slice(0, BOOTSTRAP.TOP_LEVEL_NODE_LIMIT);
				const topLevelIds = new Set(topLevelNodes.map((n) => n.id));
				const rootEdges = lastGraphData.edges.filter((e) => topLevelIds.has(e.source) && topLevelIds.has(e.target));
				sendJson(res, 200, {
					rootNodes: topLevelNodes,
					topLevelNodes,
					topLevelTotal: allRootNodes.length,
					edges: rootEdges,
					indexStatus: "ready",
					metadata: {
						repoId: lastGraphData.metadata.repoId,
						timestamp: lastGraphData.metadata.timestamp,
						totalNodeCount: lastGraphData.metadata.totalNodeCount ?? lastGraphData.nodes.length,
						totalEdgeCount: lastGraphData.metadata.totalEdgeCount ?? lastGraphData.edges.length
					}
				}, req, corsConfig);
				return;
			}
			if (workspacePath) triggerBackgroundBuild(deps, invokeUpstream, workspacePath);
			sendJson(res, 200, {
				rootNodes: [],
				topLevelNodes: [],
				topLevelTotal: 0,
				edges: [],
				indexStatus: "building",
				metadata: {
					repoId: RepoId(workspacePath ?? "empty"),
					timestamp: Date.now(),
					totalNodeCount: 0,
					totalEdgeCount: 0
				}
			}, req, corsConfig);
		})
	}), "codegraph: bootstrap route");
}
function registerNodeChildrenRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/children";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, async (req, res) => {
			const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
			const nodeId = url.searchParams.get("nodeId");
			if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
				sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
				return;
			}
			const cursor = url.searchParams.get("cursor") ?? null;
			const limit = parseInt(url.searchParams.get("limit") ?? String(BOOTSTRAP.CHILDREN_PAGE_SIZE), 10) || BOOTSTRAP.CHILDREN_PAGE_SIZE;
			if (returnIfEtagMatch(req, res, corsConfig, deps)) return;
			const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
			if (workspacePath) {
				const dbPath = resolveDbPath(workspacePath);
				const dbResult = readNodeChildrenFromDb(dbPath, nodeId, cursor, limit);
				if (dbResult && dbResult.nodes.length > 0) {
					const page = mapDbNodesToGraphNodes(dbResult.nodes, nodeId);
					const childIds = page.map((n) => n.id);
					const dbEdges = readEdgesForNodesFromDb(dbPath, childIds);
					const childEdges = mapDbEdgesToGraphEdges(dbEdges);
					const lastNode = dbResult.nodes[dbResult.nodes.length - 1];
					sendJson(res, 200, {
						nodes: page,
						edges: childEdges,
						cursor: dbResult.nodes.length < limit || !lastNode ? null : lastNode.id,
						total: dbResult.total
					}, req, corsConfig);
					return;
				}
			}
			const lastGraphData = deps.getLastGraphData();
			if (lastGraphData && lastGraphData.nodes.length > 0) {
				const children = getGraphIndex(lastGraphData).parentIdToChildren.get(nodeId) ?? [];
				const startIdx = cursor ? Math.max(0, children.findIndex((n) => n.id > cursor)) : 0;
				const page = children.slice(startIdx, startIdx + limit);
				const childIds = new Set(page.map((n) => n.id));
				const childEdges = lastGraphData.edges.filter((e) => childIds.has(e.source) && childIds.has(e.target));
				const lastChild = page[page.length - 1];
				sendJson(res, 200, {
					nodes: page,
					edges: childEdges,
					cursor: page.length < limit || !lastChild ? null : lastChild.id,
					total: children.length
				}, req, corsConfig);
				return;
			}
			sendJson(res, 200, {
				nodes: [],
				edges: [],
				cursor: null,
				total: 0
			}, req, corsConfig);
		})
	}), "codegraph: node children route");
}
function registerFileOutlineRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/files";
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, async (req, res) => {
			const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
			const match = url.pathname.match(/^\/api\/v1\/codegraph\/files\/([^/]+)\/outline$/);
			if (!match) {
				sendError(res, 404, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
				return;
			}
			const nodeId = decodeURIComponent(match[1] ?? "");
			if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
				sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
				return;
			}
			if (returnIfEtagMatch(req, res, corsConfig, deps)) return;
			const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
			if (workspacePath) {
				const dbPath = resolveDbPath(workspacePath);
				const dbResult = readFileOutlineFromDb(dbPath, nodeId);
				if (dbResult && dbResult.nodes.length > 0) {
					const symbols$1 = mapDbNodesToGraphNodes(dbResult.nodes, nodeId).slice(0, FILE_OUTLINE.MAX_SYMBOLS);
					const symbolIds$1 = new Set(symbols$1.map((n) => n.id));
					const dbEdges = readEdgesForNodesFromDb(dbPath, [...symbolIds$1]);
					const symbolEdges$1 = mapDbEdgesToGraphEdges(dbEdges);
					sendJson(res, 200, {
						symbols: symbols$1,
						edges: symbolEdges$1
					}, req, corsConfig);
					return;
				}
			}
			const lastGraphData = deps.getLastGraphData();
			if (!lastGraphData) {
				sendJson(res, 200, {
					symbols: [],
					edges: []
				}, req, corsConfig);
				return;
			}
			const symbols = (getGraphIndex(lastGraphData).parentIdToChildren.get(nodeId) ?? []).slice(0, FILE_OUTLINE.MAX_SYMBOLS);
			const symbolIds = new Set(symbols.map((n) => n.id));
			const symbolEdges = lastGraphData.edges.filter((e) => symbolIds.has(e.source) && symbolIds.has(e.target));
			sendJson(res, 200, {
				symbols,
				edges: symbolEdges
			}, req, corsConfig);
		})
	}), "codegraph: file outline route");
}
function registerSymbolASTRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/symbols";
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, async (req, res) => {
			const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
			const match = url.pathname.match(/^\/api\/v1\/codegraph\/symbols\/([^/]+)\/ast$/);
			if (!match) {
				sendError(res, 404, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
				return;
			}
			const nodeId = decodeURIComponent(match[1] ?? "");
			if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
				sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
				return;
			}
			if (returnIfEtagMatch(req, res, corsConfig, deps)) return;
			const budget = Math.min(parseInt(url.searchParams.get("budget") ?? String(SYMBOL_AST.MAX_NODES), 10) || SYMBOL_AST.MAX_NODES, SYMBOL_AST.MAX_NODES);
			const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
			if (workspacePath) {
				const dbPath = resolveDbPath(workspacePath);
				const dbResult = readSymbolASTFromDb(dbPath, nodeId);
				if (dbResult && dbResult.nodes.length > 0) {
					const allAstNodes$1 = mapDbNodesToGraphNodes(dbResult.nodes, nodeId);
					const hasMore$1 = allAstNodes$1.length > budget;
					const astNodes$1 = hasMore$1 ? allAstNodes$1.slice(0, budget) : allAstNodes$1;
					const astNodeIds$1 = new Set(astNodes$1.map((n) => n.id));
					const dbEdges = readEdgesForNodesFromDb(dbPath, [...astNodeIds$1]);
					const astEdges$1 = mapDbEdgesToGraphEdges(dbEdges);
					sendJson(res, 200, {
						astNodes: astNodes$1,
						astEdges: astEdges$1,
						sourceLines: [],
						hasMore: hasMore$1
					}, req, corsConfig);
					return;
				}
			}
			const lastGraphData = deps.getLastGraphData();
			if (!lastGraphData) {
				sendJson(res, 200, {
					astNodes: [],
					astEdges: [],
					sourceLines: [],
					hasMore: false
				}, req, corsConfig);
				return;
			}
			const allAstNodes = getGraphIndex(lastGraphData).parentIdToChildren.get(nodeId) ?? [];
			const hasMore = allAstNodes.length > budget;
			const astNodes = hasMore ? allAstNodes.slice(0, budget) : allAstNodes;
			const astNodeIds = new Set(astNodes.map((n) => n.id));
			const astEdges = lastGraphData.edges.filter((e) => astNodeIds.has(e.source) && astNodeIds.has(e.target));
			sendJson(res, 200, {
				astNodes,
				astEdges,
				sourceLines: [],
				hasMore
			}, req, corsConfig);
		})
	}), "codegraph: symbol AST route");
}
function registerEdgesRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/edges";
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, async (req, res) => {
			const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
			const fromId = url.searchParams.get("from") ?? "";
			const scope = url.searchParams.get("scope") ?? "file";
			const cursor = parseInt(url.searchParams.get("cursor") ?? "0", 10);
			const limit = Math.min(parseInt(url.searchParams.get("limit") ?? String(EDGES_AGGREGATION.PAGE_SIZE), 10), EDGES_AGGREGATION.PAGE_SIZE);
			const aggregated = url.searchParams.get("aggregated") === "1";
			if (!fromId || fromId.length > VALIDATION.MAX_PATH_LENGTH) {
				sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
				return;
			}
			if (returnIfEtagMatch(req, res, corsConfig, deps)) return;
			const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);
			if (workspacePath) {
				const dbPath = resolveDbPath(workspacePath);
				const dbResult = readEdgesFromDb(dbPath, fromId, scope, cursor, limit);
				if (dbResult) {
					const pagedEdges = mapDbEdgesToGraphEdges(dbResult.edges.filter((e) => e.source !== e.target && !FILTERED_EDGE_KINDS.has(e.kind)));
					sendJson(res, 200, {
						edges: pagedEdges,
						total: dbResult.total,
						cursor: cursor + pagedEdges.length,
						hasMore: cursor + limit < dbResult.total
					}, req, corsConfig);
					return;
				}
			}
			const lastGraphData = deps.getLastGraphData();
			if (lastGraphData && lastGraphData.nodes.length > 0) {
				let filteredEdges;
				if (scope === "symbol") filteredEdges = lastGraphData.edges.filter((e) => e.source === fromId || e.target === fromId);
				else {
					const index$1 = getGraphIndex(lastGraphData);
					const nodeIds = new Set();
					const nodeFilePaths = new Map();
					const fpNodeIds = index$1.filePathToNodeIds.get(fromId);
					if (fpNodeIds) for (const id of fpNodeIds) {
						nodeIds.add(id);
						nodeFilePaths.set(id, fromId);
					}
					const selfFp = index$1.nodeIdToFilePath.get(fromId);
					if (selfFp !== void 0 && !nodeIds.has(fromId)) {
						nodeIds.add(fromId);
						nodeFilePaths.set(fromId, selfFp);
					}
					filteredEdges = lastGraphData.edges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target));
					if (!aggregated && filteredEdges.length > EDGES_AGGREGATION.THRESHOLD) {
						const nodeIdToFilePath = index$1.nodeIdToFilePath;
						const filePairCounts = new Map();
						for (const e of filteredEdges) {
							const srcFile = nodeFilePaths.get(e.source) ?? nodeIdToFilePath.get(e.source) ?? "?";
							const tgtFile = nodeFilePaths.get(e.target) ?? nodeIdToFilePath.get(e.target) ?? "?";
							const pairKey = srcFile < tgtFile ? `${srcFile}\0${tgtFile}` : `${tgtFile}\0${srcFile}`;
							filePairCounts.set(pairKey, (filePairCounts.get(pairKey) ?? 0) + 1);
						}
						const aggregatedEdges = [...filePairCounts.entries()].map(([pairKey, count]) => {
							const [fileA, fileB] = pairKey.split("\0");
							return {
								id: EdgeId(`agg:${pairKey}`),
								source: NodeId(fromId),
								target: NodeId(fileA === fromId ? fileB ?? fromId : fileA ?? fromId),
								type: "dependency",
								properties: {
									aggregated: true,
									count,
									filePair: pairKey
								}
							};
						});
						sendJson(res, 200, {
							edges: aggregatedEdges,
							total: aggregatedEdges.length,
							cursor: 0,
							hasMore: false,
							aggregated: true
						}, req, corsConfig);
						return;
					}
				}
				const total = filteredEdges.length;
				const pagedEdges = filteredEdges.slice(cursor, cursor + limit);
				const hasMore = cursor + limit < total;
				sendJson(res, 200, {
					edges: pagedEdges,
					total,
					cursor: cursor + limit,
					hasMore
				}, req, corsConfig);
				return;
			}
			sendJson(res, 200, {
				edges: [],
				total: 0,
				cursor: 0,
				hasMore: false
			}, req, corsConfig);
		})
	}), "codegraph: edges route");
}

//#endregion
//#region src/host/routes/controlRoutes.ts
function registerScanRoute(rc) {
	const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
	const { ctx, config } = deps;
	const routePath = "/api/v1/codegraph/scan";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("POST", routePath, corsConfig, rateLimiter, async (req, res) => {
			try {
				const body = await readBody(req, config.maxBodyBytes);
				const parsed = parseJsonBody(body);
				const scanPathInput = extractStringField(parsed, "path", VALIDATION.MAX_PATH_LENGTH);
				const scanPath = await resolveAndValidatePath(scanPathInput, ctx, deps, req, res, corsConfig);
				if (scanPath === null) return;
				const repoId = scanPath || `workspace-${Date.now()}`;
				const scanCache = deps.getScanCache();
				const cached = scanCache.get(scanPath);
				if (cached && Date.now() - cached.timestamp < config.scanCacheTtl) {
					deps.setLastGraphData(cached.data);
					const scanPayload = JSON.stringify({
						success: true,
						...cached.data
					});
					if (scanPayload.length > API.DATA_RESPONSE_MAX_BYTES) {
						const slimmed = slimGraphData(cached.data, API.DATA_RESPONSE_SLIM_NODES);
						const slimPayload = JSON.stringify({
							success: true,
							...slimmed
						});
						const scanHeaders = buildCorsHeaders(req, corsConfig);
						scanHeaders["content-type"] = "application/json";
						scanHeaders["x-truncated"] = "1";
						res.writeHead(200, scanHeaders);
						res.end(slimPayload);
					} else sendJson(res, 200, {
						success: true,
						...cached.data
					}, req, corsConfig);
					return;
				}
				const inFlight = deps.getScanInFlight(scanPath);
				if (inFlight) {
					sendJson(res, 200, {
						success: true,
						status: "scanning",
						message: "Scan already in progress"
					}, req, corsConfig);
					return;
				}
				const scanPromise = fetchMergedGraph(invokeUpstream, repoId, "both").then((raw) => slimGraphData(raw, config.maxNodes));
				deps.setScanInFlight(scanPath, scanPromise);
				sendJson(res, 200, {
					success: true,
					status: "scanning",
					message: "Scan started, listen to SSE for completion"
				}, req, corsConfig);
				scanPromise.then((data) => {
					deps.setLastGraphData(data);
					scanCache.set(scanPath, {
						data,
						timestamp: Date.now()
					});
					if (scanCache.size > config.scanCacheLimit) {
						const oldest = scanCache.keys().next().value;
						if (oldest !== void 0) scanCache.delete(oldest);
					}
					ctx.emit("codegraph-visualizer/graph/updated", {
						repoId: RepoId(repoId),
						nodeCount: data.metadata.nodeCount,
						edgeCount: data.metadata.edgeCount,
						timestamp: data.metadata.timestamp
					});
					ctx.emit("codegraph-visualizer/graph/data", {
						repoId: RepoId(repoId),
						nodes: data.nodes,
						edges: data.edges,
						timestamp: data.metadata.timestamp
					});
					log$8.info("scan completed (background)", {
						repoId,
						nodes: data.metadata.nodeCount,
						edges: data.metadata.edgeCount
					});
				}).catch((e) => {
					log$8.error("scan failed (background)", e);
				}).finally(() => {
					deps.setScanInFlight(scanPath, null);
				});
			} catch (e) {
				log$8.error("scan route failed", e);
				sendError(res, 500, ERROR_CODES.SCAN_FAILED, req, corsConfig);
			}
		})
	}), "codegraph: scan route");
}
function registerInitRoute(rc) {
	const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
	const { ctx, config } = deps;
	const routePath = "/api/v1/codegraph/init";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("POST", routePath, corsConfig, rateLimiter, async (req, res) => {
			try {
				const body = await readBody(req, config.maxBodyBytes);
				const parsed = parseJsonBody(body);
				const pathInput = extractStringField(parsed, "path", VALIDATION.MAX_PATH_LENGTH);
				const initPath = await resolveAndValidatePath(pathInput, ctx, deps, req, res, corsConfig);
				if (initPath === null) return;
				log$8.info("init requested (non-blocking)", { path: initPath });
				sendJson(res, 200, {
					success: true,
					status: "initializing",
					path: initPath,
					message: "Initialization started, listen to SSE for completion",
					timestamp: Date.now()
				}, req, corsConfig);
				(async () => {
					try {
						const result = await invokeUpstream("codegraph_init", {
							path: initPath,
							force: true
						});
						const success = result !== null;
						const initResult = {
							success,
							path: initPath,
							message: success ? "Graph initialized successfully" : ERROR_MESSAGES.INIT_FAILED?.en ?? "Initialization failed",
							timestamp: Date.now()
						};
						deps.setLastInitResult(initResult);
						ctx.emit("codegraph-visualizer/graph/init-result", initResult);
						if (success) {
							const repoId = initPath || `workspace-${Date.now()}`;
							const raw = await fetchMergedGraph(invokeUpstream, repoId, "both");
							const data = slimGraphData(raw, config.maxNodes);
							deps.setLastGraphData(data);
							ctx.emit("codegraph-visualizer/graph/data", {
								repoId: RepoId(repoId),
								nodes: data.nodes,
								edges: data.edges,
								timestamp: data.metadata.timestamp
							});
							log$8.info("init completed (background)", {
								path: initPath,
								nodes: data.metadata.nodeCount
							});
						}
					} catch (e) {
						log$8.error("init failed (background)", e);
						const errorResult = {
							success: false,
							path: initPath,
							message: ERROR_MESSAGES.INIT_FAILED?.en ?? "Initialization failed",
							timestamp: Date.now()
						};
						deps.setLastInitResult(errorResult);
						ctx.emit("codegraph-visualizer/graph/init-result", errorResult);
					}
				})();
			} catch (e) {
				log$8.error("init route failed", e);
				const errorResult = {
					success: false,
					path: "",
					message: ERROR_MESSAGES.INIT_FAILED?.en ?? "Initialization failed",
					timestamp: Date.now()
				};
				deps.setLastInitResult(errorResult);
				sendError(res, 500, ERROR_CODES.INIT_FAILED, req, corsConfig);
			}
		})
	}), "codegraph: init route");
}
function registerWatchRoute(rc) {
	const { deps, corsConfig } = rc;
	const { ctx, config } = deps;
	const routePath = "/api/v1/codegraph/watch";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("POST", routePath, corsConfig, rc.rateLimiter, async (req, res) => {
			try {
				const body = await readBody(req, config.maxBodyBytes);
				const parsed = parseJsonBody(body);
				const enabled = extractBooleanField(parsed, "enabled");
				const pathInput = extractStringField(parsed, "path", VALIDATION.MAX_PATH_LENGTH);
				const watchPath = await resolveAndValidatePath(pathInput, ctx, deps, req, res, corsConfig);
				if (watchPath === null) return;
				ctx.emit("codegraph-visualizer/watch/toggle", {
					enabled: !!enabled,
					path: watchPath,
					timestamp: Date.now()
				});
				sendJson(res, 200, {
					success: true,
					enabled: !!enabled,
					path: watchPath
				}, req, corsConfig);
			} catch (e) {
				log$8.warn("watch route failed", e);
				sendError(res, 500, ERROR_CODES.WATCH_TOGGLE_FAILED, req, corsConfig);
			}
		})
	}), "codegraph: watch route");
}
function registerEventsRoute(rc) {
	const { deps, corsConfig } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/events";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: (req, res) => {
			if (handleCorsPreflight(req, res, corsConfig)) return;
			if (!requireMethod(req, res, "GET", corsConfig)) return;
			logRequest(req, routePath);
			const corsHeaders = buildCorsHeaders(req, corsConfig);
			res.writeHead(200, {
				...corsHeaders,
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"Connection": "keep-alive",
				"X-Accel-Buffering": "no"
			});
			res.write(": connected\n\n");
			const sendEvent = (event, data) => {
				res.write(`event: ${event}\n`);
				res.write(`data: ${JSON.stringify(data)}\n\n`);
			};
			const disposers = [];
			disposers.push(ctx.on("codegraph-visualizer/graph/updated", (event) => {
				sendEvent("graph-updated", event);
			}));
			disposers.push(ctx.on("codegraph-visualizer/graph/data", (event) => {
				sendEvent("graph-data", event);
			}));
			disposers.push(ctx.on("codegraph-visualizer/repo/imported", (event) => {
				sendEvent("repo-imported", event);
			}));
			disposers.push(ctx.on("codegraph-visualizer/repo/scanned", (event) => {
				sendEvent("repo-scanned", event);
			}));
			disposers.push(ctx.on("codegraph-visualizer/graph/init-result", (event) => {
				sendEvent("init-result", event);
			}));
			const heartbeat = setInterval(() => {
				res.write(": heartbeat\n\n");
			}, 3e4);
			const cleanup = () => {
				clearInterval(heartbeat);
				for (const dispose of disposers) try {
					dispose();
				} catch {}
			};
			req.on("close", cleanup);
			req.on("error", cleanup);
		}
	}), "codegraph: events SSE route");
}

//#endregion
//#region src/adapters/DependencyAdapter.ts
const log$7 = scoped("dep-adapter");
const SEMVER_RE = /^\d+\.\d+\.\d+/;
function sanitizeVersion(raw) {
	const v = String(raw ?? "");
	return SEMVER_RE.test(v) ? v : "0.0.0";
}
function parsePackageJson(content) {
	const nodes = [];
	const edges = [];
	const seenIds = new Set();
	try {
		const pkg = JSON.parse(content);
		const rootName = pkg.name || "root";
		const rootId = `dep:${rootName}`;
		nodes.push({
			id: rootId,
			name: rootName,
			version: sanitizeVersion(pkg.version),
			type: "npm"
		});
		seenIds.add(rootId);
		const depSections = [
			{
				key: "dependencies",
				scope: "prod"
			},
			{
				key: "devDependencies",
				scope: "dev"
			},
			{
				key: "peerDependencies",
				scope: "peer"
			},
			{
				key: "optionalDependencies",
				scope: "optional"
			}
		];
		for (const { key, scope } of depSections) {
			const deps = pkg[key];
			if (!deps || typeof deps !== "object") continue;
			for (const [name$1, version] of Object.entries(deps)) {
				const depId = `dep:${name$1}`;
				if (!seenIds.has(depId)) {
					seenIds.add(depId);
					nodes.push({
						id: depId,
						name: name$1,
						version: sanitizeVersion(version),
						type: "npm"
					});
				}
				edges.push({
					source: rootId,
					target: depId,
					type: "depends",
					scope
				});
			}
		}
	} catch (e) {
		log$7.warn("parsePackageJson failed", e);
	}
	return {
		nodes,
		edges
	};
}
function parseCargoToml(content) {
	const nodes = [];
	const edges = [];
	const seenIds = new Set();
	try {
		const lines = content.split("\n");
		let rootName = "root";
		for (const line of lines) {
			const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
			if (nameMatch) {
				rootName = nameMatch[1];
				break;
			}
		}
		const rootId = `dep:${rootName}`;
		nodes.push({
			id: rootId,
			name: rootName,
			version: "0.0.0",
			type: "cargo"
		});
		seenIds.add(rootId);
		let inDepsSection = false;
		let pendingTableDep = null;
		for (const line of lines) {
			const tableDepHeaderMatch = line.match(/^\[dependencies\.([a-zA-Z0-9_-]+)\]/);
			if (tableDepHeaderMatch) {
				const depName = tableDepHeaderMatch[1];
				const depId = `dep:${depName}`;
				if (!seenIds.has(depId)) {
					seenIds.add(depId);
					nodes.push({
						id: depId,
						name: depName,
						version: "0.0.0",
						type: "cargo"
					});
				}
				edges.push({
					source: rootId,
					target: depId,
					type: "depends",
					scope: "prod"
				});
				inDepsSection = false;
				continue;
			}
			if (line.match(/^\[dependencies\]/)) {
				inDepsSection = true;
				continue;
			}
			if (line.match(/^\[/)) {
				inDepsSection = false;
				continue;
			}
			if (!inDepsSection) continue;
			if (pendingTableDep) {
				const trimmed = line.trim();
				if (trimmed === "}") {
					const versionField = pendingTableDep.fields.find((f) => f.match(/^version\s*=\s*"/));
					if (versionField) {
						const versionMatch = versionField.match(/^version\s*=\s*"([^"]+)"/);
						if (versionMatch) {
							const depName = pendingTableDep.name;
							const depVersion = versionMatch[1];
							const depId = `dep:${depName}`;
							if (!seenIds.has(depId)) {
								seenIds.add(depId);
								nodes.push({
									id: depId,
									name: depName,
									version: depVersion,
									type: "cargo"
								});
							}
							edges.push({
								source: rootId,
								target: depId,
								type: "depends",
								scope: "prod"
							});
						}
					}
					pendingTableDep = null;
					continue;
				}
				pendingTableDep.fields.push(line.trim());
				continue;
			}
			const simpleDepMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
			if (simpleDepMatch) {
				const depName = simpleDepMatch[1];
				const depVersion = simpleDepMatch[2];
				const depId = `dep:${depName}`;
				if (!seenIds.has(depId)) {
					seenIds.add(depId);
					nodes.push({
						id: depId,
						name: depName,
						version: depVersion,
						type: "cargo"
					});
				}
				edges.push({
					source: rootId,
					target: depId,
					type: "depends",
					scope: "prod"
				});
				continue;
			}
			const tableDepStartMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{(.*)$/);
			if (tableDepStartMatch) {
				const depName = tableDepStartMatch[1];
				const rest = tableDepStartMatch[2];
				if (rest.includes("}")) {
					const inlineMatch = rest.match(/^([^}]*)\}/);
					if (inlineMatch) {
						const tableContent = inlineMatch[1];
						const versionMatch = tableContent.match(/version\s*=\s*"([^"]+)"/);
						if (versionMatch) {
							const depVersion = versionMatch[1];
							const depId = `dep:${depName}`;
							if (!seenIds.has(depId)) {
								seenIds.add(depId);
								nodes.push({
									id: depId,
									name: depName,
									version: depVersion,
									type: "cargo"
								});
							}
							edges.push({
								source: rootId,
								target: depId,
								type: "depends",
								scope: "prod"
							});
						}
						continue;
					}
				}
				pendingTableDep = {
					name: depName,
					fields: [rest]
				};
				continue;
			}
		}
	} catch (e) {
		log$7.warn("parseCargoToml failed", e);
	}
	return {
		nodes,
		edges
	};
}
function parseGoMod(content) {
	const nodes = [];
	const edges = [];
	const seenIds = new Set();
	try {
		const lines = content.split("\n");
		let moduleName = "root";
		for (const line of lines) {
			const moduleMatch = line.match(/^module\s+(\S+)/);
			if (moduleMatch) {
				moduleName = moduleMatch[1];
				break;
			}
		}
		const rootId = `dep:${moduleName}`;
		nodes.push({
			id: rootId,
			name: moduleName,
			version: "0.0.0",
			type: "gomod"
		});
		seenIds.add(rootId);
		let inRequireBlock = false;
		for (const rawLine of lines) {
			const trimmed = rawLine.trim();
			if (trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
			const line = trimmed.replace(/\s*\/\/.*$/, "");
			if (line.match(/^require\s*\(/)) {
				inRequireBlock = true;
				continue;
			}
			if (line.match(/^\)/)) {
				inRequireBlock = false;
				continue;
			}
			if (!inRequireBlock) {
				const singleRequireMatch = line.match(/^require\s+(\S+)\s+(\S+)/);
				if (singleRequireMatch) {
					const depName = singleRequireMatch[1];
					const depVersion = singleRequireMatch[2];
					const depId = `dep:${depName}`;
					if (!seenIds.has(depId)) {
						seenIds.add(depId);
						nodes.push({
							id: depId,
							name: depName,
							version: depVersion,
							type: "gomod"
						});
					}
					edges.push({
						source: rootId,
						target: depId,
						type: "depends",
						scope: "prod"
					});
					continue;
				}
				continue;
			}
			const depMatch = line.match(/^\s*(\S+)\s+(\S+)/);
			if (depMatch) {
				const depName = depMatch[1];
				const depVersion = depMatch[2];
				const depId = `dep:${depName}`;
				if (!seenIds.has(depId)) {
					seenIds.add(depId);
					nodes.push({
						id: depId,
						name: depName,
						version: depVersion,
						type: "gomod"
					});
				}
				edges.push({
					source: rootId,
					target: depId,
					type: "depends",
					scope: "prod"
				});
			}
		}
	} catch (e) {
		log$7.warn("parseGoMod failed", e);
	}
	return {
		nodes,
		edges
	};
}
function dependencyGraphToGraphData(depGraph) {
	const sourceIds = new Set(depGraph.edges.map((e) => e.source));
	const nodes = depGraph.nodes.map((n) => {
		let filePath = "";
		const isRoot = sourceIds.has(n.id);
		if (n.type === "npm") filePath = n.id === `dep:${n.name}` && isRoot ? "package.json" : `node_modules/${n.name}`;
		else if (n.type === "cargo") filePath = isRoot ? "Cargo.toml" : `cargo/${n.name}`;
		else if (n.type === "gomod") filePath = isRoot ? "go.mod" : `go/${n.name}`;
		else filePath = n.name;
		return {
			id: NodeId(n.id),
			label: n.name,
			type: "module",
			filePath,
			lineNumber: 0,
			properties: {
				version: n.version,
				depType: n.type,
				isExternal: true
			},
			layer: "dependency"
		};
	});
	const edges = depGraph.edges.map((e) => ({
		id: EdgeId(`${e.source}->${e.target}:dependency`),
		source: NodeId(e.source),
		target: NodeId(e.target),
		type: "dependency",
		properties: { scope: e.scope }
	}));
	return {
		nodes,
		edges
	};
}

//#endregion
//#region src/merger/DiffEngine.ts
function deepEqual(a, b, seen, depth) {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (depth !== void 0 && depth > DIFF_ENGINE.MAX_DEEP_EQUAL_DEPTH) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		const nextDepth$1 = (depth ?? 0) + 1;
		for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i], seen, nextDepth$1)) return false;
		return true;
	}
	if (!seen) seen = new Map();
	if (seen.has(a)) return seen.get(a) === b;
	seen.set(a, b);
	const nextDepth = (depth ?? 0) + 1;
	const aKeys = Object.keys(a).sort();
	const bKeys = Object.keys(b).sort();
	if (aKeys.length !== bKeys.length) return false;
	for (let i = 0; i < aKeys.length; i++) {
		if (aKeys[i] !== bKeys[i]) return false;
		if (!deepEqual(a[aKeys[i]], b[bKeys[i]], seen, nextDepth)) return false;
	}
	return true;
}
function computeGraphDiff(beforeNodes, beforeEdges, afterNodes, afterEdges) {
	const beforeNodeMap = new Map();
	for (const n of beforeNodes) beforeNodeMap.set(n.id, n);
	const afterNodeMap = new Map();
	for (const n of afterNodes) afterNodeMap.set(n.id, n);
	const beforeEdgeMap = new Map();
	for (const e of beforeEdges) beforeEdgeMap.set(e.id, e);
	const afterEdgeMap = new Map();
	for (const e of afterEdges) afterEdgeMap.set(e.id, e);
	const addedNodes = [];
	const removedNodes = [];
	const modifiedNodes = [];
	for (const [id, node] of afterNodeMap) if (!beforeNodeMap.has(id)) addedNodes.push(node);
	else {
		const before = beforeNodeMap.get(id);
		if (before.label !== node.label || before.type !== node.type || before.filePath !== node.filePath || before.lineNumber !== node.lineNumber || before.parentId !== node.parentId || !deepEqual(before.properties, node.properties)) modifiedNodes.push(node);
	}
	for (const [id, node] of beforeNodeMap) if (!afterNodeMap.has(id)) removedNodes.push(node);
	const addedEdges = [];
	const removedEdges = [];
	const modifiedEdges = [];
	for (const [id, edge] of afterEdgeMap) {
		const before = beforeEdgeMap.get(id);
		if (!before) addedEdges.push(edge);
		else if (before.type !== edge.type || before.source !== edge.source || before.target !== edge.target) modifiedEdges.push(edge);
	}
	for (const [id, edge] of beforeEdgeMap) if (!afterEdgeMap.has(id)) removedEdges.push(edge);
	return {
		addedNodes,
		removedNodes,
		modifiedNodes,
		addedEdges,
		removedEdges,
		modifiedEdges
	};
}
function diffToGraphData(diff) {
	const nodes = [];
	const edges = [];
	for (const n of diff.addedNodes) nodes.push({
		...n,
		properties: {
			...n.properties,
			diffStatus: "added"
		}
	});
	for (const n of diff.modifiedNodes) nodes.push({
		...n,
		properties: {
			...n.properties,
			diffStatus: "modified"
		}
	});
	for (const n of diff.removedNodes) nodes.push({
		...n,
		properties: {
			...n.properties,
			diffStatus: "removed"
		}
	});
	for (const e of diff.addedEdges) edges.push({
		...e,
		properties: {
			...e.properties,
			diffStatus: "added"
		}
	});
	for (const e of diff.modifiedEdges) edges.push({
		...e,
		properties: {
			...e.properties,
			diffStatus: "modified"
		}
	});
	for (const e of diff.removedEdges) edges.push({
		...e,
		properties: {
			...e.properties,
			diffStatus: "removed"
		}
	});
	return {
		nodes,
		edges
	};
}

//#endregion
//#region src/host/routes/analysisRoutes.ts
function registerDependenciesRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/dependencies";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, async (req, res) => {
			try {
				const workspacePath = await validateWorkspacePath(ctx, deps);
				if (workspacePath === "__denied__") {
					sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
					return;
				}
				if (!workspacePath) {
					sendJson(res, 200, {
						nodes: [],
						edges: [],
						metadata: {
							repoId: RepoId("empty"),
							timestamp: 0,
							nodeCount: 0,
							edgeCount: 0
						}
					}, req, corsConfig);
					return;
				}
				const allDepNodes = [];
				const allDepEdges = [];
				const depFiles = [
					{
						filename: "package.json",
						parser: parsePackageJson
					},
					{
						filename: "Cargo.toml",
						parser: parseCargoToml
					},
					{
						filename: "go.mod",
						parser: parseGoMod
					}
				];
				for (const { filename, parser } of depFiles) try {
					const filePath = path.join(workspacePath, filename);
					const content = await fs.readFile(filePath, "utf-8");
					const depGraph = parser(content);
					const converted = dependencyGraphToGraphData(depGraph);
					allDepNodes.push(...converted.nodes);
					allDepEdges.push(...converted.edges);
				} catch (e) {
					if (e.code !== "ENOENT") log$8.warn(`Failed to read ${filename}:`, e);
				}
				const dedupNodes = new Map();
				for (const n of allDepNodes) dedupNodes.set(n.id, n);
				const dedupEdges = new Map();
				for (const e of allDepEdges) if (e.source !== e.target) dedupEdges.set(e.id, e);
				sendJson(res, 200, {
					nodes: [...dedupNodes.values()],
					edges: [...dedupEdges.values()],
					metadata: {
						repoId: RepoId(workspacePath),
						timestamp: Date.now(),
						nodeCount: allDepNodes.length,
						edgeCount: allDepEdges.length
					}
				}, req, corsConfig);
			} catch (e) {
				log$8.error("dependencies route failed", e);
				sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
			}
		})
	}), "codegraph: dependencies route");
}
function registerDiffRoute(rc) {
	const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/diff";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("POST", routePath, corsConfig, rateLimiter, async (req, res) => {
			try {
				const body = await readBody(req, deps.config.maxBodyBytes);
				const parsed = parseJsonBody(body);
				const fromCommit = extractStringField(parsed, "from", VALIDATION.MAX_GIT_REF_LENGTH);
				const toCommit = extractStringField(parsed, "to", VALIDATION.MAX_GIT_REF_LENGTH);
				if (!fromCommit || !toCommit) {
					sendError(res, 400, ERROR_CODES.COMMITS_REQUIRED, req, corsConfig);
					return;
				}
				if (!isSafeGitRef(fromCommit) || !isSafeGitRef(toCommit)) {
					sendError(res, 400, ERROR_CODES.INVALID_GIT_REF, req, corsConfig);
					return;
				}
				const workspacePath = await validateWorkspacePath(ctx, deps);
				if (workspacePath === "__denied__") {
					sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
					return;
				}
				if (!workspacePath) {
					sendJson(res, 200, {
						nodes: [],
						edges: [],
						metadata: {
							repoId: RepoId("empty"),
							timestamp: 0,
							nodeCount: 0,
							edgeCount: 0
						}
					}, req, corsConfig);
					return;
				}
				const beforeGraph = await fetchMergedGraph(invokeUpstream, `${workspacePath}@${fromCommit}`, "both");
				const afterGraph = await fetchMergedGraph(invokeUpstream, `${workspacePath}@${toCommit}`, "both");
				const diff = computeGraphDiff(beforeGraph.nodes, beforeGraph.edges, afterGraph.nodes, afterGraph.edges);
				const { nodes, edges } = diffToGraphData(diff);
				sendJson(res, 200, {
					nodes,
					edges,
					metadata: {
						repoId: RepoId(workspacePath),
						timestamp: Date.now(),
						nodeCount: nodes.length,
						edgeCount: edges.length
					}
				}, req, corsConfig);
			} catch (e) {
				log$8.error("diff route failed", e);
				sendError(res, 500, ERROR_CODES.GRAPH_DIFF_FAILED, req, corsConfig);
			}
		})
	}), "codegraph: diff route");
}
function registerAstRoute(rc, sharedTreeSitterAdapter) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx, config } = deps;
	const routePath = "/api/v1/codegraph/ast";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("POST", routePath, corsConfig, rateLimiter, async (req, res) => {
			try {
				const body = await readBody(req, config.maxBodyBytes);
				const parsed = parseJsonBody(body);
				const filePath = extractStringField(parsed, "filePath", VALIDATION.MAX_FILEPATH_LENGTH);
				if (!filePath) {
					sendError(res, 400, ERROR_CODES.FILEPATH_REQUIRED, req, corsConfig);
					return;
				}
				const realPath = await resolveAndValidateRelativePath(filePath, ctx, deps, req, res, corsConfig);
				if (!realPath) return;
				const content = await fs.readFile(realPath, "utf-8");
				const MAX_AST_CONTENT = AST.MAX_CONTENT_BYTES;
				if (content.length > MAX_AST_CONTENT) {
					sendError(res, 413, ERROR_CODES.FILE_TOO_LARGE, req, corsConfig, `max ${MAX_AST_CONTENT} bytes`);
					return;
				}
				const astRoot = await sharedTreeSitterAdapter.parseToAst(filePath, content);
				if (!astRoot) {
					sendError(res, 500, ERROR_CODES.AST_PARSE_FAILED, req, corsConfig, `parseToAst returned null for ${filePath}`);
					return;
				}
				sendJson(res, 200, astRoot, req, corsConfig);
			} catch (e) {
				log$8.error("ast route failed", e);
				sendError(res, 500, ERROR_CODES.AST_PARSE_FAILED, req, corsConfig, e instanceof Error ? e.message : String(e));
			}
		})
	}), "codegraph: ast route");
}
function registerTreeSitterRoute(rc, sharedTreeSitterAdapter) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx, config } = deps;
	const routePath = "/api/v1/codegraph/tree-sitter";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("POST", routePath, corsConfig, rateLimiter, async (req, res) => {
			try {
				const body = await readBody(req, config.maxBodyBytes);
				const parsed = parseJsonBody(body);
				const filePath = extractStringField(parsed, "filePath");
				const content = extractStringField(parsed, "content");
				if (!filePath || !content) {
					sendError(res, 400, ERROR_CODES.FILEPATH_AND_CONTENT_REQUIRED, req, corsConfig);
					return;
				}
				if (filePath.includes("..") || filePath.length > VALIDATION.MAX_FILEPATH_LENGTH) {
					sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
					return;
				}
				const MAX_TREE_SITTER_CONTENT = AST.MAX_TREE_SITTER_CONTENT_BYTES;
				if (content.length > MAX_TREE_SITTER_CONTENT) {
					sendError(res, 413, ERROR_CODES.CONTENT_TOO_LARGE, req, corsConfig, `max ${MAX_TREE_SITTER_CONTENT} bytes, got ${content.length}`);
					return;
				}
				const result = await sharedTreeSitterAdapter.parseFile(filePath, content);
				sendJson(res, 200, result, req, corsConfig);
			} catch (e) {
				log$8.error("tree-sitter route failed", e);
				sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
			}
		})
	}), "codegraph: tree-sitter route");
}

//#endregion
//#region src/host/routes.ts
function registerRoutes(deps) {
	const { ctx, config } = deps;
	const invokeUpstream = deps.invokeUpstream ?? createInvokeUpstream(ctx, config);
	const corsConfig = { origins: config.allowedOrigins };
	const rateLimiter = createRateLimiter();
	const sharedTreeSitterAdapter = new TreeSitterAdapter();
	const rc = {
		deps,
		corsConfig,
		rateLimiter,
		invokeUpstream
	};
	registerStatusRoute(rc);
	registerHealthRoute(rc);
	registerWorkspaceRoute(rc);
	registerDataRoute(rc);
	registerScanRoute(rc);
	registerInitRoute(rc);
	registerWatchRoute(rc);
	registerDependenciesRoute(rc);
	registerDiffRoute(rc);
	registerAstRoute(rc, sharedTreeSitterAdapter);
	registerTreeSitterRoute(rc, sharedTreeSitterAdapter);
	registerBootstrapRoute(rc);
	registerNodeChildrenRoute(rc);
	registerFileOutlineRoute(rc);
	registerSymbolASTRoute(rc);
	registerEdgesRoute(rc);
	registerEventsRoute(rc);
	ctx.effect(() => () => rateLimiter.reset(), "codegraph: rate limiter cleanup");
	ctx.effect(() => () => sharedTreeSitterAdapter.destroy(), "codegraph: tree-sitter adapter cleanup");
}

//#endregion
//#region src/host/watcher.ts
const log$6 = scoped("host");
const supportsRecursive = platform() === "win32" || platform() === "darwin";
const MAX_CHANGED_FILES_TRACK = 100;
async function scanAndPush(ctx, invokeUpstream, path$1, changedFiles) {
	log$6.info("scan requested", {
		path: path$1,
		incremental: changedFiles !== void 0
	});
	try {
		const repoId = path$1 || "workspace-default";
		const data = await fetchMergedGraph(invokeUpstream, repoId, "both");
		ctx.emit("codegraph-visualizer/graph/updated", {
			repoId: RepoId(repoId),
			nodeCount: data.metadata.nodeCount,
			edgeCount: data.metadata.edgeCount,
			timestamp: data.metadata.timestamp,
			...changedFiles ? { changedFiles } : {}
		});
		ctx.emit("codegraph-visualizer/graph/data", {
			repoId: RepoId(repoId),
			nodes: data.nodes,
			edges: data.edges,
			timestamp: data.metadata.timestamp,
			...changedFiles ? { changedFiles } : {}
		});
		log$6.info("scan completed", {
			repoId,
			nodes: data.metadata.nodeCount,
			edges: data.metadata.edgeCount,
			changedFiles: changedFiles?.length ?? 0
		});
	} catch (e) {
		log$6.error("scan failed", e);
	}
}
function registerWatcher(ctx, config, invokeUpstream) {
	let watchTimer = null;
	let activeWatcher = null;
	let retryTimer = null;
	let retryCount = 0;
	const MAX_RETRIES = WATCHER.MAX_RETRIES;
	const RETRY_BASE_DELAY = WATCHER.RETRY_BASE_DELAY_MS;
	const changedFilesSet = new Set();
	const closeActiveWatcher = () => {
		if (activeWatcher) {
			try {
				activeWatcher.close();
			} catch (e) {
				log$6.warn("Failed to close watcher", e);
			}
			activeWatcher = null;
		}
		if (watchTimer) {
			clearTimeout(watchTimer);
			watchTimer = null;
		}
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		changedFilesSet.clear();
	};
	const setupWatch = (watchPath) => {
		try {
			const watchOpts = supportsRecursive ? { recursive: true } : {};
			activeWatcher = watch(watchPath, watchOpts, (_eventType, filename) => {
				if (!filename) return;
				const segments = filename.split(/[\\/]/);
				if (segments.includes(".codegraph")) return;
				if (segments.includes("node_modules")) return;
				if (segments.includes(".git")) return;
				changedFilesSet.add(filename);
				if (changedFilesSet.size > MAX_CHANGED_FILES_TRACK) changedFilesSet.clear();
				if (watchTimer) clearTimeout(watchTimer);
				watchTimer = setTimeout(() => {
					watchTimer = null;
					if (!activeWatcher) return;
					const changedFiles = [...changedFilesSet];
					changedFilesSet.clear();
					log$6.info("file changed, syncing + re-scanning", {
						count: changedFiles.length,
						files: changedFiles.slice(0, 5)
					});
					invokeUpstream("codegraph_sync", { path: watchPath }).then(() => scanAndPush(ctx, invokeUpstream, watchPath, changedFiles)).catch((e) => log$6.error("watch re-scan failed", e));
				}, config.watchDebounce);
			});
			retryCount = 0;
		} catch (e) {
			log$6.error("watch setup failed", e);
			if (retryCount < MAX_RETRIES) {
				retryCount++;
				const delay = RETRY_BASE_DELAY * Math.pow(2, retryCount - 1);
				log$6.info("retrying watch setup", {
					retryCount,
					delay,
					path: watchPath
				});
				retryTimer = setTimeout(() => setupWatch(watchPath), delay);
			} else {
				log$6.error("watch setup exhausted retries", { path: watchPath });
				ctx.emit("codegraph-visualizer/watch/error", {
					path: watchPath,
					message: ERROR_MESSAGES.WATCH_SETUP_FAILED?.en ?? "Watch setup failed after retries",
					errorCode: ERROR_CODES.WATCH_SETUP_FAILED,
					timestamp: Date.now()
				});
			}
		}
	};
	ctx.effect(() => {
		const dispose = ctx.on("codegraph-visualizer/watch/toggle", (event) => {
			closeActiveWatcher();
			if (!event.enabled) {
				log$6.info("watch disabled");
				return;
			}
			log$6.info("watch enabled", { path: event.path });
			retryCount = 0;
			setupWatch(event.path);
		});
		return () => {
			dispose();
			closeActiveWatcher();
		};
	}, "codegraph: watch toggle listener");
}
function registerEventListeners(ctx, invokeUpstream) {
	ctx.effect(() => ctx.on("codegraph-visualizer/repo/imported", (event) => {
		ctx.emit("codegraph-visualizer/graph/updated", {
			repoId: event.repoId,
			nodeCount: 0,
			edgeCount: 0,
			timestamp: event.timestamp
		});
	}), "codegraph: repo imported listener");
	ctx.effect(() => ctx.on("codegraph-visualizer/repo/scanned", (event) => {
		ctx.emit("codegraph-visualizer/graph/updated", {
			repoId: event.repoId,
			nodeCount: 0,
			edgeCount: 0,
			timestamp: event.timestamp
		});
	}), "codegraph: repo scanned listener");
	ctx.effect(() => ctx.on("codegraph-visualizer/repo/request-scan", async (event) => {
		await scanAndPush(ctx, invokeUpstream, event.path);
	}), "codegraph: repo request-scan listener");
	ctx.effect(() => ctx.on("codegraph-visualizer/graph/init", async (event) => {
		log$6.info("init requested", { path: event.path });
		try {
			const result = await invokeUpstream("codegraph_init", {
				path: event.path,
				force: true
			});
			const success = result !== null;
			const initResult = {
				success,
				path: event.path,
				message: success ? "Graph initialized successfully" : ERROR_MESSAGES.INIT_FAILED?.en ?? "Initialization failed",
				timestamp: Date.now()
			};
			if (!success) initResult.errorCode = ERROR_CODES.INIT_FAILED;
			ctx.emit("codegraph-visualizer/graph/init-result", initResult);
			if (success) await scanAndPush(ctx, invokeUpstream, event.path);
		} catch (e) {
			log$6.warn("graph init failed", e);
			ctx.emit("codegraph-visualizer/graph/init-result", {
				success: false,
				path: event.path,
				message: ERROR_MESSAGES.INIT_FAILED?.en ?? "Initialization failed",
				errorCode: ERROR_CODES.INIT_FAILED,
				timestamp: Date.now()
			});
		}
	}), "codegraph: graph init listener");
}

//#endregion
//#region src/host/McpServer.ts
const log$5 = scoped("mcp-server");
const MAX_MESSAGE_LENGTH = MCP.MAX_MESSAGE_LENGTH;
var McpServer = class {
	tools = new Map();
	running = false;
	rl = null;
	messageQueue = [];
	processing = false;
	registerTool(tool) {
		this.tools.set(tool.name, tool);
	}
	async start(getGraphData) {
		this.registerGraphTools(getGraphData);
		this.rl = createInterface({
			input: process.stdin,
			output: process.stdout
		});
		this.running = true;
		this.rl.on("line", (line) => {
			this.messageQueue.push(line);
			this.processQueue();
		});
		this.rl.on("close", () => {
			this.running = false;
			log$5.info("MCP server stopped");
		});
		this.rl.on("error", (err) => {
			log$5.error("MCP server stdin error", err);
			this.running = false;
			try {
				this.rl?.close();
			} catch {}
			this.rl = null;
		});
		log$5.info("MCP server started", { tools: this.tools.size });
	}
	async processQueue() {
		if (this.processing) return;
		this.processing = true;
		while (this.messageQueue.length > 0) {
			const line = this.messageQueue.shift();
			try {
				if (line.length > MAX_MESSAGE_LENGTH) {
					log$5.warn("MCP message too large, skipping", { length: line.length });
					continue;
				}
				const msg = JSON.parse(line);
				const response = await this.handleMessage(msg);
				if (response) process.stdout.write(JSON.stringify(response) + "\n");
			} catch (e) {
				log$5.warn("MCP message handling failed", e);
				try {
					const errorResponse = {
						jsonrpc: "2.0",
						id: null,
						error: {
							code: -32700,
							message: "Parse error"
						}
					};
					process.stdout.write(JSON.stringify(errorResponse) + "\n");
				} catch (e$1) {
					log$5.warn("Failed to send MCP error response", e$1);
				}
			}
		}
		this.processing = false;
	}
	async handleMessage(msg) {
		const method = msg["method"];
		const id = msg["id"];
		if (id !== null && typeof id !== "string" && typeof id !== "number") return {
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32600,
				message: "Invalid Request: id must be string, number, or null"
			}
		};
		if (msg["jsonrpc"] !== "2.0") return {
			jsonrpc: "2.0",
			id,
			error: {
				code: -32600,
				message: "Invalid Request: jsonrpc must be \"2.0\""
			}
		};
		if (method === "initialize") return {
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: "2024-11-05",
				capabilities: { tools: {} },
				serverInfo: {
					name: "dsh-codegraph-visualizer",
					version: PLUGIN_VERSION
				}
			}
		};
		if (method === "tools/list") return {
			jsonrpc: "2.0",
			id,
			result: { tools: Array.from(this.tools.values()).map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema
			})) }
		};
		if (method === "tools/call") {
			const params = msg["params"];
			if (typeof params !== "object" || params === null) return {
				jsonrpc: "2.0",
				id,
				error: {
					code: -32602,
					message: "Invalid params: expected object"
				}
			};
			const toolName = typeof params["name"] === "string" ? params["name"] : "";
			if (!toolName) return {
				jsonrpc: "2.0",
				id,
				error: {
					code: -32602,
					message: "Invalid params: tool name is required and must be a non-empty string"
				}
			};
			const args = typeof params["arguments"] === "object" && params["arguments"] !== null ? params["arguments"] : {};
			const tool = this.tools.get(toolName);
			if (!tool) return {
				jsonrpc: "2.0",
				id,
				error: {
					code: -32601,
					message: `Unknown tool: ${toolName}`
				}
			};
			try {
				const result = await tool.handler(args);
				return {
					jsonrpc: "2.0",
					id,
					result: { content: [{
						type: "text",
						text: JSON.stringify(result, null, 2)
					}] }
				};
			} catch (e) {
				return {
					jsonrpc: "2.0",
					id,
					error: {
						code: -32603,
						message: e instanceof Error ? e.message : String(e)
					}
				};
			}
		}
		return {
			jsonrpc: "2.0",
			id,
			error: {
				code: -32601,
				message: `Method not found: ${method}`
			}
		};
	}
	registerGraphTools(getGraphData) {
		this.registerTool({
			name: "graph_status",
			description: "Get the current graph status including node and edge counts",
			inputSchema: {
				type: "object",
				properties: {}
			},
			handler: async () => {
				const data = getGraphData();
				if (!data) return {
					status: "no data",
					nodes: 0,
					edges: 0
				};
				return {
					status: "ready",
					nodes: data.metadata.nodeCount,
					edges: data.metadata.edgeCount
				};
			}
		});
		this.registerTool({
			name: "graph_data",
			description: "Get the full graph data (nodes and edges)",
			inputSchema: {
				type: "object",
				properties: { limit: {
					type: "number",
					description: "Max nodes to return (default 100)"
				} }
			},
			handler: async (args) => {
				const data = getGraphData();
				if (!data) return {
					nodes: [],
					edges: []
				};
				const limit = safeNumber(args["limit"], 100);
				return {
					nodes: data.nodes.slice(0, limit).map((n) => ({
						id: n.id,
						label: n.label,
						type: n.type,
						filePath: n.filePath
					})),
					edges: data.edges.slice(0, limit * 2).map((e) => ({
						source: e.source,
						target: e.target,
						type: e.type
					})),
					totalNodes: data.metadata.nodeCount,
					totalEdges: data.metadata.edgeCount
				};
			}
		});
		this.registerTool({
			name: "graph_symbol",
			description: "Search for symbols in the graph by name",
			inputSchema: {
				type: "object",
				properties: { search: {
					type: "string",
					description: "Symbol name to search for"
				} },
				required: ["search"]
			},
			handler: async (args) => {
				const data = getGraphData();
				if (!data) return { results: [] };
				const search = safeString(args["search"]).toLowerCase();
				const exact = [];
				const partial = [];
				for (const n of data.nodes) {
					const labelLower = n.label.toLowerCase();
					if (labelLower === search) exact.push(n);
					else if (labelLower.includes(search)) partial.push(n);
				}
				const results = [...exact, ...partial].slice(0, 20).map((n) => ({
					id: n.id,
					label: n.label,
					type: n.type,
					filePath: n.filePath,
					lineNumber: n.lineNumber
				}));
				return {
					results,
					count: results.length
				};
			}
		});
		this.registerTool({
			name: "graph_impact",
			description: "Get impact analysis for a symbol (what depends on it)",
			inputSchema: {
				type: "object",
				properties: {
					symbol: {
						type: "string",
						description: "Symbol name to analyze"
					},
					depth: {
						type: "number",
						description: "Depth of impact analysis (default 2)"
					}
				},
				required: ["symbol"]
			},
			handler: async (args) => {
				const data = getGraphData();
				if (!data) return { impacted: [] };
				const symbol = safeString(args["symbol"]);
				const depth = safeNumber(args["depth"], 2);
				const targetNode = data.nodes.find((n) => n.label === symbol || n.label.endsWith(`.${symbol}`));
				if (!targetNode) return {
					impacted: [],
					message: "Symbol not found",
					errorCode: ERROR_CODES.SYMBOL_NOT_FOUND
				};
				const reverseAdj = buildBackwardAdjacency(data.edges);
				const result = bfsFrontierExpansion(reverseAdj, targetNode.id, depth, MCP.MAX_IMPACT_RESULTS);
				return {
					impacted: result.impacted,
					count: result.count,
					truncated: result.truncated
				};
			}
		});
	}
	stop() {
		this.running = false;
		if (this.rl) {
			this.rl.close();
			this.rl = null;
		}
	}
	isRunning() {
		return this.running;
	}
};

//#endregion
//#region src/host/compat/HostVersionDetector.ts
const log$4 = scoped("host:compat");
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/;
function parseVersion(raw) {
	const match = raw.match(VERSION_PATTERN);
	if (!match) return {
		raw,
		major: 0,
		minor: 0,
		patch: 0,
		prerelease: null,
		generation: "unknown"
	};
	const major = parseInt(match[1], 10);
	const minor = parseInt(match[2], 10);
	const patch = parseInt(match[3], 10);
	const prerelease = match[4] ?? null;
	let generation = "unknown";
	if (major === 0 && minor >= 1 && minor < 2) generation = "gen1";
	else if (major === 0 && minor >= 2) generation = "gen2";
	else if (major >= 1) generation = "gen3";
	return {
		raw,
		major,
		minor,
		patch,
		prerelease,
		generation
	};
}
function detectFromContext(ctx) {
	const candidates = [
		() => ctx.hostVersion,
		() => ctx.version,
		() => ctx.app?.version,
		() => ctx.runtime?.version
	];
	for (const fn of candidates) try {
		const v = fn();
		if (typeof v === "string" && v.length > 0) return v;
	} catch {}
	return null;
}
function detectFromEnv() {
	const envKeys = [
		"DSH_HOST_VERSION",
		"DSH_VERSION",
		"CODEARTS_HOST_VERSION"
	];
	for (const key of envKeys) {
		const v = process.env[key];
		if (v && v.length > 0) return v;
	}
	return null;
}
function detectFromToolNames(ctx) {
	try {
		const tools = ctx.tools;
		const hasGen2OnlyTool = tools.get("codegraph_incremental") ?? tools.get("codegraph_bootstrap");
		if (hasGen2OnlyTool) return "0.2.0";
		const hasGen1Tool = tools.get("codegraph_status") ?? tools.get("codegraph_graph");
		if (hasGen1Tool) return "0.1.7";
	} catch {}
	return null;
}
function detectHostVersion(ctx) {
	const sources = [
		() => detectFromContext(ctx),
		() => detectFromEnv(),
		() => detectFromToolNames(ctx)
	];
	for (const fn of sources) try {
		const raw = fn();
		if (raw) {
			const info = parseVersion(raw);
			log$4.info("host version detected", {
				raw,
				generation: info.generation
			});
			return info;
		}
	} catch {}
	log$4.info("host version unknown, assuming gen2 (current target)");
	return {
		raw: "unknown",
		major: 0,
		minor: 2,
		patch: 0,
		prerelease: null,
		generation: "gen2"
	};
}

//#endregion
//#region src/host/compat/FeatureFlags.ts
const log$3 = scoped("host:compat");
const GEN1_FLAGS = {
	incrementalBootstrap: false,
	workspaceRegistry: false,
	sessionsApi: true,
	betterSidebar: false,
	spotlight: false,
	remoteWebUi: false,
	mcpServer: true,
	rateLimiting: true,
	treeSitterWasm: true,
	healthScore: true,
	rulesCheck: true,
	multiWorkspace: false,
	aiAssist: false,
	crossRepo: false,
	desktopPlatform: false
};
const GEN2_FLAGS = {
	incrementalBootstrap: true,
	workspaceRegistry: true,
	sessionsApi: true,
	betterSidebar: true,
	spotlight: true,
	remoteWebUi: true,
	mcpServer: true,
	rateLimiting: true,
	treeSitterWasm: true,
	healthScore: true,
	rulesCheck: true,
	multiWorkspace: true,
	aiAssist: false,
	crossRepo: false,
	desktopPlatform: true
};
const GEN3_FLAGS = {
	...GEN2_FLAGS,
	aiAssist: true,
	crossRepo: true,
	desktopPlatform: true
};
const UNKNOWN_FLAGS = {
	...GEN2_FLAGS,
	incrementalBootstrap: false,
	remoteWebUi: false
};
function createFeatureFlags(info) {
	const flags = info.generation === "gen1" ? GEN1_FLAGS : info.generation === "gen2" ? GEN2_FLAGS : info.generation === "gen3" ? GEN3_FLAGS : UNKNOWN_FLAGS;
	log$3.info("feature flags resolved", {
		generation: info.generation,
		flags
	});
	return flags;
}

//#endregion
//#region src/host/compat/ApiCompatLayer.ts
const log$2 = scoped("host:compat");
const GEN1_MAPPING = {
	codegraphStatus: "codegraph_status",
	codegraphGraph: "codegraph_graph",
	codegraphQuery: "codegraph_query",
	codegraphFiles: "codegraph_files",
	codegraphImpact: "codegraph_impact",
	codegraphInit: "codegraph_init",
	codegraphSync: "codegraph_sync",
	codegraphCallers: "codegraph_callers",
	codegraphCallees: "codegraph_callees",
	codegraphBootstrap: null,
	codegraphIncremental: null,
	lensAnalyze: "lens_analyze",
	lensImpact: "lens_impact"
};
const GEN2_MAPPING = {
	...GEN1_MAPPING,
	codegraphBootstrap: "codegraph_bootstrap",
	codegraphIncremental: "codegraph_incremental"
};
function createToolNameMapping(info) {
	if (info.generation === "gen1") return GEN1_MAPPING;
	return GEN2_MAPPING;
}
function createApiCompatLayer(info) {
	const toolNames = createToolNameMapping(info);
	const keyByToolName = new Map();
	for (const key of Object.keys(toolNames)) {
		const actual = toolNames[key];
		if (actual) keyByToolName.set(actual, key);
	}
	const resolveToolName = (key) => {
		return toolNames[key];
	};
	const isToolAvailable = (ctx, key) => {
		const name$1 = resolveToolName(key);
		if (!name$1) return false;
		try {
			return !!ctx.tools.get(name$1);
		} catch {
			return false;
		}
	};
	const getAvailableToolName = (ctx, key) => {
		const primary = resolveToolName(key);
		if (primary && isToolAvailable(ctx, key)) return primary;
		const fallbacks = FALLBACK_CHAINS[key] ?? [];
		for (const fb of fallbacks) {
			const fbName = resolveToolName(fb);
			if (fbName) try {
				if (ctx.tools.get(fbName)) {
					log$2.info("tool name fallback", {
						key,
						primary,
						fallback: fbName
					});
					return fbName;
				}
			} catch {}
		}
		return null;
	};
	const getAvailableToolNameFor = (ctx, actualName) => {
		try {
			if (ctx.tools.get(actualName)) return actualName;
		} catch {}
		const key = keyByToolName.get(actualName);
		if (!key) return null;
		return getAvailableToolName(ctx, key);
	};
	return {
		versionInfo: info,
		toolNames,
		resolveToolName,
		isToolAvailable,
		getAvailableToolName,
		getAvailableToolNameFor
	};
}
const FALLBACK_CHAINS = {
	codegraphStatus: ["codegraphGraph", "codegraphQuery"],
	codegraphGraph: ["codegraphStatus", "codegraphQuery"],
	codegraphQuery: ["codegraphStatus", "codegraphGraph"],
	codegraphBootstrap: ["codegraphInit"],
	codegraphIncremental: ["codegraphSync", "codegraphInit"]
};

//#endregion
//#region src/host/db/schema.ts
const graphSnapshots = sqliteTable("graph_snapshots", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	repoId: text("repo_id").notNull(),
	snapshotHash: text("snapshot_hash").notNull(),
	nodeCount: integer("node_count").notNull().default(0),
	edgeCount: integer("edge_count").notNull().default(0),
	data: blob("data", { mode: "buffer" }),
	createdAt: integer("created_at").notNull().default(0)
}, (t) => ({
	repoIdx: index("idx_snapshots_repo").on(t.repoId),
	repoHashUniq: uniqueIndex("idx_snapshots_repo_hash").on(t.repoId, t.snapshotHash),
	repoCreatedIdx: index("idx_snapshots_repo_created").on(t.repoId, t.createdAt)
}));
const analysisResults = sqliteTable("analysis_results", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	repoId: text("repo_id").notNull(),
	analysisType: text("analysis_type").notNull(),
	targetNode: text("target_node"),
	result: text("result").notNull(),
	createdAt: integer("created_at").notNull().default(0)
}, (t) => ({
	repoTypeIdx: index("idx_analysis_repo_type").on(t.repoId, t.analysisType),
	repoTypeNodeUniq: uniqueIndex("idx_analysis_repo_type_node").on(t.repoId, t.analysisType, t.targetNode),
	repoTypeCreatedIdx: index("idx_analysis_repo_type_created").on(t.repoId, t.analysisType, t.createdAt)
}));
const userPreferences = sqliteTable("user_preferences", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	updatedAt: integer("updated_at").notNull().default(0)
});
const layoutPresets = sqliteTable("layout_presets", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	repoId: text("repo_id").notNull(),
	name: text("name").notNull(),
	layoutType: text("layout_type").notNull(),
	positions: text("positions").notNull(),
	createdAt: integer("created_at").notNull().default(0)
}, (t) => ({
	repoIdx: index("idx_layout_presets_repo").on(t.repoId),
	repoNameUniq: uniqueIndex("idx_layout_presets_repo_name").on(t.repoId, t.name),
	repoCreatedIdx: index("idx_layout_presets_repo_created").on(t.repoId, t.createdAt)
}));

//#endregion
//#region src/host/db/GraphRepository.ts
const log$1 = scoped("db:repository");
const SCHEMA_TABLES = [
	graphSnapshots,
	analysisResults,
	userPreferences,
	layoutPresets
];
const require = createRequire(import.meta.url);
const MIGRATION_SQL = [
	`CREATE TABLE IF NOT EXISTS graph_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL, node_count INTEGER NOT NULL DEFAULT 0, edge_count INTEGER NOT NULL DEFAULT 0, data BLOB, created_at INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS analysis_results (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id TEXT NOT NULL, analysis_type TEXT NOT NULL, target_node TEXT, result TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS user_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS layout_presets (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id TEXT NOT NULL, name TEXT NOT NULL, layout_type TEXT NOT NULL, positions TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0)`,
	`CREATE INDEX IF NOT EXISTS idx_snapshots_repo ON graph_snapshots(repo_id)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_repo_hash ON graph_snapshots(repo_id, snapshot_hash)`,
	`CREATE INDEX IF NOT EXISTS idx_snapshots_repo_created ON graph_snapshots(repo_id, created_at)`,
	`CREATE INDEX IF NOT EXISTS idx_analysis_repo_type ON analysis_results(repo_id, analysis_type)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_repo_type_node ON analysis_results(repo_id, analysis_type, IFNULL(target_node, ''))`,
	`CREATE INDEX IF NOT EXISTS idx_analysis_repo_type_created ON analysis_results(repo_id, analysis_type, created_at)`,
	`CREATE INDEX IF NOT EXISTS idx_layout_presets_repo ON layout_presets(repo_id)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_layout_presets_repo_name ON layout_presets(repo_id, name)`,
	`CREATE INDEX IF NOT EXISTS idx_layout_presets_repo_created ON layout_presets(repo_id, created_at)`
];
var GraphRepository = class {
	db = null;
	dbPath;
	constructor(workspacePath) {
		this.dbPath = join(workspacePath, ".codegraph-visualizer", "viz.db");
	}
	init() {
		try {
			mkdirSync(join(this.dbPath, ".."), { recursive: true });
			const { DatabaseSync } = require("node:sqlite");
			this.db = new DatabaseSync(this.dbPath);
			this.db.exec("PRAGMA journal_mode = WAL");
			this.db.exec("PRAGMA busy_timeout = 5000");
			this.db.exec("PRAGMA synchronous = NORMAL");
			for (const sql of MIGRATION_SQL) this.db.exec(sql);
			log$1.info("graph repository initialized", {
				path: this.dbPath,
				tables: SCHEMA_TABLES.length
			});
			return true;
		} catch (e) {
			log$1.warn("graph repository init failed", e);
			return false;
		}
	}
	saveSnapshot(repoId, hash, nodeCount, edgeCount, data) {
		if (!this.db) return;
		try {
			this.db.prepare(`INSERT INTO graph_snapshots (repo_id, snapshot_hash, node_count, edge_count, data, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(repo_id, snapshot_hash) DO UPDATE SET node_count = excluded.node_count, edge_count = excluded.edge_count, data = excluded.data, created_at = excluded.created_at`).run(repoId, hash, nodeCount, edgeCount, data, Date.now());
		} catch (e) {
			log$1.warn("saveSnapshot failed", e);
		}
	}
	getLatestSnapshot(repoId) {
		if (!this.db) return null;
		try {
			const row = this.db.prepare(`SELECT id, repo_id, snapshot_hash, node_count, edge_count, data, created_at FROM graph_snapshots WHERE repo_id = ? ORDER BY created_at DESC LIMIT 1`).get(repoId);
			if (!row) return null;
			return {
				id: row["id"],
				repoId: row["repo_id"],
				snapshotHash: row["snapshot_hash"],
				nodeCount: row["node_count"],
				edgeCount: row["edge_count"],
				data: row["data"],
				createdAt: row["created_at"]
			};
		} catch (e) {
			log$1.warn("getLatestSnapshot failed", e);
			return null;
		}
	}
	saveAnalysis(repoId, type, result, targetNode) {
		if (!this.db) return;
		try {
			this.db.prepare(`INSERT OR REPLACE INTO analysis_results (repo_id, analysis_type, target_node, result, created_at) VALUES (?, ?, ?, ?, ?)`).run(repoId, type, targetNode ?? null, result, Date.now());
		} catch (e) {
			log$1.warn("saveAnalysis failed", e);
		}
	}
	getAnalysis(repoId, type, targetNode) {
		if (!this.db) return null;
		try {
			const sql = targetNode ? `SELECT id, repo_id, analysis_type, target_node, result, created_at FROM analysis_results WHERE repo_id = ? AND analysis_type = ? AND target_node = ? ORDER BY created_at DESC LIMIT 1` : `SELECT id, repo_id, analysis_type, target_node, result, created_at FROM analysis_results WHERE repo_id = ? AND analysis_type = ? ORDER BY created_at DESC LIMIT 1`;
			const params = targetNode ? [
				repoId,
				type,
				targetNode
			] : [repoId, type];
			const row = this.db.prepare(sql).get(...params);
			if (!row) return null;
			return {
				id: row["id"],
				repoId: row["repo_id"],
				analysisType: row["analysis_type"],
				targetNode: row["target_node"],
				result: row["result"],
				createdAt: row["created_at"]
			};
		} catch (e) {
			log$1.warn("getAnalysis failed", e);
			return null;
		}
	}
	setPreference(key, value) {
		if (!this.db) return;
		try {
			this.db.prepare(`INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, Date.now());
		} catch (e) {
			log$1.warn("setPreference failed", e);
		}
	}
	getPreference(key) {
		if (!this.db) return null;
		try {
			const row = this.db.prepare(`SELECT value FROM user_preferences WHERE key = ?`).get(key);
			return row?.["value"] ?? null;
		} catch (e) {
			log$1.warn("getPreference failed", e);
			return null;
		}
	}
	saveLayoutPreset(repoId, name$1, layoutType, positions) {
		if (!this.db) return;
		try {
			this.db.prepare(`INSERT INTO layout_presets (repo_id, name, layout_type, positions, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(repo_id, name) DO UPDATE SET layout_type = excluded.layout_type, positions = excluded.positions, created_at = excluded.created_at`).run(repoId, name$1, layoutType, positions, Date.now());
		} catch (e) {
			log$1.warn("saveLayoutPreset failed", e);
		}
	}
	getLayoutPresets(repoId) {
		if (!this.db) return [];
		try {
			const rows = this.db.prepare(`SELECT id, name, layout_type, positions FROM layout_presets WHERE repo_id = ? ORDER BY created_at DESC`).all(repoId);
			return rows.map((row) => ({
				id: row["id"],
				name: row["name"],
				layoutType: row["layout_type"],
				positions: row["positions"]
			}));
		} catch (e) {
			log$1.warn("getLayoutPresets failed", e);
			return [];
		}
	}
	close() {
		if (this.db) {
			try {
				this.db.close();
			} catch {}
			this.db = null;
		}
	}
	isReady() {
		return this.db !== null;
	}
};

//#endregion
//#region src/index.ts
const log = scoped("host");
const name = "dsh-codegraph-visualizer";
const inject = [
	"tools",
	"webServer",
	"sessions",
	"workspaceRegistry"
];
async function apply(ctx, userConfig) {
	const config = resolveConfig(userConfig);
	const securityManager = createSecurityManager();
	securityManager.setAllowedWorkspaceRoots(extractWorkspacePaths(ctx));
	const hostVersionInfo = detectHostVersion(ctx);
	const featureFlags = createFeatureFlags(hostVersionInfo);
	const apiCompat = createApiCompatLayer(hostVersionInfo);
	const workspacePaths = extractWorkspacePaths(ctx);
	const primaryWorkspace = workspacePaths[0] ?? process.cwd();
	const graphRepo = new GraphRepository(primaryWorkspace);
	const repoReady = graphRepo.init();
	if (!repoReady) log.warn("graph repository init failed, persistence disabled");
	const { graphStatus, graphData, graphSymbol, graphImpact, graphPathFind, graphHealth, graphRulesCheck, graphFocus, dispose: disposeGraphTools } = await createGraphTools(ctx, {
		requestTimeout: config.requestTimeout,
		apiCompat
	});
	ctx.effect(() => {
		const d1 = ctx.tools.register(graphStatus);
		const d2 = ctx.tools.register(graphData);
		const d3 = ctx.tools.register(graphSymbol);
		const d4 = ctx.tools.register(graphImpact);
		const d5 = ctx.tools.register(graphPathFind);
		const d6 = ctx.tools.register(graphHealth);
		const d7 = ctx.tools.register(graphRulesCheck);
		const d8 = ctx.tools.register(graphFocus);
		return () => {
			d1();
			d2();
			d3();
			d4();
			d5();
			d6();
			d7();
			d8();
		};
	}, "codegraph: tool registrations");
	let lastGraphData = null;
	let lastInitResult = null;
	const scanInFlightMap = new Map();
	const scanCache = new Map();
	const invokeUpstream = createInvokeUpstream(ctx, config, apiCompat);
	const routeDeps = {
		ctx,
		config,
		securityManager,
		invokeUpstream,
		apiCompat,
		featureFlags,
		getLastGraphData: () => lastGraphData,
		setLastGraphData: (data) => {
			lastGraphData = data;
		},
		getLastInitResult: () => lastInitResult,
		setLastInitResult: (data) => {
			lastInitResult = data;
		},
		getScanCache: () => scanCache,
		getScanInFlight: (path$1) => scanInFlightMap.get(path$1) ?? null,
		setScanInFlight: (path$1, p) => {
			if (p === null) scanInFlightMap.delete(path$1);
			else scanInFlightMap.set(path$1, p);
		},
		graphRepo: repoReady ? graphRepo : void 0
	};
	registerService(routeDeps);
	registerRoutes(routeDeps);
	let lastStatus = "";
	const emitPrereqStatus = () => {
		const status = checkPrerequisites(ctx, apiCompat);
		const statusKey = `${status.codegraph}:${status.lens}:${status.builtin}`;
		ctx.emit("codegraph-visualizer/prerequisite/status", {
			codegraph: status.codegraph,
			lens: status.lens,
			builtin: status.builtin,
			timestamp: Date.now()
		});
		if (statusKey !== lastStatus) {
			log.info("prerequisite status", status);
			lastStatus = statusKey;
		}
	};
	emitPrereqStatus();
	ctx.effect(() => {
		let pollCount = 0;
		const MAX_POLLS = 6;
		const prereqTimer = setInterval(() => {
			pollCount++;
			const status = checkPrerequisites(ctx, apiCompat);
			const statusKey = `${status.codegraph}:${status.lens}:${status.builtin}`;
			ctx.emit("codegraph-visualizer/prerequisite/status", {
				codegraph: status.codegraph,
				lens: status.lens,
				builtin: status.builtin,
				timestamp: Date.now()
			});
			if (statusKey !== lastStatus) {
				log.info("prerequisite status", status);
				lastStatus = statusKey;
			}
			if (status.codegraph || status.lens || pollCount >= MAX_POLLS) clearInterval(prereqTimer);
		}, config.prerequisiteRetryDelay);
		return () => clearInterval(prereqTimer);
	}, "codegraph: prereq re-check timer");
	ctx.effect(() => ctx.on("codegraph-visualizer/prerequisite/request", () => {
		emitPrereqStatus();
	}), "codegraph: prerequisite request listener");
	registerEventListeners(ctx, invokeUpstream);
	registerWatcher(ctx, config, invokeUpstream);
	const mcpServer = new McpServer();
	ctx.effect(() => {
		mcpServer.start(() => lastGraphData);
		return () => mcpServer.stop();
	}, "codegraph: MCP server");
	ctx.effect(() => {
		return () => {
			scanCache.clear();
			scanInFlightMap.clear();
			lastGraphData = null;
			lastInitResult = null;
			securityManager.reset();
			disposeGraphTools();
			closeAllDbConnections();
			graphRepo.close();
		};
	}, "codegraph: state cleanup");
}

//#endregion
export { DEFAULT_CONFIG, PLUGIN_VERSION, SecurityManager, apply, createSecurityManager, inject, name, resolveConfig };
//# sourceMappingURL=index.js.map