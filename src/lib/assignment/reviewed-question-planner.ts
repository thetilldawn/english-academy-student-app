export type ReviewedChoicePlan = {
  vocab_entry_id:number; direction:"english_to_korean"|"korean_to_english"; choice_vocab_entry_ids:number[];
};
function seedRank(text:string){
  let value=2166136261;
  for(const c of text){value^=c.codePointAt(0)!;value=Math.imul(value,16777619)>>>0;}
  return value;
}
/** Reuse approved choices; this planner never invents question content. */
export function selectReviewedQuestionPlans(ids:readonly number[],plans:readonly ReviewedChoicePlan[],ratio:0|50|100,seed:string){
  const byKey=new Map(plans.map(p=>[`${p.vocab_entry_id}:${p.direction}`,p]));
  if(new Set(ids).size!==ids.length || byKey.size!==plans.length || plans.some(p=>new Set(p.choice_vocab_entry_ids).size!==4 || !p.choice_vocab_entry_ids.includes(p.vocab_entry_id))) throw new Error("검토된 문제의 단어 연결이 바뀌었습니다.");
  const directions=ratio===100?["english_to_korean"]:ratio===0?["korean_to_english"]:["english_to_korean","korean_to_english"];
  if(ids.some(id=>directions.some(d=>!byKey.has(`${id}:${d}`)))) throw new Error("이 시험 방향으로 사용할 검토된 문제가 부족합니다.");
  const ranked=[...ids].sort((a,b)=>seedRank(`${seed}:${a}`)-seedRank(`${seed}:${b}`)||a-b);
  const english=new Set(ranked.slice(0,Math.round(ids.length*ratio/100)));
  return ids.map((id,i)=>({...byKey.get(`${id}:${english.has(id)?"english_to_korean":"korean_to_english"}`)!,base_order_index:i+1}));
}
