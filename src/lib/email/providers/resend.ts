export type ProviderResult={data?:{id?:string}|null;error?:{message:string}|null}
export function classifyResendResult(result:ProviderResult, timedOut=false){if(timedOut)return {state:'uncertain' as const};if(result.error||!result.data?.id)return {state:'rejected' as const,error:result.error?.message??'missing_provider_id'};return {state:'accepted' as const,providerId:result.data.id}}
export function canRetryProviderIntent(firstAttempt:Date,now:Date,state:'rejected'|'uncertain'){return state==='rejected'&&now.getTime()-firstAttempt.getTime()<=86_400_000}
