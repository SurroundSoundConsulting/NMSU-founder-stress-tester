import {inspectConsumer,recheckConsumer} from '../connector-judgment/integration.mjs';
export const inspectJudgment=input=>inspectConsumer('enforcer',input);
export const recheckJudgment=(saved,input)=>recheckConsumer(saved,'enforcer',input);
