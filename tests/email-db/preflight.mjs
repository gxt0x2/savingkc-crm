import process from 'node:process'
import postgres from 'postgres'

const required = ['EMAIL_TEST_DATABASE_URL', 'EMAIL_TEST_SCHEMA', 'EMAIL_TEST_DATABASE_DISPOSABLE']
const missing = required.filter((key) => !process.env[key]?.trim())
if (missing.length > 0) {
  console.error('Email DB harness not run: missing ' + missing.join(', ') + '. It requires an isolated disposable database and never falls back to CRM production settings.')
  process.exit(2)
}
if (process.env.EMAIL_TEST_DATABASE_DISPOSABLE !== 'yes') {
  console.error('Email DB harness not run: EMAIL_TEST_DATABASE_DISPOSABLE must equal "yes".')
  process.exit(2)
}
const schema = process.env.EMAIL_TEST_SCHEMA
if (!/^email_test_[a-z0-9_]+$/.test(schema)) {
  console.error('Email DB harness not run: EMAIL_TEST_SCHEMA must use an isolated email_test_<name> schema.')
  process.exit(2)
}
let databaseUrl
try {
  databaseUrl = new URL(process.env.EMAIL_TEST_DATABASE_URL)
} catch {
  console.error('Email DB harness not run: EMAIL_TEST_DATABASE_URL must be a valid isolated test database URL.')
  process.exit(2)
}

const sql = postgres(databaseUrl.toString(), { max: 1, prepare: false })
try {
  const [schemaState] = await sql.unsafe(
    'select exists(select 1 from information_schema.schemata where schema_name = $1) as exists',
    [schema],
  )
  if (!schemaState?.exists) {
    console.error('Email DB harness not run: the named isolated schema does not exist.')
    process.exitCode = 2
  } else {
    console.log('Email DB harness is isolated and reachable. EM-002 performs no migrations or business-data verification.')
  }
} catch {
  console.error('Email DB harness not run: the isolated database/schema could not be reached.')
  process.exitCode = 2
} finally {
  await sql.end({ timeout: 2 })
}
