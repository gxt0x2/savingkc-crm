import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261020120000_manifest_physical_archive.sql',
  'utf8',
)
const rollback = readFileSync(
  'scripts/archive/rollback-manifest-physical-archive.sql',
  'utf8',
)

describe('Manifest physical archive migration', () => {
  it('binds the move to the verified external receipt and current source counts', () => {
    expect(migration).toContain('savingkc-manifest-archive-2026-08-26T203409329Z')
    expect(migration).toContain('manifest_count <> 367')
    expect(migration).toContain('history_count <> 10668')
    expect(migration).toContain('outbox_reference_count <> 7')
    expect(migration).toContain('tracking_reference_count <> 8')
    expect(migration).toContain('2b22f25ce0307e1be09c03256a632729fc696233e65e4013b2c73f50a029cc7b')
    expect(migration).toContain('0bc2c67336d3ae1304e4957efb32176f5974ee2cc52c161e1b74e0c42bcb0dac')
  })

  it('moves retained rows into a private schema without deleting business data', () => {
    expect(migration).toContain('ALTER TABLE public.manifest_history SET SCHEMA manifest_archive')
    expect(migration).toContain('ALTER TABLE public.manifests SET SCHEMA manifest_archive')
    expect(migration).toContain('ALTER TABLE public.manifest_archive_receipts SET SCHEMA manifest_archive')
    expect(migration).toContain("confrelid = 'manifest_archive.manifests'::regclass")
    expect(migration).toContain('REVOKE ALL ON SCHEMA manifest_archive')
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+(?:public\.)?(?:manifests|manifest_history)\b/i)
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(migration).not.toMatch(/\bTRUNCATE\s+(?:TABLE\s+)?(?:public\.)?(?:manifests|manifest_history)\b/i)
  })

  it('retires the stale Manifest-backed compatibility RPC while leaving canonical RPCs alone', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.contact_workspace_page_v1')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.contact_workspace_page_v2')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.contact_workspace_manifest_tags')
    expect(migration).not.toContain('contact_workspace_page_v3')
    expect(migration).not.toContain('contact_workspace_page_v4')
  })

  it('provides a fail-closed, non-writing location rollback', () => {
    expect(rollback).toContain('ALTER TABLE manifest_archive.manifests SET SCHEMA public')
    expect(rollback).toContain('ALTER TABLE manifest_archive.manifest_history SET SCHEMA public')
    expect(rollback).toContain("status = 'rolled_back'")
    expect(rollback).toContain("confrelid = 'public.manifests'::regclass")
    expect(rollback).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(rollback).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(rollback).not.toMatch(/\bTRUNCATE\b/i)
  })
})
