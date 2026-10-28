import type { ExtractedClaim } from "../modules/verification/domain/contracts.js";
const text = (claim: ExtractedClaim) => (claim.sourceQuote ?? claim.claimText).toLowerCase().trim().replace(/\s+/gu," ");
function overlap(a: string, b: string) {
  const left = a.match(/[\p{L}\p{N}_]+/gu) ?? [], right = b.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const counts = new Map<string,number>(); for (const word of right) counts.set(word,(counts.get(word)??0)+1);
  let common=0; for (const word of left) { const n=counts.get(word)??0; if(n){ common++; counts.set(word,n-1); } }
  return left.length + right.length ? 2*common/(left.length+right.length) : 0;
}
/** Maximum-cardinality one-to-one span alignment; type accuracy is scored separately. */
export function alignClaims(predicted: readonly ExtractedClaim[], gold: readonly ExtractedClaim[], relaxed = false) {
  const edges = predicted.map(p => gold.map((g,index) => ({index,weight:text(p)===text(g)?1:relaxed?overlap(text(p),text(g)):0})).filter(e => e.weight >= (relaxed?0.8:1)).sort((a,b)=>b.weight-a.weight || a.index-b.index));
  const owner = new Map<number,number>();
  const visit = (p:number, seen:Set<number>):boolean => {
    for(const edge of edges[p]!) { if(seen.has(edge.index))continue; seen.add(edge.index); const old=owner.get(edge.index); if(old===undefined||visit(old,seen)){owner.set(edge.index,p);return true;} }
    return false;
  };
  predicted.forEach((_,index)=>visit(index,new Set()));
  return [...owner].map(([goldIndex,predictedIndex])=>({goldIndex,predictedIndex})).sort((a,b)=>a.predictedIndex-b.predictedIndex);
}
