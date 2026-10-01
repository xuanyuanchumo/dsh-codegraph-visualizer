export const RENDERER = {
  MIN_ZOOM: 0.02,
  MAX_ZOOM: 3,
  FIT_PADDING: 80,
  FIT_DELAY_SMALL: 200,
  FIT_DELAY_LARGE: 500,
  LARGE_GRAPH_NODE_THRESHOLD: 500,
  LAYOUT_TIMEOUT_MS: 10000,
  WORKER_NODE_THRESHOLD: 500,
  INCREMENTAL_LAYOUT_THRESHOLD: 50,
  INCREMENTAL_LAYOUT_DELAY_MS: 50,
  FULL_LAYOUT_DELAY_MS: 150,
  FOCUS_NODE_ANIMATION_MS: 300,
  NEIGHBORHOOD_ANIMATION_MS: 400,
  DEFAULT_CONTAINER_WIDTH: 800,
  DEFAULT_CONTAINER_HEIGHT: 600,
} as const;

export const CLUSTER = {
  MAX_VISIBLE_NODES: 1500,
  SUBGROUP_THRESHOLD: 100,
  MAX_NODES_PER_DIR_BEFORE_SUBGROUP: 500,
  LARGE_NODE_THRESHOLD: 2000,
  MIN_NODES_FOR_SUBGROUP: 50,
  MAX_ITERATIONS_LARGE: 3,
  MAX_ITERATIONS_SMALL: 10,
  MAX_NODES_FOR_LABEL_PROP: 5000,
  EXPAND_BUDGET_SINGLE: 300,
} as const;

export const DYNAMIC_CLUSTER = {
  SMALL_SCREEN_WIDTH: 1200,
  LARGE_SCREEN_WIDTH: 1920,
  MAX_VISIBLE_NODES_SMALL: 800,
  MAX_VISIBLE_NODES_MEDIUM: 1200,
  MAX_VISIBLE_NODES_LARGE: 1500,
  AUTO_DEPTH_THRESHOLD_1: 3000,
  AUTO_DEPTH_THRESHOLD_2: 10000,
} as const;

export function getDynamicMaxVisibleNodes(viewportWidth: number): number {
  if (viewportWidth < DYNAMIC_CLUSTER.SMALL_SCREEN_WIDTH) {
    return DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_SMALL;
  }
  if (viewportWidth >= DYNAMIC_CLUSTER.LARGE_SCREEN_WIDTH) {
    return DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_LARGE;
  }
  return DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_MEDIUM;
}

export function getAutoClusterDepth(nodeCount: number, maxVisibleNodes: number): number {
  if (nodeCount > maxVisibleNodes * 5) return 2;
  if (nodeCount > maxVisibleNodes * 1.5) return 1;
  return 0;
}

export const PATH_FINDER = {

  MAX_NODES_FOR_BFS: 50000,
} as const;

export const HIGHLIGHT = {
  CALL_CHAIN_MAX_DEPTH: 50,
  IMPACT_MAX_DEPTH: 3,
} as const;

export const HISTORY = {
  DEFAULT_MAX_HISTORY: 50,
} as const;

export const POLLING = {
  PREREQ_INITIAL_DELAY_MS: 3000,
  PREREQ_INTERVAL_MS: 30000,
  WORKSPACE_INTERVAL_MS: 15000,
  LOADING_FAILSAFE_MS: 15000,
  WORKSPACE_SCAN_DEBOUNCE_MS: 300,
  PREREQ_CHECK_TIMEOUT_MS: 3000,
  WORKSPACE_TICK_MS: 30000,
} as const;

export const API = {
  DEFAULT_TIMEOUT_MS: 30000,
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_DEFAULT: 60,
  RATE_LIMIT_HEAVY: 10,
  RATE_LIMIT_MAP_MAX: 10000,
  SCAN_TIMEOUT_MS: 60000,
  DATA_RESPONSE_MAX_BYTES: 5 * 1024 * 1024,
  DATA_RESPONSE_SLIM_NODES: 500,
  INVOKE_DEFAULT_TIMEOUT_MS: 5000,
} as const;

