import {inspectConsumer,recheckConsumer} from '../connector-judgment/integration.mjs';
export const inspectJudgment=input=>inspectConsumer('executor',input);
export const recheckJudgment=(saved,input)=>recheckConsumer(saved,'executor',input);
