/** Supplementary statistics, deliberately separate from frozen runtime metrics.
 * CP is an iid-binomial interval, NOT a substitute for clustered uncertainty.
 */
export function clopperPearson(events, trials, confidence = 0.95) {
  if (!Number.isSafeInteger(events) || !Number.isSafeInteger(trials) || events < 0 || trials < events || !(confidence > 0 && confidence < 1)) throw new Error("Invalid binomial counts or confidence");
  if (trials === 0) return { available: false, events, trials, lower: null, upper: null, reason: "No eligible observations" };
  const tail = (1 - confidence) / 2;
  // Log-space binomial CDF avoids overflow from binomial coefficients.
  const logFactorial = [0];
  for (let i = 1; i <= trials; i++) logFactorial[i] = logFactorial[i-1] + Math.log(i);
  const cdf = (k, p) => {
    if (p <= 0) return 1;
    if (p >= 1) return k >= trials ? 1 : 0;
    let max = -Infinity;
    const terms = [];
    for (let i = 0; i <= k; i++) {
      const t = logFactorial[trials] - logFactorial[i] - logFactorial[trials-i] + i*Math.log(p) + (trials-i)*Math.log1p(-p);
      terms.push(t); max = Math.max(max,t);
    }
    return Math.min(1, Math.exp(max)*terms.reduce((sum,t)=>sum+Math.exp(t-max),0));
  };
  const inverse = (k, probability) => {
    let low = 0, high = 1;
    for (let i = 0; i < 70; i++) {
      const mid = (low+high)/2;
      if (cdf(k,mid)>probability) low=mid; else high=mid;
    }
    return (low+high)/2;
  };
  return { available: true, events, trials, confidence,
    lower: events===0 ? 0 : events===trials ? Math.exp(Math.log(tail)/trials) : inverse(events-1,1-tail),
    upper: events===trials ? 1 : events===0 ? -Math.expm1(Math.log(tail)/trials) : inverse(events,tail),
    method: "two-sided equal-tailed Clopper-Pearson; iid-binomial assumption" };
}

/** Never pool versions, datasets, alignment methods, models or stochastic seeds. */
export function partitionExperiments(records) {
  const fields = ["policyVersion","extractionVersion","datasetSha256","alignment","extractor","baseline","model","modelSeed"];
  const groups = new Map();
  for (const row of records) {
    for (const key of fields) if (!(key in row)) throw new Error(`Missing experiment identity: ${key}`);
    const key = JSON.stringify(fields.map(f=>row[f]));
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}

/** Resample the independent unit; repeated seeds must be partitioned first. */
export function ratioBootstrap(rows, numerator, denominator, cluster = "sessionId", repetitions = 2000, seed = 7) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 100 || !Number.isSafeInteger(seed)) throw new Error("Invalid bootstrap settings");
  const groups = new Map();
  for (const row of rows) {
    if (!row[cluster]) throw new Error(`Missing ${cluster}`);
    if (!(row[numerator]>=0) || !(row[denominator]>=row[numerator])) throw new Error("Invalid ratio counts");
    const sum = groups.get(row[cluster]) ?? [0,0];
    sum[0]+=row[numerator]; sum[1]+=row[denominator]; groups.set(row[cluster],sum);
  }
  const units = [...groups.values()];
  if (units.length<2) return {available:false,clusters:units.length,lower:null,upper:null,validReplicates:0};
  let state = seed>>>0 || 1;
  const random = () => {state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const values=[];
  for(let i=0;i<repetitions;i++) {
    let n=0,d=0;
    for(let j=0;j<units.length;j++){const u=units[Math.floor(random()*units.length)];n+=u[0];d+=u[1];}
    if(d) values.push(n/d);
  }
  values.sort((a,b)=>a-b);
  return {available:values.length>0,clusters:units.length,lower:values.length?values[Math.floor((values.length-1)*.025)]:null,upper:values.length?values[Math.ceil((values.length-1)*.975)]:null,validReplicates:values.length,repetitions,seed,cluster};
}
