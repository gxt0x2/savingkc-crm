export type EvaluationCase={id:string;critical:boolean;passed:boolean};export function canPublishAiPolicy(cases:EvaluationCase[]){return cases.length>0&&cases.every(c=>!c.critical||c.passed)}
