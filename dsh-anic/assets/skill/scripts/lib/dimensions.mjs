// dimensions.mjs — E1-E8 / Q1-Q8 维度词表唯一来源（进化 iteration-1，修 S-2 / S-11）
// 背景（docs/anic/09 §2 S-2）：eval-runner.mjs 内嵌一份词表，references/evaluation.md 与
// assets/config/config.example.yml 又各自漂移出第二套 E 维名称（功能覆盖/架构健康/技术债务…），
// 与本注册表（意图对齐/规格符合/…）零重叠。词表只允许存在这一份；文档必须引用它，不得复述。
export const DIMENSIONS = {
  E1: { name: '意图对齐', desc: '实现是否忠实反映用户意图', category: 'eval' },
  E2: { name: '规格符合', desc: '代码是否满足规格文档的要求', category: 'eval' },
  E3: { name: '测试覆盖', desc: '测试是否覆盖关键路径和边界条件', category: 'eval' },
  E4: { name: '代码质量', desc: '代码是否遵循项目的编码规范', category: 'eval' },
  E5: { name: '性能基线', desc: '性能是否满足非功能性需求', category: 'eval' },
  E6: { name: '安全检查', desc: '是否引入安全漏洞或暴露敏感信息', category: 'eval' },
  E7: { name: '文档同步', desc: '文档是否与代码保持同步', category: 'eval' },
  E8: { name: '回归完整性', desc: '是否破坏已有功能', category: 'eval' },
  Q1: { name: '功能与业务', desc: '功能是否完整实现业务需求', category: 'quality' },
  Q2: { name: '测试体系', desc: '分层测试是否完整、覆盖率是否达标', category: 'quality' },
  Q3: { name: '性能与运维', desc: '性能是否达标、运维是否可观测可恢复', category: 'quality' },
  Q4: { name: '安全与合规', desc: '是否满足安全与合规要求', category: 'quality' },
  Q5: { name: '架构约束', desc: '架构是否满足设计约束', category: 'quality' },
  Q6: { name: '前端与体验', desc: '前端体验是否达标、UX/UI标准是否遵循', category: 'quality' },
  Q7: { name: '代码与工程', desc: '代码是否遵循工程规范', category: 'quality' },
  Q8: { name: '评审与验收', desc: '评审流程是否完整、验收标准是否满足', category: 'quality' },
};

export const DIMENSION_IDS = Object.keys(DIMENSIONS);

// 修 S-11（docs/anic/09 §2）：原 eval-runner.mjs:369 用 .filter(s => DIMENSIONS[s])
// 把未知维度静默剔除——`--dimensions E9` 会静默变成空集并退出 0。契约：未知标识符必须响亮失败。
export function resolveDimensions({ dimensions = 'all', quality = false } = {}) {
  if (dimensions === 'all' && !quality) return DIMENSION_IDS.slice();
  if (dimensions === 'all' && quality) {
    return DIMENSION_IDS.filter(d => DIMENSIONS[d].category === 'quality');
  }
  const requested = dimensions.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = requested.filter(id => !DIMENSIONS[id]);
  if (unknown.length > 0) {
    const err = new Error(
      `Unknown dimension(s): ${unknown.join(', ')}. Valid dimensions: ${DIMENSION_IDS.join(', ')}`
    );
    err.code = 'UNKNOWN_DIMENSION';
    throw err;
  }
  if (quality) {
    // 显式列表 + --quality：在显式列表内做质量过滤（保留调用者给定的范围，不再偷换成全量质量维）
    return requested.filter(id => DIMENSIONS[id].category === 'quality');
  }
  return requested;
}
