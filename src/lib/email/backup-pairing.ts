type EmailRoutingPair = {
  acquisitionOwnerId: string
  backupId: string
}

/**
 * The configured acquisitions owner and backup form a reciprocal pair. Other
 * agents use the configured backup unless a reviewer chooses another person.
 */
export function defaultEmailBackup(
  ownerId: string,
  routing: EmailRoutingPair | null,
  members: Array<{ id: string }>,
) {
  const active = new Set(members.map((member) => member.id))
  if (routing) {
    if (
      ownerId === routing.acquisitionOwnerId &&
      active.has(routing.backupId)
    )
      return routing.backupId
    if (ownerId === routing.backupId && active.has(routing.acquisitionOwnerId))
      return routing.acquisitionOwnerId
    if (routing.backupId !== ownerId && active.has(routing.backupId))
      return routing.backupId
  }
  return members.find((member) => member.id !== ownerId)?.id
}
