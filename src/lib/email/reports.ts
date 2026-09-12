export function reportValue(value:number|null|undefined,fresh:boolean){return fresh&&typeof value==='number'?{state:'known' as const,value}:{state:'unknown' as const,value:null}}
