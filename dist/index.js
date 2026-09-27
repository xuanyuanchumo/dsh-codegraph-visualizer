import { EdgeId, NodeId, RepoId, inferLayerFromPath, safeNumber, safeString, scoped } from "./layerUtils-D2FWijsm.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { CallId } from "@deepseek-ai/dsh-llm";
import path, { isAbsolute, normalize, sep } from "node:path";
import { platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import { createInterface } from "node:readline";

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
		return {
			nodes: Array.from(nodes.values()),
			edges: Array.from(edges.values()),
			metadata: {
				repoId,
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
//#region src/shared/constants.ts
const PATH_FINDER = { MAX_NODES_FOR_BFS: 5e4 };
const API = {
	DEFAULT_TIMEOUT_MS: 3e4,
	RATE_LIMIT_WINDOW_MS: 6e4,
	RATE_LIMIT_DEFAULT: 60,
	RATE_LIMIT_HEAVY: 10,
	RATE_LIMIT_MAP_MAX: 1e4,
	SCAN_TIMEOUT_MS: 6e4
};
const HEALTH_SCORE = {
	WEIGHT_COUPLING: .25,
	WEIGHT_COHESION: .25,
	WEIGHT_CYCLIC: .3,
	WEIGHT_MODULARITY: .2,
	DEFAULT_MAX_MODULE_DEPTH: 3
};
const LAYOUT = {
	DENSITY_FACTOR_SMALL: 1.5,
	DENSITY_FACTOR_MEDIUM: 1,
	DENSITY_FACTOR_LARGE: .7,
	SMALL_NODE_THRESHOLD: 50,
	MEDIUM_NODE_THRESHOLD: 200,
	LARGE_NODE_THRESHOLD: 500,
	VERY_LARGE_NODE_THRESHOLD: 2e3,
	LAYOUT_SAMPLE_SIZE: 200,
	COSE_NUM_ITER: 2500,
	COSE_LARGE_NUM_ITER: 15e3,
	MAX_RANK_SEP: 80,
	MIN_RANK_SEP: 30,
	MIN_NODE_SPACING: 20,
	SMALL_SPACING_FACTOR: 1.2,
	MEDIUM_SPACING_FACTOR: 1,
	LARGE_SPACING_FACTOR: .8,
	SMALL_NODE_COUNT_THRESHOLD: 100,
	MEDIUM_NODE_COUNT_THRESHOLD: 300,
	INCREMENTAL_RADIUS_BASE: 100,
	GRID_FALLBACK_NODE_THRESHOLD: 5e3,
	OVERLAP_MAX_ITERATIONS: 15,
	OVERLAP_SKIP_THRESHOLD: 5e3,
	OVERLAP_CELL_SIZE_MULTIPLIER: 4,
	GOLDEN_ANGLE: Math.PI * (3 - Math.sqrt(5)),
	OVERLAP_PUSH_COEFFICIENT: .15,
	OVERLAP_MIN_PUSH: 2,
	FCOSE_LARGE_NODE_THRESHOLD: 5e3,
	FCOSE_LARGE_NUM_ITER: 1e3,
	FCOSE_LARGE_QUALITY: "draft",
	NODE_REPULSE_MAX: 2e4
};
const MCP = {
	MAX_MESSAGE_LENGTH: 10 * 1024 * 1024,
	MAX_IMPACT_RESULTS: 500
};
const CACHE = { GRAPH_CACHE_LIMIT: 8 };
const BOOTSTRAP = {
	TOP_LEVEL_NODE_LIMIT: 50,
	CHILDREN_PAGE_SIZE: 50
};
const VALIDATION = {
	MAX_PATH_LENGTH: 4096,
	MAX_GIT_REF_LENGTH: 256,
	MAX_FILEPATH_LENGTH: 512
};
const AST = {
	MAX_CONTENT_BYTES: 512 * 1024,
	MAX_TREE_SITTER_CONTENT_BYTES: 512 * 1024
};
const WATCHER = {
	MAX_RETRIES: 3,
	RETRY_BASE_DELAY_MS: 1e3
};
const TOOL_MESSAGES = {
	NO_PATH_FOUND: {
		en: "No path found between the specified symbols.",
		zh: "未找到指定符号之间的路径。"
	},
	GRAPH_TOO_LARGE_FOR_PATH: {
		en: "Graph too large (>50000 nodes) for path finding. Try filtering first.",
		zh: "图谱过大（>50000 节点），无法进行路径查找。请先尝试筛选。"
	},
	PATH_FOUND: {
		en: "Path found",
		zh: "路径已找到"
	},
	HOPS: {
		en: "hops",
		zh: "跳"
	},
	INSUFFICIENT_DATA: {
		en: "Insufficient data for health scoring.",
		zh: "数据不足，无法进行健康评分。"
	},
	NO_VIOLATIONS: {
		en: "No rule violations detected.",
		zh: "未检测到规则违规。"
	},
	RULE_VIOLATIONS: {
		en: "rule violations:",
		zh: "条规则违规："
	}
};
const ERROR_CODES = {
	PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED",
	WORKSPACE_PATH_NOT_ALLOWED: "WORKSPACE_PATH_NOT_ALLOWED",
	SYMLINK_ESCAPE: "SYMLINK_ESCAPE",
	NO_WORKSPACE_PATH: "NO_WORKSPACE_PATH",
	PATH_OUTSIDE_WORKSPACE: "PATH_OUTSIDE_WORKSPACE",
	SCAN_FAILED: "SCAN_FAILED",
	INIT_FAILED: "INIT_FAILED",
	WATCH_TOGGLE_FAILED: "WATCH_TOGGLE_FAILED",
	WATCH_SETUP_FAILED: "WATCH_SETUP_FAILED",
	INTERNAL_ERROR: "INTERNAL_ERROR",
	COMMITS_REQUIRED: "COMMITS_REQUIRED",
	INVALID_GIT_REF: "INVALID_GIT_REF",
	GRAPH_DIFF_FAILED: "GRAPH_DIFF_FAILED",
	FILEPATH_REQUIRED: "FILEPATH_REQUIRED",
	FILE_TOO_LARGE: "FILE_TOO_LARGE",
	AST_PARSE_FAILED: "AST_PARSE_FAILED",
	FILEPATH_AND_CONTENT_REQUIRED: "FILEPATH_AND_CONTENT_REQUIRED",
	INVALID_FILEPATH: "INVALID_FILEPATH",
	CONTENT_TOO_LARGE: "CONTENT_TOO_LARGE",
	METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
	RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
	SYMBOL_NOT_FOUND: "SYMBOL_NOT_FOUND",
	BODY_TOO_LARGE: "BODY_TOO_LARGE",
	INVALID_JSON_BODY: "INVALID_JSON_BODY",
	INVALID_CONFIG: "INVALID_CONFIG"
};
const ERROR_MESSAGES = {
	PATH_NOT_ALLOWED: {
		en: "Path not allowed",
		zh: "路径不允许访问"
	},
	WORKSPACE_PATH_NOT_ALLOWED: {
		en: "Workspace path not allowed",
		zh: "工作区路径不允许访问"
	},
	SYMLINK_ESCAPE: {
		en: "Access denied: symlink escape",
		zh: "访问被拒绝：符号链接逃逸"
	},
	NO_WORKSPACE_PATH: {
		en: "No workspace path configured",
		zh: "未配置工作区路径"
	},
	PATH_OUTSIDE_WORKSPACE: {
		en: "Access denied: path outside workspace",
		zh: "访问被拒绝：路径超出工作区范围"
	},
	SCAN_FAILED: {
		en: "Scan failed — check codegraph installation",
		zh: "扫描失败 — 请检查 codegraph 安装"
	},
	INIT_FAILED: {
		en: "Initialization failed — is dsh-codegraph installed?",
		zh: "初始化失败 — dsh-codegraph 是否已安装？"
	},
	WATCH_TOGGLE_FAILED: {
		en: "Watch toggle failed",
		zh: "监听切换失败"
	},
	WATCH_SETUP_FAILED: {
		en: "Watch setup failed after retries",
		zh: "监听设置在重试后失败"
	},
	INTERNAL_ERROR: {
		en: "Internal server error",
		zh: "服务器内部错误"
	},
	COMMITS_REQUIRED: {
		en: "from and to commits are required",
		zh: "需要 from 和 to 提交参数"
	},
	INVALID_GIT_REF: {
		en: "Invalid git ref format",
		zh: "无效的 Git 引用格式"
	},
	GRAPH_DIFF_FAILED: {
		en: "Graph diff failed — check git refs",
		zh: "图谱差异计算失败 — 请检查 Git 引用"
	},
	FILEPATH_REQUIRED: {
		en: "filePath is required",
		zh: "filePath 参数为必填"
	},
	FILE_TOO_LARGE: {
		en: "File too large for AST parsing",
		zh: "文件过大，无法进行 AST 解析"
	},
	AST_PARSE_FAILED: {
		en: "AST parsing failed",
		zh: "AST 解析失败"
	},
	FILEPATH_AND_CONTENT_REQUIRED: {
		en: "filePath and content are required",
		zh: "filePath 和 content 参数为必填"
	},
	INVALID_FILEPATH: {
		en: "Invalid filePath",
		zh: "无效的 filePath"
	},
	CONTENT_TOO_LARGE: {
		en: "Content too large for tree-sitter parsing",
		zh: "内容过大，无法进行 tree-sitter 解析"
	},
	METHOD_NOT_ALLOWED: {
		en: "Method not allowed",
		zh: "请求方法不被允许"
	},
	RATE_LIMIT_EXCEEDED: {
		en: "Rate limit exceeded",
		zh: "请求频率超限"
	},
	SYMBOL_NOT_FOUND: {
		en: "Symbol not found",
		zh: "未找到符号"
	},
	BODY_TOO_LARGE: {
		en: "Request body too large",
		zh: "请求体过大"
	},
	INVALID_JSON_BODY: {
		en: "Invalid JSON body: expected object",
		zh: "无效的 JSON 请求体：应为对象"
	},
	INVALID_CONFIG: {
		en: "Invalid configuration",
		zh: "无效的配置"
	}
};

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
var HealthScorer = class {
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
		const cyclicDependencyRate = this.calculateCyclicDependencyRate(nodes, edges);
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
	calculateCyclicDependencyRate(nodes, edges) {
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
		let index = 0;
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
					indices.set(v, index);
					lowLinks.set(v, index);
					index++;
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
function detectCyclesDFS(adjacency) {
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
	for (const id of adjacency.keys()) if (!visited.has(id)) enter(id);
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
const log$8 = scoped("tools");
function toJsonValue(value) {
	return JSON.parse(JSON.stringify(value));
}
const GRAPH_CACHE_LIMIT = CACHE.GRAPH_CACHE_LIMIT;
async function createGraphToolDeps() {
	const [{ CodeGraphAdapter: CGA }, { LensAdapter: LA }] = await Promise.all([import("./CodeGraphAdapter-CBi5SU0N.js"), import("./LensAdapter-C7mdpgzf.js")]);
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
	if (source === "codegraph" || source === "both") tasks.push(d.codegraphAdapter.fetchData(repoId, invoke));
	if (source === "lens" || source === "both") tasks.push(d.lensAdapter.fetchData(repoId, invoke));
	const settled = await Promise.allSettled(tasks);
	const results = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
	return d.merger.merge(results, RepoId(repoId));
}
function createInvoke(ctx, requestTimeout = 5e3) {
	return async (tool, args) => {
		try {
			const result = await ctx.tools.execute({
				callId: CallId(`codegraph:${tool}`),
				name: tool,
				arguments: args,
				signal: AbortSignal.timeout(requestTimeout)
			});
			if (result.isError) return null;
			return result.value ?? null;
		} catch (e) {
			log$8.warn("createInvoke: tool execution failed", {
				tool,
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
	const invoke = createInvoke(ctx, options.requestTimeout);
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
					"both"
				],
				description: "Data source; defaults to both."
			}
		},
		output: {
			schema: { type: "json" },
			render: renderGraphData
		},
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
const log$7 = scoped("host");
const execFileAsync = promisify(execFile);
function checkPrerequisites(ctx) {
	try {
		const cg = ctx.tools.get("codegraph_status") ?? ctx.tools.get("codegraph_graph") ?? ctx.tools.get("codegraph_query");
		const lens = ctx.tools.get("lens_analyze");
		return {
			codegraph: !!cg,
			lens: !!lens
		};
	} catch (e) {
		log$7.warn("checkPrerequisites failed", e);
		return {
			codegraph: false,
			lens: false
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
		log$7.warn("extractWorkspacePaths: workspaceRegistry failed", e);
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
		log$7.warn("extractWorkspacePaths: sessions failed", e);
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
		log$7.warn("findWorkspacePath: workspaceRegistry failed", e);
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
		log$7.warn("findWorkspacePath: sessions failed", e);
	}
	return process.cwd();
}

//#endregion
//#region src/adapters/DependencyAdapter.ts
const log$6 = scoped("dep-adapter");
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
			version: pkg.version || "0.0.0",
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
						version: String(version),
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
		log$6.warn("parsePackageJson failed", e);
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
		log$6.warn("parseCargoToml failed", e);
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
		log$6.warn("parseGoMod failed", e);
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
const MAX_DEEP_EQUAL_DEPTH = 50;
function deepEqual(a, b, seen, depth) {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (depth !== void 0 && depth > MAX_DEEP_EQUAL_DEPTH) return false;
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
//#region src/adapters/TreeSitterAdapter.ts
const log$5 = scoped("tree-sitter-adapter");
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
			log$5.warn(`TreeSitter init skipped after ${this.initAttempts} failed attempts`);
			return;
		}
		this.initAttempts++;
		try {
			const { Parser } = await import("web-tree-sitter");
			await Parser.init();
			this.parser = new Parser();
			this.initAttempts = 0;
			log$5.info("TreeSitter parser initialized");
		} catch (e) {
			log$5.warn(`Failed to init TreeSitter (attempt ${this.initAttempts}/${TreeSitterAdapter.MAX_INIT_ATTEMPTS})`, e);
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
				log$5.debug("old language cleanup failed", { error: e });
			}
			const parser = this.parser;
			if (!parser) return false;
			parser.setLanguage(langModule);
			this.currentLanguage = langModule;
			this.loadedLanguages.add(language);
			return true;
		} catch (e) {
			log$5.warn(`Failed to load language: ${language}`, e);
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
			log$5.warn("parseFile failed", {
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
	async loadLanguageWasm(language) {
		const wasmFile = `tree-sitter-${language}.wasm`;
		const { Language } = await import("web-tree-sitter");
		const candidates = [];
		if (typeof process !== "undefined" && process.versions?.node) try {
			const { getWasmPath } = await import("tree-sitter-wasm");
			const absPath = getWasmPath(language);
			candidates.push(absPath);
		} catch (e) {
			log$5.debug("tree-sitter-wasm not available", { error: e });
		}
		const doc = globalThis.document;
		if (doc && doc.baseURI) {
			try {
				candidates.push(new URL(`plugins/dsh-codegraph-visualizer/${wasmFile}`, doc.baseURI).href);
			} catch (e) {
				log$5.debug("URL resolution fallback", { error: e });
			}
			try {
				candidates.push(new URL(`node_modules/web-tree-sitter/dist/${wasmFile}`, doc.baseURI).href);
			} catch (e) {
				log$5.debug("URL resolution fallback", { error: e });
			}
			try {
				candidates.push(new URL(wasmFile, doc.baseURI).href);
			} catch (e) {
				log$5.debug("URL resolution fallback", { error: e });
			}
		}
		candidates.push(wasmFile);
		for (const path$1 of candidates) try {
			return await Language.load(path$1);
		} catch (e) {
			log$5.debug("candidate path failed", {
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
						nodes.push({
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
						});
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
				log$5.warn("parseToAst: parser not initialized after init()");
				return null;
			}
		}
		const language = this.detectLanguage(filePath);
		if (!language) {
			log$5.warn(`parseToAst: unsupported file extension: ${filePath}`);
			return null;
		}
		if (!await this.ensureLanguageLoaded(language)) {
			log$5.warn(`parseToAst: failed to load language ${language}`);
			return null;
		}
		try {
			const tree = this.parser.parse(content);
			const astRoot = this.convertToAstNode(tree.rootNode);
			tree.delete();
			return astRoot;
		} catch (e) {
			log$5.warn(`parseToAst: parse failed for ${filePath}:`, e);
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
const log$4 = scoped("host");
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
const GIT_REF_PATTERN = /^[a-zA-Z0-9._/-]+$/;
function isSafeGitRef(ref) {
	if (!GIT_REF_PATTERN.test(ref)) return false;
	if (ref.includes("..")) return false;
	return true;
}
async function validatePathRealpath(scanPath, securityManager) {
	try {
		const realPath = await fs.realpath(scanPath);
		return securityManager.isPathAllowed(realPath);
	} catch (e) {
		log$4.warn("validatePathRealpath failed", e);
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
	log$4.info("request", {
		method: req.method,
		path: routePath,
		ip: getClientIp(req)
	});
}

//#endregion
//#region src/host/routes.ts
const log$3 = scoped("host");
function withRouteMiddleware(method, routePath, corsConfig, rateLimiter, handler) {
	return async (req, res) => {
		if (handleCorsPreflight(req, res, corsConfig)) return;
		if (!requireMethod(req, res, method, corsConfig)) return;
		logRequest(req, routePath);
		if (!checkRate(req, res, routePath, rateLimiter, corsConfig)) return;
		await handler(req, res);
	};
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
		properties: n.properties ?? {}
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
function createInvokeUpstream(ctx, config) {
	return createInvoke(ctx, config.requestTimeout);
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
					log$3.warn("getGraphData failed", e);
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
				lens: status.lens
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
				const healthy = status.codegraph;
				sendJson(res, healthy ? 200 : 503, {
					status: healthy ? "healthy" : "degraded",
					codegraph: status.codegraph,
					lens: status.lens,
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
function registerDataRoute(rc) {
	const { deps, corsConfig, rateLimiter } = rc;
	const { ctx } = deps;
	const routePath = "/api/v1/codegraph/data";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, (req, res) => {
			const ifNoneMatch = req.headers["if-none-match"];
			const lastGraphData = deps.getLastGraphData();
			if (ifNoneMatch && lastGraphData) {
				const clientTimestamp = parseInt(String(ifNoneMatch), 10);
				if (clientTimestamp >= lastGraphData.metadata.timestamp) {
					const corsHeaders = buildCorsHeaders(req, corsConfig);
					corsHeaders["etag"] = String(lastGraphData.metadata.timestamp);
					res.writeHead(304, corsHeaders);
					res.end();
					return;
				}
			}
			if (lastGraphData) {
				const dataHeaders = buildCorsHeaders(req, corsConfig);
				dataHeaders["content-type"] = "application/json";
				dataHeaders["etag"] = String(lastGraphData.metadata.timestamp);
				res.writeHead(200, dataHeaders);
				res.end(JSON.stringify(lastGraphData));
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
					sendJson(res, 200, {
						success: true,
						...cached.data
					}, req, corsConfig);
					return;
				}
				const inFlight = deps.getScanInFlight(scanPath);
				if (inFlight) {
					const data = await inFlight;
					sendJson(res, 200, {
						success: true,
						...data
					}, req, corsConfig);
					return;
				}
				const scanPromise = fetchMergedGraph(invokeUpstream, repoId, "both").then((raw) => slimGraphData(raw, config.maxNodes));
				deps.setScanInFlight(scanPath, scanPromise);
				try {
					const data = await scanPromise;
					deps.setScanInFlight(scanPath, null);
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
					log$3.info("scan completed", {
						repoId,
						nodes: data.metadata.nodeCount,
						edges: data.metadata.edgeCount
					});
					sendJson(res, 200, {
						success: true,
						...data
					}, req, corsConfig);
				} catch (e) {
					deps.setScanInFlight(scanPath, null);
					throw e;
				}
			} catch (e) {
				log$3.error("scan failed", e);
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
				log$3.info("init requested", { path: initPath });
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
				}
				sendJson(res, 200, initResult, req, corsConfig);
			} catch (e) {
				log$3.error("init route failed", e);
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
				log$3.warn("watch route failed", e);
				sendError(res, 500, ERROR_CODES.WATCH_TOGGLE_FAILED, req, corsConfig);
			}
		})
	}), "codegraph: watch route");
}
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
					if (e.code !== "ENOENT") log$3.warn(`Failed to read ${filename}:`, e);
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
				log$3.error("dependencies route failed", e);
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
				log$3.error("diff route failed", e);
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
				log$3.error("ast route failed", e);
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
				log$3.error("tree-sitter route failed", e);
				sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
			}
		})
	}), "codegraph: tree-sitter route");
}
function registerBootstrapRoute(rc) {
	const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
	const { ctx, config } = deps;
	const routePath = "/api/v1/codegraph/bootstrap";
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: routePath,
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, async (req, res) => {
			let lastGraphData = deps.getLastGraphData();
			if (!lastGraphData || lastGraphData.nodes.length === 0) try {
				const workspacePath = findWorkspacePath(ctx);
				if (workspacePath && invokeUpstream) {
					const raw = await fetchMergedGraph(invokeUpstream, workspacePath, "both");
					lastGraphData = slimGraphData(raw, config.maxNodes);
					deps.setLastGraphData(lastGraphData);
				}
			} catch (e) {
				log$3.warn("bootstrap: failed to fetch from upstream", e);
			}
			if (!lastGraphData || lastGraphData.nodes.length === 0) try {
				const workspacePath = findWorkspacePath(ctx);
				if (workspacePath && deps.invokeUpstream) {
					const raw = await fetchMergedGraph(deps.invokeUpstream, workspacePath, "both");
					lastGraphData = slimGraphData(raw, config.maxNodes);
					deps.setLastGraphData(lastGraphData);
				}
			} catch (e) {
				log$3.warn("bootstrap: failed to fetch from upstream", e);
			}
			if (!lastGraphData || lastGraphData.nodes.length === 0) {
				sendJson(res, 200, {
					rootNodes: [],
					topLevelNodes: [],
					topLevelTotal: 0,
					edges: [],
					indexStatus: "empty",
					metadata: {
						repoId: RepoId("empty"),
						timestamp: 0,
						totalNodeCount: 0,
						totalEdgeCount: 0
					}
				}, req, corsConfig);
				return;
			}
			const allRootNodes = lastGraphData.nodes.filter((n) => !n.parentId);
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
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, (req, res) => {
			const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
			const nodeId = url.searchParams.get("nodeId");
			if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
				sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
				return;
			}
			const lastGraphData = deps.getLastGraphData();
			if (!lastGraphData) {
				sendJson(res, 200, {
					nodes: [],
					edges: [],
					cursor: null,
					total: 0
				}, req, corsConfig);
				return;
			}
			const cursor = parseInt(url.searchParams.get("cursor") ?? "0", 10) || 0;
			const limit = parseInt(url.searchParams.get("limit") ?? String(BOOTSTRAP.CHILDREN_PAGE_SIZE), 10) || BOOTSTRAP.CHILDREN_PAGE_SIZE;
			const children = lastGraphData.nodes.filter((n) => n.parentId === nodeId);
			const page = children.slice(cursor, cursor + limit);
			const childIds = new Set(page.map((n) => n.id));
			const childEdges = lastGraphData.edges.filter((e) => childIds.has(e.source) && childIds.has(e.target));
			sendJson(res, 200, {
				nodes: page,
				edges: childEdges,
				cursor: cursor + page.length < children.length ? String(cursor + page.length) : null,
				total: children.length
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
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, (req, res) => {
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
			const lastGraphData = deps.getLastGraphData();
			if (!lastGraphData) {
				sendJson(res, 200, {
					symbols: [],
					edges: []
				}, req, corsConfig);
				return;
			}
			const symbols = lastGraphData.nodes.filter((n) => n.parentId === nodeId);
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
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, (req, res) => {
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
			const lastGraphData = deps.getLastGraphData();
			if (!lastGraphData) {
				sendJson(res, 200, {
					astNodes: [],
					astEdges: [],
					sourceLines: []
				}, req, corsConfig);
				return;
			}
			const astNodes = lastGraphData.nodes.filter((n) => n.parentId === nodeId);
			const astNodeIds = new Set(astNodes.map((n) => n.id));
			const astEdges = lastGraphData.edges.filter((e) => astNodeIds.has(e.source) && astNodeIds.has(e.target));
			sendJson(res, 200, {
				astNodes,
				astEdges,
				sourceLines: []
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
		handler: withRouteMiddleware("GET", routePath, corsConfig, rateLimiter, (req, res) => {
			const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
			const fromId = url.searchParams.get("from") ?? "";
			const scope = url.searchParams.get("scope") ?? "file";
			const cursor = parseInt(url.searchParams.get("cursor") ?? "0", 10);
			const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "500", 10), 500);
			if (!fromId || fromId.length > VALIDATION.MAX_PATH_LENGTH) {
				sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
				return;
			}
			const lastGraphData = deps.getLastGraphData();
			if (!lastGraphData) {
				sendJson(res, 200, {
					edges: [],
					total: 0,
					cursor: 0,
					hasMore: false
				}, req, corsConfig);
				return;
			}
			let filteredEdges;
			if (scope === "symbol") filteredEdges = lastGraphData.edges.filter((e) => e.source === fromId || e.target === fromId);
			else {
				const nodeIds = new Set();
				for (const n of lastGraphData.nodes) if (n.filePath === fromId || n.id === fromId) nodeIds.add(n.id);
				filteredEdges = lastGraphData.edges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target));
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
		})
	}), "codegraph: edges route");
}
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
	ctx.effect(() => () => rateLimiter.reset(), "codegraph: rate limiter cleanup");
	ctx.effect(() => () => sharedTreeSitterAdapter.destroy(), "codegraph: tree-sitter adapter cleanup");
}

//#endregion
//#region src/host/watcher.ts
const log$2 = scoped("host");
const supportsRecursive = platform() === "win32" || platform() === "darwin";
async function scanAndPush(ctx, invokeUpstream, path$1) {
	log$2.info("scan requested", { path: path$1 });
	try {
		const repoId = path$1 || "workspace-default";
		const data = await fetchMergedGraph(invokeUpstream, repoId, "both");
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
		log$2.info("scan completed", {
			repoId,
			nodes: data.metadata.nodeCount,
			edges: data.metadata.edgeCount
		});
	} catch (e) {
		log$2.error("scan failed", e);
	}
}
function registerWatcher(ctx, config, invokeUpstream) {
	let watchTimer = null;
	let activeWatcher = null;
	let retryCount = 0;
	const MAX_RETRIES = WATCHER.MAX_RETRIES;
	const RETRY_BASE_DELAY = WATCHER.RETRY_BASE_DELAY_MS;
	const closeActiveWatcher = () => {
		if (activeWatcher) {
			try {
				activeWatcher.close();
			} catch (e) {
				log$2.warn("Failed to close watcher", e);
			}
			activeWatcher = null;
		}
		if (watchTimer) {
			clearTimeout(watchTimer);
			watchTimer = null;
		}
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
				if (watchTimer) clearTimeout(watchTimer);
				watchTimer = setTimeout(() => {
					watchTimer = null;
					if (!activeWatcher) return;
					log$2.info("file changed, syncing + re-scanning", { filename });
					invokeUpstream("codegraph_sync", { path: watchPath }).then(() => scanAndPush(ctx, invokeUpstream, watchPath)).catch((e) => log$2.error("watch re-scan failed", e));
				}, config.watchDebounce);
			});
			retryCount = 0;
		} catch (e) {
			log$2.error("watch setup failed", e);
			if (retryCount < MAX_RETRIES) {
				retryCount++;
				const delay = RETRY_BASE_DELAY * Math.pow(2, retryCount - 1);
				log$2.info("retrying watch setup", {
					retryCount,
					delay,
					path: watchPath
				});
				setTimeout(() => setupWatch(watchPath), delay);
			} else {
				log$2.error("watch setup exhausted retries", { path: watchPath });
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
				log$2.info("watch disabled");
				return;
			}
			log$2.info("watch enabled", { path: event.path });
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
		log$2.info("init requested", { path: event.path });
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
			log$2.warn("graph init failed", e);
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
const log$1 = scoped("mcp-server");
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
			log$1.info("MCP server stopped");
		});
		this.rl.on("error", (err) => {
			log$1.error("MCP server stdin error", err);
			this.running = false;
			try {
				this.rl?.close();
			} catch {}
			this.rl = null;
		});
		log$1.info("MCP server started", { tools: this.tools.size });
	}
	async processQueue() {
		if (this.processing) return;
		this.processing = true;
		while (this.messageQueue.length > 0) {
			const line = this.messageQueue.shift();
			try {
				if (line.length > MAX_MESSAGE_LENGTH) {
					log$1.warn("MCP message too large, skipping", { length: line.length });
					continue;
				}
				const msg = JSON.parse(line);
				const response = await this.handleMessage(msg);
				if (response) process.stdout.write(JSON.stringify(response) + "\n");
			} catch (e) {
				log$1.warn("MCP message handling failed", e);
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
					log$1.warn("Failed to send MCP error response", e$1);
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
	const { graphStatus, graphData, graphSymbol, graphImpact, graphPathFind, graphHealth, graphRulesCheck, graphFocus } = await createGraphTools(ctx, { requestTimeout: config.requestTimeout });
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
	const invokeUpstream = createInvokeUpstream(ctx, config);
	const routeDeps = {
		ctx,
		config,
		securityManager,
		invokeUpstream,
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
		}
	};
	registerService(routeDeps);
	registerRoutes(routeDeps);
	let lastStatus = "";
	const emitPrereqStatus = () => {
		const status = checkPrerequisites(ctx);
		const statusKey = `${status.codegraph}:${status.lens}`;
		ctx.emit("codegraph-visualizer/prerequisite/status", {
			codegraph: status.codegraph,
			lens: status.lens,
			timestamp: Date.now()
		});
		if (statusKey !== lastStatus) {
			log.info("prerequisite status", status);
			lastStatus = statusKey;
		}
	};
	emitPrereqStatus();
	ctx.effect(() => {
		const prereqTimer = setInterval(() => {
			const status = checkPrerequisites(ctx);
			const statusKey = `${status.codegraph}:${status.lens}`;
			ctx.emit("codegraph-visualizer/prerequisite/status", {
				codegraph: status.codegraph,
				lens: status.lens,
				timestamp: Date.now()
			});
			if (statusKey !== lastStatus) {
				log.info("prerequisite status", status);
				lastStatus = statusKey;
			}
			if (status.codegraph && status.lens) clearInterval(prereqTimer);
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
		};
	}, "codegraph: state cleanup");
}

//#endregion
export { DEFAULT_CONFIG, PLUGIN_VERSION, SecurityManager, apply, createSecurityManager, inject, name, resolveConfig };
//# sourceMappingURL=index.js.map