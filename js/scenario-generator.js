// Creates additional SQL practice from reviewed templates and known project schemas.
// It does not call an AI service or execute SQL in the browser.
const domains={
  Banking:{prefix:'BAN',master:['customers','customer_id','customer_name'],record:['accounts','account_id','customer_id','balance']},
  Healthcare:{prefix:'HEA',master:['patients','patient_id','patient_name'],record:['appointments','appointment_id','patient_id','bill_amount']},
  Insurance:{prefix:'INS',master:['customers','customer_id','customer_name'],record:['policies','policy_id','customer_id','premium_amount']},
  'Capital Markets':{prefix:'CAP',master:['investors','investor_id','investor_name'],record:['holdings','holding_id','investor_id','market_value']},
  Semiconductor:{prefix:'SEM',master:['clients','client_id','client_name'],record:['production_batches','batch_id','client_id','batch_cost']},
  Education:{prefix:'EDU',master:['students','student_id','student_name'],record:['enrollments','enrollment_id','student_id','course_fee']},
  Retail:{prefix:'RET',master:['customers','customer_id','customer_name'],record:['orders','order_id','customer_id','order_total']}
};
const cities=['Chennai','Madurai','Bengaluru','Coimbatore','Salem','Hyderabad','Mumbai','Pune'];
const segments=['Premium','Standard','Enterprise','Student'];
const thresholds=[5000,6000,7000,8000];
// Statuses present in the sample rows for each city; generated joins always return practice rows.
const statusesByCity=[['Active','Pending'],['Pending','Closed'],['Closed','Active'],['Active'],['Active','Pending'],['Pending','Closed'],['Closed'],['Active']];
const levels={Beginner:'BEG',Intermediate:'INT',Expert:'EXP'};
const regexText=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const word=value=>`\\b${regexText(value).replaceAll('_','[ _]')}\\b`;
const rule=(label,groups,example)=>({label,groups,example,forbidden:[]});

