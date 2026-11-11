-- Private copies of inbound Twilio MMS. The webhook downloads provider media
-- with server credentials and writes only these objects. Activity metadata
-- stores the bucket and path; Twilio media URLs and signed URLs are not kept.
-- No anon or authenticated storage policies: the CRM streams bytes after a
-- session check, using the service role. The bucket stays private.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inbound-mms',
  'inbound-mms',
  false,
  5242880,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
    'image/bmp', 'image/tiff',
    'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/aac', 'audio/amr', 'audio/3gpp',
    'video/mp4', 'video/3gpp', 'video/quicktime',
    'application/pdf', 'text/plain', 'text/vcard'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
