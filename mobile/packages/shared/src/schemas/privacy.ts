import { z } from 'zod';

export const PrivacyRequestTypeSchema = z.enum(['EXPORT', 'DELETION']);
export type PrivacyRequestType = z.infer<typeof PrivacyRequestTypeSchema>;

export const PrivacyRequestStatusSchema = z.enum(['PENDING', 'PROCESSING', 'READY', 'DOWNLOADED', 'COMPLETED', 'FAILED']);
export type PrivacyRequestStatus = z.infer<typeof PrivacyRequestStatusSchema>;

export const PrivacyRequestViewSchema = z.object({
  id: z.string().uuid(),
  request_type: PrivacyRequestTypeSchema,
  status: PrivacyRequestStatusSchema,
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  notes: z.string().nullable(),
});
export type PrivacyRequestView = z.infer<typeof PrivacyRequestViewSchema>;

export const ExportRequestInputSchema = z.object({ notes: z.string().max(2000).optional() }).strict();
export type ExportRequestInput = z.infer<typeof ExportRequestInputSchema>;

export const DeletionRequestInputSchema = z.object({ reason: z.string().min(1).max(2000) }).strict();
export type DeletionRequestInput = z.infer<typeof DeletionRequestInputSchema>;

export const DownloadUrlResponseSchema = z.object({
  media_object_id: z.string().uuid(),
  download_url: z.string().url(),
  expires_at: z.string().datetime(),
});
export type DownloadUrlResponse = z.infer<typeof DownloadUrlResponseSchema>;