function makeScenario(domain,level,template,params,sourceSchema) {
  const config=domains[domain];
  const [master,masterId,masterName]=config.master;
  const [record,recordId,recordMasterId,amount]=config.record;
  const entity=masterName.replace(/_name$/,'');
  const masterLabel=master.replaceAll('_',' '),recordLabel=record.replaceAll('_',' '),amountLabel=amount.replaceAll('_',' ');
  let idSuffix,question,pseudo,sql,steps,tables,goalGroups,sourceTables;
  if(level==='Beginner') {
    const [column,value]=params;idSuffix=`B_${column}_${value}`;tables=[master];
    question=`Show ${masterLabel} whose ${column} is ${value}.`;
    pseudo=`Use ${masterLabel}, then keep only the rows where ${column} is ${value}. Check that the returned rows meet that condition.`;
    sql=`SELECT * FROM ${master} WHERE ${column} = '${value.replaceAll("'","''")}';`;
    steps=[rule('Filter the requested data to the given value.',[word(column),word(value)],`I will keep ${master} whose ${column} is ${value}.`)];
    goalGroups=[`show|find|return|list|identify`,word(master)];sourceTables=[master];
  } else if(level==='Intermediate') {
    const [city,status]=params;idSuffix=`I_${city}_${status}`;tables=[master,record];
    question=`Show ${recordLabel} with status ${status} for ${masterLabel} from ${city}.`;
    pseudo=`Connect ${masterLabel} to ${recordLabel} by their matching ${recordMasterId}. Keep the requested ${masterLabel} rows whose city is ${city}, then keep ${recordLabel} with status ${status}. Check that both conditions are met.`;
    sql=`SELECT m.${masterName}, r.${recordId}, r.status FROM ${master} m JOIN ${record} r ON r.${recordMasterId} = m.${masterId} WHERE m.city = '${city}' AND r.status = '${status}';`;
    steps=[
      rule(`Connect ${master} and ${record} using their shared key.`,[`connect|join|link|match`,word(recordMasterId)],`I will connect ${master} and ${record} using ${recordMasterId}.`),
      rule('Filter both the location and record status.',[word(city),'city',word(status),'status'],`I will keep ${masterLabel} whose city is ${city} and ${recordLabel} with status ${status}.`)
    ];
    goalGroups=[`show|find|return|list|identify`,word(record)];sourceTables=[master,record];
  } else {
    const [city,threshold]=params;idSuffix=`E_${city}_${threshold}`;tables=[master,record];
    question=`Find the total ${amountLabel} of at least ${threshold} for every ${entity} from ${city}.`;
    pseudo=`Connect ${masterLabel} to ${recordLabel} using ${recordMasterId}. Keep the ${masterLabel} rows whose city is ${city}. Group ${recordLabel} by each ${entity}, add the ${amountLabel}, and keep totals at least ${threshold}. Check each result is one ${entity} with the right total.`;
    sql=`SELECT m.${masterId}, m.${masterName}, SUM(r.${amount}) AS total_${amount} FROM ${master} m JOIN ${record} r ON r.${recordMasterId} = m.${masterId} WHERE m.city = '${city}' GROUP BY m.${masterId}, m.${masterName} HAVING SUM(r.${amount}) >= ${threshold} ORDER BY total_${amount} DESC, m.${masterId};`;
    steps=[
      rule(`Connect ${master} and ${record} using their shared key.`,[`connect|join|link|match`,word(recordMasterId)],`I will connect ${master} and ${record} using ${recordMasterId}.`),
      rule('Filter the requested city.',[word(city),'city'],`I will keep ${masterLabel} rows whose city is ${city}.`),
      rule(`Group ${recordLabel} by each ${entity} and add their ${amountLabel}.`,[`group|each|per`, `sum|total|add`,word(amount)],`I will group ${recordLabel} by each ${entity} and add the ${amountLabel} values.`),
      rule(`Keep only totals at or above ${threshold}.`,[`at least|above|greater|>=|minimum|keep`,String(threshold)],`I will keep totals at least ${threshold}.`)
    ];
    goalGroups=[`find|show|return|list|identify|calculate|report`,`\\b${regexText(entity)}s?\\b`];sourceTables=[master,record];
  }
  const slug=idSuffix.toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  const sourceExample=`I will use ${sourceTables.map(table=>table.replaceAll('_',' ')).join(' and ')} and connect them where needed.`;
  const goalExample=level==='Beginner'?`I will show ${masterLabel} whose ${params[0]} is ${params[1]}.`:
    level==='Intermediate'?`I will show ${recordLabel} with status ${params[1]} for ${masterLabel}.`:`I will find total ${amountLabel} for each ${entity}.`;
  const checkExample='I will check the returned rows and verify they match the requested result.';
  const check=rule('Check the result against the request.',['row|record|column|total|value|result','check|verify|expect|ensure|confirm'],checkExample);
  return {id:`${config.prefix}_GEN_${levels[level]}_${slug}`,domain,level,questionNo:template+1,question,pseudo,sql,schemaText:sourceSchema,tables,
    generated:true,evaluation:{ordered:level==='Expert'},
    rubric:{goal:rule('Explain the requested business result in your own words.',goalGroups,goalExample),
      sources:rule('Name the source tables and how they relate.',sourceTables.map(word),sourceExample),steps,check},
    exampleThinking:[goalExample,sourceExample,...steps.map(item=>item.example),checkExample].join(' ')};
}

export function generateScenarioCatalog(scenarios) {
  const schemaByDomain=Object.fromEntries(scenarios.filter(s=>s.questionNo===1).map(s=>[s.domain,s.schemaText]));
  const generated=[];
  for(const [domain,config] of Object.entries(domains)) {
    if(!schemaByDomain[domain])continue;
    cities.forEach((city,index)=>generated.push(makeScenario(domain,'Beginner',index,["city",city],schemaByDomain[domain])));
    segments.forEach((segment,index)=>generated.push(makeScenario(domain,'Beginner',cities.length+index,['segment',segment],schemaByDomain[domain])));
    cities.forEach((city,index)=>statusesByCity[index].forEach((status,statusIndex)=>generated.push(makeScenario(domain,'Intermediate',index*3+statusIndex,[city,status],schemaByDomain[domain]))));
    cities.forEach((city,index)=>thresholds.forEach((amount,amountIndex)=>generated.push(makeScenario(domain,'Expert',index*thresholds.length+amountIndex,[city,amount],schemaByDomain[domain]))));
  }
  return generated;
}