export const HEALTH_SCORE = {
  WEIGHT_COUPLING: 0.25,
  WEIGHT_COHESION: 0.25,
  WEIGHT_CYCLIC: 0.30,
  WEIGHT_MODULARITY: 0.20,
  DEFAULT_MAX_MODULE_DEPTH: 3,
} as const;

export const LAYOUT = {
  DENSITY_FACTOR_SMALL: 1.5,
  DENSITY_FACTOR_MEDIUM: 1.0,
  DENSITY_FACTOR_LARGE: 0.7,
  SMALL_NODE_THRESHOLD: 50,
  MEDIUM_NODE_THRESHOLD: 200,
  LARGE_NODE_THRESHOLD: 500,
  VERY_LARGE_NODE_THRESHOLD: 2000,
  LAYOUT_SAMPLE_SIZE: 200,
  COSE_NUM_ITER: 2500,
  COSE_LARGE_NUM_ITER: 15000,
  MAX_RANK_SEP: 80,
  MIN_RANK_SEP: 30,
  MIN_NODE_SPACING: 20,
  SMALL_SPACING_FACTOR: 1.2,
  MEDIUM_SPACING_FACTOR: 1.0,
  LARGE_SPACING_FACTOR: 0.8,
  SMALL_NODE_COUNT_THRESHOLD: 100,
  MEDIUM_NODE_COUNT_THRESHOLD: 300,
  INCREMENTAL_RADIUS_BASE: 100,
  GRID_FALLBACK_NODE_THRESHOLD: 5000,
  OVERLAP_MAX_ITERATIONS: 15,
  OVERLAP_SKIP_THRESHOLD: 5000,
  OVERLAP_CELL_SIZE_MULTIPLIER: 4,
  GOLDEN_ANGLE: Math.PI * (3 - Math.sqrt(5)),
  OVERLAP_PUSH_COEFFICIENT: 0.15,
  OVERLAP_MIN_PUSH: 2,
  FCOSE_LARGE_NODE_THRESHOLD: 5000,
  FCOSE_LARGE_NUM_ITER: 1000,
  FCOSE_LARGE_QUALITY: 'draft' as const,
  NODE_REPULSE_MAX: 20000,
} as const;

export const VIEWPORT = {
  THUMBNAIL_TARGET_WIDTH: 200,
  THUMBNAIL_MIN_SCALE: 0.05,
  THUMBNAIL_MAX_SCALE: 0.3,
} as const;

export const VIRTUAL_VIEWPORT = {
  SCROLL_THRESHOLD: 2500,
  PADDING: 100,
} as const;

export const QUADTREE = {
  MAX_NODES_PER_QUAD: 10,
  MAX_DEPTH: 8,
  INITIAL_BOUNDS: { x1: -100000, y1: -100000, x2: 100000, y2: 100000 },
  EXPAND_PADDING: 5000,
} as const;

export const EXPORT = {
  SVG_PADDING: 160,
  MERMAID_MAX_NODES: 500,
  MERMAID_MAX_EDGES: 800,
  MERMAID_MAX_SEQUENCE_MESSAGES: 100,
} as const;

export const FILTER = {
  MAX_PATTERN_LENGTH: 200,
  MAX_NESTED_QUANTIFIER_DEPTH: 2,
} as const;

export const DATA_CONTROLLER = {
  BATCH_SIZE: 200,
  SVG_OFFSET: 80,
  MAX_WEIGHT: 10,
  HUB_DEGREE_THRESHOLD: 5,
} as const;

export const LOD = {
  MINIMAL_THRESHOLD_SMALL: 0.15,
  MINIMAL_THRESHOLD_MEDIUM: 0.25,
  MINIMAL_THRESHOLD_LARGE: 0.35,
  COMPACT_THRESHOLD_SMALL: 0.4,
  COMPACT_THRESHOLD_MEDIUM: 0.55,
  COMPACT_THRESHOLD_LARGE: 0.7,
  SMALL_NODE_COUNT: 100,
  MEDIUM_NODE_COUNT: 500,
  MINIMAL_NODE_SIZE: 8,
  COMPACT_NODE_SIZE: 16,
  MINIMAL_EDGE_WIDTH: 0.5,
  COMPACT_EDGE_WIDTH: 1,
  COMPACT_FONT_SIZE: 6,
  TRANSITION_DURATION_MS: 200,
  MINIMAL_CLUSTER_DEPTH: 0,
  COMPACT_CLUSTER_DEPTH: 1,
} as const;

