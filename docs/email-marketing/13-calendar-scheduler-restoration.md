# Calendar Scheduler restoration

The approved Calendar tab must include both Upcoming work and a collapsed Scheduler. The previous implementation hid the entire Scheduler unless the current user owned a pending callback, and could only reschedule that callback.

The Scheduler now remains visible for every conversation. It defaults to new work: Follow-up, Callback, Appointment, Research / task, or Send offer, with title, assignee, Chicago date/time and notes. Eligible callbacks retain a separate reschedule option. Linked Lead and human control requirements are explained in the form, with a route back to Next step. Saving closes the form and refreshes Upcoming; failed saves preserve input.

THR-SCHEDULE creates through the existing canonical create_work_item_v2 function. It validates membership, thread visibility/control/revisions, linked Lead status, pending CRM repair and active assignee. Calls, follow-ups and appointments require a future weekday at or after 8:30 AM Chicago time. Internal tasks require a future date. The task retains the Lead, origin and thread provenance; it does not alter Lead ownership, qualify an Opportunity, change the callback, or book a provider event. Command receipts and a stable form request key guard retries. The assignee receives a private in-app task alert.

Appointments are explicitly CRM appointment tasks. Google Calendar events, invitations, availability checks, end times and external notification delivery remain integration work; this change must not be described as live Google Calendar scheduling. The local preview persists only in its disposable test database, and no production deployment is included.

Validation covers independent task/appointment creation, assignment, authorization, stale revision rejection, invalid dates, idempotent saves, Upcoming projection and scheduling without an active callback. The browser story exercises callback rescheduling, new appointment and new task creation from Calendar.
