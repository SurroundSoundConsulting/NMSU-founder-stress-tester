import {restoreJudgment,consumerJudgment,assertJudgmentFresh} from './protocol.mjs';
export function inspectConsumer(role,{rows,board_id,context,assessment,log,prior}) {
  if(prior?.phase==='complete')return {action:'return_existing',writes:0,proposals:0};
  const result=consumerJudgment(restoreJudgment(rows,board_id),role,context,assessment,log,prior);
  return {...result,complete:true};
}
export function recheckConsumer(saved,role,current) {
  return assertJudgmentFresh(saved,inspectConsumer(role,current));
}
