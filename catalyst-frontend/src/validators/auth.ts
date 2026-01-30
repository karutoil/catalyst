import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  rememberMe: z.boolean().optional(),
  allowPasskeyFallback: z.boolean().optional(),
});

export type LoginSchema = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3),
});

export type RegisterSchema = z.infer<typeof registerSchema>;
