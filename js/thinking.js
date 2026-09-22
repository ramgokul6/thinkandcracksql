// Transparent, scenario-specific guided checks. This is not semantic AI grading.
export const RUBRIC_VERSION = 3;
const legacyFields = ['goal', 'sources', 'steps', 'check'];
const action = /\b(?:i|we)\s+(?:will|would|need|want|use|start|keep|return|find|expect|check|plan|should|can)\b|^(?:start|use|keep|return|find|show|list|count|sum|calculate|compare|match|link|join|group|sort|rank|classify|check|verify|include|exclude|retain|filter|take)\b|\b(?:has|have|is|are|contains?|holds?|provides?)\b/i;
export function normalize(text) {
  return String(text || '').normalize('NFKC').toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1').replaceAll('_', ' ').replace(/[’‘]/g, "'")
    // Treat common learner language as equivalent to the authored rubric wording.
    .replace(/\b(?:fetch|retrieve|display)\b/g,'return')
    .replace(/\bget\b/g,'find')
    .replace(/\s+/g, ' ').trim();
}
export function thinkingText(input) {
  if(typeof input==='string')return input;
  if(input?.response)return String(input.response);
  return legacyFields.map(key=>String(input?.[key]||'')).filter(Boolean).join('\n');
}
export function fingerprint(input) {
  return normalize(thinkingText(input));
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
  const response=thinkingText(input);
  const rawSql=/(?:^|\n|```(?:sql)?\s*)\s*(?:select\b[^;]*\bfrom\b|with\s+\w+\s+as\s*\()/im.test(response);
  const items = [
    { category:'result', weight:2, rule:scenario.rubric.goal },
    { category:'data', weight:2, rule:scenario.rubric.sources, acrossSentences:true },
    ...scenario.rubric.steps.map(rule=>({category:'approach',weight:4/scenario.rubric.steps.length,rule})),
    { category:'check', weight:2, rule:scenario.rubric.check }
  ].map(item=>({weight:item.weight,label:item.rule.label,category:item.category,
    passed:!rawSql&&matches(item.rule,response,item.acrossSentences)}));
  const score = Math.round(items.reduce((sum,c)=>sum+(c.passed?c.weight:0),0)*10)/10;
  // Every scenario-specific reasoning step is required; verbosity earns no marks.
  const ready=!rawSql&&score>=8&&items.filter(c=>c.category!=='check').every(c=>c.passed);
  return { version:RUBRIC_VERSION, score, ready, fingerprint:fingerprint(input), items,
    message:rawSql ? 'Explain your plan in your own words before writing SQL.' :
      ready ? 'Your plan covers the key points. You can now generate the reference SQL.' :
      'Add the missing points to your explanation, then select Check My Thinking again.' };
}
export function thinkingIsReady(scenario, entry) {
  return !!entry?.thinking && evaluateThinking(scenario, entry.thinking).ready
    && entry.assessment?.fingerprint === fingerprint(entry.thinking)
    && entry.assessment?.version === RUBRIC_VERSION;
}
