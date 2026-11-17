import {inspectConsumer,recheckConsumer} from '../connector-judgment/integration.mjs';
export const inspectJudgment=input=>inspectConsumer('feedback',input);
export const recheckJudgment=(saved,input)=>recheckConsumer(saved,'feedback',input);
