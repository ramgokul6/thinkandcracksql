const WRITE_OR_ADMIN = /\b(?:insert|update|delete|merge|upsert|create|alter|drop|truncate|grant|revoke|copy|call|do|vacuum|analyze|refresh|reindex|cluster|comment|security|set|reset|listen|notify|prepare|execute|deallocate|lock)\b/i;

function codeOnly(sql) {
  let out='', i=0, quote=null, dollar=null;
  while(i<sql.length) {
    const c=sql[i], n=sql[i+1];
    if(quote) {
      if(c===quote && sql[i+1]===quote) {out+='  ';i+=2;continue;}
      if(c===quote) quote=null;
      out+=' ';i++;continue;
    }
    if(dollar) {
      if(sql.startsWith(dollar,i)) {out+=' '.repeat(dollar.length);i+=dollar.length;dollar=null;continue;}
      out+=' ';i++;continue;
    }
    if(c==='\''||c==='"') {quote=c;out+=' ';i++;continue;}
    if(c==='$') {
      const m=sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if(m) {dollar=m[0];out+=' '.repeat(dollar.length);i+=dollar.length;continue;}
    }
    if(c==='-'&&n==='-') {while(i<sql.length&&sql[i]!=='\n'){out+=' ';i++;}continue;}
    if(c==='/'&&n==='*') {
      out+='  ';i+=2;
      while(i<sql.length&&!(sql[i]==='*'&&sql[i+1]==='/')){out+=sql[i]==='\n'?'\n':' ';i++;}
      if(i<sql.length){out+='  ';i+=2;}continue;
    }
    out+=c;i++;
  }
  return out;
}

export function validateReadOnlySql(sql) {
  const text=String(sql||'').trim();
  if(!text) return {ok:false,message:'Write a SQL query first.'};
  if(text.length>20000) return {ok:false,message:'The SQL query is too long.'};
  const visible=codeOnly(text).trim();
  if(!/^(?:select|with)\b/i.test(visible)) return {ok:false,message:'Only one SELECT query (optionally using WITH) can be evaluated.'};
  const withoutTrailing=visible.replace(/;\s*$/,'');
  if(withoutTrailing.includes(';')) return {ok:false,message:'Run one query at a time.'};
  if(WRITE_OR_ADMIN.test(withoutTrailing)) return {ok:false,message:'Only read-only SELECT queries are allowed.'};
  return {ok:true,sql:text};
}

function normalizeValue(value) {
  if(value===null||value===undefined) return null;
  if(value instanceof Date) return value.toISOString();
  if(typeof value==='bigint') return value.toString();
  if(typeof value==='number') return Number.isFinite(value) ? Number(value.toPrecision(14)).toString() : String(value);
  if(typeof value==='object') return JSON.stringify(value,Object.keys(value).sort());
  return String(value);
}

export function normalizeResult(result) {
  const fields=(result.fields||[]).map(field=>field.name);
  const rows=(result.rows||[]).map(row=>fields.length?fields.map(name=>normalizeValue(row[name])):Object.values(row).map(normalizeValue));
  return {columns:fields.length,rows};
}

const rowKey=row=>JSON.stringify(row);
export function compareResults(actualResult, expectedResult, ordered=false) {
  const actual=normalizeResult(actualResult),expected=normalizeResult(expectedResult);
  if(actual.columns!==expected.columns) return {passed:false,reason:`Expected ${expected.columns} columns but received ${actual.columns}.`,actual,expected};
  if(actual.rows.length!==expected.rows.length) return {passed:false,reason:`Expected ${expected.rows.length} rows but received ${actual.rows.length}.`,actual,expected};
  const a=actual.rows.map(rowKey),e=expected.rows.map(rowKey);
  if(!ordered){a.sort();e.sort();}
  const passed=a.every((value,index)=>value===e[index]);
  return {passed,reason:passed?'Your result matches the expected output.':ordered?'The values or required row order do not match yet.':'The returned values do not match yet.',actual,expected};
}

export class SqlEvaluator {
  constructor(PGliteClass) {
    this.PGliteClass=PGliteClass;
    this.db=null;
    this.domain=null;
    this.expected=new Map();
  }
  async close() {
    if(this.db) await this.db.close();
    this.db=null;this.domain=null;this.expected.clear();
  }
  async prepare(domain,asset) {
    if(this.db&&this.domain===domain) return;
    await this.close();
    this.db=new this.PGliteClass();
    await this.db.exec(`${asset.schema}\n${asset.sample}`);
    this.domain=domain;
  }
  async query(sql) {
    const validation=validateReadOnlySql(sql);
    if(!validation.ok) throw new Error(validation.message);
    await this.db.exec("BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout = '4000ms';");
    try {return await this.db.query(validation.sql);}
    finally {try{await this.db.exec('ROLLBACK');}catch{/* a failed query may already abort the transaction */}}
  }
  async evaluate(scenario,asset,learnerSql) {
    const validation=validateReadOnlySql(learnerSql);
    if(!validation.ok) return {passed:false,kind:'guard',message:validation.message};
    try {
      await this.prepare(scenario.domain,asset);
      let expected=this.expected.get(scenario.id);
      if(!expected){expected=await this.query(scenario.sql);this.expected.set(scenario.id,expected);}
      const actual=await this.query(validation.sql);
      const comparison=compareResults(actual,expected,scenario.evaluation?.ordered===true);
      return {passed:comparison.passed,kind:'result',message:comparison.reason,
        actualRows:comparison.actual.rows.length,expectedRows:comparison.expected.rows.length,
        preview:comparison.actual.rows.slice(0,5)};
    } catch(error) {
      return {passed:false,kind:'sql',message:String(error?.message||error).split('\n')[0].slice(0,400)};
    }
  }
}

let browserClassPromise;
export async function loadBrowserPGlite() {
  browserClassPromise ||= import('../vendor/pglite/index.js').then(module=>module.PGlite);
  return browserClassPromise;
}
