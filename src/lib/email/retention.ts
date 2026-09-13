export function canPurgeRetention(input:{ownerApproved:boolean;previewHash:string;currentPreviewHash:string}){return input.ownerApproved&&input.previewHash===input.currentPreviewHash}
