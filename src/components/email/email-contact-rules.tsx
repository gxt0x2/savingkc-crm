'use client';
import { useState } from 'react';
import styles from './email-workspace.module.css';
type Rules = {
    hash: string;
    person: {
        display_name: string;
        status: string | null;
    };
    addresses: {
        id: string;
        email: string;
        slot: number | null;
        relationship: string;
        stopped: boolean;
    }[];
    properties: {
        id: string;
        address: string;
        active: boolean | null;
        reason: string | null;
    }[];
};
const actions = { stop_person: 'Stop this person', deceased_reported: 'Reported deceased — hold for review', deceased_confirmed: 'Confirmed deceased', clear_deceased_hold: 'Clear deceased hold after review', select_addresses: 'Choose primary and backup', hold_property: 'Hold everyone at this property', release_property: 'Release property hold' };
type Action = keyof typeof actions;
export function EmailContactRules({ threadId }: {
    threadId: string;
}) {
    const [data, setData] = useState<Rules | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [action, setAction] = useState<Action>('stop_person'), [reason, setReason] = useState(''), [primary, setPrimary] = useState(''), [backup, setBackup] = useState(''), [property, setProperty] = useState('');
    async function load(clearMessage = true) {
        setBusy(true);
        if (clearMessage) setMessage('');
        try {
            const response = await fetch(`/api/email/contact-rules?threadId=${threadId}`, { cache: 'no-store' });
            if (!response.ok)
                throw new Error('Could not load contact rules. Try again.');
            const result: Rules = await response.json();
            setData(result);
            setPrimary(result.addresses.find(a => a.slot === 1)?.id ?? '');
            setBackup(result.addresses.find(a => a.slot === 2)?.id ?? '');
            setProperty(result.properties[0]?.id ?? '');
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Could not load contact rules.');
        }
        finally {
            setBusy(false);
        }
    }
    async function save() {
        if (!data)
            return;
        setBusy(true);
        setMessage('');
        try {
            const response = await fetch('/api/email/contact-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId, action, reason, expectedHash: data.hash, idempotencyKey: crypto.randomUUID(), ...(action === 'select_addresses' ? { primaryAddressId: primary, ...(backup ? { backupAddressId: backup } : {}) } : {}), ...(['hold_property', 'release_property'].includes(action) ? { propertyId: property } : {}) }) });
            const result = await response.json();
            if (!response.ok) {
                const code = result.error?.code ?? result.code;
                throw new Error(code === 'FINISH_ACTIVE_CONVERSATION_FIRST' ? 'Finish the active conversation before changing its email address.' : code === 'CONTACT_RULE_CHANGED' ? 'Rules changed. Reload them before saving.' : 'Could not save. Reload the rules and check your selections.');
            }
            setMessage(result.state);
            setReason('');
            await load(false);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Could not save.');
        }
        finally {
            setBusy(false);
        }
    }
    const propertyAction = action === 'hold_property' || action === 'release_property';
    return <details onToggle={event => { if (event.currentTarget.open && !data && !busy)
        void load(); }}>
  <summary>Contact rules</summary>
  <p>Stops follow the person. Other heirs keep their own contact preferences.</p>
  {message && <p role="status">{message}</p>}
  {!data ? <button disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Load rules'}</button> : <div className={styles.form}>
   <p><strong>{data.person.status ? data.person.status.replaceAll('_', ' ') : 'No person-level hold'}</strong></p>
   {data.addresses.filter(a => a.slot).map(a => <p key={a.id}>{a.slot === 1 ? 'Primary' : 'Backup'}: {a.email}{a.stopped ? ' · Stopped' : ''}</p>)}
   {data.properties.filter(p => p.active).map(p => <p key={p.id}>Property held: {p.address} · {p.reason === 'conversation_active' ? 'Another conversation is being handled' : 'Owner review'}</p>)}
   <label>Change<select aria-label="Change" value={action} disabled={busy} onChange={e => setAction(e.target.value as Action)}>{Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
   {action === 'select_addresses' && <>
    <p>One active address. The backup is never tried automatically. Stops and the 90-day cooldown still apply.</p>
    <label>Primary<select aria-label="Primary" value={primary} disabled={busy} onChange={e => setPrimary(e.target.value)}><option value="">Choose address</option>{data.addresses.filter(a => a.relationship === 'confirmed').map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select></label>
    <label>Backup<select aria-label="Backup" value={backup} disabled={busy} onChange={e => setBackup(e.target.value)}><option value="">No backup</option>{data.addresses.filter(a => a.relationship === 'confirmed' && a.id !== primary).map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select></label>
   </>}
   {propertyAction && <label>Property<select aria-label="Property" value={property} disabled={busy} onChange={e => setProperty(e.target.value)}><option value="">Choose linked property</option>{data.properties.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}</select></label>}
   {propertyAction && <p>{action === 'hold_property' ? 'Pauses campaign emails to all linked people. It does not unsubscribe them.' : 'Releases only this property hold. Personal stops stay in place; cancelled messages are not restarted.'}</p>}
   {!propertyAction && action !== 'select_addresses' && action !== 'clear_deceased_hold' && <p>Blocks this person, including other confirmed addresses. Other people retain their own preferences.</p>}
   <label>Reason / evidence<textarea value={reason} disabled={busy} maxLength={1000} onChange={e => setReason(e.target.value)} placeholder="What did they say, or what source did you check?"/></label>
   <button disabled={busy || reason.trim().length < 5 || (propertyAction && !property) || (action === 'select_addresses' && (!primary || primary === backup))} onClick={() => void save()}>{busy ? 'Saving…' : actions[action]}</button>
   <button disabled={busy} onClick={() => void load()}>Reload rules</button>
  </div>}
 </details>;
}