export const HEATMAP = {
  LINES_LOW: 50,
  LINES_HIGH: 500,
  COMPLEXITY_LOW: 5,
  COMPLEXITY_HIGH: 20,
  COLOR_STABLE: '#10b981',
  COLOR_UNSTABLE: '#ef4444',
  COLOR_LOW: '#3b82f6',
  COLOR_HIGH: '#ef4444',
} as const;

export const TODO_MARKER = {
  COLOR_TODO: '#f59e0b',
  COLOR_FIXME: '#ef4444',
  COLOR_BOTH: '#dc2626',
  BORDER_WIDTH: 3,
  BORDER_STYLE: 'double',
} as const;


export const CYCLE_DETECTION = {
  MAX_NODES_FOR_DETECTION: 10000,
} as const;

export const INCREMENTAL_CLUSTER = {
  MAX_CHANGE_RATIO: 0.3,
  MIN_PREV_NODES: 100,
} as const;

export const VIEW_MODE = {
  DEPTH_FILTER_LEVEL_1: 3,
} as const;
export const CORE_FUNCTION = {
  MIN_INDEGREE_HUB: 5,
  MIN_OUTDEGREE_HUB: 5,
  MIN_INFLUENCE_REACH: 10,
  MIN_CALL_CHAIN_DEPTH: 3,
  MAX_BFS_NODES: 500,
} as const;
export const MCP = {
  MAX_MESSAGE_LENGTH: 10 * 1024 * 1024,
  MAX_IMPACT_RESULTS: 500,
} as const;

export const CACHE = {
  GRAPH_CACHE_LIMIT: 8,
} as const;

export const PREFETCH = {
  CONCURRENCY_LIMIT: 2,
  COST_THRESHOLD: 50,
  HOVER_DEBOUNCE_MS: 300,
} as const;

export const BOOTSTRAP = {
  TOP_LEVEL_NODE_LIMIT: 50,
  CHILDREN_PAGE_SIZE: 50,
} as const;

export const FUNCTION_BODY = {
  MAX_EXPANDED: 2,
} as const;

export const SYMBOL_AST = {
  MAX_NODES: 800,
  MAX_SOURCE_LINES: 1500,
} as const;

export const SQLITE = {
  MAX_IN_PARAMS: 900,
} as const;

export const EDGES_AGGREGATION = {
  THRESHOLD: 20,
  PAGE_SIZE: 500,
} as const;

export const VALIDATION = {
  MAX_PATH_LENGTH: 4096,
  MAX_GIT_REF_LENGTH: 256,
  MAX_FILEPATH_LENGTH: 512,
} as const;

export const AST = {
  MAX_CONTENT_BYTES: 512 * 1024,
  MAX_TREE_SITTER_CONTENT_BYTES: 512 * 1024,
} as const;

