export type AiDecision={action:'reply'|'review';body?:string;facts:string[];confidence:number}
export function validateAiDecision(d:AiDecision){if(d.action==='review')return {state:'review' as const};if(!d.body||d.body.length>1200||d.confidence<0||d.confidence>1||d.facts.length===0)return {state:'review' as const};return {state:'proposed' as const,body:d.body}}
