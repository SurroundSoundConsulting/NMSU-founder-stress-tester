// Small contract shared by the three existing pure preflight validators.
// Work must produce this companion from current ledger/Log reads and real assessment.
export function requireJudgment(s,role,method) {
  const required={executor:'1.4',enforcer:'2.1',feedback:'1.1'};
  if(method!==required[role])return;
  const j=s.judgment,r=s.request;
  const fail=()=>{const e=new Error('judgment_context_missing_or_crossed');e.code='judgment_context_missing_or_crossed';throw e;};
  if(!j||j.protocol!=='connector-judgment/1'||j.role!==role||j.complete!==true||j.board_id!==s.board_id||j.context?.board_id!==s.board_id||j.context.method!==method||j.context.request_id!==r.request_id||j.context.task_id!==r.task_id||!Array.isArray(j.applied)||!Array.isArray(j.excluded))fail();
  const doc=r.draft_id||r.doc_id;
  if(doc&&j.context.doc_id!==doc)fail();
}
