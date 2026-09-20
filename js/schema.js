import {escapeHtml} from './util.js';
function pluralize(base) {
  if (/[^aeiou]y$/i.test(base)) return base.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(base)) return base + 'es';
  return base + 's';
}

function parseSchema(schemaText) {
  if (!schemaText) return [];
  const tableChunks = schemaText.split(';').map(s => s.trim()).filter(Boolean);
  const tables = [];
  tableChunks.forEach(chunk => {
    const m = chunk.match(/^(\w+)\((.*)\)$/);
    if (!m) return;
    const name = m[1];
    const cols = m[2].split(',').map(c => c.trim()).filter(Boolean).map(colDef => {
      const parts = colDef.split(/\s+/);
      let key = null;
      if (parts[parts.length - 1] === 'PK') { key = 'PK'; parts.pop(); }
      else if (parts[parts.length - 1] === 'FK') { key = 'FK'; parts.pop(); }
      return { name: parts.join(' '), key };
    });
    tables.push({ name, columns: cols });
  });
  return tables;
}

function inferReference(colName, tableNames, currentTable) {
  if (!colName.endsWith('_id')) return null;
  const base = colName.slice(0, -3);
  const guess = pluralize(base);
  const candidates = [guess, base, base + 's'];
  for (const c of candidates) {
    if (tableNames.includes(c) && c !== currentTable) return c;
  }
  return null;
}

const TABLE_ICONS = { customers: '👤', accounts: '🏦', transactions: '💳', patients: '🧑‍⚕️', doctors: '🩺', appointments: '📅', visits: '📋', policies: '📄', claims: '🧾', products: '📦', orders: '🧺', order_items: '🧾' };

export function renderSchemaCards(schemaText) {
  const container = document.getElementById('schema');
  const tables = parseSchema(schemaText);

  if (!tables.length) {
    container.innerHTML = '<div class="schema-text">' + escapeHtml(schemaText) + '</div>';
    return;
  }

  const tableNames = tables.map(t => t.name);
  container.innerHTML = tables.map(t => {
    const rows = t.columns.map(c => {
      let badges = '';
      let ref = '';
      if (c.key === 'PK') badges += '<span class="badge-pk">PK</span>';
      if (c.key === 'FK') {
        badges += '<span class="badge-fk">FK</span>';
        const target = inferReference(c.name, tableNames, t.name);
        if (target) ref = '<span class="fk-ref">→ ' + escapeHtml(target) + '</span>';
      }
      return '<div class="schema-row"><span class="schema-col-name">' + escapeHtml(c.name) + '</span>' +
        '<span class="schema-badges">' + ref + badges + '</span></div>';
    }).join('');
    const icon = TABLE_ICONS[t.name] || '🗂️';
    return '<div class="schema-card">' +
      '<div class="schema-card-head"><span class="tbl-icon">' + icon + '</span>' + escapeHtml(t.name) + '</div>' +
      '<div class="schema-card-body">' + rows + '</div>' +
      '</div>';
  }).join('');
}
