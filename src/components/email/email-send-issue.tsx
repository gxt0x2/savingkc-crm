export function EmailSendIssue({ state }: { state: string }) {
  const uncertain = state === "uncertain" || state === "dispatching";
  return (
    <div role="status">
      <p>
        {uncertain
          ? "The previous send has no confirmed outcome. Check Resend before sending again; it will not retry automatically."
          : state === "held"
            ? "This message was not sent. Review the sender, domain verification and recipient eligibility in More before preparing a replacement."
            : "Resend rejected this message. Check the provider connection before preparing a replacement."}
      </p>
      <a href="https://resend.com/emails" target="_blank" rel="noreferrer">
        Review in Resend
      </a>
    </div>
  );
}
