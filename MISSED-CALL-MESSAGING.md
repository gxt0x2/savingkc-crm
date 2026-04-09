# Missed Call Auto-Text Messaging System

## Overview

Intelligent auto-reply system that prevents repetitive messages and personalizes responses based on:
- **Agent routing** (which number was called)
- **Lead status** (known vs unknown)
- **Call frequency** (1st, 2nd, 3rd, 4+ calls in 48 hours)
- **Timing** (20min minimum between texts)

## Key Features

### 1. Agent-Aware Messaging
- Automatically detects which Twilio number was called
- Uses correct agent name in message (Casey vs Ernest)
- Routes callback task to the correct agent

### 2. Lead-Specific Tone

**Known Leads** get casual, personal messages:
- 1st call: "Hey Robert, sorry I missed you! Can I call you back in just a few minutes? I'm wrapping something up. - Ernest"
- 2nd call: "Robert, I see you called again — I'll call you right back! - Ernest"
- 3rd call: "Robert, trying to reach you now! Calling you back ASAP. - Ernest"
- 4+ calls: "Robert, I'm on it — calling you now. - Ernest"

**Unknown Callers** get professional but friendly messages:
- 1st call: "Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back."
- 2nd call: "Hi, this is Ernest with Saving KC. I see you called again — are you trying to reach us about selling a property?"
- 3rd call: "Ernest here from Saving KC. Looks like we keep missing each other! Reply YES or call back..."
- 4+ calls: "We're here! Reply YES or call Ernest at Saving KC anytime."

### 3. Smart Rate Limiting

**48-Hour Window Tracking**
- Tracks all auto-texts sent to each number in last 48 hours
- Prevents sending same message twice
- Maximum 4 auto-texts per number in 48 hours

**20-Minute Cooldown**
- If they got a text in last 20 minutes, skip sending another
- Prevents spam if they call multiple times rapidly

### 4. Natural Timing

**Known Leads:**
- 1st call: 20-45 second delay (feels natural, not robotic)
- 2nd+ calls: 15-30 second delay (shows urgency)

**Unknown Callers:**
- 1st call: 60-120 second delay (gives time for voicemail)
- 2nd+ calls: 15-30 second delay

## Technical Implementation

### Files
- `src/lib/missed-call-messaging.ts` - Core messaging logic
- `src/app/api/twilio-missed-call/route.ts` - Webhook handler
- `supabase/migrations/20260408_missed_call_tracking.sql` - DB indexes

### Database Tracking

Auto-texts are logged to `lead_activities` table with metadata:
```json
{
  "direction": "outbound",
  "from": "+18163077835",
  "to": "+18167564943",
  "trigger": "missed_call_auto",
  "variant": 0,
  "agent_name": "Ernest"
}
```

### Agent Routing Logic

Located in `src/lib/agent-routing.ts`:
- Casey's numbers: `+18167277667`, `+18163754666` → Casey primary
- All other numbers → Ernest primary

## Best Practices Implemented

Based on industry research (see Sources below):

1. ✅ **Respond within 30-120 seconds** - Not instant (robotic) but fast enough
2. ✅ **Personalize messages** - Use first name, agent name
3. ✅ **Vary messages** - Never send identical text twice
4. ✅ **Rate limit** - Max 4 texts in 48 hours per number
5. ✅ **Context-aware** - Different tone for known vs unknown
6. ✅ **Clear next step** - "Reply YES" or "I'll call you back"
7. ✅ **Brand voice** - Casual for leads, professional for unknowns

## Testing

Use `scripts/test-missed-call-variants.mjs` to verify:
- Message variants for different call frequencies
- Rate limiting at 4 texts / 48 hours
- 20-minute cooldown between texts
- Correct agent routing

## Edge Cases Handled

- **Team numbers** (`+18167564943`, etc.) - Never trigger lead flows
- **Opted-out numbers** - Skip auto-text entirely
- **Rate limited phones** - Skip if already hit general rate limit
- **No leadId yet** - Creates lead first, then links text activity
- **Multiple rapid calls** - 20min cooldown prevents spam

## Monitoring

Check Ari Briefing for missed call events:
```sql
SELECT * FROM ari_briefing_events 
WHERE event_type = 'missed_call' 
ORDER BY created_at DESC;
```

View auto-text history:
```sql
SELECT 
  created_at,
  description,
  metadata->>'variant' as variant,
  metadata->>'agent_name' as agent
FROM lead_activities 
WHERE metadata->>'trigger' = 'missed_call_auto'
ORDER BY created_at DESC;
```

## Sources

Industry best practices research:
- [How to Respond to a Missed Call by Text](https://www.kixie.com/sales-blog/how-to-respond-to-a-missed-call-by-text-auto-reply-messages-that-work/)
- [Auto-text replies: best practices](https://www.withallo.com/blog/auto-text-reply)
- [Missed Call Text Back: Setup Guide 2026](https://www.getnextphone.com/blog/missed-call-text-back)
- [Maximize Engagement Strategies](https://firstdirect360.com/blog/missed-call-text-back-strategies/)

Key finding: "The missed-call-text-back feature will trigger an SMS notification for every missed call, even if the caller tries multiple times within a brief timeframe. To avoid receiving multiple SMS notifications, customize workflows with wait steps or filters for 1st call, 2nd call, etc."
