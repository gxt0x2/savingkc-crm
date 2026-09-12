export function canFreezeRecipientCopy(input:{hasEvidence:boolean;reviewed:boolean;content:string}){return input.hasEvidence&&input.reviewed&&input.content.trim().length>0}
