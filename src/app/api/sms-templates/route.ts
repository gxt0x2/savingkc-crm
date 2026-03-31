/**
 * SMS Templates API
 * GET /api/sms-templates - List all active templates
 * GET /api/sms-templates?category=ghost_protocol - Filter by category
 */

import { NextResponse } from 'next/server'
import { getAllTemplates, getTemplatesByCategory } from '@/lib/sms-templates'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')

    const templates = category
      ? await getTemplatesByCategory(category)
      : await getAllTemplates()

    return NextResponse.json({ templates })
  } catch (err: any) {
    console.error('SMS templates API error:', err)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}