export const WATCHER = {
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 1000,
} as const;
export const UI = {
  SEARCH_DEBOUNCE_MS: 200,
  RESIZE_DEBOUNCE_MS: 200,
  ANCESTOR_MIN_HEIGHT_PX: 300,
  ANCESTOR_SEARCH_MAX_DEPTH: 8,
  MIN_PANEL_HEIGHT_PX: 240,
  MIN_PANEL_WIDTH_PX: 320,
  POLLING_INTERVAL_WATCH_MS: 10000,
  POLLING_INTERVAL_IDLE_MS: 30000,
  MINIMAP_UPDATE_INTERVAL_MS: 500,
  MINIMAP_THROTTLE_MS: 500,
  COPY_HINT_TIMEOUT_MS: 2000,
  INSTALL_HINT_TIMEOUT_MS: 3000,
  COPY_FEEDBACK_MS: 1600,
  IMPORT_CLOSE_DELAY_MS: 700,
  INIT_RETRY_DELAY_MS: 50,
  URL_REVOKE_DELAY_MS: 1000,
  CONTEXT_MENU_Z_INDEX: 10000,
  WORKSPACE_LIST_MAX: 10,
  MAX_FUNCTIONS_PER_CLUSTER: 50,
} as const;
export const COLORS = {
  PACKAGE_LIGHT: '#263148',
  PACKAGE_DARK: '#232324',
  NODE_CLASS_LIGHT: '#1a2230',
} as const;
export const TOOL_MESSAGES: Record<string, { en: string; zh: string }> = {
  NO_PATH_FOUND: { en: 'No path found between the specified symbols.', zh: '未找到指定符号之间的路径。' },
  GRAPH_TOO_LARGE_FOR_PATH: { en: 'Graph too large (>50000 nodes) for path finding. Try filtering first.', zh: '图谱过大（>50000 节点），无法进行路径查找。请先尝试筛选。' },
  PATH_FOUND: { en: 'Path found', zh: '路径已找到' },
  HOPS: { en: 'hops', zh: '跳' },
  INSUFFICIENT_DATA: { en: 'Insufficient data for health scoring.', zh: '数据不足，无法进行健康评分。' },
  NO_VIOLATIONS: { en: 'No rule violations detected.', zh: '未检测到规则违规。' },
  RULE_VIOLATIONS: { en: 'rule violations:', zh: '条规则违规：' },
};
export const ERROR_CODES = {
  PATH_NOT_ALLOWED: 'PATH_NOT_ALLOWED',
  WORKSPACE_PATH_NOT_ALLOWED: 'WORKSPACE_PATH_NOT_ALLOWED',
  SYMLINK_ESCAPE: 'SYMLINK_ESCAPE',
  NO_WORKSPACE_PATH: 'NO_WORKSPACE_PATH',
  PATH_OUTSIDE_WORKSPACE: 'PATH_OUTSIDE_WORKSPACE',
  SCAN_FAILED: 'SCAN_FAILED',
  INIT_FAILED: 'INIT_FAILED',
  WATCH_TOGGLE_FAILED: 'WATCH_TOGGLE_FAILED',
  WATCH_SETUP_FAILED: 'WATCH_SETUP_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  COMMITS_REQUIRED: 'COMMITS_REQUIRED',
  INVALID_GIT_REF: 'INVALID_GIT_REF',
  GRAPH_DIFF_FAILED: 'GRAPH_DIFF_FAILED',
  FILEPATH_REQUIRED: 'FILEPATH_REQUIRED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  AST_PARSE_FAILED: 'AST_PARSE_FAILED',
  FILEPATH_AND_CONTENT_REQUIRED: 'FILEPATH_AND_CONTENT_REQUIRED',
  INVALID_FILEPATH: 'INVALID_FILEPATH',
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SYMBOL_NOT_FOUND: 'SYMBOL_NOT_FOUND',
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  INVALID_JSON_BODY: 'INVALID_JSON_BODY',
  INVALID_CONFIG: 'INVALID_CONFIG',
} as const;

