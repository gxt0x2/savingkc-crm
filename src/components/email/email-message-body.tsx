export function EmailMessageBody({ body }: { body: string }) {
  const index = body.search(/\n(?:On .+wrote:|From:|>)/i)
  return (
    <>
      <p>{index < 0 ? body : body.slice(0, index)}</p>
      {index >= 0 && (
        <details>
          <summary>Quoted history</summary>
          <p>{body.slice(index)}</p>
        </details>
      )}
    </>
  )
}

