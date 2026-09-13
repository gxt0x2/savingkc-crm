export function strictestLimit(...limits:number[]){return Math.min(...limits.filter(Number.isFinite))}
