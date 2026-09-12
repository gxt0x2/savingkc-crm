export type AudienceRow={hasEmail:boolean;identity:'confirmed'|'unresolved'|'shared';permission:boolean;verified:boolean;suppressed:boolean}
export function audienceEligibility(row:AudienceRow){if(!row.hasEmail)return 'needs_review';if(row.suppressed||!row.permission||!row.verified)return 'excluded';return row.identity==='confirmed'?'eligible':'needs_review'}
