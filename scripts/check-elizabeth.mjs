import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  // Elizabeth and Joseph
  const ids = [
    '538f5e2c-d500-410b-adb7-95ac4e8fee44',
    '7d6d76d8-6136-40c4-b456-0dec633f424d',
  ]

  for (const id of ids) {
    const { data: cache } = await sb.from('hot_opportunities_cache')
      .select('lead_id, composite_score, tier_label, rank, on_hot_list, raw_inputs')
      .eq('lead_id', id)
      .single()

    const { data: lead } = await sb.from('leads')
      .select('full_name, priority, is_favorite, motivation_score, station')
      .eq('id', id)
      .single()

    console.log('\n=== Lead:', lead?.full_name, '===')
    console.log('leads table: priority=' + lead?.priority + ', is_favorite=' + lead?.is_favorite + ', motivation=' + lead?.motivation_score + ', station=' + lead?.station)
    console.log('cache: score=' + cache?.composite_score + ', tier=' + cache?.tier_label + ', rank=' + cache?.rank + ', on_hot_list=' + cache?.on_hot_list)

    if (cache?.raw_inputs) {
      const ri = cache.raw_inputs
      console.log('raw_inputs.isFavorite:', ri.isFavorite)
      console.log('raw_inputs.priorityHot:', ri.priorityHot)
      console.log('raw_inputs.priorityWarm:', ri.priorityWarm)
      console.log('raw_inputs.bonus:', ri.bonus)
      console.log('raw_inputs.motivationBonus:', ri.motivationBonus)
      console.log('raw_inputs.stationBonus:', ri.stationBonus)
    }
  }
}

main().catch(e => console.error(e.message))
