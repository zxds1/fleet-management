import { z } from 'zod';

export const TrainingStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']);
export type TrainingStatus = z.infer<typeof TrainingStatusSchema>;

export const TrainingLessonSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  course_code: z.string(),
  course_title: z.string(),
  is_mandatory: z.boolean(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  content_url: z.string().nullable(),
  duration_minutes: z.number().nullable(),
  order_index: z.number(),
});
export type TrainingLesson = z.infer<typeof TrainingLessonSchema>;

export const TrainingRosterRowSchema = z.object({
  id: z.string().uuid(),
  driver_id: z.string().uuid(),
  driver_name: z.string().nullable(),
  lesson_id: z.string().uuid(),
  lesson_title: z.string(),
  course_title: z.string(),
  status: TrainingStatusSchema,
  quiz_score: z.number().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
});
export type TrainingRosterRow = z.infer<typeof TrainingRosterRowSchema>;

export const LessonCompleteSchema = z.object({
  quiz_score: z.number().int().min(0).max(100).optional(),
});
export type LessonCompleteInput = z.infer<typeof LessonCompleteSchema>;

export const LessonCompleteOutcomeSchema = z.object({
  id: z.string().uuid(),
  lesson_id: z.string().uuid(),
  status: TrainingStatusSchema,
  completed_at: z.string().nullable(),
});
export type LessonCompleteOutcome = z.infer<typeof LessonCompleteOutcomeSchema>;