export const ERROR_MESSAGES: Record<string, { en: string; zh: string }> = {
  PATH_NOT_ALLOWED: { en: 'Path not allowed', zh: '路径不允许访问' },
  WORKSPACE_PATH_NOT_ALLOWED: { en: 'Workspace path not allowed', zh: '工作区路径不允许访问' },
  SYMLINK_ESCAPE: { en: 'Access denied: symlink escape', zh: '访问被拒绝：符号链接逃逸' },
  NO_WORKSPACE_PATH: { en: 'No workspace path configured', zh: '未配置工作区路径' },
  PATH_OUTSIDE_WORKSPACE: { en: 'Access denied: path outside workspace', zh: '访问被拒绝：路径超出工作区范围' },
  SCAN_FAILED: { en: 'Scan failed — check codegraph installation', zh: '扫描失败 — 请检查 codegraph 安装' },
  INIT_FAILED: { en: 'Initialization failed — is dsh-codegraph installed?', zh: '初始化失败 — dsh-codegraph 是否已安装？' },
  WATCH_TOGGLE_FAILED: { en: 'Watch toggle failed', zh: '监听切换失败' },
  WATCH_SETUP_FAILED: { en: 'Watch setup failed after retries', zh: '监听设置在重试后失败' },
  INTERNAL_ERROR: { en: 'Internal server error', zh: '服务器内部错误' },
  COMMITS_REQUIRED: { en: 'from and to commits are required', zh: '需要 from 和 to 提交参数' },
  INVALID_GIT_REF: { en: 'Invalid git ref format', zh: '无效的 Git 引用格式' },
  GRAPH_DIFF_FAILED: { en: 'Graph diff failed — check git refs', zh: '图谱差异计算失败 — 请检查 Git 引用' },
  FILEPATH_REQUIRED: { en: 'filePath is required', zh: 'filePath 参数为必填' },
  FILE_TOO_LARGE: { en: 'File too large for AST parsing', zh: '文件过大，无法进行 AST 解析' },
  AST_PARSE_FAILED: { en: 'AST parsing failed', zh: 'AST 解析失败' },
  FILEPATH_AND_CONTENT_REQUIRED: { en: 'filePath and content are required', zh: 'filePath 和 content 参数为必填' },
  INVALID_FILEPATH: { en: 'Invalid filePath', zh: '无效的 filePath' },
  CONTENT_TOO_LARGE: { en: 'Content too large for tree-sitter parsing', zh: '内容过大，无法进行 tree-sitter 解析' },
  METHOD_NOT_ALLOWED: { en: 'Method not allowed', zh: '请求方法不被允许' },
  RATE_LIMIT_EXCEEDED: { en: 'Rate limit exceeded', zh: '请求频率超限' },
  SYMBOL_NOT_FOUND: { en: 'Symbol not found', zh: '未找到符号' },
  BODY_TOO_LARGE: { en: 'Request body too large', zh: '请求体过大' },
  INVALID_JSON_BODY: { en: 'Invalid JSON body: expected object', zh: '无效的 JSON 请求体：应为对象' },
  INVALID_CONFIG: { en: 'Invalid configuration', zh: '无效的配置' },
};
export const REPO_URL = 'https://github.com/xuanyuanchumo/dsh-codegraph-visualizer';
export const IMPORT = {
  MAX_PASTE_BYTES: 10 * 1024 * 1024,
} as const;

export const TOOLTIP = {
  OFFSET: 15,
  WIDTH: 200,
  HEIGHT: 80,
} as const;

export const URL_STATE = {
  MAX_LENGTH: 2000,
} as const;

export const DIFF_ENGINE = {
  MAX_DEEP_EQUAL_DEPTH: 50,
} as const;

export const CORE_FUNCTION_ANALYZER = {
  MAX_CALL_CHAIN_RECURSION_DEPTH: 500,
} as const;

export const CALL_CHAIN = {
  MAX_FUNCTIONS: 20,
} as const;

export const FILE_SYSTEM = {
  MAX_FILES: 500,
} as const;

export const CODEGRAPH_ADAPTER = {
  MAX_IMPORTS_PER_SOURCE: 20,
} as const;

export const TREE_SITTER = {
  BATCH_SIZE: 20,
} as const;

export const INDEXED_DB = {
  DB_VERSION: 2,
  TTL: {
    CLUSTER_MS: 30 * 60 * 1000,
    DIAGRAM_MS: 60 * 60 * 1000,
    OUTLINE_MS: 24 * 60 * 60 * 1000,
    AST_MS: 24 * 60 * 60 * 1000,
    EDGES_MS: 30 * 60 * 1000,
  },
  CAPACITY: {
    HIGH_WATERMARK: 0.85,
    LOW_WATERMARK: 0.70,
  },
  BATCH: {
    MAX_ENTRIES: 500,
  },
} as const;

export const LOGGER = {
  RING_SIZE: 200,
} as const;

export const LOUVAIN = {
  MAX_ITERATIONS: 30,
} as const;
export const PERF = {
  CLUSTER_WARN_MS: 500,
  CLUSTER_DEGRADE_MS: 2000,
  LAYOUT_WARN_MS: 300,
  LAYOUT_DEGRADE_MS: 5000,
  RENDER_WARN_MS: 100,
  RENDER_DEGRADE_MS: 1000,
  DIAGRAM_WARN_MS: 200,
  DIAGRAM_DEGRADE_MS: 1000,
  AST_FETCH_WARN_MS: 1000,
  AST_FETCH_DEGRADE_MS: 5000,
} as const;