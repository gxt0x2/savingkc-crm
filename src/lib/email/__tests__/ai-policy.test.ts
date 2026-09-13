import {describe,expect,it} from 'vitest';import {validateAiDecision} from '../ai/policy'
describe('AI policy',()=>{it('fails closed into review',()=>{expect(validateAiDecision({action:'reply',body:'',facts:[],confidence:1}).state).toBe('review');expect(validateAiDecision({action:'reply',body:'Thanks for reaching out.',facts:['message-1'],confidence:.8})).toMatchObject({state:'proposed'})})})
