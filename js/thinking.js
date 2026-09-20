// Transparent, scenario-specific guided checks. This is not semantic AI grading.
export const RUBRIC_VERSION = 2;
const fields = ['goal', 'sources', 'steps', 'check'];
const action = /\b(?:i|we)\s+(?:will|would|need|want|use|start|keep|return|find|expect|check|plan|should|can)\b|^(?:start|use|keep|return|find|show|list|count|sum|calculate|compare|match|link|join|group|sort|rank|classify|check|verify|include|exclude|retain|filter|take)\b|\b(?:has|have|is|are|contains?|holds?|provides?)\b/i;
export function normalize(text) {
  return String(text || '').normalize('NFKC').toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1').replaceAll('_', ' ').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}
export function fingerprint(input) {
  return JSON.stringify(fields.map(k => normalize(input[k])));
}
function sentences(text) {
  return normalize(text).split(/[.!?;]\s+|\n/).filter(Boolean);
}
function explainable(text) {
  return (text.match(/\b[\w'-]+\b/g) || []).length >= 6 && action.test(text);
}
function matches(criterion, text, acrossSentences=false) {
  const whole = normalize(text);
  if (criterion.forbidden?.some(p => new RegExp(p, 'i').test(whole))) return false;
  const explanations=sentences(text).filter(explainable);
  if(acrossSentences) return criterion.groups.every(pattern=>explanations.some(sentence=>new RegExp(pattern,'i').test(sentence)));
  return explanations.some(sentence => criterion.groups.every(pattern => new RegExp(pattern, 'i').test(sentence)));
}
export function evaluateThinking(scenario, input) {
  const rawSql = fields.some(k => /(?:^|\n|```(?:sql)?\s*)\s*(?:select\b[^;]*\bfrom\b|with\s+\w+\s+as\s*\()/im.test(input[k] || ''));
  const items = [
    { field: 'goal', weight: 2, rule: scenario.rubric.goal },
    { field: 'sources', weight: 2, rule: scenario.rubric.sources },
    ...scenario.rubric.steps.map(rule => ({field:'steps', weight:4 / scenario.rubric.steps.length, rule})),
    { field: 'check', weight: 2, rule: scenario.rubric.check }
  ].map(item => ({ field:item.field, weight:item.weight, label:item.rule.label,
    passed: !rawSql && matches(item.rule, input[item.field], item.field==='sources') }));
  const score = Math.round(items.reduce((sum,c)=>sum+(c.passed?c.weight:0),0)*10)/10;
  // Every scenario-specific reasoning step is required; verbosity earns no marks.
  const ready = !rawSql && score >= 8 && items.filter(c=>c.field !== 'check').every(c=>c.passed);
  return { version:RUBRIC_VERSION, score, ready, fingerprint:fingerprint(input), items,
    message:rawSql ? 'Explain your plan in your own words before writing SQL.' :
      ready ? 'Your plan covers the required points. Now write SQL from your reasoning.' :
      'Revise the missing points below, then check your thinking again.' };
}
export function thinkingIsReady(scenario, entry) {
  return !!entry?.thinking && evaluateThinking(scenario, entry.thinking).ready
    && entry.assessment?.fingerprint === fingerprint(entry.thinking)
    && entry.assessment?.version === RUBRIC_VERSION;
}
