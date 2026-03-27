import { z } from 'zod'

/**
 * SEC-03: Input Validation Schemas
 * Zod schemas for API endpoint validation
 */

// Lead creation (website form + manual)
export const createLeadSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  full_name: z.string().min(1).max(200).optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format')
    .optional(),
  email: z.string().email('Invalid email address').optional(),
  property_address: z.string().min(1, 'Address is required').max(500),
  address: z.string().max(500).optional(),
  source: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
})

// Feedback submission
export const feedbackSchema = z.object({
  type: z.enum(['bug', 'feature', 'feedback']),
  section: z.enum(['Leads', 'Pipeline', 'Conversations', 'Calendar', 'Dashboard', 'Ari', 'Settings', 'Integrations', 'Other']),
  description: z.string().min(10, 'Description must be at least 10 characters').max(5000),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  page_url: z.string().url().optional(),
  user_agent: z.string().optional(),
  screenshot_url: z.string().url().optional(),
})

// Error logging
export const errorLogSchema = z.object({
  error_type: z.enum(['frontend_crash', 'api_failure', 'timeout', 'validation_error']),
  message: z.string().min(1).max(1000),
  stack_trace: z.string().max(10000).optional(),
  page_url: z.string().url().optional(),
  request_details: z
    .object({
      endpoint: z.string().optional(),
      method: z.string().optional(),
      status_code: z.number().optional(),
      response: z.string().optional(),
    })
    .optional(),
})

// Ghost protocol actions
export const ghostProtocolActionSchema = z.object({
  lead_id: z.string().uuid(),
  reason: z.string().min(1).max(500).optional(),
})

// Status update
export const statusUpdateSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(['feedback', 'error_log']),
  status: z.enum(['open', 'acknowledged', 'in_progress', 'testing', 'resolved', 'closed']),
})

// EOD submission
export const eodSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  calls_made: z.number().int().min(0).max(1000),
  meaningful_conversations: z.number().int().min(0).max(1000),
  appointments_set: z.number().int().min(0).max(100),
  contracts_sent: z.number().int().min(0).max(100),
  notes: z.string().max(5000).optional(),
  agent: z.string().max(50),
})

// Utility function to validate and return parsed data
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: string[] } {
  try {
    const parsed = schema.parse(data)
    return { success: true, data: parsed }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map((err) => `${err.path.join('.')}: ${err.message}`)
      return { success: false, errors }
    }
    return { success: false, errors: ['Validation failed'] }
  }
}
