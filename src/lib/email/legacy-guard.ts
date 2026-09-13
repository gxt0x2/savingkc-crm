export function assertLegacySendContext(input:{campaignAddress:boolean;emailThreadId?:string}){if(input.campaignAddress&&!input.emailThreadId)throw new Error('CHOOSE_EMAIL_THREAD');return true}
